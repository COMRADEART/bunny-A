import { randomUUID } from "node:crypto";
import type { ChildProcess } from "node:child_process";
import { isTrustedLocalActor } from "../../bunny-missions/authorization.server.ts";
import { CHECKPOINT_SECRET_PATTERNS } from "../agent-checkpoint.server.ts";
import { gateCalls } from "./coordinator.ts";
import type { ModelCall } from "./coding-workflow.server.ts";
import { approvalRequired, canonical, EnvelopeSchema, sha256, TaskSpecSchema, taskView, TERMINAL_TASK_STATES, validateTask, type ActionApproval, type ActionProposal, type BlockCode, type CorruptTaskView, type Envelope, type ExecutorFacts, type TaskFailureCode, type TaskRecord, type TaskState, type TaskView } from "./task-runtime.ts";
import { StaleLeaseError, TaskConflictError, type Lease, type NotificationKind, type ProcessIdentity, type TaskPolicy, type TaskStore, type Update, type Updated } from "./task-store.server.ts";

/**
 * MA4-S2-T1 persistent task runtime. It runs owner-authorized tasks inside the Host process, so closing a window does not
 * stop them — but only while the Host runs, only within the background policy, and only inside each task's envelope.
 *
 * Exactly-once safety comes from ordering, not hope: an operation's start is committed (with the worker's fencing token)
 * BEFORE its effect, and its receipt after. A crash between the two leaves a "started" operation that recovery classifies:
 * read-only work is retried within budget, idempotent work is looked up under its stable key first, and irreversible work
 * becomes UNCERTAIN until the owner says what happened. A worker whose lease was taken over cannot commit anything.
 */
export type StepResult =
  | { ok: true; output: string; receipt?: string }
  /** Proven: the effect was never attempted (nothing was sent). */
  | { ok: false; error: string; dispatched: false; fatal?: TaskFailureCode }
  /** Attempted. `definite` means the other side reported failure (no effect); otherwise the outcome is unknown. */
  | { ok: false; error: string; dispatched: true; definite: boolean; fatal?: TaskFailureCode }
  /** MA4-S2-T2: nothing was sent; this exact payload waits for the owner's approval (the attempt is not spent). */
  | { ok: false; error: string; dispatched: false; proposal: ActionProposal };
export type StepContext = {
  taskId: string; stepId: string; attempt: number; idempotencyKey: string; model: string | null; signal: AbortSignal;
  /** The Host-wide gated model call (one GPU-heavy call at a time across all tasks). */
  call: ModelCall;
  /** Registers a child process: it is killed on cancel/stop, and its verified identity is cleaned up after a crash. */
  track(child: ChildProcess): void;
  /** MA4-S2-T2: the task's immutable envelope (its grants), the owner's approval of this step's payload, earlier results. */
  envelope: Envelope;
  approval: ActionApproval | null;
  outputOf(stepId: string): string | null;
  now(): number;
};
export type Executor = ExecutorFacts & {
  timeoutMs: number;
  run(input: Record<string, string | number | boolean | null>, ctx: StepContext): Promise<StepResult>;
  /** Idempotent executors: was an operation with this key already applied? Called before any re-execution after a crash. */
  verify?(idempotencyKey: string, signal: AbortSignal, input?: Record<string, string | number | boolean | null>, envelope?: Envelope, ctx?: Pick<StepContext, "taskId" | "stepId" | "outputOf" | "now">): Promise<{ found: boolean; output?: string; receipt?: string }>;
};
export type FaultPoint = "after-claim" | "before-operation-start" | "after-operation-start" | "after-effect" | "after-receipt";
/** Thrown by a fault hook to simulate the Host dying at that instant: the runtime stops without writing anything else. */
export class SimulatedCrash extends Error { constructor(point: string) { super(`Simulated Host crash at ${point}.`); } }

export type RuntimeDeps = {
  store: TaskStore;
  executors: readonly Executor[];
  /** Raw local model call (production: Ollama execute() with localOnly). Gated Host-wide here. */
  call: ModelCall;
  /** Is this exact model installed locally? No other model is ever substituted. */
  modelAvailable(model: string): Promise<boolean>;
  /** Free-memory and similar floors for GPU-heavy steps. */
  resources?(): { ok: boolean; detail: string };
  /** A workstation window (dashboard or Island) is attached right now. */
  uiAttached(): boolean;
  emit?(type: string, detail: string, taskId: string | null): void;
  instanceId?: string;
  now?: () => number;
  leaseMs?: number;
  maintenanceMs?: number;
  maxActive?: number;
  /** Process identity for a live child (production: the OS process table). */
  identify?(pid: number): Promise<ProcessIdentity | null>;
  /** Kills a recorded child only if its identity (pid, birth time, image) still matches; returns whether it was alive. */
  killVerified?(identity: ProcessIdentity): Promise<boolean>;
  faults?(point: FaultPoint, taskId: string): void;
  /** This runtime is the only one on its database (the Host holds its port): at startup, every foreign lease is a dead Host's. */
  exclusive?: boolean;
  /** MA4-S2-T2: a task reached a terminal state (its task-scoped browser session is closed). */
  onTerminal?(taskId: string): void;
};
type Active = { lease: Lease; abort: AbortController; done: Promise<void>; children: Set<ChildProcess> };
const WORKSTATION = "workstation";
const shortError = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 200);

export class PersistentTaskRuntime {
  readonly store: TaskStore;
  readonly instanceId: string;
  private deps: RuntimeDeps;
  private executors: Map<string, Executor>;
  private active = new Map<string, Active>();
  private served = new Map<string, number>();
  private gate: ReturnType<typeof gateCalls>;
  private timer: ReturnType<typeof setInterval> | null = null;
  private pending: ReturnType<typeof setImmediate> | null = null;
  private lastBeat = 0;
  private dead = false;
  private closed = false;
  /** Storage failed its integrity check: views only, nothing executes. */
  readOnly: string | null = null;
  readonly leaseMs: number;

