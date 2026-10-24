import { randomUUID } from "node:crypto";
import { isTrustedLocalActor } from "../../bunny-missions/authorization.server.ts";
import { CHECKPOINT_SECRET_PATTERNS } from "../agent-checkpoint.server.ts";
import { FileScopeError, readText, relativeSegments, walk, type FileRootRegistry } from "./connectors/files.server.ts";
import {
  classify, decide, GoalSpecSchema, MAX_APPROVAL_MS, MonitorSpecSchema, nextSlot, observation, sanitize, ScheduleSpecSchema, slotNote, slotsBetween, specHash,
  type Approval, type ChangeClass, type DecisionFacts, type MonitorSpec, type NotificationCategory, type Observation, type Outcome, type ScheduleSpec, type Trigger,
} from "./proactive.ts";
import { ProactiveConflictError, type GoalRecord, type Kind, type MonitorRecord, type NewNotification, type Occurrence, type ProactiveStore, type ScheduleRecord } from "./proactive-store.server.ts";
import { TERMINAL_TASK_STATES, validateTask, type TaskView } from "./task-runtime.ts";
import { TaskConflictError } from "./task-store.server.ts";
import type { PersistentTaskRuntime } from "./task-runtime.server.ts";

/**
 * MA4-S2-T3 proactive engine. It turns owner-approved schedules and monitors into ordinary S2-T1 tasks, at the right
 * time, at most once per slot, and only while this Host runs. It never executes anything itself: every effect is a step
 * of a persistent task, inside that task's envelope, through the S2-T2 broker. Each trigger is re-authorized from the
 * stored record (approval, hashes, expiry, goal, budgets, policy) by the pure decide() — nothing a model, a monitored
 * file or a webpage says reaches that decision.
 */
export type ProactiveDeps = {
  store: ProactiveStore;
  runtime: PersistentTaskRuntime;
  roots?: FileRootRegistry | null;
  /** Test-only recorded sources (synthetic browser pages and connected-service events). Production registers none. */
  sources?: Readonly<Record<string, () => Promise<unknown>>> | null;
  modelAvailable(model: string): Promise<boolean>;
  uiAttached(): boolean;
  emit?(type: string, detail: string): void;
  now?: () => number;
  /** Longest wait between two ticks when nothing is due (default 60 s): no high-frequency polling while idle. */
  maxSleepMs?: number;
  /** Tests drive tick() themselves with a fake clock. */
  timers?: boolean;
  /** Test seam: throwing here simulates the Host dying after a decision was committed and before its task exists. */
  faults?(point: "after-decision", key: string): void;
};
const MINUTE = 60_000, HOUR = 60 * MINUTE, DAY = 24 * HOUR;
const WORKSTATION = "workstation";
const short = (e: unknown) => sanitize(e instanceof Error ? e.message : String(e), 200);
const containsSecret = (value: unknown) => typeof value === "string" && CHECKPOINT_SECRET_PATTERNS.some(r => r.pattern.test(value));
const owner = (actor: unknown, what: string) => { if (!isTrustedLocalActor(actor)) throw new Error(`${what} happens on the Windows workstation.`); };

export class ProactiveEngine {
  readonly store: ProactiveStore;
  private deps: ProactiveDeps;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running: Promise<void> | null = null;
  private again = false;
  private closed = false;
  private lastTick = 0;
  /** Scheduler lateness of every fired time slot (ms after its due instant), for the performance report. */
  readonly lateness: number[] = [];

  constructor(deps: ProactiveDeps) { this.deps = deps; this.store = deps.store; }
  private now() { return this.deps.now?.() ?? Date.now(); }
  private emit(type: string, detail: string) { this.deps.emit?.(type, sanitize(detail, 240)); }
  private get maxSleep() { return this.deps.maxSleepMs ?? MINUTE; }

  // ── goals ─────────────────────────────────────────────────────────────────────────────────────────────────────────

  /** A goal, owner-written or a suggestion, starts PROPOSED and is never active until the owner approves it. */
  goalCreate(raw: { spec: unknown; suggested?: boolean; id?: string }, actor: unknown) {
    owner(actor, "Creating a goal");
    const spec = GoalSpecSchema.parse(raw.spec), now = this.now(), problems: string[] = [];
    if (spec.expiresAt <= now) problems.push("The goal's end date is already past.");
    if (spec.expiresAt > now + 365 * DAY) problems.push("A goal lasts at most a year; set an earlier end date.");
    if (spec.deadlineAt !== null && spec.deadlineAt > spec.expiresAt) problems.push("The deadline lies beyond the goal's end date.");
    if (spec.parentId) { try { if (this.store.get("goal", spec.parentId).record.projectId !== spec.projectId) problems.push("The parent goal belongs to another project."); } catch { problems.push("The parent goal does not exist."); } }
    if ([spec.title, spec.description, ...spec.successCriteria.map(c => c.description)].some(containsSecret)) problems.push("The goal text looks like it contains a credential.");
    if (problems.length) throw new Error(`Goal refused: ${problems.join(" ")}`);
    const id = raw.id ?? `goal-${randomUUID()}`;
    const record: GoalRecord = { schema: "ma4.goal.v1", id, projectId: spec.projectId, spec, specSha256: specHash(spec), state: "PROPOSED", origin: raw.suggested ? "suggested" : "owner", approval: null, links: [], met: [], attention: null, createdAt: now, updatedAt: now };
    this.store.insert("goal", record, WORKSTATION, now);
    const r = this.store.update("goal", id, { actor: WORKSTATION, reason: "validated", now, to: "AWAITING_APPROVAL",
      notify: [this.note("approval_required", "goal", id, spec.title, raw.suggested ? "Bunny suggested this goal; it does nothing until you approve it." : "Approve this goal to start tracking it.", "AWAITING_APPROVAL", "approve", `${id}:approval`)] });
    this.changed(`Goal proposed: ${spec.title}`);
    return this.goalView(r.record, r.version);
  }
  goalApprove(id: string, actor: unknown, o: { expectVersion?: number } = {}) {
    owner(actor, "Approving a goal");
    const now = this.now();
    const r = this.store.update("goal", id, { actor: WORKSTATION, reason: "approved by owner", now, from: ["AWAITING_APPROVAL"], to: "ACTIVE", expectVersion: o.expectVersion,
      mutate: g => { if (g.spec.expiresAt <= now) throw new ProactiveConflictError("This goal has already ended."); g.approval = { by: "workstation", at: now, expiresAt: g.spec.expiresAt, specSha256: g.specSha256 }; } });
    this.store.dismissApprovals(id);
    this.changed(`Goal approved: ${r.record.spec.title}`);
    return this.goalView(r.record, r.version);
  }
  goalControl(id: string, control: "pause" | "resume" | "cancel", actor: string) {
    const now = this.now();
    const r = control === "pause" ? this.store.update("goal", id, { actor, reason: "paused", now, from: ["ACTIVE", "NEEDS_ATTENTION"], to: "PAUSED" })
      : control === "resume" ? this.store.update("goal", id, { actor, reason: "resumed", now, from: ["PAUSED"], to: "ACTIVE", mutate: g => { if (!g.approval || g.approval.specSha256 !== g.specSha256 || g.spec.expiresAt <= now) throw new ProactiveConflictError("This goal's approval no longer holds."); } })
      : this.store.update("goal", id, { actor, reason: "cancelled", now, from: ["PROPOSED", "AWAITING_APPROVAL", "ACTIVE", "PAUSED", "NEEDS_ATTENTION"], to: "CANCELLED" });
    if (control === "cancel") this.store.dismissApprovals(id);
    this.changed(`Goal ${control}: ${r.record.spec.title}`);
    return this.goalView(r.record, r.version);
  }
  /** Owner links an existing task to a criterion. Only that task's completion receipts can ever meet it. */
  goalLink(id: string, criterionId: string, taskId: string, actor: unknown) {
    owner(actor, "Linking work to a goal");
    const task = this.deps.runtime.view(taskId);
    if (task.corrupt) throw new Error("That task's record is unreadable.");
    const now = this.now();
    const r = this.store.update("goal", id, { actor: WORKSTATION, reason: `task linked to ${criterionId}`, now, from: ["AWAITING_APPROVAL", "ACTIVE", "NEEDS_ATTENTION", "PAUSED"],
      mutate: g => {
        if (!g.spec.successCriteria.some(c => c.id === criterionId)) throw new ProactiveConflictError("That criterion is not part of this goal.");
        if (task.projectId !== g.projectId) throw new ProactiveConflictError("That task belongs to another project.");
        if (g.links.length >= g.spec.budget.maxTasks) throw new ProactiveConflictError("The goal used its task budget.");
        if (!g.links.some(l => l.taskId === taskId && l.criterionId === criterionId)) g.links.push({ criterionId, taskId, at: now });
      } });
    this.wake();
    return this.goalView(r.record, r.version);
  }

