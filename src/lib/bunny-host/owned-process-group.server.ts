import { randomUUID, createHash } from "node:crypto";
import { createRequire } from "node:module";
import { createServer, type Socket } from "node:net";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { isMainThread } from "node:worker_threads";
import { assertApplicationDirectory } from "./state-paths.server.ts";
import { trackOwnedGroup } from "./owned-processes.server.ts";

export type OwnedProcessIdentity = { pid: number; createdAt: number; file?: string };
export type OwnedProcessRecord = {
  schema: "bunny-owned-operation/1"; operationId: string; missionId: string | null; stepId: string | null;
  capabilityRunId: string | null; containerId: string; mechanism: "windows-job-object";
  launcherPath: string; launcherPid: number; launcherCreatedAt: number; members: OwnedProcessIdentity[];
  startedAt: number; endedAt: number | null; repo: string; cwd: string; action: string;
  state: "running" | "succeeded" | "failed" | "stopped" | "timeout" | "interrupted";
  exitCode: number | null; killOnClose: true; breakaway: false; closed: boolean;
  /** T9R-F04 provider sessions: who owns the job and how its lifetime ended (kernel accounting, not samples). */
  taskId?: string | null; agentId?: string | null; sessionId?: string | null; provider?: string | null; hostGeneration?: string | null;
  activeProcesses?: number | null; totalProcesses?: number | null; terminatedAtEnd?: number | null;
  /** "empty": kernel ActiveProcesses 0. "absent_after_restart": no recorded identity in a process-table read after the
   * job died with its Host (no kernel accounting exists then). "refused": native launch failed before the root ran. */
  containment?: "running" | "terminating" | "empty" | "unconfirmed" | "absent_after_restart" | "refused";
  /** Restart could not check any recorded identity; listed for owner review, never re-reported as live. */
  reviewRequired?: boolean;
};
export type ProcessOwner = { missionId?: string | null; stepId?: string | null; capabilityRunId?: string | null; dataDirectory?: string; action?: string; records?: OwnedProcessRecord[];
  /** M-A-3 T11: the team Agent that owns the step this process runs for (attribution only; confers no authority). */
  agentId?: string | null;
  /** T9R-F04: provider-session identity. Records go to runtime/provider-sessions instead of runtime/git-operations. */
  provider?: { taskId: string | null; agentId?: string | null; sessionId: string | null; provider: string; hostGeneration: string | null } };
export type OwnedSnapshot = { launcherPid: number; launcherCreatedAt: number; exitCode: number | null; limitFlags: number; members: OwnedProcessIdentity[]; activeProcesses: number; totalProcesses: number; totalTerminatedProcesses: number; /** Listed members that could not be opened or re-verified (diagnostic; accounting is authoritative). */ unverifiedMembers?: number };
type Snapshot = OwnedSnapshot;
type Native = { launch(file: string, line: string, cwd: string, env: string, out: string, err: string, input?: Buffer | true): object; write(group: object, input: Buffer): void; endInput(group: object): void; inspect(group: object): Snapshot; close(group: object): { activeProcesses: number }; terminate(group: object): { activeProcesses: number }; terminateVerified(pid: string, createdAt: string, imageName: string): void };
const root = fileURLToPath(new URL("../../../", import.meta.url));
let loaded: Native | undefined;
/** Integrity is checked before loading native code. Packaged authority comes
 * from the release manifest; a source build must match its current C source. */