  constructor(deps: RuntimeDeps) {
    this.deps = deps;
    this.store = deps.store;
    this.instanceId = deps.instanceId ?? `host-${randomUUID()}`;
    this.executors = new Map(deps.executors.map(e => [e.kind, e]));
    for (const e of deps.executors) if (e.category === "idempotent" && !e.verify) throw new Error(`Idempotent executor ${e.kind} needs a verify(key) contract.`);
    this.leaseMs = deps.leaseMs ?? 30_000;
    // Grouped schedule across tasks: one GPU-heavy model call at a time on this hardware (MA4-S2 measured result).
    this.gate = gateCalls(deps.call, { maxConcurrent: 1, timeoutMs: 600_000 });
  }
  private now() { return this.deps.now?.() ?? Date.now(); }
  private emit(type: string, detail: string, taskId: string | null) { if (!this.dead) this.deps.emit?.(type, detail, taskId); }
  private facts() { return new Map<string, ExecutorFacts>([...this.executors].map(([k, e]) => [k, { kind: e.kind, category: e.category, gpu: e.gpu, sideEffect: e.sideEffect, consequential: e.consequential, activity: e.activity, preflight: e.preflight }])); }
  gateStats() { return this.gate.stats(); }
  /** The Host-wide gated local model call (the Planner uses it outside any task). */
  modelCall(): ModelCall { return this.gate.call; }
  /** Registered executor facts, as validation sees them. */
  executorFacts() { return this.facts(); }
  activeCount() { return this.active.size; }

  /** Every write funnels through here: a crashed runtime never writes again (it is, for the store, a dead process). */
  private write(id: string, change: Update): Updated {
    if (this.dead) throw new SimulatedCrash("write after crash");
    const policy = this.store.policy();
    const notify = (change.notify ?? []).map(n => ({ ...n, deliver: policy.notifications.enabled && policy.notifications.kinds.includes(n.kind) }));
    const result = this.store.update(id, { ...change, notify });
    for (const n of result.notified) if (n.delivered) this.emit("ptask.notification", `${n.kind}: ${n.text}`, id);
    this.emit("ptask.changed", `${result.record.spec.title}: ${result.record.state}`, id);
    if (TERMINAL_TASK_STATES.includes(result.record.state)) try { this.deps.onTerminal?.(id); } catch { /* cleanup never blocks a commit */ }
    return result;
  }
  private note(kind: NotificationKind, record: TaskRecord, text: string, discriminator = ""): NonNullable<Update["notify"]>[number] {
    return { key: `${record.id}:${kind}${discriminator ? `:${discriminator}` : ""}`, kind, text: `${record.spec.title}: ${text}`, deliver: true };
  }

  // ── commands ──────────────────────────────────────────────────────────────────────────────────────────────────────

  /** Only the workstation owner creates tasks. The task's authority is the envelope given here, validated, never widened. */
  create(raw: { spec: unknown; envelope: unknown; id?: string }, actor: unknown): TaskView {
    if (!isTrustedLocalActor(actor)) throw new Error("Persistent tasks are created on the Windows workstation only.");
    if (this.readOnly) throw new Error(this.readOnly);
    const spec = TaskSpecSchema.parse(raw.spec), envelope = EnvelopeSchema.parse(raw.envelope), now = this.now();
    for (const step of spec.steps) for (const value of Object.values(step.input)) {
      if (typeof value === "string" && CHECKPOINT_SECRET_PATTERNS.some(rule => rule.pattern.test(value))) throw new Error(`Step ${step.id} input looks like a credential; credentials stay in their secure store and are never saved with a task.`);
    }
    const facts = this.facts();
    const problems = validateTask(spec, envelope, facts, now);
    for (const dep of spec.dependsOn) {
      try { if (this.store.get(dep).record.projectId !== spec.projectId) problems.push(`Dependency ${dep} belongs to another project.`); }
      catch { problems.push(`Dependency ${dep} does not exist.`); }
    }
    const id = raw.id ?? `ptask-${randomUUID()}`;
    const record: TaskRecord = {
      schema: "ma4.task.v1", id, owner: "workstation", projectId: spec.projectId, spec, specSha256: sha256(canonical(spec)), envelope, envelopeSha256: sha256(canonical(envelope)),
      state: "CREATED", createdAt: now, updatedAt: now, approval: null, approvalRequired: approvalRequired(spec, envelope, facts), revokedAt: null,
      steps: spec.steps.map(s => ({ id: s.id, state: "pending", attempts: 0, outputSha256: null, error: null })),
      usage: { modelCalls: 0, workMs: 0 }, controls: { pauseRequested: false, cancelRequested: false }, blocked: null, failure: null, uncertainOperation: null, suspendedMs: 0,
      activities: spec.steps.map(s => facts.get(s.kind)?.activity ?? null), pendingAction: null, actionApprovals: [],
    };
    this.store.insert(record, WORKSTATION, now);
    if (problems.length) {
      this.write(id, { actor: WORKSTATION, reason: "validation failed", now, to: "FAILED", mutate: r => { r.failure = { code: "VALIDATION", detail: problems.join(" ").slice(0, 400) }; } });
      throw new Error(`Task refused: ${problems.join(" ")}`);
    }
    this.write(id, { actor: WORKSTATION, reason: "validated", now, to: "VALIDATED" });
    const next = this.write(id, record.approvalRequired
      ? { actor: WORKSTATION, reason: "approval required", now, to: "AWAITING_APPROVAL", notify: [this.note("approval_required", record, "needs your approval", "1")] }
      : { actor: WORKSTATION, reason: "queued", now, to: "QUEUED" });
    this.wake();
    return taskView(next.record, next.version);
  }

