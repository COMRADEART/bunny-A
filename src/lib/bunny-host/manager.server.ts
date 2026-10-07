import { EventEmitter } from "node:events";
import { appendFileSync, mkdirSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { canTransition } from "../orch/machine.ts";
import type { OrchTask, Project, ProviderId, ProviderLive, TaskState, HostSample, TaskProgress, TokenUsage, ProcessInfo, ProviderExecutionScope } from "../orch/types.ts";
import { HostDatabase } from "./persistence.server.ts";
import { ModelCapabilityRegistry } from "./model-capability.server.ts";
import { bunnyRoute, eligibility, inferredConstraints, runsLocally } from "./router.ts";
import { defaultAdapters } from "./adapters.server.ts";
import type { AgentSession, HostEvent, HostSnapshot, ProviderAdapter, RunningSession, SubmitTask } from "./contracts.ts";
import { PolicyEngine } from "./learning.server.ts";
import { DEFAULT_TIMING, ProviderRegistry, type RegistryTiming } from "./registry.server.ts";
import { activityLabel } from "./events.ts";
import { describeTree, descendants, killProcess, processTable, sameProcessIdentity, survivors } from "./process-tree.server.ts";
import { verifySpec } from "./verification.server.ts";
import { HostContainment, safeError, type SafeError } from "./failure.server.ts";

const TERMINAL: TaskState[] = ["completed", "failed", "stopped"];
const TRANSCRIPT_LIMIT = 20 * 1024 * 1024;
const lastLine = (text: string) => text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).at(-1) ?? "";
const clip = (text: string, max = 300) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

export type ManagerOptions = {
  /** Folder for raw provider transcripts (one JSONL file per task); null disables them. */
  sessionDirectory?: string | null;
  timing?: RegistryTiming;
  /** Process-table reader, replaceable in tests. */
  processTable?: () => Promise<ProcessInfo[]>;
  containment?: HostContainment;
};

