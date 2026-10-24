/**
 * MA4-S2-T3 proactive vocabulary: owner-approved goals, schedules and condition monitors, the wall-clock schedule math,
 * deterministic change classification and the trusted decision function. Pure: the store persists, the engine acts.
 * Nothing here grants authority. A schedule's task runs as an ordinary S2-T1 task inside its own envelope; a schedule
 * only decides WHEN the owner-approved task may be created, never WHAT it may do.
 */
import { z } from "zod";
import { CHECKPOINT_SECRET_PATTERNS } from "../agent-checkpoint.server.ts";
import { canonical, EnvelopeSchema, sha256, TaskSpecSchema } from "./task-runtime.ts";

export const PROACTIVE_SCHEMA_VERSION = 1;
const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/);
const text = (max: number) => z.string().trim().min(1).max(max);
const MINUTE = 60_000, HOUR = 60 * MINUTE, DAY = 24 * HOUR;
/** Owner approvals of standing work always end; history never becomes standing authority. */
export const MAX_APPROVAL_MS = 30 * DAY;

// ── time zones ─────────────────────────────────────────────────────────────────────────────────────────────────────

export function validTimeZone(tz: string): boolean {
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch { return false; }
}
const formatters = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string) {
  let f = formatters.get(tz);
  if (!f) formatters.set(tz, f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", weekday: "short" }));
  return f;
}
export type Wall = { y: number; m: number; d: number; h: number; mi: number };
const WEEKDAY: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
/** The local wall clock of a UTC instant in a named zone. */
export function wallOf(tz: string, utc: number): Wall & { s: number; weekday: number } {
  const p = Object.fromEntries(fmt(tz).formatToParts(new Date(utc)).map(x => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour % 24, mi: +p.minute, s: +p.second, weekday: WEEKDAY[p.weekday] };
}
/** local − UTC, in ms, at that instant. */
export function zoneOffset(tz: string, utc: number): number {
  const w = wallOf(tz, utc);
  return Date.UTC(w.y, w.m - 1, w.d, w.h, w.mi, w.s) - Math.floor(utc / 1000) * 1000;
}
export type Resolution = "exact" | "ambiguous" | "nonexistent";
/**
 * Local wall time → UTC instant, with the documented DST policy (the same as Temporal's "compatible"):
 * an AMBIGUOUS time (clocks fall back, the hour happens twice) resolves to its EARLIER instant, so a daily slot fires
 * once; a NONEXISTENT time (clocks spring forward over it) moves FORWARD by the length of the gap (02:30 → 03:30).
 */
export function localToUtc(tz: string, w: Wall): { utc: number; resolution: Resolution } {
  const naive = Date.UTC(w.y, w.m - 1, w.d, w.h, w.mi);
  const before = zoneOffset(tz, naive - DAY), after = zoneOffset(tz, naive + DAY);
  const fits = (off: number) => { const x = wallOf(tz, naive - off); return x.y === w.y && x.m === w.m && x.d === w.d && x.h === w.h && x.mi === w.mi; };
  const valid = [...new Set([before, after])].filter(fits).map(off => naive - off).sort((a, b) => a - b);
  if (valid.length > 1) return { utc: valid[0], resolution: "ambiguous" };
  if (valid.length === 1) return { utc: valid[0], resolution: "exact" };
  return { utc: naive - before, resolution: "nonexistent" };
}

// ── schedules ──────────────────────────────────────────────────────────────────────────────────────────────────────

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
/** 2026-02-30 is refused, not silently moved to 2 March. */
function realDate(at: string): boolean {
  const [y, m, d] = at.slice(0, 10).split("-").map(Number), t = new Date(Date.UTC(y, m - 1, d));
  return y >= 2000 && y <= 2100 && t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}
const tz = z.string().min(1).max(64).refine(validTimeZone, "Use a named IANA time zone, such as Europe/London.");
export const TriggerSchema = z.discriminatedUnion("type", [
  /** One local wall time, once. */
  z.object({ type: z.literal("once"), at: z.string().regex(/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/).refine(realDate, "That date does not exist."), timeZone: tz }).strict(),
  /** Every day (or the listed weekdays, 0 = Sunday) at a local wall time. */
  z.object({ type: z.literal("daily"), time: hhmm, timeZone: tz, days: z.array(z.number().int().min(0).max(6)).min(1).max(7).optional() }).strict(),
  /** When an approved monitor in the same project reports a meaningful change. */
  z.object({ type: z.literal("condition"), monitorId: id }).strict(),
]);
export type Trigger = z.infer<typeof TriggerSchema>;
/** A task template: an S2-T1 task spec without its deadline (the engine sets each occurrence's deadline). */
const TemplateSchema = TaskSpecSchema.omit({ deadlineAt: true });
export const ScheduleSpecSchema = z.object({
  title: text(120),
  projectId: id,
  goal: z.object({ id, criterionId: id }).strict().nullable().default(null),
  trigger: TriggerSchema,
  action: z.discriminatedUnion("type", [
    z.object({ type: z.literal("remind"), text: text(200) }).strict(),
    z.object({ type: z.literal("task"), spec: TemplateSchema, envelope: EnvelopeSchema }).strict(),
  ]),
  /** After a long shutdown: "skip" records the missed runs; "run_once" runs only the latest one. Never all of them. */
  missedPolicy: z.enum(["skip", "run_once"]).default("skip"),
  /** A run that starts this late is still on time. */
  graceMs: z.number().int().min(MINUTE).max(6 * HOUR).default(15 * MINUTE),
  /** Each occurrence's task must finish within this window (its S2-T1 deadline). */
  runWindowMs: z.number().int().min(MINUTE).max(DAY).default(HOUR),
  maxRunsPerDay: z.number().int().min(1).max(48).default(4),
  /** Condition triggers: the least time between two runs. */
  minGapMs: z.number().int().min(MINUTE).max(7 * DAY).default(15 * MINUTE),
  expiresAt: z.number().int().positive(),
  /** MA4-S2-T3R: no slot before this instant (part of the approved hash). */
  startsAt: z.number().int().positive().nullable().default(null),
  notify: z.object({ completed: z.boolean().default(true), failed: z.boolean().default(true) }).strict().default({ completed: true, failed: true }),
}).strict().superRefine((s, ctx) => {
  if (s.startsAt !== null && s.startsAt >= s.expiresAt) ctx.addIssue({ code: "custom", message: "The schedule must start before it ends." });
  if (s.action.type === "task") {
    if (s.action.spec.projectId !== s.projectId) ctx.addIssue({ code: "custom", message: "The task template belongs to another project." });
    if (!s.action.envelope.projectScopes.includes(s.projectId)) ctx.addIssue({ code: "custom", message: "The envelope does not cover this project." });
  }
});
export type ScheduleSpec = z.infer<typeof ScheduleSpecSchema>;
export const SCHEDULE_STATES = ["AWAITING_APPROVAL", "ACTIVE", "PAUSED", "COMPLETED", "CANCELLED", "EXPIRED", "FAILED"] as const;
export type ScheduleState = (typeof SCHEDULE_STATES)[number];
export type Approval = { by: "workstation"; at: number; expiresAt: number; specSha256: string };

/** The next slot strictly after `after` (UTC ms), or null when there is none. Condition triggers have no slots. */
export function nextSlot(trigger: Trigger, after: number): number | null {
  if (trigger.type === "condition") return null;
  if (trigger.type === "once") {
    const [date, time] = trigger.at.split("T"), [y, m, d] = date.split("-").map(Number), [h, mi] = time.split(":").map(Number);
    const slot = localToUtc(trigger.timeZone, { y, m, d, h, mi }).utc;
    return slot > after ? slot : null;
  }
  const [h, mi] = trigger.time.split(":").map(Number), start = wallOf(trigger.timeZone, after);
  for (let i = -1; i <= 8; i++) {
    const day = new Date(Date.UTC(start.y, start.m - 1, start.d + i));
    if (trigger.days && !trigger.days.includes(day.getUTCDay())) continue;
    const slot = localToUtc(trigger.timeZone, { y: day.getUTCFullYear(), m: day.getUTCMonth() + 1, d: day.getUTCDate(), h, mi }).utc;
    if (slot > after) return slot;
  }
  return null;
}
/** Why a slot's instant differs from the wall time asked for (DST), or null when it is exact. */
export function slotNote(trigger: Trigger, slot: number): string | null {
  if (trigger.type === "condition") return null;
  const tz = trigger.timeZone, time = trigger.type === "once" ? trigger.at.slice(11) : trigger.time, w = wallOf(tz, slot);
  const [h, mi] = time.split(":").map(Number);
  if (w.h !== h || w.mi !== mi) return `${time} does not exist on ${w.y}-${String(w.m).padStart(2, "0")}-${String(w.d).padStart(2, "0")} (clocks move forward); it runs at ${String(w.h).padStart(2, "0")}:${String(w.mi).padStart(2, "0")}.`;
  return localToUtc(tz, { y: w.y, m: w.m, d: w.d, h, mi }).resolution === "ambiguous" ? `${time} happens twice on ${w.y}-${String(w.m).padStart(2, "0")}-${String(w.d).padStart(2, "0")} (clocks move back); it runs once, at the first.` : null;
}
/** Every slot in (after, until], oldest first, bounded so a clock jumping years ahead cannot loop. */
export function slotsBetween(trigger: Trigger, after: number, until: number, max = 400): number[] {
  const out: number[] = [];
  for (let t = nextSlot(trigger, after); t !== null && t <= until && out.length < max; t = nextSlot(trigger, t)) out.push(t);
  return out;
}

// ── goals ──────────────────────────────────────────────────────────────────────────────────────────────────────────

export const GoalSpecSchema = z.object({
  title: text(120),
  description: z.string().trim().max(600).default(""),
  projectId: id,
  parentId: id.nullable().default(null),
  successCriteria: z.array(z.object({ id, description: text(200) }).strict()).min(1).max(16),
  /** Capabilities a schedule serving this goal may use (a subset of its envelope's). */
  permittedActions: z.array(z.string().regex(/^[a-z][a-z0-9.-]{1,47}$/)).max(16).default([]),
  priority: z.enum(["low", "normal", "high"]).default("normal"),
  budget: z.object({ maxTasks: z.number().int().min(1).max(500).default(50) }).strict().default({ maxTasks: 50 }),
  deadlineAt: z.number().int().positive().nullable().default(null),
  expiresAt: z.number().int().positive(),
  notify: z.object({ milestones: z.boolean().default(true) }).strict().default({ milestones: true }),
}).strict().refine(g => new Set(g.successCriteria.map(c => c.id)).size === g.successCriteria.length, "Criterion ids must be unique.");
export type GoalSpec = z.infer<typeof GoalSpecSchema>;
export const GOAL_STATES = ["PROPOSED", "AWAITING_APPROVAL", "ACTIVE", "PAUSED", "NEEDS_ATTENTION", "COMPLETED", "FAILED", "CANCELLED", "EXPIRED"] as const;
export type GoalState = (typeof GOAL_STATES)[number];
export const GOAL_NEXT: Readonly<Record<GoalState, readonly GoalState[]>> = {
  PROPOSED: ["AWAITING_APPROVAL", "CANCELLED"],
  AWAITING_APPROVAL: ["ACTIVE", "CANCELLED", "EXPIRED"],
  ACTIVE: ["PAUSED", "NEEDS_ATTENTION", "COMPLETED", "FAILED", "CANCELLED", "EXPIRED"],
  PAUSED: ["ACTIVE", "CANCELLED", "EXPIRED"],
  NEEDS_ATTENTION: ["ACTIVE", "PAUSED", "COMPLETED", "FAILED", "CANCELLED", "EXPIRED"],
  COMPLETED: [], FAILED: [], CANCELLED: [], EXPIRED: [],
};
export const TERMINAL_GOAL_STATES: readonly GoalState[] = ["COMPLETED", "FAILED", "CANCELLED", "EXPIRED"];
export const goalCanTransition = (from: GoalState, to: GoalState) => GOAL_NEXT[from]?.includes(to) ?? false;
export type GoalLink = { criterionId: string; taskId: string; at: number };
/** Met only on a COMPLETED task's receipts. The model's word that something is done never counts. */
export type GoalMet = { criterionId: string; taskId: string; evidence: string[]; at: number };

// ── monitors ───────────────────────────────────────────────────────────────────────────────────────────────────────

export const MonitorSpecSchema = z.object({
  title: text(120),
  /** Path-free, shown on the phone and the notch. */
  label: text(60),
  projectId: id,
  /** Only approved local sources. There is deliberately no URL source: Bunny never polls the internet on its own. */
  source: z.discriminatedUnion("kind", [
    /** A file inside an owner-registered folder; `field` reads one top-level JSON field, otherwise the first line. */
    z.object({ kind: z.literal("file"), root: id, path: z.string().min(1).max(260), field: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,39}$/).optional() }).strict(),
    /** The state of an existing persistent task in the same project. */
    z.object({ kind: z.literal("task"), taskId: id }).strict(),
    /** A Host-registered synthetic source (tests: recorded browser pages and connected-service events). */
    z.object({ kind: z.literal("synthetic"), name: id }).strict(),
  ]),
  predicate: z.discriminatedUnion("type", [
    z.object({ type: z.literal("changed") }).strict(),
    z.object({ type: z.literal("equals"), value: z.string().max(200) }).strict(),
    z.object({ type: z.literal("transition"), from: z.string().max(200).optional(), to: z.string().max(200) }).strict(),
  ]),
  intervalMs: z.number().int().min(1_000).max(DAY).default(5 * MINUTE),
  maxChecksPerHour: z.number().int().min(1).max(120).default(12),
  /** One notification per meaningful change; further changes inside this window are recorded, not announced. */
  dedupMs: z.number().int().min(0).max(DAY).default(30 * MINUTE),
  expiresAt: z.number().int().positive(),
  notify: z.boolean().default(true),
  priority: z.enum(["low", "normal", "high"]).default("normal"),
}).strict();
export type MonitorSpec = z.infer<typeof MonitorSpecSchema>;
export const MONITOR_STATES = ["AWAITING_APPROVAL", "ACTIVE", "PAUSED", "DISABLED", "EXPIRED"] as const;
export type MonitorState = (typeof MONITOR_STATES)[number];