  /** Workstation-only. Binds the exact spec and envelope hashes; always expires (default 24 h, never past the envelope). */
  approve(id: string, actor: unknown, options: { ttlMs?: number; expectVersion?: number } = {}): TaskView {
    if (!isTrustedLocalActor(actor)) throw new Error("Task approval requires the workstation owner on the Windows Host.");
    const now = this.now(), ttl = Math.min(Math.max(options.ttlMs ?? 24 * 3_600_000, 60_000), 7 * 24 * 3_600_000);
    const result = this.write(id, { actor: WORKSTATION, reason: "approved by owner", now, from: ["AWAITING_APPROVAL"], to: "QUEUED", expectVersion: options.expectVersion,
      mutate: r => { if (r.pendingAction) throw new TaskConflictError("This task is waiting for permission for one specific action. Approve or deny that action."); r.approval = { by: "workstation", at: now, expiresAt: Math.min(now + ttl, r.envelope.expiresAt), specSha256: r.specSha256, envelopeSha256: r.envelopeSha256, round: (r.approval?.round ?? 0) + 1 }; } });
    this.wake();
    return taskView(result.record, result.version);
  }
  /**
   * MA4-S2-T3, Host-internal (no command reaches it): the proactive engine approves one occurrence of an owner-approved
   * schedule. The schedule verified that this task's spec and envelope are exactly the ones the owner approved; this
   * binds the same hashes, logs the schedule as the approver, and never covers a consequential action's own approval.
   */
  approveScheduled(id: string, scheduleId: string, ttlMs: number): TaskView {
    const now = this.now(), ttl = Math.min(Math.max(ttlMs, 60_000), 7 * 24 * 3_600_000);
    const result = this.write(id, { actor: `schedule:${scheduleId}`.slice(0, 80), reason: "approved by the owner's schedule", now, from: ["AWAITING_APPROVAL"], to: "QUEUED",
      mutate: r => { if (r.pendingAction) throw new TaskConflictError("A connected action is waiting for the owner; a schedule cannot approve it."); r.approval = { by: "workstation", at: now, expiresAt: Math.min(now + ttl, r.envelope.expiresAt), specSha256: r.specSha256, envelopeSha256: r.envelopeSha256, round: (r.approval?.round ?? 0) + 1 }; } });
    this.wake();
    return taskView(result.record, result.version);
  }
  /**
   * MA4-S2-T2, workstation-only: approves exactly one proposed action. The owner names the payload hash they reviewed; a
   * different hash (the action changed, or the request is forged) is refused. The approval is spent when the step succeeds.
   */
  approveAction(id: string, actionId: string, payloadSha256: string, actor: unknown, options: { ttlMs?: number } = {}): TaskView {
    if (!isTrustedLocalActor(actor)) throw new Error("Approving a connected action requires the workstation owner on the Windows Host.");
    const now = this.now(), ttl = Math.min(Math.max(options.ttlMs ?? 15 * 60_000, 60_000), 3_600_000);
    const result = this.write(id, { actor: WORKSTATION, reason: "action approved by owner", now, from: ["AWAITING_APPROVAL"], to: "QUEUED",
      mutate: r => {
        const p = r.pendingAction;
        if (!p || p.actionId !== actionId) throw new TaskConflictError("That action is not waiting for permission.");
        if (p.payloadSha256 !== payloadSha256) throw new TaskConflictError("The action changed since you reviewed it; nothing was approved. Inspect it again.");
        if (p.expiresAt <= now) throw new TaskConflictError("This proposal expired; it will be prepared again with current data.");
        r.actionApprovals = [...(r.actionApprovals ?? []).filter(a => a.stepId !== p.stepId), { stepId: p.stepId, actionId, payloadSha256, at: now, expiresAt: Math.min(now + ttl, r.envelope.expiresAt) }];
        r.pendingAction = null;
      } });
    this.wake();
    return taskView(result.record, result.version);
  }
  /** Denying one action ends the task at that step; nothing of it is sent. */
  denyAction(id: string, actionId: string, actor: unknown): TaskView {
    if (!isTrustedLocalActor(actor)) throw new Error("Denying a connected action happens on the Windows workstation.");
    const now = this.now();
    const result = this.write(id, { actor: WORKSTATION, reason: "action denied by owner", now, from: ["AWAITING_APPROVAL"], to: "FAILED", leaseOp: { kind: "fence" },
      mutate: r => {
        if (r.pendingAction?.actionId !== actionId) throw new TaskConflictError("That action is not waiting for permission.");
        r.failure = { code: "ACTION_DENIED", detail: `You denied: ${r.pendingAction.summary}`.slice(0, 300) };
        r.pendingAction = null;
      } });
    return taskView(result.record, result.version);
  }
  /** Workstation-only full detail of the action waiting for permission (preview included). */
  pendingAction(id: string, actor: unknown): ActionProposal | null {
    if (!isTrustedLocalActor(actor)) throw new Error("Action details are shown on the Windows workstation.");
    return this.store.get(id).record.pendingAction ?? null;
  }
  /** Ends the task's authority at once. A running worker observes it at its next boundary or lease check. */
  revoke(id: string, actor: unknown): TaskView {
    if (!isTrustedLocalActor(actor)) throw new Error("Revoking a task's authority requires the workstation owner.");
    const now = this.now(), { record } = this.store.get(id);
    if (TERMINAL_TASK_STATES.includes(record.state)) throw new TaskConflictError(`The task is already ${record.state}.`);
    const running = this.active.get(id);
    if (running) { this.write(id, { actor: WORKSTATION, reason: "authority revoked", now, mutate: r => { r.revokedAt = now; r.controls.cancelRequested = true; } }); running.abort.abort("revoked"); return this.view(id) as TaskView; }
    const result = this.write(id, { actor: WORKSTATION, reason: "authority revoked", now, to: "FAILED", leaseOp: { kind: "fence" },
      mutate: r => { r.revokedAt = now; r.failure = { code: "AUTHORITY_REVOKED", detail: "The owner revoked this task's authority." }; } });
    return taskView(result.record, result.version);
  }
  pause(id: string, actor: string): TaskView {
    const now = this.now(), { record } = this.store.get(id);
    if (record.state === "RUNNING") {
      const result = this.write(id, { actor, reason: "pause requested", now, from: ["RUNNING"], mutate: r => { r.controls.pauseRequested = true; } });
      return taskView(result.record, result.version);
    }
    const result = this.write(id, { actor, reason: "paused", now, from: ["QUEUED", "RESUMING"], to: "PAUSED", leaseOp: { kind: "fence" }, mutate: r => { r.blocked = { code: "OWNER_PAUSED", detail: "Paused by you.", at: now }; } });
    return taskView(result.record, result.version);
  }
  /** Resume goes through RESUMING: the claim that follows re-verifies authorization, pins and policy before any work. */
  resume(id: string, actor: string): TaskView {
    const now = this.now();
    const result = this.write(id, { actor, reason: "resume requested", now, from: ["PAUSED"], to: "RESUMING", mutate: r => { r.blocked = null; r.controls.pauseRequested = false; } });
    this.wake();
    return taskView(result.record, result.version);
  }
  cancel(id: string, actor: string): TaskView {
    const now = this.now(), { record } = this.store.get(id);
    if (TERMINAL_TASK_STATES.includes(record.state)) throw new TaskConflictError(`The task is already ${record.state}.`);
    const running = this.active.get(id);
    if (record.state === "RUNNING") {
      // The holder (here, or another Host instance at its next lease check) stops the work and records the outcome.
      this.write(id, { actor, reason: "cancel requested", now, mutate: r => { r.controls.cancelRequested = true; } });
      running?.abort.abort("cancelled");
      return this.view(id) as TaskView;
    }
    // A proposal waiting for permission dies with the task, as on deny, so no view keeps offering it.
    const result = this.write(id, { actor, reason: "cancelled", now, to: "CANCELLED", leaseOp: { kind: "fence" }, mutate: r => { r.controls.cancelRequested = true; r.pendingAction = null; } });
    return taskView(result.record, result.version);
  }
  /**
   * Owner reconciliation of an UNCERTAIN operation. "happened": the effect is recorded as done (owner-attested receipt) and
   * nothing is re-sent. "not_happened": the owner authorizes one fresh attempt. "abandon": the task fails.
   */
  reconcile(id: string, decision: "happened" | "not_happened" | "abandon", actor: unknown): TaskView {
    if (!isTrustedLocalActor(actor)) throw new Error("Only the workstation owner can resolve an uncertain action.");
    const now = this.now(), { record } = this.store.get(id);
    const key = record.uncertainOperation;
    if (record.state !== "UNCERTAIN" || !key) throw new TaskConflictError("This task has no uncertain action to resolve.");
    const stepId = key.slice(id.length + 1), index = record.steps.findIndex(s => s.id === stepId);
    const category = this.store.operation(key)?.category ?? "irreversible";
    const result = decision === "abandon"
      ? this.write(id, { actor: WORKSTATION, reason: "owner abandoned uncertain action", now, to: "FAILED", operation: { key, stepId, category, state: "uncertain" }, mutate: r => { r.uncertainOperation = null; r.failure = { code: "OWNER_ABANDONED", detail: "You abandoned the task at an uncertain action." }; } })
      : this.write(id, { actor: WORKSTATION, reason: `owner reconciled: ${decision}`, now, to: "QUEUED",
          operation: { key, stepId, category, state: decision === "happened" ? "succeeded" : "failed", receipt: decision === "happened" ? "owner-attested" : null },
          mutate: r => { r.uncertainOperation = null; r.actionApprovals = (r.actionApprovals ?? []).filter(a => a.stepId !== stepId); if (index >= 0) Object.assign(r.steps[index], decision === "happened" ? { state: "succeeded", error: null, outputSha256: sha256("owner-attested") } : { state: "pending", error: "Owner confirmed it did not happen." }); } });
    this.wake();
    return taskView(result.record, result.version);
  }
  acknowledge(key: string) { return this.store.acknowledge(key); }
  setPolicy(raw: unknown, actor: unknown): TaskPolicy {
    if (!isTrustedLocalActor(actor)) throw new Error("Background and startup policy are owner settings on the Windows workstation.");
    const policy = this.store.setPolicy(raw);
    this.emit("ptask.policy_changed", `Background execution ${policy.background ? "on" : "off"}; resume after restart ${policy.resumeOnStart ? "on" : "off"}.`, null);
    this.wake();
    return policy;
  }

