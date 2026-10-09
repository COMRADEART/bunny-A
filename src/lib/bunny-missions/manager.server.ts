import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { TaskManager } from "../bunny-host/manager.server.ts";
import type { HostEvent } from "../bunny-host/contracts.ts";
import type { Mode, OrchTask, ProviderId, TaskConstraints, VerifySpec } from "../orch/types.ts";
import { codexMissionExclusion } from "../orch/compatibility.ts";
import { ArtifactStore } from "./artifacts.server.ts";
import { agenticFingerprint, agenticOperationDigest, agenticScopeViolation, envelopeFrom, matches, MODE_BUDGET, providerScopeViolation, scopeFor, taskViolation ,
} from "./authorization.server.ts";
import { AgenticStore, digest, fileDigest, rootIdentity } from "./agentic-store.server.ts";
import { AGENTIC_POLICY_VERSION, type AgenticAdjustment, type AgenticAuthorizationEnvelope, type CommandBinding ,
} from "./agentic-types.ts";
import { resolveCommand, type Resolved } from "./capabilities/process.server.ts";
import { canonical, within } from "./paths.server.ts";
import { boundedTestResources } from "./capabilities/bounded-terminal.server.ts";
import { batchActionLabel, batchOffer, batchView, consultBatch, currentBatchEpoch, type BatchPlanEntry ,
} from "./batches.server.ts";
import type { ApprovalBatch, PermissionBatchOffer } from "./types.ts";
import { CapabilityBus, type CapabilityAdapter, type CapabilityRequest ,
} from "./capabilities/bus.server.ts";
import { BrowserCapability } from "./capabilities/browser.server.ts";
import { ComputerCapability } from "./capabilities/computer.server.ts";
import { communicationConnectors, GitHubCapability } from "./capabilities/connectors.server.ts";
import { FilesystemCapability, GitCapability, NotificationsCapability, TerminalCapability ,
} from "./capabilities/local.server.ts";
import { agentPrompt, type DependencyResult } from "./context.ts";
import { Inbox } from "./inbox.server.ts";
import {
  assertMissionTransition, assertStepTransition, blockedBy, classifyTaskFailure, MISSION_ACTIVE, missionProgress, readySteps, retryVerdict, STEP_DONE, validateGraph,
} from "./machine.ts";
import { MissionMemory } from "./memory.server.ts";
import { scopedPath } from "./paths.server.ts";
import { operationContract, crossAppFailure } from "./cross-app.ts";
import { sha256 } from "./artifacts.server.ts";
import { calculatorOperation } from "./batches.server.ts";
import { runsLocally } from "../bunny-host/router.ts";
import { planMission, PLANNER_ID } from "./planner.server.ts";
import { SkillLibrary, fill } from "./skills.server.ts";
import { MissionStore, redact } from "./store.server.ts";
import { TriggerEngine } from "./triggers.server.ts";
import type {
  ActionManifest, AuthorizationEnvelope, CapabilityResult, FailureCategory, Mission, MissionConfig, MissionSnapshot, MissionStep, MissionView,
  PermissionRequest, RemoteAnswer, StepState, Trigger,
} from "./types.ts";
import { APPROVAL_ON_HOST, deviceApprovalRefusal, deviceMayLaunch, isDeviceActor, WorkstationRequiredError, WORKSTATION_ONLY_RISKS,
} from "../bunny-host/device-authority.server.ts";
import { WorkspaceCoordinator } from "./workspace.server.ts";
import { CommandRefusedError, safeError, supervisedLoop, type SafeError ,
} from "../bunny-host/failure.server.ts";
import type { ProjectContextResolver } from "../bunny-host/project-context.server.ts";

const TASK_END = /^task\.(completed|failed|stopped)$/;
const STEP_LIVE: StepState[] = ["running", "verifying"];
const EMPTY_ACCOUNTING = { runtimeMs: 0, externalModelCalls: 0, localModelCalls: 0, deterministicSteps: 0, retries: 0, inputTokens: 0, outputTokens: 0, tokensReported: false ,
};

export type MissionManagerOptions = {
  dataDirectory: string;
  /** Replaces the built-in capability set (tests). */
  adapters?: CapabilityAdapter[];
  browser?: { allowLoopback?: boolean };
};
export type CreateMission = { objective: string; title?: string; mode: Mode; projectId?: string | null; steps?: unknown; localOnly?: boolean; providers?: ProviderId[] | null; origin: string ;
};

/**
 * MissionManager: the layer above TaskManager. It plans a bounded step graph, persists it, asks for one
 * scoped approval, then schedules steps — model steps as ordinary child tasks through TaskManager with a
 * delegated approval inside the envelope, deterministic steps through the Capability Bus. It never calls
 * a provider adapter itself.
 */
export class MissionManager {
  projectContext: ProjectContextResolver | null = null;
  agentic: AgenticStore;
  tasks: TaskManager; store: MissionStore; bus: CapabilityBus; artifacts: ArtifactStore; memory: MissionMemory; inbox: Inbox;
  skills: SkillLibrary; workspace: WorkspaceCoordinator; triggers: TriggerEngine; dataDirectory: string;
  cached: MissionConfig; recovered = false; ticking = new Set<string>(); again = new Set<string>(); pending = new Map<string, ReturnType<typeof setImmediate>>();
  watchdog: ReturnType<typeof setInterval> | null = null; healthTimer: ReturnType<typeof setInterval> | null = null; closed = false;
  stopping = new Set<string>();
  containing = new Set<string>();
  /** M-A-3 T4 additive: admission gate the Agent runtime wires in. Undefined → byte-identical behavior. */
  missionPauseGate: ((missionId: string) => boolean) | null = null;
  loops: { stop: () => void }[] = [];
  listener = (event: HostEvent) => {
    try { this.onHostEvent(event); }
    catch(error) { this.tasks.containment.background({subsystem:"missions",...(event.missionId ? {missionId:event.missionId} : {})},()=>{throw error;},event.missionId ? (error) =>this.containMission(event.missionId!,error) : undefined,event.missionId ? "OPERATION_FAILURE" : "SUBSYSTEM_FAILURE",
      ); }
  };

  constructor(tasks: TaskManager, options: MissionManagerOptions) {
    this.tasks = tasks; this.dataDirectory = options.dataDirectory;
    this.store = new MissionStore(tasks.db);
    this.agentic = new AgenticStore(tasks.db, this.store, tasks.instanceId);
    tasks.missionScopeCheck = (task) => {
      const mission = this.store.mission(task.mission!.missionId);
      const envelope = mission.authorizationId ? this.store.authorization(mission.authorizationId) : null;
      const authority = envelope ? providerScopeViolation(task, envelope, this.store.step(task.mission!.stepId)) : "no approved mission envelope";
      if (authority) return authority;
      const agentic = this.agenticProviderCheck(task);
      if (agentic) return agentic;
      return task.provider === "codex" ? codexMissionExclusion({ id: "codex", securityCompatibility: this.tasks.live().find((provider ) => provider.id === "codex")?.securityCompatibility ,
            }, task.executionScope!.access,
          ) : null;
    };
    this.cached = this.store.config();
    this.artifacts = new ArtifactStore(this.store, options.dataDirectory);
    this.memory = new MissionMemory(this.store);
    this.inbox = new Inbox(this.store);
    this.bus = new CapabilityBus(this.store, this.artifacts, options.dataDirectory, (type, detail, missionId) => this.emit(type, detail, missionId),tasks.containment,
    );
    this.bus.agenticCheck = (request, risk, executable) => this.agenticCheck(request, risk, executable);
    this.bus.resourceValidation = (request,path) => this.projectResourceCheck({ ...request, action: "filesystem.read", params: { path } });
    this.bus.agenticAdmit = (request, _runId, executable) => {
      if (!request.missionId || !this.agentic.exists(request.missionId)) return {};
      try {
        const e = this.agentic.forMission(request.missionId)!;
        const result = this.agentic.admit(e.id, request.envelope?.agentic?.revision ?? -1,
          { agent_id: e.agent_id, mission_id: request.missionId, task_id: null, step_id: request.stepId ?? "", capability: request.action,
            resource_reference: agenticFingerprint(request.action, request.params, request.cwd), attempt_kind: request.stepId && this.store.step(request.stepId).attempts.length > 1? "retry" : "action" ,
          },
          () => { const decision = this.bus.decision(request, executable); return decision.decision === "allow" ? null : decision.reason; },
        );
        return { id: result.admission?.id, reason: result.reason, timeoutMs: Math.max(1, e.expires_at - Date.now()), scriptHash: request.action === "terminal.exec" ? e.commands.find((c ) => c.args.join("\0") === (request.params.args as string[]).join("\0"),
                )?.script_hash : undefined ,
        };
      } catch { return { reason: "Current Agentic authority/revision cannot be validated." }; }
    };
    this.bus.agenticFinish = (id, ok) => this.agentic.finish(id, ok ? "COMPLETED" : "FAILED");
    this.bus.agenticExecutionContext = (request, admissionId, executable) => {
      const e = this.agentic.forMission(request.missionId!)!;
      if (!e.cross_app) return {};
      const target = this.store.calculatorTarget(`mission:${request.missionId}`);
      return {
        crossApp: true,
        browserOrigins: e.browser_origins,
        missionActive: () => {
          try {
            const live = this.agentic.get(e.id)!;
            return (
              ["running", "verifying"].includes(this.store.mission(e.mission_id).state) &&
              ["ACTIVE", "EXHAUSTED"].includes(live.current_state) &&
              live.host_generation === this.tasks.instanceId &&
              live.expires_at > Date.now() &&
              !this.stopping.has(e.mission_id)
            );
          } catch {
            return false;
          }
        },
        ...(request.action.startsWith("computer.")
          ? {
              desktopBatch: {
                expiresAt: e.expires_at,
                ...(target?.identity ? { windowIdentity: target.identity } : {}),
              },
            }
          : {}),
        revalidate: () => {
          try {
            const projectViolation = this.projectResourceCheck(request);
            if (projectViolation) return projectViolation;
            const live = this.agentic.get(e.id)!;
            const admission = this.agentic.rows(e.id).find((row) => row.id === admissionId);
            const mission = this.store.mission(e.mission_id);
            const agent = this.tasks.db.db
              .prepare("SELECT stopped FROM agents WHERE id=?")
              .get(e.agent_id) as { stopped: number } | undefined;
            const envelope = this.currentAgenticCanonical(e.mission_id);
            if (
              !admission ||
              admission.outcome !== "ADMITTED" ||
              admission.capability !== request.action ||
              admission.resource_reference !== agenticFingerprint(request.action, request.params, request.cwd) ||
              admission.step_id !== request.stepId ||
              admission.host_generation !== this.tasks.instanceId ||
              !agent ||
              agent.stopped ||
              !["ACTIVE", "EXHAUSTED"].includes(live.current_state) ||
              live.revision !== admission.revision ||
              live.host_generation !== this.tasks.instanceId ||
              live.expires_at <= Date.now() ||
              !envelope ||
              envelope.id !== live.user_authorization_id ||
              envelope.revokedAt ||
              envelope.agentic?.revision !== live.revision ||
              envelope.expiresAt <= Date.now() ||
              !["running", "verifying"].includes(mission.state) ||
              this.stopping.has(mission.id) ||
              this.agenticPlanReference(mission.id) !== live.plan_reference
            )
              return "Current cross-app admission, target operation or authorization changed; execution paused.";
            const risk = this.bus.riskOf(request.action, request.params) ?? "READ";
            const violation = agenticScopeViolation(
              live,
              request.action,
              request.params,
              risk,
              request.cwd,
              executable,
              request.stepId,
            );
            // Execution revalidation must honor the same exact Host-reviewed filesystem action
            // used by admission. It never widens the standing delegation, or covers another target.
            return violation && this.reviewedFilesystemOnce(request, live, risk) ? null : violation;
          } catch {
            return "Current cross-app execution authority cannot be revalidated.";
          }
        },
      };
    };
    tasks.missionAttemptAdmission = (task, kind) => this.admitAgenticProvider(task, kind);
    tasks.missionAttemptRuntimeLimit = (task) => {
      if (!task.mission || !this.agentic.exists(task.mission.missionId)) return Infinity;
      try {
        return Math.max(
          1,
          this.agentic.forMission(task.mission.missionId)!.expires_at - Date.now(),
        );
      } catch {
        return 1;
      }
    };
    tasks.missionAttemptSettled = (task, ok) => {
      if (!task.mission || !this.agentic.exists(task.mission.missionId)) return;
      const e = this.agentic.forMission(task.mission.missionId)!;
      for (const row of this.agentic
        .rows(e.id)
        .filter((r) => r.task_id === task.id && r.outcome === "ADMITTED"))
        this.agentic.finish(row.id, ok ? "COMPLETED" : "FAILED");
    };
    const adapters = options.adapters ?? [
      new FilesystemCapability(),
      new TerminalCapability(),
      new GitCapability(options.dataDirectory),
      new NotificationsCapability((title, detail, missionId) =>
        this.emit("notification.sent", `${title}${detail ? `\n${detail}` : ""}`, missionId),
      ),
      new BrowserCapability(options.dataDirectory, { headless: this.cached.browserHeadless, allowLoopback: options.browser?.allowLoopback,containment:tasks.containment ,
      }),
      new ComputerCapability(options.dataDirectory, { load: (owner ) => this.store.calculatorTarget(owner), save: (owner, target) => this.store.saveCalculatorTarget(owner, target) ,
      }), new GitHubCapability(), ...communicationConnectors(),
    ];
    for (const adapter of adapters) {
      if (adapter instanceof BrowserCapability) adapter.sessionStorage = { load: (id ) => this.store.browserSession(id), save: (record ) => this.store.saveBrowserSession(record) ,
        };
      this.bus.register(adapter);
    }
    this.skills = new SkillLibrary(this.store, this.bus, (type, detail, missionId) => this.emit(type, detail, missionId),
    );
    this.workspace = new WorkspaceCoordinator(this.store);
    this.triggers = new TriggerEngine(this.store, (type, detail) => this.emit(type, detail, null), (trigger, cause) => this.act(trigger, cause),tasks.containment,
    );
    tasks.workspaceRoots.push(join(options.dataDirectory, "worktrees"));
    tasks.bus.on("event", this.listener);
    // Recovery reconciles persisted execution even while the feature flag is off.
    this.recover(); this.recovered=true;
    if (this.cached.enabled) this.activate();
  }

  // ── configuration / feature flag ──────────────────────────────────────────
  config(): MissionConfig { return this.cached; }
  enabled() { return this.cached.enabled; }
  /** Includes old persisted Mission children that predate the routing constraint. Direct retarget is unchanged. */
  retargetTask(id: string, provider: ProviderId, modelOverride?: string | null) {
    const task = this.tasks.db.get(id);
    if (task.mission && provider === "codex") {
      if (!task.executionScope) throw new Error("Mission retarget has no approved execution scope.");
      const reason = codexMissionExclusion({ id: "codex", securityCompatibility: this.tasks.live().find((live ) => live.id === "codex")?.securityCompatibility ,
        }, task.executionScope.access,
      );
      if (reason) throw new Error(reason);
    }
    // M-A-3 T3 §27: an exact-model pin is forwarded with the retarget; honored only where a real model surface exists (§9).
    if (modelOverride) return this.tasks.retarget(id, provider, modelOverride);
    return this.tasks.retarget(id, provider);
  }
  /** Starts the background parts. Called at construction when enabled, or when the workstation enables missions. */
  activate() {
    if (!this.recovered) { this.recovered = true; this.recover(); }
    this.tasks.containment.background({subsystem:"capability-health"},()=>this.bus.refreshHealth(),undefined,"SUBSYSTEM_FAILURE",
    );
    if(!this.loops.length) {
      this.loops.push(supervisedLoop(this.tasks.containment,{subsystem:"capability-health"},()=>this.bus.refreshHealth(),5*60_000,undefined,"SUBSYSTEM_FAILURE",
        ),
      );
      this.loops.push(supervisedLoop(this.tasks.containment,{subsystem:"missions"},()=>{for(const mission of this.store.missionsIn(["running"])) this.schedule(mission.id);},15_000,undefined,"SUBSYSTEM_FAILURE",
        ),
      );
    }
    this.triggers.start(() => this.cached.enabled && this.cached.triggersEnabled);
  }
  deactivate() {
    if (this.healthTimer) clearInterval(this.healthTimer); if (this.watchdog) clearInterval(this.watchdog);
    this.healthTimer = null; this.watchdog = null; this.triggers.stop();
    for(const loop of this.loops) loop.stop(); this.loops=[];
  }
  configure(patch: Record<string, unknown>, by: string): MissionConfig {
    const next: MissionConfig = { ...this.cached, limits: { ...this.cached.limits } };
    if (patch.enabled !== undefined) { if (typeof patch.enabled !== "boolean") throw new Error("enabled must be true or false."); next.enabled = patch.enabled; }
    if (patch.triggersEnabled !== undefined) { if (typeof patch.triggersEnabled !== "boolean") throw new Error("triggersEnabled must be true or false."); next.triggersEnabled = patch.triggersEnabled; }
    if (patch.browserHeadless !== undefined) { if (typeof patch.browserHeadless !== "boolean") throw new Error("browserHeadless must be true or false."); next.browserHeadless = patch.browserHeadless; }
    const bounds: Record<keyof MissionConfig["limits"], [number, number]> = { maxConcurrentAgents: [1, 6], maxSteps: [1, 20], maxRetriesPerStep: [0, 5], maxReplans: [0, 5], maxMissionRuntimeMs: [60_000, 6 * 3_600_000], maxActiveMissions: [1, 10] ,
    };
    const limits = (patch.limits ?? {}) as Record<string, unknown>;
    for (const [key, value] of Object.entries(limits)) {
      const range = bounds[key as keyof typeof bounds];
      if (!range) throw new Error(`Unknown mission limit ${key}.`);
      if (!Number.isInteger(value) || (value as number) < range[0] || (value as number) > range[1])
        throw new Error(`${key} must be an integer from ${range[0]} to ${range[1]}.`);
      next.limits[key as keyof typeof bounds] = value as number;
    }
    if (process.env.BUNNY_MISSIONS === "0" || process.env.BUNNY_MISSIONS === "1")
      next.enabled = process.env.BUNNY_MISSIONS === "1";
    this.store.saveConfig(next);
    this.cached = next;
    const browser = this.bus.adapters.get("browser") as BrowserCapability | undefined;
    if (browser) browser.headless = next.browserHeadless;
    if (next.enabled) this.activate();
    else this.deactivate();
    this.emit(
      "mission.configured",
      `Missions ${next.enabled ? "enabled" : "disabled"}, triggers ${next.triggersEnabled ? "enabled" : "disabled"} by ${by}. Limits: ${JSON.stringify(next.limits)}.`,
      null,
    );
    return next;
  }
  requireEnabled() {
    this.tasks.containment.assertAccepting("missions");
    if (!this.cached.enabled)
      throw new CommandRefusedError(
        "Missions are disabled on this Host. Direct tasks are unaffected; enable missions in Settings to use them.",
      );
  }