  // ── schedules ─────────────────────────────────────────────────────────────────────────────────────────────────────

  private validateSchedule(spec: ScheduleSpec, now: number): string[] {
    const problems: string[] = [];
    if (spec.expiresAt <= now) problems.push("The schedule's end date is already past.");
    if (spec.expiresAt > now + 365 * DAY) problems.push("A schedule lasts at most a year.");
    if (spec.trigger.type === "once" && nextSlot(spec.trigger, now) === null) problems.push("That time has already passed.");
    if (spec.trigger.type === "condition") {
      try { if (this.store.get("monitor", spec.trigger.monitorId).record.projectId !== spec.projectId) problems.push("The monitor belongs to another project."); }
      catch { problems.push("That monitor does not exist."); }
    }
    if (spec.goal) {
      try {
        const g = this.store.get("goal", spec.goal.id).record;
        if (g.projectId !== spec.projectId) problems.push("The goal belongs to another project.");
        if (!g.spec.successCriteria.some(c => c.id === spec.goal!.criterionId)) problems.push("That criterion is not part of the goal.");
        if (["COMPLETED", "FAILED", "CANCELLED", "EXPIRED"].includes(g.state)) problems.push(`The goal is ${g.state.toLowerCase()}.`);
        if (spec.action.type === "task" && g.spec.permittedActions.length) for (const c of spec.action.envelope.capabilities) if (!g.spec.permittedActions.includes(c)) problems.push(`The goal does not permit ${c}.`);
      } catch { problems.push("That goal does not exist."); }
    }
    if (spec.action.type === "remind" && containsSecret(spec.action.text)) problems.push("The reminder looks like it contains a credential.");
    if (spec.action.type === "task") {
      const { spec: template, envelope } = spec.action;
      problems.push(...validateTask({ ...template, deadlineAt: null }, envelope, this.deps.runtime.executorFacts(), now));
      if (envelope.expiresAt < Math.min(spec.expiresAt, now + DAY)) problems.push("The task's authorization ends before the schedule can run it.");
      for (const s of template.steps) for (const v of Object.values(s.input)) if (containsSecret(v)) problems.push(`Step ${s.id} input looks like a credential.`);
    }
    return problems;
  }
  scheduleCreate(raw: { spec: unknown; id?: string }, actor: unknown) {
    owner(actor, "Creating a schedule");
    const spec = ScheduleSpecSchema.parse(raw.spec), now = this.now(), problems = this.validateSchedule(spec, now);
    if (problems.length) throw new Error(`Schedule refused: ${problems.join(" ")}`);
    const id = raw.id ?? `sch-${randomUUID()}`;
    const record: ScheduleRecord = { schema: "ma4.schedule.v1", id, projectId: spec.projectId, spec, specSha256: specHash(spec), state: "AWAITING_APPROVAL", approval: null,
      cursor: now, nextAt: nextSlot(spec.trigger, now), retryAt: null, lastAttempt: null, lastFiredAt: null, createdAt: now, updatedAt: now };
    const r = this.store.insert("schedule", record, WORKSTATION, now, [this.note("approval_required", "schedule", id, spec.title, "Approve this schedule before it can run.", "AWAITING_APPROVAL", "approve", `${id}:approval:${record.specSha256.slice(0, 12)}`)]);
    this.changed(`Schedule proposed: ${spec.title}`);
    return this.scheduleView(r.record, r.version);
  }
  /** Approval binds this exact schedule (its hash), always ends, and covers only slots from now on. */
  scheduleApprove(id: string, actor: unknown, o: { expectVersion?: number; ttlMs?: number } = {}) {
    owner(actor, "Approving a schedule");
    const now = this.now(), ttl = Math.min(Math.max(o.ttlMs ?? MAX_APPROVAL_MS, HOUR), MAX_APPROVAL_MS);
    const r = this.store.update("schedule", id, { actor: WORKSTATION, reason: "approved by owner", now, from: ["AWAITING_APPROVAL"], to: "ACTIVE", expectVersion: o.expectVersion,
      mutate: s => {
        const problems = this.validateSchedule(s.spec, now);
        if (problems.length) throw new ProactiveConflictError(`Not approved: ${problems.join(" ")}`);
        s.approval = { by: "workstation", at: now, expiresAt: Math.min(now + ttl, s.spec.expiresAt), specSha256: s.specSha256 };
        s.cursor = Math.max(s.cursor, now); s.nextAt = nextSlot(s.spec.trigger, s.cursor); s.retryAt = null;
      } });
    this.store.dismissApprovals(id);
    this.changed(`Schedule approved: ${r.record.spec.title}`);
    return this.scheduleView(r.record, r.version);
  }
  /** Any change is a new authorization: the schedule waits for approval again. */
  scheduleUpdate(id: string, rawSpec: unknown, actor: unknown, o: { expectVersion?: number } = {}) {
    owner(actor, "Changing a schedule");
    const spec = ScheduleSpecSchema.parse(rawSpec), now = this.now(), problems = this.validateSchedule(spec, now);
    if (problems.length) throw new Error(`Schedule change refused: ${problems.join(" ")}`);
    const r = this.store.update("schedule", id, { actor: WORKSTATION, reason: "changed by owner; approval needed again", now, from: ["AWAITING_APPROVAL", "ACTIVE", "PAUSED"], to: "AWAITING_APPROVAL", expectVersion: o.expectVersion,
      mutate: s => { if (spec.projectId !== s.projectId) throw new ProactiveConflictError("A schedule cannot move to another project."); s.spec = spec; s.nextAt = nextSlot(spec.trigger, Math.max(s.cursor, now)); },
      notify: [this.note("approval_required", "schedule", id, spec.title, "The schedule changed; approve it again before it runs.", "AWAITING_APPROVAL", "approve", `${id}:approval:${specHash(spec).slice(0, 12)}`)] });
    this.changed(`Schedule changed: ${spec.title}`);
    return this.scheduleView(r.record, r.version);
  }
  scheduleControl(id: string, control: "pause" | "resume" | "cancel", actor: string) {
    const now = this.now();
    const r = control === "pause" ? this.store.update("schedule", id, { actor, reason: "paused", now, from: ["ACTIVE"], to: "PAUSED" })
      : control === "cancel" ? this.store.update("schedule", id, { actor, reason: "cancelled", now, from: ["AWAITING_APPROVAL", "ACTIVE", "PAUSED"], to: "CANCELLED", mutate: x => { x.nextAt = null; x.retryAt = null; } })
      // Resume never widens authority: a lapsed or mismatched approval sends it back to the owner. Paused slots are skipped.
      : (() => {
          const { record, version } = this.store.get("schedule", id);
          const live = !!record.approval && record.approval.expiresAt > now && record.approval.specSha256 === record.specSha256;
          return this.store.update("schedule", id, { actor, reason: live ? "resumed" : "resumed; its approval lapsed, so it waits for the owner", now, from: ["PAUSED"], expectVersion: version, to: live ? "ACTIVE" : "AWAITING_APPROVAL",
            mutate: s => { s.cursor = Math.max(s.cursor, now); s.nextAt = nextSlot(s.spec.trigger, s.cursor); s.retryAt = null; } });
        })();
    // Cancelling a schedule also stops the run it started (its processes are killed by the runtime); nothing new starts.
    if (control === "cancel") this.store.dismissApprovals(id);
    if (control === "cancel") for (const taskId of this.activeTaskIds(id)) try { this.deps.runtime.cancel(taskId, actor); } catch (e) { if (!(e instanceof TaskConflictError)) throw e; }
    this.changed(`Schedule ${control}: ${r.record.spec.title}`);
    return this.scheduleView(r.record, r.version);
  }

  // ── monitors ──────────────────────────────────────────────────────────────────────────────────────────────────────