  view(id: string): TaskView | CorruptTaskView {
    try { const row = this.store.get(id); return taskView(row.record, row.version); }
    catch (error) { return { id, corrupt: true, display: "Needs attention", detail: shortError(error) }; }
  }
  views(): (TaskView | CorruptTaskView)[] {
    return this.store.list().map(row => row.ok ? taskView(row.record, row.version) : { id: row.id, corrupt: true as const, display: "Needs attention" as const, detail: row.error.slice(0, 200) });
  }
  snapshot() {
    return { schema: "ma4.ptask.snapshot.v1" as const, hostInstance: this.instanceId, at: this.now(), readOnly: this.readOnly, policy: this.store.policy(), uiAttached: this.deps.uiAttached(),
      tasks: this.views(), notifications: this.store.notifications(20) };
  }

  // ── lifecycle ─────────────────────────────────────────────────────────────────────────────────────────────────────

  /** Host start: integrity check, crash recovery under the startup policy, then the scheduler. */
  async start(): Promise<void> {
    const integrity = this.store.integrity();
    if (!integrity.ok) { this.readOnly = `Task storage failed its integrity check (${integrity.detail.slice(0, 120)}); tasks are shown but nothing runs.`; this.emit("ptask.storage_refused", this.readOnly, null); return; }
    await this.recover(true);
    this.store.prune(this.now());
    this.lastBeat = this.now();
    this.timer = setInterval(() => void this.maintain(), this.deps.maintenanceMs ?? 5_000);
    this.timer.unref?.();
    this.wake();
  }
  /** Graceful stop: no new claims; running steps are aborted and handed to recovery (RESUMING) without losing their state. */
  async close(): Promise<void> {
    this.closed = true;
    if (this.timer) clearInterval(this.timer);
    if (this.pending) clearImmediate(this.pending);
    this.pending = null;
    for (const a of this.active.values()) a.abort.abort("host-shutdown");
    await Promise.allSettled([...this.active.values()].map(a => a.done));
  }
  /** Test seam: the Host dies now. Nothing more is written; leases stay as they were, exactly like a killed process. */
  crash(): void {
    this.dead = true; this.closed = true;
    if (this.timer) clearInterval(this.timer);
    if (this.pending) clearImmediate(this.pending);
    this.pending = null;
    for (const a of this.active.values()) a.abort.abort("crash");
  }
  async idle(): Promise<void> { while (this.active.size || this.pending) { await Promise.allSettled([...this.active.values()].map(a => a.done)); await new Promise(r => setImmediate(r)); } }

