import { EventEmitter } from "node:events";
import { appendFileSync, mkdirSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { canTransition } from "../orch/machine.ts";
import type { Mode, OrchTask, Project, ProviderId, ProviderLive, TaskState, HostSample, TaskProgress, TokenUsage, ProcessInfo, ProviderExecutionScope, TaskConstraints, RouteDecision ,
} from "../orch/types.ts";
import { HostDatabase } from "./persistence.server.ts";
import { MODEL_SOURCE_PROVIDERS, ModelCapabilityRegistry } from "./model-capability.server.ts";
import { bunnyRoute, eligibility, inferredConstraints, runsLocally } from "./router.ts";
import { defaultAdapters } from "./adapters.server.ts";
import type { AgentSession, AdapterHooks, HostEvent, HostSnapshot, ProviderAdapter, RunningSession, SubmitTask ,
} from "./contracts.ts";
import { PolicyEngine } from "./learning.server.ts";
import { classifyRequirements, effortRequirement, type TaskRequirements ,
} from "../orch/router-requirements.ts";
import { ADAPTER_TOOL_CONTRACTS, ROUTING_POLICY_VERSION, PROVIDER_EFFORT_CONTRACTS, buildCandidates, selectRoutingCandidate, safeDecisionRecord, preLaunchRevalidate, codexCompatibilityFresh, classifyFailure, planRecovery, exhaustionNote, type RoutingDecisionRecord, type RoutingFailureTaxonomy ,
} from "./routing.server.ts";
import { RoutingDecisionStore } from "./routing-store.server.ts";
import { DEFAULT_TIMING, ProviderRegistry, type RegistryTiming } from "./registry.server.ts";
import { ProviderUsageService } from "./provider-usage.server.ts";
import { activityLabel } from "./events.ts";
import { describeTree, descendants, killProcess, processTable, sameProcessIdentity, survivors ,
} from "./process-tree.server.ts";
import { verifySpec } from "./verification.server.ts";
import { markProviderSessionReview, readProviderSessions, reconcileProviderSession, type InterruptedProviderSession } from "./owned-process-group.server.ts";
import { CommandRefusedError, HostContainment, safeError, type SafeError } from "./failure.server.ts";
import { ProjectRegistry } from "./project-registry.server.ts";
import { deviceMayLaunch } from "./device-authority.server.ts";
import { PERSONAL_AGENTS_SETTING, PERSONAL_AGENTS_SCHEMA, defaultPersonalAgentsConfig, parsePersonalAgentsConfig, validatePersonalAgentSlots, type PersonalAgentSlotConfig, type PersonalAgentsConfig } from "./personal-agents.ts";
import { isRemoteOllamaTag } from "../orch/exec.server.ts";
import { LayaRegistry, type LayaRuntime } from "./laya.server.ts";
import { JevSecretStore, type SecretProtector } from "./jev-secrets.server.ts";
import { JevService, type FetchLike } from "./typesafe-jev.server.ts";
import { applyDecisionAdvice, buildDecisionState, candidateKey, isLayaModel, layaExclusion, type DecisionAdvice } from "./intelligence.ts";
import type { IntelligenceSnapshot } from "./intelligence-snapshot.ts";

export type TaskOutputEvent = { text: string } | { done: true; state: string };

const TERMINAL: TaskState[] = ["completed", "failed", "stopped"];
const TRANSCRIPT_LIMIT = 20 * 1024 * 1024;
/** Hold key for a provider-sessions folder that could not be listed at startup (review round 5). */
const FOLDER_UNREADABLE = "provider-sessions (folder unreadable)";
const lastLine = (text: string) => text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).at(-1) ?? "";
const clip = (text: string, max = 300) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/**
 * Restart liveness (never kill authority): same PID and image, and either the same birth time or a birth time that
 * cannot be read now or was not recorded. Unknown means possibly alive (fail closed).
 */
function possiblyAlive(expected: ProcessInfo, rows: ProcessInfo[]): boolean {
  const current = rows.find((row) => row.pid === expected.pid);
  if (!current) return false;
  if (expected.name && current.name && current.name.toLowerCase() !== expected.name.toLowerCase()) return false;
  const known = (value: number | null) => value !== null && Number.isFinite(value) && value > 0;
  return !known(expected.createdAt) || !known(current.createdAt) || current.createdAt === expected.createdAt;
}
export type ManagerOptions = {
  workspaceRoot?: string;
  /** Folder for raw provider transcripts (one JSONL file per task); null disables them. */
  sessionDirectory?: string | null;
  timing?: RegistryTiming;
  /** Process-table reader, replaceable in tests. */
  processTable?: () => Promise<ProcessInfo[]>;
  containment?: HostContainment;
  /** M-A-3 T3: test/fixture injection point for the T1 model registry; production builds the real one. */
  modelRegistry?: ModelCapabilityRegistry;
  /** M-A-3 T9R-F04: Host state folder; provider-session job records live in runtime/provider-sessions. */
  dataDirectory?: string | null;
  /** M-A-3 T13.1 test seams for intelligence services; production uses Ollama, real fetch and Windows DPAPI. */
  intelligence?: { layaRuntime?: LayaRuntime; jevFetch?: FetchLike; jevProtector?: SecretProtector; now?: () => number };
};