  // ── events ────────────────────────────────────────────────────────────────
  emit(type: string, detail: string, missionId: string | null) {
    if (this.closed) return;
    try {
      this.tasks.emit(this.tasks.db.event(type, null, detail, missionId));
    } catch (error) {
      this.tasks.containment.fatal(error, {
        subsystem: "persistence",
        ...(missionId ? { missionId } : {}),
      });
      throw error;
    }
  }
  onHostEvent(event: HostEvent) {
    if (!this.cached.enabled || this.closed) return;
    try {
      this.inbox.ingest(event);
      if (event.taskId && (TASK_END.test(event.type) || event.type === "approval.accepted"))
        this.inbox.resolveTask(event.taskId);
    } catch (error) {
      this.tasks.containment.background(
        { subsystem: "inbox" },
        () => {
          throw error;
        },
        undefined,
        "SUBSYSTEM_FAILURE",
      );
    }
    if (event.taskId && (TASK_END.test(event.type) || event.type === "approval.accepted")) {
      const step = this.store.stepForTask(event.taskId);
      if (step)
        setImmediate(() =>
          this.tasks.containment.background(
            {
              subsystem: "missions",
              missionId: step.missionId,
              stepId: step.id,
              taskId: event.taskId!,
            },
            async () => {
              if (
                this.closed ||
                this.stopping.has(step.missionId) ||
                this.containing.has(step.missionId)
              )
                return;
              if (event.type === "approval.accepted")
                this.childApprovedDirectly(step.id, event.taskId!);
              else await this.finishModelStep(step.id, event.taskId!);
            },
            (error) => this.containMission(step.missionId, error),
          ),
        );
    }
    if (this.cached.triggersEnabled && !event.type.startsWith("host."))
      this.tasks.containment.background(
        { subsystem: "triggers" },
        () => this.triggers.onEvent(event, true),
        undefined,
        "SUBSYSTEM_FAILURE",
      );
  }