  wake(): void {
    if (this.closed || this.pending) return;
    this.pending = setImmediate(() => { this.pending = null; void this.tick().catch(error => this.emit("ptask.scheduler_error", shortError(error), null)); });
  }

  /** Lease heartbeat, sleep detection, stale-lease reclamation, deadlines and remote cancel requests. Cheap when idle. */
  async maintain(): Promise<void> {
    if (this.closed) return;
    const now = this.now(), interval = this.deps.maintenanceMs ?? 5_000;
    const gap = this.lastBeat ? now - this.lastBeat : 0;
    this.lastBeat = now;
    // A gap far beyond the interval means the machine slept or the Host was suspended: no work happened meanwhile.
    const suspended = gap > interval * 3 ? gap - interval : 0;
    for (const [id, a] of this.active) {
      if (!this.store.renew(id, a.lease, this.leaseMs, now)) { a.abort.abort("lease-lost"); continue; }
      try {
        const { record } = this.store.get(id);
        if (record.controls.cancelRequested) a.abort.abort("cancelled");
        if (suspended) this.write(id, { actor: "host", reason: `host was unavailable for ${Math.round(suspended / 1000)} s; no progress is claimed for that time`, now, lease: a.lease, mutate: r => { r.suspendedMs += suspended; } });
      } catch { /* the worker's own commit reports the problem */ }
    }
    await this.recover(false);
    this.wake();
  }

  /**
   * Takes over tasks whose worker is gone (lease expired, or held by a dead instance at startup). The fence is bumped in
   * the same transaction, so the old worker can never commit afterwards. Then the in-flight operation is classified.
   */
  async recover(startup: boolean): Promise<void> {
    if (this.readOnly || this.dead) return;
    const now = this.now(), policy = this.store.policy();
    // A RESUMING task holds no lease and waits for a claim; at startup it only meets the startup policy.
    if (startup && !policy.resumeOnStart) for (const row of this.store.list(["RESUMING"])) {
      if (!row.ok) continue;
      try { this.write(row.record.id, { actor: "recovery", reason: "startup policy: wait for the user", now, from: ["RESUMING"], to: "PAUSED", expectVersion: row.version, mutate: r => { r.blocked = { code: "HOST_RESTARTED", detail: "Bunny-A restarted. Resume when you are ready.", at: now }; } }); }
      catch (error) { if (!(error instanceof TaskConflictError)) throw error; }
    }
    for (const row of this.store.list(["RUNNING"])) {
      if (!row.ok || this.active.has(row.record.id)) continue;
      const leased = row.leaseHolder && (row.leaseExpires ?? 0) > now;
      if (leased && row.leaseHolder !== this.instanceId && !(startup && this.deps.exclusive)) continue; // another live Host holds it
      const record = row.record, ops = this.store.operations(record.id).filter(o => o.state === "started");
      const op = ops[0] ?? null, index = op ? record.steps.findIndex(s => s.id === op.stepId) : -1;
      try {
        if (op?.category === "irreversible") {
          this.write(record.id, { actor: "recovery", reason: "interrupted during an irreversible action; not replayed", now, to: "UNCERTAIN", leaseOp: { kind: "fence" }, expectVersion: row.version,
            operation: { key: op.key, stepId: op.stepId, category: op.category, state: "uncertain" },
            mutate: r => { r.uncertainOperation = op.key; if (index >= 0) r.steps[index].state = "uncertain"; },
            notify: [this.note("recovery_blocked", record, "an action may or may not have happened; your decision is needed", op.key)] });
          continue;
        }
        const recovered = this.write(record.id, { actor: "recovery", reason: startup ? "Host restarted; recovering" : "worker lease expired; recovering", now, to: "RESUMING", leaseOp: { kind: "fence" }, expectVersion: row.version,
          ...(op ? { operation: { key: op.key, stepId: op.stepId, category: op.category, state: op.category === "idempotent" ? "needs_verify" as const : "interrupted" as const } } : {}),
          mutate: r => { if (index >= 0) r.steps[index].state = "pending"; },
          checkpoint: { phase: "recovered", step: op?.stepId ?? null, startup } });
        if (startup && !policy.resumeOnStart)
          this.write(record.id, { actor: "recovery", reason: "startup policy: wait for the user", now, from: ["RESUMING"], to: "PAUSED", expectVersion: recovered.version,
            mutate: r => { r.blocked = { code: "HOST_RESTARTED", detail: "Bunny-A restarted. Resume when you are ready.", at: now }; } });
        this.emit("ptask.recovered", `${record.spec.title}: recovered (${op ? `${op.category} step ${op.stepId} interrupted` : "no step in flight"}).`, record.id);
      } catch (error) {
        if (!(error instanceof TaskConflictError)) throw error; // someone else changed it first: theirs wins
      }
    }
    // Children recorded by a previous Host life: killed only when their exact identity still matches.
    for (const p of this.store.processes()) {
      if (this.active.has(p.taskId)) continue;
      try {
        const killed = this.deps.killVerified ? await this.deps.killVerified(p) : false;
        this.store.forgetProcess(p);
        this.emit("ptask.orphan_cleaned", killed ? "Stopped a leftover child process of a recovered task." : "A recorded child process had already ended with its Host.", p.taskId);
      }
      catch (error) { this.emit("ptask.orphan_review", `A leftover child process could not be verified for cleanup: ${shortError(error)}`, p.taskId); }
    }
  }

