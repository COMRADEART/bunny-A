/**
 * MA4-S2-T3R creation forms (pure): what the owner typed → the Host's goal / schedule / monitor specification, or field
 * messages to show beside the inputs. This only shapes the request; the Host validates everything again (previews and
 * creation run the same checks) and the owner approves what the Host previewed. Nothing here grants authority.
 */
export type FieldErrors = Record<string, string>;
export type Built<T> = { ok: true; spec: T } | { ok: false; errors: FieldErrors };
const DAY = 86_400_000;
/** End of a local calendar day ("YYYY-MM-DD"), or null when the date is missing or impossible. */
export function endOfDay(date: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const [y, m, d] = date.split("-").map(Number), t = new Date(y, m - 1, d, 23, 59, 0, 0);
  return t.getFullYear() === y && t.getMonth() === m - 1 && t.getDate() === d ? t.getTime() : null;
}
export function startOfDay(date: string): number | null {
  const end = endOfDay(date);
  return end === null ? null : end - (23 * 60 + 59) * 60_000;
}
const lines = (text: string) => text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
const slug = (text: string, i: number) => (text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) || "c") + `-${i + 1}`;

// ── goal ───────────────────────────────────────────────────────────────────────────────────────────────────────────
export type GoalDraft = { title: string; description: string; projectId: string; criteria: string; deadline: string; expires: string; maxTasks: number; permitted: string[]; milestones: boolean; priority: "low" | "normal" | "high" };
export function buildGoal(d: GoalDraft, now: number): Built<Record<string, unknown>> {
  const errors: FieldErrors = {}, criteria = lines(d.criteria);
  if (!d.title.trim()) errors.title = "Name the goal.";
  else if (d.title.trim().length > 120) errors.title = "Keep the name under 120 characters.";
  if (!d.projectId) errors.projectId = "Choose the project this goal belongs to.";
  if (!criteria.length) errors.criteria = "Add at least one success criterion, one per line.";
  else if (criteria.length > 16) errors.criteria = "At most 16 criteria.";
  else if (criteria.some(c => c.length > 200)) errors.criteria = "Keep each criterion under 200 characters.";
  const expiresAt = endOfDay(d.expires), deadlineAt = d.deadline ? endOfDay(d.deadline) : null;
  if (expiresAt === null) errors.expires = "Choose a valid end date.";
  else if (expiresAt <= now) errors.expires = "The end date must be in the future.";
  else if (expiresAt > now + 365 * DAY) errors.expires = "A goal lasts at most a year.";
  if (d.deadline && deadlineAt === null) errors.deadline = "Choose a valid deadline or leave it empty.";
  else if (deadlineAt !== null && expiresAt !== null && deadlineAt > expiresAt) errors.deadline = "The deadline must not be after the end date.";
  if (!Number.isInteger(d.maxTasks) || d.maxTasks < 1 || d.maxTasks > 500) errors.maxTasks = "Between 1 and 500 tasks.";
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, spec: { title: d.title.trim(), description: d.description.trim().slice(0, 600), projectId: d.projectId, successCriteria: criteria.map((c, i) => ({ id: slug(c, i), description: c })),
    permittedActions: d.permitted, priority: d.priority, budget: { maxTasks: d.maxTasks }, deadlineAt, expiresAt, notify: { milestones: d.milestones } } };
}

