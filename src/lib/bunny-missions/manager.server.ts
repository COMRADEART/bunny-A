import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { liveHostCodeRuns } from "../bunny-host/owned-process-group.server.ts";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import type { TaskManager } from "../bunny-host/manager.server.ts";
import type { HostEvent } from "../bunny-host/contracts.ts";
import type { Mode, OrchTask, ProviderId, TaskConstraints, VerifySpec } from "../orch/types.ts";
import { codexMissionExclusion } from "../orch/compatibility.ts";
import { ArtifactStore } from "./artifacts.server.ts";
import { agenticFingerprint, agenticOperationDigest, agenticScopeViolation, capabilityOperation, DESKTOP_GRANT_MAX_USES, DESKTOP_GRANT_TTL_MS, DESKTOP_REQUIRED, desktopGrantViolation, envelopeFrom, derivedEnvelope, derivedScopeViolations, isRemoteEnvelope, isTrustedLocalActor, matches, MODE_BUDGET, classifyDeviceWrite, PHONE_SAFE_CLASSES, providerScopeViolation, providerSessionAuthority, REMOTE_SESSION_CEILING, remoteExecutionRefusal, redactReviewListing, DEVICE_REVIEW_REASON, remoteSessionViolation, runsCode, scopeFor, scopeViolation, sessionOperation, taskViolation, type DesktopGrantContext,
} from "./authorization.server.ts";
import { AgenticStore, digest, fileDigest, rootIdentity } from "./agentic-store.server.ts";
import { AGENTIC_POLICY_VERSION, type AgenticAdjustment, type AgenticAuthorizationEnvelope, type CommandBinding ,
} from "./agentic-types.ts";
import { resolveCommand, type Resolved } from "./capabilities/process.server.ts";
import { canonical, privateHostPath, stagingPath, within, withinAny } from "./paths.server.ts";
import { DeviceStaging, destinationState, escapedText, writePromoted, type StagingRecord, type StagingState } from "./staging.server.ts";
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
import { autonomyPhase } from "./autonomy.ts";
import { Inbox } from "./inbox.server.ts";
import {
  assertMissionTransition, assertStepTransition, blockedBy, classifyTaskFailure, enforcedIdempotent, settled, uncertainRun, uncertainSkillRuns, MISSION_ACTIVE, missionProgress, readySteps, retryVerdict, STEP_DONE, validateGraph,
} from "./machine.ts";
import { MissionMemory } from "./memory.server.ts";
import { scopedPath } from "./paths.server.ts";
import { operationContract, crossAppFailure } from "./cross-app.ts";
import { sha256 } from "./artifacts.server.ts";
import { calculatorOperation } from "./batches.server.ts";
import { runsLocally } from "../bunny-host/router.ts";
import { ADAPTER_TOOL_CONTRACTS } from "../bunny-host/routing.server.ts";
/** Child task states in which its provider session may be alive (T13.3 N-C). */
const CHILD_LAUNCHED: string[] = ["launching", "running", "verifying", "waiting_for_input", "waiting_for_agent_approval", "paused"];
import { planMission, PLANNER_ID } from "./planner.server.ts";
import { SkillLibrary, fill } from "./skills.server.ts";
import { MissionStore, redact } from "./store.server.ts";
import { TriggerEngine } from "./triggers.server.ts";
import type {
  ActionManifest, AuthorizationEnvelope, Budget, CapabilityResult, FailureCategory, Mission, MissionConfig, MissionSnapshot, MissionStep, MissionView,
  PermissionRequest, RemoteAnswer, StepState, Trigger, DesktopGrant, DesktopOperation, PermissionDecision,
} from "./types.ts";
import { APPROVAL_ON_HOST, deviceApprovalRefusal, deviceMayLaunch, ensureDeviceSchema, hostId, isDeviceActor, WorkstationRequiredError, WORKSTATION_ONLY_RISKS,
} from "../bunny-host/device-authority.server.ts";
import { WorkspaceCoordinator } from "./workspace.server.ts";
import { CommandRefusedError, safeError, supervisedLoop, type SafeError ,
} from "../bunny-host/failure.server.ts";
import type { ProjectContextResolver } from "../bunny-host/project-context.server.ts";
import { plannerDraft, teamLimits, TEAM_PLANNER_ID, TEAM_VERSION, validateOutputDir, validateRequirements, type TeamRole } from "./team.ts";
import {
  activateRework, canonicalOutput, installTeamPlan, isTeam, liveTeamSteps, observableFiles, ownerHold, ownerRow, planningPhase, stopTeamAgentSteps,
  teamConstraints, teamOffer, teamOperationDeny, teamPlanReference, teamPrompt, teamProviderViolation, teamView, teamWrite, verifyTeamCriterion, TEAM_ROUTING_PROMPT,
  type TeamFaults,
} from "./team-coordination.server.ts";
import type { Plan } from "./planner.server.ts";
import { applySelection, ownerDirective, SelectionSchema, type ModelSelection } from "../bunny-host/ma4/selection.ts";

const TASK_END = /^task\.(completed|failed|stopped)$/;
const STEP_LIVE: StepState[] = ["running", "verifying"];
const EMPTY_ACCOUNTING = { runtimeMs: 0, externalModelCalls: 0, localModelCalls: 0, deterministicSteps: 0, retries: 0, inputTokens: 0, outputTokens: 0, tokensReported: false ,
};

export type MissionManagerOptions = {
  dataDirectory: string;
  /** Replaces the built-in capability set (tests). */
  adapters?: CapabilityAdapter[];
  browser?: { allowLoopback?: boolean };
  /** M-A-3 T11: test-only fault seeding constructed in-process by an acceptance harness (never from HTTP/env/config). */
  teamFaults?: TeamFaults;
};
export type CreateMission = { objective: string; title?: string; mode: Mode; projectId?: string | null; steps?: unknown; localOnly?: boolean; providers?: ProviderId[] | null; origin: string ;
  modelSelection?: ModelSelection;
  /** M-A-3 T11: a multi-Agent Team Mission; identities come from AgentRuntime, requirements from the user. */
  team?: { coordinatorAgentId: string; plannerAgentId: string; requirements?: unknown; outputDir?: unknown; limits?: unknown };
};

/**
 * MissionManager: the layer above TaskManager. It plans a bounded step graph, persists it, asks for one
 * scoped approval, then schedules steps — model steps as ordinary child tasks through TaskManager with a
 * delegated approval inside the envelope, deterministic steps through the Capability Bus. It never calls
 * a provider adapter itself.
 */
