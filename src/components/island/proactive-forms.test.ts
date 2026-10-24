import test from "node:test";
import assert from "node:assert/strict";
import { buildGoal, buildMonitor, buildSchedule, endOfDay, templateSteps, type GoalDraft, type MonitorDraft, type ScheduleDraft } from "./proactive-forms.ts";
import { GoalSpecSchema, MonitorSpecSchema, ScheduleSpecSchema } from "../../lib/bunny-host/ma4/proactive.ts";

const NOW = new Date(2026, 9, 24, 12, 0).getTime();
const goal: GoalDraft = { title: "Prepare Bunny A for beta", description: "Release readiness", projectId: "p1", criteria: "Regression suite green\n\nRelease notes drafted\n", deadline: "2026-11-15", expires: "2026-12-31", maxTasks: 20, permitted: ["file.read"], milestones: true, priority: "normal" };
const sched: ScheduleDraft = { title: "Evening summary", projectId: "p1", when: "daily", date: "", time: "18:00", timeZone: "Asia/Kolkata", days: [], monitorId: "", starts: "", expires: "2026-11-30",
  task: "summarize", text: "", root: "atlas", paths: "STATUS.md, ISSUES.md", model: "qwen2.5-coder:7b", review: true, missedPolicy: "skip", background: true, maxModelCalls: 4, maxMinutes: 30, maxRunsPerDay: 2, notifyCompleted: true, notifyFailed: true };
const mon: MonitorDraft = { title: "Release check", label: "Build status", projectId: "p1", source: "json", root: "atlas", path: "build/status.json", field: "status", taskId: "", condition: "transition", value: "", from: "PASS", to: "FAIL",
  everyMinutes: 5, maxChecksPerHour: 12, dedupMinutes: 30, notify: true, priority: "high", expires: "2026-11-30" };

test("S2-T3R forms: a valid goal, schedule and monitor become specs the Host schema accepts", () => {
  const g = buildGoal(goal, NOW);
  assert.ok(g.ok);
  if (!g.ok) return;
  assert.ok(GoalSpecSchema.safeParse(g.spec).success);
  assert.deepEqual((g.spec.successCriteria as { description: string }[]).map(c => c.description), ["Regression suite green", "Release notes drafted"], "blank lines dropped");
  for (const d of [sched, { ...sched, when: "weekly" as const, days: [5, 1] }, { ...sched, when: "once" as const, date: "2026-11-01" }, { ...sched, task: "check" as const, maxModelCalls: 0 }, { ...sched, task: "remind" as const, text: "Review the build" }, { ...sched, when: "condition" as const, monitorId: "mon-1", task: "check" as const, maxModelCalls: 0 }]) {
    const s = buildSchedule(d, NOW);
    assert.ok(s.ok, JSON.stringify(!s.ok && s.errors));
    if (s.ok) assert.ok(ScheduleSpecSchema.safeParse(s.spec).success, JSON.stringify(ScheduleSpecSchema.safeParse(s.spec).error?.issues));
  }
  const weekly = buildSchedule({ ...sched, when: "weekly", days: [5, 1] }, NOW);
  assert.deepEqual(weekly.ok && (weekly.spec.trigger as { days: number[] }).days, [1, 5]);
  for (const d of [mon, { ...mon, source: "file" as const, condition: "changed" as const }, { ...mon, source: "task" as const, taskId: "ptask-1", condition: "equals" as const, value: "COMPLETED" }]) {
    const m = buildMonitor(d, NOW);
    assert.ok(m.ok, JSON.stringify(!m.ok && m.errors));
    if (m.ok) assert.ok(MonitorSpecSchema.safeParse(m.spec).success);
  }
});

test("S2-T3R forms: the summarize template is the smallest team — reads, Worker, optional Reviewer — and grants only that folder", () => {
  assert.deepEqual(templateSteps(sched).map(s => s.kind), ["file.read", "file.read", "local.generate", "local.review"]);
  assert.deepEqual(templateSteps({ ...sched, review: false }).map(s => s.kind), ["file.read", "file.read", "local.generate"]);
  assert.deepEqual(templateSteps({ ...sched, task: "check" }).map(s => s.kind), ["file.stat", "file.stat"]);
  const s = buildSchedule(sched, NOW);
  if (!s.ok) throw new Error("invalid");
  const env = (s.spec.action as { envelope: Record<string, unknown> }).envelope;
  assert.deepEqual(env.grants, { files: [{ root: "atlas", access: "read" }] });
  assert.deepEqual(env.models, ["qwen2.5-coder:7b"]); assert.equal(env.sideEffects, false); assert.deepEqual(env.providers, ["ollama"]); assert.equal(env.localOnly, true);
});

test("S2-T3R forms: field messages instead of a request for missing, impossible or inconsistent input", () => {
  const g = buildGoal({ ...goal, title: " ", criteria: "", expires: "2026-02-30", deadline: "2027-01-01" }, NOW);
  assert.equal(g.ok, false);
  if (!g.ok) assert.deepEqual(Object.keys(g.errors).sort(), ["criteria", "expires", "title"]);
  const late = buildGoal({ ...goal, deadline: "2027-01-01" }, NOW);
  assert.equal(!late.ok && late.errors.deadline, "The deadline must not be after the end date.");
  const s = buildSchedule({ ...sched, time: "25:00", model: "", paths: "a,b,c,d,e", maxModelCalls: 1, starts: "2026-12-31" }, NOW);
  assert.equal(s.ok, false);
  if (!s.ok) assert.deepEqual(Object.keys(s.errors).sort(), ["maxModelCalls", "model", "paths", "starts", "time"]);
  const w = buildSchedule({ ...sched, when: "weekly", days: [] }, NOW);
  assert.equal(!w.ok && w.errors.days, "Pick at least one day.");
  const m = buildMonitor({ ...mon, field: "status.value", everyMinutes: 0.5, label: "x".repeat(61) }, NOW);
  assert.equal(m.ok, false);
  if (!m.ok) assert.deepEqual(Object.keys(m.errors).sort(), ["everyMinutes", "field", "label"]);
  assert.equal(endOfDay("2026-02-29"), null); assert.notEqual(endOfDay("2028-02-29"), null);
});