export type Observation = { ok: true; value: string; sha256: string } | { ok: false; reason: "unavailable" | "invalid" | "permission" | "uncertain"; detail: string };
export const CHANGE_CLASSES = ["no_change", "routine_change", "meaningful", "source_unavailable", "invalid", "permission_expired", "uncertain"] as const;
export type ChangeClass = (typeof CHANGE_CLASSES)[number];
/** Deterministic: the same previous value, observation and predicate always classify the same way. No model is asked. */
export function classify(prev: { value: string; sha256: string } | null, obs: Observation, predicate: MonitorSpec["predicate"]): ChangeClass {
  if (!obs.ok) return obs.reason === "unavailable" ? "source_unavailable" : obs.reason === "permission" ? "permission_expired" : obs.reason;
  // The first observation is the baseline: it is recorded, never announced as news.
  if (!prev) return "routine_change";
  if (prev.sha256 === obs.sha256) return "no_change";
  switch (predicate.type) {
    case "changed": return "meaningful";
    case "equals": return obs.value === predicate.value && prev.value !== predicate.value ? "meaningful" : "routine_change";
    case "transition": return obs.value === predicate.to && prev.value !== predicate.to && (predicate.from === undefined || prev.value === predicate.from) ? "meaningful" : "routine_change";
  }
}
/** Normalizes what a source returned. Only the value is trusted; its hash is recomputed here, any verdict is ignored. */
export function observation(value: unknown, fullSha?: string): Observation {
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") return { ok: false, reason: "invalid", detail: "The source returned no readable value." };
  const v = String(value).trim().slice(0, 200);
  return { ok: true, value: v, sha256: fullSha && /^[a-f0-9]{64}$/.test(fullSha) ? fullSha : sha256(v) };
}