  // ── records ───────────────────────────────────────────────────────────────
  mission(id: string) {
    return this.store.mission(id);
  }
  setMission(mission: Mission, patch: Partial<Mission>, type?: string, detail?: string): Mission {
    const owned = this.store.mission(mission.id);
    if (patch.state && ["completed", "stopped"].includes(owned.state)) return owned;
    mission = owned;
    if (patch.state) assertMissionTransition(mission.state, patch.state);
    const next = { ...mission, ...patch, updatedAt: Date.now() };
    const event = this.tasks.db.transaction(() => {
      this.store.saveMission(next);
      return type ? this.tasks.db.event(type, null, detail ?? "", mission.id) : null;
    });
    if (event) this.tasks.emit(event);
    return next;
  }
  setStep(
    step: MissionStep,
    patch: Partial<MissionStep>,
    type?: string,
    detail?: string,
  ): MissionStep {
    const owned = this.store.step(step.id);
    if (patch.state && ["completed", "stopped", "skipped"].includes(owned.state)) return owned;
    step = owned;
    if (patch.state) assertStepTransition(step.state, patch.state);
    const next = { ...step, ...patch };
    const event = this.tasks.db.transaction(() => {
      this.store.saveStep(next);
      return type
        ? this.tasks.db.event(type, null, `${detail ?? ""} (step ${step.id})`, step.missionId)
        : null;
    });
    if (event) this.tasks.emit(event);
    return next;
  }
  view(mission: Mission): MissionView {
    // Execution inputs remain canonical on the Host. Renderer snapshots do not
    // need typed values, even while an operation is awaiting approval.
    const steps = this.store.steps(mission.id).map((step) =>
      step.executor.kind === "model"
        ? step
        : {
            ...step,
            executor: {
              ...step.executor,
              params: redact({
                ...step.executor.params,
                ...(step.executor.kind === "capability" &&
                step.executor.action === "computer.type" &&
                typeof step.executor.params.text === "string"
                  ? { text: `[${step.executor.params.text.length} characters]` }
                  : {}),
              }) as typeof step.executor.params,
            },
          },
    );
    const requests = this.store
      .requests(mission.id)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 20);
    const artifacts = this.store.artifacts(mission.id).slice(-30);
    const active = this.store.batches(mission.id).find((batch) => batch.status === "active");
    return {
      ...mission,
      steps,
      progress: missionProgress(steps),
      requests,
      artifacts,
      batch: active ? batchView(active, Date.now()) : null,
    };
  }
  get(id: string) {
    const mission = this.store.mission(id);
    return {
      mission: this.view(mission),
      events: this.store.missionEvents(id).slice(-200),
      memory: this.memory.entries(id).slice(-60),
      authorization: mission.authorizationId
        ? this.store.authorization(mission.authorizationId)
        : null,
      runs: this.store.runs({ missionId: id, limit: 50 }),
    };
  }
  snapshot(): MissionSnapshot {
    const capabilities = this.bus.list();
    if (!this.cached.enabled)
      return {
        enabled: false,
        config: this.cached,
        missions: [],
        inbox: [],
        capabilities,
        skills: [],
        triggers: [],
      };
    return {
      enabled: true,
      config: this.cached,
      missions: this.store.missions(15).map((mission) => this.view(mission)),
      inbox: this.inbox.recent(30),
      capabilities,
      skills: this.skills
        .list()
        .map(({ id, version, name, description, status, reliability }) => ({
          id,
          version,
          name,
          description,
          status,
          reliability,
        })),
      triggers: this.store.triggers(),
    };
  }

  // ── create / plan / approve ───────────────────────────────────────────────
  create(input: CreateMission): MissionView {
    this.requireEnabled();
    const objective = input.objective.trim();
    if (!objective || objective.length > 8000)
      throw new Error("Mission objective must be 1–8,000 characters.");
    const project = input.projectId ? this.tasks.projects.forExecution(input.projectId) : null;
    if (input.projectId && !project) throw new Error("Project is not registered on this Host.");
    const now = Date.now();
    const mission: Mission = {
      id: crypto.randomUUID(),
      title: (input.title?.trim() || objective.split("\n")[0]).slice(0, 80),
      objective,
      request: input.objective,
      projectId: project?.id ?? null,
      root: project?.path ?? this.tasks.defaultRoot,
      mode: input.mode,
      state: "draft",
      origin: input.origin,
      createdAt: now,
      updatedAt: now,
      startedAt: null,
      finishedAt: null,
      planning: {
        planner: PLANNER_ID,
        complexity: "simple",
        rationale: [],
        replans: 0,
        plannedAt: null,
      },
      requestedScope: null,
      authorizationId: null,
      capabilityRequirements: [],
      providerConstraints: { allow: input.providers ?? undefined, localOnly: !!input.localOnly },
      budget: MODE_BUDGET[input.mode],
      retryPolicy: { maxRetriesPerStep: this.cached.limits.maxRetriesPerStep },
      verificationRequired: false,
      result: null,
      failure: null,
      recovery: null,
      accounting: { ...EMPTY_ACCOUNTING },
    };
    this.store.saveMission(mission);
    this.emit(
      "mission.created",
      `Mission "${mission.title}" created by ${input.origin} (${mission.mode}).`,
      mission.id,
    );
    return this.view(this.plan(mission, input.steps));
  }
  plan(mission: Mission, explicit?: unknown): Mission {
    let current = this.setMission(
      mission,
      { state: "planning" },
      "mission.planning",
      `Planning with ${PLANNER_ID}.`,
    );
    try {
      const plan = planMission({
        objective: current.objective,
        mode: current.mode,
        root: current.root,
        localOnly: !!current.providerConstraints.localOnly,
        available: (action) => ["available", "degraded"].includes(this.bus.availability(action)),
        limits: this.cached.limits,
        explicit,
      });
      const ids = new Map(plan.steps.map((step) => [step.key, crypto.randomUUID()]));
      const kept = this.store.steps(current.id).filter((step) => step.state === "completed");
      const steps: MissionStep[] = plan.steps.map((draft, index) => ({
        ...(draft.crossApp
          ? {
              crossApp: {
                ...draft.crossApp,
                inputs: draft.crossApp.inputs.map((ref) => ({
                  ...ref,
                  stepId: ids.get(ref.stepId)!,
                })),
              },
            }
          : {}),
        id: ids.get(draft.key)!,
        missionId: current.id,
        index: kept.length + index,
        role: draft.role,
        objective: draft.objective,
        dependsOn: draft.dependsOn.map((key) => ids.get(key)!),
        requiredCapabilities: draft.requiredCapabilities,
        reasoning: draft.reasoning,
        preferences: {
          ...draft.preferences,
          independentOf: draft.preferences.independentOf
            ?.map((key) => ids.get(key)!)
            .filter(Boolean),
        },
        scope: { root: current.root, access: draft.access, isolation: draft.isolation },
        providerConstraints: draft.providerConstraints,
        modelConstraint: draft.modelConstraint,
        executor: draft.executor,
        expectedArtifacts: draft.expectedArtifacts,
        verification: draft.verification,
        maxRetries:
          draft.crossApp &&
          draft.executor.kind === "capability" &&
          operationContract(draft.executor.action)?.replay !== "SAFE_TO_REPLAY"
            ? 0
            : Math.min(
                draft.maxRetries ?? this.cached.limits.maxRetriesPerStep,
                this.cached.limits.maxRetriesPerStep,
              ),
        timeoutMs: draft.timeoutMs,
        weight: draft.weight,
        state: "pending",
        taskId: null,
        capabilityRunId: null,
        workspace: null,
        attempts: [],
        result: null,
        evidence: [],
        failure: null,
        accounting: {
          runtimeMs: 0,
          local: null,
          provider: null,
          model: null,
          inputTokens: null,
          outputTokens: null,
          deterministic: draft.executor.kind !== "model",
        },
        pendingRequestId: null,
        pendingPhase: null,
        approvedOnce: null,
        startedAt: null,
        finishedAt: null,
      }));
      const problem = validateGraph([...kept, ...steps], this.cached.limits);
      if (problem) throw new Error(problem);
      for (const step of steps) {
        if (step.executor.kind === "skill") {
          const skill = this.skills.get(step.executor.skillId);
          if (skill.status !== "active")
            throw new Error(`Skill ${skill.id} is an unverified candidate.`);
        }
        if (step.executor.kind === "capability" && !this.bus.find(step.executor.action))
          throw new Error(`Unknown capability action ${step.executor.action}.`);
        for (const check of step.verification)
          if (check.kind === "capability") {
            const manifest = this.bus.find(check.action)?.manifest;
            if (
              !manifest ||
              this.bus.riskOf(check.action, check.params) !== "READ" ||
              manifest.sensitive ||
              manifest.hardApproval
            )
              throw new Error(
                "Independent verification must be a supported non-sensitive read operation.",
              );
          }
      }
      this.store.replaceSteps(current.id, [...kept, ...steps]);
      const requestedScope = scopeFor(steps, current.root, current.mode, {
        localOnly: current.providerConstraints.localOnly,
        providers: current.providerConstraints.allow ?? null,
        skillSteps: (id) => this.skills.get(id).steps,
      });
      current = this.setMission(
        current,
        {
          state: "waiting_for_approval",
          requestedScope,
          capabilityRequirements: requestedScope.capabilities,
          budget: requestedScope.budget,
          verificationRequired: steps.some((step) => step.verification.length > 0),
          planning: {
            ...current.planning,
            complexity: plan.complexity,
            rationale: plan.rationale,
            plannedAt: Date.now(),
          },
        },
        "mission.planned",
        `${steps.length} step(s): ${steps.map((step) => step.role).join(" → ")}. ${plan.rationale.join(" ")}`,
      );
      this.emit(
        "mission.approval_required",
        `Mission ${current.id} "${current.title}" needs approval: ${requestedScope.riskClasses.join(", ")}; capabilities ${requestedScope.capabilities.join(", ")}; ${requestedScope.providers.execution ? `up to ${requestedScope.budget.maxExternalModelCalls} external model call(s)` : "no model calls"}.`, current.id,
      );
      return current;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return this.setMission(this.store.mission(current.id), { state: "failed", finishedAt: Date.now(), failure: { category: "invalid_plan", detail, stepId: null } ,
        }, "mission.failed", `Planning failed: ${detail}`,
      );
    }
  }
  approve(id: string, by: string, start = true, agenticRevision?: number, planReference?: string): MissionView {
    this.requireEnabled();
    let mission = this.store.mission(id);
    if (mission.state !== "waiting_for_approval" || !mission.requestedScope)
      throw new CommandRefusedError("Mission is not waiting for approval.");
    // M-A-3 T9: a client that reviewed a plan binds its approval to it; a replanned scope is never approved unseen.
    if (planReference !== undefined && planReference !== this.agenticPlanReference(id))
      throw new CommandRefusedError("The plan changed after it was reviewed; review the current plan before approving.");
    if (isDeviceActor(by)) {
      const refusal = this.deviceMissionRefusal(mission);
      if (refusal) throw new WorkstationRequiredError(refusal);
      // M-A-3 T9R: a paired device always approves the exact plan it reviewed; an unbound approval is refused.
      if (planReference === undefined)
        throw new CommandRefusedError("Review the current plan before approving; the approval must name the reviewed plan.");
    }
    const agentic = this.agentic.forMission(id);
    if (agentic) {
      this.agentic.assertRevision(agentic.id, agenticRevision ?? -1);
      if (agentic.plan_reference !== this.agenticPlanReference(id))
        throw new Error("The offered plan changed; fresh exact scope review required.");
      if (agentic.current_state !== "WAITING_FOR_USER")
        throw new Error("Agentic user consent is not pending.");
    }
    const active = this.store.missionsIn(MISSION_ACTIVE).length;
    if (active >= this.cached.limits.maxActiveMissions)
      throw new Error(
        `${active} missions are already active (limit ${this.cached.limits.maxActiveMissions}).`,
      );
    const steps = this.store.steps(id);
    const requestedScope = mission.requestedScope;
    const plannedAuthority = steps
      .filter((step) => step.executor.kind === "model" && step.state !== "completed")
      .map((step) => ({ stepId: step.id, scope: { access: step.scope.access } }));
    if (
      plannedAuthority.length &&
      (!requestedScope.providers.sessions ||
        JSON.stringify(requestedScope.providers.sessions.steps) !==
          JSON.stringify(plannedAuthority))
    )
      throw new Error(
        "Provider execution scope changed or is missing; replan and review the new scope before approval.",
      );
    const extra = steps.some((step) => step.scope.isolation === "worktree")
      ? [join(this.dataDirectory, "worktrees", id.slice(0, 8))]
      : [];
    const envelope = envelopeFrom(
      requestedScope,
      id,
      by,
      this.cached.limits.maxMissionRuntimeMs,
      extra,
    );
    if (agentic) {
      this.agentic.approve(agentic.id, agenticRevision!, envelope.id, by);
      envelope.agentic = { id: agentic.id, revision: agentic.revision };
      envelope.expiresAt = Math.min(envelope.expiresAt, agentic.expires_at);
    }
    this.store.saveAuthorization(envelope);
    this.memory.record(
      id,
      "user_decision",
      "Mission approved",
      `${by} approved ${envelope.riskClasses.join("/")} in ${envelope.projectRoots.join(", ")} until ${new Date(envelope.expiresAt).toISOString()}.`,
      `user:${by}`,
      true,
    );
    this.emit(
      "approval.mission_envelope",
      `Mission envelope ${envelope.id} by ${by}; provider sessions ${JSON.stringify(envelope.providers.sessions)}.`,
      id,
    );
    if (by.startsWith("device:"))
      this.emit(
        "approval.remote_device",
        `Mission envelope ${envelope.id} approved by paired ${by}; same scope as workstation approval.`,
        id,
      );
    mission = this.setMission(
      mission,
      { state: "ready", authorizationId: envelope.id },
      "authorization.granted",
      `Mission authorization ${envelope.id} granted by ${by}: roots ${envelope.projectRoots.join(", ")}; ${envelope.riskClasses.join(", ")}; terminal [${envelope.terminal.commands.join(", ")}]; git [${envelope.git.actions.join(", ")}]; browser ${envelope.browser.enabled ? "on" : "off"}; computer ${envelope.computer.enabled ? "on" : "off"}; expires ${new Date(envelope.expiresAt).toISOString()}.`,
    );
    this.inbox.resolve(id, { kinds: ["requires_approval"] });
    if (start) mission = this.start(mission);
    return this.view(mission);
  }
  start(mission: Mission): Mission {
    this.tasks.containment.assertAccepting("missions");
    this.bus.clearCancellation(mission.id);
    const next = this.setMission(
      mission,
      { state: "running", startedAt: mission.startedAt ?? Date.now() },
      "mission.started",
      `Mission "${mission.title}" started.`,
    );
    this.schedule(next.id);
    return next;
  }

  // ── scheduling ────────────────────────────────────────────────────────────
  schedule(id: string) {
    if (
      this.closed ||
      this.pending.has(id) ||
      this.containing.has(id) ||
      !this.tasks.containment.allows("missions")
    )
      return;
    this.pending.set(
      id,
      setImmediate(() => {
        this.pending.delete(id);
        this.tasks.containment.background(
          { subsystem: "missions", missionId: id },
          () => this.tick(id),
          (error) => this.containMission(id, error),
        );
      }),
    );
  }
  async tick(id: string) {
    if (this.ticking.has(id)) {
      this.again.add(id);
      return;
    }
    this.ticking.add(id);
    try {
      await this.tickOnce(id);
    } catch (error) {
      await this.tasks.containment.contain(error, "boundary", {
        owner: { subsystem: "missions", missionId: id },
        fail: (error) => this.containMission(id, error),
      });
    } finally {
      this.ticking.delete(id);
      if (this.again.delete(id)) this.schedule(id);
    }
  }
  async tickOnce(id: string) {
    let mission = this.store.mission(id);
    if (
      mission.state !== "running" ||
      !this.cached.enabled ||
      this.stopping.has(id) ||
      this.containing.has(id) ||
      !this.tasks.containment.allows("missions")
    )
      return;
    // M-A-3 T4 additive: while the mission's owning agent is paused, no NEW step is admitted; whatever was admitted already finishes.
    if (this.missionPauseGate?.(id)) return;
    const envelope = mission.authorizationId
      ? this.store.authorization(mission.authorizationId)
      : null;
    if (!envelope) {
      await this.failMission(mission, "permission_required", "Mission has no authorization.", null);
      return;
    }
    const limit = Math.min(envelope.budget.maxRuntimeMs, this.cached.limits.maxMissionRuntimeMs);
    if (mission.startedAt && Date.now() - mission.startedAt > limit) {
      await this.failMission(
        mission,
        "budget_exceeded",
        `Mission runtime limit (${Math.round(limit / 60_000)} min) reached.`,
        null,
      );
      return;
    }
    let steps = this.store.steps(id);
    for (const step of readySteps(steps))
      if (step.state === "pending")
        this.setStep(step, { state: "ready" }, "mission.step.ready", `${step.role} is ready.`);
    steps = this.store.steps(id);
    let busy = steps.filter((step) => STEP_LIVE.includes(step.state)).length;
    for (const step of steps.filter((item) => item.state === "ready")) {
      if (busy >= this.cached.limits.maxConcurrentAgents) break;
      try {
        if (await this.launch(mission, this.store.step(step.id), envelope)) busy++;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!/CONTEXT_CHANGED|relink|workspace.*(replaced|identity|unavailable)/i.test(message)) throw error;
        this.askPermission(mission, this.store.step(step.id), "project.context", "READ", "CONTEXT_CHANGED: Project or workspace changed. Review the root and create a fresh Mission plan.", "execute");
        return;
      }
      mission = this.store.mission(id);
      if (mission.state !== "running" || this.stopping.has(id)) return;
    }
    this.evaluate(this.store.mission(id));
  }
  /** Decides whether the mission is finished, failed or waiting, from graph state only. */
  evaluate(mission: Mission) {
    if (mission.state !== "running") return;
    const steps = this.store.steps(mission.id);
    if (steps.every((step) => STEP_DONE.includes(step.state))) {
      this.completeMission(mission, steps);
      return;
    }
    // Pending steps can only be waiting on something; if nothing is running or ready, the mission cannot move by itself.
    const progressing = steps.some(
      (step) => STEP_LIVE.includes(step.state) || step.state === "ready",
    );
    const waiting = steps.filter((step) => step.state === "waiting_for_approval");
    if (progressing) return;
    if (waiting.length) {
      this.setMission(
        mission,
        { state: "waiting_for_user" },
        "mission.waiting_for_user",
        `Mission ${mission.id} is waiting for ${waiting.length} permission decision(s).`,
      );
      return;
    }
    const failed = steps.find((step) => step.state === "failed");
    this.tasks.containment.background(
      { subsystem: "missions", missionId: mission.id },
      () =>
        this.failMission(
          mission,
          failed?.failure?.category ?? "dependency_failed",
          failed
            ? `${failed.role} failed: ${failed.failure?.detail ?? "unknown"}`
            : "No step can run.",
          failed?.id ?? null,
        ),
      (error) => this.containMission(mission.id, error),
    );
  }
  completeMission(mission: Mission, steps: MissionStep[]) {
    const delegation = this.agentic.forMission(mission.id);
    if (delegation && !["REVOKED", "EXPIRED", "COMPLETED"].includes(delegation.current_state))
      this.agentic.state(delegation.id, "COMPLETED");
    let current = this.setMission(
      mission,
      { state: "verifying" },
      "mission.verifying",
      "All steps finished; checking mission-level evidence.",
    );
    const verified = steps.filter((step) => step.result?.verified === true).length;
    const unverified = steps.filter(
      (step) => step.state === "completed" && step.result?.verified !== true,
    ).length;
    const artifactIds = this.store.artifacts(mission.id).map((artifact) => artifact.id);
    const summary = `${steps.length}/${steps.length} steps completed. ${verified} independently verified by Bunny${unverified ? `; ${unverified} completed without independent verification (provider or capability output only)` : ""}.`;
    current = this.setMission(current, { state: "completed", finishedAt: Date.now(), result: { summary, verifiedSteps: verified, unverifiedSteps: unverified, artifactIds }, accounting: this.accounting(current.id) ,
      }, "mission.completed", `Mission "${current.title}": ${summary}`,
    );
    this.workspace.releaseMission(current.id);
    for (const batch of this.store.endMissionBatches(current.id, "mission_ended", "bunny-mission"))
      this.emit("approval.batch_ended", `Small approval batch ended with the mission (${batch.usedCount} / ${batch.maxActions} actions used).`,
        current.id,
      );
    this.memory.record(
      current.id,
      "mission_state",
      "Mission completed",
      summary,
      "bunny:mission",
      true,
    );
  }
  async failMission(
    mission: Mission,
    category: FailureCategory,
    detail: string,
    stepId: string | null,
  ) {
    await this.cancelChildren(mission.id, `Mission failed: ${detail}`);
    const fresh = this.store.mission(mission.id);
    if (!["running", "waiting_for_user", "verifying"].includes(fresh.state)) return;
    this.setMission(
      fresh,
      {
        state: "failed",
        finishedAt: Date.now(),
        failure: { category, detail, stepId },
        accounting: this.accounting(fresh.id),
      },
      "mission.failed",
      `Mission "${fresh.title}" failed (${category}): ${detail}`,
    );
    this.workspace.releaseMission(fresh.id);
    for (const batch of this.store.endMissionBatches(fresh.id, "mission_ended", "bunny-mission"))
      this.emit(
        "approval.batch_ended",
        `Small approval batch ended with the mission (${batch.usedCount} / ${batch.maxActions} actions used).`,
        fresh.id,
      );
  }
  /** A failed scheduler/boundary has no automatic retry policy. Latch scheduling before any await. */
  async containMission(id: string, error: SafeError) {
    if (this.closed || this.containing.has(id) || this.stopping.has(id)) return;
    const mission = this.store.mission(id);
    if (!["running", "verifying", "waiting_for_user", "ready"].includes(mission.state)) return;
    this.containing.add(id);
    this.again.delete(id);
    const pending = this.pending.get(id);
    if (pending) clearImmediate(pending);
    this.pending.delete(id);
    try {
      for (const step of this.store.steps(id))
        if (STEP_LIVE.includes(step.state))
          this.setStep(
            step,
            {
              state: "failed",
              finishedAt: Date.now(),
              failure: { category: "host_failure", detail: error.message },
              attempts: step.attempts.map((attempt, index) =>
                index === step.attempts.length - 1
                  ? {
                      ...attempt,
                      finishedAt: Date.now(),
                      outcome: "failed",
                      category: "host_failure",
                      detail: error.message,
                    }
                  : attempt,
              ),
            },
            "mission.step.failed",
            "Unexpected async boundary failure; automatic retry is refused.",
          );
      await this.cancelChildren(
        id,
        "Unexpected Mission failure; children cancelled without retry.",
      );
      if (!this.stopping.has(id)) {
        let fresh = this.store.mission(id);
        if (fresh.state === "ready") fresh = this.setMission(fresh, { state: "running" });
        if (["running", "verifying", "waiting_for_user"].includes(fresh.state))
          this.setMission(
            fresh,
            {
              state: "failed",
              finishedAt: Date.now(),
              failure: { category: "host_failure", detail: error.message, stepId: null },
            },
            "mission.failed",
            "Unexpected Mission boundary failure; scheduling stopped.",
          );
        for (const batch of this.store.endMissionBatches(id, "mission_ended", "bunny-mission"))
          this.emit(
            "approval.batch_ended",
            `Small approval batch ended with the mission failure (${batch.usedCount} / ${batch.maxActions} actions used).`,
            id,
          );
      }
      this.workspace.releaseMission(id);
    } finally {
      this.containing.delete(id);
    }
  }
  accounting(missionId: string): Mission["accounting"] {
    const steps = this.store.steps(missionId);
    const mission = this.store.mission(missionId);
    const tokens = steps.filter(
      (step) => step.accounting.inputTokens !== null || step.accounting.outputTokens !== null,
    );
    return {
      runtimeMs: steps.reduce((sum, step) => sum + step.accounting.runtimeMs, 0),
      externalModelCalls: mission.accounting.externalModelCalls,
      localModelCalls: mission.accounting.localModelCalls,
      deterministicSteps: steps.filter(
        (step) => step.accounting.deterministic && step.state === "completed",
      ).length,
      retries: steps.reduce((sum, step) => sum + Math.max(0, step.attempts.length - 1), 0),
      inputTokens: tokens.reduce((sum, step) => sum + (step.accounting.inputTokens ?? 0), 0),
      outputTokens: tokens.reduce((sum, step) => sum + (step.accounting.outputTokens ?? 0), 0),
      tokensReported: tokens.length > 0,
    };
  }

  // ── launching steps ───────────────────────────────────────────────────────
  /** Returns true when the step now occupies an agent slot. */
  async launch(
    mission: Mission,
    step: MissionStep,
    envelope: AuthorizationEnvelope,
  ): Promise<boolean> {
    this.tasks.containment.assertAccepting("missions");
    if (mission.projectId) {
      const project = this.tasks.projects.forExecution(mission.projectId);
      if (project.path !== mission.root)
        throw new Error("CONTEXT_CHANGED: Project relink requires a new reviewed Mission plan.");
      const delegation = this.agentic.forMission(mission.id);
      if (delegation && this.projectContext && step.executor.kind !== "model")
        this.projectContext.resolve(project.id, mission.id, step.id, delegation);
    }
    let workspace = step.workspace ?? mission.root;
    if (step.scope.isolation === "worktree" && !step.workspace && step.scope.access === "write") {
      if (!existsSync(join(mission.root, ".git"))) workspace = mission.root;
      else {
        const outcome = await this.bus.request(
          this.capabilityRequest(
            mission,
            step,
            envelope,
            "git.worktree_add",
            {
              name: `${step.role.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 20)}-${step.id.slice(0, 6)}`,
            },
            mission.root,
          ),
        );
        if (this.stopping.has(mission.id) || this.store.mission(mission.id).state !== "running")
          return false;
        if (outcome.decision.decision === "ask") {
          this.askPermission(
            mission,
            step,
            "git.worktree_add",
            outcome.decision.risk,
            outcome.decision.reason,
            "execute",
          );
          return false;
        }
        const path = (outcome.result?.output as { path?: string } | null)?.path;
        if (!outcome.run || outcome.run.status !== "succeeded" || !path) {
          this.stepFailed(
            mission,
            this.markRunning(step, null, null),
            "workspace_conflict",
            `Could not create an isolated worktree: ${outcome.run?.summary ?? "no result"}`,
          );
          return false;
        }
        workspace = path;
        step = this.setStep(
          step,
          { workspace: path },
          "mission.step.workspace",
          `${step.role} isolated in worktree ${path}.`,
        );
      }
    }
    const lock = this.workspace.acquire(
      mission.id,
      step.id,
      workspace,
      step.scope.access === "write" ? "exclusive" : "shared",
    );
    if (!lock.ok) {
      if (!step.evidence.includes(`waiting for workspace ${lock.conflict.root}`))
        this.setStep(
          step,
          { evidence: [...step.evidence, `waiting for workspace ${lock.conflict.root}`] },
          "mission.step.waiting_workspace",
          `${step.role} waits: ${lock.conflict.root} is held ${lock.conflict.mode} by step ${lock.conflict.stepId}.`,
        );
      return false;
    }
    if (step.executor.kind === "model") return this.launchModel(mission, step, envelope, workspace);
    const running = this.markRunning(step, null, null, workspace);
    this.tasks.containment.background(
      { subsystem: "missions", missionId: mission.id, stepId: running.id },
      () => this.runDeterministic(mission.id, running.id, envelope, workspace),
      (error) => this.containMission(mission.id, error),
    );
    return true;
  }
  markRunning(
    step: MissionStep,
    taskId: string | null,
    provider: ProviderId | null,
    workspace?: string,
  ): MissionStep {
    const attempt = {
      attempt: step.attempts.length + 1,
      startedAt: Date.now(),
      finishedAt: null,
      taskId,
      capabilityRunId: null,
      provider,
      outcome: "running" as const,
      category: null,
      detail: "",
    };
    return this.setStep(
      step,
      {
        state: "running",
        startedAt: step.startedAt ?? Date.now(),
        taskId,
        workspace: workspace ?? step.workspace,
        attempts: [...step.attempts, attempt],
        pendingRequestId: null,
        pendingPhase: null,
      },
      "mission.step.started",
      `${step.role} started (attempt ${attempt.attempt}${provider ? `, ${provider}` : step.executor.kind !== "model" ? ", deterministic" : ""}).`,
    );
  }
  dependencyResults(step: MissionStep): DependencyResult[] {
    return step.dependsOn.map((dep) => this.store.step(dep)).map((dep) => {
      const artifactIds = dep.result?.artifactIds ?? [];
      for (const artifactId of artifactIds) { try { this.artifacts.consume(artifactId, step.id); } catch { /* artifact pruned */ } }
      return { role: dep.role, objective: dep.objective, summary: dep.result?.summary ?? "(no summary)", verified: dep.result?.verified ?? null, artifacts: artifactIds.slice(0, 4).map((artifactId) => { try { return this.artifacts.excerpt(artifactId, 900); } catch { return `[artifact ${artifactId} unavailable]`;
            }
          }),
        };
      });
  }
  launchModel(
    mission: Mission,
    step: MissionStep,
    envelope: AuthorizationEnvelope,
    workspace: string,
  ): boolean {
    const usedExternal = mission.accounting.externalModelCalls;
    const budgetLocal = usedExternal >= envelope.budget.maxExternalModelCalls;
    const deny = new Set<ProviderId>(step.providerConstraints.deny ?? []);
    for (const dep of step.preferences.independentOf ?? []) {
      // Independent review: avoid the producing provider when another provider is eligible; recorded either way.
      const producer = this.store.step(dep).accounting.provider;
      if (producer) deny.add(producer);
    }
    const allow =
      envelope.providers.allow && step.providerConstraints.allow
        ? step.providerConstraints.allow.filter((id) => envelope.providers.allow!.includes(id))
        : (envelope.providers.allow ?? step.providerConstraints.allow);
    const repair =
      step.attempts.at(-1)?.category === "verification_failed"
        ? step.attempts.at(-1)!.detail
        : null;
    const delegation = this.agentic.forMission(mission.id);
    const context =
      mission.projectId && delegation && this.projectContext
        ? this.projectContext.resolve(mission.projectId, mission.id, step.id, delegation)
        : null;
    const facts = this.memory.context(mission.id);
    if (context)
      facts.push(
        `Project context reference ${context.id}; version ${context.contextVersion}; references are task data and grant no authority. Repository files are not uploaded automatically.`,
      );
    const prompt = agentPrompt({
      mission,
      step,
      cwd: workspace,
      dependencies: this.dependencyResults(step),
      facts,
      repair,
    });
    const constraints: TaskConstraints = {
      missionAccess: step.scope.access,
      // An agent step works in the approved folder, so it needs a filesystem-capable provider. Only when local
      // execution is required do the step's declared capabilities and its objective decide (text-only local models).
      requiresFilesystem:
        step.scope.access === "write" ||
        step.requiredCapabilities.some((cap) => cap.startsWith("filesystem.")) ||
        !(envelope.providers.localOnly || step.preferences.local || budgetLocal),
      localOnly:
        envelope.providers.localOnly || !!step.preferences.local || budgetLocal || undefined,
      ...(step.modelConstraint ? { modelExact: step.modelConstraint } : {}), // M-A-3 T3 §4: the mission pin routes up-front; the post-submit check below stays as defense-in-depth.
      ...(allow?.length ? { providerAllowlist: allow } : {}),
      ...(deny.size ? { providerDenylist: [...deny] } : {}),
      maxRuntimeMs: Math.max(1000, Math.min(step.timeoutMs, 3_600_000)),
    };
    const spec = step.verification.find((check) => check.kind === "task_spec") as
      { kind: "task_spec"; spec: VerifySpec } | undefined;
    const mode: Mode =
      step.reasoning === "deep" ? "deep" : step.reasoning === "light" ? "fast" : mission.mode;
    let task: OrchTask;
    const submit = (input: TaskConstraints) =>
      this.tasks.submit(
        {
          prompt,
          routingPrompt: step.objective,
          mode,
          projectId: mission.projectId,
          override: "auto",
          constraints: input,
          verify: spec?.spec ?? null,
        },
        {
          missionId: mission.id,
          stepId: step.id,
          cwd: workspace,
          executionScope: { access: step.scope.access },
        },
      );
    try {
      task = submit(constraints);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // An independence preference never makes a step impossible: fall back to any eligible provider and say so.
      if (
        deny.size > (step.providerConstraints.deny?.length ?? 0) &&
        /hard constraints|not eligible/.test(message)
      ) {
        try {
          task = submit({
            ...constraints,
            providerDenylist: step.providerConstraints.deny?.length
              ? step.providerConstraints.deny
              : undefined,
          });
          step = this.setStep(step, {
            evidence: [
              ...step.evidence,
              "Reviewer independence not possible: no other eligible provider; reviewed by the same provider.",
            ],
          });
        } catch (second) {
          this.stepFailed(
            mission,
            this.markRunning(step, null, null, workspace),
            budgetLocal ? "budget_exceeded" : "provider_unavailable",
            second instanceof Error ? second.message : String(second),
          );
          return false;
        }
      } else {
        this.stepFailed(
          mission,
          this.markRunning(step, null, null, workspace),
          budgetLocal ? "budget_exceeded" : "provider_unavailable",
          budgetLocal
            ? `External model budget exhausted and no local provider can do this step: ${message}`
            : message,
        );
        return false;
      }
    }
    if (context && this.projectContext) {
      this.projectContext.bindTask(context.id, task.id);
      task = this.tasks.update(task, { projectContextRef: context.id }, "task.project_context", "Bounded Project context reference attached to this Task.");
    }
    if (step.modelConstraint && task.model !== step.modelConstraint) {
      this.tasks.stopInBackground(
        task.id,
        "Mission step requires a specific model that routing did not select.",
      );
      this.stepFailed(
        mission,
        this.markRunning(step, task.id, task.provider, workspace),
        "provider_unavailable",
        `Step requires model ${step.modelConstraint}; routing selected ${task.model}.`,
      );
      return false;
    }
    const local = runsLocally(
      this.tasks.live().find((provider) => provider.id === task.provider),
      task.model,
    );
    const sessionsUsed = mission.accounting.externalModelCalls + mission.accounting.localModelCalls;
    const violation = taskViolation(
      task,
      envelope,
      local,
      usedExternal,
      Date.now(),
      step,
      sessionsUsed,
    );
    const agenticViolation = this.agenticProviderCheck(task);
    if (violation || agenticViolation) {
      // The child stays waiting_for_approval: the user may approve it directly or through the request.
      this.setStep(
        step,
        { taskId: task.id, workspace },
        "mission.step.child_created",
        `${step.role} child task ${task.id} routed to ${task.provider}.`,
      );
      this.askPermission(
        mission,
        this.store.step(step.id),
        "provider.execute",
        "EXECUTE",
        `${task.provider} for ${step.role}: ${violation ?? agenticViolation}`,
        "execute",
      );
      return false;
    }
    try {
      this.tasks.approveDelegated(task.id, {
        missionId: mission.id,
        stepId: step.id,
        authorizationId: envelope.id,
        check: (child) =>
          taskViolation(
            child,
            envelope,
            runsLocally(
              this.tasks.live().find((provider) => provider.id === child.provider),
              child.model,
            ),
            usedExternal,
            Date.now(),
            this.store.step(step.id),
            sessionsUsed,
          ),
      });
    } catch (error) {
      this.stepFailed(
        mission,
        this.markRunning(step, task.id, task.provider, workspace),
        "provider_unavailable",
        error instanceof Error ? error.message : String(error),
      );
      return false;
    }
    this.countModelCall(mission.id, local);
    this.markRunning(step, task.id, task.provider, workspace);
    return true;
  }
  countModelCall(missionId: string, local: boolean) {
    const mission = this.store.mission(missionId);
    this.setMission(mission, {
      accounting: {
        ...mission.accounting,
        externalModelCalls: mission.accounting.externalModelCalls + (local ? 0 : 1),
        localModelCalls: mission.accounting.localModelCalls + (local ? 1 : 0),
      },
    });
  }
  capabilityRequest(
    mission: Mission,
    step: MissionStep,
    envelope: AuthorizationEnvelope,
    action: string,
    params: Record<string, unknown>,
    cwd: string,
  ): CapabilityRequest {
    if (this.agentic.exists(mission.id))
      envelope = this.currentAgenticCanonical(mission.id) ?? envelope;
    // A one-time allowance covers exactly the path the user saw in the request, nothing around it.
    const once = step.approvedOnce?.action === action && typeof params.path === "string";
    const roots = once
      ? [...envelope.projectRoots, dirname(resolve(cwd, params.path as string))]
      : envelope.projectRoots;
    return {
      action,
      params,
      missionId: mission.id,
      stepId: step.id,
      envelope,
      origin: `mission:${mission.id}`,
      cwd,
      roots,
      oneTimeAction: step.approvedOnce?.action === action ? action : null,
      timeoutMs: step.timeoutMs,
    };
  }
  async runDeterministic(
    missionId: string,
    stepId: string,
    envelope: AuthorizationEnvelope,
    workspace: string,
  ) {
    const mission = this.store.mission(missionId);
    let step = this.store.step(stepId);
    const started = Date.now();
    try {
      let result: {
        ok: boolean;
        summary: string;
        artifactIds: string[];
        runId: string | null;
        category: FailureCategory | null;
        output: unknown;
        permission: { action: string; risk: string; reason: string } | null;
      };
      if (step.executor.kind === "capability") {
        const params = this.crossAppInputs(step);
        const prior = this.store
          .steps(missionId)
          .filter((previous) => step.dependsOn.includes(previous.id))
          .at(-1);
        if (
          prior?.executor.kind === "capability" &&
          prior.executor.action.split(".")[0] !== step.executor.action.split(".")[0]
        )
          this.crossAppEvent("agent.application_handoff", step, {
            from: prior.executor.action.split(".")[0],
            to: step.executor.action.split(".")[0],
          });
        this.crossAppEvent("agent.capability_selected", step, { action: step.executor.action });
        const outcome = await this.bus.request(
          this.capabilityRequest(mission, step, envelope, step.executor.action, params, workspace),
        );
        const status = outcome.run?.status;
        result = {
          ok: status === "succeeded",
          summary: outcome.run?.summary ?? outcome.decision.reason,
          artifactIds: outcome.artifactIds,
          runId: outcome.run?.id ?? null,
          output: outcome.result?.output ?? null,
          permission:
            outcome.decision.decision === "ask"
              ? {
                  action: step.executor.action,
                  risk: outcome.decision.risk,
                  reason: outcome.decision.reason,
                }
              : null,
          category:
            status === "succeeded"
              ? null
              : outcome.result?.cleanup?.ok === false
                ? "permission_required"
                : this.capabilityCategory(outcome.result, status),
        };
      } else if (step.executor.kind === "skill") {
        const run = await this.skills.run(step.executor.skillId, step.executor.params, {
          missionId,
          stepId,
          envelope,
          origin: `mission:${missionId}`,
          cwd: workspace,
          roots: envelope.projectRoots,
          oneTimeAction: step.approvedOnce?.action ?? null,
          timeoutMs: step.timeoutMs,
        });
        result = {
          ok: run.ok,
          summary: run.ok
            ? `Skill ${run.skill} v${run.version} passed: ${run.runs.map((r) => r.summary).join(" · ").slice(0, 600)}`
            : run.permission
              ? run.permission.reason
              : `Skill ${run.skill} v${run.version} failed at ${run.failure?.label}: ${run.failure?.summary}`,
          artifactIds: run.artifactIds,
          runId: run.runs.at(-1)?.id ?? null,
          output: run.outputs.at(-1) ?? null,
          permission: run.permission
            ? {
                action: run.permission.action,
                risk: this.bus.riskOf(run.permission.action, {}) ?? "EXECUTE",
                reason: run.permission.reason,
              }
            : null,
          category: run.ok
            ? null
            : run.failure &&
                ["unavailable", "unconfigured", "unsupported"].includes(run.failure.status)
              ? "capability_unavailable"
              : run.failure?.status === "denied"
                ? "permission_denied"
                : run.failure?.status === "timeout"
                  ? "timeout"
                  : "capability_failed",
        };
      } else return;
      step = this.store.step(stepId);
      if (
        this.closed ||
        step.state !== "running" ||
        this.stopping.has(missionId) ||
        this.containing.has(missionId)
      )
        return; // stopped meanwhile
      const runtimeMs = Date.now() - started;
      step = this.setStep(step, {
        capabilityRunId: result.runId,
        accounting: {
          ...step.accounting,
          runtimeMs: step.accounting.runtimeMs + runtimeMs,
          deterministic: true,
          local: true,
        },
        attempts: step.attempts.map((attempt, index) =>
          index === step.attempts.length - 1
            ? { ...attempt, capabilityRunId: result.runId }
            : attempt,
        ),
      });
      if (result.permission) {
        this.workspace.release(stepId);
        this.askPermission(
          this.store.mission(missionId),
          step,
          result.permission.action,
          result.permission.risk as PermissionRequest["risk"],
          result.permission.reason,
          "execute",
        );
        return;
      }
      if (!result.ok) {
        this.crossAppEvent("agent.capability_failed", step, {
          failure: crossAppFailure(result.category ?? "capability_failed", result.summary),
        });
        this.stepFailed(
          this.store.mission(missionId),
          step,
          step.crossApp &&
            /foreground|focus|target.*changed|window.*changed|uncertain/i.test(result.summary)
            ? "permission_required"
            : (result.category ?? "capability_failed"),
          result.summary,
        );
        return;
      }
      await this.verifyAndComplete(this.store.mission(missionId), step, {
        summary: result.summary,
        artifactIds: result.artifactIds,
        output: result.output,
        task: null,
      });
    } catch (error) {
      const current = this.store.step(stepId);
      if (
        !this.closed &&
        current.state === "running" &&
        !this.stopping.has(missionId) &&
        !this.containing.has(missionId)
      )
        this.stepFailed(
          this.store.mission(missionId),
          current,
          "capability_failed",
          safeError(error).message,
        );
    }
  }
  capabilityCategory(result: CapabilityResult | null, status: string | undefined): FailureCategory {
    if (result?.errorCategory) return result.errorCategory;
    if (status === "denied") return "permission_denied";
    if (status === "timeout") return "timeout";
    if (status === "unavailable" || status === "unconfigured" || status === "unsupported")
      return "capability_unavailable";
    return "capability_failed";
  }

  crossAppEvent(type: string, step: MissionStep, detail: Record<string, unknown>) {
    if (!step.crossApp) return;
    const e = this.agentic.forMission(step.missionId);
    this.emit(
      type,
      JSON.stringify({
        kind: "agent-cross-app",
        agentId: e?.agent_id ?? null,
        missionId: step.missionId,
        stepId: step.id,
        capability:
          step.executor.kind === "capability" ? step.executor.action.split(".")[0] : "provider",
        ...detail,
      }),
      step.missionId,
    );
  }
  crossAppInputs(step: MissionStep): Record<string, unknown> {
    if (step.executor.kind !== "capability") return {};
    const params: Record<string, unknown> = { ...step.executor.params };
    for (const ref of step.crossApp?.inputs ?? []) {
      const dependency = this.store.step(ref.stepId);
      if (
        !step.dependsOn.includes(dependency.id) ||
        dependency.missionId !== step.missionId ||
        dependency.state !== "completed" ||
        dependency.result?.verified !== true ||
        !dependency.result.outputRef
      )
        throw new Error("Cross-app input has no verified canonical dependency output.");
      const { artifact, body } = this.artifacts.get(dependency.result.outputRef);
      if (
        !body ||
        artifact.missionId !== step.missionId ||
        artifact.stepId !== dependency.id ||
        artifact.verification !== "verified" ||
        artifact.sha256 !== sha256(body) ||
        artifact.provenance !== `bunny:capability:${dependency.capabilityRunId}`
      )
        throw new Error("Cross-app artifact hash, ownership or verification changed.");
      const value = JSON.parse(body)[ref.field];
      if (typeof value !== "string" || value.length > 16_000)
        throw new Error("Cross-app data field is missing or exceeds its bounded text contract.");
      params[ref.parameter] = value;
      this.artifacts.consume(artifact.id, step.id);
    }
    return params;
  }

  // T5: consent and accounting are adjuncts of this Mission authority, never a new executor.
  agenticPlanReference(id: string): string {
    return digest(
      this.store
        .steps(id)
        .map((s) => ({
          id: s.id,
          executor: s.executor,
          scope: s.scope,
          verification: s.verification,
          requiredCapabilities: s.requiredCapabilities,
          ...(s.crossApp ? { crossApp: s.crossApp, dependsOn: s.dependsOn } : {}),
        })),
    );
  }
  currentAgenticCanonical(id: string): AuthorizationEnvelope | null {
    const m = this.store.mission(id);
    return m.authorizationId ? this.store.authorization(m.authorizationId) : null;
  }
  syncAgentic(e: AgenticAuthorizationEnvelope): void {
    const canonical = this.currentAgenticCanonical(e.mission_id);
    if (canonical)
      this.store.saveAuthorization({
        ...canonical,
        agentic: { id: e.id, revision: e.revision },
        expiresAt: Math.min(canonical.expiresAt, e.expires_at),
        revokedAt: e.current_state === "REVOKED" ? e.revoked_at : canonical.revokedAt,
      });
  }
  proposeAgentAuthorization(agentId: string, options: AgenticAdjustment = {}) {
    this.requireEnabled();
    const row = this.tasks.db.db
      .prepare("SELECT mission_id,stopped FROM agents WHERE id=?")
      .get(agentId) as { mission_id: string; stopped: number } | undefined;
    if (!row || row.stopped) throw new Error("Unknown or stopped Agent.");
    const mission = this.store.mission(row.mission_id);
    if (mission.state !== "waiting_for_approval" || !mission.requestedScope)
      throw new Error("Review the planned Mission before proposing delegation.");
    const scope = structuredClone(mission.requestedScope);
    const roots = scope.projectRoots.map((root) => canonical(root));
    const commands: CommandBinding[] = [];
    const steps = this.store.steps(mission.id);
    const bind = (command: string, args: string[], cwd: string, timeout: number) => {
      // First bounded family: exact Node test scripts. No eval, loader, shells, npm wrappers or installs.
      if (
        command !== "node" ||
        !Array.isArray(args) ||
        args.length !== 1 ||
        typeof args[0] !== "string" ||
        args[0].startsWith("-") ||
        !/\.(mjs|cjs|js)$/i.test(args[0])
      )
        return;
      try {
        const executable = resolveCommand(command, cwd);
        const script = scopedPath(cwd, args[0], roots);
        if (!executable || !existsSync(script)) return;
        if (args[0].startsWith("..") || /^[A-Za-z]:|^[\\/]/.test(args[0])) return;
        const resources = boundedTestResources(script, cwd, roots);
        commands.push({
          command,
          executable: executable.file,
          executable_hash: fileDigest(executable.file),
          prefix: executable.prefix,
          args,
          cwd: canonical(cwd),
          script,
          script_hash: fileDigest(script),
          timeout_ms: Math.min(timeout, 60_000),
          test_resources: resources,
          boundary: "pure-read-check-v1",
        });
      } catch {
        /* unsupported commands are offered through the separate explicit scope request */
      }
    };
    for (const step of steps) {
      const cwd = step.scope.root ?? mission.root;
      const concrete =
        step.executor.kind === "capability"
          ? [
              {
                action: step.executor.action,
                params: step.executor.params as Record<string, unknown>,
              },
            ]
          : step.executor.kind === "skill"
            ? (() => {
                const skill = this.skills.get(step.executor.skillId);
                const inputs = this.skills.params(skill, step.executor.params);
                return skill.steps.map((s) => ({
                  action: s.action,
                  params: fill(s.params, inputs) as Record<string, unknown>,
                }));
              })()
            : [];
      for (const item of concrete)
        if (item.action === "terminal.exec")
          bind(
            String(item.params.command),
            (item.params.args ?? []) as string[],
            typeof item.params.cwd === "string" ? resolve(cwd, item.params.cwd) : cwd,
            step.timeoutMs,
          );
      for (const check of step.verification)
        if (check.kind === "command")
          bind(check.command, check.args, cwd, check.timeoutMs ?? step.timeoutMs);
    }
    const now = Date.now();
    const duration = Math.min(
      scope.budget.maxRuntimeMs,
      this.cached.limits.maxMissionRuntimeMs,
      7_200_000,
    );
    const crossApp = steps.some((step) => step.crossApp);
    const operations: { stepId: string; action: string; digest: string }[] = [];
    for (const step of steps.filter((step) => step.crossApp)) {
      const concrete: { action: string; params: Record<string, unknown> }[] =
        step.executor.kind === "capability"
          ? [{ action: step.executor.action, params: step.executor.params }]
          : [];
      for (const check of step.verification) {
        if (check.kind === "capability")
          concrete.push({ action: check.action, params: check.params });
        else if (check.kind === "command")
          concrete.push({
            action: "terminal.exec",
            params: { command: check.command, args: check.args, timeoutMs: check.timeoutMs },
          });
        else if (check.kind === "file_exists")
          concrete.push({
            action: check.contains ? "filesystem.read" : "filesystem.exists",
            params: { path: check.path },
          });
        else if (check.kind === "git_diff_nonempty")
          concrete.push({ action: "git.diff", params: {} });
      }
      for (const op of concrete)
        operations.push({
          stepId: step.id,
          action: op.action,
          digest: agenticOperationDigest(op.action, op.params),
        });
    }
    const origins = new Set<string>();
    if (crossApp)
      for (const step of steps) {
        if (!step.crossApp)
          throw new Error(
            "A cross-app consent requires explicit bounded metadata/postconditions on every step.",
          );
        const actions =
          step.executor.kind === "capability"
            ? [
                { action: step.executor.action, params: step.executor.params },
                ...step.verification.flatMap((check) =>
                  check.kind === "capability"
                    ? [{ action: check.action, params: check.params }]
                    : [],
                ),
              ]
            : [];
        for (const op of actions) {
          if (
            !operationContract(op.action) ||
            (op.action.startsWith("computer.") && !calculatorOperation(op.action, op.params))
          )
            throw new Error(
              "Unsupported cross-app operation or application; no authority offered.",
            );
          if (op.action === "browser.navigate") {
            const url = new URL(String(op.params.url));
            if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
              throw new Error("Browser needs a concrete credential-free HTTP origin.");
            origins.add(url.origin);
          }
        }
      }
    if (crossApp && origins.size)
      scope.browser.domains = [...origins].map((origin) => new URL(origin).hostname);
    const caps = [
      ...scope.capabilities,
      ...(scope.providers.execution ? ["provider.execute"] : []),
    ].filter(
      (action) =>
        (action.startsWith("filesystem.") && action !== "filesystem.delete") ||
        ["terminal.exec", "git.status", "git.diff", "git.log", "provider.execute"].includes(
          action,
        ) ||
        (crossApp && !!operationContract(action)),
    );
    const e: AgenticAuthorizationEnvelope = {
      ...(crossApp ? { cross_app: { version: "ma3.cross-app.v1", operations } } : {}),
      id: crypto.randomUUID(),
      policy_version: AGENTIC_POLICY_VERSION,
      agent_id: agentId,
      mission_id: mission.id,
      project_id: mission.projectId,
      user_authorization_id: null,
      authorization_provenance: null,
      proposed_at: now,
      approved_at: null,
      expires_at: now + duration,
      permitted_capabilities: [...new Set(caps)],
      permitted_action_families: [...new Set(caps.map((c) => c.split(".")[0]))],
      permitted_resource_scopes: roots.flatMap((root) => [
        {
          kind: "filesystem" as const,
          root,
          identity: rootIdentity(root),
          operations: caps.filter((c) => c.startsWith("filesystem.")),
        },
        ...(existsSync(join(root, ".git"))
          ? [
              {
                kind: "git" as const,
                root,
                identity: rootIdentity(root),
                operations: caps.filter((c) => c.startsWith("git.")),
              },
            ]
          : []),
      ]),
      commands,
      browser_origins: [...origins],
      risk_ceiling: "EXECUTE",
      maximum_actions: Math.min(1000, Math.max(20, steps.length * 4)),
      maximum_duration: duration,
      maximum_concurrency: crossApp ? 1 : Math.min(8, this.cached.limits.maxConcurrentAgents),
      budget_constraints: {
        maximum_provider_attempts: scope.providers.sessions?.maxSessions ?? 0,
        usage_unknown: "finite-action-budget",
      },
      current_state: "PROPOSED",
      revoked_at: null,
      revision: 1,
      integrity_reference: "",
      host_generation: null,
      scope,
      plan_reference: this.agenticPlanReference(mission.id),
      restart_requires_consent: true,
    };
    this.agentic.propose(e);
    if (Object.keys(options).length) this.agentic.adjust(e.id, 1, options);
    return this.agentic.projection(mission.id);
  }
  adjustAgentAuthorization(missionId: string, revision: number, patch: AgenticAdjustment) {
    const e = this.agentic.forMission(missionId);
    if (!e) throw new Error("No Agentic scope to adjust.");
    const next = this.agentic.adjust(e.id, revision, patch);
    this.syncAgentic(next);
    this.reissueStaleAgenticRequests(missionId, "workstation");
    return this.agentic.projection(missionId);
  }
  // ── M-A-3 T9: paired-device owner-consent boundary ─────────────────────────
  /** Every manifest an envelope capability names: an exact action id, or each action under "capability.*". */
  manifestsFor(capability: string): ActionManifest[] {
    if (capability.endsWith(".*")) {
      const prefix = capability.slice(0, -1);
      return this.bus
        .list()
        .flatMap((adapter) => adapter.actions)
        .filter((action) => action.id.startsWith(prefix));
    }
    const found = this.bus.find(capability);
    return found ? [found.manifest] : [];
  }
  /** Why a paired device may not answer this exact Host ask (allow), or null. Deny is never limited. */
  deviceRequestRefusal(request: PermissionRequest): string | null {
    if (request.action === "provider.execute") {
      // The Host asked because this route exceeds what it can confine; only local tool-free inference launches remotely.
      const step = this.store.step(request.stepId);
      const task = step.taskId ? this.tasks.db.get(step.taskId) : null;
      return task && deviceMayLaunch(task) ? null : APPROVAL_ON_HOST;
    }
    return deviceApprovalRefusal(request.risk, this.bus.find(request.action)?.manifest);
  }
  /** Why a paired device may not approve this pending Mission plan, or null. */
  deviceMissionRefusal(mission: Mission): string | null {
    if (this.agentic.exists(mission.id) || mission.origin.startsWith("agent:"))
      return "Agent Missions are started from their Agent on the Windows Host.";
    const scope = mission.requestedScope;
    if (!scope) return null;
    if (scope.riskClasses.some((risk) => WORKSTATION_ONLY_RISKS.includes(risk))) return APPROVAL_ON_HOST;
    // M-A-3 T9R: a write-scoped provider session includes a shell (writeIncludesShell) the Host cannot confine to
    // the plan. Like a tool-capable direct task (DEV-01), launching one is approved on the Windows Host.
    if (scope.providers.execution && (scope.providers.sessions?.steps ?? []).some((step) => step.scope.access === "write"))
      return APPROVAL_ON_HOST;
    for (const capability of scope.capabilities)
      for (const manifest of this.manifestsFor(capability))
        if (deviceApprovalRefusal(manifest.risk, manifest)) return APPROVAL_ON_HOST;
    return null;
  }
  /**
   * Why a paired device may not answer this Agent's pending consent offer, or null. Initial delegation
   * stays on the Windows Host; post-restart re-consent of the same reviewed scope may be answered remotely
   * within the owner-consent boundary.
   */
  deviceAgenticRefusal(missionId: string): string | null {
    const mission = this.store.mission(missionId);
    if (mission.state === "waiting_for_approval")
      return "Starting an Agent's first delegation requires approval on the Windows Host.";
    const e = this.agentic.forMission(missionId);
    if (!e) return null;
    if (e.cross_app) return APPROVAL_ON_HOST;
    if (WORKSTATION_ONLY_RISKS.includes(e.risk_ceiling)) return APPROVAL_ON_HOST;
    for (const capability of e.permitted_capabilities) {
      // T5 confines Agentic model delegation to tool-free local inference (agenticScopeViolation).
      if (capability === "provider.execute") continue;
      for (const manifest of this.manifestsFor(capability))
        if (deviceApprovalRefusal(manifest.risk, manifest)) return APPROVAL_ON_HOST;
    }
    return null;
  }
  /** Host verdicts for the phone: which pending answers a paired device may give. Projection only. */
  remoteVerdicts(snapshot: MissionSnapshot): MissionSnapshot {
    const verdict = (refusal: string | null): RemoteAnswer => ({ answerable: !refusal, reason: refusal });
    return {
      ...snapshot,
      missions: snapshot.missions.map((mission) => ({
        ...mission,
        ...(mission.state === "waiting_for_approval"
          ? {
              planReference: this.agenticPlanReference(mission.id),
              remote: verdict(this.safeRefusal(() => this.deviceMissionRefusal(mission))),
            }
          : {}),
        requests: mission.requests.map((request) =>
          request.resolvedAt
            ? request
            : { ...request, remote: verdict(this.safeRefusal(() => this.deviceRequestRefusal(request))) },
        ),
      })),
    };
  }
  /** A verdict that cannot be computed is a refusal, never an answerable offer. */
  safeRefusal(check: () => string | null): string | null {
    try {
      return check();
    } catch {
      return APPROVAL_ON_HOST;
    }
  }
  /**
   * M-A-3 T9 (G2): a hold, resume or scope reduction moves the Agentic revision. An open ask stamped with
   * an older revision can never be answered, so the Host closes it (never as a user denial, and without a
   * denial fingerprint) and asks again at the current revision. Nothing is re-stamped in place.
   */
  reissueStaleAgenticRequests(missionId: string, by: string): number {
    const e = this.agentic.forMission(missionId);
    if (!e || e.current_state !== "ACTIVE") return 0;
    let reissued = 0;
    for (const request of this.store.requests(missionId)) {
      if (request.resolvedAt || !request.agentic || request.agentic.revision === e.revision) continue;
      if (request.agentic.generation !== this.tasks.instanceId) continue;
      const step = this.store.step(request.stepId);
      if (step.state !== "waiting_for_approval" || step.pendingRequestId !== request.id) continue;
      this.store.saveRequest({
        ...request,
        resolvedAt: Date.now(),
        resolution: "deny",
        resolvedBy: `${by} (superseded at Agentic revision ${e.revision})`,
      });
      this.inbox.resolve(missionId, { requestId: request.id });
      this.askPermission(
        this.store.mission(missionId),
        step,
        request.action,
        request.risk,
        request.reason,
        step.pendingPhase ?? "execute",
      );
      reissued++;
    }
    if (reissued)
      this.emit(
        "approval.request_reissued",
        `${reissued} pending Agentic request(s) reissued at revision ${e.revision}; superseded asks can no longer be answered.`,
        missionId,
      );
    return reissued;
  }
  reauthorizeAgent(missionId: string, revision: number, actor: string) {
    const e = this.agentic.forMission(missionId);
    if (!e) throw new Error("No historical Agentic authorization.");
    this.agentic.assertRevision(e.id, revision);
    const m = this.store.mission(missionId);
    if (
      m.state !== "waiting_for_user" ||
      e.current_state !== "WAITING_FOR_USER" ||
      e.expires_at <= Date.now()
    )
      throw new Error("Historical consent is not eligible for reviewed reauthorization.");
    if (e.plan_reference !== this.agenticPlanReference(missionId))
      throw new Error("Plan changed; historical scope cannot be reauthorized.");
    for (const root of e.permitted_resource_scopes)
      if (canonical(root.root) !== root.root || rootIdentity(root.root) !== root.identity)
        throw new Error("Approved root changed.");
    for (const command of e.commands)
      if (
        fileDigest(command.script) !== command.script_hash ||
        fileDigest(command.executable) !== command.executable_hash
      )
        throw new Error("Approved command changed.");
    const envelope = envelopeFrom(
      e.scope,
      missionId,
      actor,
      Math.max(1000, e.expires_at - Date.now()),
    );
    envelope.expiresAt = Math.min(envelope.expiresAt, e.expires_at);
    envelope.agentic = { id: e.id, revision };
    // Reviewed canonical consent creates a NEW MA0 authorization; no old executable grant is revived.
    this.agentic.approve(e.id, revision, envelope.id, actor);
    this.store.saveAuthorization(envelope);
    this.setMission(
      m,
      {
        authorizationId: envelope.id,
        recovery: {
          at: Date.now(),
          detail:
            "Fresh scope consent recorded; interrupted/ambiguous effects still require explicit retry review.",
          interruptedSteps: m.recovery?.interruptedSteps ?? [],
        },
      },
      "approval.mission_envelope",
      "Fresh post-restart scope consent; no old request, batch or side effect was replayed.",
    );
    if (e.cross_app) {
      const steps = this.store.steps(missionId);
      const instructions = steps
        .filter(
          (step) =>
            step.failure?.category === "host_restart" &&
            step.crossApp &&
            step.executor.kind === "capability",
        )
        .flatMap<{ stepId: string; mode: "consume" | "resubmit" }>((step) => {
          const run = step.capabilityRunId ? this.store.run(step.capabilityRunId) : null;
          return run?.status === "succeeded" && run.outputRef
            ? [{ stepId: step.id, mode: "consume" as const }]
            : operationContract(step.executor.kind === "capability" ? step.executor.action : "")
                  ?.replay === "SAFE_TO_REPLAY"
              ? [{ stepId: step.id, mode: "resubmit" as const }]
              : [];
        });
      this.tasks.containment.background(
        { subsystem: "agent-runtime", missionId },
        () => this.reconcileInterrupted(missionId, instructions),
        undefined,
        "SUBSYSTEM_FAILURE",
      );
    }
    return this.agentic.projection(missionId);
  }
  agenticIdentityViolation(
    e: AgenticAuthorizationEnvelope,
    missionId: string,
    stepId: string | null,
    revision?: number,
  ): string | null {
    if (e.mission_id !== missionId || e.revision !== revision)
      return "Cross-Mission or stale Agentic authorization revision.";
    const mission = this.store.mission(missionId);
    if (
      mission.projectId !== e.project_id ||
      !["running", "verifying", "waiting_for_user"].includes(mission.state) ||
      this.stopping.has(missionId)
    )
      return "Mission/project is no longer eligible for admission.";
    const agent = this.tasks.db.db
      .prepare("SELECT mission_id,paused,stopped,state FROM agents WHERE id=?")
      .get(e.agent_id) as
      { mission_id: string; paused: number; stopped: number; state: string } | undefined;
    if (
      !agent ||
      agent.mission_id !== missionId ||
      agent.stopped ||
      agent.paused ||
      ["COMPLETED", "FAILED", "STOPPED"].includes(agent.state)
    )
      return "Current Agent identity, Pause or Stop blocks admission.";
    if (
      !stepId ||
      this.store.step(stepId).missionId !== missionId ||
      ["completed", "stopped", "skipped", "failed", "blocked"].includes(
        this.store.step(stepId).state,
      )
    )
      return "No current Task/step authority for this Mission.";
    if (
      e.current_state !== "ACTIVE" ||
      e.host_generation !== this.tasks.instanceId ||
      !e.user_authorization_id ||
      !e.authorization_provenance ||
      mission.authorizationId !== e.user_authorization_id
    )
      return "No current generation of active user-delegated authority.";
    if (e.expires_at <= Date.now()) return "Agentic delegation expired.";
    const envelope = this.currentAgenticCanonical(missionId);
    if (
      !envelope ||
      envelope.revokedAt ||
      envelope.expiresAt <= Date.now() ||
      envelope.agentic?.id !== e.id ||
      envelope.agentic.revision !== e.revision
    )
      return "Canonical Host authority is missing, expired, revoked or stale.";
    const rows = this.agentic.rows(e.id);
    if (rows.length >= e.maximum_actions) return "Agentic action budget exhausted.";
    return null;
  }
  agenticCheck(
    request: CapabilityRequest,
    risk: PermissionRequest["risk"],
    executable?: Resolved | null,
  ): string | null {
    if (!request.missionId || !this.agentic.exists(request.missionId))
      return this.projectResourceCheck(request);
    try {
      const e = this.agentic.forMission(request.missionId)!;
      const identity = this.agenticIdentityViolation(
        e,
        request.missionId,
        request.stepId,
        request.envelope?.agentic?.revision,
      );
      if (identity) return identity;
      if (request.envelope?.agentic?.id !== e.id) return "Cross-Agent envelope replay.";
      // A broad project root must never turn Host consent evidence or credentials into tool data.
      const privateState = (path: string) =>
        [
          "host.sqlite",
          "host.sqlite-wal",
          "host.sqlite-shm",
          "credentials.json",
          "remote.json",
          "state-layout.json",
          "state-retired.json",
          "credentials",
          "settings",
          "runtime",
          "sessions",
          "logs",
          "agentic-terminal",
          "browser-profile",
          "browser-sessions",
        ].some((name) => within(canonical(join(this.dataDirectory, name)), canonical(path)));
      if (
        request.action.startsWith("filesystem.") &&
        privateState(
          resolve(request.cwd, typeof request.params.path === "string" ? request.params.path : "."),
        )
      )
        return "Host credentials, consent database and process records cannot be delegated as project files.";
      if (
        request.action === "terminal.exec" &&
        e.commands.some(
          (command) =>
            command.args.join("\0") === ((request.params.args ?? []) as string[]).join("\0") &&
            (privateState(command.script) || command.test_resources.some(privateState)),
        )
      )
        return "An approved test cannot copy or inspect private Host authority state.";
      if (
        request.action.startsWith("git.") &&
        within(canonical(request.cwd), canonical(this.dataDirectory))
      )
        return "A Git repository containing private Host authority state cannot be delegated.";
      const projectViolation = this.projectResourceCheck(request);
      if (projectViolation) return projectViolation;
      if (
        request.envelope.id !== e.user_authorization_id ||
        request.envelope.missionId !== request.missionId
      )
        return "Request did not use current canonical Mission authority.";
      const plannedStep = this.store.step(request.stepId!);
      if (risk === "WRITE" && plannedStep.scope.access !== "write")
        return "This read-only Task/step has no mutation authority.";
      // Invocation flags are Host-owned conveniences, never self-asserted delegation.
      if (request.direct || request.oneTime || request.oneTimeAction) {
        const reviewed = plannedStep.approvedOnce
          ? this.store.request(plannedStep.approvedOnce.requestId)
          : null;
        if (
          !reviewed ||
          reviewed.resolution !== "allow_once" ||
          reviewed.action !== request.action ||
          reviewed.agentic?.revision !== e.revision ||
          reviewed.agentic.generation !== this.tasks.instanceId ||
          reviewed.agentic.fingerprint !==
            agenticFingerprint(request.action, request.params, request.cwd)
        )
          return "No current Host-reviewed invocation supports these approval flags.";
      }
      const fingerprint = agenticFingerprint(request.action, request.params, request.cwd);
      if (this.agentic.denied(request.missionId, fingerprint))
        return "This resource/operation was explicitly denied; no provider/tool retry is permitted.";
      const violation = agenticScopeViolation(
        e,
        request.action,
        request.params,
        risk,
        request.cwd,
        executable,
        request.stepId,
      );
      if (!violation) return null;
      if (request.action.startsWith("computer.")) {
        const now = Date.now();
        const manifest = this.bus.find(request.action)?.manifest;
        if (manifest && request.envelope)
          for (const batch of this.store.batchesActive(
            request.missionId,
            currentBatchEpoch(),
            now,
          )) {
            if (
              consultBatch(batch, {
                action: request.action,
                params: request.params,
                manifest,
                risk,
                envelope: request.envelope,
                now,
                stepIds: new Set(this.store.steps(request.missionId).map((s) => s.id)),
                stepId: request.stepId,
                epoch: currentBatchEpoch(),
              })?.match
            )
              return null;
          }
      }
      // One reviewed filesystem action can widen that exact resource, never the ongoing envelope.
      if (this.reviewedFilesystemOnce(request, e, risk)) return null;
      return violation;
    } catch {
      return "Agentic authorization integrity, target or identity validation failed closed.";
    }
  }
  private reviewedFilesystemOnce(request: CapabilityRequest, e: AgenticAuthorizationEnvelope, risk: PermissionRequest["risk"]): boolean {
    if (!request.action.startsWith("filesystem.") || !request.stepId) return false;
    const step = this.store.step(request.stepId);
    const once = step.approvedOnce ? this.store.request(step.approvedOnce.requestId) : null;
    return !!(
      step.missionId === request.missionId &&
      once?.missionId === request.missionId &&
      once.stepId === request.stepId &&
      once.resolution === "allow_once" &&
      once.action === request.action &&
      once.risk === risk &&
      once.agentic?.fingerprint === agenticFingerprint(request.action, request.params, request.cwd) &&
      once.agentic.revision === e.revision &&
      once.agentic.generation === this.tasks.instanceId
    );
  }
  private agenticProviderParams(task: OrchTask) {
    return {
      provider: task.provider,
      access: task.executionScope?.access,
      filesystem: !!task.constraints?.requiresFilesystem,
    };
  }
  projectResourceCheck(request: CapabilityRequest): string | null {
    if (!request.missionId || !this.projectContext) return null;
    try {
      const mission = this.store.mission(request.missionId);
      const e = this.agentic.forMission(mission.id);
      if (mission.projectId) {
        const p = this.tasks.projects.forExecution(mission.projectId);
        if (p.path !== mission.root) return "Project context changed; replan after relink.";
      }
      const params = request.params;
      const path = resolve(
        request.cwd,
        typeof params.path === "string"
          ? params.path
          : typeof params.cwd === "string"
            ? params.cwd
            : ".",
      );
      if (
        request.action.startsWith("filesystem.") ||
        request.action.startsWith("git.") ||
        request.action === "terminal.exec"
      ) {
        if (
          ["filesystem.search", "filesystem.list"].includes(request.action) ||
          request.action.startsWith("git.")
        )
          this.projectContext.assertScan(mission.projectId, mission.id, path, e);
        else
          this.projectContext.assertResource(
            mission.projectId,
            mission.id,
            path,
            e,
            request.action === "filesystem.write" && typeof params.content === "string"
              ? Buffer.byteLength(params.content)
              : 0,
          );
      }
      return null;
    } catch {
      return "Project/Agent workspace identity, resource scope or disk bound failed; review context.";
    }
  }
  agenticProviderCheck(task: OrchTask): string | null {
    if (!task.mission || !this.agentic.exists(task.mission.missionId)) return null;
    try {
      const e = this.agentic.forMission(task.mission.missionId)!;
      const envelope = this.currentAgenticCanonical(task.mission.missionId);
      const identity = this.agenticIdentityViolation(
        e,
        task.mission.missionId,
        task.mission.stepId,
        envelope?.agentic?.revision,
      );
      if (!identity && task.projectContextRef && this.projectContext) {
        const context = this.projectContext.load(task.projectContextRef);
        if (context.taskId !== task.id || context.projectId !== task.projectId || context.missionId !== task.mission.missionId || context.stepId !== task.mission.stepId ||
            context.consentReference.id !== e.id || context.consentReference.revision !== e.revision || context.consentReference.generation !== e.host_generation)
          return "CONTEXT_CHANGED: current Task context binding needs review.";
        this.projectContext.revalidate(context);
      }
      return (
        identity ??
        agenticScopeViolation(
          e,
          "provider.execute",
          this.agenticProviderParams(task),
          "EXECUTE",
          task.cwd!,
        )
      );
    } catch (error) {
      return error instanceof Error && error.message.startsWith("CONTEXT_CHANGED") ? error.message : "Agentic model authority cannot be validated.";
    }
  }
  admitAgenticProvider(task: OrchTask, kind: "action" | "retry" | "reroute"): string | null {
    if (!task.mission || !this.agentic.exists(task.mission.missionId)) return null;
    try {
      const e = this.agentic.forMission(task.mission.missionId)!;
      const result = this.agentic.admit(
        e.id,
        this.currentAgenticCanonical(e.mission_id)?.agentic?.revision ?? -1,
        {
          agent_id: e.agent_id,
          mission_id: e.mission_id,
          task_id: task.id,
          step_id: task.mission.stepId,
          capability: "provider.execute",
          resource_reference: agenticFingerprint(
            "provider.execute",
            this.agenticProviderParams(task),
            task.cwd!,
          ),
          attempt_kind: kind,
        },
        () =>
          this.agenticProviderCheck(task) ??
          taskViolation(
            task,
            this.currentAgenticCanonical(e.mission_id)!,
            runsLocally(
              this.tasks.live().find((p) => p.id === task.provider),
              task.model,
            ),
            this.store.mission(e.mission_id).accounting.externalModelCalls,
            Date.now(),
            this.store.step(task.mission!.stepId),
          ),
      );
      return result.reason ?? null;
    } catch {
      return "Agentic admission revision/integrity failed closed.";
    }
  }
  agenticRequestParams(
    step: MissionStep,
    action: string,
    phase: "execute" | "verify",
  ): Record<string, unknown> {
    if (phase === "verify") {
      const operation = step.verification.find(
        (check) => check.kind === "capability" && check.action === action,
      );
      if (operation?.kind === "capability") return operation.params;
      const check = step.verification.find(
        (c) => c.kind === "command" && action === "terminal.exec",
      );
      if (check?.kind === "command")
        return { command: check.command, args: check.args, timeoutMs: check.timeoutMs };
    }
    if (step.executor.kind === "capability") return step.executor.params;
    if (step.executor.kind === "model" && step.taskId)
      return this.agenticProviderParams(this.tasks.db.get(step.taskId));
    return {};
  }

  // ── finishing steps ───────────────────────────────────────────────────────
  childApprovedDirectly(stepId: string, taskId: string) {
    const step = this.store.step(stepId);
    if (step.state !== "waiting_for_approval" || step.taskId !== taskId) return;
    const task = this.tasks.db.get(taskId);
    if (task.approval?.kind === "mission") return;
    if (step.pendingRequestId) {
      const request = this.store.request(step.pendingRequestId);
      if (!request.resolvedAt)
        this.store.saveRequest({
          ...request,
          resolvedAt: Date.now(),
          resolution: "allow_once",
          resolvedBy: "workstation or device (direct task approval)",
        });
    }
    const local = runsLocally(
      this.tasks.live().find((provider) => provider.id === task.provider),
      task.model,
    );
    this.countModelCall(step.missionId, local);
    const lock = this.workspace.acquire(
      step.missionId,
      step.id,
      step.workspace ?? task.cwd ?? this.store.mission(step.missionId).root,
      step.scope.access === "write" ? "exclusive" : "shared",
    );
    if (!lock.ok)
      this.emit(
        "mission.step.workspace_warning",
        `${step.role} was approved directly while ${lock.conflict.root} is held ${lock.conflict.mode} by step ${lock.conflict.stepId}; it runs without exclusive ownership (step ${step.id}).`,
        step.missionId,
      );
    this.markRunning(step, taskId, task.provider);
    const mission = this.store.mission(step.missionId);
    if (this.stopping.has(mission.id)) return;
    if (mission.state === "waiting_for_user")
      this.setMission(
        mission,
        { state: "running" },
        "mission.resumed",
        "A pending child task was approved directly by the user.",
      );
  }
  async finishModelStep(stepId: string, taskId: string) {
    const step = this.store.step(stepId);
    if (step.taskId !== taskId || !["running", "waiting_for_approval"].includes(step.state)) return;
    const mission = this.store.mission(step.missionId);
    const task = this.tasks.db.get(taskId);
    const runtimeMs = Math.max(
      0,
      (task.finishedAt ?? Date.now()) - (task.startedAt ?? task.finishedAt ?? Date.now()),
    );
    const local = runsLocally(
      this.tasks.live().find((provider) => provider.id === task.provider),
      task.model,
    );
    let current = this.setStep(
      step.state === "waiting_for_approval" ? this.setStep(step, { state: "running" }) : step,
      {
        accounting: {
          ...step.accounting,
          runtimeMs: step.accounting.runtimeMs + runtimeMs,
          provider: task.provider,
          model: task.model,
          local,
          deterministic: false,
          inputTokens: task.usage
            ? (step.accounting.inputTokens ?? 0) + task.usage.inputTokens
            : step.accounting.inputTokens,
          outputTokens: task.usage
            ? (step.accounting.outputTokens ?? 0) + task.usage.outputTokens
            : step.accounting.outputTokens,
        },
      },
    );
    if (mission.budget.maxTokens !== null) {
      const used = this.accounting(mission.id);
      if (used.tokensReported && used.inputTokens + used.outputTokens > mission.budget.maxTokens) {
        await this.failMission(
          mission,
          "budget_exceeded",
          `Provider-reported tokens (${used.inputTokens + used.outputTokens}) exceeded the mission ceiling of ${mission.budget.maxTokens}.`,
          step.id,
        );
        return;
      }
    }
    if (task.state !== "completed") {
      this.stepFailed(
        mission,
        current,
        classifyTaskFailure(task.error ?? task.stopReason, task.state),
        task.error ?? task.stopReason ?? `Child task ${task.state}.`,
      );
      return;
    }
    const output = task.output.trim();
    const artifact = await this.artifacts.create({
      missionId: mission.id,
      stepId: step.id,
      type: step.expectedArtifacts[0] ?? "text",
      title: `${step.role} output`,
      inline: output || "(no output)",
      mediaType: "text/plain",
      provenance: `provider:${task.provider}:${task.id}`,
      verification: "unverified",
    });
    this.memory.record(
      mission.id,
      "agent_conclusion",
      `${step.role} conclusion`,
      output.split(/\r?\n/).filter(Boolean).slice(-6).join(" ").slice(0, 1500),
      `provider:${task.provider}:${task.id}`,
      false,
    );
    current = this.store.step(step.id);
    if (this.stopping.has(mission.id) || current.state !== "running") return;
    const summary = (
      output.split(/\r?\n/).filter(Boolean).slice(-4).join(" ") || "Provider produced no output."
    ).slice(0, 1500);
    await this.verifyAndComplete(mission, current, {
      summary,
      artifactIds: [artifact.id],
      output,
      task,
    });
  }
  /** Bunny's own checks after a step reports success. Provider prose is never a check. */
  async verifyAndComplete(
    mission: Mission,
    step: MissionStep,
    result: { summary: string; artifactIds: string[]; output: unknown; task: OrchTask | null },
  ) {
    const interrupted = () =>
      this.closed ||
      this.stopping.has(mission.id) ||
      this.containing.has(mission.id) ||
      !this.tasks.containment.allows("missions");
    if (interrupted()) return;
    const envelope = mission.authorizationId
      ? this.store.authorization(mission.authorizationId)
      : null;
    if (!envelope) {
      this.stepFailed(mission, step, "permission_required", "Authorization missing.");
      return;
    }
    const checks: string[] = [];
    const verificationRunIds: string[] = [];
    let passed = true;
    const executionRun = step.capabilityRunId ? this.store.run(step.capabilityRunId) : null;
    const cwd = step.workspace ?? mission.root;
    if (step.verification.length)
      step = this.setStep(
        step,
        { state: "verifying" },
        "mission.step.verifying",
        `Bunny is checking ${step.role}'s result itself.`,
      );
    for (const check of step.verification) {
      if (check.kind === "capability") {
        const outcome = await this.bus.request(this.capabilityRequest(mission, step, envelope, check.action, check.params, cwd),
        );
        if (interrupted()) return;
        if (outcome.decision.decision === "ask") { this.askPermission(mission, this.store.step(step.id), check.action, outcome.decision.risk, outcome.decision.reason, "verify",
          ); return; }
        if (outcome.run) verificationRunIds.push(outcome.run.id);
        const value = outcome.result?.output && typeof outcome.result.output === "object" ? (outcome.result.output as Record<string, unknown>)[check.expect.field] : undefined;
        const ok = outcome.run?.status === "succeeded" && (Object.hasOwn(check.expect, "equals") ? JSON.stringify(value) === JSON.stringify(check.expect.equals) : typeof value === "string" && value.includes(check.expect.contains!));
        passed &&= ok; result.artifactIds.push(...outcome.artifactIds);
        checks.push(`${check.action} ${check.expect.field}: ${ok ? "passed" : "failed"} (independent capability observation)`,
        );
      } else if (check.kind === "capability_run") {
        const observation = executionRun?.outputRef
          ? this.artifacts.get(executionRun.outputRef)
          : null;
        const output =
          observation?.body && observation.artifact.sha256 === sha256(observation.body)
            ? (JSON.parse(observation.body) as {
                exitCode?: number;
                stdout?: string;
                timedOut?: boolean;
              })
            : null;
        const ok =
          !result.task &&
          executionRun?.action === "terminal.exec" &&
          executionRun.status === "succeeded" &&
          executionRun.missionId === mission.id &&
          executionRun.stepId === step.id &&
          observation?.artifact.provenance === `bunny:capability:${executionRun.id}` &&
          output?.timedOut === false &&
          output.exitCode === check.expectExit &&
          typeof output.stdout === "string" &&
          output.stdout.includes(check.stdoutIncludes);
        passed &&= !!ok;
        checks.push(`Owned terminal exit/output: ${ok ? "passed" : "failed"}`);
      } else if (check.kind === "task_spec") {
        const verification = result.task?.verification;
        const ok = !!verification?.passed;
        passed &&= ok;
        checks.push(
          `task_spec ${check.spec.name}: ${ok ? "passed" : "failed"} — ${verification?.detail ?? "TaskManager did not verify"}`,
        );
      } else if (check.kind === "file_exists") {
        let ok = false;
        let detail = "";
        if (this.agentic.exists(mission.id)) {
          const action = check.contains ? "filesystem.read" : "filesystem.exists";
          const outcome = await this.bus.request(
            this.capabilityRequest(mission, step, envelope, action, { path: check.path }, cwd),
          );
          if (outcome.decision.decision === "ask") {
            this.askPermission(
              mission,
              this.store.step(step.id),
              action,
              outcome.decision.risk,
              outcome.decision.reason,
              "verify",
            );
            return;
          }
          const output = outcome.result?.output as { exists?: boolean; text?: string } | null;
          ok =
            outcome.run?.status === "succeeded" &&
            (check.contains ? !!output?.text?.includes(check.contains) : output?.exists === true);
          detail = `${check.path} ${ok ? "present" : "missing or without the expected text"}`;
        } else
          try {
            const path = scopedPath(cwd, check.path, envelope.projectRoots);
            ok =
              existsSync(path) &&
              (!check.contains || readFileSync(path, "utf8").includes(check.contains));
            detail = `${path} ${ok ? "present" : "missing or without the expected text"}`;
          } catch (error) {
            detail = error instanceof Error ? error.message : String(error);
          }
        passed &&= ok;
        checks.push(`file ${check.path}: ${detail}`);
      } else if (check.kind === "command" || check.kind === "git_diff_nonempty") {
        const action = check.kind === "command" ? "terminal.exec" : "git.diff";
        const params =
          check.kind === "command"
            ? { command: check.command, args: check.args, timeoutMs: check.timeoutMs }
            : {};
        const outcome = await this.bus.request({
          ...this.capabilityRequest(mission, step, envelope, action, params, cwd),
          timeoutMs: check.kind === "command" ? (check.timeoutMs ?? 15 * 60_000) : 60_000,
        });
        if (interrupted()) return;
        if (outcome.decision.decision === "ask") {
          this.askPermission(
            mission,
            this.store.step(step.id),
            action,
            outcome.decision.risk,
            `Verification: ${outcome.decision.reason}`,
            "verify",
          );
          return;
        }
        const ok =
          check.kind === "command"
            ? (outcome.result?.output as { exitCode?: number } | null)?.exitCode ===
              check.expectExit
            : outcome.run?.status === "succeeded" &&
              (outcome.result?.output as { empty?: boolean } | null)?.empty === false;
        passed &&= ok;
        result.artifactIds.push(...outcome.artifactIds);
        checks.push(
          check.kind === "command"
            ? `${check.command} ${check.args.join(" ")}: exit ${(outcome.result?.output as { exitCode?: number } | null)?.exitCode ?? outcome.run?.status ?? "none"} (expected ${check.expectExit})`
            : `git diff: ${ok ? "changes present" : "no changes"}`,
        );
      } else if (check.kind === "artifact") {
        const ok = this.store
          .artifacts(mission.id)
          .some((artifact) => artifact.stepId === step.id && artifact.type === check.type);
        passed &&= ok;
        checks.push(`artifact ${check.type}: ${ok ? "present" : "missing"}`);
      }
    }
    step = this.store.step(step.id);
    if (interrupted() || !["running", "verifying"].includes(step.state)) return;
    if (!passed) {
      this.crossAppEvent("agent.capability_failed", step, {
        failure: "VERIFICATION_FAILED",
        verified: false,
      });
      for (const id of result.artifactIds) {
        try {
          this.artifacts.mark(id, "failed");
        } catch {
          /* pruned */
        }
      }
      this.stepFailed(
        mission,
        step,
        "verification_failed",
        checks
          .filter(
            (line) => !/passed|present|changes present/.test(line) || /failed|missing/.test(line),
          )
          .join("; ") || checks.join("; "),
      );
      return;
    }
    const verified = step.verification.length ? true : null;
    if (verified) {
      for (const id of result.artifactIds) {
        try {
          this.artifacts.mark(id, "verified");
        } catch {
          /* pruned */
        }
      }
      this.memory.record(
        mission.id,
        "verified_fact",
        `${step.role} verified`,
        checks.join("; "),
        `bunny:verification:${step.id}`,
        true,
      );
    }
    const attempts = step.attempts.map((attempt, index) =>
      index === step.attempts.length - 1
        ? { ...attempt, finishedAt: Date.now(), outcome: "completed" as const, detail: "completed" }
        : attempt,
    );
    this.setStep(
      step,
      {
        state: "completed",
        finishedAt: Date.now(),
        attempts,
        result: {
          summary: result.summary,
          artifactIds: result.artifactIds,
          verified,
          verification: checks,
          ...(executionRun?.outputRef
            ? { outputRef: executionRun.outputRef, verificationRunIds }
            : {}),
        },
        failure: null,
        approvedOnce: null,
      },
      "mission.step.completed",
      `${step.role} completed${verified ? " and verified by Bunny" : " (no independent check requested)"}.`,
    );
    this.crossAppEvent("agent.capability_verified", step, {
      verified: verified === true,
      capabilityRunId: executionRun?.id ?? null,
    });
    this.crossAppEvent("agent.cross_app_step_completed", step, {
      verified: verified === true,
      artifactCount: result.artifactIds.length,
    });
    this.workspace.release(step.id);
    this.schedule(mission.id);
  }
  stepFailed(mission: Mission, step: MissionStep, category: FailureCategory, detail: string) {
    const owned = this.store.step(step.id);
    if (
      this.closed ||
      this.stopping.has(mission.id) ||
      this.containing.has(mission.id) ||
      ["completed", "stopped", "skipped", "failed", "blocked"].includes(owned.state)
    )
      return;
    step = owned;
    this.workspace.release(step.id);
    const attempts = step.attempts.length
      ? step.attempts.map((attempt, index) =>
          index === step.attempts.length - 1
            ? {
                ...attempt,
                finishedAt: Date.now(),
                outcome: (category === "user_stopped"
                  ? "stopped"
                  : category === "host_restart"
                    ? "interrupted"
                    : "failed") as "failed",
                category,
                detail: detail.slice(0, 1500),
              }
            : attempt,
        )
      : step.attempts;
    const verdict = retryVerdict(
      category,
      attempts.length,
      step.maxRetries,
      this.accounting(mission.id).retries,
      mission.budget.maxRetries,
    );
    if (verdict.retry) {
      // Reroute only when another provider could take the step; otherwise retry where it is.
      const failedProvider = step.accounting.provider ?? step.attempts.at(-1)?.provider ?? null;
      const alternative =
        failedProvider &&
        this.tasks
          .live()
          .some(
            (p) =>
              p.id !== failedProvider &&
              ["ready", "busy"].includes(p.availability) &&
              p.installed &&
              p.authenticated &&
              !(step.providerConstraints.deny ?? []).includes(p.id),
          );
      const deny =
        verdict.reroute && failedProvider && alternative
          ? [...new Set([...(step.providerConstraints.deny ?? []), failedProvider])]
          : step.providerConstraints.deny;
      this.setStep(step, {
        state: step.state === "running" || step.state === "verifying" ? "failed" : step.state,
        attempts,
      });
      this.setStep(
        this.store.step(step.id),
        {
          state: "ready",
          taskId: null,
          failure: null,
          providerConstraints: { ...step.providerConstraints, deny },
          approvedOnce: null,
        },
        "mission.step.retrying",
        `${step.role} attempt ${attempts.length} failed (${category}): ${detail.slice(0, 300)}. ${verdict.reason}`,
      );
      this.schedule(mission.id);
      return;
    }
    const failed = this.setStep(
      step,
      {
        state: "failed",
        finishedAt: Date.now(),
        attempts,
        failure: { category, detail: detail.slice(0, 2000) },
        approvedOnce: null,
      },
      "mission.step.failed",
      `${step.role} failed (${category}): ${detail.slice(0, 500)}. ${verdict.reason}`,
    );
    if (verdict.waitForUser) {
      const current = this.store.mission(mission.id);
      if (current.state === "running")
        this.setMission(
          current,
          { state: "waiting_for_user" },
          "mission.waiting_for_user",
          `Mission ${mission.id}: ${failed.role} needs you — ${verdict.reason}`,
        );
      return;
    }
    const steps = this.store.steps(mission.id);
    for (const id of blockedBy(steps, failed.id)) {
      const dependent = this.store.step(id);
      if (["pending", "ready"].includes(dependent.state))
        this.setStep(
          dependent,
          {
            state: "blocked",
            failure: { category: "dependency_failed", detail: `${failed.role} failed.` },
          },
          "mission.step.blocked",
          `${dependent.role} blocked: ${failed.role} failed.`,
        );
    }
    this.schedule(mission.id);
  }

  // ── permission requests ───────────────────────────────────────────────────
  /** Gate T9: the Host-computed bounded-batch offer for an execute-phase desktop ask (never verify, never provider steps). */
  batchOfferFor(mission: Mission, step: MissionStep, action: string): PermissionBatchOffer | null {
    const plan: BatchPlanEntry[] = [];
    for (const item of this.store.steps(mission.id)) {
      if (item.executor.kind === "capability") {
        // The ask itself covers this step's execution once; counting it again would double the budget.
        if (item.id === step.id) continue;
        plan.push({
          action: item.executor.action,
          params: item.executor.params as Record<string, unknown>,
          stepId: item.id,
        });
      } else if (item.executor.kind === "skill") {
        try {
          const skill = this.skills.get(item.executor.skillId);
          const inputs = this.skills.params(skill, item.executor.params as Record<string, unknown>);
          for (const skillStep of skill.steps)
            plan.push({
              action: skillStep.action,
              params: fill(skillStep.params, inputs) as Record<string, unknown>,
              stepId: item.id,
            });
        } catch {
          /* invalid skill params fail on their own in the run; the offer is only for healthy plans */
        }
      }
    }
    // The ask's concrete target: the capability step's own params, or the first plan instance of
    // the asking action inside a skill step (skill input params are not concrete actions).
    if (step.executor.kind === "skill" && !plan.some((entry) => entry.action === action))
      return null;
    const askParams =
      step.executor.kind === "capability"
        ? (step.executor.params as Record<string, unknown>)
        : (plan.find((entry) => entry.action === action)?.params ?? {});
    if (step.executor.kind === "skill") {
      // For a skill ask, the ask and the matching plan entry are the same execution — cover it once.
      const matched = plan.findIndex(
        (entry) =>
          entry.action === action && JSON.stringify(entry.params) === JSON.stringify(askParams),
      );
      if (matched >= 0) plan.splice(matched, 1);
    }
    return batchOffer({
      askAction: action,
      askParams,
      askStepId: step.id,
      plan,
      find: (candidate) => this.bus.find(candidate)?.manifest ?? null,
      riskOf: (candidate, params) => this.bus.riskOf(candidate, params),
    });
  }
  askPermission(
    mission: Mission,
    step: MissionStep,
    action: string,
    risk: PermissionRequest["risk"],
    reason: string,
    phase: "execute" | "verify",
  ) {
    const delegation = this.agentic.forMission(mission.id);
    const params = this.agenticRequestParams(step, action, phase);
    const fingerprint = delegation
      ? agenticFingerprint(action, params, step.workspace ?? mission.root)
      : null;
    if (fingerprint && this.agentic.denied(mission.id, fingerprint)) {
      this.stepFailed(
        mission,
        step,
        "permission_denied",
        "This exact resource/operation was denied; another provider cannot retry it.",
      );
      return;
    }
    let batchOffer: PermissionBatchOffer | null = null;
    // The user's standing "ask every time" rule outranks batching: asking for permission is the
    // point of that rule, so a batch button would only produce asks it can never rescue.
    if (phase === "execute" && !/ask every time/.test(reason)) {
      try {
        batchOffer = this.batchOfferFor(mission, step, action);
      } catch {
        batchOffer = null;
      }
    }
    const request: PermissionRequest = {
      id: crypto.randomUUID(),
      missionId: mission.id,
      stepId: step.id,
      action,
      risk,
      reason,
      createdAt: Date.now(),
      resolvedAt: null,
      resolution: null,
      resolvedBy: null,
      batchOffer,
    };
    if (delegation && fingerprint) {
      const resource =
        typeof params.path === "string"
          ? params.path
          : typeof params.command === "string"
            ? `${params.command} ${Array.isArray(params.args) ? params.args.join(" ") : ""}`
            : action;
      request.agentic = {
        fingerprint,
        revision: delegation.revision,
        generation: this.tasks.instanceId,
        resource: `${resource} in ${step.workspace ?? mission.root}`,
      };
      this.agentic.audit("agent.scope_expansion_requested", delegation, {
        requestId: request.id,
        action,
        risk,
        fingerprint,
      });
    }
    this.store.saveRequest(request);
    this.workspace.release(step.id);
    this.setStep(
      step,
      { state: "waiting_for_approval", pendingRequestId: request.id, pendingPhase: phase },
      "mission.permission_required",
      `Mission ${mission.id} request ${request.id}: ${step.role} needs permission for ${action} (${risk}): ${reason}`,
    );
    this.schedule(mission.id);
  }
  /** Gate T9: create the batch strictly from the stored Host-computed offer; client data may only shrink it. */
  createBatchFromOffer(
    missionId: string,
    stepId: string,
    requestId: string,
    by: string,
    options: { maxActions?: number; ttlMs?: number } = {},
  ): ApprovalBatch {
    const mission = this.store.mission(missionId);
    const request = this.store.request(requestId);
    const step = this.store.step(stepId);
    if (!request.batchOffer) throw new Error("This request has no approval batch offer.");
    // No resolvedAt check here: respond() is the sole caller — it verified the request was open
    // before resolving it with allow_batch (that entry check is the double-answer protection).
    const envelope = mission.authorizationId
      ? this.store.authorization(mission.authorizationId)
      : null;
    if (!envelope)
      throw new Error("The mission has no live authorization to grant a batch inside.");
    if (envelope.revokedAt) throw new Error("The mission authorization was revoked.");
    if (envelope.expiresAt <= Date.now())
      throw new Error(
        "The mission authorization expired; approve the mission again to grant a fresh batch.",
      );
    if (["completed", "failed", "stopped"].includes(mission.state))
      throw new Error("The mission has already ended.");
    const offer = request.batchOffer;
    const currentOffer = this.batchOfferFor(mission, step, request.action);
    if (!currentOffer || JSON.stringify(currentOffer) !== JSON.stringify(offer))
      throw new Error("The planned batch changed; a new approval is required.");
    if (
      this.store
        .grants()
        .some(
          (grant) =>
            grant.policy === "ask_every_time" &&
            matches([grant.action], request.action) &&
            (grant.scope === "global" || grant.scope === `mission:${missionId}`),
        )
    )
      throw new Error("A standing ask every time rule prevents batching.");
    const maxActions = Math.max(
      1,
      Math.min(
        Number.isInteger(options.maxActions) ? options.maxActions! : offer.maxActions,
        offer.maxActions,
      ),
    );
    const ttlMs = Math.max(
      1000,
      Math.min(Number.isInteger(options.ttlMs) ? options.ttlMs! : offer.ttlMs, offer.ttlMs),
    );
    const batch: ApprovalBatch = {
      id: crypto.randomUUID(),
      missionId: mission.id,
      authorizationId: envelope.id,
      family: offer.family,
      actions: [...offer.actions],
      riskCeiling: offer.riskCeiling,
      target: offer.target,
      targetTier: offer.targetTier,
      maxActions,
      usedCount: 0,
      observedPid: null,
      observedPidFrom: null,
      batchEpoch: currentBatchEpoch(),
      createdAt: Date.now(),
      createdBy: by,
      expiresAt: Date.now() + ttlMs,
      status: "active",
      endAt: null,
      endReason: null,
      endBy: null,
      originStepId: step.id,
      operations: offer.operations,
    };
    this.store.saveBatch(batch);
    // Truthful duration: seconds in, seconds out (the ttl is clamped to 1 s … 2 min by createBatchFromOffer).
    const ttlWords = ttlMs >= 60_000 ? `${ttlMs / 60_000} min` : `${Math.round(ttlMs / 1000)} s`;
    this.emit(
      "approval.batch_started",
      `Small approval batch granted by ${by} for ${offer.targetLabel}: at most ${maxActions} mutating actions within ${ttlWords}; covers ${offer.actions.map(batchActionLabel).join(", ")}${offer.readOnly.length ? `; read-only also covers ${offer.readOnly.map(batchActionLabel).join(", ")}` : ""}. It ends at the limit, at expiry, on Stop, on a target mismatch, or with the mission.`, mission.id,
    );
    return batch;
  }
  /** Gate T9: the user revokes the active batch; future covered actions ask for fresh approval. */
  revokeBatch(id: string, batchId: string, by: string): MissionView {
    this.requireEnabled();
    const batch = this.store.batch(batchId);
    if (!batch || batch.missionId !== id) throw new Error("Unknown approval batch for this mission.");
    if (batch.status === "ended") throw new Error("The approval batch has already ended.");
    this.store.endBatch(batchId, "revoked", by);
    this.emit("approval.batch_ended", `Small approval batch revoked by ${by} (${batch.usedCount} / ${batch.maxActions} actions used); subsequent desktop actions ask for fresh approval.`,
      id,
    );
    return this.view(this.store.mission(id));
  }
  async respond(
    requestId: string,
    decision: "allow_once" | "allow_batch" | "deny",
    by: string,
    options: { maxActions?: number; ttlMs?: number } = {},
  ) {
    this.requireEnabled();
    const request = this.store.request(requestId);
    if (request.resolvedAt) throw new CommandRefusedError("This request was already answered.");
    const step = this.store.step(request.stepId);
    if (step.state !== "waiting_for_approval" || step.pendingRequestId !== requestId)
      throw new CommandRefusedError("The step is no longer waiting for this request.");
    // M-A-3 T9: a paired device answers only within the owner-consent boundary; deny is always available.
    if (isDeviceActor(by) && decision !== "deny") {
      const refusal = this.deviceRequestRefusal(request);
      if (refusal) throw new WorkstationRequiredError(refusal);
    }
    if (this.agentic.exists(request.missionId)) {
      const e = this.agentic.forMission(request.missionId)!;
      if (e.current_state === "PAUSED")
        throw new CommandRefusedError("The Agent is paused; resume it, then answer the reissued request.");
      if (
        !request.agentic ||
        request.agentic.revision !== e.revision ||
        request.agentic.generation !== this.tasks.instanceId
      )
        throw new CommandRefusedError("Agentic scope request is stale; fresh Host review is required.");
      if (decision === "deny") {
        this.agentic.deny(request.missionId, request.agentic.fingerprint);
        this.agentic.audit("agent.action_denied", e, { requestId, action: request.action });
      }
      // T5 never converts broad target/shell approval into general delegation. The explicit one-off
      // remains subordinate to its exact Host-offered resource fingerprint and the shared budget.
    }
    // A refusal, not a failure: nothing was applied, so the phone must not treat it as an uncertain outcome.
    if (decision === "allow_batch" && !request.batchOffer)
      throw new CommandRefusedError(
        "This request does not offer a small approval batch; answer allow_once or deny.",
      );
    // Validate and create before answering: a failed validation leaves the request open.
    if (decision === "allow_batch")
      this.createBatchFromOffer(request.missionId, step.id, requestId, by, options);
    this.store.saveRequest({
      ...request,
      resolvedAt: Date.now(),
      resolution: decision,
      resolvedBy: by,
    });
    this.inbox.resolve(request.missionId, { requestId });
    this.inbox.resolve(request.missionId, { kinds: ["requires_attention"] });
    this.memory.record(
      request.missionId,
      "user_decision",
      `${request.action} ${decision === "allow_once" ? (step.executor.kind === "skill" ? "allowed for this skill run" : "allowed once") : decision === "allow_batch" ? `allowed as a small batch (${request.batchOffer?.maxActions} actions for ${request.batchOffer?.targetLabel})` : "denied"}`, `${by}: ${request.reason}`,
      `user:${by}`,
      true,
    );
    this.emit(
      "approval.additional_capability",
      `${request.action} ${decision} by ${by}; request ${requestId}; scope ${decision === "allow_batch" ? `one small bounded batch (${request.batchOffer?.maxActions} actions, target ${request.batchOffer?.targetLabel})` : step.executor.kind === "skill" ? "this skill run, matching action within approved roots" : "this action"}.`, request.missionId,
    );
    if (by.startsWith("device:")) this.emit("approval.remote_device", `Additional request ${requestId} answered by paired ${by}: ${decision}.`,
        request.missionId,
      );
    let mission = this.store.mission(request.missionId);
    if (mission.state === "waiting_for_user")
      mission = this.setMission(
        mission,
        { state: "running" },
        "mission.resumed",
        `${by} answered request ${requestId}.`,
      );
    this.emit(
      decision === "deny" ? "authorization.denied" : "authorization.granted",
      `${request.action} for step ${step.id}: ${decision} by ${by} (request ${requestId}).`,
      request.missionId,
    );
    if (decision === "allow_batch") {
      // The batch must exist before the step resumes so the resumed execution is covered (and counted).
      this.setStep(step, { state: "ready", pendingRequestId: null, pendingPhase: null });
      this.schedule(mission.id);
      return this.view(this.store.mission(mission.id));
    }
    if (decision === "deny") {
      // The step is failed first, so the child's own stop event finds nothing left to finalize.
      this.stepFailed(
        mission,
        this.setStep(step, { state: "running" }),
        "permission_denied",
        `${by} denied ${request.action}.`,
      );
      if (step.taskId && this.tasks.db.get(step.taskId).state === "waiting_for_approval")
        await this.tasks
          .stop(step.taskId, "Mission permission denied by the user.")
          .catch(() => {});
      return this.view(this.store.mission(mission.id));
    }
    if (request.action === "provider.execute" && step.taskId) {
      // Explicit user approval of that child task. If the provider stopped being eligible meanwhile,
      // the step fails honestly instead of staying stuck behind an answered request.
      try {
        this.tasks.approve(step.taskId, by);
      } catch (error) {
        const current = this.store.step(step.id);
        if (current.state === "waiting_for_approval")
          this.stepFailed(
            this.store.mission(mission.id),
            this.markRunning(current, step.taskId, this.tasks.db.get(step.taskId).provider),
            "provider_unavailable",
            error instanceof Error ? error.message : String(error),
          );
      }
      return this.view(this.store.mission(mission.id));
    }
    if (step.pendingPhase === "verify") {
      const running = this.setStep(step, {
        state: "running",
        approvedOnce: { requestId, action: request.action },
        pendingRequestId: null,
        pendingPhase: null,
      });
      const task = running.taskId ? this.tasks.db.get(running.taskId) : null;
      const previous = running.result;
      this.tasks.containment.background(
        { subsystem: "missions", missionId: mission.id, stepId: running.id },
        () =>
          this.verifyAndComplete(mission, running, {
            summary: previous?.summary ?? running.evidence.at(-1) ?? "",
            artifactIds:
              previous?.artifactIds ??
              this.store
                .artifacts(mission.id)
                .filter((a) => a.stepId === running.id)
                .map((a) => a.id),
            output: null,
            task,
          }),
        (error) => this.containMission(mission.id, error),
      );
      return this.view(this.store.mission(mission.id));
    }
    this.setStep(step, {
      state: "ready",
      approvedOnce: { requestId, action: request.action },
      pendingRequestId: null,
      pendingPhase: null,
    });
    this.schedule(mission.id);
    return this.view(this.store.mission(mission.id));
  }

  // ── stop / retry / replan ─────────────────────────────────────────────────
  async cancelChildren(missionId: string, detail: string) {
    await this.bus.cancel({ missionId });
    for (const step of this.store.steps(missionId)) {
      if (step.taskId) {
        const task = (() => {
          try {
            return this.tasks.db.get(step.taskId!);
          } catch {
            return null;
          }
        })();
        // Only this mission's own child tasks are stopped; Stop isolation of the TaskManager is reused unchanged.
        if (
          task &&
          task.mission?.missionId === missionId &&
          !["completed", "failed", "stopped"].includes(task.state)
        )
          await this.tasks.stop(task.id, detail).catch(() => {});
      }
    }
  }
  async stop(id: string, by: string): Promise<MissionView> {
    const mission = this.store.mission(id);
    if (["completed", "stopped"].includes(mission.state))
      throw new Error("Mission has already ended.");
    if (this.stopping.has(id)) throw new Error("Mission Stop is already in progress.");
    this.stopping.add(id);
    try {
      const delegation = this.agentic.forMission(id);
      if (
        delegation &&
        !["REVOKED", "EXPIRED", "EXHAUSTED", "COMPLETED"].includes(delegation.current_state)
      )
        this.agentic.state(delegation.id, "REVOKED");
    } catch {
      this.emit(
        "agent.action_denied",
        "Corrupt Agentic authority remains blocked; Stop still cancels admitted work.",
        id,
      );
    }
    const activeRuns = new Set(
      this.store.runs({ missionId: id, status: "running", limit: 500 }).map((run) => run.id),
    );
    try {
      await this.cancelChildren(id, `Mission stopped by ${by}.`);
      for (const batch of this.store.endMissionBatches(id, "mission_ended", by))
        this.emit(
          "approval.batch_ended",
          `Small approval batch ended because the mission stopped by ${by} (${batch.usedCount} / ${batch.maxActions} actions used); no further covered action will run.`,
          id,
        );
      for (const step of this.store.steps(id))
        if (!["completed", "skipped", "stopped", "failed"].includes(step.state)) {
          const attempts = step.attempts.map((attempt, index) =>
            index === step.attempts.length - 1 && attempt.outcome === "running"
              ? {
                  ...attempt,
                  finishedAt: Date.now(),
                  outcome: "stopped" as const,
                  category: "user_stopped" as const,
                  detail: `Stopped by ${by}`,
                }
              : attempt,
          );
          this.setStep(step, {
            state: "stopped",
            finishedAt: Date.now(),
            attempts,
            failure: { category: "user_stopped", detail: `Stopped by ${by}.` },
          });
        }
      for (const request of this.store.requests(id))
        if (!request.resolvedAt)
          this.store.saveRequest({
            ...request,
            resolvedAt: Date.now(),
            resolution: "deny",
            resolvedBy: `${by} (mission stopped)`,
          });
      this.workspace.releaseMission(id);
      this.inbox.resolve(id);
      const cleanupFailures = this.store
        .runs({ missionId: id, limit: 500 })
        .filter((run) => activeRuns.has(run.id) && run.cleanup?.ok === false);
      const cleanupDetail = cleanupFailures.length
        ? ` Cleanup needs attention: ${cleanupFailures.map((run) => run.cleanup!.detail).join(" ")}`
        : " Active capability cleanup finished.";
      const stopped = this.setMission(
        this.store.mission(id),
        {
          state: "stopped",
          finishedAt: Date.now(),
          failure: {
            category: "user_stopped",
            detail: `Stopped by ${by}.${cleanupDetail}`,
            stepId: null,
          },
          accounting: this.accounting(id),
        },
        "mission.stopped",
        `Mission "${mission.title}" stopped by ${by}; child tasks stopped, nothing will be retried.${cleanupDetail}`,
      );
      return this.view(stopped);
    } finally {
      this.stopping.delete(id);
    }
  }
  retry(id: string, by: string): MissionView {
    this.requireEnabled();
    let mission = this.store.mission(id);
    if (!["failed", "waiting_for_user"].includes(mission.state))
      throw new Error("Only failed or waiting missions can be retried.");
    const envelope = mission.authorizationId
      ? this.store.authorization(mission.authorizationId)
      : null;
    if (!envelope || envelope.revokedAt || envelope.expiresAt <= Date.now())
      throw new Error(
        "The mission authorization expired or was revoked; replan to approve it again.",
      );
    const steps = this.store.steps(id);
    const failed = steps.filter((step) => step.state === "failed");
    if (!failed.length && !steps.some((step) => step.state === "blocked"))
      throw new Error("No failed step to retry.");
    for (const step of failed) {
      // Explicit retries are still bounded: at most twice the automatic per-step limit plus one.
      if (step.attempts.length > step.maxRetries * 2 + 1)
        throw new Error(
          `${step.role} reached its attempt ceiling (${step.attempts.length}); replan instead.`,
        );
      this.setStep(
        step,
        { state: "ready", failure: null, taskId: null, approvedOnce: null },
        "mission.step.retrying",
        `${by} retried ${step.role}${step.failure?.category === "host_restart" ? " as a fresh child task (the interrupted provider stream is not resumed)" : ""}.`,
      );
    }
    for (const step of this.store.steps(id))
      if (step.state === "blocked") this.setStep(step, { state: "pending", failure: null });
    if (mission.state === "failed")
      mission = this.setMission(
        mission,
        { state: "ready", failure: null, finishedAt: null },
        "mission.retry",
        `${by} retried ${failed.length} failed step(s).`,
      );
    if (mission.state === "ready") mission = this.start(mission);
    else {
      this.bus.clearCancellation(id);
      mission = this.setMission(
        mission,
        { state: "running", failure: null },
        "mission.retry",
        `${by} retried ${failed.length} failed step(s).`,
      );
      this.schedule(id);
    }
    return this.view(mission);
  }
  async replan(
    id: string,
    by: string,
    explicit?: unknown,
    objective?: string,
  ): Promise<MissionView> {
    this.requireEnabled();
    const mission = this.store.mission(id);
    if (!["waiting_for_approval", "waiting_for_user", "failed"].includes(mission.state))
      throw new Error(
        "Replanning is possible while waiting for approval, waiting for you, or after a failure.",
      );
    if (this.store.steps(id).some((step) => STEP_LIVE.includes(step.state)))
      throw new Error("Steps are still running; stop them first.");
    if (mission.planning.replans >= this.cached.limits.maxReplans)
      throw new Error(`Replan limit (${this.cached.limits.maxReplans}) reached.`);
    await this.cancelChildren(id, "Mission is being replanned.");
    if (mission.authorizationId) {
      const envelope = this.store.authorization(mission.authorizationId);
      if (envelope && !envelope.revokedAt)
        this.store.saveAuthorization({ ...envelope, revokedAt: Date.now() });
    }
    for (const request of this.store.requests(id))
      if (!request.resolvedAt)
        this.store.saveRequest({
          ...request,
          resolvedAt: Date.now(),
          resolution: "deny",
          resolvedBy: `${by} (replanned)`,
        });
    for (const batch of this.store.endMissionBatches(id, "revoked", by))
      this.emit(
        "approval.batch_ended",
        `Small approval batch revoked with the replanned mission (${batch.usedCount} / ${batch.maxActions} actions used).`,
        id,
      );
    this.workspace.releaseMission(id);
    const base = this.setMission(
      mission,
      {
        objective: objective?.trim() || mission.objective,
        authorizationId: null,
        failure: null,
        finishedAt: null,
        planning: { ...mission.planning, replans: mission.planning.replans + 1 },
      },
      "mission.replanning",
      `${by} replanned the mission; the previous authorization was revoked and a new approval is required.`,
    );
    return this.view(this.plan(base, explicit));
  }

  /**
   * M-A-3 T4 additive: one canonical, bounded reconciliation pass over an interrupted mission, driven
   * by the Agent runtime's replay classification. ALL step and mission writes stay inside MissionManager.
   * "consume" re-runs only Bunny's own verification of an already-completed child task (never the
   * effect); "resubmit" re-admits once under the existing attempt ceiling and envelope.
   */
  async reconcileInterrupted(
    missionId: string,
    instructions: { stepId: string; mode: "consume" | "resubmit" }[],
  ): Promise<Record<string, unknown>[]> {
    if (
      this.agentic.exists(missionId) &&
      this.agentic.forMission(missionId)?.current_state !== "ACTIVE"
    )
      return [];
    const results: Record<string, unknown>[] = [];
    for (const instruction of instructions) {
      const step = this.store.steps(missionId).find((item) => item.id === instruction.stepId);
      if (!step) {
        results.push({ stepId: instruction.stepId, applied: false, reason: "Unknown step." });
        continue;
      }
      // Only unreconciled Host-restart interruptions are touched, and never a step that still holds an
      // approval decision or a one-time approval — old authority never revives (A15).
      if (
        !["failed", "blocked"].includes(step.state) ||
        step.failure?.category !== "host_restart" ||
        step.pendingRequestId ||
        step.approvedOnce
      ) {
        results.push({
          stepId: instruction.stepId,
          applied: false,
          reason: `Step is ${step.state}; not an unreconciled Host-restart interruption.`,
        });
        continue;
      }
      if (instruction.mode === "resubmit") {
        if (step.state === "blocked")
          this.setStep(
            step,
            { state: "pending", finishedAt: null, failure: null },
            "mission.step.recovered",
            `${step.role} unblocked for one bounded re-admission after the Host restart (read-only replay).`,
          );
        const fresh = this.store.step(instruction.stepId);
        this.setStep(
          fresh,
          { state: "ready", finishedAt: null, failure: null },
          "mission.step.recovered",
          `${step.role} re-admitted once after the Host restart (read-only replay within the attempt ceiling).`,
        );
        results.push({ stepId: instruction.stepId, applied: true, replay: "requeue_once" });
        continue;
      }
      const task = step.taskId ? this.tasks.db.get(step.taskId) : null;
      const capability =
        step.crossApp && step.capabilityRunId ? this.store.run(step.capabilityRunId) : null;
      if (
        capability?.status === "succeeded" &&
        capability.outputRef &&
        capability.missionId === missionId &&
        capability.stepId === step.id
      ) {
        const { artifact, body } = this.artifacts.get(capability.outputRef);
        if (
          !body ||
          sha256(body) !== artifact.sha256 ||
          artifact.provenance !== `bunny:capability:${capability.id}` ||
          artifact.missionId !== missionId ||
          artifact.stepId !== step.id
        )
          throw new Error("Canonical recovery output integrity failed.");
        this.setStep(
          step,
          { state: "ready", finishedAt: null, failure: null },
          "mission.step.recovered",
          "Consume a canonical capability result; repeat only independent postconditions.",
        );
        const running = this.markRunning(this.store.step(step.id), null, null);
        const mission = this.setMission(
          this.store.mission(missionId),
          { state: "running", recovery: null },
          "mission.recovered",
          "Recheck the completed capability without repeating its effect.",
        );
        await this.verifyAndComplete(mission, running, {
          summary: capability.summary,
          artifactIds: capability.artifactIds,
          output: JSON.parse(body),
          task: null,
        });
        results.push({ stepId: step.id, applied: true, replay: "verify_then_consume" });
        continue;
      }
      if (!task || task.state !== "completed") {
        results.push({
          stepId: instruction.stepId,
          applied: false,
          reason: "Canonical child truth is not a completed task; nothing is consumed.",
        });
        continue;
      }
      this.setStep(
        step,
        { state: "ready", finishedAt: null, failure: null },
        "mission.step.recovered",
        `${step.role} reconciliation: the child task's canonical result is consumed.`,
      );
      const running = this.markRunning(this.store.step(instruction.stepId), step.taskId, task.provider,
      );
      const mission = this.setMission(this.store.mission(missionId), { state: "running", recovery: null }, "mission.recovered", `Reconciliation re-armed ${step.role} to consume child task ${task.id} without re-executing its effect.`,
      );
      await this.verifyAndComplete(mission, running, {
        summary: `Canonical result of child task ${task.id} consumed after a Host restart.`,
        artifactIds: [],
        output: task.output,
        task,
      });
      results.push({
        stepId: instruction.stepId,
        applied: true,
        replay: step.verification.length ? "verify_then_consume" : "consume_result",
      });
    }
    // The mission lands running only when nothing else needs the user; missions disabled keeps it parked.
    const current = this.store.mission(missionId);
    const pending = this.store.steps(missionId);
    const needsUser =
      pending.some((step) => step.state === "waiting_for_approval") ||
      pending.some((step) => ["failed", "blocked"].includes(step.state));
    if (
      current.state === "waiting_for_user" &&
      !needsUser &&
      this.cached.enabled &&
      !this.stopping.has(missionId)
    ) {
      this.setMission(
        current,
        { state: "running", recovery: null },
        "mission.recovered",
        "Recovery reconciliation finished; scheduling continues under the same envelope.",
      );
      this.schedule(missionId);
    }
    return results;
  }

  // ── recovery after a Host restart ─────────────────────────────────────────
  recover() {
    const now = Date.now();
    for (const batch of this.store.endAllActiveBatches("host_restart", "bunny-host-restart", now))
      this.emit(
        "approval.batch_ended",
        `Small approval batch ended because the Host restarted; no desktop action from the previous run is resumed (${batch.usedCount} / ${batch.maxActions} actions used).`,
        batch.missionId,
      );
    for (const run of this.store.runs({ status: "running", limit: 500 }))
      this.store.saveRun({
        ...run,
        status: "interrupted",
        summary: "Host restarted while this capability ran; it was not resumed.",
        finishedAt: now,
      });
    for (const mission of this.store.missionsIn([
      "running",
      "verifying",
      "waiting_for_user",
      "ready",
      "planning",
    ])) {
      this.workspace.releaseMission(mission.id);
      if (mission.state === "planning") {
        this.setMission(
          mission,
          {
            state: "failed",
            finishedAt: now,
            failure: {
              category: "host_restart",
              detail: "Host restarted during planning.",
              stepId: null,
            },
          },
          "mission.failed",
          "Host restarted during planning; replan to continue.",
        );
        continue;
      }
      const interrupted: string[] = [];
      for (const step of this.store.steps(mission.id)) {
        // A renderer may retain an old request ID across a Host restart. Neither that ID nor
        // a one-time decision waiting to execute may create authority in the new process.
        if (
          step.pendingRequestId ||
          (step.approvedOnce && ["ready", "running", "verifying"].includes(step.state))
        ) {
          if (step.pendingRequestId) {
            const request = this.store.request(step.pendingRequestId);
            if (!request.resolvedAt)
              this.store.saveRequest({
                ...request,
                resolvedAt: now,
                resolution: "deny",
                resolvedBy: "bunny-host-restart",
              });
          }
          this.setStep(
            step,
            {
              state: step.state === "ready" ? "blocked" : "failed",
              finishedAt: now,
              pendingRequestId: null,
              pendingPhase: null,
              approvedOnce: null,
              failure: {
                category: "host_restart",
                detail:
                  "Previous approval request was invalidated by Host restart; retry requires a fresh decision.",
              },
            },
            "mission.permission_invalidated",
            `${step.role} needs a fresh permission request after Host restart.`,
          );
          interrupted.push(step.id);
          continue;
        }
        if (!STEP_LIVE.includes(step.state)) continue;
        const task = step.taskId
          ? (() => {
              try {
                return this.tasks.db.get(step.taskId!);
              } catch {
                return null;
              }
            })()
          : null;
        const detail = task
          ? `Child task ${task.id} (${task.provider}) was ${task.state} after the Host restart; its non-interactive provider stream cannot be reattached and was not resumed. Previous PID ${task.pid ?? "none"} retained.`
          : "A deterministic capability was running when the Host restarted; it was not resumed.";
        const attempts = step.attempts.map((attempt, index) =>
          index === step.attempts.length - 1
            ? {
                ...attempt,
                finishedAt: now,
                outcome: "interrupted" as const,
                category: "host_restart" as const,
                detail,
              }
            : attempt,
        );
        this.setStep(
          step,
          {
            state: "failed",
            finishedAt: now,
            attempts,
            failure: { category: "host_restart", detail },
          },
          "mission.step.failed",
          `${step.role} interrupted by Host restart: ${detail}`,
        );
        interrupted.push(step.id);
      }
      if (!interrupted.length) {
        if (this.agentic.exists(mission.id)) {
          const current = ["ready", "verifying"].includes(mission.state)
            ? this.setMission(mission, { state: "running" })
            : mission;
          if (current.state === "running")
            this.setMission(
              current,
              {
                state: "waiting_for_user",
                recovery: {
                  at: now,
                  detail:
                    "Agentic intent is historical; fresh reviewed consent is required in this Host generation.",
                  interruptedSteps: [],
                },
              },
              "mission.recovered",
              "Agentic restart authority fails closed; no stale executable grant was restored.",
            );
          continue;
        }
        if (!this.cached.enabled || this.tasks.containment.health.lastFatal) {
          const current = ["ready", "verifying"].includes(mission.state)
            ? this.setMission(mission, { state: "running" })
            : mission;
          if (current.state === "running")
            this.setMission(
              current,
              {
                state: "waiting_for_user",
                recovery: {
                  at: now,
                  detail:
                    "Host restart paused scheduling. No old execution was resumed; review and replan or stop this Mission.",
                  interruptedSteps: [],
                },
              },
              "mission.recovered",
              "Host restart paused scheduling; user review is required.",
            );
          continue;
        }
        if (mission.state === "ready") {
          this.start(mission);
          continue;
        }
        if (mission.state === "running")
          this.emit(
            "mission.recovered",
            `Mission ${mission.id} restored after a Host restart; no step was executing, scheduling continues.`,
            mission.id,
          );
        if (mission.state === "running" || mission.state === "verifying") this.schedule(mission.id);
        continue;
      }
      const current =
        mission.state === "verifying"
          ? this.setMission(mission, { state: "running" })
          : mission.state === "ready"
            ? this.setMission(mission, { state: "running" })
            : mission;
      this.setMission(
        current,
        {
          state: "waiting_for_user",
          recovery: {
            at: now,
            detail: `${interrupted.length} step(s) were interrupted by a Host restart and were not resumed. Retry starts fresh child tasks under the same authorization.`,
            interruptedSteps: interrupted,
          },
        },
        "mission.recovered",
        `Mission ${mission.id} "${mission.title}": ${interrupted.length} step(s) interrupted by a Host restart; nothing was resumed. Retry to start fresh child tasks, or stop the mission.`,
      );
    }
  }

  // ── triggers ──────────────────────────────────────────────────────────────
  async act(trigger: Trigger, cause: string) {
    if (trigger.action.kind === "notify") {
      this.inbox.add({
        source: "trigger",
        kind: "external_event",
        title: trigger.action.title,
        detail: `${trigger.name}: ${cause}`,
        missionId: null,
        taskId: null,
        stepId: null,
        requestId: null,
      });
      return;
    }
    // A trigger can only draft: the mission stops at waiting_for_approval for a person to approve.
    this.create({
      objective: trigger.action.objective,
      mode: trigger.action.mode,
      projectId: trigger.action.projectId,
      origin: `trigger:${trigger.id}`,
    });
  }

  async close() {
    this.closed = true;
    this.deactivate();
    this.tasks.bus.off("event", this.listener);
    for (const handle of this.pending.values()) clearImmediate(handle);
    this.pending.clear();
    await this.bus.close();
  }
}