  private validateMonitor(spec: MonitorSpec, now: number): string[] {
    const problems: string[] = [], policy = this.store.policy();
    if (spec.expiresAt <= now) problems.push("The monitor's end date is already past.");
    if (spec.expiresAt > now + 365 * DAY) problems.push("A monitor lasts at most a year.");
    if (spec.intervalMs < policy.minIntervalMs) problems.push(`Checks may run at most every ${Math.round(policy.minIntervalMs / 1000)} s.`);
    const src = spec.source;
    if (src.kind === "file") {
      if (!this.deps.roots?.get(src.root)) problems.push(`Folder "${src.root}" is not registered.`);
      try { relativeSegments(src.path); } catch (e) { problems.push(short(e)); }
    } else if (src.kind === "task") {
      const v = this.deps.runtime.view(src.taskId);
      if (v.corrupt) problems.push("That task's record is unreadable.");
      else if (v.projectId !== spec.projectId) problems.push("That task belongs to another project.");
    } else if (!this.deps.sources?.[src.name]) problems.push(`No approved source named "${src.name}" is registered on this Host.`);
    return problems;
  }
  monitorCreate(raw: { spec: unknown; id?: string }, actor: unknown) {
    owner(actor, "Creating a monitor");
    const spec = MonitorSpecSchema.parse(raw.spec), now = this.now(), problems = this.validateMonitor(spec, now);
    if (problems.length) throw new Error(`Monitor refused: ${problems.join(" ")}`);
    const id = raw.id ?? `mon-${randomUUID()}`;
    const record: MonitorRecord = { schema: "ma4.monitor.v1", id, projectId: spec.projectId, spec, specSha256: specHash(spec), state: "AWAITING_APPROVAL", approval: null, baseline: null, last: null,
      lastClass: null, lastCheckAt: null, nextCheckAt: now, errors: 0, lastNotifiedAt: null, changeSeq: 0, createdAt: now, updatedAt: now };
    const r = this.store.insert("monitor", record, WORKSTATION, now, [this.note("approval_required", "monitor", id, spec.title, "Approve this monitor before it reads anything.", "AWAITING_APPROVAL", "approve", `${id}:approval:${record.specSha256.slice(0, 12)}`)]);
    this.changed(`Monitor proposed: ${spec.title}`);
    return this.monitorView(r.record, r.version);
  }
  monitorApprove(id: string, actor: unknown, o: { expectVersion?: number; ttlMs?: number } = {}) {
    owner(actor, "Approving a monitor");
    const now = this.now(), ttl = Math.min(Math.max(o.ttlMs ?? MAX_APPROVAL_MS, HOUR), MAX_APPROVAL_MS);
    const active = this.store.list("monitor", ["ACTIVE"]).length, max = this.store.policy().maxActiveMonitors;
    if (active >= max) throw new Error(`At most ${max} monitors may be active; pause or disable one first.`);
    const r = this.store.update("monitor", id, { actor: WORKSTATION, reason: "approved by owner", now, from: ["AWAITING_APPROVAL"], to: "ACTIVE", expectVersion: o.expectVersion,
      mutate: m => {
        const problems = this.validateMonitor(m.spec, now);
        if (problems.length) throw new ProactiveConflictError(`Not approved: ${problems.join(" ")}`);
        m.approval = { by: "workstation", at: now, expiresAt: Math.min(now + ttl, m.spec.expiresAt), specSha256: m.specSha256 };
        // The first check after approval records the baseline; it is never announced as news.
        m.baseline = null; m.last = null; m.nextCheckAt = now; m.errors = 0;
      } });
    this.store.dismissApprovals(id);
    this.changed(`Monitor approved: ${r.record.spec.title}`);
    return this.monitorView(r.record, r.version);
  }
  /** Disable is the monitor's revocation: final, immediate, and it stops every schedule triggered by it. */
  monitorControl(id: string, control: "pause" | "resume" | "disable", actor: string) {
    const now = this.now();
    const r = control === "pause" ? this.store.update("monitor", id, { actor, reason: "paused", now, from: ["ACTIVE"], to: "PAUSED" })
      : control === "disable" ? this.store.update("monitor", id, { actor, reason: "disabled (authorization revoked)", now, from: ["AWAITING_APPROVAL", "ACTIVE", "PAUSED"], to: "DISABLED" })
      : (() => {
          const { record, version } = this.store.get("monitor", id);
          const live = !!record.approval && record.approval.expiresAt > now && record.approval.specSha256 === record.specSha256;
          return this.store.update("monitor", id, { actor, reason: live ? "resumed" : "resumed; its approval lapsed, so it waits for the owner", now, from: ["PAUSED"], expectVersion: version, to: live ? "ACTIVE" : "AWAITING_APPROVAL", mutate: m => { m.nextCheckAt = now; } });
        })();
    if (control === "disable") this.store.dismissApprovals(id);
    this.changed(`Monitor ${control}: ${r.record.spec.title}`);
    return this.monitorView(r.record, r.version);
  }

  // ── previews (MA4-S2-T3R): what the owner is about to approve, from the same validation the Host enforces ──────────

  /** One plain sentence per step, from the Host's own facts (registered folders, pins), never from the model. */
  private describeStep(step: { kind: string; input: Record<string, string | number | boolean | null>; model: string | null }) {
    const root = typeof step.input.root === "string" ? this.deps.roots?.get(step.input.root)?.label ?? step.input.root : null, path = typeof step.input.path === "string" ? step.input.path : null;
    const where = root ? `${path ? `${path} in ` : ""}folder "${root}"` : "";
    const facts = this.deps.runtime.executorFacts().get(step.kind);
    if (step.kind === "file.read") return `Read ${where}`;
    if (step.kind === "file.stat") return `Check the size and date of ${where}`;
    if (step.kind.startsWith("file.")) return `${step.kind.slice(5)} files in ${where}`;
    if (step.kind === "local.generate") return `Write text with the local model ${step.model} (Worker)`;
    if (step.kind === "local.review") return `Check that result with the local model ${step.model} (Reviewer)`;
    return `${step.kind}${facts?.consequential ? " (needs your approval each time)" : ""}`;
  }
  private issues(error: { issues: { path: PropertyKey[]; message: string }[] }, what: string) {
    return error.issues.map(i => `${i.path.map(String).join(".") || what}: ${i.message}`).slice(0, 8);
  }
  /** Workstation-only, changes nothing: the next runs, what each run does and reads, model use, approvals, expiry. */
  previewSchedule(raw: unknown, actor: unknown) {
    owner(actor, "Previewing a schedule");
    const parsed = ScheduleSpecSchema.safeParse(raw), now = this.now();
    if (!parsed.success) return { ok: false as const, problems: this.issues(parsed.error, "schedule") };
    const spec = parsed.data, problems = this.validateSchedule(spec, now), next: { at: number; note: string | null }[] = [];
    for (let t = nextSlot(spec.trigger, now); t !== null && next.length < 3 && t <= spec.expiresAt; t = nextSlot(spec.trigger, t)) next.push({ at: t, note: slotNote(spec.trigger, t) });
    const facts = this.deps.runtime.executorFacts(), task = spec.action.type === "task" ? spec.action : null;
    const steps = task?.spec.steps ?? [], gpu = steps.filter(x => facts.get(x.kind)?.gpu), consequential = steps.filter(x => facts.get(x.kind)?.consequential);
    return {
      ok: problems.length === 0, problems, trigger: this.triggerText(spec.trigger), next,
      willDo: task ? steps.map(x => this.describeStep(x)) : [`Show the reminder: "${sanitize(spec.action.type === "remind" ? spec.action.text : "", 200)}"`],
      reads: (task?.envelope.grants?.files ?? []).map(f => `Folder "${this.deps.roots?.get(f.root)?.label ?? f.root}" (${f.access})`),
      model: { runs: gpu.length > 0, calls: gpu.length, models: [...new Set(gpu.flatMap(x => x.model ? [x.model] : []))] },
      approvals: consequential.map(x => `${this.describeStep(x)}: each time, in the Approval Center`),
      background: task ? task.envelope.background : false, missedPolicy: spec.missedPolicy, graceMs: spec.graceMs, maxRunsPerDay: spec.maxRunsPerDay,
      budget: task ? task.envelope.budgets : null, expiresAt: spec.expiresAt, approvalUntil: Math.min(now + MAX_APPROVAL_MS, spec.expiresAt),
    };
  }
  previewMonitor(raw: unknown, actor: unknown) {
    owner(actor, "Previewing a monitor");
    const parsed = MonitorSpecSchema.safeParse(raw), now = this.now();
    if (!parsed.success) return { ok: false as const, problems: this.issues(parsed.error, "monitor") };
    const spec = parsed.data, problems = this.validateMonitor(spec, now), src = spec.source, p = spec.predicate;
    const reads = src.kind === "file" ? `${src.field ? `the "${src.field}" field of ` : "the first line of "}${src.path} in folder "${this.deps.roots?.get(src.root)?.label ?? src.root}"` : src.kind === "task" ? "the state of one of your tasks" : `the registered source "${src.name}"`;
    const condition = p.type === "changed" ? "whenever it changes" : p.type === "equals" ? `when it becomes "${p.value}"` : `when it changes${p.from !== undefined ? ` from "${p.from}"` : ""} to "${p.to}"`;
    const interval = Math.max(spec.intervalMs, this.store.policy().minIntervalMs);
    return { ok: problems.length === 0, problems, reads, condition, everyMs: interval, checksPerHour: Math.min(spec.maxChecksPerHour, Math.floor(3_600_000 / interval)), model: { runs: false },
      notify: spec.notify, dedupMs: spec.dedupMs, expiresAt: spec.expiresAt, approvalUntil: Math.min(now + MAX_APPROVAL_MS, spec.expiresAt), baseline: "The first check after approval only records the current value." };
  }
  previewGoal(raw: unknown, actor: unknown) {
    owner(actor, "Previewing a goal");
    const parsed = GoalSpecSchema.safeParse(raw), now = this.now();
    if (!parsed.success) return { ok: false as const, problems: this.issues(parsed.error, "goal") };
    const spec = parsed.data, problems: string[] = [];
    if (spec.expiresAt <= now) problems.push("The goal's end date is already past.");
    if (spec.deadlineAt !== null && spec.deadlineAt > spec.expiresAt) problems.push("The deadline lies beyond the goal's end date.");
    if ([spec.title, spec.description, ...spec.successCriteria.map(c => c.description)].some(containsSecret)) problems.push("The goal text looks like it contains a credential.");
    return { ok: problems.length === 0, problems, criteria: spec.successCriteria.length, permittedActions: spec.permittedActions, maxTasks: spec.budget.maxTasks, deadlineAt: spec.deadlineAt, expiresAt: spec.expiresAt,
      progressRule: "A criterion counts as met only when a linked task completes with verified step receipts.", activation: "Nothing happens until you approve it; it then only tracks work you link or schedule." };
  }
  /** The schedule and goal a task belongs to, for the Approval Center (titles only). */
  taskContext(taskId: string): { schedule: string | null; goal: string | null } {
    const o = this.store.occurrenceOfTask(taskId);
    let schedule: string | null = null, goal: string | null = null;
    if (o) try { const s = this.store.get("schedule", o.scheduleId).record; schedule = sanitize(s.spec.title, 120); if (s.spec.goal) goal = sanitize(this.store.get("goal", s.spec.goal.id).record.spec.title, 120); } catch { /* unreadable: no context */ }
    if (!goal) for (const g of this.store.list("goal")) if (g.ok && g.record.links.some(l => l.taskId === taskId)) { goal = sanitize(g.record.spec.title, 120); break; }
    return { schedule, goal };
  }