// ── schedule ───────────────────────────────────────────────────────────────────────────────────────────────────────
export type ScheduleDraft = {
  title: string; projectId: string; when: "once" | "daily" | "weekly" | "condition";
  date: string; time: string; timeZone: string; days: number[]; monitorId: string; starts: string; expires: string;
  task: "remind" | "check" | "summarize"; text: string; root: string; paths: string; model: string; review: boolean;
  missedPolicy: "skip" | "run_once"; background: boolean; maxModelCalls: number; maxMinutes: number; maxRunsPerDay: number;
  notifyCompleted: boolean; notifyFailed: boolean;
};
/** The steps a template produces; consumers show them, the Host re-validates them. */
export function templateSteps(d: Pick<ScheduleDraft, "task" | "root" | "paths" | "model" | "review">) {
  const files = lines(d.paths.replace(/,/g, "\n")).slice(0, 4);
  const reads = files.map((path, i) => ({ id: `read${i + 1}`, kind: d.task === "check" ? "file.stat" : "file.read", input: { root: d.root, path }, model: null }));
  if (d.task !== "summarize") return reads;
  const from = reads.map(r => r.id).join(",");
  return [...reads, { id: "summary", kind: "local.generate", input: { prompt: "Summarize these files for the owner: what changed, what is open, what needs attention. Use only the sources.", contextFrom: from }, model: d.model },
    ...(d.review ? [{ id: "review", kind: "local.review", input: { criteria: "Every statement in the summary is supported by the sources.", subjectFrom: "summary", contextFrom: from }, model: d.model }] : [])];
}
export function buildSchedule(d: ScheduleDraft, now: number): Built<Record<string, unknown>> {
  const errors: FieldErrors = {};
  if (!d.title.trim()) errors.title = "Name the schedule.";
  if (!d.projectId) errors.projectId = "Choose a project.";
  if (!d.timeZone) errors.timeZone = "Choose a time zone.";
  if (d.when !== "condition" && !/^([01]\d|2[0-3]):[0-5]\d$/.test(d.time)) errors.time = "Choose a time.";
  if (d.when === "once" && endOfDay(d.date) === null) errors.date = "Choose a valid date.";
  if (d.when === "weekly" && !d.days.length) errors.days = "Pick at least one day.";
  if (d.when === "condition" && !d.monitorId) errors.monitorId = "Choose the monitor whose change starts this task.";
  if (d.when === "condition" && d.task === "remind") errors.task = "A condition starts a task; use the monitor's own notification for a reminder.";
  const expiresAt = endOfDay(d.expires), startsAt = d.starts ? startOfDay(d.starts) : null;
  if (expiresAt === null) errors.expires = "Choose a valid end date.";
  else if (expiresAt <= now) errors.expires = "The end date must be in the future.";
  if (d.starts && startsAt === null) errors.starts = "Choose a valid start date or leave it empty.";
  else if (startsAt !== null && expiresAt !== null && startsAt >= expiresAt) errors.starts = "The schedule must start before it ends.";
  if (d.task === "remind" && !d.text.trim()) errors.text = "Write the reminder.";
  if (d.task !== "remind") {
    if (!d.root) errors.root = "Choose a registered folder.";
    if (!lines(d.paths.replace(/,/g, "\n")).length) errors.paths = "Name at least one file inside the folder.";
    else if (lines(d.paths.replace(/,/g, "\n")).length > 4) errors.paths = "At most 4 files.";
    if (d.task === "summarize" && !d.model) errors.model = "Choose an installed local model.";
    const steps = templateSteps(d).filter(s => s.kind.startsWith("local.")).length;
    if (!Number.isInteger(d.maxModelCalls) || d.maxModelCalls < steps || d.maxModelCalls > 500) errors.maxModelCalls = `At least ${steps} (one per model step), at most 500.`;
    if (!Number.isInteger(d.maxMinutes) || d.maxMinutes < 1 || d.maxMinutes > 24 * 60) errors.maxMinutes = "Between 1 minute and 24 hours.";
  }
  if (!Number.isInteger(d.maxRunsPerDay) || d.maxRunsPerDay < 1 || d.maxRunsPerDay > 48) errors.maxRunsPerDay = "Between 1 and 48.";
  if (Object.keys(errors).length) return { ok: false, errors };
  const trigger = d.when === "once" ? { type: "once", at: `${d.date}T${d.time}`, timeZone: d.timeZone }
    : d.when === "condition" ? { type: "condition", monitorId: d.monitorId }
      : { type: "daily", time: d.time, timeZone: d.timeZone, ...(d.when === "weekly" ? { days: [...d.days].sort() } : {}) };
  const steps = templateSteps(d);
  const action = d.task === "remind" ? { type: "remind", text: d.text.trim() } : {
    type: "task",
    spec: { title: d.title.trim(), projectId: d.projectId, steps, acceptance: { requiredSteps: steps.map(s => s.id), description: "Every step completed with a receipt." } },
    envelope: { capabilities: [...new Set(steps.map(s => s.kind))], providers: ["ollama"], localOnly: true, models: d.task === "summarize" ? [d.model] : [], projectScopes: [d.projectId],
      sideEffects: false, background: d.background, budgets: { maxModelCalls: d.maxModelCalls, maxWallMs: d.maxMinutes * 60_000 }, expiresAt: expiresAt! + DAY, grants: { files: [{ root: d.root, access: "read" }] } },
  };
  return { ok: true, spec: { title: d.title.trim(), projectId: d.projectId, trigger, action, missedPolicy: d.missedPolicy, maxRunsPerDay: d.maxRunsPerDay, expiresAt, startsAt, notify: { completed: d.notifyCompleted, failed: d.notifyFailed } } };
}

