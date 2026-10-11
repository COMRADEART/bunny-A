import type { ArtifactStore } from "../artifacts.server.ts";
import { capabilityOperation, decide, DESKTOP_REQUIRED, isRemoteEnvelope, matches, remoteExecutionRefusal, runsCode } from "../authorization.server.ts";
import { consultBatch, currentBatchEpoch, extractObservedPid, targetLabelOf } from "../batches.server.ts";
import { redact, type MissionStore } from "../store.server.ts";
import { resolveCommand, type Resolved } from "./process.server.ts";
import { HostContainment, safeError } from "../../bunny-host/failure.server.ts";
import type { OwnedProcessRecord } from "../../bunny-host/owned-process-group.server.ts";
import { operationContract, semanticOutput, safeSemanticText } from "../cross-app.ts";
import type {
  ActionManifest, AuthorizationEnvelope, CapabilityAvailability, CapabilityManifest, CapabilityResult, CapabilityRun, CapabilityStatus,
  PermissionDecision, RiskClass, ApprovalBatch,
} from "../types.ts";

export type ExecutionContext = {
  resourceValidation?: (path: string) => string | null;
  browserOrigins?: string[];
  crossApp?: boolean;
  revalidate?: () => string | null;
  missionActive?: () => boolean;
  /** Host-provided, minimal environment for exact Agentic terminal commands. */
  boundedEnvironment?: NodeJS.ProcessEnv;
  boundedDelegation?: boolean;
  boundedScriptHash?: string;
  /** M-A-3 T9R-F01: remote (paired-device) authority; Git ignores repo-configured programs (hooks, fsmonitor, external diff). */
  remoteAuthority?: boolean;
  missionId: string | null;
  stepId: string | null;
  /** M-A-3 T11: owning team Agent of the step (process attribution only). */
  agentId?: string | null;
  capabilityRunId?: string;
  processOwnership?: OwnedProcessRecord[];
  /** Folder relative paths resolve against. */
  cwd: string;
  /** Every folder this execution may touch (approved project roots plus Host-owned workspaces). */
  roots: string[];
  dataDirectory: string;
  signal: AbortSignal;
  timeoutMs: number;
  /** Resolved before permission evaluation; terminal must launch this identity without a second PATH lookup. */
  executable?: Resolved | null;
  /** Host-only batch admission data. Never copied from action parameters. */
  desktopBatch?: { expiresAt: number; windowIdentity?: NonNullable<ApprovalBatch["windowIdentity"]> };
};

/** A capability provider. Adapters report unavailable/unconfigured/unsupported truthfully; they never fake success. */
export interface CapabilityAdapter {
  manifest: CapabilityManifest;
  health(): Promise<{ availability: CapabilityAvailability; detail: string }>;
  execute(action: string, params: Record<string, unknown>, context: ExecutionContext): Promise<CapabilityResult>;
  /** Parameter-dependent escalation (e.g. `git reset --hard` is DESTRUCTIVE even though terminal.exec is EXECUTE). */
  riskFor?(action: string, params: Record<string, unknown>): RiskClass | null;
  close?(): Promise<void>;
  prepareBatchAction?(action: string, params: Record<string, unknown>, batch: ApprovalBatch): Promise<NonNullable<ApprovalBatch["windowIdentity"]> | null>;
}

export type CapabilityRequest = {
  action: string;
  params: Record<string, unknown>;
  missionId: string | null;
  stepId: string | null;
  envelope: AuthorizationEnvelope | null;
  origin: string;
  cwd: string;
  roots: string[];
  oneTime?: boolean;
  /** Matching action allowed for this capability invocation / this skill run; other skill actions still ask. */
  oneTimeAction?: string | null;
  direct?: { confirmed: boolean };
  timeoutMs?: number;
  /** M-A-3 T11: Host-set owner of the step (never from parameters); attribution for owned processes only. */
  agentId?: string | null;
};
export type CapabilityOutcome = { decision: PermissionDecision; run: CapabilityRun | null; result: CapabilityResult | null; artifactIds: string[] };

const RANK: RiskClass[] = ["READ", "WRITE", "EXECUTE", "EXTERNAL_SIDE_EFFECT", "DESTRUCTIVE"];
/** Actions that change project files (or what a running program would load). */
const MUTATIONS = new Set(["filesystem.write", "filesystem.delete", "git.commit", "git.merge", "git.worktree_add", "git.worktree_remove", "browser.download"]);
const STATUS_FOR: Record<Exclude<CapabilityAvailability, "available" | "degraded">, CapabilityResult["status"]> = { unavailable: "unavailable", unconfigured: "unconfigured", unsupported: "unsupported" };