export function windowsOwnershipModule(): Native {
  if (process.platform !== "win32" || process.arch !== "x64" || !isMainThread) throw new Error("Windows ownership requires the reviewed Windows x64 Host main thread.");
  if (loaded) return loaded;
  const relative = "native/bunny-owned-process.node", binary = join(root, relative);
  const hash = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
  const proof = JSON.parse(readFileSync(binary + ".json", "utf8"));
  if (proof.schema !== "bunny-native-build/1" || proof.architecture !== "windows-x64" || proof.nodeApi !== 8 || hash(binary) !== proof.binarySha256 || hash(join(root,"native/bunny-owned-process.c")) !== proof.sourceSha256) throw new Error("Windows ownership native build integrity failed; Git was not launched.");
  const manifestPath = join(root,"release-manifest.json");
  if (existsSync(manifestPath)) {
    const manifest = JSON.parse(readFileSync(manifestPath,"utf8"));
    for (const path of [relative, relative + ".json", "native/bunny-owned-process.c"]) {
      if (manifest.files.find((file: {path:string;sha256:string}) => file.path === path)?.sha256 !== hash(join(root,path))) throw new Error("Windows ownership release integrity failed; Git was not launched.");
    }
    if (manifest.compatibility.gitProcessOwnershipPolicyVersion !== 1) throw new Error("Windows ownership policy is missing from the release.");
    // M-A-3 T9R-F04: this helper also contains provider sessions; the release must say it was built for that.
    if (manifest.compatibility.providerProcessContainmentPolicyVersion !== 1) throw new Error("Provider process containment policy is missing from the release.");
  }
  loaded = createRequire(import.meta.url)(binary) as Native;
  return loaded;
}
/** Windows argv quoting (CreateProcess/CommandLineToArgvW conventions), no shell. */
export function windowsArgument(value: string) {
  if (value.includes("\0")) throw new Error("Process arguments cannot contain NUL.");
  return '"' + value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/g, '$1$1') + '"';
}
export function windowsEnvironment(env: NodeJS.ProcessEnv) {
  const unique = new Map<string,[string,string]>();
  for (const [key,value] of Object.entries(env)) {
    if (value === undefined) continue;
    if (key.includes("=") || key.includes("\0") || value.includes("\0")) throw new Error("Invalid process environment.");
    unique.set(key.toUpperCase(),[key,value]);
  }
  return [...unique.values()].sort(([a],[b]) => a.toUpperCase().localeCompare(b.toUpperCase())).map(([key,value]) => `${key}=${value}`).join("\0") + "\0\0";
}
function recordPath(owner: ProcessOwner, id: string) {
  if (!owner.dataDirectory) return null;
  const folder = assertApplicationDirectory(join(owner.dataDirectory,owner.provider ? "runtime/provider-sessions" : "runtime/git-operations"));
  mkdirSync(folder,{recursive:true});return join(folder,id + ".json");
}
function persist(path: string | null, record: OwnedProcessRecord) {
  if (!path) return;
  const temporary=path+".tmp";writeFileSync(temporary,JSON.stringify(record)+"\n",{mode:0o600});renameSync(temporary,path);
}
/** Restart can mark history interrupted, NEVER recreate handles or kill PIDs. */
export function recoverOwnedGitOperations(dataDirectory: string) {
  const folder=assertApplicationDirectory(join(dataDirectory,"runtime/git-operations"));
  if(!existsSync(folder)) return 0;
  let recovered=0;
  for(const name of readdirSync(folder)) {
    if(!/^[0-9a-f-]{36}\.json$/.test(name)) continue;
    const path=join(folder,name),record=JSON.parse(readFileSync(path,"utf8")) as OwnedProcessRecord;
    if(record.schema!=="bunny-owned-operation/1") throw new Error("Unknown Git ownership history schema.");
    if(record.state==="running") {record.state="interrupted";record.endedAt=Date.now();record.closed=true;persist(path,record);recovered++;}
  }
  return recovered;
}
/** T9R-F04 restart: provider-session jobs died with the previous Host's handle (KILL_ON_JOB_CLOSE).
 * Records are marked interrupted and returned so the caller can corroborate member identities against
 * the current process table. Never reopens a job, recreates a handle or kills by PID. */