export class TaskManager {
  db: HostDatabase;
  adapters: ProviderAdapter[];
  registry: ProviderRegistry;
  /** M-A-3 T1: per-model capability facts. Additive; routing still reads only the provider registry. */
  modelCapabilities: ModelCapabilityRegistry;
  bus = new EventEmitter();
  instanceId: string = crypto.randomUUID();
  sessions=new Map<string,RunningSession>();
  stopping=new Set<string>();
  samples: HostSample[]=[];
  defaultRoot: string;
  remoteConfigured=false;
  remoteUrl:string|null=null;
  policy:PolicyEngine;
  thermal={cpuWarn:90,gpuWarn:85,autoStop:false};
  hotSensors=new Set<string>();
  flushers=new Map<string,()=>void>();
  treeTimers=new Map<string,ReturnType<typeof setTimeout>>();
  sessionDirectory: string | null;
  readProcesses: () => Promise<ProcessInfo[]>;
  /** Host-owned folders (mission worktrees) a delegated child task may use as its working directory. */
  workspaceRoots: string[]=[];
  /** Installed by the mission owner; checked for direct approvals of pending children too. */
  missionScopeCheck: ((task: OrchTask) => string | null) | null=null;
  containment: HostContainment;
  constructor(db: HostDatabase,defaultRoot: string,adapters?: ProviderAdapter[],options: ManagerOptions={}) {
    this.db=db;this.defaultRoot=realpathSync(defaultRoot);
    this.containment=options.containment ?? new HostContainment({persist:(type,detail,owner)=>this.emit(db.event(type,owner.taskId ?? null,detail,owner.missionId ?? null))});
    this.instanceId=this.containment.instanceId;
    this.policy=new PolicyEngine(db);
    this.adapters=adapters ?? defaultAdapters(()=>this.providerPaths());
    this.registry=new ProviderRegistry(this.adapters,db,options.timing ?? DEFAULT_TIMING);
    this.modelCapabilities=new ModelCapabilityRegistry(db,{providerPaths:()=>this.providerPaths(),availableProviders:()=>this.adapters.map(adapter=>adapter.id)});
    this.sessionDirectory=options.sessionDirectory ?? null;
    this.readProcesses=options.processTable ?? processTable;
    const savedThermal=db.db.prepare("SELECT value FROM settings WHERE key='thermal_policy'").get() as {value:string}|undefined;
    if(savedThermal) this.thermal=JSON.parse(savedThermal.value);
    this.bus.setMaxListeners(100);
    // UI reconnect never calls this. A new Host instance genuinely cannot attach
    // to an old non-interactive pipe; keep session/PID evidence without killing it.
    for(const task of db.tasks()) if(["launching","running","verifying","waiting_for_input","waiting_for_agent_approval"].includes(task.state)) {
      this.update(task,{state:"failed",error:"Host process restarted; this adapter cannot reattach its old pipes. Previous PID retained for diagnosis; no process was killed.",finishedAt:Date.now()},"task.failed","Host restarted; session recovery unsupported.");
    }
  }
  /** Compatibility view of the registry. */
  get providers(): ProviderLive[] {return this.registry.list();}
  emit(event: HostEvent) {
    // A broken subscriber (including an async one) cannot throw through a committed task transition.
    for (const listener of this.bus.rawListeners("event")) {
      try { const result=listener.call(this.bus,event); if(result && typeof result.then==="function") this.containment.background({subsystem:"event-consumer",...(event.taskId ? {taskId:event.taskId} : {}),...(event.missionId ? {missionId:event.missionId} : {})},()=>result,undefined,"SUBSYSTEM_FAILURE"); }
      catch(error) {this.containment.background({subsystem:"event-consumer"},()=>this.containment.contain(error,"boundary",{owner:{subsystem:"event-consumer"},failureClass:"SUBSYSTEM_FAILURE"}));}
    }
  }
  /** For timers and thermal policy: a stop that fails (e.g. the task already ended) is reported, never an unhandled rejection. */
  stopInBackground(id: string,detail: string) {
    this.containment.background({subsystem:"tasks",taskId:id},()=>this.stop(id,detail),async error=>{this.emit(this.db.event("task.stop_failed",id,"Background Stop failed; inspect the task state."));await this.failOperation(id,error);});
  }
  async failOperation(id:string,error:SafeError) {
    const current=this.db.get(id);
    if(TERMINAL.includes(current.state) || this.stopping.has(id)) return;
    this.stopTree(id);
    this.update(current,{state:"failed",finishedAt:Date.now(),error:error.message,activity:"Failed"},"task.failed","Unexpected task failure; operation ended without success.");
    await this.sessions.get(id)?.stop();
  }
  update(task: OrchTask,patch: Partial<OrchTask>,type: string,detail: string,quiet=false): OrchTask {
    const owned=this.db.get(task.id);
    if(patch.state && TERMINAL.includes(owned.state) && (patch.state!==owned.state || /^task\.(completed|failed|stopped)$/.test(type))) return owned;
    if(JSON.stringify(Object.hasOwn(patch,"executionScope") ? patch.executionScope : task.executionScope)!==JSON.stringify(owned.executionScope) || JSON.stringify(Object.hasOwn(patch,"mission") ? patch.mission : task.mission)!==JSON.stringify(owned.mission)) throw new Error("Task execution authority and mission ownership are immutable; submit a new approved task.");
    if(patch.state && patch.state!==owned.state && !canTransition(owned.state,patch.state)) throw new Error(`Invalid transition ${owned.state} → ${patch.state}`);
    const next={...owned,...patch,logs:quiet ? owned.logs : [...owned.logs,{at:Date.now(),line:detail}].slice(-500)};
    this.emit(this.db.write(next,type,detail));return next;
  }
  providerPaths(): Partial<Record<ProviderId,string>> {
    try {const row=this.db.db.prepare("SELECT value FROM settings WHERE key='provider_paths'").get() as {value:string}|undefined;return row ? JSON.parse(row.value) : {};} catch {return {};}
  }
  announce(changes: string[]) {if(changes.length) this.emit(this.db.event("provider.status_changed",null,changes.join("; ")));}
  /** User-requested refresh: re-probes every provider and model listing now. */
  async discover() {this.announce([...await this.registry.refresh({force:true}),...await this.modelCapabilities.refresh({force:true})]);}
  /** Periodic refresh: cheap health checks, full probes only when due. */
  async refreshProviders() {this.announce([...await this.registry.refresh(),...await this.modelCapabilities.refresh()]);}
  async configureProviderPath(id: ProviderId,path: string|null) {
    const paths=this.providerPaths();
    if(path) {const real=realpathSync(resolve(path));if(!statSync(real).isFile()) throw new Error("Executable path must be a file.");paths[id]=real;} else delete paths[id];
    this.db.db.prepare("INSERT INTO settings VALUES('provider_paths',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(paths));
    this.emit(this.db.event("provider.path_configured",null,`${id}: ${path ? paths[id] : "automatic discovery"}`));
    await this.discover();
  }
  live(): ProviderLive[] {
    const active=[...this.sessions.keys()].map(id=>this.db.get(id));
    return this.registry.list().map(provider=>{
      const mine=active.filter(task=>task.provider===provider.id);
      // State loaded from disk is shown, but nothing is routable until this Host instance probed it itself.
      const base=this.registry.probedThisRun(provider.id) ? provider : {...provider,availability:"unknown" as const,detail:`Re-probing after Host start. Last known: ${provider.availability.replaceAll("_"," ")}. ${provider.detail}`};
      return {...base,active_jobs:mine.length,activeSessions:mine.map(task=>({taskId:task.id,providerSessionId:task.sessionId ?? null,pid:task.pid ?? null})),availability:mine.length && base.availability === "ready" ? "busy" : base.availability,observed:this.db.observed(provider.id)};
    });
  }
  snapshot(after=0): HostSnapshot {return {app:"Bunny-A",instanceId:this.instanceId,health:this.containment.snapshot(),tasks:this.db.tasks(),projects:this.db.projects(),providers:this.live(),samples:this.samples,events:after ? this.db.events(after) : this.db.recentEvents(),cursor:this.db.cursor(),performance:this.db.performance(),remoteConfigured:this.remoteConfigured,remoteUrl:this.remoteUrl,devices:this.db.db.prepare("SELECT id,name,created_at AS createdAt FROM devices WHERE revoked_at IS NULL").all() as {id:string;name:string;createdAt:number}[],thermal:this.thermal,modelCapabilities:this.modelCapabilities.snapshot()};}
  configureThermal(cpuWarn:number,gpuWarn:number,autoStop:boolean) {
    if(!Number.isFinite(cpuWarn)||cpuWarn<30||cpuWarn>120||!Number.isFinite(gpuWarn)||gpuWarn<30||gpuWarn>120) throw new Error("Thermal thresholds must be 30–120°C.");
    this.thermal={cpuWarn,gpuWarn,autoStop};this.db.db.prepare("INSERT INTO settings VALUES('thermal_policy',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(this.thermal));
    this.emit(this.db.event("thermal.configured",null,`CPU ${cpuWarn}°C, GPU ${gpuWarn}°C; automatic stop ${autoStop ? "enabled by user" : "off"}.`));
  }
  sample(sample:HostSample) {
    this.samples=[...this.samples,sample].slice(-40);
    const sensors=[{name:"CPU",temperature:sample.cpu.temperatureC,threshold:this.thermal.cpuWarn},...sample.gpus.map(g=>({name:g.name,temperature:g.temperatureC,threshold:this.thermal.gpuWarn}))];
    for(const sensor of sensors) {
      if(sensor.temperature==null) continue;
      if(sensor.temperature>=sensor.threshold && !this.hotSensors.has(sensor.name)) {
        this.hotSensors.add(sensor.name);this.emit(this.db.event("thermal.warning",null,`${sensor.name} temperature warning: ${sensor.temperature}°C (threshold ${sensor.threshold}°C).`));
        if(this.thermal.autoStop) for(const [id] of this.sessions) {if(this.db.get(id).provider === "ollama") this.stopInBackground(id,"User-enabled thermal policy stopped local inference.");}
      } else if(sensor.temperature<sensor.threshold-2 && this.hotSensors.delete(sensor.name)) this.emit(this.db.event("thermal.resolved",null,`${sensor.name} temperature recovered.`));
    }
    this.bus.emit("telemetry",sample);
  }
  registerProject(name: string,path: string): Project {
    const root=realpathSync(resolve(path));if(!statSync(root).isDirectory()) throw new Error("Project root must be an existing directory.");
    const existing=this.db.projects().find(p=>p.path===root);if(existing) return existing;
    const project={id:crypto.randomUUID(),name:name.trim(),path:root,preferred:"auto" as const};this.db.project(project);this.emit(this.db.event("project.registered",null,`Approved project root: ${project.name}`));return project;
  }
  /**
   * `delegated` is only passed in-process by the MissionManager (never from HTTP input): it links the
   * child task to its mission step and may place it in a Host-owned mission workspace.
   */
  submit(input: SubmitTask,delegated?: {missionId:string;stepId:string;cwd?:string|null;executionScope:ProviderExecutionScope}): OrchTask {
    this.containment.assertAccepting("tasks");
    const scope=delegated?.executionScope ?? input.executionScope;
    if(delegated && !scope || scope && !["read","write"].includes(scope.access)) throw new Error("Invalid or missing provider execution scope.");
    const executionScope=scope ? {access:scope.access} : undefined;
    // A mission child is routed on its step objective; Bunny's own agent-prompt wording must not add requirements.
    const routingText=input.routingPrompt ?? input.prompt;
    const constraints=inferredConstraints(routingText,input.constraints);
    let project=input.projectId ? this.db.projects().find(p=>p.id===input.projectId) ?? null : null;
    if(input.projectId && !project) throw new Error("Project is not registered on this Host.");
    if(constraints.workingDirectory) {
      // A required folder must be an approved project root (or the Host's default root); it is never created or guessed.
      let folder:string;try {folder=realpathSync(resolve(constraints.workingDirectory));} catch {throw new Error("The required working directory does not exist.");}
      const owner=this.db.projects().find(p=>p.path===folder) ?? null;
      if(!owner && folder!==this.defaultRoot) throw new Error("The required working directory is not an approved project folder.");
      if(project && project.path!==folder) throw new Error("The required working directory differs from the selected project.");
      project=owner;constraints.workingDirectory=folder;
    }
    let cwd=project?.path ?? constraints.workingDirectory ?? this.defaultRoot;
    if(delegated?.cwd) {
      let folder:string;try {folder=realpathSync(resolve(delegated.cwd));} catch {throw new Error("The mission workspace does not exist.");}
      const inside=(root:string)=>{let real:string;try {real=realpathSync(root);} catch {return false;}const rel=relative(real,folder);return rel==="" || (!!rel && !rel.startsWith("..") && !isAbsolute(rel));};
      if(!statSync(folder).isDirectory() || !(folder===this.defaultRoot || this.db.projects().some(p=>p.path===folder) || this.workspaceRoots.some(inside))) throw new Error("The mission workspace is not an approved project folder or Host-owned workspace.");
      cwd=folder;
    }
    const live=this.live();const policy=this.policy.active();
    const decision=bunnyRoute({...input,prompt:routingText,providers:live,constraints,policyId:policy.id,learned:id=>this.policy.adjustment(live.find(p=>p.id===id)!,routingText,input.mode,policy)});
    const task: OrchTask={id:crypto.randomUUID(),...(delegated ? {mission:{missionId:delegated.missionId,stepId:delegated.stepId}} : {}),title:input.prompt.trim().split("\n")[0].slice(0,80),prompt:input.prompt,mode:input.mode,projectId:project?.id ?? null,cwd,state:"queued",provider:decision.recommended_provider,model:decision.recommended_model,decision,manual:!!input.override && input.override!=="auto",createdAt:Date.now(),startedAt:null,finishedAt:null,output:"",error:null,logs:[],pauseSupported:false,sessionId:null,pid:null,exitCode:null,constraints,maxRuntimeMs:constraints.maxRuntimeMs ?? 120000,verify:input.verify ?? null,latestEvent:null,progress:null,usage:null,processTree:null,retries:0};
    if(executionScope) task.executionScope=executionScope;
    if(input.routingPrompt!==undefined) task.routingPrompt=input.routingPrompt;
    this.emit(this.db.write(task,"task.created","Task created on Bunny-A Host."));
    const routing=this.update(task,{state:"routing"},"routing.started","Routing with readiness and hard constraints.");
    return this.update(routing,{state:"waiting_for_approval",activity:"Waiting for approval"},"approval.required",decision.reason);
  }
  retarget(id: string,provider: ProviderId) {
    const task=this.db.get(id);if(task.state!=="waiting_for_approval") throw new Error("Only pending tasks can be retargeted.");
    const decision=bunnyRoute({prompt:task.routingPrompt ?? task.prompt,mode:task.mode,providers:this.live(),override:provider,constraints:task.constraints,policyId:this.policy.active().id});
    return this.update(task,{provider,model:decision.recommended_model,decision,manual:true},"routing.completed",`User selected ${provider}.`);
  }
  /** Appends raw provider output to the Host's private transcript for this task. */
  transcript(id: string) {
    if(!this.sessionDirectory) return null;
    const path=join(this.sessionDirectory,`${id}.jsonl`);let written=0;
    try {mkdirSync(this.sessionDirectory,{recursive:true});} catch {return null;}
    return {path,write:(stream:"stdout"|"stderr",text:string)=>{if(written>TRANSCRIPT_LIMIT) return;const line=JSON.stringify({at:Date.now(),stream,text})+"\n";written+=line.length;try {appendFileSync(path,line);} catch { /* Transcript is evidence, not control flow. */ }}};
  }
  activity(task: OrchTask,type: string,detail: string,actor:"provider"|"bunny"="provider") {
    return {type,detail:clip(detail),at:Date.now(),label:activityLabel(type),actor};
  }
  /** Direct user approval. Unchanged contract: launches exactly one task that is waiting for approval. */
  approve(id: string,by="workstation"): OrchTask {
    const launched=this.launch(id,{kind:"user",at:Date.now()},"approval.accepted","User approved this task and execution root.");
    if(by.startsWith("device:")) this.emit(this.db.event("approval.remote_device",id,`Direct task approval by ${by}.`));
    return launched;
  }
  /**
   * Mission-delegated approval: the user approved the mission's authorization envelope, not this child.
   * `check` re-validates the child against that envelope at launch time; anything outside it is refused
   * so the mission stops and asks. Recorded as `approval.delegated`, never as a user click.
   */
  approveDelegated(id: string,delegation:{missionId:string;stepId:string;authorizationId:string;check:(task:OrchTask)=>string|null}): OrchTask {
    const task=this.db.get(id);
    if(!task.mission || task.mission.missionId!==delegation.missionId || task.mission.stepId!==delegation.stepId) throw new Error("Delegated approval only applies to this mission's own child task.");
    const outside=delegation.check(task);if(outside) throw new Error(`Outside the mission authorization: ${outside}`);
    return this.launch(id,{kind:"mission",at:Date.now(),authorizationId:delegation.authorizationId,missionId:delegation.missionId,stepId:delegation.stepId},"approval.delegated",`Mission-delegated approval under authorization ${delegation.authorizationId} (mission ${delegation.missionId}, step ${delegation.stepId}). The user approved the mission scope, not this individual child task.`);
  }
  private launch(id: string,approval: NonNullable<OrchTask["approval"]>,approvalEvent: string,approvalDetail: string): OrchTask {
    this.containment.assertAccepting("tasks");
    const task=this.db.get(id);if(task.state!=="waiting_for_approval") throw new Error("Task is not awaiting approval; duplicate launches are refused.");
    if(task.mission && !task.executionScope) throw new Error("Legacy mission child has no provider execution authority; replan and approve the mission again.");
    if(task.mission) { const outside=this.missionScopeCheck ? this.missionScopeCheck(task) : "mission scope validator is unavailable"; if(outside) throw new Error(`Outside mission execution scope: ${outside}`); }
    if(task.executionScope && !["read","write"].includes(task.executionScope.access)) throw new Error("Invalid provider execution authority.");
    const provider=this.live().find(p=>p.id===task.provider);if(!provider) throw new Error("Executor is no longer eligible. Route again.");
    const blocked=eligibility(provider,task.constraints ?? {});if(blocked) throw new Error(`Executor is no longer eligible: ${blocked} Route again.`);
    if((task.constraints?.localOnly || task.constraints?.offlineOnly) && !runsLocally(provider,task.model)) throw new Error(`Executor is no longer eligible: ${task.model} is not local inference and this task is local-only. Route again.`);
    const adapter=this.adapters.find(a=>a.id===task.provider);if(!adapter) throw new Error("Adapter unsupported.");
    if(!task.cwd || realpathSync(task.cwd)!==task.cwd || !statSync(task.cwd).isDirectory()) throw new Error("Execution root changed or is unavailable.");
    const accepted=this.update(task,{state:"launching",startedAt:Date.now(),activity:"Starting",...(approval.kind==="mission" ? {approval} : {})},approvalEvent,approvalDetail);
    const launching=this.update(accepted,{latestEvent:this.activity(accepted,"agent.starting",`${provider.name} starting in ${task.cwd}.`),progress:{kind:"indeterminate"}},"agent.starting",`${provider.name} starting in ${task.cwd}.`);
    // Streamed chunks are coalesced: one record write, event and log-free update per flush instead of per token.
    let pending="";let flushTimer:ReturnType<typeof setTimeout>|null=null;let pendingProgress:TaskProgress|null=null;let reportedUsage:TokenUsage|null=null;
    const flush=()=>{
      if(flushTimer) {clearTimeout(flushTimer);flushTimer=null;}
      if(!pending) return;
      const text=pending;pending="";
      const current=this.db.get(id);if(TERMINAL.includes(current.state)) return;
      const line=lastLine(text);
      this.update(current,{output:(current.output+text).slice(-2_000_000),...(line ? {latestEvent:this.activity(current,"agent.output",line)} : {})},"agent.output",`${text.length} characters of output`,true);
    };
    this.flushers.set(id,flush);
    const record=this.transcript(id);
    let session:RunningSession;
    try {
      // Adapters receive a detached, immutable authority snapshot, never the persisted task object.
      const adapterTask=structuredClone(launching);
      if(adapterTask.executionScope) Object.freeze(adapterTask.executionScope);
      if(adapterTask.mission) Object.freeze(adapterTask.mission);
      Object.freeze(adapterTask);
      session=adapter.launch(adapterTask,{
        event:(type,detail)=>{
          // Output that arrived first is written first, so the latest activity is really the latest.
          flush();
          const current=this.db.get(id);if(TERMINAL.includes(current.state) || this.stopping.has(id)) return;
          const progress=pendingProgress;pendingProgress=null;
          const visible=type.startsWith("agent.");
          this.update(current,{activity:activityLabel(type),...(visible ? {latestEvent:this.activity(current,type,detail)} : {}),...(progress ? {progress} : {})},type,detail);
        },
        session:(sessionId,pid)=>{
          // Providers repeat their session id on every message; only a new id or PID is recorded.
          const current=this.db.get(id);if((sessionId ?? current.sessionId)===current.sessionId && (pid ?? current.pid)===current.pid) return;
          this.update(current,{sessionId:sessionId ?? current.sessionId,pid:pid ?? current.pid},"session.recorded",`Provider session ${sessionId ?? current.sessionId ?? "pending"}; PID ${pid ?? current.pid ?? "none"}.`);if(pid) this.watchTree(id);
        },
        model:model=>{const current=this.db.get(id);if(current.model!==model) this.update(current,{model},"executor.model",`Provider reported model ${model}.`);},
        output:text=>{pending+=text;if(pending.length>2_000_000) pending=pending.slice(-2_000_000);flushTimer??=setTimeout(this.containment.guard({subsystem:"tasks",taskId:id},flush,error=>this.failOperation(id,error)),300);},
        progress:progress=>{pendingProgress=progress;},
        usage:usage=>{reportedUsage=usage;},
        rateLimits:(windows,status)=>{this.registry.recordSessionUsage(task.provider,windows,status);},
        raw:(stream,text)=>record?.write(stream,text),
      });
    } catch(error) {this.flushers.delete(id);const message=safeError(error).message;return this.update(launching,{state:"failed",finishedAt:Date.now(),error:message,latestEvent:this.activity(launching,"agent.failed",message)},"task.failed",message);}
    this.sessions.set(id,session);
    const running=this.update(this.db.get(id),{state:"running",activity:"Running",...(record ? {logs:[...this.db.get(id).logs,{at:Date.now(),line:`Raw session transcript: ${record.path}`}]} : {})},"executor.starting","Execution active. Progress indeterminate until the provider publishes a plan.");
    const timer=setTimeout(()=>this.stopInBackground(id,"Runtime limit reached."),task.maxRuntimeMs ?? 120000);
    this.containment.background({subsystem:"tasks",taskId:id,...task.mission},async()=>{
      try {
      const result=await session.done;
      flush();this.stopTree(id);
      if(this.stopping.has(id)) return;
      const current=this.db.get(id);if(TERMINAL.includes(current.state)) return;
      if(["draining","fatal"].includes(this.containment.health.operationalState)) {await this.failOperation(id,{name:"HostFatal",message:"Host fatal shutdown interrupted this owned task; no session was resumed."});return;}
      let state:TaskState=result.stopped ? "stopped" : result.ok ? "completed" : "failed";
      let verification=current.verification ?? null;let error=result.error ?? null;
      if(state === "completed" && current.verify) {
        const spec=current.verify;
        const verifying=this.update(current,{state:"verifying",activity:"Verifying",latestEvent:this.activity(current,"agent.verifying",`Bunny-A is checking ${spec.name} itself.`,"bunny")},"agent.verifying",`Bunny-A is independently verifying ${spec.name}.`);
        verification=await verifySpec(verifying,spec);
        this.update(this.db.get(id),{verification},"verification.completed",verification.detail);
        if(!verification.passed) {state="failed";error=`Bunny-A verification failed: ${verification.detail}`;}
      }
      const latest=this.db.get(id);if(TERMINAL.includes(latest.state) || this.stopping.has(id)) return;
      if(["draining","fatal"].includes(this.containment.health.operationalState)) {await this.failOperation(id,{name:"HostFatal",message:"Host fatal shutdown interrupted verification; no success was recorded."});return;}
      const detail=state === "completed" ? (verification ? `Completed and verified by Bunny-A: ${verification.detail}` : "Provider process completed; no independent verification was requested.") : error ?? `Provider process ${state}.`;
      const finished=this.update(latest,{state,finishedAt:Date.now(),output:result.output || latest.output,error:state === "completed" ? null : error,exitCode:result.exitCode ?? null,activity:activityLabel(`task.${state}`),verification,usage:reportedUsage ?? latest.usage ?? null,latestEvent:this.activity(latest,`agent.${state}`,detail,verification ? "bunny" : "provider")},`task.${state}`,detail);
      if(finished.provider === "codex") this.containment.background({subsystem:"provider-usage"},()=>this.registry.refreshUsage("codex"));
      } catch(error) {await this.containment.contain(error,"boundary",{owner:{subsystem:"tasks",taskId:id,...task.mission},fail:error=>this.failOperation(id,error)});}
      finally {clearTimeout(timer);if(flushTimer) clearTimeout(flushTimer);this.stopTree(id);this.flushers.delete(id);this.sessions.delete(id);}
    });
    return running;
  }
  /** Snapshots the owned process tree shortly after launch and then periodically; an event only when it changes. */
  watchTree(id: string) {
    if(this.treeTimers.has(id)) return;
    const tick=async()=>{
      const pid=this.sessions.get(id)?.pid?.() ?? this.db.get(id).pid;
      if(pid && this.sessions.has(id)) {
        const rows=await this.readProcesses().catch(()=>null);
        const current=this.db.get(id);
        if(rows && !TERMINAL.includes(current.state) && !this.stopping.has(id)) {
          const tree=descendants(rows,pid);
          if(tree.length && tree.map(row=>row.pid).join(",")!==(current.processTree ?? []).map(row=>row.pid).join(",")) this.update(current,{processTree:tree,processTreeAt:Date.now()},"session.process_tree",describeTree(tree),true);
        }
      }
      if(this.treeTimers.has(id)) this.treeTimers.set(id,setTimeout(()=>this.containment.background({subsystem:"process-observation",taskId:id},tick,()=>this.stopTree(id)),15000));
    };
    this.treeTimers.set(id,setTimeout(()=>this.containment.background({subsystem:"process-observation",taskId:id},tick,()=>this.stopTree(id)),2000));
  }
  stopTree(id: string) {const timer=this.treeTimers.get(id);if(timer) clearTimeout(timer);this.treeTimers.delete(id);}
  async stop(id: string,detail="User stopped the selected task.") {
    const task=this.db.get(id);if(!canTransition(task.state,"stopped")) throw new Error("Task has already ended.");
    if(this.stopping.has(id)) throw new Error("Stop already in progress.");
    this.stopping.add(id);
    try {
      const session=this.sessions.get(id);
      // Pre-stop observations remain evidence only; failed fresh inspection confers no kill authority.
      const root=session?.pid?.() ?? null;
      const initial=root ? await this.readProcesses().catch(()=>null) : [];
      const before=root && initial ? descendants(initial,root) : [];
      // Abort request is issued before marking stopped; cancellation errors are honest failures.
      await session?.stop();
      this.flushers.get(id)?.();this.stopTree(id);
      let cleanup="";
      const stopCleanup: NonNullable<OrchTask["stopCleanup"]>={status:"complete",inspectedAt:Date.now(),unresolvedProcessCount:0,terminationFailures:0};
      if(root) {
        const fresh=await this.readProcesses().catch(()=>null);
        if(!initial || !before.length || !fresh || before.some(row=>!sameProcessIdentity(row,row))) {
          stopCleanup.status="ownership_unverified";stopCleanup.unresolvedProcessCount=before.length || null;
          cleanup=" Cleanup ownership unverified: process inspection or lifetime identity is unavailable. Session Stop was requested; no snapshot-based termination was attempted and remaining ownership is unresolved.";
        } else {
          let alive=survivors(before,fresh);
          for(const row of alive) {
            // Native termination checks lifetime/image on the very handle it terminates.
            try {await killProcess(row);} catch {stopCleanup.terminationFailures++;}
          }
          const verified=alive.length ? await this.readProcesses().catch(()=>null) : fresh;
          stopCleanup.inspectedAt=Date.now();
          if(!verified) {
            stopCleanup.status="ownership_unverified";stopCleanup.unresolvedProcessCount=alive.length;
            cleanup=" Cleanup ownership unverified: final process inspection failed. Remaining ownership is unresolved; no previous table was reused.";
          } else {
            alive=survivors(before,verified);stopCleanup.unresolvedProcessCount=alive.length;
            stopCleanup.status=alive.length || stopCleanup.terminationFailures ? "cleanup_incomplete" : "complete";
            cleanup=stopCleanup.status!=="complete" ? ` Cleanup incomplete: ${alive.length} corroborated owned process(es) remain; ${stopCleanup.terminationFailures} identity-checked termination(s) refused or failed.` : ` Verified ${before.length} recorded process lifetime(s) ended; none remain (${describeTree(before)}).`;
          }
        }
      } else if(session) cleanup=" No OS process belonged to this session (in-process request).";
      if(stopCleanup.status!=="complete") this.emit(this.db.event("task.cleanup_incomplete",id,cleanup.trim()));
      const current=this.db.get(id);if(!canTransition(current.state,"stopped")) return current;
      const stopped=this.update(current,{state:"stopped",finishedAt:Date.now(),activity:stopCleanup.status==="complete" ? "Stopped" : "Stopped; cleanup incomplete",stopReason:detail,stopCleanup,latestEvent:this.activity(current,"agent.stopped",detail+cleanup,"bunny"),...(before.length ? {processTree:before,processTreeAt:Date.now()} : {})},"task.stopped",detail+cleanup);
      return stopped;
    } finally {this.stopping.delete(id);}
  }
  /** Host-owned session view; the same record every UI reconnects to. */
  getSession(id: string): AgentSession {
    const task=this.db.get(id);
    return {taskId:task.id,provider:task.provider,providerSessionId:task.sessionId ?? null,pid:task.pid ?? null,processTree:task.processTree ?? null,projectId:task.projectId,cwd:task.cwd ?? null,startedAt:task.startedAt,finishedAt:task.finishedAt,state:task.state,latestEvent:task.latestEvent ?? null,progress:task.progress ?? null,logs:task.logs.slice(-100),result:task.output.slice(-20000),error:task.error,exitCode:task.exitCode ?? null,owned:this.sessions.has(id),features:this.registry.get(task.provider)?.features ?? null,transcript:this.sessionDirectory && task.startedAt ? join(this.sessionDirectory,`${task.id}.jsonl`) : null};
  }
  /** Replays a task's events, then follows live ones until the task ends. */
  async *streamEvents(id: string,after=0): AsyncGenerator<HostEvent> {
    let cursor=after;
    for(;;) {
      const events=this.db.taskEvents(id,cursor);
      for(const event of events) {cursor=event.sequence;yield event;}
      if(events.length===500) continue;
      if(TERMINAL.includes(this.db.get(id).state)) return;
      await new Promise<void>(resolveWait=>{
        const done=()=>{clearTimeout(timeout);this.bus.off("event",onEvent);resolveWait();};
        const onEvent=(event:HostEvent)=>{if(event.taskId===id) done();};
        const timeout=setTimeout(done,15000);this.bus.on("event",onEvent);
      });
    }
  }
  async sendInput(id: string,input: string) {
    const task=this.db.get(id);const session=this.sessions.get(id);
    if(!session) throw new Error("No live Bunny-A session for this task.");
    if(!session.sendInput) throw new Error(`Input unavailable: ${this.registry.get(task.provider)?.features?.sendInput.note ?? "this provider session does not accept input."}`);
    await session.sendInput(input);
    this.update(this.db.get(id),{},"session.input",`${input.length} characters sent to the session.`);
  }
  /** Terminal attachment is reported per provider; Bunny-A never opens an unrelated terminal in its place. */
  terminal(id: string): never {
    const task=this.db.get(id);const feature=this.registry.get(task.provider)?.features?.terminalAttachment;
    throw new Error(`Terminal attachment unavailable: ${feature?.note ?? "this provider exposes no terminal."}`);
  }
  feedback(id: string,value: "positive"|"negative") {
    const task=this.db.get(id);if(!TERMINAL.includes(task.state)) throw new Error("Feedback is recorded after a task ends.");
    const next=this.update(task,{feedback:value},"task.feedback",`User feedback: ${value}.`);
    if(next.startedAt) this.db.outcome(next);
    return next;
  }
  importLegacy(tasks: OrchTask[],projects: Project[]) {
    // Idempotent migration; never launch a legacy task or invent its old session.
    const known=new Set(this.db.tasks().map(task=>task.id));
    for(const project of projects) {try {const root=realpathSync(project.path);if(statSync(root).isDirectory() && !this.db.projects().some(p=>p.id===project.id)) this.db.project({...project,path:root});} catch { /* Preserve browser backup; unavailable roots are not authorized. */ }}
    for(const original of tasks) {
      if(known.has(original.id)) continue;
      const task={...original};
      if(!["completed","failed","stopped"].includes(task.state)) {task.state="stopped";task.error="Imported browser-only task has no Host-owned session. Route again to execute.";task.finishedAt=Date.now();}
      this.emit(this.db.write(task,"task.imported","Imported prior browser history; no execution launched."));known.add(task.id);
    }
  }
}