  // ── notifications, preferences and policy ─────────────────────────────────────────────────────────────────────────

  dismiss(key: string) { const ok = this.store.dismiss(key); if (ok) this.changed("Notification dismissed"); return { dismissed: ok }; }
  snooze(key: string, minutes: number) {
    const m = Math.min(Math.max(Math.round(minutes), 5), 24 * 60), ok = this.store.snooze(key, this.now() + m * MINUTE);
    if (ok) this.changed("Notification snoozed");
    this.wake();
    return { snoozed: ok, minutes: m };
  }
  setPrefs(raw: unknown, actor: unknown) { owner(actor, "Notification settings"); const p = this.store.setPrefs(raw); this.changed("Notification settings changed"); return p; }
  setPolicy(raw: unknown, actor: unknown) { owner(actor, "Proactive limits"); const p = this.store.setPolicy(raw); this.changed("Proactive limits changed"); this.wake(); return p; }
  awayAck() { this.store.setAwayMarker(this.now()); this.changed("Away summary read"); return { ok: true }; }

  private note(category: NotificationCategory, sourceKind: NewNotification["sourceKind"], sourceId: string, title: string, reason: string, verifiedState: string, action: string, key: string, priority: NewNotification["priority"] = "normal"): NewNotification {
    return { key: `${category}:${key}`, category, sourceKind, sourceId, title, reason, verifiedState, action, priority };
  }
  private changed(detail: string) { this.emit("proactive.changed", detail); }

  // ── lifecycle ─────────────────────────────────────────────────────────────────────────────────────────────────────