export type InterruptedProviderSession = Pick<OwnedProcessRecord,"operationId"|"missionId"|"launcherPath"|"launcherPid"|"launcherCreatedAt"|"members"|"startedAt"> & { taskId: string | null; agentId: string | null; provider: string | null; hostGeneration: string | null; containmentBefore: string | null };
export function recoverProviderSessions(dataDirectory: string): InterruptedProviderSession[] { return readProviderSessions(dataDirectory).records; }
/** Readable records to reconcile, plus files that could not be read (each is held as live code and needs review). */
export function readProviderSessions(dataDirectory: string, currentGeneration: string | null = null): { records: InterruptedProviderSession[]; unreadable: string[] } {
  const folder=assertApplicationDirectory(join(dataDirectory,"runtime/provider-sessions"));
  if(!existsSync(folder)) return {records:[],unreadable:[]};
  const recovered: InterruptedProviderSession[]=[],unreadable: string[]=[];
  for(const name of readdirSync(folder)) {
    if(!/^[0-9a-f-]{36}\.json$/.test(name)) continue;
    const path=join(folder,name);let record: OwnedProcessRecord;
    try {
      record=JSON.parse(readFileSync(path,"utf8")) as OwnedProcessRecord;
      const finite=(value: unknown)=>typeof value==="number"&&Number.isFinite(value);
      if(record.schema!=="bunny-owned-operation/1"||!record.containment||typeof record.operationId!=="string"||!/^[0-9a-f-]{36}$/.test(record.operationId)||
        typeof record.launcherPath!=="string"||!finite(record.launcherPid)||!finite(record.launcherCreatedAt)||!Array.isArray(record.members)||
        record.members.some((member)=>!member||!finite(member.pid)||!finite(member.createdAt)||(member.file!==undefined&&typeof member.file!=="string"))) throw new Error("schema");
    } catch { unreadable.push(name); continue; }
    if(record.closed&&(record.containment==="empty"||record.containment==="absent_after_restart"||record.containment==="refused")) continue;
    // This Host's own jobs are live and tracked in memory: a re-read never returns or rewrites them (review round 5).
    if(currentGeneration!==null&&record.hostGeneration===currentGeneration) continue;
    recovered.push({operationId:record.operationId,missionId:record.missionId,launcherPath:record.launcherPath,launcherPid:record.launcherPid,launcherCreatedAt:record.launcherCreatedAt,members:record.members,startedAt:record.startedAt,taskId:record.taskId??null,agentId:record.agentId??null,provider:record.provider??null,hostGeneration:record.hostGeneration??null,containmentBefore:record.containment??null});
    if(!record.closed||record.state==="running"){record.state="interrupted";record.endedAt=Date.now();record.closed=true;persist(path,record);}
  }
  return {records:recovered,unreadable};
}
/** No recorded identity could be checked: kernel kill-on-close still applied, but nothing independent confirms it. */
export function markProviderSessionReview(dataDirectory: string, operationId: string) {
  if(!/^[0-9a-f-]{36}$/.test(operationId)) throw new Error("Invalid provider-session operation id.");
  const path=join(assertApplicationDirectory(join(dataDirectory,"runtime/provider-sessions")),operationId+".json");
  const record=JSON.parse(readFileSync(path,"utf8")) as OwnedProcessRecord;
  record.reviewRequired=true;record.closed=true;persist(path,record);
}
/** After independent corroboration found no recorded member alive, the interrupted record is reconciled. */
export function reconcileProviderSession(dataDirectory: string, operationId: string) {
  if(!/^[0-9a-f-]{36}$/.test(operationId)) throw new Error("Invalid provider-session operation id.");
  const path=join(assertApplicationDirectory(join(dataDirectory,"runtime/provider-sessions")),operationId+".json");
  const record=JSON.parse(readFileSync(path,"utf8")) as OwnedProcessRecord;
  record.containment="absent_after_restart";record.closed=true;persist(path,record);
}
export async function outputPipe(append: (chunk: Buffer) => void) {
  const name=`\\\\.\\pipe\\bunny-owned-${randomUUID()}`;
  const sockets=new Set<Socket>();
  const server=createServer(socket=>{sockets.add(socket);socket.on("data",append);socket.on("error",()=>{});socket.once("close",()=>sockets.delete(socket));});
  await new Promise<void>((done,reject)=>{server.once("error",reject);server.listen(name,done);});
  return {name,close:async()=>{
    // Kill-on-close ends pipe writers first. Bound draining even for broken I/O.
    await new Promise<void>(done=>{
      const timer=setTimeout(()=>{for(const socket of sockets) socket.destroy();done();},1500);
      server.close(()=>{clearTimeout(timer);done();});
    });
  }};
}
/** T9R-F04: Host-run jobs without a session (Python verification, provider probes) count as live code while open (rounds 2-3). */
const hostCodeRuns=new Map<string,string>();
export function liveHostCodeRuns(): string[] { return [...hostCodeRuns].map(([id,action])=>`${action} ${id}`); }
/** One live kernel-backed boundary per operation. The opaque native external
 * never appears in records, IPC, diagnostics or a restart interface. */