// ── notifications ──────────────────────────────────────────────────────────────────────────────────────────────────

export const NOTIFICATION_CATEGORIES = ["reminder_due", "goal_milestone", "source_changed", "task_completed", "task_failed", "approval_required", "schedule_missed", "recovery_blocked", "permission_expired"] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];
export const PrefsSchema = z.object({
  categories: z.partialRecord(z.enum(NOTIFICATION_CATEGORIES), z.boolean()).default({}),
  quietHours: z.object({ enabled: z.boolean().default(false), start: hhmm.default("22:00"), end: hhmm.default("07:00"), timeZone: tz.default("UTC") }).strict().default({ enabled: false, start: "22:00", end: "07:00", timeZone: "UTC" }),
}).strict();
export type NotificationPrefs = z.infer<typeof PrefsSchema>;
/** Owner resource limits for proactive work on this laptop. Defaults are conservative; nothing runs while disabled. */
export const ProactivePolicySchema = z.object({
  enabled: z.boolean().default(true),
  maxActiveMonitors: z.number().int().min(0).max(32).default(8),
  minIntervalMs: z.number().int().min(1_000).max(DAY).default(MINUTE),
  maxConcurrentTasks: z.number().int().min(1).max(4).default(1),
  maxModelCallsPerDay: z.number().int().min(0).max(2_000).default(40),
}).strict();
export type ProactivePolicy = z.infer<typeof ProactivePolicySchema>;