  /** Host start: an honest record of the time it was not running, then the first tick. Nothing is replayed for that time. */
  async start() {
    const now = this.now(), beat = this.store.heartbeat();
    if (beat !== null && now - beat > 3 * this.maxSleep) { this.store.gap(beat, now, "off"); this.emit("proactive.host_gap", `Bunny-A was not running for ${duration(now - beat)}; nothing ran during that time.`); }
    if (this.store.awayMarker() === null) this.store.setAwayMarker(now);
    this.store.prune(now);
    this.lastTick = now;
    await this.tick();
  }
  async close() {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    await this.running?.catch(() => undefined);
  }
  wake() {
    if (this.closed || this.deps.timers === false) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = null; void this.tick().catch(e => this.emit("proactive.error", short(e))); }, 0);
    this.timer.unref?.();
  }
  /** One pass. Re-entrant calls wait for the running pass and then run once more. */
  async tick(): Promise<void> {
    if (this.closed) return;
    if (this.running) { this.again = true; return this.running; }
    this.running = (async () => {
      do { this.again = false; await this.pass(); } while (this.again && !this.closed);
    })().finally(() => { this.running = null; this.arm(); });
    return this.running;
  }
  private arm() {
    if (this.closed || this.deps.timers === false) return;
    const now = this.now(), next = Math.max(50, Math.min(this.nextDue(now) - now, this.maxSleep));
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = null; void this.tick().catch(e => this.emit("proactive.error", short(e))); }, next);
    this.timer.unref?.();
  }
  /** The earliest instant anything is due; idle Hosts sleep until then (capped by maxSleepMs). */
  nextDue(now: number): number {
    let due = now + this.maxSleep;
    for (const s of this.store.list("schedule", ["ACTIVE"])) if (s.ok) { const t = s.record.retryAt ?? s.record.nextAt; if (t !== null) due = Math.min(due, t); }
    for (const m of this.store.list("monitor", ["ACTIVE"])) if (m.ok) due = Math.min(due, m.record.nextCheckAt);
    const d = this.store.nextDelivery(now);
    return d === null ? due : Math.min(due, d);
  }

  private async pass() {
    const now = this.now();
    // A tick far later than the longest sleep means the machine slept: recorded, and no work is claimed for it.
    if (this.lastTick && now - this.lastTick > 3 * this.maxSleep + 5_000) this.store.gap(this.lastTick, now, "asleep");
    this.lastTick = now;
    this.store.beat(now);
    if (this.deps.runtime.readOnly) return;
    for (const step of [() => this.settleOccurrences(now), () => this.trackGoals(now), () => this.runSchedules(now), () => this.checkMonitors(now)]) {
      try { await step(); } catch (e) { if (!(e instanceof ProactiveConflictError)) this.emit("proactive.error", short(e)); }
    }
    for (const n of this.store.deliverDue(this.now())) this.emit("proactive.notification", `${n.category}: ${n.title} — ${n.reason}`);
  }

  // ── schedules: firing ─────────────────────────────────────────────────────────────────────────────────────────────

  private async runSchedules(now: number) {
    for (const row of this.store.list("schedule", ["ACTIVE"])) {
      if (!row.ok) continue;
      try { await this.runSchedule(row.record, row.version, now); }
      catch (e) { if (!(e instanceof ProactiveConflictError)) this.emit("proactive.error", short(e)); }
    }
  }
  private async runSchedule(s: ScheduleRecord, version: number, now: number) {
    if (s.spec.expiresAt <= now) return this.endSchedule(s, version, now, "EXPIRED", "The schedule reached its end date.");
    if (!s.approval || s.approval.expiresAt <= now || s.approval.specSha256 !== s.specSha256)
      return void this.store.update("schedule", s.id, { actor: "proactive", reason: "approval lapsed", now, expectVersion: version, to: "AWAITING_APPROVAL",
        notify: [this.note("permission_expired", "schedule", s.id, s.spec.title, "Its approval ended. Approve it again to keep it running.", "AWAITING_APPROVAL", "approve", `${s.id}:approval-ended:${s.approval?.at ?? 0}`)] });
    if (s.spec.trigger.type === "condition") return;
    const pending = slotsBetween(s.spec.trigger, s.cursor, now);
    if (!pending.length) {
      const next = nextSlot(s.spec.trigger, s.cursor);
      if (next === null) return this.endSchedule(s, version, now, "COMPLETED", "Its one-time run is done.");
      if (next !== s.nextAt) this.store.update("schedule", s.id, { actor: "proactive", reason: "next run", now, expectVersion: version, mutate: x => { x.nextAt = next; } });
      return;
    }
    if (s.retryAt !== null && s.retryAt > now) return;
    const latest = pending[pending.length - 1], earlier = pending.slice(0, -1);
    let v = version;
    // Never all of them: earlier slots are recorded as missed with one notification, and only the latest is considered.
    if (earlier.length) v = this.missed(s, v, now, earlier[earlier.length - 1], earlier.length, "while Bunny-A was not running or the PC was asleep");
    const late = now - latest;
    // A slot that waited on a transient reason (model, window, previous run) and outlived its grace keeps that reason.
    const waited = s.lastAttempt?.slot === latest && s.lastAttempt.outcome === "defer" ? s.lastAttempt.reason : null;
    if (late > s.spec.graceMs && (waited || s.spec.missedPolicy === "skip"))
      return void this.missed(s, v, now, latest, 1, waited ? `because ${waited.replace(/\.$/, "").replace(/^./, c => c.toLowerCase())} for its whole ${duration(s.spec.graceMs)} grace period` : `it was due ${duration(late)} ago, beyond its ${duration(s.spec.graceMs)} grace period`, waited ? "defer" : "missed");
    await this.fire(this.store.get("schedule", s.id).record, v, latest, `${s.id}:${latest}`, "meaningful", now);
  }
  private missed(s: ScheduleRecord, version: number, now: number, slot: number, count: number, why: string, outcome: "missed" | "defer" = "missed"): number {
    const r = this.store.update("schedule", s.id, { actor: "proactive", reason: `${count} run(s) missed`, now, expectVersion: version, to: nextSlot(s.spec.trigger, slot) === null ? "COMPLETED" : undefined,
      mutate: x => { x.cursor = slot; x.nextAt = nextSlot(x.spec.trigger, slot); x.retryAt = null; x.lastAttempt = { at: now, slot, outcome, reason: `Missed ${why}.`, taskId: null }; },
      occurrence: { key: `${s.id}:${slot}`, scheduleId: s.id, slot, outcome, reason: `${count} run(s) missed ${why}`, taskId: null, modelSteps: 0 },
      notify: [this.note("schedule_missed", "schedule", s.id, s.spec.title, `${count === 1 ? "A run was" : `${count} runs were`} missed ${why}. Nothing ran for ${count === 1 ? "it" : "them"}.`, "MISSED", "open", `${s.id}:${slot}`)] });
    return r.version;
  }
  private endSchedule(s: ScheduleRecord, version: number, now: number, to: "EXPIRED" | "COMPLETED", why: string) {
    this.store.update("schedule", s.id, { actor: "proactive", reason: why, now, expectVersion: version, to, mutate: x => { x.nextAt = null; },
      notify: to === "EXPIRED" ? [this.note("permission_expired", "schedule", s.id, s.spec.title, why, to, "open", `${s.id}:ended`)] : [] });
  }

  private modelSteps(s: ScheduleRecord) {
    if (s.spec.action.type !== "task") return { steps: 0, models: [] as string[] };
    const facts = this.deps.runtime.executorFacts(), gpu = s.spec.action.spec.steps.filter(x => facts.get(x.kind)?.gpu);
    return { steps: gpu.length, models: [...new Set(gpu.flatMap(x => x.model ? [x.model] : []))] };
  }
  private activeTaskIds(scheduleId?: string): string[] {
    return this.store.openOccurrences().filter(o => o.taskId && (!scheduleId || o.scheduleId === scheduleId)).flatMap(o => {
      const v = this.deps.runtime.view(o.taskId!);
      return v.corrupt || !TERMINAL_TASK_STATES.includes(v.state) ? [o.taskId!] : [];
    });
  }
  /** Trusted facts for decide(), all read from the Host's own records at this instant. */
  async facts(s: ScheduleRecord, now: number, change: ChangeClass): Promise<DecisionFacts> {
    const goalRow = s.spec.goal ? (() => { try { return this.store.get("goal", s.spec.goal!.id).record; } catch { return null; } })() : null;
    const { steps, models } = this.modelSteps(s), policy = this.store.policy();
    const envelope = s.spec.action.type === "task" ? s.spec.action.envelope : null;
    let modelsAvailable = true;
    if (steps) for (const m of models) if (!(await this.deps.modelAvailable(m).catch(() => false))) modelsAvailable = false;
    return {
      now, intact: true, state: s.state, specSha256: s.specSha256, approval: s.approval, expiresAt: s.spec.expiresAt, envelopeExpiresAt: envelope?.expiresAt ?? null,
      goal: s.spec.goal ? (goalRow ? { state: goalRow.state, tasksUsed: goalRow.links.length, maxTasks: goalRow.spec.budget.maxTasks } : { state: "CANCELLED", tasksUsed: 0, maxTasks: 0 }) : null,
      change, action: s.spec.action.type, overlapping: this.activeTaskIds(s.id).length > 0,
      runsToday: this.store.runsSince(s.id, now - DAY), maxRunsPerDay: s.spec.maxRunsPerDay,
      proactiveEnabled: policy.enabled, activeTasks: this.activeTaskIds().length, maxConcurrentTasks: policy.maxConcurrentTasks,
      modelCallsToday: this.store.modelStepsSince(now - DAY), maxModelCallsPerDay: policy.maxModelCallsPerDay, modelSteps: steps, modelsAvailable,
      mayRunUnattended: this.deps.uiAttached() || (this.deps.runtime.store.policy().background && !!envelope?.background),
      approvalLive: true,
    };
  }
  /** Decides one trigger and records the decision and its occurrence atomically; then (only then) creates the task. */
  private async fire(s: ScheduleRecord, version: number, slot: number, key: string, change: ChangeClass, now: number) {
    if (this.store.occurrence(key)) return; // already decided, by this Host or another
    const facts = await this.facts(s, now, change), d = decide(facts), time = s.spec.trigger.type !== "condition";
    const taskId = s.spec.action.type === "task" ? `ptask-${s.id.slice(0, 44)}-${key.slice(s.id.length + 1)}`.slice(0, 80) : null;
    // One transaction: the schedule's cursor, the occurrence (the duplicate guard) and its notification.
    const record = (outcome: Outcome, o: { to?: string; fired?: boolean } = {}, notify: NewNotification[] = []) => {
      const created = outcome === "execute" || outcome === "queue";
      // A one-time schedule is done the moment its only slot is decided.
      const done = time && nextSlot(s.spec.trigger, slot) === null ? "COMPLETED" : undefined;
      this.store.update("schedule", s.id, { actor: "proactive", reason: `${outcome}: ${d.reason}`, now, expectVersion: version, to: o.to ?? done, notify,
        mutate: x => {
          if (time) { x.cursor = slot; x.nextAt = nextSlot(x.spec.trigger, slot); }
          if (o.fired) x.lastFiredAt = now;
          x.retryAt = null; x.lastAttempt = { at: now, slot, outcome, reason: d.reason, taskId: created ? taskId : null };
        },
        occurrence: { key, scheduleId: s.id, slot, outcome, reason: d.reason, taskId: created ? taskId : null, modelSteps: created ? facts.modelSteps : 0 } });
    };
    switch (d.outcome) {
      case "execute": case "queue": {
        if (time) this.lateness.push(now - slot);
        record(d.outcome, { fired: true });
        if (this.deps.faults) try { this.deps.faults("after-decision", key); } catch (e) { this.closed = true; throw e; }
        await this.dispatch(this.store.occurrence(key)!, s, now);
        return;
      }
      case "notify": {
        if (time) this.lateness.push(now - slot);
        const text = s.spec.action.type === "remind" ? s.spec.action.text : s.spec.title;
        record("notify", { fired: true }, [this.note("reminder_due", "schedule", s.id, s.spec.title, text, "DUE", "open", key, "high")]);
        return;
      }
      case "record_no_change": return;
      case "request_approval":
        record("request_approval", { to: "AWAITING_APPROVAL" }, [this.note("approval_required", "schedule", s.id, s.spec.title, `${d.reason} Approve it again before it runs.`, "AWAITING_APPROVAL", "approve", `${s.id}:approval:${s.specSha256.slice(0, 12)}:${s.approval?.at ?? 0}`)]);
        return;
      case "stop_expired":
        record("stop_expired", { to: "EXPIRED" }, [this.note("permission_expired", "schedule", s.id, s.spec.title, d.reason, "EXPIRED", "open", `${s.id}:ended`)]);
        return;
      case "defer": {
        // Transient reasons wait inside the grace period and are retried; otherwise the slot is spent and reported.
        if (d.transient && time && now - slot < s.spec.graceMs)
          return void this.store.update("schedule", s.id, { actor: "proactive", reason: `deferred: ${d.reason}`, now, expectVersion: version, mutate: x => { x.retryAt = now + MINUTE; x.lastAttempt = { at: now, slot, outcome: "defer", reason: d.reason, taskId: null }; } });
        record("defer", {}, [this.note("schedule_missed", "schedule", s.id, s.spec.title, `Skipped: ${d.reason}`, "SKIPPED", "open", key, "low")]);
        return;
      }
      case "fail_safe":
        record("fail_safe", {}, [this.note("recovery_blocked", "schedule", s.id, s.spec.title, d.reason, "BLOCKED", "open", key)]);
        return;
    }
  }
  /** Creates the occurrence's task under its deterministic id (a second attempt finds it and creates nothing). */
  private async dispatch(o: Occurrence, s: ScheduleRecord, now: number) {
    if (s.spec.action.type !== "task" || !o.taskId) return;
    const { spec: template, envelope } = s.spec.action, rt = this.deps.runtime;
    const deadlineAt = Math.min(Math.max(o.slot, now) + s.spec.runWindowMs, envelope.expiresAt);
    let view = rt.view(o.taskId);
    if (view.corrupt && /does not exist/.test(view.detail)) {
      try { view = rt.create({ id: o.taskId, spec: { ...template, deadlineAt }, envelope }, WORKSTATION); }
      catch (e) {
        if (!(e instanceof TaskConflictError)) {
          this.store.recordOutcome(o.key, "fail_safe", `The task was refused: ${short(e)}`);
          this.store.notify([this.note("task_failed", "schedule", s.id, s.spec.title, `The scheduled task was refused: ${short(e)}`, "FAILED", "open", `${o.key}:refused`)], this.now());
          return;
        }
        view = rt.view(o.taskId);
      }
    }
    if (!view.corrupt && view.state === "AWAITING_APPROVAL" && !view.pendingAction && s.approval)
      try { rt.approveScheduled(o.taskId, s.id, Math.min(s.spec.runWindowMs, s.approval.expiresAt - now)); } catch (e) { if (!(e instanceof TaskConflictError)) throw e; }
    if (s.spec.goal) try {
      this.store.update("goal", s.spec.goal.id, { actor: "proactive", reason: `scheduled task linked to ${s.spec.goal.criterionId}`, now, from: ["ACTIVE", "NEEDS_ATTENTION", "PAUSED"],
        mutate: g => { if (!g.links.some(l => l.taskId === o.taskId)) g.links.push({ criterionId: s.spec.goal!.criterionId, taskId: o.taskId!, at: now }); } });
    } catch (e) { if (!(e instanceof ProactiveConflictError)) throw e; }
    this.store.markDispatched(o.key);
    this.emit("proactive.dispatched", `${s.spec.title}: task created`);
  }

  // ── occurrences: watching the tasks they created ──────────────────────────────────────────────────────────────────

  private async settleOccurrences(now: number) {
    for (const o of this.store.openOccurrences()) {
      if (!o.taskId) continue;
      let s: ScheduleRecord;
      try { s = this.store.get("schedule", o.scheduleId).record; } catch { this.store.recordOutcome(o.key, "fail_safe", "Its schedule record is unreadable."); continue; }
      if (!o.dispatched) {
        // The Host stopped between recording the decision and creating the task. Within the grace period the same
        // deterministic task id is created now (once); later, the run is recorded as missed — never replayed blindly.
        const exists = !(this.deps.runtime.view(o.taskId).corrupt);
        if (exists || now - o.at <= s.spec.graceMs) await this.dispatch(o, s, now);
        else { this.store.recordOutcome(o.key, "missed", "Bunny-A stopped before the task was created; it was not run later."); this.store.notify([this.note("schedule_missed", "schedule", s.id, s.spec.title, "Bunny-A stopped before this run started; it was not run later.", "MISSED", "open", o.key)], now); }
        continue;
      }
      const v = this.deps.runtime.view(o.taskId);
      if (v.corrupt) { this.store.settle(o.key, [this.note("recovery_blocked", "task", o.taskId, s.spec.title, "The scheduled task's record is unreadable; review it on the PC.", "BLOCKED", "open", `${o.key}:corrupt`)], now); continue; }
      const t = v as TaskView;
      if (t.state === "COMPLETED") this.store.settle(o.key, s.spec.notify.completed ? [this.note("task_completed", "task", t.id, s.spec.title, `Completed with ${t.evidence.length} verified step receipt${t.evidence.length === 1 ? "" : "s"}.`, "COMPLETED", "open", o.key, "low")] : [], now);
      else if (t.state === "FAILED" || t.state === "CANCELLED") this.store.settle(o.key, t.state === "FAILED" && s.spec.notify.failed ? [this.note("task_failed", "task", t.id, s.spec.title, t.failure?.detail ?? "The task failed.", "FAILED", "open", o.key, "high")] : [], now);
      else if (t.state === "AWAITING_APPROVAL" && t.pendingAction) this.store.notify([this.note("approval_required", "task", t.id, s.spec.title, `Waiting for your permission on the PC: ${t.pendingAction.summary}`, "AWAITING_APPROVAL", "approve", `${t.id}:${t.pendingAction.actionId}`, "high")], now);
      else if (t.state === "UNCERTAIN") this.store.notify([this.note("recovery_blocked", "task", t.id, s.spec.title, "An action may or may not have happened; decide on the PC before anything continues.", "UNCERTAIN", "reconcile", `${t.id}:${t.uncertainOperation ?? "uncertain"}`, "high")], now);
      else if (t.state === "PAUSED" && t.blocked && t.blocked.code !== "OWNER_PAUSED") this.store.notify([this.note("recovery_blocked", "task", t.id, s.spec.title, t.blocked.detail, "PAUSED", "resume", `${t.id}:${t.blocked.code}`)], now);
    }
  }

  // ── goals: progress only from receipts ────────────────────────────────────────────────────────────────────────────

  private trackGoals(now: number) {
    for (const row of this.store.list("goal", ["ACTIVE", "NEEDS_ATTENTION", "PAUSED", "AWAITING_APPROVAL"])) {
      if (!row.ok) continue;
      const g = row.record;
      if (g.spec.expiresAt <= now) { this.store.update("goal", g.id, { actor: "proactive", reason: "goal ended", now, expectVersion: row.version, to: "EXPIRED", notify: [this.note("permission_expired", "goal", g.id, g.spec.title, "The goal reached its end date.", "EXPIRED", "open", `${g.id}:ended`)] }); continue; }
      if (g.state === "AWAITING_APPROVAL") continue;
      const met = new Map(g.met.map(m => [m.criterionId, m]));
      const fresh: typeof g.met = [];
      let attention: string | null = null;
      for (const link of g.links) {
        if (met.has(link.criterionId)) continue;
        const v = this.deps.runtime.view(link.taskId);
        if (v.corrupt) { attention = "A linked task's record is unreadable."; continue; }
        // Only a COMPLETED task with step receipts meets a criterion; its evidence hashes are kept with the goal.
        if (v.state === "COMPLETED" && v.evidence.length) { const m = { criterionId: link.criterionId, taskId: v.id, evidence: v.evidence.map(e => e.outputSha256), at: now }; met.set(link.criterionId, m); fresh.push(m); }
        else if ((v.state === "FAILED" || v.state === "CANCELLED") && !g.links.some(l => l.criterionId === link.criterionId && l.taskId !== link.taskId && (() => { const x = this.deps.runtime.view(l.taskId); return !x.corrupt && !TERMINAL_TASK_STATES.includes(x.state); })()))
          attention = `Work for "${g.spec.successCriteria.find(c => c.id === link.criterionId)?.description ?? link.criterionId}" ${v.state === "FAILED" ? "failed" : "was cancelled"}.`;
      }
      const done = g.spec.successCriteria.every(c => met.has(c.id));
      if (!attention && !done && g.spec.deadlineAt !== null && g.spec.deadlineAt <= now) attention = "The goal's deadline passed before every criterion was met.";
      const to = g.state === "PAUSED" ? undefined : done ? "COMPLETED" : attention ? "NEEDS_ATTENTION" : g.state === "NEEDS_ATTENTION" ? "ACTIVE" : undefined;
      if (!fresh.length && to === undefined && attention === g.attention) continue;
      const notify = [
        ...(g.spec.notify.milestones ? fresh.map(m => this.note("goal_milestone", "goal", g.id, g.spec.title, `Criterion met: ${g.spec.successCriteria.find(c => c.id === m.criterionId)?.description ?? m.criterionId} (${met.size} of ${g.spec.successCriteria.length}).`, "MET", "open", `${g.id}:met:${m.criterionId}`)) : []),
        ...(to === "COMPLETED" ? [this.note("goal_milestone", "goal", g.id, g.spec.title, "Every success criterion is met by completed, receipted work.", "COMPLETED", "open", `${g.id}:completed`, "high")] : []),
      ];
      this.store.update("goal", g.id, { actor: "proactive", reason: to === "COMPLETED" ? "all criteria met by receipts" : fresh.length ? "criterion met by receipts" : attention ?? "attention cleared", now, expectVersion: row.version, to,
        mutate: x => { x.met = [...met.values()]; x.attention = done ? null : attention; }, notify });
    }
  }

  // ── monitors ──────────────────────────────────────────────────────────────────────────────────────────────────────

  private async checkMonitors(now: number) {
    const policy = this.store.policy();
    for (const row of this.store.list("monitor", ["ACTIVE"])) {
      if (!row.ok || row.record.nextCheckAt > now) continue;
      const m = row.record;
      if (m.spec.expiresAt <= now) { this.store.update("monitor", m.id, { actor: "proactive", reason: "monitor ended", now, expectVersion: row.version, to: "EXPIRED", notify: [this.note("permission_expired", "monitor", m.id, m.spec.title, "The monitor reached its end date; it no longer reads anything.", "EXPIRED", "open", `${m.id}:ended`)] }); continue; }
      if (!m.approval || m.approval.expiresAt <= now || m.approval.specSha256 !== m.specSha256) { this.store.update("monitor", m.id, { actor: "proactive", reason: "approval lapsed", now, expectVersion: row.version, to: "AWAITING_APPROVAL", notify: [this.note("permission_expired", "monitor", m.id, m.spec.title, "Its approval ended. It reads nothing until you approve it again.", "AWAITING_APPROVAL", "approve", `${m.id}:approval-ended:${m.approval?.at ?? 0}`)] }); continue; }
      const interval = Math.max(m.spec.intervalMs, policy.minIntervalMs);
      if (!policy.enabled || this.store.checksSince(m.id, now - HOUR) >= m.spec.maxChecksPerHour) { this.store.update("monitor", m.id, { actor: "proactive", reason: policy.enabled ? "check budget for this hour used" : "proactive work is off", now, expectVersion: row.version, mutate: x => { x.nextCheckAt = now + interval; } }); continue; }
      const obs = await this.observe(m.spec, m.projectId);
      const at = this.now(), cls = classify(m.last, obs, m.spec.predicate);
      const seq = this.store.observe(m.id, at, cls, obs.ok ? { value: obs.value, sha256: obs.sha256 } : null);
      const errored = !obs.ok, errors = errored ? m.errors + 1 : 0;
      const notify: NewNotification[] = [];
      if (cls === "meaningful" && m.spec.notify && (m.lastNotifiedAt === null || at - m.lastNotifiedAt >= m.spec.dedupMs))
        notify.push(this.note("source_changed", "monitor", m.id, m.spec.title, obs.ok ? `${m.spec.label}: now "${sanitize(obs.value, 60)}".` : m.spec.label, "CHANGED", "open", `${m.id}:change:${m.changeSeq + 1}`, m.spec.priority));
      if (errored && errors === 3 && cls !== "permission_expired") notify.push(this.note("recovery_blocked", "monitor", m.id, m.spec.title, `${m.spec.label} could not be read 3 times in a row; checks slow down until it can.`, "UNREADABLE", "open", `${m.id}:errors:${seq}`));
      if (cls === "permission_expired") notify.push(this.note("permission_expired", "monitor", m.id, m.spec.title, "Its source is no longer authorized; the monitor stopped.", "EXPIRED", "open", `${m.id}:source-revoked`, "high"));
      let updated;
      try {
        updated = this.store.update("monitor", m.id, { actor: "proactive", reason: `check: ${cls}`, now: at, expectVersion: row.version, to: cls === "permission_expired" ? "EXPIRED" : undefined, notify,
          mutate: x => {
            x.lastCheckAt = at; x.lastClass = cls; x.errors = errors;
            // Exponential backoff after source errors, capped at an hour.
            x.nextCheckAt = at + (errored ? Math.min(interval * 2 ** Math.min(errors, 6), HOUR) : interval);
            if (obs.ok) { x.last = { value: obs.value, sha256: obs.sha256, at }; x.baseline ??= { value: obs.value, sha256: obs.sha256, at }; }
            if (cls === "meaningful") { x.changeSeq += 1; if (notify.some(n => n.category === "source_changed")) x.lastNotifiedAt = at; }
          } });
      } catch (e) { if (e instanceof ProactiveConflictError) continue; throw e; }
      if (cls !== "meaningful") continue;
      for (const sr of this.store.list("schedule", ["ACTIVE"])) {
        if (!sr.ok || sr.record.spec.trigger.type !== "condition" || sr.record.spec.trigger.monitorId !== m.id || sr.record.projectId !== updated.record.projectId) continue;
        const s = sr.record;
        if (s.lastFiredAt !== null && at - s.lastFiredAt < s.spec.minGapMs) {
          this.store.update("schedule", s.id, { actor: "proactive", reason: "too soon after the last run", now: at, expectVersion: sr.version, occurrence: { key: `${s.id}:o${seq}`, scheduleId: s.id, slot: at, outcome: "defer", reason: "Too soon after the last run.", taskId: null, modelSteps: 0 } });
          continue;
        }
        await this.fire(s, sr.version, at, `${s.id}:o${seq}`, cls, at);
      }
    }
  }
  /** Reads one approved source. Deterministic, model-free; the value is recomputed and hashed here, never trusted as given. */
  async observe(spec: MonitorSpec, projectId: string): Promise<Observation> {
    const src = spec.source;
    if (src.kind === "file") {
      const root = this.deps.roots?.get(src.root);
      if (!root) return { ok: false, reason: "permission", detail: `Folder "${src.root}" is no longer registered.` };
      try {
        const a = readText(walk(root, src.path)), b = readText(walk(root, src.path));
        // Two reads disagree: the file is being written. Nothing is concluded from a half-written file.
        if (a.sha256 !== b.sha256) return { ok: false, reason: "uncertain", detail: "The file changed while it was read." };
        if (!src.field) return observation(a.text.split(/\r?\n/).find(l => l.trim()) ?? "", a.sha256);
        let parsed: unknown;
        try { parsed = JSON.parse(a.text); } catch { return { ok: false, reason: "invalid", detail: "The file is not valid JSON." }; }
        const value = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>)[src.field] : undefined;
        return value === undefined ? { ok: false, reason: "invalid", detail: `The file has no "${src.field}" field.` } : observation(value);
      } catch (e) {
        const msg = short(e);
        if (!(e instanceof FileScopeError)) return { ok: false, reason: "unavailable", detail: msg };
        return { ok: false, reason: /not found/.test(msg) ? "unavailable" : /no longer available|protected/.test(msg) ? "permission" : /changed while/.test(msg) ? "uncertain" : "invalid", detail: msg };
      }
    }
    if (src.kind === "task") {
      const v = this.deps.runtime.view(src.taskId);
      if (v.corrupt) return { ok: false, reason: "invalid", detail: "The task's record is unreadable." };
      if (v.projectId !== projectId) return { ok: false, reason: "permission", detail: "That task belongs to another project." };
      return observation(v.state);
    }
    const source = this.deps.sources?.[src.name];
    if (!source) return { ok: false, reason: "permission", detail: `Source "${src.name}" is not registered.` };
    try {
      const raw = await Promise.race([source(), new Promise((_, reject) => setTimeout(() => reject(new Error("The source did not answer within 5 s.")), 5_000).unref?.())]);
      // Only `value` is read: a source cannot hand over a verdict ("matched", a hash, an instruction).
      return observation(raw && typeof raw === "object" && "value" in raw ? (raw as { value: unknown }).value : raw);
    } catch (e) { return { ok: false, reason: "unavailable", detail: short(e) }; }
  }

  // ── views ─────────────────────────────────────────────────────────────────────────────────────────────────────────

  goalView(g: GoalRecord, version: number) {
    const met = new Map(g.met.map(m => [m.criterionId, m]));
    return { id: g.id, title: sanitize(g.spec.title, 120), projectId: g.projectId, state: g.state, origin: g.origin, priority: g.spec.priority, version,
      progress: { met: met.size, total: g.spec.successCriteria.length },
      criteria: g.spec.successCriteria.map(c => ({ id: c.id, description: sanitize(c.description, 200), met: met.has(c.id), evidence: met.get(c.id)?.evidence.map(e => e.slice(0, 12)) ?? [], tasks: g.links.filter(l => l.criterionId === c.id).length })),
      deadlineAt: g.spec.deadlineAt, expiresAt: g.spec.expiresAt, attention: g.attention, approvedUntil: g.approval?.expiresAt ?? null, updatedAt: g.updatedAt };
  }
  scheduleView(s: ScheduleRecord, version: number) {
    const active = s.spec.action.type === "task" ? this.activeTaskIds(s.id)[0] ?? null : null;
    return { id: s.id, title: sanitize(s.spec.title, 120), projectId: s.projectId, state: s.state, version, trigger: this.triggerText(s.spec.trigger), action: s.spec.action.type,
      nextAt: s.state === "ACTIVE" ? (s.retryAt ?? s.nextAt) : null, lastAttempt: s.lastAttempt ? { at: s.lastAttempt.at, outcome: s.lastAttempt.outcome, reason: sanitize(s.lastAttempt.reason, 160) } : null,
      approvedUntil: s.approval && s.approval.specSha256 === s.specSha256 ? s.approval.expiresAt : null, goalId: s.spec.goal?.id ?? null, missedPolicy: s.spec.missedPolicy,
      runningTaskId: active, expiresAt: s.spec.expiresAt, updatedAt: s.updatedAt };
  }
  monitorView(m: MonitorRecord, version: number) {
    return { id: m.id, title: sanitize(m.spec.title, 120), label: sanitize(m.spec.label, 60), projectId: m.projectId, state: m.state, version, source: m.spec.source.kind,
      lastCheckAt: m.lastCheckAt, lastClass: m.lastClass, nextCheckAt: m.state === "ACTIVE" ? m.nextCheckAt : null, errors: m.errors, changes: m.changeSeq,
      checksLastHour: this.store.checksSince(m.id, this.now() - HOUR), intervalMs: Math.max(m.spec.intervalMs, this.store.policy().minIntervalMs),
      approvedUntil: m.approval && m.approval.specSha256 === m.specSha256 ? m.approval.expiresAt : null, expiresAt: m.spec.expiresAt, updatedAt: m.updatedAt };
  }
  private triggerText(t: Trigger): string {
    if (t.type === "once") return `Once at ${t.at.replace("T", " ")} (${t.timeZone})`;
    if (t.type === "daily") return `${t.days && t.days.length < 7 ? t.days.map(d => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d]).join(", ") : "Daily"} ${t.time} (${t.timeZone})`;
    try { return `When "${sanitize(this.store.get("monitor", t.monitorId).record.spec.label, 60)}" changes`; } catch { return "When a monitor reports a change"; }
  }
  /** A compact, durable "while you were away" summary; only what the Host recorded, nothing for time it was off. */
  away(now: number) {
    const since = this.store.awayMarker() ?? now, parts: string[] = [];
    const occs = this.store.occurrencesSince(since), obs = this.store.observationsSince(since), gaps = this.store.gapsSince(since);
    const ran = occs.filter(o => o.taskId && o.dispatched), done = ran.filter(o => { const v = this.deps.runtime.view(o.taskId!); return !v.corrupt && v.state === "COMPLETED"; }).length;
    const failed = ran.filter(o => { const v = this.deps.runtime.view(o.taskId!); return !v.corrupt && v.state === "FAILED"; }).length;
    const missed = occs.filter(o => o.outcome === "missed" || o.outcome === "defer").length, reminders = occs.filter(o => o.outcome === "notify").length;
    const checks = obs.reduce((n, o) => n + o.n, 0), changes = obs.filter(o => o.class === "meaningful").reduce((n, o) => n + o.n, 0);
    if (done) parts.push(`${done} scheduled task${done === 1 ? "" : "s"} completed`);
    if (failed) parts.push(`${failed} failed`);
    if (reminders) parts.push(`${reminders} reminder${reminders === 1 ? "" : "s"}`);
    if (checks) parts.push(changes ? `${changes} change${changes === 1 ? "" : "s"} found in ${checks} checks` : `${checks} checks, no changes`);
    if (missed) parts.push(`${missed} run${missed === 1 ? "" : "s"} missed or skipped`);
    for (const g of gaps) parts.push(`Bunny-A was ${g.kind === "off" ? "not running" : "asleep"} for ${duration(g.to - Math.max(g.from, since))}; nothing ran then`);
    return parts.length ? { since, text: parts.join(" · ") } : null;
  }
  snapshot() {
    const now = this.now(), corrupt: { kind: Kind; id: string; detail: string }[] = [];
    const rows = <K extends Kind, V>(kind: K, view: (r: never, v: number) => V) => this.store.list(kind).flatMap(r => r.ok ? [view(r.record as never, r.version)] : (corrupt.push({ kind, id: r.id, detail: sanitize(r.error, 200) }), []));
    const goals = rows("goal", (g: GoalRecord, v) => this.goalView(g, v)), schedules = rows("schedule", (s: ScheduleRecord, v) => this.scheduleView(s, v)), monitors = rows("monitor", (m: MonitorRecord, v) => this.monitorView(m, v));
    const all = this.store.notifications(60);
    const shown = all.filter(n => n.delivered && !n.dismissed && !n.suppressed && (n.snoozedUntil ?? 0) <= now).slice(0, 20);
    const next = schedules.flatMap(s => s.nextAt !== null ? [s.nextAt] : []).sort((a, b) => a - b)[0] ?? null;
    return {
      schema: "ma4.proactive.snapshot.v1" as const, at: now, policy: this.store.policy(), prefs: this.store.prefs(),
      goals, schedules, monitors, corrupt,
      notifications: shown.map(({ suppressed: _s, ...n }) => n),
      held: all.filter(n => !n.delivered && !n.dismissed && !n.suppressed).length,
      status: { monitoring: monitors.filter(m => m.state === "ACTIVE").length, scheduled: schedules.filter(s => s.state === "ACTIVE").length, working: schedules.filter(s => s.runningTaskId).length,
        waiting: schedules.filter(s => s.state === "AWAITING_APPROVAL").length + goals.filter(g => g.state === "AWAITING_APPROVAL" || g.state === "PROPOSED").length + monitors.filter(m => m.state === "AWAITING_APPROVAL").length,
        attention: goals.filter(g => g.state === "NEEDS_ATTENTION").length + corrupt.length, nextRunAt: next },
      away: this.away(now),
    };
  }
}
export type ProactiveSnapshot = ReturnType<ProactiveEngine["snapshot"]>;

export function duration(ms: number): string {
  const m = Math.round(ms / MINUTE);
  if (m < 1) return `${Math.max(1, Math.round(ms / 1000))} s`;
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return h < 48 ? `${h} h${m % 60 ? ` ${m % 60} min` : ""}` : `${Math.round(h / 24)} days`;
}
export type { Approval };