  /** Re-checks authority before any work: revocation, envelope expiry, deadline and a live, hash-bound approval. */
  private authorize(r: TaskRecord, now: number): { to: TaskState; reason: string; failure?: { code: TaskFailureCode; detail: string }; notify?: NonNullable<Update["notify"]> } | null {
    if (r.revokedAt) return { to: "FAILED", reason: "authority revoked", failure: { code: "AUTHORITY_REVOKED", detail: "The owner revoked this task's authority." }, notify: [this.note("failed", r, "stopped: authority was revoked")] };
    if (r.envelope.expiresAt <= now) return { to: "FAILED", reason: "envelope expired", failure: { code: "ENVELOPE_EXPIRED", detail: "The task's authorization window ended." }, notify: [this.note("failed", r, "stopped: its authorization expired")] };
    if (r.spec.deadlineAt !== null && r.spec.deadlineAt <= now) return { to: "FAILED", reason: "deadline missed", failure: { code: "DEADLINE_MISSED", detail: "The deadline passed before the task finished." }, notify: [this.note("deadline_missed", r, "missed its deadline")] };
    const a = r.approval;
    if (r.approvalRequired && !(a && a.expiresAt > now && a.specSha256 === r.specSha256 && a.envelopeSha256 === r.envelopeSha256))
      return { to: "AWAITING_APPROVAL", reason: a ? "approval expired" : "approval required", notify: [this.note("approval_required", r, a ? "its approval expired; approve again to continue" : "needs your approval", String((a?.round ?? 0) + 1))] };
    return null;
  }
  private mayRun(r: TaskRecord, policy: TaskPolicy): boolean { return this.deps.uiAttached() || (policy.background && r.envelope.background); }

  async tick(): Promise<void> {
    if (this.closed || this.readOnly) return;
    // UNCERTAIN is not swept: an action that may have happened waits for the owner, deadline or not.
    const now = this.now(), policy = this.store.policy(), rows = this.store.list(["AWAITING_APPROVAL", "QUEUED", "RESUMING", "PAUSED"]);
    const states = new Map(this.store.list().flatMap(row => row.ok ? [[row.record.id, row.record.state] as const] : []));
    const ready: typeof rows = [];
    for (const row of rows) {
      if (!row.ok) continue;
      const r = row.record;
      // Deadlines and dependency failures settle waiting tasks too, so nothing sits forever on a dead plan.
      if (r.spec.deadlineAt !== null && r.spec.deadlineAt <= now) { this.settle(row.record.id, row.version, "FAILED", "deadline missed", { code: "DEADLINE_MISSED", detail: "The deadline passed before the task finished." }, [this.note("deadline_missed", r, "missed its deadline")]); continue; }
      // An unanswered proposal goes stale: the step prepares it again from current data (versions, content, recipients).
      if (r.state === "AWAITING_APPROVAL" && r.pendingAction && r.pendingAction.expiresAt <= now) { this.settle(r.id, row.version, "QUEUED", "action proposal expired; preparing it again", undefined, undefined, x => { x.pendingAction = null; }); continue; }
      const deps = r.spec.dependsOn.map(d => states.get(d));
      if (deps.some(s => s === "FAILED" || s === "CANCELLED" || s === undefined)) { this.settle(r.id, row.version, "FAILED", "dependency failed", { code: "DEPENDENCY_FAILED", detail: "A task this one depends on did not complete." }, [this.note("failed", r, "cannot run: a dependency did not complete")]); continue; }
      if ((r.state === "QUEUED" || r.state === "RESUMING") && deps.every(s => s === "COMPLETED") && !this.active.has(r.id) && this.mayRun(r, policy)) ready.push(row);
    }
    // Fairness: the project served longest ago goes first; ties by age.
    ready.sort((a, b) => a.ok && b.ok ? (this.served.get(a.record.projectId) ?? 0) - (this.served.get(b.record.projectId) ?? 0) || a.record.createdAt - b.record.createdAt : 0);
    for (const row of ready) {
      if (this.active.size >= (this.deps.maxActive ?? 2) || this.closed || !row.ok) break;
      const r = row.record, block = this.authorize(r, now);
      if (block) { this.settle(r.id, row.version, block.to, block.reason, block.failure, block.notify); continue; }
      let claimed: Updated;
      try {
        claimed = this.write(r.id, { actor: this.instanceId, reason: r.state === "RESUMING" ? "resumed by worker" : "claimed by worker", now, from: ["QUEUED", "RESUMING"], to: "RUNNING", expectVersion: row.version,
          leaseOp: { kind: "claim", holder: this.instanceId, ttlMs: this.leaseMs }, mutate: x => { x.blocked = null; x.controls.pauseRequested = false; }, checkpoint: { phase: "claimed" } });
      } catch (error) { if (error instanceof TaskConflictError) continue; throw error; }
      this.served.set(r.projectId, now);
      const active: Active = { lease: { holder: this.instanceId, fence: claimed.fence }, abort: new AbortController(), done: Promise.resolve(), children: new Set() };
      this.active.set(r.id, active);
      active.done = this.work(r.id, active).finally(() => { this.active.delete(r.id); this.wake(); });
    }
  }
  private settle(id: string, version: number, to: TaskState, reason: string, failure?: { code: TaskFailureCode; detail: string }, notify?: NonNullable<Update["notify"]>, mutate?: (r: TaskRecord) => void) {
    try { this.write(id, { actor: "scheduler", reason, now: this.now(), to, expectVersion: version, leaseOp: { kind: "fence" }, mutate: r => { if (failure) r.failure = failure; mutate?.(r); }, notify }); }
    catch (error) { if (!(error instanceof TaskConflictError)) throw error; }
  }