const minutesOf = (hm: string) => { const [h, m] = hm.split(":").map(Number); return h * 60 + m; };
/** When a notification made at `now` may be shown: now, or the end of the owner's quiet hours. */
export function deliverAt(prefs: NotificationPrefs, now: number): number {
  const q = prefs.quietHours;
  if (!q.enabled || q.start === q.end) return now;
  const w = wallOf(q.timeZone, now), cur = w.h * 60 + w.mi, start = minutesOf(q.start), end = minutesOf(q.end);
  const quiet = start < end ? cur >= start && cur < end : cur >= start || cur < end;
  if (!quiet) return now;
  for (let i = 0; i <= 2; i++) {
    const day = new Date(Date.UTC(w.y, w.m - 1, w.d + i));
    const t = localToUtc(q.timeZone, { y: day.getUTCFullYear(), m: day.getUTCMonth() + 1, d: day.getUTCDate(), h: Math.floor(end / 60), mi: end % 60 }).utc;
    if (t > now) return t;
  }
  return now;
}
/** Notifications may reach a phone: no paths, tokens, stack traces or long content. */
export function sanitize(value: string, max = 200): string {
  let out = value.replace(/\r?\n\s+at [^\n]+/g, "").replace(/[A-Za-z]:\\[^\s"'<>|]+/g, "[path]").replace(/(^|[\s("'])\/(?:[^\s/"']+\/)+[^\s"']*/g, "$1[path]");
  for (const rule of CHECKPOINT_SECRET_PATTERNS) out = out.replace(new RegExp(rule.pattern.source, rule.pattern.flags.includes("g") ? rule.pattern.flags : rule.pattern.flags + "g"), "[redacted]");
  return out.replace(/\s+/g, " ").trim().slice(0, max);
}

// ── the trusted decision ───────────────────────────────────────────────────────────────────────────────────────────

export const OUTCOMES = ["execute", "queue", "request_approval", "notify", "record_no_change", "defer", "stop_expired", "fail_safe"] as const;
export type Outcome = (typeof OUTCOMES)[number];
export type DecisionFacts = {
  now: number;
  /** The record passed its integrity check and parses. */
  intact: boolean;
  state: ScheduleState;
  specSha256: string;
  approval: Approval | null;
  expiresAt: number;
  envelopeExpiresAt: number | null;
  goal: { state: GoalState; tasksUsed: number; maxTasks: number } | null;
  /** Condition triggers: what the monitor saw. Time triggers pass "meaningful". */
  change: ChangeClass;
  action: "remind" | "task";
  /** The previous occurrence's task has not finished (or is UNCERTAIN). */
  overlapping: boolean;
  runsToday: number; maxRunsPerDay: number;
  /** Policy and laptop limits. */
  proactiveEnabled: boolean;
  activeTasks: number; maxConcurrentTasks: number;
  modelCallsToday: number; maxModelCallsPerDay: number; modelSteps: number;
  modelsAvailable: boolean;
  /** A window is attached, or the background policy and the envelope both allow work without one. */
  mayRunUnattended: boolean;
  /** The task will need the owner's approval anyway (e.g. its envelope requires approval the schedule did not give). */
  approvalLive: boolean;
};
export type Decision = { outcome: Outcome; reason: string; transient?: boolean };
/**
 * Exactly one outcome per trigger, from trusted facts only. Order matters: integrity and authority first, so nothing a
 * model, a monitored file or a webpage says can reach an execution path. A model's urgency is not an input at all.
 */
export function decide(f: DecisionFacts): Decision {
  if (!f.intact) return { outcome: "fail_safe", reason: "The schedule record failed its integrity check; nothing runs until it is reviewed." };
  if (f.state !== "ACTIVE") return { outcome: "fail_safe", reason: `The schedule is ${f.state.toLowerCase().replace("_", " ")}.` };
  if (f.expiresAt <= f.now) return { outcome: "stop_expired", reason: "The schedule reached its end date." };
  if (f.envelopeExpiresAt !== null && f.envelopeExpiresAt <= f.now) return { outcome: "stop_expired", reason: "The task's authorization expired." };
  if (!f.approval || f.approval.expiresAt <= f.now || f.approval.specSha256 !== f.specSha256 || !f.approvalLive)
    return { outcome: "request_approval", reason: f.approval && f.approval.specSha256 !== f.specSha256 ? "The schedule changed since you approved it." : "The schedule's approval expired." };
  if (f.goal && f.goal.state === "PAUSED") return { outcome: "defer", reason: "Its goal is paused.", transient: false };
  if (f.goal && f.goal.state !== "ACTIVE" && f.goal.state !== "NEEDS_ATTENTION") return { outcome: "stop_expired", reason: `Its goal is ${f.goal.state.toLowerCase()}.` };
  if (f.change === "no_change" || f.change === "routine_change") return { outcome: "record_no_change", reason: f.change === "no_change" ? "Nothing changed." : "An expected change; nothing to do." };
  if (f.change === "permission_expired") return { outcome: "stop_expired", reason: "The monitored source is no longer authorized." };
  if (f.change !== "meaningful") return { outcome: "fail_safe", reason: f.change === "source_unavailable" ? "The source could not be read." : f.change === "invalid" ? "The source returned an invalid observation." : "The observation was uncertain; nothing was done." };
  if (!f.proactiveEnabled) return { outcome: "defer", reason: "Proactive work is turned off.", transient: false };
  if (f.action === "remind") return { outcome: "notify", reason: "Reminder due." };
  if (f.goal && f.goal.tasksUsed >= f.goal.maxTasks) return { outcome: "defer", reason: "The goal used its task budget.", transient: false };
  if (f.runsToday >= f.maxRunsPerDay) return { outcome: "defer", reason: "The schedule reached its runs for today.", transient: false };
  if (f.modelSteps > 0 && f.modelCallsToday + f.modelSteps > f.maxModelCallsPerDay) return { outcome: "defer", reason: "Today's local model budget for proactive work is used up.", transient: false };
  if (f.overlapping) return { outcome: "defer", reason: "The previous run is still active.", transient: true };
  if (f.activeTasks >= f.maxConcurrentTasks) return { outcome: "defer", reason: "Another proactive task is running.", transient: true };
  if (f.modelSteps > 0 && !f.modelsAvailable) return { outcome: "defer", reason: "The pinned local model is not available.", transient: true };
  if (!f.mayRunUnattended) return { outcome: "defer", reason: "Bunny-A's windows are closed and background work is off.", transient: true };
  return { outcome: f.modelSteps > 0 ? "queue" : "execute", reason: "Authorized; the task was created." };
}

export const specHash = (spec: unknown) => sha256(canonical(spec));