/** M-A-3 T9R-F01: what the workstation reviews for one paired-device change: size, SHA-256 and a bounded preview. */
function describeRemoteChange(path: string): string {
  try {
    const info = statSync(path);
    if (!info.isFile()) return "not a regular file";
    const bytes = readFileSync(path);
    const digest = createHash("sha256").update(bytes).digest("hex");
    // JSON-encoded (quotes, backslashes and line breaks escaped) so file text can never imitate prompt structure.
    const text = JSON.stringify(bytes.subarray(0, REVIEW_BYTES).toString("utf8")).replace(/[\u2022\u2028\u2029\u202a-\u202e\u2066-\u2069]/g, (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}`);
    // Never an implicit preview: either the whole file is shown or the prompt says plainly that it is not.
    return info.size > REVIEW_BYTES
      ? `${info.size} bytes, sha256 ${digest}. TOO LARGE TO SHOW HERE: only the first ${REVIEW_BYTES} bytes follow; open the whole file on the Windows Host and check it before allowing. First bytes (JSON): ${text}`
      : `${info.size} bytes, sha256 ${digest}, full content (JSON): ${text}`;
  } catch {
    return "removed or unreadable";
  }
}
/** M-A-3 T9R-F01: paired-device changes one workstation prompt lists (and its answer acknowledges). */
const REVIEW_PAGE = 12;
/** M-A-3 T9R-F01: largest change shown in full in a review prompt; larger files are flagged explicitly. */
const REVIEW_BYTES = 8192;
/**
 * M-A-3 T9R-F02 (D3): how long a paired device's one-time answer stays usable if the step has not used it yet. The
 * same single TTL as a trusted-desktop grant; the envelope's own expiry still bounds it.
 */
export const DEVICE_ANSWER_TTL_MS = DESKTOP_GRANT_TTL_MS;
/** M-A-3 T9R-F01: the project changed between a desktop-required ask and the workstation's answer. */
class DesktopRequestStale extends CommandRefusedError {}

/** M-A-3 T11: how long team model work waits for the local provider to become ready before failing normally. */
const TEAM_PROVIDER_WAIT_MS = 120_000;

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
  /**
   * M-A-3 T13.3 Gate F: shared-resource admission for Personal Agent work. A returned reason keeps the next ready step
   * ready (it never fails); the Mission is ticked again whenever any step leaves a live state.
   */
  missionAdmissionGate: ((missionId: string) => string | null) | null = null;
  /**
   * M-A-3 T13.3: Host-held facts added to a Mission's model prompt only. They are never stored on the Mission, its
   * steps or its tasks' routing prompt, so no projection of the Mission can carry them.
   */
  missionPromptFacts: ((missionId: string) => string[]) | null = null;
  /**
   * M-A-3 T14: delegated work (workers) a Mission waits for before it may complete. `open` > 0 holds completion, so a
   * parent never finishes, and takes its workers down with it, before their results are in; only Host-verified workers
   * count as verified in the Mission's result.
   */
  missionDelegated: ((missionId: string) => { open: number; awaitingOwner?: number; verified: number; unverified: number }) | null = null;
  readonly admissionHolds = new Map<string, string>();
  readonly completionHolds = new Set<string>();
  /** M-A-3 T14: Missions with a step waiting for another Mission's workspace lock; woken when any step leaves a live state. */
  readonly workspaceWaits = new Set<string>();
  /** M-A-3 T11: AgentRuntime allocates (or reuses) one durable member identity per role; MissionManager records owners. */
  teamAllocator: ((missionId: string, roles: TeamRole[]) => Partial<Record<TeamRole, string>>) | null = null;
  teamFaults: TeamFaults | null = null;
  /** M-A-3 T11: Missions waiting for the first local-provider probe before admitting team model work. */
  private discoveryWaits = new Set<string>();
  /** When each waiting team step first found the local provider not ready. */
  private providerWaits = new Map<string, number>();
  /** M-A-3 T9R-F02 (D2): Host-owned inert staging of paired-device file changes. */
  staging: DeviceStaging;
  /**
   * M-A-3 T9R-F02 (D3/D5): whether a paired-device actor is still paired and unrevoked, from the Host's devices table
   * (wired by the HTTP Host). Unwired only in in-process tests, where device actors are synthetic.
   */
  deviceActive: ((actor: string) => boolean) | null = null;
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
    this.staging = new DeviceStaging(tasks.db, options.dataDirectory);
    tasks.missionScopeCheck = (task, phase = "check") => {
      const mission = this.store.mission(task.mission!.missionId);
      const envelope = mission.authorizationId ? this.store.authorization(mission.authorizationId) : null;
      if (!envelope) return "no approved mission envelope";
      if (envelope.revokedAt) return "authorization revoked";
      // T13.3 N-C: no child of a step whose outcome is uncertain launches (an older child approved directly included)
      // until the owner reconciles it.
      const owner = this.store.step(task.mission!.stepId);
      if (owner.reconciliation?.required)
        return "OUTCOME_UNCERTAIN: this Mission step may already have taken effect; reconcile it (mission.reconcile) before anything for it runs.";
      // Only a step's newest child may launch: a child older than a sibling belongs to an earlier attempt, whether it was
      // launched, displaced or never recorded in the step's attempts. Task rows are upserted in place, so rowid is the
      // exact creation order (no clock ties).
      if (this.tasks.db.db.prepare("SELECT 1 FROM tasks WHERE id<>? AND json_extract(record,'$.mission.stepId')=? AND rowid>(SELECT rowid FROM tasks WHERE id=?) LIMIT 1").get(task.id, owner.id, task.id))
        return "STALE_CHILD: this task belongs to an earlier attempt of its Mission step and can no longer run.";
      const team = teamProviderViolation(this, task);
      if (team) return team;
      // M-A-3 T9R-F01: no shell-capable session starts while paired-device changes await workstation review.
      if (!["tool_free", "read_tools"].includes(providerSessionAuthority(task.provider, task.executionScope?.access) ?? "") && this.pendingRemoteReview())
        return `${DESKTOP_REQUIRED} Files were changed under paired-device authority and need review on the Windows Host first.`;
      // M-A-3 T9R-F01: a remote envelope launches a shell-capable session only under a trusted-desktop grant for
      // exactly this Task, provider, model, effort, access and folder. "launch" runs after the full check and every
      // admission gate (which may legitimately exhaust an Agentic budget), so it only re-validates and spends the grant.
      if (phase === "launch") {
        const ceiling = remoteSessionViolation(task, envelope);
        if (!ceiling) return null;
        const held = this.desktopSessionGrant(task, envelope);
        if (!held) return ceiling;
        const spent = this.consumeDesktopGrant(held.requestId, (current) => this.desktopSessionViolation(task, envelope, current));
        if (!spent && task.cwd) this.desktopExecutions.set(`task:${task.id}`, { root: task.cwd, live: () => !["completed", "failed", "stopped"].includes(this.tasks.db.get(task.id).state) });
        return spent;
      }
      if (isRemoteEnvelope(envelope) && envelope.expiresAt <= Date.now()) return "remote authorization expired";
      const grant = remoteSessionViolation(task, envelope) ? this.desktopSessionGrant(task, envelope) : null;
      const authority = providerScopeViolation(task, envelope, this.store.step(task.mission!.stepId), { desktopGrant: !!grant });
      if (authority) return authority;
      const agentic = this.agenticProviderCheck(task);
      if (agentic) return agentic;
      const codex = task.provider === "codex" ? codexMissionExclusion({ id: "codex", securityCompatibility: this.tasks.live().find((provider ) => provider.id === "codex")?.securityCompatibility ,
            }, task.executionScope!.access,
          ) : null;
      if (codex) return codex;
      return null;
    };
    this.cached = this.store.config();
    this.teamFaults = options.teamFaults ?? null;
    // M-A-3 T11: team model work is tool-free local generation owned by a live member, at check and at launch.
    tasks.missionTaskAgent = (task) => { try { return task.mission ? this.store.step(task.mission.stepId).team?.agentId ?? null : null; } catch { return null; } };
    this.artifacts = new ArtifactStore(this.store, options.dataDirectory);
    this.memory = new MissionMemory(this.store);
    this.inbox = new Inbox(this.store);
    this.bus = new CapabilityBus(this.store, this.artifacts, options.dataDirectory, (type, detail, missionId) => this.emit(type, detail, missionId),tasks.containment,
    );
    this.bus.agenticCheck = (request, risk, executable) => this.agenticCheck(request, risk, executable);
    this.bus.teamDeny = (request) => teamOperationDeny(this, request);
    this.bus.resourceValidation = (request,path) => this.projectResourceCheck({ ...request, action: "filesystem.read", params: { path } });
    this.bus.agenticAdmit = (request, _runId, executable) => {
      if (!request.missionId || !this.agentic.exists(request.missionId)) return {};
      try {
        const e = this.agentic.forMission(request.missionId)!;
        const result = this.agentic.admit(e.id, request.envelope?.agentic?.revision ?? -1,
          { agent_id: this.stepOwner(request.stepId) ?? e.agent_id, mission_id: request.missionId, task_id: null, step_id: request.stepId ?? "", capability: request.action,
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
    // M-A-3 T9R-F01: the trusted-desktop grant for one exact capability operation; never from request parameters.
    this.bus.desktopGrantFor = (request, executable) => this.desktopCapabilityGrant(request, executable);
    this.bus.desktopGrantConsume = (id, request, executable) => this.consumeDesktopGrant(id, (grant) => this.desktopCapabilityViolation(request, executable, grant));
    this.bus.remoteReviewFor = () => this.pendingRemoteReview();
    tasks.codeRunGate = () => this.pendingRemoteReview() ? `${DESKTOP_REQUIRED} Files were changed under paired-device authority and need review on the Windows Host before a Python check runs.` : null;
    this.bus.remoteMutationHeld = (request) => this.remoteMutationHeld(request);
    // M-A-3 T9R-F02 (D2): a paired-device file change is staged, never written into the project directly.
    this.bus.stageRemoteWrite = (request, runId) => this.stageRemoteWrite(request, runId);
    // M-A-3 T9R-F02 (section 12): the step's one-time answer is CONSUMED when it authorizes an admitted run.
    this.bus.onceAdmitted = (request) => {
      if (!request.stepId || request.oneTimeAction !== request.action) return;
      try {
        const once = this.store.step(request.stepId).approvedOnce;
        if (once?.action === request.action) this.stampLifecycle(once.requestId, "CONSUMED", "bunny-host", `${request.action} was admitted under this one-time answer.`);
      } catch { /* the run is already admitted; the stamp is audit only */ }
    };
    this.bus.deviceAttributed = (request) => this.remoteActorFor(request);
    this.bus.remoteMutationStarted = (request, runId) => {
      const actor = this.remoteActorFor(request);
      if (!actor) return;
      const path = typeof request.params.path === "string" ? resolve(request.cwd, request.params.path) : request.cwd;
      const root = request.roots.find((candidate) => within(candidate, path)) ?? request.cwd;
      this.store.recordRemoteChange({ runId, missionId: request.missionId, path, root, actor });
    };
    this.bus.desktopExecutionStarted = (runId, request) => this.desktopExecutions.set(`run:${runId}`, { root: request.cwd, live: () => this.store.run(runId).status === "running" });
    this.bus.desktopExecutionConflict = (request) => {
      const target = typeof request.params.path === "string" ? resolve(request.cwd, request.params.path) : request.cwd;
      return this.desktopExecutionConflict(target);
    };
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
    // M-A-3 T9R-F02 (section 12): a one-time answer leaving its step (failure, retry, replan, stop, a later answer)
    // records that it no longer authorizes anything. A more specific stamp recorded earlier (CONSUMED, EXPIRED,
    // INVALIDATED_BY_*) wins; this one only fills the gap.
    if (step.approvedOnce && "approvedOnce" in patch && patch.approvedOnce?.requestId !== step.approvedOnce.requestId)
      this.stampLifecycle(step.approvedOnce.requestId, "WITHDRAWN", "bunny-host", `The step ${patch.state ?? step.state} ended this one-time answer${patch.approvedOnce ? " (a later answer replaced it)" : ""}.`);
    const next = { ...step, ...patch };
    const event = this.tasks.db.transaction(() => {
      this.store.saveStep(next);
      return type
        ? this.tasks.db.event(type, null, `${detail ?? ""} (step ${step.id})`, step.missionId)
        : null;
    });
    if (event) this.tasks.emit(event);
    // T13.3 N-C: a failed step re-armed by any path (Retry, an automatic retry, restart recovery) withdraws every child
    // of it that never launched, so none can be approved beside the next attempt. Stop marks it stopping synchronously.
    if (step.state === "failed" && next.state === "ready")
      for (const child of this.tasks.db.tasks())
        if (child.mission?.stepId === step.id && ["queued", "routing", "waiting_for_approval"].includes(child.state))
          void this.tasks.stop(child.id, `Withdrawn: ${step.role} was re-armed for a fresh attempt.`).catch(() => {});
    if ((this.admissionHolds.size || this.workspaceWaits.size) && STEP_LIVE.includes(step.state) && !STEP_LIVE.includes(next.state))
      for (const held of new Set([...this.admissionHolds.keys(), ...this.workspaceWaits])) if (held !== step.missionId) this.schedule(held);
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
      ...(isTeam(mission) ? { teamView: teamView(this, mission, this.store.steps(mission.id)) } : {}),
      steps,
      progress: missionProgress(mission.team ? liveTeamSteps(steps) : steps),
      requests,
      artifacts,
      batch: active ? batchView(active, Date.now()) : null,
      autonomy: autonomyPhase({ state: mission.state, steps: mission.team ? liveTeamSteps(steps) : steps, requests, result: mission.result }, this.missionDelegated?.(mission.id)),
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
    // M-A-3 T11: a Team Mission's success is defined by the user's requirements; its writes land only in a fresh
    // output folder (existing project files are never targets) and its model work is tool-free local generation.
    let team: Mission["team"];
    if (input.team) {
      if (input.steps !== undefined) throw new CommandRefusedError("A team Mission is planned by its Planner Agent; explicit steps are refused.");
      const root = project?.path ?? this.tasks.defaultRoot;
      const outputDir = validateOutputDir(input.team.outputDir, `bunny-team-${now.toString(36)}`);
      const folder = join(root, outputDir);
      if (existsSync(folder) && (!statSync(folder).isDirectory() || readdirSync(folder).length)) throw new CommandRefusedError(`The output folder ${outputDir} already exists in the project; team writes never land among existing files.`);
      const limits = teamLimits(input.team.limits);
      team = { version: TEAM_VERSION, coordinatorAgentId: input.team.coordinatorAgentId, plannerAgentId: input.team.plannerAgentId, plannerStepId: null, revisionNote: null,
        planRevisions: 0, outputDir, limits, requirements: validateRequirements(input.team.requirements), members: [{ agentId: input.team.plannerAgentId, role: "planner" }],
        reworkRounds: 0, proposal: null, rejected: [], offerFiles: observableFiles(root, outputDir), git: existsSync(join(root, ".git")), browserFixture: null };
    }
    const mission: Mission = {
      ...((input.modelSelection ?? ownerDirective(objective)) ? { modelSelection: SelectionSchema.parse(input.modelSelection ?? ownerDirective(objective)) } : {}),
      ...(team ? { team } : {}),
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
      providerConstraints: team ? { allow: ["ollama"], localOnly: true } : { allow: input.providers ?? undefined, localOnly: !!input.localOnly },
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
    return this.view(this.plan(mission, input.steps, team ? this.teamPlanningPlan(mission) : undefined));
  }
  /** M-A-3 T11: the planning phase of a team Mission is one Planner Agent step (a real tool-free model call). */
  teamPlanningPlan(mission: Mission): Plan {
    const draft = plannerDraft(mission.team!.limits.maxPlanRevisions);
    draft.team = { ...draft.team!, agentId: mission.team!.plannerAgentId };
    return { complexity: "medium", rationale: ["Team Mission: a Planner Agent proposes the plan with a real local model; Bunny validates it before anything else is reviewed."], steps: [draft] };
  }
  plan(mission: Mission, explicit?: unknown, teamPlan?: Plan): Mission {
    if (mission.team && explicit !== undefined) throw new CommandRefusedError("A team Mission is planned by its Planner Agent; explicit steps are refused.");
    let current = this.setMission(
      mission,
      { state: "planning" },
      "mission.planning",
      `Planning with ${mission.team ? TEAM_PLANNER_ID : PLANNER_ID}.`,
    );
    try {
      const plan = applySelection(teamPlan ?? planMission({
        objective: current.objective,
        mode: current.mode,
        root: current.root,
        localOnly: !!current.providerConstraints.localOnly,
        available: (action) => ["available", "degraded"].includes(this.bus.availability(action)),
        limits: this.cached.limits,
        explicit,
      }), current.modelSelection);
      const ids = new Map(plan.steps.map((step) => [step.key, crypto.randomUUID()]));
      const kept = this.store.steps(current.id).filter((step) => step.state === "completed");
      const remap = (key: string | undefined) => key === undefined ? undefined : ids.get(key) ?? (() => { throw new Error(`Team step reference ${key} is unknown.`); })();
      const steps: MissionStep[] = plan.steps.map((draft, index) => ({
        ...(draft.team ? { team: { ...draft.team, inputs: draft.team.inputs.map((input) => ({ ...input, stepId: remap(input.stepId)! })),
          ...(draft.team.content ? { content: remap(draft.team.content) } : {}), ...(draft.team.subject ? { subject: remap(draft.team.subject) } : {}),
          ...(draft.team.dataset ? { dataset: remap(draft.team.dataset) } : {}), ...(draft.team.reworkOf ? { reworkOf: remap(draft.team.reworkOf) } : {}) } } : {}),
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
        verification: draft.verification.map((check) => check.kind === "team_file" ? { ...check, fromStep: remap(check.fromStep)! } : check.kind === "team_requirements" ? { ...check, datasetStep: check.datasetStep ? remap(check.datasetStep)! : null } : check),
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
  approve(id: string, by: string, start = true, agenticRevision?: number, planReference?: string, coordinatorId?: string): MissionView {
    this.requireEnabled();
    const mission = this.store.mission(id);
    if (mission.state !== "waiting_for_approval" || !mission.requestedScope)
      throw new CommandRefusedError("Mission is not waiting for approval.");
    // M-A-3 T9: a client that reviewed a plan binds its approval to it; a replanned scope is never approved unseen.
    if (planReference !== undefined && planReference !== this.agenticPlanReference(id))
      throw new CommandRefusedError("The plan changed after it was reviewed; review the current plan before approving.");
    // M-A-3 T11: a team execution plan is approved only by name (its exact reviewed reference), and only once every
    // step has a durable owning Agent of this Mission.
    if (mission.team) {
      if (coordinatorId !== mission.team.coordinatorAgentId)
        throw new CommandRefusedError("A team Mission is approved through its Coordinator Agent.");
      const steps = this.store.steps(id);
      if (!planningPhase(steps) && planReference === undefined)
        throw new CommandRefusedError("Approve the reviewed team plan by its reference.");
      for (const step of steps.filter((item) => item.state !== "completed")) {
        const owner = ownerRow(this, step.team?.agentId);
        if (!step.team || !owner || owner.missionId !== id || owner.stopped) throw new CommandRefusedError("Every team step needs a live owning Agent of this Mission before approval.");
      }
    }
    if (isDeviceActor(by)) {
      const refusal = this.deviceMissionRefusal(mission);
      if (refusal) throw new WorkstationRequiredError(refusal);
      // M-A-3 T9R: once a plan has been replaced, a device must name the plan it reviewed; an unbound approval
      // could otherwise accept a replanned scope the phone never saw.
      if (planReference === undefined && mission.planning.replans > 0)
        throw new CommandRefusedError("The plan was revised; review the current plan and approve it by name.");
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
    return this.grant(mission, envelope, by, start);
  }
  /** Persists an approved envelope and readies (and optionally starts) the Mission; owner approval and T14 derived worker authority share it. */
  private grant(mission: Mission, envelope: AuthorizationEnvelope, by: string, start: boolean): MissionView {
    const id = mission.id;
    this.store.saveAuthorization(envelope);
    // A derived grant is the Host's own bookkeeping, never a fresh owner decision (the owner decided the parent).
    if (envelope.derivedFrom)
      this.memory.record(id, "mission_state", "Mission authorized from its parent",
        `Covered by parent authorization ${envelope.derivedFrom.authorizationId}: ${envelope.riskClasses.join("/")} in ${envelope.projectRoots.join(", ")} until ${new Date(envelope.expiresAt).toISOString()}.`,
        `bunny:derived-authorization:${envelope.derivedFrom.authorizationId}`, true);
    else
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
        `Mission envelope ${envelope.id} approved by paired ${by} with remote authority: provider sessions limited to ${REMOTE_SESSION_CEILING.join(" and ")}; shell sessions, terminal, Git hooks and other code execution need trusted-desktop approval on the Windows Host.`,
        id,
      );
    mission = this.setMission(
      mission,
      { state: "ready", authorizationId: envelope.id, ...(envelope.derivedFrom ? { budget: envelope.budget } : {}) },
      "authorization.granted",
      `Mission authorization ${envelope.id} granted by ${by}: roots ${envelope.projectRoots.join(", ")}; ${envelope.riskClasses.join(", ")}; terminal [${envelope.terminal.commands.join(", ")}]; git [${envelope.git.actions.join(", ")}]; browser ${envelope.browser.enabled ? "on" : "off"}; computer ${envelope.computer.enabled ? "on" : "off"}; expires ${new Date(envelope.expiresAt).toISOString()}.`,
    );
    this.inbox.resolve(id, { kinds: ["requires_approval"] });
    if (start) mission = this.start(mission);
    return this.view(mission);
  }
  /**
   * M-A-3 T14: a worker child Mission runs on a strict subset of its parent's live authority, so the owner's one approval
   * of the parent covers it and nothing interrupts the owner. Anything wider, a parent that is not live, Agentic consent
   * or a paired-device parent leaves the child waiting for the owner exactly as before (the reasons are returned).
   */
  deriveWorkerAuthorization(childId: string, parentId: string): { view: MissionView | null; reasons: string[] } {
    this.requireEnabled();
    const child = this.store.mission(childId);
    const parent = this.store.mission(parentId);
    const reasons: string[] = [];
    if (child.state !== "waiting_for_approval" || !child.requestedScope) reasons.push("the worker's Mission is not waiting for approval");
    if (child.team || this.agentic.forMission(childId)) reasons.push("the worker's Mission has its own consent flow");
    if (child.projectId !== parent.projectId || child.root !== parent.root) reasons.push("the worker's Project is not its parent's");
    // Not while the parent waits for the owner (a decision, or an uncertain outcome to reconcile).
    if (!["ready", "running", "verifying"].includes(parent.state)) reasons.push(`the parent Mission is ${parent.state}`);
    if (this.store.steps(parentId).some((step) => step.reconciliation?.required)) reasons.push("the parent has an outcome waiting for reconciliation");
    const envelope = parent.authorizationId ? this.store.authorization(parent.authorizationId) : null;
    if (!envelope) reasons.push("the parent Mission has no authorization");
    if (envelope && child.requestedScope) reasons.push(...derivedScopeViolations(child.requestedScope, envelope));
    const planned = this.store.steps(childId).filter((step) => step.executor.kind === "model").map((step) => ({ stepId: step.id, scope: { access: step.scope.access } }));
    if (planned.length && JSON.stringify(child.requestedScope?.providers.sessions?.steps) !== JSON.stringify(planned)) reasons.push("the worker's provider scope does not match its plan");
    if (this.store.steps(childId).some((step) => step.scope.isolation === "worktree")) reasons.push("the worker needs its own worktree");
    const active = this.store.missionsIn(MISSION_ACTIVE).length;
    if (active >= this.cached.limits.maxActiveMissions) reasons.push(`${active} missions are already active (limit ${this.cached.limits.maxActiveMissions})`);
    if (reasons.length || !envelope || !child.requestedScope) {
      this.emit("authorization.derived_refused", `Worker Mission ${childId} waits for the owner: ${reasons.join("; ")}.`, childId);
      return { view: null, reasons };
    }
    // What the parent has left: its own use, the actual spend of every worker derived from it that has ended, and the full
    // allowance of every one still live (a live worker may still spend all of it).
    const delegated = this.store.derivedAuthorizations(envelope.id).map((row) => {
      const state = this.store.mission(row.missionId).state;
      if (MISSION_ACTIVE.includes(state)) return { calls: row.budget.maxExternalModelCalls, retries: row.budget.maxRetries, tokens: row.budget.maxTokens ?? 0 };
      const spent = this.accounting(row.missionId);
      return { calls: spent.externalModelCalls, retries: spent.retries, tokens: spent.inputTokens + spent.outputTokens };
    });
    const sum = (key: "calls" | "retries" | "tokens") => delegated.reduce((total, row) => total + row[key], 0);
    const used = this.accounting(parentId);
    const now = Date.now();
    const remaining: Budget = {
      maxExternalModelCalls: envelope.budget.maxExternalModelCalls - used.externalModelCalls - sum("calls"),
      maxRetries: envelope.budget.maxRetries - used.retries - sum("retries"),
      maxRuntimeMs: envelope.expiresAt - now,
      maxTokens: envelope.budget.maxTokens === null ? null : envelope.budget.maxTokens - used.inputTokens - used.outputTokens - sum("tokens"),
    };
    // start() refuses while the Host is not accepting work; check first so a grant never leaves a ready, unstarted child.
    this.tasks.containment.assertAccepting("missions");
    const derived = derivedEnvelope(child.requestedScope, envelope, childId, remaining, this.cached.limits.maxMissionRuntimeMs, now);
    return { view: this.grant(child, derived, `${envelope.grantedBy} (covered by parent authorization ${envelope.id})`, true), reasons: [] };
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
    // Re-added by launch() if a step still waits for another Mission's workspace.
    this.workspaceWaits.delete(id);
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
    ) {
      if (mission.state !== "running") this.admissionHolds.delete(id);
      return;
    }
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
    // M-A-3 T11: a reserved rework replica stays pending (dormant) until a Host-observed failure activates it.
    for (const step of readySteps(steps))
      if (step.state === "pending" && !step.team?.dormant)
        this.setStep(step, { state: "ready" }, "mission.step.ready", `${step.role} is ready.`);
    steps = this.store.steps(id);
    let busy = steps.filter((step) => STEP_LIVE.includes(step.state)).length;
    const team = mission.team;
    const slots = team ? Math.min(this.cached.limits.maxConcurrentAgents, team.limits.maxConcurrentSteps) : this.cached.limits.maxConcurrentAgents;
    // Model generations in flight, including routed children still waiting for a launch decision.
    let models = team ? steps.filter((step) => step.executor.kind === "model" && (STEP_LIVE.includes(step.state) || (step.state === "waiting_for_approval" && !!step.taskId))).length : 0;
    for (const step of steps.filter((item) => item.state === "ready")) {
      if (this.missionPauseGate?.(id)) return;
      if (busy >= slots) break;
      const hold = this.missionAdmissionGate?.(id) ?? null;
      if (hold) {
        if (this.admissionHolds.get(id) !== hold) this.tasks.emit(this.tasks.db.event("mission.step.held", null, hold, id));
        this.admissionHolds.set(id, hold);
        break;
      }
      this.admissionHolds.delete(id);
      if (team) {
        // Per-step owner gate against fresh rows: a paused member admits nothing new, a stopped one never again.
        const fresh = this.store.step(step.id);
        if (fresh.state !== "ready" || ownerHold(this, fresh)) continue;
        if (fresh.executor.kind === "model" && models >= team.limits.maxConcurrentModelSteps) continue;
      }
      try {
        if (await this.launch(mission, this.store.step(step.id), envelope)) { busy++; if (step.executor.kind === "model") models++; }
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
    if (mission.team) { this.evaluateTeam(mission); return; }
    const steps = this.store.steps(mission.id);
    if (steps.every((step) => STEP_DONE.includes(step.state))) {
      if (!this.holdForWorkers(mission)) this.completeMission(mission, steps);
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
  /**
   * M-A-3 T11: team completion counts live steps only (a superseded original keeps its failure as history; an unused
   * reserved replica is skipped). A member Agent's Stop holds the Mission for the user instead of failing other Agents.
   */
  evaluateTeam(mission: Mission) {
    const steps = this.store.steps(mission.id);
    // The planner's completion is handled by plan installation, never by Mission completion.
    if (planningPhase(steps) && steps.every((step) => step.state === "completed")) return;
    const live = liveTeamSteps(steps);
    if (live.every((step) => STEP_DONE.includes(step.state))) {
      if (this.holdForWorkers(mission)) return;
      for (const step of steps) if (step.team?.dormant && step.state === "pending")
        this.setStep(step, { state: "skipped" }, "mission.step.skipped", `${step.role}: reserved rework was not needed.`);
      this.completeMission(this.store.mission(mission.id), this.store.steps(mission.id));
      return;
    }
    if (live.some((step) => STEP_LIVE.includes(step.state) || step.state === "ready")) return;
    const waiting = live.filter((step) => step.state === "waiting_for_approval");
    const held = live.filter((step) => step.state === "stopped" || (step.state === "blocked" && step.failure?.category === "dependency_failed" && /Agent was stopped/.test(step.failure.detail)));
    if (waiting.length || held.length) {
      this.setMission(mission, { state: "waiting_for_user" }, "mission.waiting_for_user",
        waiting.length ? `Mission ${mission.id} is waiting for ${waiting.length} permission decision(s).` : `Mission ${mission.id}: a member Agent was stopped; its dependents cannot run. Replan or stop the Mission.`);
      return;
    }
    const failed = live.find((step) => step.state === "failed");
    this.tasks.containment.background(
      { subsystem: "missions", missionId: mission.id },
      () => this.failMission(mission, failed?.failure?.category ?? "dependency_failed", failed ? `${failed.role} failed: ${failed.failure?.detail ?? "unknown"}` : "No step can run.", failed?.id ?? null),
      (error) => this.containMission(mission.id, error),
    );
  }
  /** M-A-3 T14: true while the Mission's own steps are done but its workers are still open (said once per hold). */
  holdForWorkers(mission: Mission): boolean {
    const open = this.missionDelegated?.(mission.id).open ?? 0;
    if (!open) { this.completionHolds.delete(mission.id); return false; }
    if (!this.completionHolds.has(mission.id))
      this.emit("mission.waiting_workers", `All steps finished; waiting for ${open} worker(s) before checking mission-level evidence.`, mission.id);
    this.completionHolds.add(mission.id);
    return true;
  }
  completeMission(mission: Mission, steps: MissionStep[]) {
    this.completionHolds.delete(mission.id);
    if (mission.team) steps = liveTeamSteps(steps);
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
    const workers = this.missionDelegated?.(mission.id) ?? { verified: 0, unverified: 0 };
    const delegated = workers.verified + workers.unverified ? ` Workers: ${workers.verified} verified by Bunny${workers.unverified ? `, ${workers.unverified} not verified` : ""}.` : "";
    const summary = `${steps.length}/${steps.length} steps completed. ${verified} independently verified by Bunny${unverified ? `; ${unverified} completed without independent verification (provider or capability output only)` : ""}.${delegated}`;
    current = this.setMission(current, { state: "completed", finishedAt: Date.now(), result: { summary, verifiedSteps: verified, unverifiedSteps: unverified, artifactIds }, accounting: this.accounting(current.id) ,
      }, "mission.completed", `Mission "${current.title}": ${summary}`,
    );
    this.workspace.releaseMission(current.id);
    // Self-evolving: a routine the owner keeps repeating becomes a candidate skill. Learning never fails a Mission.
    try { this.skills.learnUseCases(); } catch (error) { this.emit("skill.learn_failed", error instanceof Error ? error.message : String(error), current.id); }
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
    if (this.missionPauseGate?.(mission.id)) return false;
    if (step.team) {
      step = this.store.step(step.id);
      if (step.state !== "ready" || ownerHold(this, step)) return false;
    }
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
            outcome.decision,
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
    // M-A-3 T11: tool-free team generations touch no files and hold no lock; team writes hold the whole output folder
    // exclusively (shared-root mutation is serialized); team reads share the folder or the observed file.
    if (this.missionPauseGate?.(mission.id) || this.stopping.has(mission.id) || this.store.mission(mission.id).state !== "running") return false;
    if (step.team && ownerHold(this, this.store.step(step.id))) return false;
    const teamLock = step.team && mission.team
      ? step.executor.kind === "model" ? null
        : step.team.kind === "observe" ? (step.team.source && "path" in step.team.source ? resolve(mission.root, step.team.source.path) : mission.root)
          : join(mission.root, mission.team.outputDir)
      : workspace;
    const lock = teamLock === null ? { ok: true as const, id: "" } : this.workspace.acquire(
      mission.id,
      step.id,
      teamLock,
      step.scope.access === "write" ? "exclusive" : "shared",
    );
    if (!lock.ok) {
      if (lock.conflict.missionId !== mission.id) this.workspaceWaits.add(mission.id);
      if (!step.evidence.includes(`waiting for workspace ${lock.conflict.root}`))
        this.setStep(
          step,
          { evidence: [...step.evidence, `waiting for workspace ${lock.conflict.root}`] },
          "mission.step.waiting_workspace",
          `${step.role} waits: ${lock.conflict.root} is held ${lock.conflict.mode} by step ${lock.conflict.stepId}.`,
        );
      return false;
    }
    if (step.executor.kind === "model") return step.team ? this.launchTeamModel(mission, step, envelope, workspace) : this.launchModel(mission, step, envelope, workspace);
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
      notes: this.missionPromptFacts?.(mission.id) ?? [],
      repair,
    });
    const constraints: TaskConstraints = {
      missionAccess: step.scope.access,
      // An agent step works in the approved folder, so it needs a filesystem-capable provider. Only when local
      // execution is required do the step's declared capabilities and its objective decide (text-only local models).
      requiresFilesystem:
        step.scope.access === "write" ||
        step.requiredCapabilities.some((cap) => cap.startsWith("filesystem.")) ||
        !(envelope.providers.localOnly || step.preferences.local || budgetLocal) &&
        // MA4: an explicitly selected tool-free inference step does not gain filesystem authority.
        !(step.providerConstraints.allow?.length === 1 && step.providerConstraints.allow[0] === "openrouter" && step.requiredCapabilities.length === 0),
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
    // M-A-3 T9R-F01: under remote authority prefer routes within the device ceiling, so benign work needs no
    // extra prompt. This only steers routing; the session ceiling itself is enforced at every launch.
    const outsideCeiling = isRemoteEnvelope(envelope)
      ? (["codex", "claude", "ollama", "opencode", "cline", "cursor"] as ProviderId[]).filter((id) => {
          const authority = providerSessionAuthority(id, step.scope.access);
          return !authority || !REMOTE_SESSION_CEILING.includes(authority);
        })
      : [];
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
          verify: spec && !(spec.spec.kind === "python" && isRemoteEnvelope(envelope)) ? spec.spec : null,
        },
        {
          missionId: mission.id,
          stepId: step.id,
          cwd: workspace,
          executionScope: { access: step.scope.access },
        },
      );
    try {
      task = outsideCeiling.length
        ? (() => {
            try {
              return submit({ ...constraints, providerDenylist: [...new Set([...(constraints.providerDenylist ?? []), ...outsideCeiling])] });
            } catch (error) {
              if (!/hard constraints|not eligible/.test(error instanceof Error ? error.message : String(error))) throw error;
              // No route within remote authority: route normally; dispatch then asks the workstation for this Task.
              return submit(constraints);
            }
          })()
        : submit(constraints);
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
    // M-A-3 T9R-F01: a shell-capable session never starts over unreviewed paired-device changes, under any envelope.
    const sessionClass = providerSessionAuthority(task.provider, task.executionScope?.access);
    const review = sessionClass !== "tool_free" && sessionClass !== "read_tools" ? this.pendingRemoteReview() : null;
    const reviewViolation = review ? `it can run code over files changed under paired-device authority; review their content before allowing:${review.listing}${review.more ? `\n${review.more} more changed file(s) are listed for review after these.` : ""}` : null;
    if (violation || agenticViolation || reviewViolation) {
      // The child stays waiting_for_approval: the user may approve it directly or through the request.
      this.setStep(
        step,
        { taskId: task.id, workspace },
        "mission.step.child_created",
        `${step.role} child task ${task.id} routed to ${task.provider}.`,
      );
      // M-A-3 T9R-F01: a session beyond remote authority is offered to the workstation for this exact Task only.
      const remoteSession = remoteSessionViolation(task, envelope) ?? reviewViolation;
      this.askPermission(
        mission,
        this.store.step(step.id),
        "provider.execute",
        "EXECUTE",
        `${task.provider} for ${step.role}: ${[violation ?? agenticViolation, reviewViolation].filter(Boolean).join("; ")}`,
        "execute",
        remoteSession ? { desktopRequired: true, desktopOperation: sessionOperation(task), ...(review ? { remoteReview: review.ids } : {}) } : {},
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
      this.delegatedLaunchFailed(mission, step, task, workspace, error);
      return false;
    }
    this.countModelCall(mission.id, local);
    this.markRunning(step, task.id, task.provider, workspace);
    return true;
  }
  /**
   * M-A-3 T11: a team model step. Inputs arrive only as verified, hash-rechecked handoffs; routing gets Host constraints
   * (tool-free, local, no workspace tools) and a neutral routing text; a route outside them fails, never asks.
   */
  async launchTeamModel(mission: Mission, step: MissionStep, envelope: AuthorizationEnvelope, workspace: string): Promise<boolean> {
    if (!isTeam(mission)) return false;
    // The local provider is not ready (unprobed after a Host start, or briefly unreachable while it finishes work from
    // before a restart): the step stays ready and the provider is re-probed for a bounded while, instead of spending
    // every attempt in the same instant. After the bound the ordinary budgeted failure path decides.
    const ollama = this.tasks.live().find((provider) => provider.id === "ollama");
    if (!ollama || !["ready", "busy"].includes(ollama.availability)) {
      const since = this.providerWaits.get(step.id) ?? Date.now();
      this.providerWaits.set(step.id, since);
      if (Date.now() - since < TEAM_PROVIDER_WAIT_MS) {
        if (!this.discoveryWaits.has(mission.id)) {
          this.discoveryWaits.add(mission.id);
          setTimeout(() => {
            this.discoveryWaits.delete(mission.id);
            if (this.closed) return;
            void this.tasks.refreshProviders().catch(() => {}).finally(() => { if (!this.closed) this.schedule(mission.id); });
          }, 5000).unref?.();
        }
        return false;
      }
    }
    this.providerWaits.delete(step.id);
    const built = await teamPrompt(this, mission, step, envelope);
    if (this.missionPauseGate?.(mission.id) || this.stopping.has(mission.id) || this.store.mission(mission.id).state !== "running") return false;
    step = this.store.step(step.id);
    if (step.state !== "ready" || ownerHold(this, step)) return false;
    if ("refused" in built) {
      this.stepFailed(mission, this.markRunning(step, null, null, workspace), "dependency_failed", built.refused);
      return false;
    }
    const usedExternal = mission.accounting.externalModelCalls;
    const sessionsUsed = mission.accounting.externalModelCalls + mission.accounting.localModelCalls;
    let task: OrchTask;
    try {
      task = this.tasks.submit(
        { prompt: built.prompt, routingPrompt: TEAM_ROUTING_PROMPT, mode: mission.mode, projectId: mission.projectId, override: "auto", constraints: teamConstraints(step, step.team?.kind === "plan" ? teamOffer(this, mission) : null), verify: null },
        { missionId: mission.id, stepId: step.id, cwd: workspace, executionScope: { access: "read" } },
      );
    } catch (error) {
      this.stepFailed(mission, this.markRunning(step, null, null, workspace), "provider_unavailable", `No eligible local tool-free model right now: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
    const local = runsLocally(this.tasks.live().find((provider) => provider.id === task.provider), task.model);
    const team = teamProviderViolation(this, task);
    if (team) {
      this.tasks.stopInBackground(task.id, team);
      this.stepFailed(mission, this.markRunning(step, task.id, task.provider, workspace), "provider_unavailable", team);
      return false;
    }
    const violation = taskViolation(task, envelope, local, usedExternal, Date.now(), step, sessionsUsed) ?? this.agenticProviderCheck(task);
    if (violation) {
      this.setStep(step, { taskId: task.id, workspace }, "mission.step.child_created", `${step.role} child task ${task.id} routed to ${task.provider}.`);
      this.askPermission(mission, this.store.step(step.id), "provider.execute", "EXECUTE", `${task.provider} for ${step.role}: ${violation}`, "execute", {});
      return false;
    }
    try {
      this.tasks.approveDelegated(task.id, {
        missionId: mission.id, stepId: step.id, authorizationId: envelope.id,
        check: (child) => teamProviderViolation(this, child) ?? taskViolation(child, envelope, runsLocally(this.tasks.live().find((provider) => provider.id === child.provider), child.model), usedExternal, Date.now(), this.store.step(step.id), sessionsUsed),
      });
    } catch (error) {
      this.delegatedLaunchFailed(mission, step, task, workspace, error);
      return false;
    }
    this.countModelCall(mission.id, local);
    this.markRunning(step, task.id, task.provider, workspace);
    return true;
  }
  /**
   * T13.3 N-C: a delegated launch threw. If the child's provider session may already have started (a throw after the
   * adapter launched), write work waits for the owner instead of being rerouted beside it.
   */
  delegatedLaunchFailed(mission: Mission, step: MissionStep, task: OrchTask, workspace: string, error: unknown) {
    const child = this.tasks.db.get(task.id);
    const started = this.tasks.sessions.has(task.id) || CHILD_LAUNCHED.includes(child.state);
    const running = this.markRunning(step, task.id, task.provider, workspace);
    this.stepFailed(mission, running, "provider_unavailable", error instanceof Error ? error.message : String(error),
      started && this.writeCapable(running) ? `OUTCOME_UNCERTAIN: the ${task.provider} session for ${step.role} may have started before the Host failed to record it, so it may already be changing files.` : null);
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
    // M-A-3 T9R-F02 (D3): a device's one-time answer authorizes only while it is current (device still paired, within its
    // TTL, at the Agent revision and Host generation it answered); otherwise it is invalidated and the step asks again.
    step = this.liveOnce(step);
    // A one-time allowance covers exactly the path the user saw in the request, nothing around it.
    // M-A-3 T9R-F01: only a workstation answer may extend roots to the path it reviewed; a device answer never does.
    const answeredBy = (() => { try { return step.approvedOnce ? this.store.request(step.approvedOnce.requestId).resolvedBy : null; } catch { return null; } })();
    const once = step.approvedOnce?.action === action && typeof params.path === "string" && isTrustedLocalActor(answeredBy);
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
      ...(step.team?.agentId ? { agentId: step.team.agentId } : {}),
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
        permission: ({ action: string; risk: string; reason: string } & Pick<PermissionDecision, "desktopRequired" | "desktopOperation" | "remoteReview">) | null;
        /** M-A-3 T9R-F02 (D2): the executor's write was staged, not applied; the step waits for workstation promotion. */
        staged?: string | null;
        /** M-A-3 T13.3 N-C: why a failed non-read run's outcome is unknown (null when it is known or enforced-idempotent). */
        uncertain?: string | null;
      };
      // M-A-3 T11: a team write takes its content from the producer's verified handoff and its pre-image guard from
      // what this Mission last wrote there; a destination already holding these exact bytes is not written again.
      const write = step.team?.kind === "write_file" && isTeam(mission) ? teamWrite(this, mission, step) : null;
      if (write && !("params" in write)) {
        if ("already" in write) {
          result = { ok: true, summary: "The destination already holds exactly the verified content; nothing was written again.", artifactIds: [], runId: null, output: null, permission: null, category: null };
        } else {
          this.workspace.release(stepId);
          this.stepFailed(mission, step, "conflict" in write ? "workspace_conflict" : "dependency_failed", "conflict" in write ? write.conflict : write.refused);
          return;
        }
      } else if (step.executor.kind === "capability") {
        const params = write && "params" in write ? write.params : this.crossAppInputs(step);
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
        const stagedOutput = outcome.result?.output && typeof outcome.result.output === "object" ? (outcome.result.output as { staged?: boolean; stagingId?: string }) : null;
        result = {
          staged: status === "succeeded" && stagedOutput?.staged === true && typeof stagedOutput.stagingId === "string" ? stagedOutput.stagingId : null,
          uncertain: uncertainRun(outcome.run),
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
                  desktopRequired: outcome.decision.desktopRequired,
                  desktopOperation: outcome.decision.desktopOperation,
                  remoteReview: outcome.decision.remoteReview,
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
        // M-A-3 T9R-F02 (round 4): a re-run never reuses a one-time answer that was consumed, withdrawn or invalidated.
        step = this.liveOnce(step);
        if (step.executor.kind !== "skill") throw new Error("step executor changed");
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
          uncertain: run.ok ? null : uncertainSkillRuns([...run.runs, ...(run.cleanupRuns ?? [])]),
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
                desktopRequired: run.permission.desktopRequired,
                desktopOperation: run.permission.desktopOperation,
                remoteReview: run.permission.remoteReview,
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
      if (result.staged) {
        // M-A-3 T9R-F02 (D2): nothing reached the project. The step completes only after the workstation reviews the exact
        // staged bytes and promotes them; it never completes or verifies on the strength of the staging write.
        const record = this.staging.get(result.staged);
        this.workspace.release(stepId);
        if (!record) { this.stepFailed(this.store.mission(missionId), step, "capability_failed", "The staged change record is missing."); return; }
        this.setStep(step, { result: { summary: result.summary, artifactIds: result.artifactIds, verified: null, verification: [] } });
        this.askPromotion(this.store.mission(missionId), this.store.step(stepId), record);
        return;
      }
      // T13.3 N-C: an ask that arrives after a write already landed (a skill whose authority changed mid-run) would re-run
      // that write once answered; the owner reconciles it instead.
      if (result.permission && !result.uncertain) {
        this.workspace.release(stepId);
        this.askPermission(
          this.store.mission(missionId),
          step,
          result.permission.action,
          result.permission.risk as PermissionRequest["risk"],
          result.permission.reason,
          "execute",
          result.permission,
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
          result.uncertain ?? null,
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
          // T13.3 N-C: a throw after this attempt already wrote (a later skill step, or the check after a write) must not
          // let the retry repeat what landed; judge by the runs this attempt recorded.
          uncertainSkillRuns(this.store.runs({ missionId, stepId, limit: 500 }).filter((run) => run.startedAt >= (current.attempts.at(-1)?.startedAt ?? 0))),
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
    // M-A-3 T11: a team plan's reference covers every execution-relevant field, owners and edges included. Non-team
    // Missions keep their existing digest byte for byte.
    if (this.store.mission(id).team) return teamPlanReference(this.store.steps(id));
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
  /** M-A-3 T11: the owning team Agent of a step (null outside teams). */
  stepOwner(stepId: string | null | undefined): string | null {
    if (!stepId) return null;
    try { return this.store.step(stepId).team?.agentId ?? null; } catch { return null; }
  }
  /** M-A-3 T11: the revocations a replan performs (shared by team plan install), without replanning. */
  revokeForReplan(id: string, by: string, reason: string) {
    for (const step of this.store.steps(id))
      if (step.approvedOnce && step.state !== "completed") this.setStep(step, { approvedOnce: null });
    const mission = this.store.mission(id);
    if (mission.authorizationId) {
      const envelope = this.store.authorization(mission.authorizationId);
      if (envelope && !envelope.revokedAt) this.store.saveAuthorization({ ...envelope, revokedAt: Date.now() });
    }
    for (const request of this.store.requests(id))
      if (!request.resolvedAt) this.store.saveRequest({ ...request, resolvedAt: Date.now(), resolution: "deny", resolvedBy: `${by} (${reason})` });
    for (const batch of this.store.endMissionBatches(id, "revoked", by))
      this.emit("approval.batch_ended", `Small approval batch revoked (${batch.usedCount} / ${batch.maxActions} actions used): ${reason}`, id);
    this.revokeDesktopGrants(id, reason);
    this.withdrawStaged(id, by, reason);
    this.workspace.releaseMission(id);
  }
  /** M-A-3 T11: Stop one member Agent's open work only (AgentRuntime persisted the durable stop flag first). */
  async stopTeamAgent(missionId: string, agentId: string, by: string): Promise<number> {
    const mission = this.store.mission(missionId);
    if (!mission.team || mission.team.coordinatorAgentId === agentId) throw new CommandRefusedError("Only a team member Agent is stopped individually.");
    return stopTeamAgentSteps(this, missionId, agentId, by);
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
    // M-A-3 T11: a team's one consent belongs to its Coordinator and covers the reviewed EXECUTION plan, never the
    // planner-only phase (whose plan is replaced) and never a member Agent's slice of it.
    if (mission.team && (mission.team.coordinatorAgentId !== agentId || planningPhase(this.store.steps(mission.id))))
      throw new CommandRefusedError("A team's Agentic consent is proposed by its Coordinator for the reviewed execution plan.");
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
    // M-A-3 T9R-F02 (D3): a narrowed permission stays narrowed. An answer given at the earlier revision, used or not,
    // never authorizes again: its step asks afresh at the new revision.
    for (const step of this.store.steps(missionId))
      if (step.approvedOnce && !["completed", "skipped", "failed", "stopped"].includes(step.state)) {
        this.stampLifecycle(step.approvedOnce.requestId, "INVALIDATED_BY_SCOPE_CHANGE", "workstation", `The Agent's permissions were narrowed to revision ${next.revision}.`);
        this.setStep(step, { approvedOnce: null });
      }
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
  deviceRequestRefusal(request: PermissionRequest, decision: "allow_once" | "allow_batch" = "allow_once"): string | null {
    // M-A-3 T9R-F01: an ask the Host marked as exceeding remote authority is answered on the workstation only.
    if (request.desktopRequired || request.remoteReview?.length) return DESKTOP_REQUIRED;
    // An answer resumes the Mission: a device never decides when workstation-held code execution continues, exactly
    // as it may not start or resume it (remote envelopes pass; their code is desktop-gated per operation).
    const resume = this.deviceResumeRefusal(request.missionId);
    if (resume) return resume;
    // A device never extends an expired or revoked envelope, for any action.
    const mission = this.store.mission(request.missionId);
    const live = mission.authorizationId ? this.store.authorization(mission.authorizationId) : null;
    if (!live || live.revokedAt || live.expiresAt <= Date.now()) return APPROVAL_ON_HOST;
    if (request.action === "provider.execute") {
      // The Host asked because this route exceeds what it can confine; only local tool-free inference launches remotely.
      const step = this.store.step(request.stepId);
      const task = step.taskId ? this.tasks.db.get(step.taskId) : null;
      if (!task || !deviceMayLaunch(task, this.tasks.live().find((provider) => provider.id === task.provider)?.remoteModels)) return APPROVAL_ON_HOST;
      // The exact Task must already fit the envelope (providers, local-only, budgets, roots, scope): a phone answers
      // other asks about it, never one that would exceed the reviewed authorization.
      const local = runsLocally(this.tasks.live().find((provider) => provider.id === task.provider), task.model);
      const used = mission.accounting.externalModelCalls + mission.accounting.localModelCalls;
      return taskViolation(task, live, local, mission.accounting.externalModelCalls, Date.now(), step, used) ? APPROVAL_ON_HOST : null;
    }
    const owner = deviceApprovalRefusal(request.risk, this.bus.find(request.action)?.manifest);
    if (owner) return owner;
    // M-A-3 T9R-F01: a device never authorizes code execution, even inside a workstation-approved envelope. The
    // Host-computed small batch is Calculator-bound by construction; a single answer is judged on the exact step.
    const step = this.store.step(request.stepId);
    const consent = this.agentic.forMission(request.missionId);
    // A skill's inner request cannot be bound to exact params from the step; the workstation answers it.
    if (step.executor.kind === "skill") return APPROVAL_ON_HOST;
    const cwd = step.workspace ?? mission.root;
    if (decision === "allow_batch" && request.batchOffer) {
      // An Agent's consent bounds a device as well: a batch only within a cross-app consent that names every action.
      if (consent && (!consent.cross_app || request.batchOffer.actions.some((action) => !consent.permitted_capabilities.includes(action)))) return APPROVAL_ON_HOST;
      if (consent && (consent.current_state !== "ACTIVE" || consent.host_generation !== this.tasks.instanceId || consent.expires_at <= Date.now())) return APPROVAL_ON_HOST;
      // Every planned operation the batch covers must be one a phone could approve alone (exact Calculator operations).
      for (const planned of this.store.steps(request.missionId))
        if (planned.executor.kind === "capability" && request.batchOffer.actions.includes(planned.executor.action)) {
          const refusal = remoteExecutionRefusal(planned.executor.action, planned.executor.params as Record<string, unknown>, this.bus.find(planned.executor.action)?.manifest.risk ?? ("UNKNOWN" as never), planned.workspace ?? mission.root);
          if (refusal) return refusal;
        } else if (planned.executor.kind === "skill") return APPROVAL_ON_HOST;
      return null;
    }
    // Judged on every params the one-time answer can reach in this step: the executor and every same-action
    // verification check (a one-time allowance carries from execution into verification).
    const candidates: Record<string, unknown>[] = [
      ...(step.executor.kind === "capability" && step.executor.action === request.action ? [step.executor.params as Record<string, unknown>] : []),
      ...step.verification.flatMap((check) => check.kind === "capability" && check.action === request.action ? [check.params as Record<string, unknown>]
        : check.kind === "file_exists" && request.action === (check.contains ? "filesystem.read" : "filesystem.exists") ? [{ path: check.path }] : []),
    ];
    if (!candidates.length && step.executor.kind === "model") candidates.push(this.agenticRequestParams(step, request.action, step.pendingPhase ?? "execute"));
    if (!candidates.length) return APPROVAL_ON_HOST;
    // M-A-3 T9R-F02 (D3): effective authority = Host policy ∩ Mission envelope ∩ Agent consent ∩ device rights ∩ the exact
    // Host offer. For an Agent Mission a device answers only inside the Agent's CURRENT consent (state, generation,
    // expiry, revision and resource scope); it never restores a capability the owner narrowed away.
    if (consent) {
      if (consent.current_state !== "ACTIVE" || consent.host_generation !== this.tasks.instanceId || consent.expires_at <= Date.now()) return APPROVAL_ON_HOST;
      if (!request.agentic || request.agentic.revision !== consent.revision || request.agentic.generation !== this.tasks.instanceId) return APPROVAL_ON_HOST;
      for (const params of candidates)
        if (agenticScopeViolation(consent, request.action, params, request.risk, cwd, undefined, step.id))
          return `${APPROVAL_ON_HOST} This is outside the Agent's current permissions; a paired device cannot widen them.`;
    }
    for (const params of candidates) {
      // A device answers only for what the reviewed envelope already covers: never a new capability, path, root,
      // command or domain (a one-time answer is not a scope expansion from a phone).
      if (request.action !== "project.context") {
        if (!matches(live.capabilities, request.action)) return APPROVAL_ON_HOST;
        if (scopeViolation(request.action, params, live, cwd)) return APPROVAL_ON_HOST;
        if (request.action.startsWith("filesystem.") && typeof params.path !== "string") return APPROVAL_ON_HOST;
      }
      const refusal = remoteExecutionRefusal(request.action, params, request.risk, cwd);
      if (refusal) return refusal;
    }
    return null;
  }
  /** Why a paired device may not approve this pending Mission plan, or null. */
  deviceMissionRefusal(mission: Mission): string | null {
    if (this.agentic.exists(mission.id) || mission.origin.startsWith("agent:"))
      return "Agent Missions are started from their Agent on the Windows Host.";
    const scope = mission.requestedScope;
    if (!scope) return null;
    if (scope.riskClasses.some((risk) => WORKSTATION_ONLY_RISKS.includes(risk))) return APPROVAL_ON_HOST;
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
      // M-A-3 T9R-F01: re-consent never hands a device bound scripts, interpreters or hook-running Git.
      // Writes and deletes are judged per path at execution under the (remote) envelope, so they are not refused here.
      for (const manifest of this.manifestsFor(capability))
        if (manifest.id !== "filesystem.write" && manifest.id !== "filesystem.delete" && remoteExecutionRefusal(manifest.id, {}, manifest.risk)) return DESKTOP_REQUIRED;
      if (!this.manifestsFor(capability).length) return APPROVAL_ON_HOST;
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
              remote: { ...verdict(this.safeRefusal(() => this.deviceMissionRefusal(mission))), desktopFollowUp: this.remoteDesktopFollowUp(mission) },
            }
          : {}),
        requests: mission.requests.map((full) => {
          // M-A-3 T9R-F01: a paired device sees the desktop-required flag, never grant or exact-operation records.
          const { desktopGrant: _grant, desktopOperation: _operation, desktopBinding: _binding, promotion: _promotion, ...stripped } = full;
          // The review listing (paths and content of paired-device changes, Host-wide) is for the workstation only, and so
          // is a staged change's promotion review (M-A-3 T9R-F02: destination, digest and content).
          const request = stripped.remoteReview?.length || _promotion ? { ...stripped, reason: DEVICE_REVIEW_REASON } : stripped;
          if (request.resolvedAt) return request;
          const once = this.safeRefusal(() => this.deviceRequestRefusal(request));
          // M-A-3 T9R-F01: a Calculator-bound batch can stay answerable where a single allow is workstation-only.
          const batch = once && request.batchOffer ? this.safeRefusal(() => this.deviceRequestRefusal(request, "allow_batch")) : once;
          return { ...request, remote: once && !batch ? { answerable: true, reason: null, batchOnly: true } : verdict(once) };
        }),
      })),
    };
  }
  /**
   * M-A-3 T9R-F01: why a paired device may not start this ready Mission, or null. A remote envelope is capped by
   * itself; a workstation envelope that carries shell sessions, terminal commands or hook-running Git is started
   * on the workstation, so a device never chooses when workstation-held code execution begins.
   */
  deviceStartRefusal(mission: Mission): string | null {
    const envelope = mission.authorizationId ? this.store.authorization(mission.authorizationId) : null;
    if (!envelope || envelope.revokedAt) return APPROVAL_ON_HOST;
    if (isRemoteEnvelope(envelope)) return null;
    // A provider session may route to any allowed provider; judge each one's tool authority (unknown = shell).
    const candidates: ProviderId[] = envelope.providers.localOnly ? ["ollama"] : envelope.providers.allow ?? ["codex", "claude", "ollama", "opencode", "cline", "cursor"];
    const shellSessions = !!envelope.providers.execution && (envelope.providers.sessions?.steps ?? [{ scope: { access: "write" } }]).some((step) =>
      candidates.some((provider) => { const authority = providerSessionAuthority(provider, step.scope.access); return !authority || !REMOTE_SESSION_CEILING.includes(authority); }));
    const code = envelope.terminal.enabled || envelope.capabilities.some((capability) => capability === "terminal.exec" || capability.startsWith("terminal."))
      || envelope.git.actions.some((action) => ["commit", "merge", "worktree"].includes(action));
    if (shellSessions || code) return DESKTOP_REQUIRED;
    // Workstation-held program launches and UI automation (EXECUTE, other than exact Calculator operations) start
    // only from the workstation too; an unknown capability or a skill that may execute fails closed.
    for (const step of this.store.steps(mission.id)) {
      const operations = [
        ...(step.executor.kind === "capability" ? [{ action: step.executor.action, params: step.executor.params as Record<string, unknown> }] : []),
        ...step.verification.flatMap((check) => check.kind === "capability" ? [{ action: check.action, params: check.params as Record<string, unknown> }] : []),
      ];
      if (["completed", "skipped"].includes(step.state)) continue;
      // Skills, command checks, Git-diff checks and Python task checks run programs; never on a device's timing.
      if (step.executor.kind === "skill") return DESKTOP_REQUIRED;
      if (step.verification.some((check) => check.kind === "command" || check.kind === "git_diff_nonempty" || (check.kind === "task_spec" && check.spec.kind === "python"))) return DESKTOP_REQUIRED;
      for (const { action, params } of operations) {
        const risk = this.bus.find(action)?.manifest.risk;
        if (!risk) return DESKTOP_REQUIRED;
        // Git and GitHub CLI reads run owner-configured programs (textconv, filters, fsmonitor) under workstation authority.
        if (action.startsWith("git.") || action.startsWith("github.")) return DESKTOP_REQUIRED;
        if (!runsCode(action, params, risk)) continue;
        // Code that would still ask stays workstation-gated (a device can never answer it); code the workstation
        // envelope would run without another answer means the device would decide when it runs.
        try {
          const decided = this.bus.decision(this.capabilityRequest(mission, step, envelope, action, params, step.workspace ?? mission.root));
          if (decided.decision === "allow") return DESKTOP_REQUIRED;
        } catch { return DESKTOP_REQUIRED; }
      }
    }
    return null;
  }
  /**
   * M-A-3 T9R-F01: why a paired device may not resume this Agent's Mission, or null. Pause and Stop are always
   * available; resuming work whose consent includes bound scripts or hook-running Git stays on the workstation.
   */
  deviceResumeRefusal(missionId: string): string | null {
    // The Mission's own envelope and plan, exactly as for a device start (missing or revoked fails closed).
    const start = this.deviceStartRefusal(this.store.mission(missionId));
    if (start) return start;
    const e = this.agentic.forMission(missionId);
    if (!e) return null;
    // Cross-app computer actions are confined to exact Calculator operations by the agentic scope check; any other
    // EXECUTE capability is workstation-held code or program execution.
    return e.permitted_capabilities.some((capability) => capability === "terminal.exec" || ["git.commit", "git.merge", "git.worktree_add", "git.worktree_remove"].includes(capability)
      || (this.bus.find(capability)?.manifest.risk === "EXECUTE" && !(e.cross_app && capability.startsWith("computer."))))
      ? DESKTOP_REQUIRED : null;
  }
  /** M-A-3 T9R-F01: a Mission record as a paired device may see it: no grant, exact-operation or binding records. */
  deviceMissionData<T extends { mission: MissionView }>(data: T): T {
    return redactReviewListing({
      ...data,
      mission: { ...data.mission, requests: data.mission.requests.map(({ desktopGrant: _g, desktopOperation: _o, desktopBinding: _b, ...request }) => request.remoteReview?.length ? { ...request, reason: DEVICE_REVIEW_REASON } : request) },
    });
  }
  /** M-A-3 T9R-F01: the parts of a plan a remote approval leaves for trusted-desktop approval. Projection only. */
  remoteDesktopFollowUp(mission: Mission): string | null {
    const scope = mission.requestedScope;
    if (!scope) return null;
    const parts: string[] = [];
    if (scope.providers.sessions?.steps.some((step) => step.scope.access === "write")) parts.push("agent sessions that write files (they use a shell)");
    if (scope.terminal.enabled || scope.capabilities.includes("terminal.exec")) parts.push("terminal commands and scripts");
    if (scope.git.actions.some((action) => ["commit", "merge", "worktree"].includes(action))) parts.push("Git changes that can run repository hooks");
    return parts.length ? `If approved here, these still need approval on the Windows Host when they run: ${parts.join("; ")}.` : null;
  }
  /** A verdict that cannot be computed is a refusal, never an answerable offer. */
  safeRefusal(check: () => string | null): string | null {
    try {
      return check();
    } catch {
      return APPROVAL_ON_HOST;
    }
  }
  // -- M-A-3 T9R-F01: trusted-desktop grants -------------------------------------
  /** Stable identity of this Host installation; the per-boot epoch is tasks.instanceId. */
  hostIdentity(): string {
    ensureDeviceSchema(this.tasks.db.db);
    return hostId(this.tasks.db.db);
  }
  /** Every binding a grant must match for this Mission step right now. */
  desktopContext(missionId: string, stepId: string, operation: DesktopOperation): DesktopGrantContext {
    return {
      hostId: this.hostIdentity(),
      epoch: this.tasks.instanceId,
      missionId,
      agentId: this.agentic.forMission(missionId)?.agent_id ?? null,
      stepId,
      taskId: this.store.step(stepId).taskId,
      planReference: this.agenticPlanReference(missionId),
      authorizationId: this.store.mission(missionId).authorizationId ?? "",
      operation,
      mutationSequence: this.store.mutationSequence(),
    };
  }
  desktopSessionViolation(task: OrchTask, envelope: AuthorizationEnvelope, grant: DesktopGrant | undefined): string | null {
    if (envelope.revokedAt) return "authorization revoked";
    const context = this.desktopContext(task.mission!.missionId, task.mission!.stepId, sessionOperation(task));
    return context.taskId !== task.id ? "Trusted-desktop authorization belongs to another Task." : desktopGrantViolation(grant, context);
  }
  /** The workstation's still-valid grant for exactly this provider session, or null. */
  desktopSessionGrant(task: OrchTask, envelope: AuthorizationEnvelope): DesktopGrant | null {
    for (const request of this.store.requests(task.mission!.missionId))
      if (request.stepId === task.mission!.stepId && request.desktopGrant && !this.desktopSessionViolation(task, envelope, request.desktopGrant))
        return request.desktopGrant;
    return null;
  }
  desktopCapabilityViolation(request: CapabilityRequest, executable: Resolved | null | undefined, grant: DesktopGrant | undefined): string | null {
    if (!request.missionId || !request.stepId || !request.envelope || request.envelope.revokedAt) return "No live Mission authorization.";
    return desktopGrantViolation(grant, this.desktopContext(request.missionId, request.stepId, capabilityOperation(request.action, request.params, request.cwd, executable)));
  }
  /** The workstation's still-valid grant (its request id) for exactly this capability operation, or null. */
  desktopCapabilityGrant(request: CapabilityRequest, executable?: Resolved | null): string | null {
    if (!request.missionId || !request.stepId) return null;
    for (const record of this.store.requests(request.missionId))
      if (record.stepId === request.stepId && record.desktopGrant && !this.desktopCapabilityViolation(request, executable, record.desktopGrant))
        return record.id;
    return null;
  }
  /** Project paths written in this Mission while its envelope was a paired-device (remote) grant. */
  remoteChanges(mission: Mission): string[] {
    const envelope = mission.authorizationId ? this.store.authorization(mission.authorizationId) : null;
    if (!envelope || !isRemoteEnvelope(envelope)) return [];
    // M-A-3 T9R-F02: a staged write changed nothing in the project until (and unless) it was promoted.
    const unpromoted = new Set(this.staging.forMission(mission.id).filter((record) => record.promotionState !== "PROMOTED").map((record) => record.runId));
    return [...new Set(this.store.runs({ missionId: mission.id, limit: 500 })
      .filter((run) => ["filesystem.write", "filesystem.delete", "browser.download"].includes(run.action) && run.status === "succeeded" && !unpromoted.has(run.id))
      .map((run) => String((run.params as Record<string, unknown>).path ?? run.action)))];
  }
  /** The paired device behind a Mission change: a remote envelope's grantor, or the device that allowed it once. */
  remoteActorFor(request: CapabilityRequest): string | null {
    if (request.envelope && isRemoteEnvelope(request.envelope)) return request.envelope.grantedBy;
    if (request.missionId) {
      try {
        const driven = this.store.mission(request.missionId).deviceDriven;
        if (driven) return driven;
      } catch { /* fall through */ }
    }
    if (!request.missionId) return null;
    try {
      // Any device allow in this Mission attributes its changes, even after a later workstation answer (to a hold or
      // a review) replaced a step's one-time allowance.
      // Mission-wide: a device answer resumes the Mission, so every later change in it lands on the device's timing.
      const answered = this.store.requests(request.missionId).find((asked) => asked.resolution !== "deny" && asked.resolution !== null && !!asked.resolvedBy && isDeviceActor(asked.resolvedBy));
      return answered?.resolvedBy ?? null;
    } catch { return "device:unattributed"; } // unreadable attribution is treated as paired-device (held and reviewed)
  }
  /**
   * Unreviewed paired-device changes. Host-wide on purpose: a command can load files from any folder (its own cwd,
   * argument paths, another project root), so any code run waits for the workstation to review every one of them.
   */
  pendingRemoteReview(): { ids: string[]; paths: string[]; more: number; listing: string } | null {
    const pending = this.store.pendingRemoteChanges();
    if (!pending.length) return null;
    // A workstation answer acknowledges exactly the paths its prompt shows; the rest ask again afterwards.
    const all = [...new Set(pending.map((change) => change.path))];
    const shown = all.slice(0, REVIEW_PAGE);
    // Any file can be run as code by an interpreter whatever its name, so the workstation reviews content: size,
    // SHA-256 and a bounded preview of each changed file (the answer is bound to this exact project state).
    const listing = shown.map((path) => `\n• ${JSON.stringify(path)}: ${describeRemoteChange(path)}`).join("");
    return { ids: pending.filter((change) => shown.includes(change.path)).map((change) => change.id), paths: shown, more: all.length - shown.length, listing };
  }
  /** M-A-3 T9R-F01: a paired device chose when this Mission (re)starts; its changes are paired-device changes. */
  markDeviceDriven(missionId: string, actor: string) {
    if (!isDeviceActor(actor)) return;
    const mission = this.store.mission(missionId);
    if (mission.deviceDriven !== actor) this.store.saveMission({ ...mission, deviceDriven: actor, updatedAt: Date.now() });
  }
  /** M-A-3 T9R-F01: a revoked device's start or resume ends with it: active Missions it drove are stopped. */
  async endDeviceDriven(actor: string): Promise<number> {
    let stopped = 0;
    for (const mission of this.store.missions(Number.MAX_SAFE_INTEGER)) {
      if (["completed", "failed", "stopped"].includes(mission.state)) continue;
      const answered = this.store.requests(mission.id).some((request) => request.resolvedBy === actor && request.resolution !== "deny" && request.resolution !== null);
      if (mission.deviceDriven !== actor && !answered) continue;
      try { await this.stop(mission.id, `workstation (revoked ${actor})`); stopped++; } catch { /* already ending */ }
    }
    return stopped;
  }
  /**
   * M-A-3 T9R-F01/F02: a revoked or signed-out device's unexecuted one-time answers end with it (the step asks again).
   * Idempotent; the request keeps its answer for audit and gains its end state.
   */
  endDeviceAnswers(actor: string, cause: "signout" | "revocation" = "revocation"): number {
    let ended = 0;
    const state = cause === "signout" ? "INVALIDATED_BY_SIGNOUT" : "INVALIDATED_BY_DEVICE_REVOCATION";
    for (const mission of this.store.missions(Number.MAX_SAFE_INTEGER)) for (const step of this.store.steps(mission.id)) {
      if (!step.approvedOnce || ["completed", "skipped", "failed", "stopped"].includes(step.state)) continue;
      try {
        if (this.store.request(step.approvedOnce.requestId).resolvedBy !== actor) continue;
      } catch { continue; }
      this.store.saveStep({ ...this.store.step(step.id), approvedOnce: null });
      // An answer already admitted (its step is running or verifying) did take effect: that is recorded as CONSUMED; it
      // authorizes nothing further (verification asks again). An unused answer is invalidated.
      // An answer that already authorized an admitted run carries CONSUMED (first stamp wins); an unused one is invalidated.
      this.stampLifecycle(step.approvedOnce.requestId, state, "bunny-host", `${actor} ${cause === "signout" ? "signed out" : "was revoked"}; the one-time answer authorizes nothing further.`);
      this.emit("approval.device_revoked", `${actor} ${cause === "signout" ? "signed out" : "was revoked"}; its one-time answer for ${step.approvedOnce.action} no longer applies.`, mission.id);
      ended++;
    }
    return ended;
  }
  /**
   * M-A-3 T9R-F02 (section 12): records why an answered request no longer authorizes anything. The first end state wins;
   * repeating it is a no-op (idempotent), and the answer itself is never rewritten.
   */
  stampLifecycle(requestId: string, state: NonNullable<PermissionRequest["lifecycle"]>["state"], by: string, reason: string): boolean {
    let request: PermissionRequest;
    try { request = this.store.request(requestId); } catch { return false; }
    if (request.lifecycle) return false;
    this.store.saveRequest({ ...request, lifecycle: { state, at: Date.now(), by, reason: reason.slice(0, 300) } });
    this.emit("approval.lifecycle", `Request ${requestId} (${request.action}) ${state}: ${reason.slice(0, 300)}`, request.missionId);
    return true;
  }
  /** Why this step's one-time answer cannot authorize now, or null. Workstation answers keep their existing rules. */
  onceInvalidity(step: MissionStep): { state: NonNullable<PermissionRequest["lifecycle"]>["state"]; reason: string } | null {
    if (!step.approvedOnce) return null;
    let request: PermissionRequest;
    try { request = this.store.request(step.approvedOnce.requestId); } catch { return { state: "INVALIDATED_BY_SCOPE_CHANGE", reason: "The answered request is unreadable." }; }
    if (request.lifecycle) return { state: request.lifecycle.state, reason: request.lifecycle.reason };
    if (!request.resolvedBy || !isDeviceActor(request.resolvedBy)) return null;
    if (this.deviceActive && !this.deviceActive(request.resolvedBy)) return { state: "INVALIDATED_BY_DEVICE_REVOCATION", reason: `${request.resolvedBy} is no longer a paired device.` };
    if ((request.resolvedAt ?? 0) + DEVICE_ANSWER_TTL_MS <= Date.now()) return { state: "EXPIRED", reason: "The paired-device answer was not used within its lifetime." };
    try {
      const mission = this.store.mission(step.missionId);
      const envelope = mission.authorizationId ? this.store.authorization(mission.authorizationId) : null;
      if (!envelope || envelope.revokedAt || envelope.expiresAt <= Date.now()) return { state: "EXPIRED", reason: "The Mission authorization the paired device answered under has ended." };
    } catch { return { state: "EXPIRED", reason: "The Mission authorization could not be read." }; }
    const consent = this.agentic.forMission(step.missionId);
    if (consent && (!request.agentic || request.agentic.revision !== consent.revision || request.agentic.generation !== this.tasks.instanceId))
      return { state: "INVALIDATED_BY_SCOPE_CHANGE", reason: "The Agent's permissions changed after the paired device answered." };
    return null;
  }
  /** The step with an invalid one-time answer cleared (and its request's end state recorded). */
  liveOnce(step: MissionStep): MissionStep {
    const invalid = this.onceInvalidity(step);
    if (!invalid || !step.approvedOnce) return step;
    this.stampLifecycle(step.approvedOnce.requestId, invalid.state, "bunny-host", invalid.reason);
    const current = this.store.step(step.id);
    if (current.approvedOnce?.requestId !== step.approvedOnce.requestId) return { ...step, approvedOnce: current.approvedOnce };
    const next = { ...current, approvedOnce: null };
    this.store.saveStep(next);
    return { ...step, approvedOnce: null };
  }
  // ── M-A-3 T9R-F02 (D2): inert staging and workstation promotion of paired-device changes ─────────────────
  /**
   * Called by the bus after admission and instead of the filesystem adapter: a write attributed to a paired device is
   * written into Host-owned staging, never into the project. Returns null when the write is not device-attributed.
   */
  stageRemoteWrite(request: CapabilityRequest, runId: string): CapabilityResult | null {
    if (!request.missionId) return null;
    const actor = this.remoteActorFor(request);
    if (!actor) return null;
    const fail = (summary: string): CapabilityResult => ({ ok: false, status: "failed", summary, output: null, evidence: [], errorCategory: "capability_failed" });
    if (!request.stepId || !request.envelope) return fail("A paired-device change must belong to an authorized Mission step.");
    const mission = this.store.mission(request.missionId);
    const content = typeof request.params.content === "string" ? request.params.content : null;
    if (content === null || typeof request.params.path !== "string") return fail('Parameters "path" and "content" are required.');
    const step = this.store.step(request.stepId);
    // Only a step's own write executor can wait for promotion; a skill or a verification check cannot be paused for it.
    if (step.executor.kind !== "capability" || step.executor.action !== "filesystem.write")
      return fail(`${DESKTOP_REQUIRED} A paired-device change inside a skill or check cannot be staged for review; run it on the Windows Host.`);
    const destination = scopedPath(request.cwd, request.params.path, request.roots);
    if (privateHostPath(this.dataDirectory, destination) || stagingPath(this.dataDirectory, destination))
      return fail("Private Host state is outside project scope.");
    const root = request.roots.find((candidate) => within(candidate, destination)) ?? request.cwd;
    const classified = classifyDeviceWrite(request.params.path, { base: request.cwd, operation: "write", content });
    let before: StagingRecord["destinationBefore"];
    try { before = destinationState(destination); } catch (error) { return fail(error instanceof Error ? error.message : String(error)); }
    if (before.existed && request.params.overwrite !== true) return fail(`${destination} already exists; overwrite was not requested.`);
    const hash = sha256(content);
    // A Retry after a restart or a lost answer never writes twice: the same promoted bytes are already in place.
    const applied = this.staging.forMission(mission.id).find((record) => record.stepId === request.stepId && record.destination === destination && record.contentHash === hash && record.promotionState === "PROMOTED");
    if (applied && before.sha256 === hash)
      return { ok: true, status: "succeeded", summary: `Already promoted on the Windows Host: paired-device change ${applied.id}; ${destination} holds the reviewed bytes.`, output: { path: destination, bytes: Buffer.byteLength(content), created: false, sha256: hash, alreadyPromoted: applied.id }, evidence: [`Destination SHA-256 ${hash} equals promoted paired-device change ${applied.id}`] };
    const consent = this.agentic.forMission(mission.id);
    const record = this.staging.stage({
      missionId: mission.id, agentId: consent?.agent_id ?? null, stepId: request.stepId, runId, deviceId: actor,
      envelopeId: request.envelope.id, envelopeRemote: isRemoteEnvelope(request.envelope),
      destination, destinationRoot: root, destinationBefore: before,
      classification: classified.classification, reasons: classified.reasons, warnings: classified.warnings,
      approvalRevision: consent ? `agentic:${consent.revision}` : `authorization:${request.envelope.id}`, hostGeneration: this.tasks.instanceId,
    }, content, request.envelope.projectRoots);
    this.emit("staging.staged", `Paired-device change ${record.id} staged for ${JSON.stringify(destination)} (${record.contentSize} bytes, sha256 ${record.contentHash}, ${record.classification}); it reaches the project only after review and promotion on the Windows Host.`, mission.id);
    return {
      ok: true, status: "succeeded",
      summary: `Staged a paired-device change of ${record.contentSize} bytes for ${destination}; awaiting review and promotion on the Windows Host.`,
      output: { staged: true, stagingId: record.id, destination, sha256: record.contentHash, bytes: record.contentSize, classification: record.classification },
      evidence: [`Staged paired-device change ${record.id} in Host-owned staging (sha256 ${record.contentHash}); the project was not changed.`],
    };
  }
  /** The workstation's review text for one staged change: identity, classification, warnings and exact bytes. */
  promotionReason(record: StagingRecord): string {
    const content = (() => { try { return this.staging.readVerified(record); } catch { return null; } })();
    const shown = content
      ? record.contentSize > REVIEW_BYTES
        ? `TOO LARGE TO SHOW HERE: only the first ${REVIEW_BYTES} bytes follow. Inspect the whole staged content on the Windows Host (mission.staging.inspect) before allowing; promotion is refused until every byte was inspected. First bytes (JSON): ${escapedText(content.subarray(0, REVIEW_BYTES))}`
        : `full content (JSON): ${escapedText(content)}`
      : "STAGED CONTENT UNREADABLE: promotion will be refused.";
    const safe = (text: string) => escapedText(Buffer.from(text, "utf8"));
    return `Approval required on Windows Host: promote a paired-device change into the project. Destination ${safe(record.destination)}; source ${record.deviceId}; Mission ${record.missionId}${record.agentId ? `; Agent ${record.agentId}` : ""}; classification ${record.classification} (${safe(record.reasons.at(-1) ?? "")})${record.warnings.length ? `; warnings: ${safe(record.warnings.join(" "))}` : ""}; ${record.contentSize} bytes, sha256 ${record.contentHash}; ${record.destinationBefore.existed ? `replaces the current file (sha256 ${record.destinationBefore.sha256})` : "creates a new file"}; ${shown}`;
  }
  /** Raises the Host's promotion request for a staged change (workstation-only; bound to the exact bytes and destination). */
  askPromotion(mission: Mission, step: MissionStep, record: StagingRecord) {
    this.askPermission(mission, step, "filesystem.promote", "WRITE", this.promotionReason(record), "verify", {
      desktopRequired: true,
      promotion: { stagingId: record.id, contentHash: record.contentHash, contentSize: record.contentSize, destination: record.destination, classification: record.classification },
    });
  }
  /** Workstation-only: the whole staged content, so more than the preview can be reviewed before promotion. */
  inspectStaged(stagingId: string, by: string): { stagingId: string; destination: string; sha256: string; bytes: number; classification: string; content: string } {
    if (!isTrustedLocalActor(by)) throw new WorkstationRequiredError(DESKTOP_REQUIRED);
    const record = this.staging.get(stagingId);
    if (!record) throw new CommandRefusedError("Unknown staged change.");
    let bytes: Buffer;
    try { bytes = this.staging.readVerified(record); } catch (error) { throw new CommandRefusedError(error instanceof Error ? error.message : String(error)); }
    this.staging.recordInspection(record.id, record.contentHash, by);
    this.emit("staging.inspected", `${by} inspected all ${record.contentSize} bytes of staged paired-device change ${record.id} (sha256 ${record.contentHash}).`, record.missionId);
    // Escaped exactly like the preview: invisible or bidirectional code points cannot reorder what the reviewer reads.
    return { stagingId: record.id, destination: record.destination, sha256: record.contentHash, bytes: record.contentSize, classification: record.classification, content: escapedText(bytes) };
  }
  /** Ends a staged change's chance of promotion (content kept for audit) and closes its open promotion request. */
  endStaged(record: StagingRecord, state: StagingState, by: string, reason: string, from: StagingState[] = ["STAGED"]): boolean {
    const ended = this.staging.transition(record.id, from, state, by, reason);
    if (!ended) return false;
    for (const request of this.store.requests(record.missionId))
      if (request.promotion?.stagingId === record.id && !request.resolvedAt) {
        this.store.saveRequest({ ...request, resolvedAt: Date.now(), resolution: "deny", resolvedBy: `${by} (${state.toLowerCase()})` });
        this.inbox.resolve(record.missionId, { requestId: request.id });
      }
    this.emit("staging.ended", `Staged paired-device change ${record.id} for ${JSON.stringify(record.destination)} is ${state}: ${reason}`, record.missionId);
    return true;
  }
  /** M-A-3 T9R-F02 (D5): staged, unpromoted changes a signed-out or revoked device produced can no longer be promoted. */
  invalidateDeviceStaging(actor: string, cause: "signout" | "revocation"): number {
    let ended = 0;
    for (const record of this.staging.inState("STAGED"))
      if (record.deviceId === actor) {
        if (!this.endStaged(record, cause === "signout" ? "INVALIDATED_BY_SIGNOUT" : "INVALIDATED_BY_DEVICE_REVOCATION", "bunny-host", `${actor} ${cause === "signout" ? "signed out" : "was revoked"} before promotion.`)) continue;
        ended++;
        const step = this.store.step(record.stepId);
        if (step.state === "waiting_for_approval" && this.store.request(step.pendingRequestId ?? "").promotion?.stagingId === record.id) {
          const mission = this.store.mission(record.missionId);
          this.stepFailed(mission, this.setStep(this.store.step(step.id), { state: "running", pendingRequestId: null, pendingPhase: null }), "permission_required", `The paired device that produced this change ${cause === "signout" ? "signed out" : "was revoked"}; it was not promoted.`);
        }
      }
    return ended;
  }
  /** Withdraws every staged, unpromoted change of a Mission (Stop, Retry, Replan). */
  withdrawStaged(missionId: string, by: string, reason: string, stepId?: string) {
    for (const record of this.staging.forMission(missionId))
      if (record.promotionState === "STAGED" && (!stepId || record.stepId === stepId)) this.endStaged(record, "WITHDRAWN", by, reason);
  }
  /**
   * The workstation's promotion of one staged change: every identity and authority is re-validated against CURRENT
   * state, then exactly the staged bytes are written atomically and read back. Synchronous end to end, so no other
   * Host admission interleaves. Throws CommandRefusedError before any project mutation when anything fails; staleness
   * ends the staged change (it is never promoted later), a temporary condition leaves the request open.
   */
  promoteStaged(request: PermissionRequest, by: string) {
    if (!isTrustedLocalActor(by)) throw new WorkstationRequiredError(DESKTOP_REQUIRED);
    const binding = request.promotion!;
    const record = this.staging.get(binding.stagingId);
    const end = (state: StagingState, reason: string): never => {
      if (record) this.endStaged(record, state, "bunny-host", reason);
      const step = this.store.step(request.stepId);
      if (step.state === "waiting_for_approval" && step.pendingRequestId === request.id)
        this.stepFailed(this.store.mission(request.missionId), this.setStep(step, { state: "running", pendingRequestId: null, pendingPhase: null }), "permission_required", `Promotion refused: ${reason}`);
      throw new CommandRefusedError(`Promotion refused: ${reason}`);
    };
    if (!record || record.missionId !== request.missionId || record.stepId !== request.stepId || record.contentHash !== binding.contentHash || record.destination !== binding.destination || record.contentSize !== binding.contentSize)
      end("FAILED", "the request does not match the staged change it names.");
    const staged = record!;
    const closeWaiting = (reason: string) => {
      const current = this.store.request(request.id);
      if (!current.resolvedAt) { this.store.saveRequest({ ...current, resolvedAt: Date.now(), resolution: "deny", resolvedBy: "bunny-host (promotion failed)" }); this.inbox.resolve(request.missionId, { requestId: request.id }); }
      const step = this.store.step(request.stepId);
      if (step.state === "waiting_for_approval" && step.pendingRequestId === request.id)
        this.stepFailed(this.store.mission(request.missionId), this.setStep(step, { state: "running", pendingRequestId: null, pendingPhase: null }), "permission_required", `Promotion failed: ${reason}`);
    };
    if (staged.promotionState !== "STAGED") {
      if (["FAILED", "REJECTED", "WITHDRAWN"].includes(staged.promotionState) || staged.promotionState.startsWith("INVALIDATED")) closeWaiting(`this staged change is ${staged.promotionState}.`);
      throw new CommandRefusedError(`Promotion refused: this staged change is ${staged.promotionState}.`);
    }
    // Temporary conditions: the request stays open and the workstation can answer again.
    if (staged.contentSize > REVIEW_BYTES && staged.inspectedHash !== staged.contentHash)
      throw new CommandRefusedError(`Promotion refused: the change is ${staged.contentSize} bytes and only ${REVIEW_BYTES} were shown. Inspect the whole staged content on the Windows Host first (mission.staging.inspect ${staged.id}).`);
    const live = this.liveCodeExecutions();
    if (live.length) throw new CommandRefusedError(`Promotion waits: code Bunny tracks is running on this computer (${live.slice(0, 4).join(", ")}); promote after it ends so it cannot read the change mid-run.`);
    if (this.desktopExecutionConflict(staged.destination)) throw new CommandRefusedError("Promotion waits: a trusted-desktop execution is running in this folder.");
    // Authority: the Mission, its envelope, the Agent consent and the producing device, as they are NOW.
    const mission = this.store.mission(request.missionId);
    if (["stopped", "failed", "completed"].includes(mission.state) || this.stopping.has(mission.id)) end("WITHDRAWN", "the Mission is no longer running.");
    const envelope = mission.authorizationId ? this.store.authorization(mission.authorizationId) : null;
    if (!envelope || envelope.revokedAt || envelope.id !== staged.envelopeId) end("INVALIDATED_BY_SCOPE_CHANGE", "the Mission authorization the change was staged under has ended or changed.");
    // A change made under the device's own (remote) envelope depends on that device; under a workstation envelope the
    // workstation's promotion is the owner's independent decision on the exact bytes.
    if (staged.envelopeRemote && this.deviceActive && isDeviceActor(staged.deviceId) && !this.deviceActive(staged.deviceId)) end("INVALIDATED_BY_DEVICE_REVOCATION", `${staged.deviceId} is no longer a paired device.`);
    const step = this.store.step(request.stepId);
    const cwd = step.workspace ?? mission.root;
    const params = step.executor.kind === "capability" && step.executor.action === "filesystem.write" ? step.executor.params as Record<string, unknown> : { path: staged.destination };
    const consent = this.agentic.forMission(mission.id);
    if (consent) {
      if (!["ACTIVE", "EXHAUSTED"].includes(consent.current_state) || consent.host_generation !== this.tasks.instanceId || consent.expires_at <= Date.now() || `agentic:${consent.revision}` !== staged.approvalRevision)
        end("INVALIDATED_BY_SCOPE_CHANGE", "the Agent's permissions changed after the change was staged.");
      if (agenticScopeViolation(consent, "filesystem.write", params, "WRITE", cwd, undefined, step.id) && !this.reviewedFilesystemOnce(this.capabilityRequest(mission, step, envelope!, "filesystem.write", params, cwd), consent, "WRITE"))
        end("INVALIDATED_BY_SCOPE_CHANGE", "the Agent no longer has permission to write this file.");
    } else {
      // Plain Missions: the envelope's write roots, plus the folder a workstation one-time answer reviewed (never a device's).
      const once = step.approvedOnce?.action === "filesystem.write" && isTrustedLocalActor(this.onceResolver(step)) ? [dirname(staged.destination)] : [];
      if (!withinAny([...envelope!.filesystem.write, ...once], staged.destination)) end("INVALIDATED_BY_SCOPE_CHANGE", "the destination is outside the Mission's current write authority.");
    }
    // Resource identity: the destination path, its folder chain and its current content are what was staged against.
    let bytes: Buffer;
    try { bytes = this.staging.readVerified(staged); } catch (error) { return end("FAILED", error instanceof Error ? error.message : String(error)); }
    // Re-classified with the exact staged bytes, so a content-triggered class never passes at promotion (review round 5).
    const reclassified = classifyDeviceWrite(staged.destination, { base: staged.destinationRoot, operation: "write", content: bytes.toString("utf8") });
    if (reclassified.classification === "UNKNOWN") end("FAILED", `the destination can no longer be resolved safely (${reclassified.reasons.at(-1)}).`);
    if (staged.envelopeRemote && !PHONE_SAFE_CLASSES.includes(reclassified.classification)) end("INVALIDATED_BY_SCOPE_CHANGE", `the destination is now ${reclassified.classification} (${reclassified.reasons.at(-1)}).`);
    if (canonical(staged.destination) !== staged.destination) end("FAILED", "the destination now resolves elsewhere.");
    if (privateHostPath(this.dataDirectory, staged.destination) || stagingPath(this.dataDirectory, staged.destination)) end("FAILED", "the destination is private Host state.");
    let now: StagingRecord["destinationBefore"];
    try { now = destinationState(staged.destination); } catch (error) { return end("FAILED", `the destination changed (${error instanceof Error ? error.message : String(error)}).`); }
    if (now.existed !== staged.destinationBefore.existed || now.sha256 !== staged.destinationBefore.sha256) end("FAILED", "the destination file was created, replaced or edited after the change was staged.");
    // Commit: intent first (a crash is reconciled at recovery), then the bounded atomic write, then independent read-back.
    if (!this.staging.transition(staged.id, ["STAGED"], "PROMOTING", by, `Promotion approved by ${by} (request ${request.id}).`)) throw new CommandRefusedError("Promotion refused: the staged change was ended concurrently.");
    let written: { sha256: string; size: number };
    try { written = writePromoted(staged.destination, bytes); }
    catch (error) {
      this.promotionFailed(staged, `Write failed: ${error instanceof Error ? error.message : String(error)}`);
      closeWaiting("the destination write failed; it is listed for review before any code runs.");
      throw new CommandRefusedError(`Promotion failed while writing: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (written.sha256 !== staged.contentHash || written.size !== staged.contentSize) {
      this.promotionFailed(staged, "Read-back did not match the reviewed bytes.");
      closeWaiting("the destination read-back did not match the reviewed bytes; it is listed for review before any code runs.");
      throw new CommandRefusedError("Promotion failed: the destination read-back did not match the reviewed bytes.");
    }
    try {
    this.store.host.transaction(() => {
      this.staging.transition(staged.id, ["PROMOTING"], "PROMOTED", by, `Promoted by ${by}; read-back sha256 ${written.sha256}.`);
      // The workstation reviewed exactly these bytes, so the change is recorded as an already reviewed device change.
      const changeId = this.store.recordRemoteChange({ runId: staged.runId, missionId: staged.missionId, path: staged.destination, root: staged.destinationRoot, actor: staged.deviceId });
      this.store.acknowledgeRemoteChanges([changeId], by);
    });
    } catch (error) {
      // The project already changed: record it as unreviewed, close the request and fail the step.
      this.promotionFailed(staged, `Recording the promotion failed: ${error instanceof Error ? error.message : String(error)}`);
      closeWaiting("the promotion could not be recorded; the destination is listed for review before any code runs.");
      throw new CommandRefusedError("Promotion failed while recording it; the destination is listed for review.");
    }
    this.emit("staging.promoted", `${by} promoted staged paired-device change ${staged.id} into ${JSON.stringify(staged.destination)} (${written.size} bytes, sha256 ${written.sha256}, independently read back).`, staged.missionId);
  }
  /**
   * A promotion that failed after it may have touched the destination: the change is recorded as an UNREVIEWED
   * paired-device change, so no Bunny code runs over whatever is on disk until the workstation reviews it.
   */
  promotionFailed(staged: StagingRecord, reason: string) {
    this.staging.transition(staged.id, ["PROMOTING"], "FAILED", "bunny-host", reason);
    this.store.recordRemoteChange({ runId: staged.runId, missionId: staged.missionId, path: staged.destination, root: staged.destinationRoot, actor: staged.deviceId });
    this.emit("staging.failed", `Promotion of paired-device change ${staged.id} failed (${reason}); the destination is listed for review before any code runs.`, staged.missionId);
  }
  onceResolver(step: MissionStep): string | null {
    try { return step.approvedOnce ? this.store.request(step.approvedOnce.requestId).resolvedBy : null; } catch { return null; }
  }
  /** Workstation-approved code running right now: code-running capability runs and shell-capable provider sessions. */
  liveCodeExecutions(): string[] {
    const classify = (provider: ProviderId, access: string | undefined, mission: boolean) =>
      // Direct Ollama inference carries no scope but has no tools either.
      provider === "ollama" && !mission ? "tool_free" : providerSessionAuthority(provider, access);
    const live = (label: string, authority: string | null) => authority === "tool_free" || authority === "read_tools" ? [] : [label];
    const sessions = [...this.tasks.sessions.keys()].flatMap((id) => {
      try {
        const task = this.tasks.db.get(id);
        return live(`${task.provider} session ${id}`, classify(task.provider, task.executionScope?.access, !!task.mission));
      } catch { return [`session ${id}`]; }
    });
    // Survivors are judged by the attempt that left them, never by the Task's current (possibly rerouted) provider.
    const survivors = [...this.tasks.lingering.keys()].flatMap((key) => {
      const attempt = this.tasks.lingeringAttempt.get(key);
      return attempt ? live(`${attempt.provider} survivors ${key}`, classify(attempt.provider, attempt.access, attempt.mission)) : [`survivors ${key}`];
    });
    // M-A-3 T9R-F04 (review round 2, L3): Host-run verification jobs execute project content too.
    return [...[...this.bus.liveCode.values()], ...sessions, ...survivors, ...liveHostCodeRuns()];
  }
  /** A paired-device change waits while workstation-approved code runs, unless the workstation allowed this exact step. */
  remoteMutationHeld(request: CapabilityRequest): string | null {
    if (!this.remoteActorFor(request)) return null;
    if (request.stepId) {
      try {
        const once = this.store.step(request.stepId).approvedOnce;
        const step = this.store.step(request.stepId);
        if (step.executor.kind === "capability" && once?.action === request.action && isTrustedLocalActor(this.store.request(once.requestId).resolvedBy)) return null;
      } catch { /* fall through: held */ }
    }
    const live = this.liveCodeExecutions();
    const target = typeof request.params.path === "string" ? resolve(request.cwd, request.params.path) : request.action;
    return live.length ? `Approval required on Windows Host: code approved on the Windows Host that Bunny tracks is running (${live.slice(0, 4).join(", ")}); a paired-device ${request.action} of ${JSON.stringify(target)} waits until it ends. Allowing it now lets the running code read it unreviewed; it is listed for review only before code that starts later.` : null;
  }
  /** Executions running under a trusted-desktop grant: the folder they run in and how to tell they ended. */
  desktopExecutions = new Map<string, { root: string; live: () => boolean }>();
  /** Why a Mission change to this path must wait for a running trusted-desktop execution, or null. */
  desktopExecutionConflict(path: string): string | null {
    for (const [key, run] of this.desktopExecutions) {
      let live = false;
      try { live = run.live(); } catch { live = false; }
      if (!live) { this.desktopExecutions.delete(key); continue; }
      if (within(run.root, path) || within(path, run.root))
        return "A trusted-desktop execution is running in this folder; this change waits until it finishes.";
    }
    return null;
  }
  /** Re-validates and spends one use; synchronous, so no other admission interleaves. Returns why not, or null. */
  consumeDesktopGrant(requestId: string, violation: (grant: DesktopGrant | undefined) => string | null): string | null {
    const record = this.store.request(requestId);
    const reason = violation(record.desktopGrant);
    if (reason) return reason;
    const grant = record.desktopGrant!;
    this.store.saveRequest({ ...record, desktopGrant: { ...grant, uses: grant.uses + 1 } });
    this.emit(
      "approval.desktop_grant_used",
      `Trusted-desktop grant ${grant.id} used (${grant.uses + 1}/${grant.maxUses}) for ${grant.operation.kind === "provider_session" ? `${grant.operation.provider} ${grant.operation.access} session` : grant.operation.action}.`,
      record.missionId,
    );
    return null;
  }
  /** Mints the exact-operation grant behind a workstation allow_once of a desktop-required ask. */
  mintDesktopGrant(request: PermissionRequest): DesktopGrant {
    if (!request.desktopOperation) throw new CommandRefusedError("This request is not bound to one exact operation; replan it on the workstation.");
    const { now: _now, operation, ...bindings } = this.desktopContext(request.missionId, request.stepId, request.desktopOperation);
    if (!bindings.authorizationId) throw new CommandRefusedError("The Mission has no live authorization.");
    const asked = request.desktopBinding;
    if (!asked || asked.taskId !== bindings.taskId || asked.authorizationId !== bindings.authorizationId || asked.planReference !== bindings.planReference)
      throw new CommandRefusedError("The Task, authorization or plan changed after this request was raised; review the current request.");
    // The workstation approves what its prompt showed: no project change may land between the ask and the answer.
    if (asked.mutationSequence !== bindings.mutationSequence)
      throw new DesktopRequestStale("Project files changed after this request was raised; a fresh request lists the changes.");
    const now = Date.now();
    return { id: crypto.randomUUID(), requestId: request.id, ...bindings, operation, grantedBy: "workstation", grantedAt: now, expiresAt: now + DESKTOP_GRANT_TTL_MS, maxUses: DESKTOP_GRANT_MAX_USES, uses: 0, revokedAt: null };
  }
  /** Ends every unused grant of a Mission (stop, replan). Grants are also void by epoch, plan, envelope and expiry. */
  revokeDesktopGrants(missionId: string, reason: string) {
    let ended = 0;
    for (const record of this.store.requests(missionId))
      if (record.desktopGrant && record.desktopGrant.revokedAt === null && record.desktopGrant.uses < record.desktopGrant.maxUses) {
        this.store.saveRequest({ ...record, desktopGrant: { ...record.desktopGrant, revokedAt: Date.now() } });
        ended++;
      }
    if (ended) this.emit("approval.desktop_grant_revoked", `${ended} unused trusted-desktop grant(s) ended: ${reason}.`, missionId);
    return ended;
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
        request,
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
    // M-A-3 T11: the step's own Agent must be a live member of this team (consent belongs to the Coordinator).
    const teamStep = this.store.step(stepId);
    if (teamStep.team) {
      const owner = ownerRow(this, teamStep.team.agentId);
      if (!owner || owner.missionId !== missionId || owner.stopped || (owner.id !== e.agent_id && owner.coordinatorId !== e.agent_id) || ["COMPLETED", "FAILED", "STOPPED"].includes(owner.state))
        return "Current team Agent identity or Stop blocks admission.";
    }
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
          "staging",
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
              isTrustedLocalActor(batch.createdBy) &&
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
      // M-A-3 T9R-F02 (D3): only the authenticated workstation's exact-resource decision on the Host extends an Agent's
      // consent for one resource. A paired-device answer never restores or widens what the owner narrowed.
      isTrustedLocalActor(once?.resolvedBy) &&
      !once?.lifecycle &&
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
          this.projectContext.assertScan(mission.projectId, mission.id, path, e, this.stepOwner(request.stepId));
        else
          this.projectContext.assertResource(
            mission.projectId,
            mission.id,
            path,
            e,
            request.action === "filesystem.write" && typeof params.content === "string"
              ? Buffer.byteLength(params.content)
              : 0,
            this.stepOwner(request.stepId),
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
          agent_id: this.stepOwner(task.mission.stepId) ?? e.agent_id,
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
    // A direct task approval observes the same current member and Coordinator pause/stop boundaries as the scheduler.
    const hold = step.team ? ownerHold(this, step) ?? (this.missionPauseGate?.(step.missionId) ? "The Coordinator is paused." : null) : null;
    if (hold) { this.tasks.stopInBackground(taskId, hold); return; }
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
        // T13.3 N-C: the TaskManager's own record of an uncertain write outcome, never the error text.
        task.reconciliation?.required ? task.reconciliation.reason : null,
      );
      return;
    }
    const output = task.output.trim();
    // M-A-3 T11: a team step keeps the canonical content extracted from the reply (one JSON value, Markdown body or
    // HTML document), still unverified; raw and canonical hashes are recorded so seeding or extraction is visible.
    const canonical = step.team ? canonicalOutput(this, mission, step, task.output) : null;
    const artifact = await this.artifacts.create({
      missionId: mission.id,
      stepId: step.id,
      type: step.expectedArtifacts[0] ?? "text",
      title: `${step.role} output`,
      inline: canonical ? canonical.text : output || "(no output)",
      mediaType: canonical ? (step.expectedArtifacts[0] === "source_file" ? "text/html" : step.expectedArtifacts[0] === "text" ? "text/markdown" : "application/json") : "text/plain",
      provenance: `provider:${task.provider}:${task.id}`,
      verification: "unverified",
    });
    if (canonical)
      this.setStep(this.store.step(step.id), { evidence: [...this.store.step(step.id).evidence, `attempt ${step.attempts.length}: raw output sha256 ${canonical.rawSha256}; canonical sha256 ${artifact.sha256}${canonical.seeded ? " (SEEDED by the acceptance harness)" : ""}; model ${task.model}`].slice(-20) });
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
        if (outcome.decision.decision === "ask") { this.askPermission(mission, this.store.step(step.id), check.action, outcome.decision.risk, outcome.decision.reason, "verify", outcome.decision,
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
              outcome.decision,
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
            outcome.decision,
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
      } else if (check.kind === "team_output" || check.kind === "team_file" || check.kind === "team_requirements") {
        const outcome = await verifyTeamCriterion(this, mission, step, envelope, check, [...result.artifactIds]);
        if (interrupted()) return;
        if (outcome.ask) { this.askPermission(mission, this.store.step(step.id), outcome.ask.action, outcome.ask.risk as PermissionRequest["risk"], outcome.ask.reason, "verify", outcome.ask.decision); return; }
        passed &&= outcome.ok;
        result.artifactIds.push(...outcome.artifactIds);
        checks.push(...outcome.lines);
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
        this.writeCapable(step) ? "VERIFY_PAUSE: the step finished but did not pass Bunny's own check; re-running it could repeat the changes it already made." : null,
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
    // M-A-3 T9R-F02 (section 12): the one-time answer that carried this step is spent with it.
    if (step.approvedOnce) this.stampLifecycle(step.approvedOnce.requestId, "CONSUMED", "bunny-host", `${step.role} completed under this one-time answer.`);
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
            : step.team && step.executor.kind === "model" && result.artifactIds[0]
              ? { outputRef: result.artifactIds[0] }
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
    // M-A-3 T11: a verified plan is installed for review; nothing runs until the user approves it by name.
    if (step.team?.kind === "plan" && isTeam(mission)) {
      try { await installTeamPlan(this, this.store.mission(mission.id) as Mission & { team: NonNullable<Mission["team"]> }, this.store.step(step.id)); }
      catch (error) {
        const current = this.store.mission(mission.id);
        const detail = error instanceof Error ? error.message : String(error);
        if (["running", "waiting_for_user"].includes(current.state))
          this.setMission(current, { state: "waiting_for_user", team: { ...current.team!, rejected: [...current.team!.rejected, { at: Date.now(), reasons: [detail.slice(0, 500)] }].slice(-10) } }, "mission.waiting_for_user", `The team plan could not be installed: ${detail.slice(0, 400)}`);
      }
      return;
    }
    this.schedule(mission.id);
  }
  /**
   * M-A-3 T13.3 N-C: whether re-running this step could repeat a change: model work not declared read, any capability
   * or skill that is not read-only, unless the Host itself enforces duplicate protection for it. Fails closed.
   */
  writeCapable(step: MissionStep): boolean {
    // A team write always runs under teamWrite's pre-image guard (Host-enforced dedup), whatever its stored params say.
    if (step.team?.kind === "write_file") return false;
    if (step.executor.kind === "model") {
      if (step.scope?.access === "read") return false;
      // Same rule as direct tasks: work that ran on a tool-free provider could not write.
      try { if (step.taskId && ADAPTER_TOOL_CONTRACTS[this.tasks.db.get(step.taskId).provider] === false) return false; } catch { /* no task: fail closed */ }
      return true;
    }
    if (step.executor.kind === "capability")
      return (this.bus.riskOf(step.executor.action, step.executor.params) ?? "EXECUTE") !== "READ" && !enforcedIdempotent(step.executor.action, step.executor.params);
    return true;
  }
  /** `uncertain`: why the failed attempt may have changed something (T13.3 N-C); such a step never retries automatically. */
  stepFailed(mission: Mission, step: MissionStep, category: FailureCategory, detail: string, uncertain: string | null = null) {
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
    // A failed team check activates the owner-reviewed rework chain. Its replica write runs under teamWrite's pre-image
    // guard (FILE_CONFLICT unless the file holds this Mission's own last verified bytes), so nothing is replayed blindly.
    if (owned.team && mission.team && !uncertain && this.teamFailure(mission, owned, category, detail)) return;
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
    const verdict = uncertain
      ? { retry: false, reroute: false, waitForUser: true, reason: `Outcome uncertain — reconciliation required. ${uncertain}` }
      : retryVerdict(
          category,
          attempts.length,
          step.maxRetries,
          this.accounting(mission.id).retries,
          mission.budget.maxRetries,
          step.scope?.access,
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
        ...(uncertain ? { reconciliation: { required: true, reason: uncertain.slice(0, 1000), at: Date.now() } } : {}),
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

  /**
   * M-A-3 T11 team failure policy, applied before the generic retry verdict. A failed Host postcondition on a delivery
   * activates the reviewed rework replica; conflicts, refused handoffs and scope refusals hold for the user (retrying
   * cannot change them); a rejected plan is recorded and retried by the bounded planner budget.
   */
  teamFailure(mission: Mission, step: MissionStep, category: FailureCategory, detail: string): boolean {
    if (!isTeam(mission)) return false;
    if (step.team?.kind === "plan" && category === "verification_failed") {
      const current = this.store.mission(mission.id);
      this.setMission(current, { team: { ...current.team!, planRevisions: current.team!.planRevisions + 1, rejected: [...current.team!.rejected, { at: Date.now(), reasons: detail.split("; ").slice(0, 15) }].slice(-10) } }, "mission.team.plan_rejected", `Bunny rejected the Planner Agent's proposal (${detail.split("; ").length} reason(s)).`);
      return false;
    }
    if (step.team?.kind === "verify_output" && category === "verification_failed" && activateRework(this, mission, step, detail)) return true;
    if (!/^(HANDOFF_REFUSED|FILE_CONFLICT|CONTEXT_BOUND|TEAM_[A-Z_]+):/.test(detail)) return false;
    const attempts = step.attempts.map((attempt, index) => index === step.attempts.length - 1 ? { ...attempt, finishedAt: Date.now(), outcome: "failed" as const, category, detail: detail.slice(0, 1500) } : attempt);
    this.setStep(step, { state: "failed", finishedAt: Date.now(), attempts, failure: { category, detail: detail.slice(0, 2000) }, approvedOnce: null }, "mission.step.failed", `${step.role} held: ${detail.slice(0, 400)}`);
    const current = this.store.mission(mission.id);
    if (current.state === "running") this.setMission(current, { state: "waiting_for_user" }, "mission.waiting_for_user", `Mission ${mission.id}: ${step.role} needs you — ${detail.slice(0, 300)}`);
    return true;
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
    desktop: Pick<PermissionDecision, "desktopRequired" | "desktopOperation" | "remoteReview"> & Pick<PermissionRequest, "promotion"> = {},
  ) {
    const delegation = this.agentic.forMission(mission.id);
    // M-A-3 T9R-F02: a promotion request is fingerprinted by the staged change it names, never by the executor's params.
    const params = desktop.promotion ? { stagingId: desktop.promotion.stagingId, contentHash: desktop.promotion.contentHash, path: desktop.promotion.destination } : this.agenticRequestParams(step, action, phase);
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
    if (phase === "execute" && !/ask every time/.test(reason) && !desktop.desktopRequired) {
      try {
        batchOffer = this.batchOfferFor(mission, step, action);
      } catch {
        batchOffer = null;
      }
    }
    // M-A-3 T9R-F01: the workstation sees which project files paired-device authority changed before it approves code.
    const deviceChanges = desktop.desktopRequired ? this.remoteChanges(mission) : [];
    if (deviceChanges.length)
      reason = `${reason} Files changed in this Mission under paired-device authority: ${deviceChanges.slice(0, 12).map((path) => JSON.stringify(path)).join(", ")}${deviceChanges.length > 12 ? ` and ${deviceChanges.length - 12} more` : ""}. Review them before allowing.`;
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
      ...(desktop.desktopRequired
        ? {
            desktopRequired: true,
            ...(desktop.desktopOperation ? { desktopOperation: desktop.desktopOperation } : {}),
            ...(desktop.remoteReview?.length ? { remoteReview: desktop.remoteReview } : {}),
            ...(desktop.promotion ? { promotion: desktop.promotion } : {}),
            desktopBinding: { taskId: this.store.step(step.id).taskId, authorizationId: mission.authorizationId ?? "", planReference: this.agenticPlanReference(mission.id), mutationSequence: this.store.mutationSequence() },
          }
        : {}),
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
      const refusal = this.deviceRequestRefusal(request, decision);
      if (refusal) throw new WorkstationRequiredError(refusal);
    }
    // M-A-3 T9R-F01: only the authenticated workstation allows a desktop-required ask, never as a batch.
    if (request.desktopRequired && decision !== "deny" && (!isTrustedLocalActor(by) || decision !== "allow_once"))
      throw new WorkstationRequiredError(DESKTOP_REQUIRED);
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
    // M-A-3 T9R-F02 (D2): a promotion runs here, synchronously, BEFORE the request is resolved: any failed validation
    // leaves the project untouched (and either keeps the request open or ends the staged change).
    if (request.promotion && decision === "allow_once") this.promoteStaged(request, by);
    if (request.promotion && decision === "deny") {
      const record = this.staging.get(request.promotion.stagingId);
      if (record) this.staging.transition(record.id, ["STAGED"], "REJECTED", by, `Promotion denied by ${by} (request ${requestId}).`);
    }
    let desktopGrant: DesktopGrant | undefined;
    try {
      desktopGrant = request.desktopRequired && decision === "allow_once" && !request.promotion ? this.mintDesktopGrant(request) : undefined;
    } catch (error) {
      if (!(error instanceof DesktopRequestStale)) throw error;
      // Superseded (recorded as deny with a "superseded" resolver, not as the user's choice): ask again so the
      // workstation reviews the current project state.
      this.store.saveRequest({ ...request, resolvedAt: Date.now(), resolution: "deny", resolvedBy: `${by} (superseded: project changed)` });
      this.inbox.resolve(request.missionId, { requestId });
      const review = request.remoteReview?.length ? this.pendingRemoteReview() : null;
      // A review re-ask shows exactly the changes it acknowledges (rebuilt from the current listing, never the old text).
      const reason = review
        ? `Approval required on Windows Host: this runs code over files changed under paired-device authority. Review their content before allowing:${review.listing}${review.more ? `\n${review.more} more changed file(s) are listed for review after these.` : ""}`
        : request.reason.split(" Files changed in this Mission under paired-device authority")[0];
      this.askPermission(this.store.mission(request.missionId), this.store.step(step.id), request.action, request.risk,
        reason, step.pendingPhase ?? "execute",
        { ...request, ...(review ? { remoteReview: review.ids } : {}) });
      throw new CommandRefusedError(error.message);
    }
    this.store.saveRequest({
      ...request,
      resolvedAt: Date.now(),
      resolution: decision,
      resolvedBy: by,
      ...(desktopGrant ? { desktopGrant } : {}),
    });
    if (decision === "allow_once" && isTrustedLocalActor(by) && request.remoteReview?.length) {
      this.store.acknowledgeRemoteChanges(request.remoteReview, by);
      this.emit("approval.remote_changes_reviewed", `${by} reviewed ${request.remoteReview.length} paired-device change(s) before code runs over them (request ${requestId}).`, request.missionId);
    }
    if (desktopGrant)
      this.emit(
        "approval.desktop_grant",
        `Trusted-desktop grant ${desktopGrant.id} for request ${requestId}: ${desktopGrant.operation.kind === "provider_session" ? `${desktopGrant.operation.provider} ${desktopGrant.operation.access} session (${desktopGrant.operation.sessionAuthority})` : desktopGrant.operation.action}; single use until ${new Date(desktopGrant.expiresAt).toISOString()} in Host epoch ${desktopGrant.epoch}.`,
        request.missionId,
      );
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
        // M-A-3 T9R-F01: a grant whose launch was refused never lingers.
        const answered = this.store.request(requestId);
        if (answered.desktopGrant && answered.desktopGrant.revokedAt === null)
          this.store.saveRequest({ ...answered, desktopGrant: { ...answered.desktopGrant, revokedAt: Date.now() } });
        const current = this.store.step(step.id);
        // More paired-device changes than one prompt lists: the workstation reviews the next page, not a failure.
        const review = request.remoteReview?.length && current.state === "waiting_for_approval" ? this.pendingRemoteReview() : null;
        if (review) {
          const task = this.tasks.db.get(step.taskId);
          this.askPermission(this.store.mission(mission.id), current, "provider.execute", "EXECUTE",
            `${task.provider} for ${current.role}: it can run code over files changed under paired-device authority; review their content before allowing:${review.listing}${review.more ? `\n${review.more} more changed file(s) are listed for review after these.` : ""}`,
            "execute", { desktopRequired: true, desktopOperation: sessionOperation(task), remoteReview: review.ids });
          return this.view(this.store.mission(mission.id));
        }
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
    this.revokeDesktopGrants(id, `Mission stopped by ${by}`);
    this.withdrawStaged(id, by, `Mission stopped by ${by}.`);
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
            ...(step.approvedOnce ? { approvedOnce: null } : {}),
          });
        }
      // M-A-3 T9R-F02 (round 4): a failed step's unused one-time answer ends with the Mission too.
      for (const step of this.store.steps(id))
        if (step.state === "failed" && step.approvedOnce) this.setStep(step, { approvedOnce: null });
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
  /**
   * M-A-3 T13.3 N-C: the owner's decision about a step whose outcome is uncertain. "retry" records the review and runs
   * the normal bounded Retry (same Mission and step, a fresh child task, fresh approvals); "stop" stops the Mission. The
   * workstation only: MISSION_ACTIONS admits it and the device REMOTE set does not.
   */
  async reconcile(id: string, stepId: string, resolution: unknown, by: string): Promise<MissionView> {
    const step = this.store.step(stepId);
    if (step.missionId !== id) throw new CommandRefusedError("That step is not part of this Mission.");
    if (step.state !== "failed" || !step.reconciliation?.required) throw new CommandRefusedError("This step has no uncertain outcome waiting for reconciliation.");
    if (resolution !== "retry" && resolution !== "stop") throw new CommandRefusedError("Resolution must be retry or stop.");
    const before = step.reconciliation;
    const resolved = { ...before, required: false, resolution: resolution as "retry" | "stop", resolvedBy: by, resolvedAt: Date.now() };
    const recorded = `${by} reviewed the uncertain outcome of ${step.role} and chose ${resolution}.`;
    if (resolution === "stop") {
      this.setStep(step, { reconciliation: resolved }, "mission.step.reconciled", recorded);
      return await this.stop(id, by);
    }
    // A retry never runs beside a process of an earlier attempt that may still be alive: this Host's watch of any child
    // task of the step, a restart survivor of this Mission, or an unreadable record, which names no owner (fail closed).
    const children = [step.taskId, ...step.attempts.map((attempt) => attempt.taskId)].filter((child): child is string => !!child);
    // Only a child that was launched can hold a process; one that never launched (waiting_for_approval) cannot block.
    const unfinished = children.some((child) => this.tasks.sessions.has(child) || (() => { try { return CHILD_LAUNCHED.includes(this.tasks.db.get(child).state); } catch { return false; } })());
    if (unfinished || [...this.tasks.lingering.keys()].some((key) => key.startsWith("unreadable:") || children.some((child) => key.startsWith(`${child}#`)) || this.tasks.restartSurvivorMission.get(key)?.missionId === id))
      throw new CommandRefusedError("A provider process from an earlier attempt may still be running, or its record cannot be read yet; Bunny starts no retry until none is alive. Try again shortly.");
    // The decision is recorded (and announced) only once the Retry it authorizes is accepted.
    this.setStep(step, { reconciliation: resolved });
    try {
      this.retry(id, by);
    } catch (error) {
      // A refused Retry leaves the step exactly as uncertain as it was, with no record of a decision.
      this.setStep(this.store.step(stepId), { reconciliation: before });
      throw error;
    }
    this.setStep(this.store.step(stepId), {}, "mission.step.reconciled", recorded);
    return this.view(this.store.mission(id));
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
    // M-A-3 T9R-F02: a step waiting for promotion is retried by staging its change again for a fresh review. Every
    // refusal below is checked before anything changes, so a refused Retry never withdraws a staged change (round 4).
    const waitingPromotion = this.store.steps(id).filter((step) => step.state === "waiting_for_approval" && !!step.pendingRequestId && !!this.store.request(step.pendingRequestId).promotion);
    const before = this.store.steps(id);
    // M-A-3 T11: a superseded original keeps its failure as history; only live steps are retried.
    const retryable = [...before.filter((step) => step.state === "failed" && !step.team?.supersededBy), ...waitingPromotion];
    if (!retryable.length && !before.some((step) => step.state === "blocked"))
      throw new Error("No failed step to retry.");
    // T13.3 N-C: a step whose last attempt may already have taken effect is never replayed before the owner reconciles it.
    const unreconciled = retryable.filter((step) => step.reconciliation?.required);
    if (unreconciled.length)
      throw new CommandRefusedError(`OUTCOME_UNCERTAIN: ${unreconciled.map((step) => step.role).join(", ")} may already have taken effect. Review it, then reconcile (mission.reconcile) before retrying.`);
    for (const step of retryable)
      // Explicit retries are still bounded: at most twice the automatic per-step limit plus one.
      if (step.attempts.length > step.maxRetries * 2 + 1)
        throw new Error(
          `${step.role} reached its attempt ceiling (${step.attempts.length}); replan instead.`,
        );
    // M-A-3 T9R-F01: a trusted-desktop grant covers one attempt; Retry always asks again (after every refusal check).
    this.revokeDesktopGrants(id, `Mission retried by ${by}`);
    for (const step of waitingPromotion) {
      const detail = `Retried by ${by}: the change is staged again for a fresh review.`;
      // The attempt that staged the change ends here (review F03 round 2), so no attempt stays "running".
      const attempts = step.attempts.map((attempt, index) =>
        index === step.attempts.length - 1 && attempt.outcome === "running"
          ? { ...attempt, finishedAt: Date.now(), outcome: "failed" as const, category: "permission_required" as const, detail }
          : attempt,
      );
      this.setStep(step, { state: "failed", attempts, pendingRequestId: null, pendingPhase: null, failure: { category: "permission_required", detail } });
    }
    this.withdrawStaged(id, by, `Mission retried by ${by}; the step stages its change again.`);
    const failed = this.store.steps(id).filter((step) => step.state === "failed" && !step.team?.supersededBy);
    for (const step of failed) {
      this.setStep(
        step,
        { state: "ready", failure: null, taskId: null, approvedOnce: null },
        "mission.step.retrying",
        `${by} retried ${step.role}${step.failure?.category === "host_restart" ? " as a fresh child task (the interrupted provider stream is not resumed)" : ""}.`,
      );
    }
    for (const step of this.store.steps(id))
      if (step.state === "blocked") this.setStep(step, { state: "pending", failure: null });
    // M-A-3 T9R-F01: a one-time allowance belongs to the attempt it was given for, never to a Retry.
    for (const step of this.store.steps(id))
      if (step.approvedOnce && step.state !== "completed") this.setStep(step, { approvedOnce: null });
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
    // T13.3 N-C: a new plan would re-do work that may already have taken effect; the owner reconciles it first.
    const uncertain = this.store.steps(id).filter((step) => step.reconciliation?.required);
    if (uncertain.length)
      throw new CommandRefusedError(`OUTCOME_UNCERTAIN: ${uncertain.map((step) => step.role).join(", ")} may already have taken effect. Reconcile it (mission.reconcile) before replanning.`);
    if (mission.planning.replans >= this.cached.limits.maxReplans)
      throw new Error(`Replan limit (${this.cached.limits.maxReplans}) reached.`);
    // M-A-3 T11: a team Mission is replanned only by its Planner Agent, and only before any execution step completed.
    if (mission.team) {
      if (explicit !== undefined) throw new CommandRefusedError("A team Mission is planned by its Planner Agent; explicit steps are refused.");
      if (this.agentic.exists(id)) throw new CommandRefusedError("This team already holds Agentic consent; stop it and create a new team Mission to change the plan.");
      if (this.store.steps(id).some((step) => step.state === "completed" && step.team?.kind !== "plan")) throw new CommandRefusedError("Team work already completed; stop this Mission and create a new one instead of replanning.");
    }
    await this.cancelChildren(id, "Mission is being replanned.");
    // M-A-3 T9R-F02 (round 5): the replaced steps' one-time answers end with them (WITHDRAWN), never silently.
    for (const step of this.store.steps(id))
      if (step.approvedOnce && step.state !== "completed") this.setStep(step, { approvedOnce: null });
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
    this.revokeDesktopGrants(id, `Mission replanned by ${by}`);
    this.withdrawStaged(id, by, `Mission replanned by ${by}.`);
    this.workspace.releaseMission(id);
    if (mission.team) {
      // The narrowing note is data for the Planner Agent; the objective and the user's requirements stay as approved.
      const base = this.setMission(mission, { authorizationId: null, failure: null, finishedAt: null, planning: { ...mission.planning, replans: mission.planning.replans + 1 },
        team: { ...mission.team, revisionNote: objective?.trim().slice(0, 600) || null, proposal: null } }, "mission.replanning", `${by} asked the Planner Agent for a revised plan; the previous authorization was revoked.`);
      // plan() keeps only completed steps (the earlier planner runs); the plan drafted for review is replaced.
      return this.view(this.plan(base, undefined, this.teamPlanningPlan(base)));
    }
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
      // M-A-3 T11: team steps reconcile from disk and canonical truth. A stopped owner's work is never revived; a
      // write whose exact bytes already landed is verified, not repeated; an absent one is admitted once; anything
      // else stays held. Tool-free generations and reads have no side effect and are re-admitted once.
      if (step.team) {
        const mission = this.store.mission(missionId);
        if (ownerHold(this, step, false)) { results.push({ stepId: step.id, applied: false, reason: "The owning Agent was stopped; its work is not revived." }); continue; }
        // T13.3 N-C: a step whose outcome is uncertain is never re-admitted or settled here; the owner reconciles it.
        if (step.reconciliation?.required) { results.push({ stepId: step.id, applied: false, reason: "Outcome uncertain — reconciliation required (mission.reconcile)." }); continue; }
        if (step.team.kind === "write_file" && isTeam(mission)) {
          const write = teamWrite(this, mission, step, false);
          if ("already" in write) {
            this.setStep(step, { state: "ready", finishedAt: null, failure: null }, "mission.step.recovered", `${step.role}: the verified bytes already landed before the restart; only Bunny's check is repeated.`);
            const running = this.markRunning(this.store.step(step.id), null, null);
            const live = this.setMission(this.store.mission(missionId), { state: "running", recovery: null }, "mission.recovered", "Team write reconciled from disk without writing again.");
            await this.verifyAndComplete(live, running, { summary: "Write reconciled from disk after a Host restart (not repeated).", artifactIds: [], output: null, task: null });
            results.push({ stepId: step.id, applied: true, replay: "verify_then_consume" });
          } else if ("params" in write) {
            this.setStep(step, { state: "ready", finishedAt: null, failure: null }, "mission.step.recovered", `${step.role}: the destination still has its pre-image; the write is admitted once more under its guard.`);
            results.push({ stepId: step.id, applied: true, replay: "requeue_once" });
          } else results.push({ stepId: step.id, applied: false, reason: "conflict" in write ? write.conflict : write.refused });
          continue;
        }
        if (step.state === "blocked") this.setStep(step, { state: "pending", finishedAt: null, failure: null });
        this.setStep(this.store.step(step.id), { state: "ready", finishedAt: null, failure: null }, "mission.step.recovered", `${step.role} re-admitted once after the Host restart (no side effect: ${step.executor.kind === "model" ? "tool-free generation" : "read-only observation"}).`);
        results.push({ stepId: step.id, applied: true, replay: "requeue_once" });
        continue;
      }
      if (instruction.mode === "resubmit") {
        // T13.3 N-C: only the owner's reconciliation replays a step whose outcome is uncertain.
        if (step.reconciliation?.required) { results.push({ stepId: instruction.stepId, applied: false, reason: "Outcome uncertain — reconciliation required (mission.reconcile)." }); continue; }
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
          // T13.3 N-C: the canonical result settles what happened, so nothing is left to reconcile.
          { state: "ready", finishedAt: null, failure: null, ...settled(step) },
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
        { state: "ready", finishedAt: null, failure: null, ...settled(step) },
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
    const pending = current.team ? liveTeamSteps(this.store.steps(missionId)) : this.store.steps(missionId);
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
    // M-A-3 T9R-F01: paired-device authority belongs to the Host epoch that granted it. It never resumes, and a
    // later Retry cannot revive it; the workstation replans and approves again.
    const staleRemote = new Set<string>();
    // A one-time allowance never crosses a Host restart, including on failed Missions a later Retry could revive.
    for (const failed of this.store.missionsIn(["failed"]))
      for (const step of this.store.steps(failed.id))
        if (step.approvedOnce) {
          this.stampLifecycle(step.approvedOnce.requestId, "INVALIDATED_BY_HOST_RESTART", "bunny-host-restart", "The Host restarted before the answer was used.");
          this.setStep(step, { approvedOnce: null });
        }
    // M-A-3 T9R-F02 (D2): staged content survives a restart intact, but no promotion carries into a new Host epoch. An
    // interrupted promotion is reconciled from disk: the reviewed bytes either landed (PROMOTED) or did not (FAILED).
    for (const record of this.staging.inState("PROMOTING")) {
      let landed = false;
      try { landed = destinationState(record.destination).sha256 === record.contentHash; } catch { landed = false; }
      if (landed) {
        this.staging.transition(record.id, ["PROMOTING"], "PROMOTED", "bunny-host-restart", "Reconciled after restart: the destination holds the reviewed bytes.");
        const changeId = this.store.recordRemoteChange({ runId: record.runId, missionId: record.missionId, path: record.destination, root: record.destinationRoot, actor: record.deviceId });
        this.store.acknowledgeRemoteChanges([changeId], record.decidedBy ?? "workstation");
      } else {
        this.staging.transition(record.id, ["PROMOTING"], "FAILED", "bunny-host-restart", "Reconciled after restart: the promotion did not complete.");
        // The rename may have happened before the crash: whatever is on disk is listed for review before code runs.
        this.store.recordRemoteChange({ runId: record.runId, missionId: record.missionId, path: record.destination, root: record.destinationRoot, actor: record.deviceId });
      }
      this.emit("staging.reconciled", `Interrupted promotion of ${record.id} reconciled after restart: ${landed ? "PROMOTED" : "FAILED"}.`, record.missionId);
    }
    for (const record of this.staging.inState("STAGED"))
      this.endStaged(record, "INVALIDATED_BY_HOST_RESTART", "bunny-host-restart", "The Host restarted before promotion; a Retry stages the change again for a fresh review.");
    for (const envelope of this.store.liveAuthorizations())
      if (isRemoteEnvelope(envelope)) {
        this.store.saveAuthorization({ ...envelope, revokedAt: now });
        staleRemote.add(envelope.missionId);
        this.emit(
          "authorization.revoked",
          `Remote authorization ${envelope.id} granted by ${envelope.grantedBy} ended with the Host restart; paired-device approval never carries into a new Host epoch.`,
          envelope.missionId,
        );
      }
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
          if (step.approvedOnce)
            this.stampLifecycle(step.approvedOnce.requestId, "INVALIDATED_BY_HOST_RESTART", "bunny-host-restart", "The Host restarted before the answer was used.");
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
              // T13.3 N-C: a one-time approval is held for the whole run, so a write-capable step that was already
              // running when the Host stopped may have taken effect; a fresh decision is then not enough.
              ...(["running", "verifying"].includes(step.state) && this.writeCapable(step)
                ? { reconciliation: { required: true, reason: `OUTCOME_UNCERTAIN: the Host restarted while ${step.role} was running under a one-time approval, so it may already have changed files or external systems.`, at: now } }
                : {}),
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
        // T13.3 N-C: an interrupted step that could write may already have taken effect. Retry stays available, but only
        // after the owner reconciles; read-only work and Host-enforced idempotent writes need no reconciliation.
        const mayHaveWritten = this.writeCapable(step);
        this.setStep(
          step,
          {
            state: "failed",
            finishedAt: now,
            attempts,
            failure: { category: "host_restart", detail },
            ...(mayHaveWritten ? { reconciliation: { required: true, reason: `OUTCOME_UNCERTAIN: the Host restarted while ${step.role} was running, so it may already have changed files or external systems.`, at: now } } : {}),
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
        const remote = staleRemote.has(mission.id);
        if (!this.cached.enabled || this.tasks.containment.health.lastFatal || remote) {
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
                  detail: remote
                    ? "Paired-device approval ended with the Host restart. Nothing was resumed; replan and approve again, or stop this Mission."
                    : "Host restart paused scheduling. No old execution was resumed; review and replan or stop this Mission.",
                  interruptedSteps: [],
                },
              },
              "mission.recovered",
              remote
                ? "Remote approval from an earlier Host epoch was not resumed; fresh approval is required."
                : "Host restart paused scheduling; user review is required.",
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
            detail: staleRemote.has(mission.id)
              ? `${interrupted.length} step(s) were interrupted by a Host restart and were not resumed. The paired-device approval ended with the restart; replan and approve again, or stop this Mission.`
              : `${interrupted.length} step(s) were interrupted by a Host restart and were not resumed. Retry starts fresh child tasks under the same authorization.`,
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