// ── monitor ────────────────────────────────────────────────────────────────────────────────────────────────────────
export type MonitorDraft = {
  title: string; label: string; projectId: string; source: "file" | "json" | "task"; root: string; path: string; field: string; taskId: string;
  condition: "changed" | "equals" | "transition"; value: string; from: string; to: string;
  everyMinutes: number; maxChecksPerHour: number; dedupMinutes: number; notify: boolean; priority: "low" | "normal" | "high"; expires: string;
};
export function buildMonitor(d: MonitorDraft, now: number, minMinutes = 1): Built<Record<string, unknown>> {
  const errors: FieldErrors = {};
  if (!d.title.trim()) errors.title = "Name the monitor.";
  if (!d.label.trim()) errors.label = "Give a short label (shown on the phone and notch).";
  else if (d.label.trim().length > 60) errors.label = "At most 60 characters.";
  if (!d.projectId) errors.projectId = "Choose a project.";
  if (d.source !== "task" && !d.root) errors.root = "Choose a registered folder.";
  if (d.source !== "task" && !d.path.trim()) errors.path = "Name the file inside the folder.";
  if (d.source === "json" && !/^[A-Za-z_][A-Za-z0-9_]{0,39}$/.test(d.field)) errors.field = "A top-level field name, such as status.";
  if (d.source === "task" && !d.taskId) errors.taskId = "Choose the task to watch.";
  if (d.condition === "equals" && !d.value.trim()) errors.value = "Enter the value to wait for.";
  if (d.condition === "transition" && !d.to.trim()) errors.to = "Enter the new value that matters.";
  if (!Number.isFinite(d.everyMinutes) || d.everyMinutes < minMinutes || d.everyMinutes > 1440) errors.everyMinutes = `Between ${minMinutes} and 1440 minutes.`;
  if (!Number.isInteger(d.maxChecksPerHour) || d.maxChecksPerHour < 1 || d.maxChecksPerHour > 120) errors.maxChecksPerHour = "Between 1 and 120.";
  const expiresAt = endOfDay(d.expires);
  if (expiresAt === null) errors.expires = "Choose a valid end date.";
  else if (expiresAt <= now) errors.expires = "The end date must be in the future.";
  if (Object.keys(errors).length) return { ok: false, errors };
  const source = d.source === "task" ? { kind: "task", taskId: d.taskId } : { kind: "file", root: d.root, path: d.path.trim(), ...(d.source === "json" ? { field: d.field } : {}) };
  const predicate = d.condition === "changed" ? { type: "changed" } : d.condition === "equals" ? { type: "equals", value: d.value.trim() } : { type: "transition", to: d.to.trim(), ...(d.from.trim() ? { from: d.from.trim() } : {}) };
  return { ok: true, spec: { title: d.title.trim(), label: d.label.trim(), projectId: d.projectId, source, predicate, intervalMs: Math.round(d.everyMinutes * 60_000), maxChecksPerHour: d.maxChecksPerHour,
    dedupMs: Math.round(d.dedupMinutes * 60_000), expiresAt, notify: d.notify, priority: d.priority } };
}

/** MA4-S2-T3R1: a registered folder's id from its name — the Host's rule (lowercase, starts with a letter, ≤ 40), unique. */
export function folderId(label: string, taken: readonly string[]): string {
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 36).replace(/^-+|-+$/g, "");
  const base = !slug ? "folder" : /^[a-z]/.test(slug) ? slug : `f-${slug}`;
  let id = base;
  for (let n = 2; taken.includes(id); n++) id = `${base}-${n}`;
  return id;
}