export class OwnedProcessGroup {
  private native: Native; private handle: object | null=null;
  private record: OwnedProcessRecord; private path: string | null;
  private release: () => void = () => {};
  private stopping: (() => void) | null=null;
  constructor(file: string,cwd: string,owner: ProcessOwner={}) {
    this.native=windowsOwnershipModule();const operationId=randomUUID();
    this.record={schema:"bunny-owned-operation/1",operationId,containerId:operationId,mechanism:"windows-job-object",missionId:owner.missionId??null,stepId:owner.stepId??null,capabilityRunId:owner.capabilityRunId??null,launcherPath:file,launcherPid:0,launcherCreatedAt:0,members:[],startedAt:Date.now(),endedAt:null,repo:cwd,cwd,action:owner.action??"git",state:"running",exitCode:null,killOnClose:true,breakaway:false,closed:false,
      ...(owner.agentId ? {agentId:owner.agentId} : {}),
      ...(owner.provider ? {...owner.provider,agentId:owner.provider.agentId??null,activeProcesses:null,totalProcesses:null,terminatedAtEnd:null,containment:"running" as const} : {})};
    this.path=recordPath(owner,operationId);owner.records?.push(this.record);
    persist(this.path,this.record);
  }
  /** `input` (T9R-F04): a Buffer is written to the contained root's stdin over an unnamed pipe after it resumes, then
   * closed; `true` keeps a bounded Host-held writer for JSON-RPC probes (`writeInput`/`endInput`). */
  spawn(file: string,args: string[],cwd: string,env: NodeJS.ProcessEnv,out: string,err: string,input?: Buffer | true) {
    if(this.handle) throw new Error("An ownership group can spawn only one root.");
    const line=[file,...args].map(windowsArgument).join(" ");
    try {
      this.handle=input===undefined ? this.native.launch(file,line,cwd,windowsEnvironment(env),out,err) : this.native.launch(file,line,cwd,windowsEnvironment(env),out,err,input);
    } catch(error) {
      // Native launch failures all precede the root's first instruction (T9R-F04 review round 2, L4).
      if(this.record.containment){this.record.containment="refused";this.record.activeProcesses=0;}
      this.close("failed");throw error;
    }
    // A failed post-launch step keeps the handle unless kernel accounting is already 0: the root ran, so the caller must
    // settle the job by accounting (T9R-F04 review round 1, STOP-2) instead of reporting "refused". Every step after the
    // handle exists is inside this guard, so no post-launch throw is ever reported as a launch that never happened (N-C).
    try {
      if(this.record.action.startsWith("verification.")||this.record.action==="provider.probe") hostCodeRuns.set(this.record.operationId,this.record.action);
      this.release=trackOwnedGroup(()=>{if(this.stopping)this.stopping();else this.close("stopped");});
      this.inspect();persist(this.path,this.record);
    } catch(error){
      const launched=Object.assign(error instanceof Error ? error : new Error(String(error)),{launched:true});
      try {if(this.terminate()===0) this.close("failed");} catch { /* the caller settles the still-held job by accounting */ }
      throw launched;
    }
  }
  inspect() {
    if(!this.handle) throw new Error("No live ownership handle.");
    const snapshot=this.native.inspect(this.handle);
    if(snapshot.limitFlags!==0x2000) throw new Error("Git ownership limits changed; breakaway or missing kill-on-close was detected.");
    this.record.launcherPid=snapshot.launcherPid;this.record.launcherCreatedAt=snapshot.launcherCreatedAt;
    this.record.exitCode=snapshot.exitCode;
    let changed=false;
    if(this.record.containment&&(this.record.activeProcesses!==snapshot.activeProcesses||this.record.totalProcesses!==snapshot.totalProcesses)){this.record.activeProcesses=snapshot.activeProcesses;this.record.totalProcesses=snapshot.totalProcesses;}
    for(const member of snapshot.members) if(!this.record.members.some(old=>old.pid===member.pid&&old.createdAt===member.createdAt)){this.record.members.push(member);changed=true;}
    if(changed) persist(this.path,this.record);
    return snapshot;
  }
  close(state: OwnedProcessRecord["state"]) {
    if(this.record.closed)return;
    let active=0;
    if(this.handle){active=this.native.close(this.handle).activeProcesses;this.handle=null;}
    if(this.record.containment&&this.record.containment!=="refused") {this.record.activeProcesses=active;if(this.record.containment!=="unconfirmed")this.record.containment=active===0?"empty":"unconfirmed";}
    hostCodeRuns.delete(this.record.operationId);
    this.release();this.record.state=state;this.record.closed=true;this.record.endedAt=Date.now();persist(this.path,this.record);
  }
  /** T9R-F04: kill every member (orphaned descendants included) and return kernel ActiveProcesses. Keeps the handle. */
  terminate(): number {
    if(!this.handle) return this.record.activeProcesses ?? 0;
    const active=this.native.terminate(this.handle).activeProcesses;
    // Kernel accounting is the result; a failed record write is surfaced by close(), never turned into a false count (review round 5).
    if(this.record.containment){this.record.activeProcesses=active;this.record.containment=active===0?"empty":"terminating";try {persist(this.path,this.record);} catch { /* close() persists again and reports */ }}
    return active;
  }
  writeInput(input: Buffer){if(!this.handle) throw new Error("No live ownership handle.");this.native.write(this.handle,input);}
  endInput(){if(this.handle) this.native.endInput(this.handle);}
  /** T9R-F04: record what kernel accounting says about an attempt's end. */
  annotate(patch: Partial<Pick<OwnedProcessRecord,"terminatedAtEnd"|"containment"|"activeProcesses">>){Object.assign(this.record,patch);persist(this.path,this.record);}
  get live(){return this.handle!==null;}
  inspectHistory(){return structuredClone(this.record);}
  onStop(stop: () => void){this.stopping=stop;}
}
export async function runWindowsOwnedProcess(file: string,args: string[],options: {cwd:string;signal:AbortSignal;timeoutMs:number;maxOutput?:number;env?:NodeJS.ProcessEnv;owner?:ProcessOwner}) {
  if(options.signal.aborted) throw new Error("Aborted before start.");
  const started=Date.now(),max=options.maxOutput??200_000;
  let stdout="",stderr="",timedOut=false,aborted=false;
  const append=(current:string,chunk:Buffer)=>(current+chunk.toString("utf8")).slice(0,max);
  const out=await outputPipe(chunk=>{stdout=append(stdout,chunk);});
  let err: Awaited<ReturnType<typeof outputPipe>> | undefined,group: OwnedProcessGroup | undefined;
  try {
    err=await outputPipe(chunk=>{stderr=append(stderr,chunk);});
    if(options.signal.aborted) throw new Error("Aborted before start.");
    group=new OwnedProcessGroup(file,options.cwd,options.owner);
    group.spawn(file,args,options.cwd,options.env??process.env,out.name,err.name);
    let exitCode:number|null=null;
    await new Promise<void>((done,reject)=>{
      let finished=false;
      const finish=(state:OwnedProcessRecord["state"],error?:unknown)=>{
        if(finished)return;finished=true;clearInterval(poll);clearTimeout(timer);options.signal.removeEventListener("abort",stop);
        try{group!.close(state);}catch(caught){error??=caught;}
        if(error)reject(error);else done();
      };
      const stop=()=>{if(/timed out/i.test(String(options.signal.reason))){timedOut=true;finish("timeout");}else{aborted=true;finish("stopped");}};
      group!.onStop(stop);
      const timer=setTimeout(()=>{timedOut=true;finish("timeout");},Math.max(1,options.timeoutMs-(Date.now()-started)));
      const poll=setInterval(()=>{try{const snapshot=group!.inspect();if(snapshot.exitCode!==null){exitCode=snapshot.exitCode;finish(exitCode===0?"succeeded":"failed");}}catch(error){finish("failed",error);}},40);
      options.signal.addEventListener("abort",stop,{once:true});
      if(options.signal.aborted)stop();
    });
    await Promise.all([out.close(),err.close()]);
    return {exitCode,stdout,stderr,durationMs:Date.now()-started,timedOut,aborted,ownership:group.inspectHistory()};
  } catch(error) {
    group?.close("failed");await Promise.all([out.close(),err?.close()]);throw error;
  }
}