/**
 * The Bunny Capability Bus. Every deterministic action — filesystem, terminal, git, browser, computer,
 * connectors — passes the same permission decision, is recorded as a capability run with redacted
 * parameters, and emits normalized capability.* events.
 */
export class CapabilityBus {
  resourceValidation: ((request: CapabilityRequest, path: string) => string | null) | null = null;
  adapters = new Map<string, CapabilityAdapter>();
  health = new Map<string, { availability: CapabilityAvailability; detail: string; checkedAt: number }>();
  store: MissionStore; artifacts: ArtifactStore; dataDirectory: string;
  emit: (type: string, detail: string, missionId: string | null) => void;
  inFlight = new Map<string, AbortController>();
  settling = new Map<string, Promise<void>>();
  cancelledMissions = new Set<string>(); cancelledSteps = new Set<string>();
  containment: HostContainment;
  /** T5 adjuncts are installed by MissionManager; neither comes from request parameters. */
  agenticCheck: ((request: CapabilityRequest, risk: RiskClass, executable?: Resolved | null) => string | null) | null = null;
  /** M-A-3 T11: hard refusal of a team step operation outside its Host-planned scope (wired by MissionManager). */
  teamDeny: ((request: CapabilityRequest) => string | null) | null = null;
  agenticAdmit: ((request: CapabilityRequest, runId: string, executable?: Resolved | null) => { id?: string; reason?: string; timeoutMs?: number; scriptHash?: string }) | null = null;
  agenticFinish: ((id: string, ok: boolean) => void) | null = null;
  /** M-A-3 T9R-F01: the valid trusted-desktop grant (request id) for this exact request, installed by MissionManager. */
  desktopGrantFor: ((request: CapabilityRequest, executable?: Resolved | null) => string | null) | null = null;
  /** M-A-3 T9R-F01: why this Mission mutation must wait for a running trusted-desktop execution in the same folder. */
  desktopExecutionConflict: ((request: CapabilityRequest) => string | null) | null = null;
  /** M-A-3 T9R-F01: unreviewed paired-device changes this code-running request would execute over (ids and paths). */
  remoteReviewFor: ((request: CapabilityRequest) => { ids: string[]; paths: string[]; more: number; listing: string } | null) | null = null;
  /** M-A-3 T9R-F01: records a project change attempted under paired-device authority (before the adapter runs). */
  remoteMutationStarted: ((request: CapabilityRequest, runId: string) => void) | null = null;
  /** M-A-3 T9R-F01: why a paired-device change must wait (workstation-approved code is running), or null. */
  remoteMutationHeld: ((request: CapabilityRequest) => string | null) | null = null;
  /** M-A-3 T9R-F01: code-running capability executions in flight (run id -> action). */
  liveCode = new Map<string, string>();
  /**
   * M-A-3 T9R-F02 (D2): stages a paired-device write instead of executing it (after admission, before the adapter), or
   * returns null when the write is not device-attributed. Installed by MissionManager.
   */
  stageRemoteWrite: ((request: CapabilityRequest, runId: string) => CapabilityResult | null) | null = null;
  /** M-A-3 T9R-F02 (section 12): records that a step's one-time answer authorized this admitted run. */
  onceAdmitted: ((request: CapabilityRequest) => void) | null = null;
  /** M-A-3 T9R-F02: the paired device a Mission change is attributed to, or null. Installed by MissionManager. */
  deviceAttributed: ((request: CapabilityRequest) => string | null) | null = null;
  /** M-A-3 T9R-F01: records a capability execution running under a trusted-desktop grant. */
  desktopExecutionStarted: ((runId: string, request: CapabilityRequest) => void) | null = null;
  /** M-A-3 T9R-F01: consumes one use of the grant immediately before execution; returns why it cannot, or null. */
  desktopGrantConsume: ((grantId: string, request: CapabilityRequest, executable?: Resolved | null) => string | null) | null = null;
  agenticExecutionContext: ((request: CapabilityRequest, admissionId: string, executable?: Resolved | null) => Partial<ExecutionContext>) | null = null;
  clearCancellation(missionId: string) { this.cancelledMissions.delete(missionId); }
  constructor(store: MissionStore, artifacts: ArtifactStore, dataDirectory: string, emit: (type: string, detail: string, missionId: string | null) => void, containment=new HostContainment()) {
    this.store = store; this.artifacts = artifacts; this.dataDirectory = dataDirectory; this.containment=containment;
    this.emit=(type,detail,missionId)=>{try {emit(type,detail,missionId);} catch(error) {containment.fatal(error,{subsystem:"capability-event-persistence",...(missionId ? {missionId} : {})});throw error;}};
  }
  register(adapter: CapabilityAdapter) {
    if (this.adapters.has(adapter.manifest.id)) throw new Error(`Capability ${adapter.manifest.id} is already registered.`);
    for (const action of adapter.manifest.actions) if (!action.id.startsWith(`${adapter.manifest.id}.`)) throw new Error(`Action ${action.id} must be namespaced under ${adapter.manifest.id}.`);
    this.adapters.set(adapter.manifest.id, adapter);
  }
  find(action: string): { adapter: CapabilityAdapter; manifest: ActionManifest } | null {
    const adapter = this.adapters.get(action.split(".")[0]);
    const manifest = adapter?.manifest.actions.find((item) => item.id === action);
    return adapter && manifest ? { adapter, manifest } : null;
  }
  async refreshHealth(): Promise<void> {
    await Promise.all([...this.adapters.values()].map(async (adapter) => {
      const platformOk = adapter.manifest.platforms === "any" || adapter.manifest.platforms.includes(process.platform);
      let result:{availability:CapabilityAvailability;detail:string};
      try { result=platformOk ? await adapter.health() : {availability:"unsupported",detail:`Not supported on ${process.platform}.`}; }
      catch(error) {result={availability:"unavailable",detail:`Health check failed: ${safeError(error).message}`};}
      this.health.set(adapter.manifest.id, { ...result, checkedAt: Date.now() });
    }));
  }
  list(): CapabilityStatus[] {
    return [...this.adapters.values()].map((adapter) => {
      const health = this.health.get(adapter.manifest.id);
      return { ...adapter.manifest, availability: health?.availability ?? "unavailable", detail: health?.detail ?? "Not checked yet.", checkedAt: health?.checkedAt ?? null };
    });
  }
  catalog() { return this.list().map(capability => ({ ...capability, actions: capability.actions.map(action => ({ ...action, execution: operationContract(action.id) })) })); }
  availability(action: string): CapabilityAvailability {
    const found = this.find(action);
    if (!found) return "unsupported";
    return this.health.get(found.adapter.manifest.id)?.availability ?? "unavailable";
  }
  riskOf(action: string, params: Record<string, unknown>): RiskClass | null {
    const found = this.find(action); if (!found) return null;
    const escalated = found.adapter.riskFor?.(action, params) ?? null;
    if (escalated && !RANK.includes(escalated)) return escalated;
    return escalated && RANK.indexOf(escalated) > RANK.indexOf(found.manifest.risk) ? escalated : found.manifest.risk;
  }
  /** Permission decision only; no side effects. */
  decision(request: CapabilityRequest, executable?: Resolved | null): PermissionDecision {
    const found = this.find(request.action);
    if (!found) return { decision: "deny", reason: `Unknown capability action ${request.action}.`, risk: "READ" };
    const risk = this.riskOf(request.action, request.params) ?? found.manifest.risk;
    // M-A-3 T11: a team step may perform only the exact Host-planned operation its owning Agent's role allows. This is a
    // deny, never an ask: no one-time answer, batch, grant or device answer can widen an Agent's planned scope.
    const team = request.missionId && request.stepId ? this.teamDeny?.(request) ?? null : null;
    if (team) return { decision: "deny", reason: team, risk };
    const violation = this.agenticCheck?.(request, risk, executable);
    // M-A-3 T9R-F01: while a trusted-desktop execution runs in a folder, Mission changes there wait, so the code the
    // workstation approved cannot be rewritten underneath it (scripts and the modules they load at run time).
    const busy = request.missionId && !request.direct && MUTATIONS.has(request.action) ? this.desktopExecutionConflict?.(request) ?? null : null;
    if (busy) return { decision: "ask", reason: busy, risk };
    // M-A-3 T9R-F01: a paired-device change never lands under workstation-approved code that is already running.
    const held = request.missionId && !request.direct && MUTATIONS.has(request.action) ? this.remoteMutationHeld?.(request) ?? null : null;
    if (held) return { decision: "ask", reason: held, risk, desktopRequired: true, desktopOperation: capabilityOperation(request.action, request.params, request.cwd, executable) };
    // M-A-3 T9R-F01: code never runs over paired-device changes the workstation has not reviewed, under any envelope.
    // Git reads count too: owner-configured textconv, clean filters or fsmonitor can run project files.
    const review = request.missionId && !request.direct && (runsCode(request.action, request.params, risk) || request.action.startsWith("git.") || request.action.startsWith("github.")) ? this.remoteReviewFor?.(request) ?? null : null;
    if (review) return { decision: "ask", risk, desktopRequired: true, desktopOperation: capabilityOperation(request.action, request.params, request.cwd, executable), remoteReview: review.ids,
      reason: `Approval required on Windows Host: this runs code over files changed under paired-device authority. Review their content before allowing:${review.listing}${review.more ? `\n${review.more} more changed file(s) are listed for review after these.` : ""}` };
    // M-A-3 T9R-F01: remote authority never runs code; only a trusted-desktop grant for this exact operation lifts it.
    // M-A-3 T9R-F02 (D2): a delete cannot be staged, so a paired-device-attributed delete always needs the workstation's
    // exact-operation grant, under any envelope.
    const attributedDelete = request.action === "filesystem.delete" && !!request.missionId && !request.direct && !!this.deviceAttributed?.(request);
    const remote = (!!request.envelope && !request.direct && isRemoteEnvelope(request.envelope) && remoteExecutionRefusal(request.action, request.params, risk, request.cwd) !== null) || attributedDelete;
    const grant = remote ? this.desktopGrantFor?.(request, executable) ?? null : null;
    const base = decide({ ...found.manifest, risk }, request.params, { envelope: request.envelope, missionId: request.missionId, grants: this.store.grants(), oneTime: request.oneTime || (!!request.oneTimeAction && request.oneTimeAction === request.action), direct: request.direct, base: request.cwd, executable, agenticViolation: violation, desktopGrant: !!grant });
    if (base.desktopRequired) return { ...base, desktopOperation: capabilityOperation(request.action, request.params, request.cwd, executable) }; // never batch-rescued
    if (attributedDelete && !grant && base.decision !== "deny")
      return { decision: "ask", risk, reason: `${DESKTOP_REQUIRED} A paired-device delete cannot be staged for review; the Windows Host approves this exact delete.`, desktopRequired: true, desktopOperation: capabilityOperation(request.action, request.params, request.cwd, executable) };
    if (grant && base.decision === "allow") return { ...base, desktopGrant: { id: grant } };
    if (remote) return base;
    if (violation) return base; // T9 cannot launder an Agent identity, budget or resource mismatch.
    // Gate T9: an approval batch may rescue an ORDINARY ask — same mission, its own planned step,
    // alive envelope, exact covered action, bound target, risk at/below the ceiling. Never a deny,
    // never a user's standing "ask every time" rule, never another mission or a delegated child step.
    if (base.decision !== "ask" || !request.missionId || !request.envelope || request.envelope.revokedAt || request.envelope.expiresAt <= Date.now()) return base;
    if (!request.envelope.computer.enabled || !request.envelope.capabilities.includes(request.action)) return base;
    if (this.store.grants().some((grant) => grant.policy === "ask_every_time" && matches([grant.action], request.action) && (grant.scope === "global" || grant.scope === `mission:${request.missionId}`))) return base;
    const stepIds = new Set(this.store.steps(request.missionId).map((step) => step.id));
    const now = Date.now();
    for (const batch of this.store.batchesActive(request.missionId, currentBatchEpoch(), now)) {
      const consult = consultBatch(batch, { action: request.action, params: request.params, manifest: found.manifest, risk, envelope: request.envelope, now, stepIds, stepId: request.stepId, epoch: currentBatchEpoch() });
      if (consult?.match) {
        const consume = consult.consume ? `${batch.usedCount + 1} of ${batch.maxActions} mutating actions used` : "read-only";
        return { decision: "allow", reason: `Allowed by the small approval batch for ${targetLabelOf(batch.target)}: ${consume}.`, risk, batch: { id: batch.id } };
      }
    }
    return base;
  }
  async cancel(filter: { missionId?: string; stepId?: string }) {
    if (filter.missionId) this.cancelledMissions.add(filter.missionId);
    if (filter.stepId) this.cancelledSteps.add(filter.stepId);
    const settling: Promise<void>[] = [];
    for (const [runId, controller] of this.inFlight) {
      const run = this.store.run(runId);
      if ((filter.missionId && run.missionId === filter.missionId) || (filter.stepId && run.stepId === filter.stepId)) {
        controller.abort(new Error("Cancelled by Bunny-A."));
        const done = this.settling.get(runId); if (done) settling.push(done);
      }
    }
    await Promise.all(settling);
  }
  /**
   * Decides, then (only when allowed) executes and records. An "ask" decision executes nothing and
   * returns no run; the caller turns it into a permission request.
   */
  async request(request: CapabilityRequest): Promise<CapabilityOutcome> {
    this.containment.assertAccepting(request.action.split(".")[0]);
    this.containment.assertAccepting("capability-health");
    const found = this.find(request.action);
    const executable = request.action === "terminal.exec" ? resolveCommand(String(request.params.command ?? ""), request.cwd) : undefined;
    const cancelled = request.missionId && this.cancelledMissions.has(request.missionId) || request.stepId && this.cancelledSteps.has(request.stepId);
    if (request.missionId) for (const batch of this.store.batches(request.missionId)) {
      if (batch.status === "active" && batch.expiresAt <= Date.now()) {
        this.store.endBatch(batch.id, "expired", "bunny-capability-bus");
        this.emit("approval.batch_expired", "Small approval batch expired; further actions require fresh approval.", request.missionId);
      }
    }
    let decision: PermissionDecision = cancelled ? { decision: "deny", reason: "Execution was cancelled by Bunny-A.", risk: this.riskOf(request.action, request.params) ?? "READ" } : this.decision(request, executable);
    let desktopBatch: ExecutionContext["desktopBatch"];
    if (decision.batch && found) {
      const batch = this.store.batch(decision.batch.id);
      try {
        if (!batch || !found.adapter.prepareBatchAction) throw new Error("No trusted target validation.");
        const identity = await found.adapter.prepareBatchAction(request.action, request.params, batch);
        // A target probe is asynchronous. Re-read all authority and cancellation after it.
        const live = this.store.batch(batch.id);
        const mission = request.missionId ? this.store.mission(request.missionId) : null;
        const envelope = mission?.authorizationId ? this.store.authorization(mission.authorizationId) : null;
        if (this.cancelledMissions.has(request.missionId ?? "") || this.cancelledSteps.has(request.stepId ?? "") || !mission || ["stopped", "failed", "completed"].includes(mission.state)) {
          decision = { decision: "deny", reason: "Execution was cancelled by Bunny-A.", risk: decision.risk };
        } else {
          decision = this.decision({ ...request, envelope }, executable);
          if (decision.batch?.id !== batch.id || !live || live.status !== "active") throw new Error("Authority changed during target validation.");
          if (identity) {
            if (live.windowIdentity && JSON.stringify(live.windowIdentity) !== JSON.stringify(identity)) throw new Error("Window identity changed.");
            this.store.saveBatch({ ...live, windowIdentity: identity, observedPid: identity.processId, observedPidFrom: "params" });
          } else if (request.action !== "computer.open_app") throw new Error("No window identity.");
          desktopBatch = { expiresAt: Math.min(live.expiresAt, envelope!.expiresAt), ...(identity ? { windowIdentity: identity } : {}) };
        }
      } catch {
        if (batch?.status === "active") this.store.endBatch(batch.id, "scope_mismatch", "bunny-computer-runtime");
        this.emit("approval.batch_scope_mismatch", "Desktop target or approval changed before admission; no mutation was admitted and fresh approval is required.", request.missionId);
        decision = { decision: "ask", reason: "Desktop target or approval changed; review this action again.", risk: decision.risk };
      }
    }
    // Typed text and file bodies may be private; records keep their size, not their content.
    const recorded = { ...request.params };
    for (const key of ["text", "content"]) if (typeof recorded[key] === "string") recorded[key] = `[${(recorded[key] as string).length} characters]`;
    const params = redact(recorded) as Record<string, unknown>;
    this.emit("capability.requested", `${request.action} requested by ${request.origin}${request.stepId ? ` (step ${request.stepId})` : ""}.`, request.missionId);
    if (decision.decision === "ask") { this.emit("authorization.required", `${request.action}: ${decision.reason}`, request.missionId); return { decision, run: null, result: null, artifactIds: [] }; }
    const startedAt = Date.now();
    const base: CapabilityRun = {
      id: crypto.randomUUID(), action: request.action, capability: request.action.split(".")[0], missionId: request.missionId, stepId: request.stepId,
      risk: decision.risk, decision: decision.decision, decisionReason: decision.reason, params, status: "running", summary: "", evidence: [], artifactIds: [],
      startedAt, finishedAt: null, durationMs: null, origin: request.origin,
    };
    let terminal:CapabilityOutcome|null=null;
    const agenticAdmission: { id?: string } = {};
    let outputRef: string | undefined;
    const finish = (status: CapabilityRun["status"], summary: string, result: CapabilityResult | null, artifactIds: string[] = []): CapabilityOutcome => {
      if(terminal) return terminal;
      const finishedAt = Date.now();
      const run = { ...base, ...(outputRef ? { outputRef } : {}), ...(result?.cleanup ? { cleanup: result.cleanup } : {}), status, summary: safeSemanticText(summary).slice(0, 2000), evidence: result?.evidence.slice(0, 40).map(safeSemanticText) ?? [], artifactIds, finishedAt, durationMs: finishedAt - startedAt };
      this.store.host.transaction(()=>{this.store.saveRun(run);this.emit(status === "succeeded" ? "capability.completed" : "capability.failed", `${request.action} ${status}: ${run.summary}`, request.missionId);});
      if (agenticAdmission.id) this.agenticFinish?.(agenticAdmission.id, status === "succeeded");
      terminal={decision,run,result,artifactIds};
      return terminal;
    };
    if (decision.decision === "deny") { this.emit("authorization.denied", `${request.action}: ${decision.reason}`, request.missionId); return finish("denied", decision.reason, null); }
    if (!found) return finish("unsupported", "Unknown capability action.", null);
    const availability = this.health.get(found.adapter.manifest.id)?.availability ?? "unavailable";
    if (availability !== "available" && availability !== "degraded") {
      return finish(STATUS_FOR[availability], this.health.get(found.adapter.manifest.id)?.detail ?? `${found.adapter.manifest.id} is ${availability}.`, { ok: false, status: STATUS_FOR[availability], summary: `${found.adapter.manifest.id} is ${availability}.`, output: null, evidence: [], errorCategory: "capability_unavailable" });
    }
    // Canonical policy is re-evaluated inside the shared SQLite admission transaction.
    const admitted = this.agenticAdmit?.(request, base.id, executable);
    if (admitted?.reason) return { decision: { decision: "ask", risk: decision.risk, reason: admitted.reason }, run: null, result: null, artifactIds: [] };
    agenticAdmission.id = admitted?.id;
    // Gate T9 admission gate: re-validate status, epoch, expiry and budget atomically immediately
    // before execution. A failed guard executes nothing; no run is created; the ask path follows.
    if (decision.batch && decision.risk !== "READ") {
      const consumed = this.store.consumeBatch(decision.batch.id, currentBatchEpoch(), Date.now());
      if (!consumed.ok) { this.emit("authorization.required", `${request.action}: ${consumed.reason}`, request.missionId); return { decision: { decision: "ask", risk: decision.risk, reason: consumed.reason }, run: null, result: null, artifactIds: [] }; }
      this.emit("approval.batch_consumed", `${request.action} admitted under the small approval batch: ${consumed.usedCount} / ${consumed.maxActions} mutating actions used.`, request.missionId);
      if (consumed.usedCount === consumed.maxActions) {
        this.store.endBatch(decision.batch.id, "exhausted", "bunny-capability-bus");
        this.emit("approval.batch_exhausted", `Small approval batch reached its ${consumed.maxActions}-action limit; further ${request.action.split(".")[0]}.* actions ask again.`, request.missionId);
      }
    }
    if (decision.desktopGrant) {
      const refused = this.desktopGrantConsume ? this.desktopGrantConsume(decision.desktopGrant.id, request, executable) : "No trusted-desktop grant validator is installed.";
      if (refused) { this.emit("authorization.required", `${request.action}: ${refused}`, request.missionId); return { decision: { decision: "ask", risk: decision.risk, reason: refused, desktopRequired: true, desktopOperation: capabilityOperation(request.action, request.params, request.cwd, executable) }, run: null, result: null, artifactIds: [] }; }
    }
    this.emit("authorization.granted", `${request.action}: ${decision.reason}`, request.missionId);
    if (request.oneTimeAction && request.oneTimeAction === request.action) this.onceAdmitted?.(request);
    this.store.host.transaction(()=>{this.store.saveRun(base);this.emit("capability.started", `${request.action} started.`, request.missionId);});
    if (decision.desktopGrant) this.desktopExecutionStarted?.(base.id, request);
    // M-A-3 T9R-F02 (D2): a paired-device write goes to Host-owned inert staging; the project is not touched and no
    // project change is recorded until the workstation promotes the exact staged bytes.
    if (request.missionId && !request.direct && request.action === "filesystem.write" && this.stageRemoteWrite) {
      let staged: CapabilityResult | null;
      try { staged = this.stageRemoteWrite(request, base.id); }
      catch (error) { const message = safeError(error).message; return finish("failed", message, { ok: false, status: "failed", summary: message, output: null, evidence: [], errorCategory: "capability_failed" }); }
      if (staged) return finish(staged.status, staged.summary, staged);
    }
    // Recorded before the adapter runs: a change that fails after touching disk is still reviewed.
    if (request.missionId && MUTATIONS.has(request.action)) this.remoteMutationStarted?.(request, base.id);
    if (runsCode(request.action, request.params, decision.risk) || request.action.startsWith("git.") || request.action.startsWith("github.")) this.liveCode.set(base.id, request.action);
    const controller = new AbortController(); this.inFlight.set(base.id, controller);
    let settled!: () => void;
    this.settling.set(base.id, new Promise<void>((done) => { settled = done; }));
    const timeoutMs = Math.min(request.timeoutMs ?? found.manifest.timeoutMs, 30 * 60_000, admitted?.timeoutMs ?? Infinity);
    const timer = setTimeout(() => controller.abort(new Error(`Timed out after ${timeoutMs} ms.`)), timeoutMs);
    try {
    let result: CapabilityResult;
    const processOwnership: OwnedProcessRecord[]=[];
    try {
      const boundedEnvironment = agenticAdmission.id && request.action === "terminal.exec" ? Object.fromEntries(["SystemRoot", "WINDIR", "TEMP", "TMP", "LANG"].flatMap(k => process.env[k] ? [[k, process.env[k]!]] : [])) : undefined;
      const delegated = agenticAdmission.id ? this.agenticExecutionContext?.(request, agenticAdmission.id, executable) ?? {} : {};
      const currentViolation = delegated.revalidate?.();
      if (currentViolation) throw new Error(currentViolation);
      result = await found.adapter.execute(request.action, request.params, { ...delegated, resourceValidation: path => this.resourceValidation?.(request,path) ?? null, missionId: request.missionId, stepId: request.stepId, ...(request.agentId ? { agentId: request.agentId } : {}), capabilityRunId:base.id, processOwnership, cwd: request.cwd, roots: request.roots, dataDirectory: this.dataDirectory, signal: controller.signal, timeoutMs, executable, desktopBatch: delegated.desktopBatch ?? desktopBatch, boundedEnvironment, boundedDelegation: !!agenticAdmission.id, boundedScriptHash: admitted?.scriptHash, remoteAuthority: !!request.envelope && isRemoteEnvelope(request.envelope) });
      if(processOwnership.length) result={...result,output:{...(result.output && typeof result.output === "object" ? result.output : {value:result.output}),processOwnership}};
    } catch (error) {
      const message = safeError(error).message;
      const timedOut = controller.signal.aborted && /timed out/i.test(String(controller.signal.reason));
      result = { ok: false, status: timedOut ? "timeout" : "failed", summary: message, output: null, evidence: [], errorCategory: timedOut ? "timeout" : "capability_failed" };
      await this.containment.contain(error,"boundary",{owner:{subsystem:base.capability,capabilityRunId:base.id,...(request.missionId ? {missionId:request.missionId} : {}),...(request.stepId ? {stepId:request.stepId} : {})}});
    }
    if(controller.signal.aborted && result.ok) result={ok:false,status:"failed",summary:"Execution was cancelled; late success was discarded.",output:null,evidence:[],errorCategory:"user_stopped",cleanup:result.cleanup};
    if(controller.signal.aborted && /timed out/i.test(String(controller.signal.reason))) result={...result,ok:false,status:"timeout",summary:`Execution timed out after ${timeoutMs} ms. ${result.cleanup?.detail??"Owned process group terminated."}`,errorCategory:"timeout"};
    const artifactIds: string[] = [];
    if (request.missionId && request.stepId && (() => { const step = this.store.step(request.stepId!); return !!(step.crossApp || step.team); })() && result.ok) {
      const artifact = await this.artifacts.create({ missionId: request.missionId, stepId: request.stepId, type: "structured_result", title: `${request.action} observation`, inline: JSON.stringify(semanticOutput(request.action, result.output)), mediaType: "application/json", provenance: `bunny:capability:${base.id}`, verification: "unverified" });
      outputRef = artifact.id; artifactIds.push(artifact.id);
    }
    if (request.missionId) for (const item of result.artifacts ?? []) {
      try { artifactIds.push((await this.artifacts.create({ missionId: request.missionId, stepId: request.stepId, type: item.type, title: safeSemanticText(item.title), inline: item.inline === undefined ? undefined : safeSemanticText(item.inline), path: item.path, mediaType: item.mediaType, provenance: `bunny:capability:${base.id}`, verification: "unverified" })).id); }
      catch (error) { result.evidence.push(`Artifact not stored: ${safeError(error).message}`); }
    }
    const stopped=processOwnership.length>0 && controller.signal.aborted && !/timed out/i.test(String(controller.signal.reason));
    if (decision.batch && result?.output) this.reviewBatchObserved(request, decision.batch.id, result);
    return finish(stopped ? "stopped" : result.status, result.summary, result, artifactIds);
    } catch(error) {
      if(terminal) return terminal;
      const message=safeError(error).message;
      try {return finish("failed",message,{ok:false,status:"failed",summary:message,output:null,evidence:[],errorCategory:"capability_failed"});}
      catch(persistenceError) {this.containment.fatal(persistenceError,{subsystem:"persistence",capabilityRunId:base.id});throw persistenceError;}
    } finally { clearTimeout(timer); this.inFlight.delete(base.id); this.liveCode.delete(base.id); this.settling.delete(base.id); settled(); }
  }
  /**
   * Gate T9 post-run target review: the Computer Runtime's structured output carries the window's
   * real owning process. First pinning binds the batch to it; any later coverable run that touches
   * a different process ends the batch immediately (fail closed forward) — a completed run is not
   * reversible, but nothing further runs without a fresh approval.
   */
  reviewBatchObserved(request: CapabilityRequest, batchId: string, result: CapabilityResult) {
    const batch = this.store.batch(batchId);
    if (!batch || batch.status === "ended") return;
    // open_app's pid is the launcher process, not the window owner (Store-app launchers spawn a
    // separate window process), so it is not window identity and never binds the batch. The first
    // window-bearing execution (focus/type/invoke/read_controls) is what proves the owning process.
    if (request.action === "computer.open_app") {
      const identity = (result.output as { windowIdentity?: ApprovalBatch["windowIdentity"] })?.windowIdentity;
      if (identity) {
        if (batch.windowIdentity && JSON.stringify(batch.windowIdentity) !== JSON.stringify(identity)) {
          this.store.endBatch(batch.id, "scope_mismatch", "bunny-computer-runtime");
          this.emit("approval.batch_scope_mismatch", "Acquired Calculator target differs from the approved native identity; further actions require fresh approval.", batch.missionId);
        } else this.store.saveBatch({ ...batch, windowIdentity: identity, observedPid: identity.processId, observedPidFrom: "post-run" });
      }
      return;
    }
    const observed = extractObservedPid(result.output);
    if (observed == null) return;
    const pinned = batch.observedPid ?? batch.target.processId;
    if (pinned == null) {
      this.store.saveBatch({ ...batch, observedPid: observed, observedPidFrom: "post-run", target: { ...batch.target, processId: observed } });
      return;
    }
    if (observed !== pinned) {
      this.store.endBatch(batch.id, "scope_mismatch", "bunny-computer-runtime");
      this.emit("approval.batch_scope_mismatch", `The covered action reached window owner pid ${observed}, but the approval batch is bound to pid ${pinned}; the batch ended; further actions ask for fresh approval.`, batch.missionId);
    }
  }

  async close() {
    for (const controller of this.inFlight.values()) controller.abort(new Error("Bunny Capability Bus closed."));
    await Promise.all(this.settling.values());
    for (const adapter of this.adapters.values()) await adapter.close?.().catch(() => {});
  }
}