  private async work(id: string, a: Active): Promise<void> {
    const lease = a.lease;
    // A fault hook simulating a crash stops this worker exactly where it stands.
    const fault = (point: FaultPoint) => { if (this.deps.faults) try { this.deps.faults(point, id); } catch (error) { if (error instanceof SimulatedCrash) this.crash(); throw error; } };
    const commit = (change: Omit<Update, "now" | "lease" | "actor">) => this.write(id, { ...change, actor: this.instanceId, now: this.now(), lease });
    const stop = (to: TaskState, reason: string, extra: Partial<Omit<Update, "now" | "lease" | "actor" | "to" | "reason">> = {}) => commit({ ...extra, to, reason, leaseOp: { kind: "release" } });
    try {
      fault("after-claim");
      for (;;) {
        if (this.dead) return;
        const { record } = this.store.get(id);
        if (record.state !== "RUNNING") return;
        const now = this.now(), policy = this.store.policy();
        if (record.controls.cancelRequested) { stop(record.revokedAt ? "FAILED" : "CANCELLED", record.revokedAt ? "authority revoked" : "cancelled", record.revokedAt ? { mutate: r => { r.failure = { code: "AUTHORITY_REVOKED", detail: "The owner revoked this task's authority." }; } } : {}); return; }
        if (a.abort.signal.aborted && a.abort.signal.reason === "host-shutdown") { stop("RESUMING", "Host stopping; handed to recovery"); return; }
        if (record.controls.pauseRequested) { stop("PAUSED", "paused at a step boundary", { mutate: r => { r.blocked = { code: "OWNER_PAUSED", detail: "Paused by you.", at: now }; } }); return; }
        if (!this.mayRun(record, policy)) { stop("PAUSED", "window closed and background execution is off", { mutate: r => { r.blocked = { code: "BACKGROUND_DISABLED", detail: "Paused because Bunny-A's windows closed and background work is off.", at: now }; } }); return; }
        const block = this.authorize(record, now);
        if (block) { stop(block.to, block.reason, { ...(block.failure ? { mutate: r => { r.failure = block.failure!; } } : {}), notify: block.notify }); return; }
        const index = record.steps.findIndex(s => s.state !== "succeeded");
        if (index < 0) {
          const unmet = record.spec.acceptance.requiredSteps.filter(s => !record.steps.find(x => x.id === s)?.outputSha256);
          if (unmet.length) stop("FAILED", "acceptance unmet", { mutate: r => { r.failure = { code: "ACCEPTANCE_UNMET", detail: `No receipt for: ${unmet.join(", ")}.` }; }, notify: [this.note("failed", record, "finished without meeting its acceptance contract")] });
          else stop("COMPLETED", "acceptance contract met", { notify: [this.note("completed", record, "completed")], checkpoint: { phase: "completed" } });
          return;
        }
        await this.step(id, record, index, a, commit, stop, fault);
      }
    } catch (error) {
      if (this.dead || error instanceof SimulatedCrash) return;
      if (error instanceof StaleLeaseError) { this.emit("ptask.stale_worker_rejected", error.message, id); return; }
      // Anything else: leave the durable state as it is. The lease lapses and recovery classifies the step honestly.
      this.emit("ptask.worker_error", shortError(error), id);
    } finally {
      for (const child of a.children) if (child.exitCode === null && child.signalCode === null) try { child.kill(); } catch { /* already gone */ }
    }
  }