export class TaskManager {
  projects: ProjectRegistry;
  workspaceRootConfigured: boolean;
  db: HostDatabase;
  adapters: ProviderAdapter[];
  registry: ProviderRegistry;
  /** M-A-3 T1: per-model capability facts. Additive; routing still reads only the provider registry. */
  modelCapabilities: ModelCapabilityRegistry;
  /** M-A-3 T2: normalized usage truth. Derives from registry state and Bunny's own counters; probes nothing, owns no store. */
  providerUsage: ProviderUsageService;
  /** M-A-3 T3: safe persistence for routing decisions and the bounded attempt trail behind them. */
  routingStore: RoutingDecisionStore;
  /** M-A-3 T13.1: Laya discovery and the optional TypeSafe Jev decision service (advisory only). */
  laya: LayaRegistry;
  jevSecrets: JevSecretStore;
  jev: JevService;
  bus = new EventEmitter();
  /** M-A-3 T9R (DEV-01): direct tasks a paired device approved; their reroutes stay on local tool-free inference. */
  private readonly deviceApproved = new Set<string>();
  /** M-A-3 T10: voice listens to a task's real token deltas and terminal state. Listeners carry no authority. */
  private readonly taskOutputListeners = new Map<string, Set<(event: TaskOutputEvent) => void>>();
  instanceId: string = crypto.randomUUID();
  sessions = new Map<string, RunningSession>();
  stopping = new Set<string>();
  samples: HostSample[] = [];
  defaultRoot: string;
  remoteConfigured = false;
  remoteUrl: string | null = null;
  policy: PolicyEngine;
  thermal = { cpuWarn: 90, gpuWarn: 85, autoStop: false };
  /** M-A-3 T13: the four Personal Agent slots (presentation only), persisted in the settings row PERSONAL_AGENTS_SETTING. */
  personalAgents: PersonalAgentsConfig = defaultPersonalAgentsConfig();
  hotSensors = new Set<string>();
  flushers = new Map<string, () => void>();
  treeTimers = new Map<string, ReturnType<typeof setTimeout>>();
  /**
   * M-A-3 T9R-F01: sessions whose root process ended but whose descendants may still run ("checking" until the
   * first process-table read). Fail-closed liveness for the paired-device mid-run hold.
   */
  lingering = new Map<string, ProcessInfo[] | "checking">();
  survivorWatches = 0;
  /** M-A-3 T9R-F01: why a Host code run (a Python verification) must wait for the workstation, or null. */
  codeRunGate: (() => string | null) | null = null;
  /** Ended attempts (session objects) whose survivors are already watched. */
  survivorAttempts = new WeakSet<object>();
  /** The provider and access of the attempt each lingering entry belongs to (a reroute never reclassifies it). */
  lingeringAttempt = new Map<string, { provider: OrchTask["provider"]; access: string | undefined; mission: boolean }>();
  sessionDirectory: string | null;
  /** M-A-3 T9R-F04: where provider-session job records are kept (null: not persisted). */
  dataDirectory: string | null = null;
  readProcesses: () => Promise<ProcessInfo[]>;
  /** Host-owned folders (mission worktrees) a delegated child task may use as its working directory. */
  workspaceRoots: string[] = [];
  /**
   * Installed by the mission owner; checked for direct approvals of pending children too. "launch" is the final
   * check on the exact provider/model that will start (after any launch-time reroute) and spends a single-use grant.
   */
  missionScopeCheck: ((task: OrchTask, phase?: "check" | "launch") => string | null) | null = null;
  /** M-A-3 T11: the team Agent owning a Mission child task (attribution of contained sessions); null outside teams. */
  missionTaskAgent: ((task: OrchTask) => string | null) | null = null;
  missionAttemptAdmission:
    ((task: OrchTask, kind: "action" | "retry" | "reroute") => string | null) | null = null;
  missionAttemptSettled: ((task: OrchTask, ok: boolean) => void) | null = null;
  missionAttemptRuntimeLimit: ((task: OrchTask) => number) | null = null;
  containment: HostContainment;
  constructor(
    db: HostDatabase,
    defaultRoot: string,
    adapters?: ProviderAdapter[],
    options: ManagerOptions = {},
  ) {
    this.db = db;
    this.defaultRoot = realpathSync(defaultRoot);
    this.workspaceRootConfigured = !!options.workspaceRoot;
    this.projects = new ProjectRegistry(db, options.workspaceRoot ?? this.defaultRoot);
    this.containment =
      options.containment ??
      new HostContainment({
        persist: (type, detail, owner) =>
          this.emit(db.event(type, owner.taskId ?? null, detail, owner.missionId ?? null)),
      });
    this.instanceId = this.containment.instanceId;
    this.policy = new PolicyEngine(db);
    this.adapters = adapters ?? defaultAdapters(() => this.providerPaths());
    this.registry = new ProviderRegistry(this.adapters, db, options.timing ?? DEFAULT_TIMING);
    this.modelCapabilities =
      options.modelRegistry ??
      new ModelCapabilityRegistry(db, {
        providerPaths: () => this.providerPaths(),
        availableProviders: () => this.adapters.map((adapter) => adapter.id),
      });
    this.providerUsage = new ProviderUsageService({
      providers: () => this.registry.list(),
      probed: (id) => this.registry.probedThisRun(id),
      observed: (id) => this.db.observed(id),
      availableProviders: () => this.adapters.map((adapter) => adapter.id),
      publish: (events) => {
        for (const event of events) this.emit(this.db.event(event.type, null, event.detail));
      },
    });
    this.routingStore = new RoutingDecisionStore(db);
    this.laya = new LayaRegistry(db, options.intelligence?.layaRuntime);
    this.jevSecrets = new JevSecretStore(db, options.intelligence?.jevProtector);
    this.jev = new JevService(db, this.jevSecrets, { sessionId: this.instanceId, fetchFn: options.intelligence?.jevFetch, now: options.intelligence?.now });
    this.sessionDirectory = options.sessionDirectory ?? null;
    this.readProcesses = options.processTable ?? processTable;
    this.dataDirectory = options.dataDirectory ?? null;
    const savedThermal = db.db
      .prepare("SELECT value FROM settings WHERE key='thermal_policy'")
      .get() as { value: string } | undefined;
    if (savedThermal) this.thermal = JSON.parse(savedThermal.value);
    const savedPersonalAgents = db.db
      .prepare("SELECT value FROM settings WHERE key=?")
      .get(PERSONAL_AGENTS_SETTING) as { value: string } | undefined;
    this.personalAgents = parsePersonalAgentsConfig(savedPersonalAgents?.value ?? null);
    this.bus.setMaxListeners(100);
    // UI reconnect never calls this. A new Host instance genuinely cannot attach
    // to an old non-interactive pipe; keep session/PID evidence without killing it.
    for (const task of db.tasks())
      if (
        [
          "launching",
          "running",
          "verifying",
          "waiting_for_input",
          "waiting_for_agent_approval",
        ].includes(task.state)
      ) {
        this.update(
          task,
          {
            state: "failed",
            error:
              "Host process restarted; this adapter cannot reattach its old pipes. Previous PID retained for diagnosis. Its provider processes ran in a Bunny-owned Windows job that the kernel ends when the previous Host's handles close; this Host verifies the recorded process identities (provider_session events) and killed no process.",
            finishedAt: Date.now(),
          },
          "task.failed",
          "Host restarted; session recovery unsupported.",
        );
      }
    if (this.dataDirectory) {
      let found: ReturnType<typeof readProviderSessions> = { records: [], unreadable: [] };
      try { found = readProviderSessions(this.dataDirectory, this.instanceId); } catch { found = { records: [], unreadable: [FOLDER_UNREADABLE] }; }
      for (const record of found.records) {
        try { this.reconcileInterruptedProviderSessions([record]); }
        catch { found.unreadable.push(`${record.operationId}.json`); }
      }
      this.holdUnreadableProviderSessions(found.unreadable);
    }
  }
  /**
   * M-A-3 T9R-F04 restart: the previous Host's provider jobs were killed by the kernel when its handles closed. Each
   * interrupted record is corroborated against the current process table by full identity (PID + creation time +
   * image). Until that read succeeds, and while any recorded identity is still alive, the session counts as live code
   * (fail closed) and needs review. Nothing is killed and no handle is recreated.
   */
  /** Set at Host shutdown: restart/unreadable/job watchers stop instead of touching a closed database. */
  disposed = false;
  dispose() { this.disposed = true; }
  /** Restart holds by Mission/Task: a new provider session for the same work waits while a prior one may survive. */
  restartSurvivorMission = new Map<string, { missionId: string | null; taskId: string | null }>();
  /** Why a provider launch for this task must wait for an interrupted earlier session, or null (review round 1, RESTART-04). */
  restartSurvivorRefusal(task: OrchTask): string | null {
    for (const [key, owner] of this.restartSurvivorMission) {
      if (!this.lingering.has(key)) continue;
      if ((owner.missionId && owner.missionId === task.mission?.missionId) || (owner.taskId && owner.taskId === task.id))
        return `A provider session for this work from before the Host restarted (${key.slice(8)}) may still be running; Bunny is verifying its recorded processes and starts no new session for the same work until none is alive.`;
    }
    return null;
  }
  /** Unreadable job records may name live processes: each is held as live code until the file is readable or removed. */
  holdUnreadableProviderSessions(files: string[]) {
    for (const file of files) {
      const key = `unreadable:${file}`;
      this.lingering.set(key, "checking");
      this.emit(this.db.event("provider_session.unreadable", null, `Requires review: provider-session record ${file} could not be read. It is treated as live code (fail closed) until the record is readable or removed; nothing was killed.`));
      let failureReported = false;
      const check = () => {
        if (this.disposed) return;
        let found: ReturnType<typeof readProviderSessions> | null = null;
        try { found = readProviderSessions(this.dataDirectory!, this.instanceId); } catch { found = null; }
        if (found && !found.unreadable.includes(file)) {
          // Readable again: reconcile it like any interrupted record before the hold is released (review round 3, HOLD-4).
          // A folder that was unreadable at startup releases only after EVERY record in it is reconciled, and files that
          // are still unreadable get their own holds (review round 5). A reconcile failure keeps the hold and retries
          // (review round 4, F04-R3-3): it never escapes the timer and is reported once.
          const folder = file === FOLDER_UNREADABLE;
          let reconciled = false;
          try {
            this.reconcileInterruptedProviderSessions(folder ? found.records : found.records.filter((record) => `${record.operationId}.json` === file));
            if (folder) this.holdUnreadableProviderSessions(found.unreadable.filter((name) => !this.lingering.has(`unreadable:${name}`)));
            reconciled = true;
          } catch (error) {
            reconciled = false;
            if (!failureReported) { failureReported = true; try { this.emit(this.db.event("provider_session.reconcile_failed", null, `Requires review: provider-session record ${file} is readable but could not be reconciled (${safeError(error).message}). It stays live code (fail closed) and is retried; nothing was killed.`)); } catch { /* the hold stands */ } }
          }
          if (reconciled) { this.lingering.delete(key); return; }
        }
        setTimeout(check, 10_000).unref?.();
      };
      setTimeout(check, 10_000).unref?.();
    }
  }
  /** Operations already reconciled by this Host: a later folder re-read never reconciles or reports them twice. */
  reconciledOperations = new Set<string>();
  reconcileInterruptedProviderSessions(records: InterruptedProviderSession[]) {
    for (const record of records) {
      const key = `restart:${record.operationId}`;
      // A record whose earlier reconcile is held (or done) is not started again: a partial failure leaves its restart
      // hold in place, fail closed (review round 5).
      if (this.reconciledOperations.has(record.operationId) || this.lingering.has(key)) continue;
      this.reconciledOperations.add(record.operationId);
      this.lingering.set(key, "checking");
      this.lingeringAttempt.set(key, { provider: (record.provider ?? "codex") as OrchTask["provider"], access: undefined, mission: !!record.missionId });
      this.restartSurvivorMission.set(key, { missionId: record.missionId, taskId: record.taskId });
      this.emit(this.db.event("provider_session.interrupted", record.taskId, `Host restarted while a ${record.provider ?? "provider"} session ran in a Bunny-owned Windows job (operation ${record.operationId}, generation ${record.hostGeneration ?? "unknown"}); the kernel ends job members when the last job handle closes. Verifying recorded process identities before this counts as stopped.`, record.missionId));
      // Every recorded identity is checked; none is silently dropped (review round 1, RESTART-01). A record with no
      // process identity at all (crash between job creation and the first inspection) cannot be corroborated.
      const expected: ProcessInfo[] = [
        { pid: record.launcherPid, ppid: 0, name: record.launcherPath.split(/[\\/]/).at(-1) ?? "", createdAt: record.launcherCreatedAt },
        ...record.members.map((member) => ({ pid: member.pid, ppid: 0, name: (member.file ?? "").split(/[\\/]/).at(-1) ?? "", createdAt: member.createdAt })),
      ].filter((row) => row.pid > 0);
      if (!expected.length) {
        this.lingering.delete(key); this.lingeringAttempt.delete(key); this.restartSurvivorMission.delete(key);
        try { markProviderSessionReview(this.dataDirectory!, record.operationId); } catch { /* history stays interrupted */ }
        this.emit(this.db.event("provider_session.cleanup_unverifiable", record.taskId, `Requires review: interrupted provider session ${record.operationId} has no recorded process identity, so its end cannot be corroborated independently. The kernel ends job members when the previous Host's job handle closed; nothing was killed by this Host.`, record.missionId));
        continue;
      }
      let reported = false;
      const check = async () => {
        if (this.disposed) return;
        // An empty table is a failed read, never proof of absence (review round 2, L1).
        const rows = await this.readProcesses().then((table) => (table.length ? table : null)).catch(() => null);
        if (!rows) { setTimeout(() => void check(), 10_000).unref?.(); return; }
        if (this.disposed) return;
        const alive = expected.filter((old) => possiblyAlive(old, rows));
        if (!alive.length) {
          this.lingering.delete(key); this.lingeringAttempt.delete(key); this.restartSurvivorMission.delete(key);
          try { reconcileProviderSession(this.dataDirectory!, record.operationId); } catch { /* history stays interrupted */ }
          this.emit(this.db.event("provider_session.reconciled", record.taskId, `Interrupted provider session ${record.operationId}: none of its ${expected.length} recorded process identities appears in an independent process-table read (kernel accounting does not exist after the job died with the previous Host; recorded as absent_after_restart, not kernel-verified empty). No process was killed by this Host.`, record.missionId));
          return;
        }
        this.lingering.set(key, alive);
        if (!reported) {
          reported = true;
          this.emit(this.db.event("provider_session.cleanup_unconfirmed", record.taskId, `Requires review: ${alive.length} recorded process(es) of interrupted provider session ${record.operationId} are still alive (${describeTree(alive)}). They are treated as live code; Bunny does not kill them on restart.`, record.missionId));
        }
        setTimeout(() => void check(), 10_000).unref?.();
      };
      void check();
    }
  }
  /** Compatibility view of the registry. */
  get providers(): ProviderLive[] {
    return this.registry.list();
  }
  emit(event: HostEvent) {
    // A broken subscriber (including an async one) cannot throw through a committed task transition.
    for (const listener of this.bus.rawListeners("event")) {
      try {
        const result = listener.call(this.bus, event);
        if (result && typeof result.then === "function")
          this.containment.background(
            {
              subsystem: "event-consumer",
              ...(event.taskId ? { taskId: event.taskId } : {}),
              ...(event.missionId ? { missionId: event.missionId } : {}),
            },
            () => result,
            undefined,
            "SUBSYSTEM_FAILURE",
          );
      } catch (error) {
        this.containment.background({ subsystem: "event-consumer" }, () =>
          this.containment.contain(error, "boundary", {
            owner: { subsystem: "event-consumer" },
            failureClass: "SUBSYSTEM_FAILURE",
          }),
        );
      }
    }
  }
  /** For timers and thermal policy: a stop that fails (e.g. the task already ended) is reported, never an unhandled rejection. */
  stopInBackground(id: string, detail: string) {
    this.containment.background(
      { subsystem: "tasks", taskId: id },
      () => this.stop(id, detail),
      async (error) => {
        this.emit(
          this.db.event("task.stop_failed", id, "Background Stop failed; inspect the task state."),
        );
        await this.failOperation(id, error);
      },
    );
  }
  async failOperation(id: string, error: SafeError) {
    const current = this.db.get(id);
    if (TERMINAL.includes(current.state) || this.stopping.has(id)) return;
    this.stopTree(id);
    this.update(
      current,
      { state: "failed", finishedAt: Date.now(), error: error.message, activity: "Failed" },
      "task.failed",
      "Unexpected task failure; operation ended without success.",
    );
    await this.sessions.get(id)?.stop();
  }
  update(
    task: OrchTask,
    patch: Partial<OrchTask>,
    type: string,
    detail: string,
    quiet = false,
  ): OrchTask {
    const owned = this.db.get(task.id);
    if (
      patch.state &&
      TERMINAL.includes(owned.state) &&
      (patch.state !== owned.state || /^task\.(completed|failed|stopped)$/.test(type))
    )
      return owned;
    if (patch.state && TERMINAL.includes(patch.state) && patch.state !== owned.state)
      this.notifyTaskOutput(task.id, { done: true, state: patch.state });
    if (
      JSON.stringify(
        Object.hasOwn(patch, "executionScope") ? patch.executionScope : task.executionScope,
      ) !== JSON.stringify(owned.executionScope) ||
      JSON.stringify(Object.hasOwn(patch, "mission") ? patch.mission : task.mission) !==
        JSON.stringify(owned.mission)
    )
      throw new Error(
        "Task execution authority and mission ownership are immutable; submit a new approved task.",
      );
    if (patch.state && patch.state !== owned.state && !canTransition(owned.state, patch.state))
      throw new Error(`Invalid transition ${owned.state} → ${patch.state}`);
    const next = {
      ...owned,
      ...patch,
      logs: quiet ? owned.logs : [...owned.logs, { at: Date.now(), line: detail }].slice(-500),
    };
    this.emit(this.db.write(next, type, detail));
    return next;
  }
  providerPaths(): Partial<Record<ProviderId, string>> {
    try {
      const row = this.db.db
        .prepare("SELECT value FROM settings WHERE key='provider_paths'")
        .get() as { value: string } | undefined;
      return row ? JSON.parse(row.value) : {};
    } catch {
      return {};
    }
  }
  announce(changes: string[]) {
    if (changes.length)
      this.emit(this.db.event("provider.status_changed", null, changes.join("; ")));
  }
  /** User-requested refresh: re-probes every provider and model listing now. */
  async discover() {
    const changes = [
      ...(await this.registry.refresh({ force: true })),
      ...(await this.modelCapabilities.refresh({ force: true })),
    ];
    // Usage truth is re-derived from the fresh probes; it never probes on its own.
    await this.providerUsage.refresh();
    await this.refreshLayaDigests();
    this.announce(changes);
  }
  /** Only when the runtime lists a Laya model: no Laya, no extra runtime call. */
  private async refreshLayaDigests() {
    if (LayaRegistry.layaRecords(this.modelCapabilities.snapshot()).length) await this.laya.refreshDigests();
  }
  /** Periodic refresh: cheap health checks, full probes only when due. */
  async refreshProviders() {
    const changes = [
      ...(await this.registry.refresh()),
      ...(await this.modelCapabilities.refresh()),
    ];
    await this.providerUsage.refresh();
    await this.refreshLayaDigests();
    this.announce(changes);
  }
  async configureProviderPath(id: ProviderId, path: string | null) {
    const paths = this.providerPaths();
    if (path) {
      const real = realpathSync(resolve(path));
      if (!statSync(real).isFile()) throw new Error("Executable path must be a file.");
      paths[id] = real;
    } else delete paths[id];
    this.db.db
      .prepare(
        "INSERT INTO settings VALUES('provider_paths',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      )
      .run(JSON.stringify(paths));
    this.emit(
      this.db.event(
        "provider.path_configured",
        null,
        `${id}: ${path ? paths[id] : "automatic discovery"}`,
      ),
    );
    await this.discover();
  }
  live(): ProviderLive[] {
    const active = [...this.sessions.keys()].map((id) => this.db.get(id));
    return this.registry.list().map((provider) => {
      const mine = active.filter((task) => task.provider === provider.id);
      // State loaded from disk is shown, but nothing is routable until this Host instance probed it itself.
      const base = this.registry.probedThisRun(provider.id)
        ? provider
        : {
            ...provider,
            availability: "unknown" as const,
            detail: `Re-probing after Host start. Last known: ${provider.availability.replaceAll("_"," ")}. ${provider.detail}`,
          };
      return {
        ...base,
        active_jobs: mine.length,
        activeSessions: mine.map((task) => ({
          taskId: task.id,
          providerSessionId: task.sessionId ?? null,
          pid: task.pid ?? null,
        })),
        availability: mine.length && base.availability === "ready" ? "busy" : base.availability,
        observed: this.db.observed(provider.id),
      };
    });
  }
  snapshot(after = 0): HostSnapshot {
    return {
      app: "Bunny-A",
      instanceId: this.instanceId,
      health: this.containment.snapshot(),
      tasks: this.db.tasks(),
      projects: this.projects.list({ limit: 100 }).projects,
      providers: this.live(),
      samples: this.samples,
      events: after ? this.db.events(after) : this.db.recentEvents(),
      cursor: this.db.cursor(),
      performance: this.db.performance(),
      remoteConfigured: this.remoteConfigured,
      remoteUrl: this.remoteUrl,
      devices: this.db.db
        .prepare("SELECT id,name,created_at AS createdAt FROM devices WHERE revoked_at IS NULL")
        .all() as { id: string; name: string; createdAt: number }[],
      thermal: this.thermal,
      modelCapabilities: this.modelCapabilities.snapshot(),
      providerUsage: this.providerUsage.snapshot(),
      intelligence: this.intelligenceSnapshot(),
    };
  }
  configureThermal(cpuWarn: number, gpuWarn: number, autoStop: boolean) {
    if (
      !Number.isFinite(cpuWarn) ||
      cpuWarn < 30 ||
      cpuWarn > 120 ||
      !Number.isFinite(gpuWarn) ||
      gpuWarn < 30 ||
      gpuWarn > 120
    )
      throw new Error("Thermal thresholds must be 30–120°C.");
    this.thermal = { cpuWarn, gpuWarn, autoStop };
    this.db.db
      .prepare(
        "INSERT INTO settings VALUES('thermal_policy',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      )
      .run(JSON.stringify(this.thermal));
    this.emit(
      this.db.event(
        "thermal.configured",
        null,
        `CPU ${cpuWarn}°C, GPU ${gpuWarn}°C; automatic stop ${autoStop ? "enabled by user" : "off"}.`,
      ),
    );
  }
  /**
   * M-A-3 T13: saves the four Personal Agent slots. Presentation only: no Agent or Mission action runs and no
   * authorization changes. A caller that passes `expectRevision` is refused when the stored revision moved on, so a
   * stale Studio view never overwrites a newer one. Every binding must be one of `bindableIds` (user-facing Agents).
   */
  configurePersonalAgents(slots: unknown, expectRevision: unknown, bindableIds: ReadonlySet<string>): PersonalAgentsConfig {
    // Both refusals are CommandRefusedError: nothing is written and no containment runs. A write failure is not caught here.
    if (expectRevision !== undefined && expectRevision !== null && expectRevision !== this.personalAgents.revision)
      throw new CommandRefusedError(
        `Personal Agents changed since this view was loaded (current revision ${this.personalAgents.revision}). Nothing was changed; review the current slots.`,
      );
    let validated: PersonalAgentSlotConfig[];
    try {
      validated = validatePersonalAgentSlots(slots, bindableIds);
    } catch (error) {
      throw new CommandRefusedError(error instanceof Error ? error.message : "Personal Agent slots were refused.");
    }
    const next: PersonalAgentsConfig = {
      schema: PERSONAL_AGENTS_SCHEMA,
      revision: this.personalAgents.revision + 1,
      updatedAt: Date.now(),
      slots: validated,
    };
    this.db.db
      .prepare("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
      .run(PERSONAL_AGENTS_SETTING, JSON.stringify(next));
    this.personalAgents = next;
    const bound = validated.filter((slot) => slot.agentId !== null).length;
    this.emit(this.db.event("personal_agents.configured", null, `Personal Agents revision ${next.revision} saved; ${bound} of 4 slots bound.`));
    return next;
  }
  sample(sample: HostSample) {
    this.samples = [...this.samples, sample].slice(-40);
    const sensors = [
      { name: "CPU", temperature: sample.cpu.temperatureC, threshold: this.thermal.cpuWarn },
      ...sample.gpus.map((g) => ({
        name: g.name,
        temperature: g.temperatureC,
        threshold: this.thermal.gpuWarn,
      })),
    ];
    for (const sensor of sensors) {
      if (sensor.temperature == null) continue;
      if (sensor.temperature >= sensor.threshold && !this.hotSensors.has(sensor.name)) {
        this.hotSensors.add(sensor.name);
        this.emit(
          this.db.event(
            "thermal.warning",
            null,
            `${sensor.name} temperature warning: ${sensor.temperature}°C (threshold ${sensor.threshold}°C).`,
          ),
        );
        if (this.thermal.autoStop)
          for (const [id] of this.sessions) {
            if (this.db.get(id).provider === "ollama")
              this.stopInBackground(id, "User-enabled thermal policy stopped local inference.");
          }
      } else if (sensor.temperature < sensor.threshold - 2 && this.hotSensors.delete(sensor.name))
        this.emit(this.db.event("thermal.resolved", null, `${sensor.name} temperature recovered.`));
    }
    this.bus.emit("telemetry", sample);
  }
  registerProject(name: string, path: string): Project {
    const project = this.projects.register(name, path);
    this.emit(
      this.db.event(
        "project.context_registered",
        null,
        `Project context registered: ${project.name}; execution still requires approval.`,
      ),
    );
    return project;
  }
  /** M-A-3 T13.1: secret-free intelligence projection for snapshots and Settings. */
  intelligenceSnapshot(): IntelligenceSnapshot {
    const ollama = this.live().find((provider) => provider.id === "ollama");
    const runtimeUp = !!ollama && ["ready", "busy"].includes(ollama.availability);
    return {
      version: 1,
      router: "BunnyRouter",
      laya: this.laya.snapshot(this.modelCapabilities.snapshot(), runtimeUp),
      jev: this.jev.snapshot(),
      localDecisionPolicy: { label: "Local Decision Policy", detail: "BunnyRouter's deterministic eligibility, scores and rules on this computer. It is always active and is not TypeSafe Jev." },
      lastAssistance: this.lastAssistance,
    };
  }
  /** M-A-3 T13.1 workstation-owner settings. The HTTP layer refuses every one of these for paired devices. */
  configureIntelligence(raw: unknown) {
    const policy = this.jev.configure(raw);
    this.emit(this.db.event("intelligence.configured", null, `Hosted decisions ${policy.enabled ? "on" : "off"}; metadata sharing ${policy.privacy.allowDecisionMetadata ? "allowed" : "off"}; request text ${policy.privacy.allowTaskDescription ? "allowed" : "off"}; ${policy.limits.maxRequestsPerDay} requests per day.`));
  }
  async saveIntelligenceKey(apiKey: unknown) {
    if (typeof apiKey !== "string") throw new CommandRefusedError("Enter a valid API key.");
    try {
      await this.jev.saveKey(apiKey);
    } catch (error) {
      throw new CommandRefusedError(error instanceof Error ? error.message : "The API key was not saved.");
    }
    this.emit(this.db.event("intelligence.credential_saved", null, "TypeSafe API key saved with Windows protection. It has not been tested."));
  }
  removeIntelligenceKey() {
    const had = this.jevSecrets.hasCredential();
    this.jev.removeKey();
    this.emit(this.db.event("intelligence.credential_removed", null, had ? "TypeSafe API key removed." : "No TypeSafe API key was saved."));
  }
  async testIntelligenceConnection(decisionTest: boolean) {
    const result = await this.jev.testConnection({ decisionTest });
    this.emit(this.db.event("intelligence.tested", null, `TypeSafe connection test: ${result.state}${result.lastTest?.inferenceVerified ? "; decision inference verified" : "; decision inference not tested"}.`));
  }
  configureLaya(enabled: unknown) {
    if (typeof enabled !== "boolean") throw new CommandRefusedError("Choose whether Laya may be used.");
    this.laya.setEnabled(enabled);
    this.emit(this.db.event("intelligence.laya_configured", null, `Laya routing ${enabled ? "allowed" : "turned off"}.`));
  }
  /** Starts the local benchmark and returns; the snapshot shows it running and the journal records the result. */
  benchmarkLaya(model: unknown): Promise<void> {
    if (typeof model !== "string" || !model || model.length > 200) throw new CommandRefusedError("Choose an installed Laya model.");
    let run: Promise<import("./intelligence.ts").LayaBenchmark[]>;
    try {
      run = this.laya.startBenchmark(model, this.modelCapabilities.snapshot());
    } catch (error) {
      throw new CommandRefusedError(error instanceof Error ? error.message : "The Laya benchmark could not run.");
    }
    this.emit(this.db.event("intelligence.laya_benchmarked", null, `Laya ${model}: local benchmark started.`));
    return run.then(
      (rows) => this.emit(this.db.event("intelligence.laya_benchmarked", null, `Laya ${model}: ${rows.filter((row) => row.passed).length} of ${rows.length} benchmarked task classes passed.`)),
      () => this.emit(this.db.event("intelligence.laya_benchmarked", null, `Laya ${model}: the local benchmark did not finish.`)),
    ).catch(() => undefined); // the Host may be closing; the run is simply not reported
  }
  /** Last decision-assistance outcome, for Settings (no prompt text, no secret). */
  private lastAssistance: IntelligenceSnapshot["lastAssistance"] = null;
  /**
   * M-A-3 T13.1: optional hosted decision assistance for one would-be direct Task. Advisory only:
   * BunnyRouter validates the advice in submit(). Every failure (off, no key, sharing off, budget,
   * network, cancellation) returns null and local routing proceeds unchanged. Manual model choices
   * and Mission-delegated work never consult it.
   */
  async assistDecision(input: SubmitTask, signal?: AbortSignal): Promise<DecisionAdvice | null> {
    if (!this.jev.usable()) return null;
    if ((input.override && input.override !== "auto") || input.modelOverride) return null;
    try {
      const routingText = input.routingPrompt ?? input.prompt;
      const constraints = inferredConstraints(routingText, input.constraints);
      const pipeline = this.routingPipeline({ routingText, mode: input.mode, providers: this.live(), constraints, override: input.override, modelOverride: input.modelOverride });
      const eligibleKeys = pipeline.selection.order.map((candidate) => candidateKey(candidate.provider_id, candidate.model_id));
      if (eligibleKeys.length < 2) return null;
      const state = buildDecisionState({ taskClass: pipeline.requirements.task_class, eligibleKeys, mode: input.mode, privacy: this.jev.policy.privacy, taskDescription: routingText });
      return (await this.jev.advise({ state, eligibleKeys, signal })).advice;
    } catch (error) {
      this.lastAssistance = { at: Date.now(), source: "local", action: "router", detail: `Hosted decision unavailable (${error instanceof Error ? error.message.slice(0, 160) : "error"}); Local Decision Policy used.`, recommended: null, confidence: null };
      return null;
    }
  }
  /**
   * M-A-3 T3: one deterministic FILTER-then-SCORE candidate pass (§1/§8/§12). It extends — never
   * replaces — BunnyRouter: the legacy RouteDecision above stays in the task record, and this pass
   * chooses the provider+model+effort for THIS Task on the same eligibility. Reads registries; writes nothing.
   */
  private routingPipeline(input: {
    routingText: string;
    mode: Mode;
    providers: ProviderLive[];
    constraints: TaskConstraints;
    override?: ProviderId | "auto";
    modelOverride?: string | null;
    taskType?: string;
  }) {
    const requirements = classifyRequirements({
      prompt: input.routingText,
      mode: input.mode,
      constraints: input.constraints,
    });
    const modelSnapshot = this.modelCapabilities.snapshot();
    const usage = this.providerUsage.snapshot();
    const candidates = buildCandidates({
      providers: input.providers,
      modelSnapshot,
      usage,
      requirements,
      constraints: input.constraints,
      override: input.override ?? "auto",
      modelOverride: input.modelOverride,
      mode: input.mode,
      empirical: (provider) => this.db.learned(provider, input.taskType ?? "general"),
      layaGate: (model, taskClass) => (!isLayaModel(model) ? null : !this.laya.enabled ? `Laya routing is turned off in Settings; ${model} is not eligible.` : layaExclusion(model, taskClass, this.laya.benchmarks(model))),
    });
    const selection = selectRoutingCandidate({ candidates, requirements });
    return { requirements, candidates, selection, modelSnapshot, usage };
  }
  /** §11: the Task's effort requirement resolved through the provider's real effort contract; null = PROVIDER_DEFAULT. */
  private nativeEffort(
    provider: ProviderId,
    mode: Mode,
    requirements: TaskRequirements,
  ): string | null {
    const contract = PROVIDER_EFFORT_CONTRACTS[provider];
    return contract.supported && contract.native
      ? (contract.native[effortRequirement(requirements, mode)] ?? null)
      : null;
  }
  /** §19: the safe candidate subset the island view may show — the same list §18 persists, capped at 24. */
  private pipelineCandidates(
    pipeline: ReturnType<TaskManager["routingPipeline"]>,
  ): NonNullable<RouteDecision["candidates"]> {
    return pipeline.candidates
      .slice(0, 24)
      .map((candidate) => ({
        provider_id: candidate.provider_id,
        model_id: candidate.model_id,
        candidate_kind: candidate.candidate_kind,
        effort_mode: candidate.effort_internal,
        eligible: candidate.eligibility === "eligible",
        exclusion_reasons: candidate.exclusion_reasons,
        score: candidate.final_score,
        components:
          candidate.score_components?.map((component) => ({
            name: component.name,
            points: component.points,
          })) ?? null,
      }));
  }
  /** §18: the safe record one pipeline pass persists to the store (id set by the caller). */
  private recordDecision(input: {
    id: string;
    taskId: string;
    missionId: string | null;
    routingMode: "auto" | "manual";
    pipeline: ReturnType<TaskManager["routingPipeline"]>;
    reroutes?: number;
    terminalNote?: string;
    assistance?: RoutingDecisionRecord["assistance"];
  }): RoutingDecisionRecord {
    return safeDecisionRecord({
      id: input.id,
      taskId: input.taskId,
      missionId: input.missionId,
      routingMode: input.routingMode,
      requirements: input.pipeline.requirements,
      candidates: input.pipeline.candidates,
      selection: input.pipeline.selection,
      policyVersion: ROUTING_POLICY_VERSION,
      createdAt: Date.now(),
      reroutes: input.reroutes,
      snapshotProviders: input.pipeline.modelSnapshot.providers,
      usageStatuses: input.pipeline.usage.providers.map((provider) => ({
        provider: provider.providerId,
        status: provider.status,
      })),
      terminalNote: input.terminalNote,
      assistance: input.assistance,
    });
  }
  /** §5 clarity: the readable reasons a pipeline pass produced no eligible candidate. */
  private pipelineFailure(pipeline: ReturnType<TaskManager["routingPipeline"]>): string {
    const reasons = [
      ...new Set(
        pipeline.candidates.flatMap((candidate) =>
          candidate.eligibility === "excluded" ? candidate.exclusion_reasons : [],
        ),
      ),
    ].slice(0, 4);
    return reasons.join(" ") || "No candidate satisfied the Task's hard constraints.";
  }
  /** §5 honesty for fact-less environments: a listing provider with zero model facts is UNKNOWN, not routed against. */
  private modelSnapshotHasFacts(
    modelSnapshot: ReturnType<ModelCapabilityRegistry["snapshot"]>,
  ): boolean {
    return modelSnapshot.providers.some(
      (entry) => MODEL_SOURCE_PROVIDERS.includes(entry.provider) && entry.models.length > 0,
    );
  }
  /** T3 §17 launch-gate facts for the persisted selection. Cached facts are age-stamped, never launch authority. */
  private revalidateCandidate(task: OrchTask): { ok: true } | { ok: false; reason: string } {
    const live = this.live();
    const provider = live.find((entry) => entry.id === task.provider);
    if (!provider) return { ok: false, reason: `Provider ${task.provider} is no longer known.` };
    const check = preLaunchRevalidate(
      {
        provider_id: task.provider,
        model_id: task.model === "auto" ? null : task.model,
        candidate_kind: task.model === "auto" ? "PROVIDER_DEFAULT" : "DISCOVERED_MODEL",
      },
      live,
      this.modelCapabilities.snapshot(),
      task.constraints ?? {},
      Date.now(),
    );
    if (!check.ok) return check;
    const fresh = codexCompatibilityFresh(provider, Date.now());
    return fresh.ok
      ? { ok: true }
      : {
          ok: false,
          reason: fresh.reason ?? "Codex security compatibility evidence is not fresh.",
        };
  }
  /** T3 §28/§22: an AUTO reroute walks the recorded fallback order and revalidates each entry; a MANUAL task never reroutes. `exclude` is every already-attempted candidate; largerContext prefers verified-bigger windows after a CONTEXT_OVERFLOW. */
  private rerouteFromDecision(
    task: OrchTask,
    options?: {
      exclude?: { provider: ProviderId; model: string | null }[];
      largerContext?: boolean;
    },
  ): { provider: ProviderId; model: string; effort: string | null } | null {
    const record = task.routingDecisionId
      ? this.routingStore.decision(task.routingDecisionId)
      : null;
    if (!record) return null;
    // §22 candidate identity: a provider-default selection routes the provider's legacy-recommended
    // model string, but the default candidate's identity is (provider, null). A provider yields
    // either DISCOVERED models or a PROVIDER_DEFAULT candidate, never both, so normalizing every
    // exclude entry for the default-selected provider to model null is exact, never over-broad.
    const launched = record.assistance?.adopted ?? record.selected;
    const defaultSelected =
      !!launched &&
      launched.provider_id === task.provider &&
      launched.model_id === null;
    const normalizeModel = (provider: ProviderId, model: string | null): string | null =>
      defaultSelected && provider === task.provider && model !== null ? null : (model ?? null);
    const exclude = options?.exclude ?? [];
    const attempted = (provider: ProviderId, model: string | null) =>
      exclude.some(
        (entry) =>
          entry.provider === provider &&
          normalizeModel(entry.provider, entry.model) === (model ?? null),
      );
    const isCurrent = (provider: ProviderId, model: string | null) =>
      provider === task.provider && (model ?? null) === normalizeModel(task.provider, task.model);
    const order = options?.largerContext
      ? this.orderedByWindow(record.fallback_order)
      : record.fallback_order;
    const live = this.live();
    const deviceApproved = this.deviceApproved.has(task.id);
    for (const next of order) {
      if (isCurrent(next.provider_id, next.model_id) || attempted(next.provider_id, next.model_id))
        continue;
      // A provider default could resolve to a hosted tag, so a device-approved task needs an exact local model.
      if (deviceApproved && (!next.model_id || !deviceMayLaunch({ provider: next.provider_id, model: next.model_id }, live.find((entry) => entry.id === next.provider_id)?.remoteModels)))
        continue;
      const check = preLaunchRevalidate(
        {
          provider_id: next.provider_id,
          model_id: next.model_id,
          candidate_kind: next.model_id ? "DISCOVERED_MODEL" : "PROVIDER_DEFAULT",
        },
        live,
        this.modelCapabilities.snapshot(),
        task.constraints ?? {},
        Date.now(),
      );
      if (check.ok) {
        const provider = live.find((entry) => entry.id === next.provider_id)!;
        const fresh = codexCompatibilityFresh(provider, Date.now());
        if (fresh.ok)
          return {
            provider: next.provider_id,
            model: next.model_id ?? "auto",
            effort: this.nativeEffort(next.provider_id, task.mode, record.requirements),
          };
      }
    }
    return null;
  }
  /** §22 CONTEXT_OVERFLOW recovery: verified larger context first; unverified windows rank last, honestly. */
  private orderedByWindow(
    order: { provider_id: ProviderId; model_id: string | null; score: number }[],
  ): { provider_id: ProviderId; model_id: string | null; score: number }[] {
    const snapshot = this.modelCapabilities.snapshot();
    const windowOf = (entry: { provider_id: ProviderId; model_id: string | null }) => {
      const record = snapshot.providers
        .find((provider) => provider.provider === entry.provider_id)
        ?.models.find((model) => model.model === entry.model_id);
      return record && typeof record.contextWindow === "number" ? record.contextWindow : -1;
    };
    return [...order].sort((left, right) => windowOf(right) - windowOf(left));
  }
  /** §18/§28: a reroute mutates THE SAME decision record, once, with its reason. */
  private bumpReroutes(task: OrchTask, reason: string) {
    if (!task.routingDecisionId) return;
    const record = this.routingStore.decision(task.routingDecisionId);
    if (!record) return;
    try {
      this.routingStore.saveDecision({
        ...record,
        reroutes: (record.reroutes ?? 0) + 1,
        terminal_note: reason.slice(0, 300),
      });
    } catch {
      /* Evidence only; the task-side record is authoritative. */
    }
  }
  /**
   * `delegated` is only passed in-process by the MissionManager (never from HTTP input): it links the
   * child task to its mission step and may place it in a Host-owned mission workspace.
   */
  submit(
    input: SubmitTask,
    delegated?: {
      missionId: string;
      stepId: string;
      cwd?: string | null;
      executionScope: ProviderExecutionScope;
    },
  ): OrchTask {
    this.containment.assertAccepting("tasks");
    const scope = delegated?.executionScope ?? input.executionScope;
    if ((delegated && !scope) || (scope && !["read", "write"].includes(scope.access)))
      throw new Error("Invalid or missing provider execution scope.");
    const executionScope = scope ? { access: scope.access } : undefined;
    // A mission child is routed on its step objective; Bunny's own agent-prompt wording must not add requirements.
    const routingText = input.routingPrompt ?? input.prompt;
    const constraints = inferredConstraints(routingText, input.constraints);
    let project = input.projectId ? this.projects.forExecution(input.projectId) : null;
    if (input.projectId && !project) throw new Error("Project is not registered on this Host.");
    if (constraints.workingDirectory) {
      // A required folder must be an approved project root (or the Host's default root); it is never created or guessed.
      let folder: string;
      try {
        folder = realpathSync(resolve(constraints.workingDirectory));
      } catch {
        throw new Error("The required working directory does not exist.");
      }
      const owner = this.db.projects().find((p) => p.path === folder) ?? null;
      if (!owner && folder !== this.defaultRoot)
        throw new Error("The required working directory is not an approved project folder.");
      if (project && project.path !== folder)
        throw new Error("The required working directory differs from the selected project.");
      project = owner ? this.projects.forExecution(owner.id) : null;
      constraints.workingDirectory = folder;
    }
    let cwd = project?.path ?? constraints.workingDirectory ?? this.defaultRoot;
    if (delegated?.cwd) {
      let folder: string;
      try {
        folder = realpathSync(resolve(delegated.cwd));
      } catch {
        throw new Error("The mission workspace does not exist.");
      }
      const inside = (root: string) => {
        let real: string;
        try {
          real = realpathSync(root);
        } catch {
          return false;
        }
        const rel = relative(real, folder);
        return rel === "" || (!!rel && !rel.startsWith("..") && !isAbsolute(rel));
      };
      if (
        !statSync(folder).isDirectory() ||
        !(
          folder === this.defaultRoot ||
          this.db.projects().some((p) => p.path === folder) ||
          this.workspaceRoots.some(inside)
        )
      )
        throw new Error(
          "The mission workspace is not an approved project folder or Host-owned workspace.",
        );
      cwd = folder;
    }
    const live = this.live();
    const policy = this.policy.active();
    const decision = bunnyRoute({
      ...input,
      prompt: routingText,
      providers: live,
      constraints,
      policyId: policy.id,
      learned: (id) =>
        this.policy.adjustment(
          live.find((p) => p.id === id)!,
          routingText,
          input.mode,
          policy,
        ),
    });
    // M-A-3 T3: the dynamic model router extends this decision for THIS Task (§1/§2: no second
    // router; same eligibility). Facts are read-only inputs. A MANUAL selection outranks routing
    // (§5) and impossible manual selections fail clearly (§27) — never a silent substitution.
    const manual = (!!input.override && input.override !== "auto") || !!input.modelOverride;
    const routingMode: "auto" | "manual" = manual ? "manual" : "auto";
    const pipeline = this.routingPipeline({
      routingText,
      mode: input.mode,
      providers: live,
      constraints,
      override: input.override,
      modelOverride: input.modelOverride,
    });
    const selection = pipeline.selection.selected;
    const routingDecisionId = crypto.randomUUID();
    let routed: { provider: ProviderId; model: string; effort: string | null };
    if (selection) {
      routed = {
        provider: selection.provider_id,
        model:
          selection.model_id ??
          (selection.provider_id === decision.recommended_provider
            ? decision.recommended_model
            : "auto"),
        effort: selection.effort_native,
      };
      // §20: the decision record and the launched configuration are the same facts.
      decision.recommended_provider = routed.provider;
      decision.recommended_model = routed.model;
      decision.policy_version = ROUTING_POLICY_VERSION;
      decision.routing_mode = routingMode;
      decision.candidate_count = pipeline.candidates.length;
      decision.eligible_candidate_count = pipeline.selection.order.length;
      decision.effort_mode = routed.effort;
      decision.task_requirements = pipeline.requirements;
      decision.reroutes = 0;
      decision.selection_reason = pipeline.selection.reason;
      decision.candidates = this.pipelineCandidates(pipeline);
    } else {
      // §27: when model facts exist and none satisfy the Task's hard constraints, fail clearly —
      // including a manual selection whose exact model can no longer be verified. When NO facts
      // exist, registry absence is UNKNOWN, not an empty world (§8): the legacy BunnyRouter
      // provider decision stands byte-for-byte — also for a manual PROVIDER override (pre-T3
      // parity; MA0R2 reaches launch-time refusal tests through it) — no effort knob (§11).
      if (this.modelSnapshotHasFacts(pipeline.modelSnapshot))
        throw new Error(
          `No eligible model candidate for this Task. ${this.pipelineFailure(pipeline)}`,
        );
      // Fact-less Host: no effort knob either — effort engages with routing facts; the saved
      // record below documents the fallback (§5).
      routed = {
        provider: decision.recommended_provider,
        model: decision.recommended_model,
        effort: null,
      };
    }
    // M-A-3 T13.1: hosted decision assistance is one advisory input. BunnyRouter validates it against the eligible
    // set and refuses any switch that widens locality or tool access; manual choices and Mission work never use it.
    let assistanceRecord: RoutingDecisionRecord["assistance"] = null;
    let launchedModelId = selection?.model_id ?? null;
    if (selection) {
      const routerKey = candidateKey(selection.provider_id, selection.model_id);
      const advice = !delegated && routingMode === "auto" ? (input.decisionAssistance ?? null) : null;
      const outcome = applyDecisionAdvice({
        routerKey,
        eligible: pipeline.selection.order.map((candidate) => ({ key: candidateKey(candidate.provider_id, candidate.model_id), local: candidate.local_or_cloud === "local", tools: ADAPTER_TOOL_CONTRACTS[candidate.provider_id] !== false })),
        advice,
        thresholds: this.jev.policy.thresholds,
        currentGeneration: this.jev.generation,
        now: this.jev.clock(),
      });
      if (advice) assistanceRecord = { source: "jev", recommended: advice.recommendedKey, confidence: advice.confidence, action: outcome.action, reason: outcome.reason, answeredBy: advice.answeredBy };
      if (outcome.action === "accept" && outcome.finalKey !== routerKey) {
        const chosen = pipeline.selection.order.find((candidate) => candidateKey(candidate.provider_id, candidate.model_id) === outcome.finalKey);
        if (chosen) {
          routed = { provider: chosen.provider_id, model: chosen.model_id ?? (chosen.provider_id === decision.recommended_provider ? decision.recommended_model : "auto"), effort: chosen.effort_native };
          decision.recommended_provider = routed.provider;
          decision.recommended_model = routed.model;
          decision.effort_mode = routed.effort;
          decision.selection_reason = outcome.reason;
          launchedModelId = chosen.model_id;
          // `selected` keeps BunnyRouter's own pick for audit; `adopted` is what launched, and reroutes start from it.
          if (assistanceRecord) assistanceRecord.adopted = { provider_id: chosen.provider_id, model_id: chosen.model_id };
        }
      }
      if (advice) {
        decision.decision_assistance = { source: "jev", action: outcome.action, confidence: advice.confidence, changed: !!assistanceRecord?.adopted };
        this.lastAssistance = { at: Date.now(), source: "jev", action: outcome.action, detail: outcome.reason, recommended: advice.recommendedKey, confidence: advice.confidence };
      }
    }
    const task: OrchTask = {
      id: crypto.randomUUID(),
      ...(delegated
        ? { mission: { missionId: delegated.missionId, stepId: delegated.stepId } }
        : {}),
      title: input.prompt.trim().split("\n")[0].slice(0, 80),
      prompt: input.prompt,
      mode: input.mode,
      projectId: project?.id ?? null,
      cwd,
      state: "queued",
      provider: routed.provider,
      model: routed.model,
      decision,
      manual,
      createdAt: Date.now(),
      startedAt: null,
      finishedAt: null,
      output: "",
      error: null,
      logs: [],
      pauseSupported: false,
      sessionId: null,
      pid: null,
      exitCode: null,
      constraints,
      maxRuntimeMs: constraints.maxRuntimeMs ?? 120000,
      verify: input.verify ?? null,
      latestEvent: null,
      progress: null,
      usage: null,
      processTree: null,
      retries: 0,
      effort: routed.effort,
      routingMode,
      routingRerouted: false,
      routingDecisionId,
    };
    if (executionScope) task.executionScope = executionScope;
    if (input.routingPrompt !== undefined) task.routingPrompt = input.routingPrompt;
    this.emit(this.db.write(task, "task.created", "Task created on Bunny-A Host."));
    this.routingStore.saveDecision(
      this.recordDecision({
        id: routingDecisionId,
        taskId: task.id,
        missionId: delegated?.missionId ?? null,
        routingMode,
        pipeline,
        assistance: assistanceRecord,
        ...(selection
          ? {}
          : { terminalNote: "No model facts on this Host; BunnyRouter provider decision stands." }),
      }),
    );
    if (selection) {
      this.emit(
        this.db.event(
          "routing.classified",
          task.id,
          `Task class ${pipeline.requirements.task_class}; tools ${pipeline.requirements.needs_tools?"required":"not required"}; privacy ${pipeline.requirements.privacy_requirement}.`,
          task.mission?.missionId ?? null,
        ),
      );
      this.emit(
        this.db.event(
          "routing.selected",
          task.id,
          `Selected ${routed.provider} · ${launchedModelId ? routed.model : "provider default (exact model unknown)"}${routed.effort ? ` · effort ${routed.effort}` : " · provider default effort"} from ${pipeline.selection.order.length} eligible of ${pipeline.candidates.length} candidates.`,
          task.mission?.missionId ?? null,
        ),
      );
      if (assistanceRecord)
        this.emit(this.db.event("routing.assisted", task.id, `Hosted decision assistance (${assistanceRecord.answeredBy ?? "TypeSafe Jev"}): ${assistanceRecord.action}. ${assistanceRecord.reason}`, task.mission?.missionId ?? null));
    }
    const routing = this.update(
      task,
      { state: "routing" },
      "routing.started",
      "Routing with readiness and hard constraints.",
    );
    return this.update(
      routing,
      { state: "waiting_for_approval", activity: "Waiting for approval" },
      "approval.required",
      decision.reason,
    );
  }
  /** §5/§27: the user's explicit provider (and exact model) selection outranks routing, then the pipeline resolves model+effort on the same eligibility; impossible selections fail clearly. */
  retarget(id: string, provider: ProviderId, modelOverride?: string | null) {
    const task = this.db.get(id);
    if (task.state !== "waiting_for_approval")
      throw new Error("Only pending tasks can be retargeted.");
    const decision = bunnyRoute({
      prompt: task.routingPrompt ?? task.prompt,
      mode: task.mode,
      providers: this.live(),
      override: provider,
      constraints: task.constraints,
      policyId: this.policy.active().id,
    });
    const pipeline = this.routingPipeline({
      routingText: task.routingPrompt ?? task.prompt,
      mode: task.mode,
      providers: this.live(),
      constraints: task.constraints ?? {},
      override: provider,
      modelOverride,
    });
    const selection = pipeline.selection.selected;
    const routingDecisionId = task.routingDecisionId ?? crypto.randomUUID();
    let routed: { model: string; effort: string | null };
    if (selection) {
      routed = {
        model: selection.model_id ?? decision.recommended_model,
        effort: selection.effort_native,
      };
      decision.recommended_provider = selection.provider_id;
      decision.recommended_model = routed.model;
      decision.policy_version = ROUTING_POLICY_VERSION;
      decision.routing_mode = "manual";
      decision.candidate_count = pipeline.candidates.length;
      decision.eligible_candidate_count = pipeline.selection.order.length;
      decision.effort_mode = routed.effort;
      decision.task_requirements = pipeline.requirements;
      decision.reroutes = decision.reroutes ?? 0;
      decision.selection_reason = pipeline.selection.reason;
      decision.candidates = this.pipelineCandidates(pipeline);
    } else if (!this.modelSnapshotHasFacts(pipeline.modelSnapshot)) {
      // Fact-less Host: the explicit provider stands with the legacy model surface (UNKNOWN, not emptiness).
      routed = { model: decision.recommended_model, effort: null };
    } else {
      throw new Error(
        `No eligible model candidate on ${provider}.${modelOverride ? ` The exact model ${modelOverride} could not be honored.` : ""} ${this.pipelineFailure(pipeline)}`,
      );
    }
    this.routingStore.saveDecision(
      this.recordDecision({
        id: routingDecisionId,
        taskId: task.id,
        missionId: task.mission?.missionId ?? null,
        routingMode: "manual",
        pipeline,
        ...(selection
          ? {}
          : { terminalNote: "No model facts on this Host; BunnyRouter provider decision stands." }),
      }),
    );
    return this.update(
      task,
      {
        provider,
        model: routed.model,
        ...(routed.effort ? { effort: routed.effort } : { effort: null }),
        decision,
        manual: true,
        routingMode: "manual",
        routingDecisionId,
      },
      "routing.completed",
      `User selected ${provider}${routed.model && routed.model!=="auto" ? ` · ${routed.model}` : " · provider default (exact model unknown)"}.`,
    );
  }
  /** Appends raw provider output to the Host's private transcript for this task. */
  transcript(id: string) {
    if(!this.sessionDirectory) return null;
    const path=join(this.sessionDirectory,`${id}.jsonl`);
    let written = 0;
    try {
      mkdirSync(this.sessionDirectory, { recursive: true });
    } catch {
      return null;
    }
    return {
      path,
      write: (stream: "stdout" | "stderr", text: string) => {
        if (written > TRANSCRIPT_LIMIT) return;
        const line = JSON.stringify({ at: Date.now(), stream, text }) + "\n";
        written += line.length;
        try {
          appendFileSync(path, line);
        } catch {
          /* Transcript is evidence, not control flow. */
        }
      },
    };
  }
  activity(task: OrchTask, type: string, detail: string, actor: "provider" | "bunny" = "provider") {
    return { type, detail: clip(detail), at: Date.now(), label: activityLabel(type), actor };
  }
  /** Direct user approval. Unchanged contract: launches exactly one task that is waiting for approval. */
  onTaskOutput(id: string, listener: (event: TaskOutputEvent) => void): () => void {
    const set = this.taskOutputListeners.get(id) ?? new Set<(event: TaskOutputEvent) => void>();
    set.add(listener);
    this.taskOutputListeners.set(id, set);
    return () => {
      set.delete(listener);
      if (set.size === 0 && this.taskOutputListeners.get(id) === set) this.taskOutputListeners.delete(id);
    };
  }
  private notifyTaskOutput(id: string, event: TaskOutputEvent) {
    for (const listener of [...(this.taskOutputListeners.get(id) ?? [])]) {
      try {
        listener(event);
      } catch {
        /* a listener never breaks the provider path */
      }
    }
    if ("done" in event) this.taskOutputListeners.delete(id);
  }
  /**
   * M-A-3 T10: admits a spoken chat turn only when it is a local tool-free generation (the same predicate as
   * deviceMayLaunch, with a concrete model), and pins the tool-free route like a device approval does (DEV-01).
   */
  approveVoiceTurn(id: string): OrchTask {
    const task = this.db.get(id);
    if (task.state !== "waiting_for_approval" || task.mission)
      throw new Error("Voice turn is not waiting for approval.");
    const provider = this.live().find((entry) => entry.id === task.provider);
    // privacy#1: the voice gate is explicit about hosted tags. The model must be one the latest probe listed as installed
    // and local, and the probe must have reported its remote tags (an unprobed list is never trusted). The remote check
    // inside execute() is a separate layer (orch/exec.server.ts); this gate does not depend on it.
    const probed = Array.isArray(provider?.remoteModels) && Array.isArray(provider?.models);
    if (
      !task.model ||
      /^(auto|unknown)$/i.test(task.model) ||
      !probed ||
      !provider!.models!.includes(task.model) ||
      provider!.remoteModels!.includes(task.model) ||
      isRemoteOllamaTag({ name: task.model }) ||
      !deviceMayLaunch(task, provider!.remoteModels)
    )
      throw new Error("Voice may admit only a local tool-free generation with a concrete model.");
    this.deviceApproved.add(id);
    return this.launch(
      id,
      { kind: "user", at: Date.now() },
      "approval.voice_tool_free",
      "Spoken question admitted as a local tool-free generation.",
    );
  }
  approve(id: string, by = "workstation"): OrchTask {
    // M-A-3 T9R (DEV-01): a device approved a tool-free route; no launch-time or recovery reroute may leave it.
    // Only an approval that can still launch changes the marker; a refused duplicate approve leaves it intact.
    if (this.db.get(id).state === "waiting_for_approval") {
      if (by.startsWith("device:")) this.deviceApproved.add(id);
      else this.deviceApproved.delete(id);
    }
    const launched = this.launch(
      id,
      { kind: "user", at: Date.now() },
      "approval.accepted",
      "User approved this task and execution root.",
    );
    if (by.startsWith("device:"))
      this.emit(this.db.event("approval.remote_device", id, `Direct task approval by ${by}.`));
    return launched;
  }
  /**
   * Mission-delegated approval: the user approved the mission's authorization envelope, not this child.
   * `check` re-validates the child against that envelope at launch time; anything outside it is refused
   * so the mission stops and asks. Recorded as `approval.delegated`, never as a user click.
   */
  approveDelegated(
    id: string,
    delegation: {
      missionId: string;
      stepId: string;
      authorizationId: string;
      check: (task: OrchTask) => string | null;
    },
  ): OrchTask {
    const task = this.db.get(id);
    if (
      !task.mission ||
      task.mission.missionId !== delegation.missionId ||
      task.mission.stepId !== delegation.stepId
    )
      throw new Error("Delegated approval only applies to this mission's own child task.");
    const outside = delegation.check(task);
    if (outside) throw new Error(`Outside the mission authorization: ${outside}`);
    return this.launch(
      id,
      {
        kind: "mission",
        at: Date.now(),
        authorizationId: delegation.authorizationId,
        missionId: delegation.missionId,
        stepId: delegation.stepId,
      },
      "approval.delegated",
      `Mission-delegated approval under authorization ${delegation.authorizationId} (mission ${delegation.missionId}, step ${delegation.stepId}). The user approved the mission scope, not this individual child task.`,
    );
  }
  private launch(
    id: string,
    approval: NonNullable<OrchTask["approval"]>,
    approvalEvent: string,
    approvalDetail: string,
  ): OrchTask {
    this.containment.assertAccepting("tasks");
    const task = this.db.get(id);
    if (task.state !== "waiting_for_approval")
      throw new Error("Task is not awaiting approval; duplicate launches are refused.");
    const survivor = this.restartSurvivorRefusal(task);
    if (survivor) throw new Error(survivor);
    if (task.projectId) {
      const project = this.projects.forExecution(task.projectId);
      if (task.cwd !== project.path && !task.mission)
        throw new Error("CONTEXT_CHANGED: Task folder differs from its Project.");
    }
    if (task.mission && !task.executionScope)
      throw new Error(
        "Legacy mission child has no provider execution authority; replan and approve the mission again.",
      );
    if (task.mission) {
      const outside = this.missionScopeCheck
        ? this.missionScopeCheck(task)
        : "mission scope validator is unavailable";
      if (outside) throw new Error(`Outside mission execution scope: ${outside}`);
    }
    if (task.executionScope && !["read", "write"].includes(task.executionScope.access))
      throw new Error("Invalid provider execution authority.");
    const preProvider = this.live().find((p) => p.id === task.provider);
    if (!preProvider) throw new Error("Executor is no longer eligible. Route again.");
    const blocked = eligibility(preProvider, task.constraints ?? {});
    if (blocked) throw new Error(`Executor is no longer eligible: ${blocked} Route again.`);
    if (
      (task.constraints?.localOnly || task.constraints?.offlineOnly) &&
      !runsLocally(preProvider, task.model)
    )
      throw new Error(
        `Executor is no longer eligible: ${task.model} is not local inference and this task is local-only. Route again.`,
      );
    // M-A-3 T3 §17/§20: cached discovery is not launch authority. Only pipeline-engaged tasks
    // revalidate here; the pre-T3 legacy path (fact-less fallback) keeps its exact behavior.
    // MANUAL selections fail clearly (§27); AUTO reroutes within the recorded fallback order (§28).
    const engagedTask = this.db.get(id);
    if (engagedTask.decision?.policy_version) {
      const preflight = this.revalidateCandidate(engagedTask);
      if (!preflight.ok) {
        this.emit(
          this.db.event(
            "routing.revalidated",
            id,
            `Launch revalidation failed: ${preflight.reason}`,
          ),
        );
        if (engagedTask.routingMode === "manual")
          throw new Error(
            `The selected ${engagedTask.provider} ${engagedTask.model==="auto"?"provider default":`model ${engagedTask.model}`} is unavailable: ${preflight.reason} Route again.`,
          );
        const alternate = this.rerouteFromDecision(engagedTask, {
          exclude: [
            {
              provider: engagedTask.provider,
              model: engagedTask.model === "auto" ? null : engagedTask.model,
            },
          ],
        });
        if (!alternate)
          throw new Error(`No eligible model is available: ${preflight.reason} Route again.`);
        const label = `${alternate.provider}${alternate.model && alternate.model!=="auto" ? ` · ${alternate.model}` : " · provider default"}`;
        this.bumpReroutes(engagedTask,`Rerouted to ${label}: ${preflight.reason}`);
        this.update(
          engagedTask,
          {
            provider: alternate.provider,
            model: alternate.model,
            ...(alternate.effort ? { effort: alternate.effort } : { effort: null }),
            routingRerouted: true,
            decision: {
              ...engagedTask.decision,
              recommended_provider: alternate.provider,
              recommended_model: alternate.model,
              reroutes: (engagedTask.decision.reroutes ?? 0) + 1,
            },
          },
          "routing.rerouted",
          `Launch revalidation failed (${preflight.reason}); re-routed to ${label}.`,
        );
      } else {
        this.emit(
          this.db.event(
            "routing.revalidated",
            id,
            `Launch revalidation passed for ${engagedTask.provider}${engagedTask.model==="auto" ? " · provider default" : ` · ${engagedTask.model}`}.`,
          ),
        );
      }
    }
    const provider=this.live().find((p) =>p.id===this.db.get(id).provider);if(!provider) throw new Error("Executor is no longer eligible. Route again.");
    const adapter=this.adapters.find((a) =>a.id===provider.id);if(!adapter) throw new Error("Adapter unsupported.");
    if(!task.cwd || realpathSync(task.cwd)!==task.cwd || !statSync(task.cwd).isDirectory()) throw new Error("Execution root changed or is unavailable.");
    // M-A-3 T9R-F01: a launch-time reroute may have changed provider or model; the session that actually starts
    // passes the Mission scope check again (this also spends a trusted-desktop grant exactly once).
    const final = this.db.get(id);
    if (final.mission) {
      const outside = this.missionScopeCheck ? this.missionScopeCheck(final, "check") : "mission scope validator is unavailable";
      if (outside) throw new Error(`Outside mission execution scope: ${outside}`);
    }
    const admissionViolation = this.missionAttemptAdmission?.(final, "action");
    if (admissionViolation) throw new Error(`Outside current Agentic authority: ${admissionViolation}`);
    // Last refusal point before the session starts: this spends a single-use trusted-desktop grant, if one applies.
    if (final.mission) {
      const spent = this.missionScopeCheck ? this.missionScopeCheck(final, "launch") : "mission scope validator is unavailable";
      if (spent) throw new Error(`Outside mission execution scope: ${spent}`);
    }
    const accepted = this.update(
      task,
      {
        state: "launching",
        startedAt: Date.now(),
        activity: "Starting",
        ...(approval.kind === "mission" ? { approval } : {}),
      },
      approvalEvent,
      approvalDetail,
    );
    const launching = this.update(
      accepted,
      {
        latestEvent: this.activity(
          accepted,
          "agent.starting",
          `${provider.name} starting in ${task.cwd}.`,
        ),
        progress: { kind: "indeterminate" },
      },
      "agent.starting",
      `${provider.name} starting in ${task.cwd}.`,
    );
    // Streamed chunks are coalesced: one record write, event and log-free update per flush instead of per token.
    let pending = "";
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    let pendingProgress: TaskProgress | null = null;
    let reportedUsage: TokenUsage | null = null;
    const flush = () => {
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      if (!pending) return;
      const text = pending;
      pending = "";
      const current = this.db.get(id);
      if (TERMINAL.includes(current.state)) return;
      const line = lastLine(text);
      this.update(
        current,
        {
          output: (current.output + text).slice(-2_000_000),
          ...(line ? { latestEvent: this.activity(current, "agent.output", line) } : {}),
        },
        "agent.output",
        `${text.length} characters of output`,
        true,
      );
    };
    this.flushers.set(id, flush);
    const record = this.transcript(id);
    // M-A-3 T3 §22: one hooks object shared by the initial launch and every relaunch; each
    // handler re-reads the live task record, so provider/model reroutes flow through unrebound.
    const adapterHooks: AdapterHooks = {
      owner: { dataDirectory: this.dataDirectory, hostGeneration: this.instanceId, taskId: id, missionId: task.mission?.missionId ?? null, agentId: this.missionTaskAgent?.(task) ?? this.agentForMission(task.mission?.missionId ?? null) },
      event: (type, detail) => {
        // Output that arrived first is written first, so the latest activity is really the latest.
        flush();
        const current = this.db.get(id);
        if (TERMINAL.includes(current.state) || this.stopping.has(id)) return;
        const progress = pendingProgress;
        pendingProgress = null;
        const visible = type.startsWith("agent.");
        this.update(
          current,
          {
            activity: activityLabel(type),
            ...(visible ? { latestEvent: this.activity(current, type, detail) } : {}),
            ...(progress ? { progress } : {}),
          },
          type,
          detail,
        );
      },
      session: (sessionId, pid) => {
        // Providers repeat their session id on every message; only a new id or PID is recorded.
        const current = this.db.get(id);
        if (
          (sessionId ?? current.sessionId) === current.sessionId &&
          (pid ?? current.pid) === current.pid
        )
          return;
        this.update(
          current,
          { sessionId: sessionId ?? current.sessionId, pid: pid ?? current.pid },
          "session.recorded",
          `Provider session ${sessionId ?? current.sessionId ?? "pending"}; PID ${pid ?? current.pid ?? "none"}.`,
        );
        if (pid) this.watchTree(id);
      },
      model: (model) => {
        const current = this.db.get(id);
        if (current.model !== model)
          this.update(current, { model }, "executor.model", `Provider reported model ${model}.`);
      },
      output: (text) => {
        this.notifyTaskOutput(id, { text });
        pending += text;
        if (pending.length > 2_000_000) pending = pending.slice(-2_000_000);
        flushTimer ??= setTimeout(
          this.containment.guard({ subsystem: "tasks", taskId: id }, flush, (error) =>
            this.failOperation(id, error),
          ),
          300,
        );
      },
      progress: (progress) => {
        pendingProgress = progress;
      },
      usage: (usage) => {
        reportedUsage = usage;
      },
      rateLimits: (windows, status) => {
        this.registry.recordSessionUsage(this.db.get(id).provider, windows, status);
        // Session-reported usage is re-derived in the background so the snapshot and events stay in step.
        this.containment.background({ subsystem: "provider-usage", taskId: id }, () =>
          this.providerUsage.refresh(),
        );
      },
      raw: (stream, text) => record?.write(stream, text),
    };
    let runtimeTimer: ReturnType<typeof setTimeout> | null = null;
    /** T3 §22/§24: one bounded relaunch — fresh authority snapshot, same hooks, per-attempt runtime budget. Returns null when the target cannot honor the same envelope. */
    const startSession = (
      target: { provider: ProviderId; model: string; effort: string | null },
      options: { detail: string; bumpReroutes: boolean },
    ): RunningSession | null => {
      try {
        const current = this.db.get(id);
        if (current.projectId) this.projects.forExecution(current.projectId);
        if (TERMINAL.includes(current.state) || this.stopping.has(id)) return null;
        const targetProvider = this.live().find((p) => p.id === target.provider);
        if (!targetProvider) return null;
        const targetBlocked = eligibility(targetProvider, current.constraints ?? {});
        if (targetBlocked) return null;
        if (
          (current.constraints?.localOnly || current.constraints?.offlineOnly) &&
          !runsLocally(targetProvider, target.model)
        )
          return null;
        const targetAdapter = this.adapters.find((a) => a.id === target.provider);
        if (!targetAdapter) return null;
        const rerouting = current.provider !== target.provider || current.model !== target.model;
        const targetTask = { ...current, provider: target.provider, model: target.model, effort: target.effort ?? null };
        if (targetTask.mission) {
          // M-A-3 T9R-F01: every relaunch is a new session start, so it spends a trusted-desktop grant like a launch.
          const outside =
            this.missionScopeCheck?.(targetTask, "check") ??
            this.missionAttemptAdmission?.(targetTask, rerouting ? "reroute" : "retry") ??
            this.missionScopeCheck?.(targetTask, "launch");
          if (outside) {
            this.emit(
              this.db.event(
                "agent.action_denied",
                id,
                "Retry/reroute rejected by current Host authorization.",
                targetTask.mission.missionId,
              ),
            );
            return null;
          }
        }
        const retried = this.update(
          current,
          {
            ...(current.state === "verifying" ? { state: "running" } : {}),
            provider: target.provider,
            model: target.model,
            ...(target.effort ? { effort: target.effort } : { effort: null }),
            ...(rerouting
              ? {
                  routingRerouted: true,
                  decision: {
                    ...current.decision,
                    recommended_provider: target.provider,
                    recommended_model: target.model,
                    reroutes: (current.decision?.reroutes ?? 0) + 1,
                  },
                }
              : {}),
            latestEvent: this.activity(current, "agent.starting", options.detail),
          },
          "routing.retrying",
          options.detail,
        );
        if (options.bumpReroutes) this.bumpReroutes(retried, options.detail);
        if (runtimeTimer) clearTimeout(runtimeTimer);
        runtimeTimer = setTimeout(
          () => this.stopInBackground(id, "Runtime limit reached."),
          Math.min(
            retried.maxRuntimeMs ?? 120000,
            this.missionAttemptRuntimeLimit?.(retried) ?? Infinity,
          ),
        );
        // Adapters receive a detached, immutable authority snapshot, never the persisted task object.
        const adapterTask = structuredClone(retried);
        if (adapterTask.executionScope) Object.freeze(adapterTask.executionScope);
        if (adapterTask.mission) Object.freeze(adapterTask.mission);
        Object.freeze(adapterTask);
        const nextSession = targetAdapter.launch(adapterTask, adapterHooks);
        this.sessions.set(id, nextSession);
        return nextSession;
      } catch (error) {
        this.missionAttemptSettled?.(this.db.get(id), false);
        this.emit(
          this.db.event(
            "routing.retrying",
            id,
            `Relaunch on ${target.provider} could not start: ${safeError(error).message}`,
          ),
        );
        return null;
      }
    };
    let session: RunningSession;
    try {
      // Adapters receive a detached, immutable authority snapshot, never the persisted task object.
      const adapterTask = structuredClone(launching);
      if (adapterTask.executionScope) Object.freeze(adapterTask.executionScope);
      if (adapterTask.mission) Object.freeze(adapterTask.mission);
      Object.freeze(adapterTask);
      session = adapter.launch(adapterTask, adapterHooks);
    } catch (error) {
      this.missionAttemptSettled?.(this.db.get(id), false);
      this.flushers.delete(id);
      const message = safeError(error).message;
      return this.update(
        launching,
        {
          state: "failed",
          finishedAt: Date.now(),
          error: message,
          latestEvent: this.activity(launching, "agent.failed", message),
        },
        "task.failed",
        message,
      );
    }
    this.sessions.set(id, session);
    const running = this.update(
      this.db.get(id),
      {
        state: "running",
        activity: "Running",
        ...(record
          ? {
              logs: [
                ...this.db.get(id).logs,
                { at: Date.now(), line: `Raw session transcript: ${record.path}` },
              ],
            }
          : {}),
      },
      "executor.starting",
      "Execution active. Progress indeterminate until the provider publishes a plan.",
    );
    runtimeTimer = setTimeout(
      () => this.stopInBackground(id, "Runtime limit reached."),
      Math.min(task.maxRuntimeMs ?? 120000, this.missionAttemptRuntimeLimit?.(task) ?? Infinity),
    );
    this.containment.background({ subsystem: "tasks", taskId: id, ...task.mission }, async () => {
      try {
        // M-A-3 T3 §22/§23/§24: bounded, taxonomy-driven recovery around the SAME state machine.
        // Terminal states never recover; MANUAL selections never reroute (§5); every bound is
        // RECOVERY_BOUNDS. The failed transition stays deferred while an attempt still stands.
        let attempt = 0;
        let sameRetries = 0;
        let alternates = 0;
        let escalations = 0;
        const attempted: {
          provider_id: ProviderId;
          model_id: string | null;
          taxonomy: RoutingFailureTaxonomy;
        }[] = [];
        for (;;) {
          const result = await session.done;
          this.missionAttemptSettled?.(this.db.get(id), result.ok);
          flush();
          this.stopTree(id);
          // M-A-3 T9R-F01: this attempt's descendants stay tracked even if a retry or reroute replaces the session.
          this.watchSurvivors(id, session.pid?.() ?? this.db.get(id).pid ?? undefined, session);
          if (this.stopping.has(id)) return;
          const current = this.db.get(id);
          if (TERMINAL.includes(current.state)) return;
          if (["draining", "fatal"].includes(this.containment.health.operationalState)) {
            await this.failOperation(id, {
              name: "HostFatal",
              message: "Host fatal shutdown interrupted this owned task; no session was resumed.",
            });
            return;
          }
          let state: TaskState = result.stopped ? "stopped" : result.ok ? "completed" : "failed";
          let verification = current.verification ?? null;
          let error = result.error ?? null;
          if (state === "completed" && current.verify) {
            const spec = current.verify;
            const verifying = this.update(
              current,
              {
                state: "verifying",
                activity: "Verifying",
                latestEvent: this.activity(
                  current,
                  "agent.verifying",
                  `Bunny-A is checking ${spec.name} itself.`,
                  "bunny",
                ),
              },
              "agent.verifying",
              `Bunny-A is independently verifying ${spec.name}.`,
            );
            // M-A-3 T9R-F01: a Python check is a code run; it never starts over unreviewed paired-device changes.
            const held = spec.kind === "python" ? this.codeRunGate?.() ?? null : null;
            verification = held ? { passed: false, detail: held } : await verifySpec(verifying, spec);
            this.update(
              this.db.get(id),
              { verification },
              "verification.completed",
              verification.detail,
            );
            if (!verification.passed) {
              state = "failed";
              error = `Bunny-A verification failed: ${verification.detail}`;
            }
          }
          const latest = this.db.get(id);
          if (TERMINAL.includes(latest.state) || this.stopping.has(id)) return;
          if (["draining", "fatal"].includes(this.containment.health.operationalState)) {
            await this.failOperation(id, {
              name: "HostFatal",
              message: "Host fatal shutdown interrupted verification; no success was recorded.",
            });
            return;
          }
          let detail =
            state === "completed"
              ? verification
                ? `Completed and verified by Bunny-A: ${verification.detail}`
                : "Provider process completed; no independent verification was requested."
              : (error ?? `Provider process ${state}.`);
          if (state === "failed") {
            const verificationFailed =
              verification != null &&
              !verification.passed &&
              (error ?? "").startsWith("Bunny-A verification failed:");
            const taxonomy = classifyFailure({
              error,
              stopped: result.stopped,
              exitCode: result.exitCode,
              verificationFailed,
            });
            attempted.push({
              provider_id: current.provider,
              model_id: current.model === "auto" ? null : current.model,
              taxonomy,
            });
            try {
              this.routingStore.saveAttempt({
                id: crypto.randomUUID(),
                decisionId: current.routingDecisionId ?? `direct-${current.id.slice(0,8)}`,
                taskId: current.id,
                attemptIndex: attempt,
                provider: current.provider,
                model: current.model === "auto" ? null : current.model,
                effort: current.effort ?? null,
                taxonomy,
                detail: (error ?? "").slice(0, 300),
                createdAt: Date.now(),
              });
            } catch {
              /* Evidence only. */
            }
            const tried = [
              ...attempted.map((entry) => ({ provider: entry.provider_id, model: entry.model_id })),
              {
                provider: current.provider,
                model: current.model === "auto" ? null : current.model,
              },
            ];
            const exhaustNow = (reason: string) => {
              error = `${error ?? "The task failed."} ${exhaustionNote(attempted)} — ${reason}`;
              detail = error;
              this.emit(
                this.db.event(
                  "routing.exhausted",
                  id,
                  clip(exhaustionNote(attempted), 240),
                  current.mission?.missionId ?? null,
                ),
              );
            };
            const action = planRecovery({
              taxonomy,
              attemptIndex: attempt,
              sameRetriesUsed: sameRetries,
              alternatesUsed: alternates,
              escalationsUsed: escalations,
              reroutesUsed: alternates,
              policyAllows: true,
            });
            if (action.action === "fail") exhaustNow(action.reason);
            else if (current.routingMode === "manual" && action.action !== "retry-same")
              exhaustNow(
                `Manual model selection is fixed; the task failed instead of re-routing. ${action.reason}`,
              );
            else if (action.action === "retry-same") {
              sameRetries += 1;
              const label = `${current.provider}${current.model==="auto" ? " · provider default" : ` · ${current.model}`}`;
            const retried=startSession({provider:current.provider,model:current.model,effort:current.effort ?? null,
                },{detail:`Re-attempting ${label} after ${taxonomy}: ${action.reason}`,
                  bumpReroutes: false,
                },
              );
              if (retried) {
                session = retried;
                attempt += 1;
                continue;
              }
              exhaustNow("The same candidate could not be relaunched.");
            } else if (action.action === "escalate-effort") {
              escalations += 1;
              const ladder = Object.values(
                PROVIDER_EFFORT_CONTRACTS[current.provider].native ?? {},
              ) as string[];
              const raised = current.effort
                ? (ladder[ladder.indexOf(current.effort) + 1] ?? null)
                : ladder.length > 1
                  ? ladder[ladder.length - 2]
                  : (ladder[0] ?? null);
              const target = raised
                ? { provider: current.provider, model: current.model, effort: raised }
                : this.rerouteFromDecision(current, { exclude: tried });
              if (!target)
                exhaustNow(
                  `verification failed and no effort ladder or alternate candidate remains (${action.reason})`,
                );
              else {
                const label = `${target.provider}${target.model!=="auto" ? ` · ${target.model}` : " · provider default"}`;
              const retried=startSession(target,{detail:`Re-executing ${label}${raised ? ` at ${raised} effort` : " on an alternate candidate"} after a failed verification; Bunny-A verifies again on completion (§24).`,bumpReroutes:!raised,
                });
              if(retried) {session=retried;attempt+=1;continue;}
              exhaustNow("The escalated candidate could not be relaunched.");
            }
          } else {
            alternates+=1;
            const target=action.action==="reroute-larger-context" ? this.rerouteFromDecision(current,{exclude:tried,largerContext:true}) : this.rerouteFromDecision(current,{exclude:tried});
            if(!target) exhaustNow(action.reason);
            else {
              const label=`${target.provider}${target.model!=="auto" ? ` · ${target.model}` : " · provider default"}`;
              this.emit(this.db.event("routing.rerouted",id,`Rerouted to ${label} after ${taxonomy} on ${current.provider}${current.model==="auto" ? " · provider default" : ` · ${current.model}`}.`,
                  ),
                );
              const retried=startSession(target,{detail:`Routing to ${label} after ${taxonomy}: ${action.reason}`,
                  bumpReroutes: true,
                });
                if (retried) {
                  session = retried;
                  attempt += 1;
                  continue;
                }
                exhaustNow("The alternate candidate could not be relaunched.");
              }
            }
          }
          const finished = this.update(
            latest,
            {
              state,
              finishedAt: Date.now(),
              output: result.output || latest.output,
              error: state === "completed" ? null : error,
              exitCode: result.exitCode ?? null,
              activity: activityLabel(`task.${state}`),
              verification,
              usage: reportedUsage ?? latest.usage ?? null,
              latestEvent: this.activity(
                latest,
                `agent.${state}`,
                detail,
                verification ? "bunny" : "provider",
              ),
            },
            `task.${state}`,
            detail,
          );
          if (finished.provider === "codex")
            this.containment.background({ subsystem: "provider-usage" }, async () => {
              await this.registry.refreshUsage("codex");
              await this.providerUsage.refresh();
            });
          break;
        }
      } catch (error) {
        await this.containment.contain(error, "boundary", {
          owner: { subsystem: "tasks", taskId: id, ...task.mission },
          fail: (error) => this.failOperation(id, error),
        });
      } finally {
        if (runtimeTimer) clearTimeout(runtimeTimer);
        if (flushTimer) clearTimeout(flushTimer);
        this.stopTree(id);
        this.flushers.delete(id);
        // M-A-3 T9R-F01: descendants of the ended root process stay "live code" until none survives.
        try { this.watchSurvivors(id, this.sessions.get(id)?.pid?.() ?? this.db.get(id).pid ?? undefined, this.sessions.get(id)); } catch { /* fail closed below */ }
        this.sessions.delete(id);
      }
    });
    return running;
  }
  /** Snapshots the owned process tree shortly after launch and then periodically; an event only when it changes. */
  watchTree(id: string) {
    if (this.treeTimers.has(id)) return;
    const tick = async () => {
      const pid = this.sessions.get(id)?.pid?.() ?? this.db.get(id).pid;
      if (pid && this.sessions.has(id)) {
        const rows = await this.readProcesses().catch(() => null);
        const current = this.db.get(id);
        if (rows && !TERMINAL.includes(current.state) && !this.stopping.has(id)) {
          const tree = descendants(rows, pid);
          if (
            tree.length &&
            tree.map((row) => row.pid).join(",") !==
              (current.processTree ?? []).map((row) => row.pid).join(",")
          )
            this.update(
              current,
              { processTree: tree, processTreeAt: Date.now() },
              "session.process_tree",
              describeTree(tree),
              true,
            );
        }
      }
      if (this.treeTimers.has(id))
        this.treeTimers.set(
          id,
          setTimeout(
            () =>
              this.containment.background(
                { subsystem: "process-observation", taskId: id },
                tick,
                () => this.stopTree(id),
              ),
            15000,
          ),
        );
    };
    this.treeTimers.set(
      id,
      setTimeout(
        () =>
          this.containment.background({ subsystem: "process-observation", taskId: id }, tick, () =>
            this.stopTree(id),
          ),
        2000,
      ),
    );
  }
  /**
   * Tracks what a finished session leaves behind until none of it survives. The lineage only grows: the root, every
   * process the tree snapshots saw, and every process later found descending from any lineage member (alive or
   * already exited, born after it). One entry per ended attempt, so a retry never hides an earlier attempt's survivors.
   */
  watchSurvivors(id: string, rootPid: number | undefined, attempt?: object) {
    // M-A-3 T9R-F04: a job-contained attempt is judged by kernel job accounting, not by process samples.
    const contained = (attempt as RunningSession | undefined)?.containment;
    if (contained) { if (!this.survivorAttempts.has(attempt!)) { this.survivorAttempts.add(attempt!); this.watchContainedJob(id, contained); } return; }
    // One watcher per ended attempt (keyed by the session object, never by a PID that the OS may recycle).
    if (!rootPid || (attempt && this.survivorAttempts.has(attempt))) return;
    if (attempt) this.survivorAttempts.add(attempt);
    const key = `${id}#${++this.survivorWatches}`;
    this.lingering.set(key, "checking");
    try { const task = this.db.get(id); this.lingeringAttempt.set(key, { provider: task.provider, access: task.executionScope?.access, mission: !!task.mission }); } catch { /* unknown: fail closed */ }
    const snapshot = (() => { try { return this.db.get(id).processTree ?? []; } catch { return []; } })();
    const lineage = new Map<number, number | null>([[rootPid, snapshot.find((row) => row.pid === rootPid)?.createdAt ?? null]]);
    for (const row of snapshot) lineage.set(row.pid, row.createdAt);
    const check = async () => {
      const rows = await this.readProcesses().catch(() => null);
      if (!rows) { setTimeout(() => void check(), 10_000).unref?.(); return; }
      const alive = new Map<number, ProcessInfo>();
      for (const row of rows) {
        if (!lineage.has(row.pid)) continue;
        const born = lineage.get(row.pid);
        if (born === null || born === undefined || row.createdAt === born) alive.set(row.pid, row);
      }
      for (let grew = true; grew; ) {
        grew = false;
        for (const row of rows) {
          if (alive.has(row.pid) || !lineage.has(row.ppid)) continue;
          const parentBorn = lineage.get(row.ppid);
          if (row.createdAt !== null && parentBorn !== null && parentBorn !== undefined && row.createdAt < parentBorn) continue;
          if (lineage.has(row.pid) && lineage.get(row.pid) !== row.createdAt && lineage.get(row.pid) !== null) continue;
          alive.set(row.pid, row); lineage.set(row.pid, row.createdAt); grew = true;
        }
      }
      if (!alive.size) { this.lingering.delete(key); this.lingeringAttempt.delete(key); return; }
      this.lingering.set(key, [...alive.values()]);
      setTimeout(() => void check(), 10_000).unref?.();
    };
    void check();
  }
  /** Live code until the attempt's job reports 0 active processes; a refused admission never ran anything. */
  watchContainedJob(id: string, containment: () => import("./contracts.ts").SessionContainment) {
    const settled = (state: string) => state === "empty" || state === "refused";
    if (settled(containment().state)) return;
    const key = `${id}#${++this.survivorWatches}`;
    this.lingering.set(key, "checking");
    try { const task = this.db.get(id); this.lingeringAttempt.set(key, { provider: task.provider, access: task.executionScope?.access, mission: !!task.mission }); } catch { /* unknown: fail closed */ }
    const check = () => {
      if (this.disposed) return;
      if (settled(containment().state)) { this.lingering.delete(key); this.lingeringAttempt.delete(key); return; }
      setTimeout(check, 500).unref?.();
    };
    check();
  }
  /** The Agent that owns a Mission, for job-record identity only (never an authority input). */
  agentForMission(missionId: string | null): string | null {
    if (!missionId) return null;
    try { return (this.db.db.prepare("SELECT id FROM agents WHERE mission_id=? ORDER BY created_at LIMIT 1").get(missionId) as { id: string } | undefined)?.id ?? null; } catch { return null; }
  }
  stopTree(id: string) {
    const timer = this.treeTimers.get(id);
    if (timer) clearTimeout(timer);
    this.treeTimers.delete(id);
  }
  /**
   * M-A-3 T9R-F04 Stop of a job-contained session: the session terminates its exact Windows job (the kernel kills every
   * member, including orphans whose parent exited) and the result comes from job accounting. No PID list, process
   * name or table sample is kill authority.
   */
  async stopContained(id: string, detail: string, session: RunningSession) {
    await session.stop();
    this.flushers.get(id)?.();
    this.stopTree(id);
    const job = session.containment!();
    const stopCleanup: NonNullable<OrchTask["stopCleanup"]> = { status: "complete", inspectedAt: Date.now(), unresolvedProcessCount: 0, terminationFailures: 0 };
    let cleanup: string;
    if (!job.admitted && (job.state === "empty" || job.state === "refused" || job.state === "launching")) cleanup = " No provider process was admitted for this session.";
    else if (job.state === "empty") cleanup = ` Windows job verified empty by kernel accounting: ${job.terminatedAtEnd === null ? "an unknown number of" : job.terminatedAtEnd} process(es) in the job when it was terminated ended with it, including any descendant whose parent had exited.`;
    else {
      stopCleanup.status = "cleanup_incomplete";
      stopCleanup.unresolvedProcessCount = job.activeProcesses !== null && job.activeProcesses >= 0 ? job.activeProcesses : null;
      cleanup = ` Cleanup incomplete: ${job.detail}`;
    }
    if (stopCleanup.status !== "complete") this.emit(this.db.event("task.cleanup_incomplete", id, cleanup.trim()));
    const current = this.db.get(id);
    if (!canTransition(current.state, "stopped")) return current;
    return this.update(
      current,
      {
        state: "stopped", finishedAt: Date.now(),
        activity: stopCleanup.status === "complete" ? "Stopped" : "Stopped; cleanup incomplete",
        stopReason: detail, stopCleanup,
        latestEvent: this.activity(current, "agent.stopped", detail + cleanup, "bunny"),
      },
      "task.stopped",
      detail + cleanup,
    );
  }
  /** Stops in flight, so Host shutdown can wait for their final accounting before the database closes. */
  stopsInFlight = new Map<string, Promise<unknown>>();
  async settleStops() { await Promise.allSettled([...this.stopsInFlight.values()]); }
  async stop(id: string, detail = "User stopped the selected task.") {
    const task = this.db.get(id);
    if (!canTransition(task.state, "stopped")) throw new Error("Task has already ended.");
    if (this.stopping.has(id)) throw new Error("Stop already in progress.");
    const running = this.stopNow(id, detail);
    this.stopsInFlight.set(id, running);
    try { return await running; } finally { this.stopsInFlight.delete(id); }
  }
  private async stopNow(id: string, detail: string) {
    this.stopping.add(id);
    try {
      const session = this.sessions.get(id);
      if (session?.containment) return await this.stopContained(id, detail, session);
      // Pre-stop observations remain evidence only; failed fresh inspection confers no kill authority.
      const root = session?.pid?.() ?? null;
      const initial = root ? await this.readProcesses().catch(() => null) : [];
      const before = root && initial ? descendants(initial, root) : [];
      // Abort request is issued before marking stopped; cancellation errors are honest failures.
      await session?.stop();
      this.flushers.get(id)?.();
      this.stopTree(id);
      let cleanup = "";
      const stopCleanup: NonNullable<OrchTask["stopCleanup"]> = {
        status: "complete",
        inspectedAt: Date.now(),
        unresolvedProcessCount: 0,
        terminationFailures: 0,
      };
      if (root) {
        const fresh = await this.readProcesses().catch(() => null);
        if (
          !initial ||
          !before.length ||
          !fresh ||
          before.some((row) => !sameProcessIdentity(row, row))
        ) {
          stopCleanup.status = "ownership_unverified";
          stopCleanup.unresolvedProcessCount = before.length || null;
          cleanup =
            " Cleanup ownership unverified: process inspection or lifetime identity is unavailable. Session Stop was requested; no snapshot-based termination was attempted and remaining ownership is unresolved.";
        } else {
          let alive = survivors(before, fresh);
          for (const row of alive) {
            // Native termination checks lifetime/image on the very handle it terminates.
            try {
              await killProcess(row);
            } catch {
              stopCleanup.terminationFailures++;
            }
          }
          const verified = alive.length ? await this.readProcesses().catch(() => null) : fresh;
          stopCleanup.inspectedAt = Date.now();
          if (!verified) {
            stopCleanup.status = "ownership_unverified";
            stopCleanup.unresolvedProcessCount = alive.length;
            cleanup =
              " Cleanup ownership unverified: final process inspection failed. Remaining ownership is unresolved; no previous table was reused.";
          } else {
            alive = survivors(before, verified);
            stopCleanup.unresolvedProcessCount = alive.length;
            stopCleanup.status =
              alive.length || stopCleanup.terminationFailures ? "cleanup_incomplete" : "complete";
            cleanup =
              stopCleanup.status !== "complete"
                ? ` Cleanup incomplete: ${alive.length} corroborated owned process(es) remain; ${stopCleanup.terminationFailures} identity-checked termination(s) refused or failed.`
                : // M-A-3 T9R-F03: only recorded processes can be verified; one spawned after the last sample is not seen.
                  ` Verified ${before.length} recorded process lifetime(s) ended; none of the recorded processes remain (${describeTree(before)}). A process spawned after the last process sample, or not recorded in it, is not tracked.`;
          }
        }
      } else if (session) cleanup = " No OS process belonged to this session (in-process request).";
      if (stopCleanup.status !== "complete")
        this.emit(this.db.event("task.cleanup_incomplete", id, cleanup.trim()));
      const current = this.db.get(id);
      if (!canTransition(current.state, "stopped")) return current;
      const stopped = this.update(
        current,
        {
          state: "stopped",
          finishedAt: Date.now(),
          activity: stopCleanup.status === "complete" ? "Stopped" : "Stopped; cleanup incomplete",
          stopReason: detail,
          stopCleanup,
          latestEvent: this.activity(current, "agent.stopped", detail + cleanup, "bunny"),
          ...(before.length ? { processTree: before, processTreeAt: Date.now() } : {}),
        },
        "task.stopped",
        detail + cleanup,
      );
      return stopped;
    } finally {
      this.stopping.delete(id);
    }
  }
  /** Host-owned session view; the same record every UI reconnects to. */
  getSession(id: string): AgentSession {
    const task = this.db.get(id);
    return {
      taskId: task.id,
      provider: task.provider,
      providerSessionId: task.sessionId ?? null,
      pid: task.pid ?? null,
      processTree: task.processTree ?? null,
      projectId: task.projectId,
      cwd: task.cwd ?? null,
      startedAt: task.startedAt,
      finishedAt: task.finishedAt,
      state: task.state,
      latestEvent: task.latestEvent ?? null,
      progress: task.progress ?? null,
      logs: task.logs.slice(-100),
      result: task.output.slice(-20000),
      error: task.error,
      exitCode: task.exitCode ?? null,
      owned: this.sessions.has(id),
      features: this.registry.get(task.provider)?.features ?? null,
      transcript:
        this.sessionDirectory && task.startedAt
          ? join(this.sessionDirectory, `${task.id}.jsonl`)
          : null,
    };
  }
  /** Replays a task's events, then follows live ones until the task ends. */
  async *streamEvents(id: string, after = 0): AsyncGenerator<HostEvent> {
    let cursor = after;
    for (;;) {
      const events = this.db.taskEvents(id, cursor);
      for (const event of events) {
        cursor = event.sequence;
        yield event;
      }
      if (events.length === 500) continue;
      if (TERMINAL.includes(this.db.get(id).state)) return;
      await new Promise<void>((resolveWait) => {
        const done = () => {
          clearTimeout(timeout);
          this.bus.off("event", onEvent);
          resolveWait();
        };
        const onEvent = (event: HostEvent) => {
          if (event.taskId === id) done();
        };
        const timeout = setTimeout(done, 15000);
        this.bus.on("event", onEvent);
      });
    }
  }
  async sendInput(id: string, input: string) {
    const task = this.db.get(id);
    const session = this.sessions.get(id);
    if (!session) throw new Error("No live Bunny-A session for this task.");
    if (!session.sendInput)
      throw new Error(
        `Input unavailable: ${this.registry.get(task.provider)?.features?.sendInput.note ?? "this provider session does not accept input."}`,
      );
    await session.sendInput(input);
    this.update(
      this.db.get(id),
      {},
      "session.input",
      `${input.length} characters sent to the session.`,
    );
  }
  /** Terminal attachment is reported per provider; Bunny-A never opens an unrelated terminal in its place. */
  terminal(id: string): never {
    const task = this.db.get(id);
    const feature = this.registry.get(task.provider)?.features?.terminalAttachment;
    throw new Error(
      `Terminal attachment unavailable: ${feature?.note ?? "this provider exposes no terminal."}`,
    );
  }
  feedback(id: string, value: "positive" | "negative") {
    const task = this.db.get(id);
    if (!TERMINAL.includes(task.state)) throw new Error("Feedback is recorded after a task ends.");
    const next = this.update(
      task,
      { feedback: value },
      "task.feedback",
      `User feedback: ${value}.`,
    );
    if (next.startedAt) this.db.outcome(next);
    return next;
  }
  importLegacy(tasks: OrchTask[], projects: Project[]) {
    // Idempotent migration; never launch a legacy task or invent its old session.
    const known = new Set(this.db.tasks().map((task) => task.id));
    for (const project of projects) {
      try {
        const root = realpathSync(project.path);
        if (statSync(root).isDirectory() && !this.db.projects().some((p) => p.id === project.id))
          this.db.project({ ...project, path: root });
      } catch {
        /* Preserve browser backup; unavailable roots are not authorized. */
      }
    }
    for (const original of tasks) {
      if (known.has(original.id)) continue;
      const task = { ...original };
      if (!["completed", "failed", "stopped"].includes(task.state)) {
        task.state = "stopped";
        task.error =
          "Imported browser-only task has no Host-owned session. Route again to execute.";
        task.finishedAt = Date.now();
      }
      this.emit(
        this.db.write(
          task,
          "task.imported",
          "Imported prior browser history; no execution launched.",
        ),
      );
      known.add(task.id);
    }
  }
}