  private async step(id: string, record: TaskRecord, index: number, a: Active, commit: (c: Omit<Update, "now" | "lease" | "actor">) => Updated, stop: (to: TaskState, reason: string, extra?: Partial<Omit<Update, "now" | "lease" | "actor" | "to" | "reason">>) => Updated, fault: (p: FaultPoint) => void) {
    const spec = record.spec.steps[index], state = record.steps[index], executor = this.executors.get(spec.kind)!;
    const key = `${id}:${spec.id}`, op = this.store.operation(key), now = this.now();
    const succeed = (output: string, receipt: string | null, reason: string) => commit({ reason, operation: { key, stepId: spec.id, category: executor.category, state: "succeeded", receipt },
      output: { stepId: spec.id, content: output }, checkpoint: { phase: "step_succeeded", step: spec.id },
      // A step's approval is spent by its success; it never carries over to another run.
      mutate: r => { Object.assign(r.steps[index], { state: "succeeded", outputSha256: sha256(output.slice(0, 64_000)), error: null }); r.actionApprovals = (r.actionApprovals ?? []).filter(x => x.stepId !== spec.id); } });
    if (op?.state === "succeeded") { succeed(this.store.output(id, spec.id)?.content ?? "", op.receipt, "consumed a recorded result; not re-executed"); return; }
    if (op?.state === "started" || op?.state === "uncertain") {
      // Cannot happen while this worker holds the lease unless state was lost; never guess — the owner decides.
      stop("UNCERTAIN", "operation state is ambiguous", { mutate: r => { r.uncertainOperation = key; r.steps[index].state = "uncertain"; }, notify: [this.note("recovery_blocked", record, "an action's outcome is unknown; your decision is needed", key)] });
      return;
    }
    if (op?.state === "needs_verify" && executor.verify) {
      const found = await executor.verify(key, a.abort.signal, spec.input, record.envelope, { taskId: id, stepId: spec.id, outputOf: stepId => this.store.output(id, stepId)?.content ?? null, now: () => this.now() });
      if (found.found) { succeed(found.output ?? "", found.receipt ?? "verified-by-key", "idempotent operation verified as already applied"); return; }
    }
    if (state.attempts >= spec.maxAttempts) { stop("FAILED", "attempts exhausted", { mutate: r => { r.failure = { code: "STEP_FAILED", detail: `Step ${spec.id} failed ${state.attempts} time(s): ${state.error ?? "no detail"}`.slice(0, 300) }; }, notify: [this.note("failed", record, `failed at step ${spec.id}`)] }); return; }
    if (executor.gpu) {
      if (record.usage.modelCalls + 1 > record.envelope.budgets.maxModelCalls) { stop("FAILED", "model-call budget exhausted", { mutate: r => { r.failure = { code: "BUDGET_EXHAUSTED", detail: "The task used its model-call budget." }; }, notify: [this.note("failed", record, "used its model-call budget")] }); return; }
      if (!(await this.deps.modelAvailable(spec.model!))) { this.block(record, "MODEL_UNAVAILABLE", `Pinned model ${spec.model} is not available on this PC; no other model is used.`, stop); return; }
      const res = this.deps.resources?.() ?? { ok: true, detail: "" };
      if (!res.ok) { this.block(record, "RESOURCES_UNAVAILABLE", res.detail, stop); return; }
    }
    if (record.usage.workMs >= record.envelope.budgets.maxWallMs) { stop("FAILED", "time budget exhausted", { mutate: r => { r.failure = { code: "BUDGET_EXHAUSTED", detail: "The task used its working-time budget." }; }, notify: [this.note("failed", record, "used its working-time budget")] }); return; }

    fault("before-operation-start");
    // Durable intent BEFORE the effect, under this worker's fence.
    commit({ reason: `step ${spec.id} attempt ${state.attempts + 1} started`, operation: { key, stepId: spec.id, category: executor.category, state: "started", start: true },
      checkpoint: { phase: "operation_started", step: spec.id, attempt: state.attempts + 1, category: executor.category },
      mutate: r => { r.steps[index].state = "running"; r.steps[index].attempts += 1; if (executor.gpu) r.usage.modelCalls += 1; } });
    fault("after-operation-start");
    const started = this.now(), signal = AbortSignal.any([a.abort.signal, AbortSignal.timeout(executor.timeoutMs)]);
    let result: StepResult;
    try {
      result = await executor.run(spec.input, { taskId: id, stepId: spec.id, attempt: state.attempts + 1, idempotencyKey: key, model: spec.model, signal, call: this.gate.call, track: child => this.track(id, a, child),
        envelope: record.envelope, approval: record.actionApprovals?.find(x => x.stepId === spec.id) ?? null, outputOf: stepId => this.store.output(id, stepId)?.content ?? null, now: () => this.now() });
    } catch (error) { result = { ok: false, error: shortError(error), dispatched: true, definite: false }; }
    fault("after-effect");
    if (this.dead) return;
    const workMs = Math.max(0, this.now() - started);
    if (result.ok) { commit({ reason: "work time", mutate: r => { r.usage.workMs += workMs; } }); succeed(result.output, result.receipt ?? null, `step ${spec.id} succeeded`); fault("after-receipt"); return; }
    if ("proposal" in result) {
      const proposal = result.proposal;
      stop("AWAITING_APPROVAL", `action needs your permission: ${proposal.summary}`, { operation: { key, stepId: spec.id, category: executor.category, state: "failed" },
        mutate: r => { r.usage.workMs += workMs; r.steps[index] = { ...r.steps[index], state: "pending", attempts: r.steps[index].attempts - 1, error: null }; r.pendingAction = proposal; },
        notify: [this.note("approval_required", record, `waiting for permission: ${proposal.summary}`, proposal.actionId)] });
      return;
    }
    const failed = result;
    if (failed.fatal) { stop("FAILED", failed.fatal.toLowerCase(), { operation: { key, stepId: spec.id, category: executor.category, state: "failed" }, mutate: r => { r.usage.workMs += workMs; r.steps[index] = { ...r.steps[index], state: "failed", error: failed.error }; r.failure = { code: failed.fatal!, detail: failed.error }; }, notify: [this.note("failed", record, `failed at step ${spec.id}`)] }); return; }
    const known = !failed.dispatched || failed.definite;
    if (!known && executor.category === "irreversible") {
      stop("UNCERTAIN", "irreversible action outcome unknown; not replayed", { operation: { key, stepId: spec.id, category: executor.category, state: "uncertain" },
        mutate: r => { r.usage.workMs += workMs; r.uncertainOperation = key; r.steps[index] = { ...r.steps[index], state: "uncertain", error: failed.error }; },
        notify: [this.note("recovery_blocked", record, "an action may or may not have happened; your decision is needed", key)] });
      return;
    }
    const opState = known ? "failed" : executor.category === "idempotent" ? "needs_verify" : "interrupted";
    commit({ reason: `step ${spec.id} attempt failed`, operation: { key, stepId: spec.id, category: executor.category, state: opState },
      mutate: r => { r.usage.workMs += workMs; r.steps[index] = { ...r.steps[index], state: "pending", error: failed.error.slice(0, 200) }; } });
  }
  private block(record: TaskRecord, code: BlockCode, detail: string, stop: (to: TaskState, reason: string, extra?: Partial<Omit<Update, "now" | "lease" | "actor" | "to" | "reason">>) => Updated) {
    const recovered = this.store.transitions(record.id).some(t => t.to === "RESUMING");
    stop("PAUSED", detail, { mutate: r => { r.blocked = { code, detail, at: this.now() }; }, notify: recovered ? [this.note("recovery_blocked", record, detail, code)] : [] });
  }
  private track(id: string, a: Active, child: ChildProcess) {
    a.children.add(child);
    child.once("exit", () => a.children.delete(child));
    if (child.pid && this.deps.identify) {
      void this.deps.identify(child.pid).then(identity => {
        if (!identity || this.dead) return;
        if (child.exitCode !== null || child.signalCode !== null) return;
        this.store.recordProcess(id, identity);
        child.once("exit", () => { if (!this.dead) this.store.forgetProcess(identity); });
      }).catch(() => undefined);
    }
  }
}
