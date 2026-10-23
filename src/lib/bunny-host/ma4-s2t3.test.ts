// MA4-S2-T3 proactive companion: deterministic qualification (docs/ma4-s2-t3/*). Real stores, runtime, broker and file
// connector on SQLite files; one fake clock for everything; a recorded fake local model; recorded synthetic sources.
// Nothing here sends mail, posts, buys, deletes or reaches a network.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { classify, decide, deliverAt, localToUtc, MonitorSpecSchema, nextSlot, observation, OUTCOMES, sanitize, ScheduleSpecSchema, slotsBetween, type DecisionFacts } from "./ma4/proactive.ts";
import { ProactiveStore } from "./ma4/proactive-store.server.ts";
import { ProactiveEngine } from "./ma4/proactive.server.ts";
import { PROACTIVE_ACTIONS, proactiveCommand } from "./ma4/proactive-commands.server.ts";
import { assertDeviceAction, deviceRight, WorkstationRequiredError } from "./device-authority.server.ts";
import { HostDatabase } from "./persistence.server.ts";
import { TaskStore } from "./ma4/task-store.server.ts";
import { PersistentTaskRuntime, type Executor } from "./ma4/task-runtime.server.ts";
import { sha256 } from "./ma4/task-runtime.ts";
import { fakeModel } from "./ma4-s2t2-fixtures.ts";
import { DAY, envelope, goal, HOUR, MIN, MODEL, monitor, PHONE, prig, schedule, summaryAction, T0, WS, type PRig } from "./ma4-s2t3-fixtures.ts";

const iso = (t: number | null) => t === null ? null : new Date(t).toISOString();
const STATUS = "Atlas status: 2 open issues, release candidate 3 built.\n";
async function withRig(fn: (p: PRig) => Promise<void>, o: Parameters<typeof prig>[0] = {}) {
  const p = await prig(o);
  try { p.root("atlas", { "STATUS.md": STATUS, "build/status.json": JSON.stringify({ status: "PASS" }) }); await fn(p); } finally { await p.close(); }
}
const approved = (p: PRig, spec: Record<string, unknown>) => { const s = p.engine.scheduleCreate({ spec }, WS); return p.engine.scheduleApprove(s.id, WS); };
const occurrences = (p: PRig, id: string) => p.engine.store.occurrences(id, 500);

// ── time ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

test("T3-TZ1 local times: exact, nonexistent (spring forward) and ambiguous (fall back) follow the documented policy", () => {
  assert.deepEqual(localToUtc("Asia/Kolkata", { y: 2026, m: 10, d: 24, h: 18, mi: 0 }), { utc: Date.UTC(2026, 9, 24, 12, 30), resolution: "exact" });
  // New York 2026-03-08 02:30 does not exist: moved forward by the gap to 03:30 EDT.
  assert.deepEqual(localToUtc("America/New_York", { y: 2026, m: 3, d: 8, h: 2, mi: 30 }), { utc: Date.UTC(2026, 2, 8, 7, 30), resolution: "nonexistent" });
  // New York 2026-11-01 01:30 happens twice: the earlier instant (EDT) is used.
  assert.deepEqual(localToUtc("America/New_York", { y: 2026, m: 11, d: 1, h: 1, mi: 30 }), { utc: Date.UTC(2026, 10, 1, 5, 30), resolution: "ambiguous" });
  assert.deepEqual(localToUtc("Europe/London", { y: 2026, m: 3, d: 29, h: 1, mi: 30 }).resolution, "nonexistent");
  assert.deepEqual(localToUtc("Australia/Lord_Howe", { y: 2026, m: 4, d: 5, h: 1, mi: 45 }).resolution, "ambiguous"); // a 30-minute DST shift
});

test("T3-TZ2 daily slots across DST: one run per local day, at the same wall time", () => {
  const fall = slotsBetween({ type: "daily", time: "01:30", timeZone: "America/New_York" }, Date.UTC(2026, 9, 30), Date.UTC(2026, 10, 3));
  assert.deepEqual(fall.map(iso), ["2026-10-30T05:30:00.000Z", "2026-10-31T05:30:00.000Z", "2026-11-01T05:30:00.000Z", "2026-11-02T06:30:00.000Z"]);
  const spring = slotsBetween({ type: "daily", time: "02:30", timeZone: "America/New_York" }, Date.UTC(2026, 2, 6), Date.UTC(2026, 2, 10));
  assert.deepEqual(spring.map(iso), ["2026-03-06T07:30:00.000Z", "2026-03-07T07:30:00.000Z", "2026-03-08T07:30:00.000Z", "2026-03-09T06:30:00.000Z"]);
  // London, Mondays only, across the October change.
  assert.deepEqual(slotsBetween({ type: "daily", time: "18:00", timeZone: "Europe/London", days: [1] }, Date.UTC(2026, 9, 15), Date.UTC(2026, 9, 31)).map(iso), ["2026-10-19T17:00:00.000Z", "2026-10-26T18:00:00.000Z"]);
  assert.equal(nextSlot({ type: "once", at: "2026-10-24T18:00", timeZone: "UTC" }, Date.UTC(2026, 9, 24, 18)), null, "a once slot is never repeated");
  assert.equal(slotsBetween({ type: "daily", time: "00:00", timeZone: "UTC" }, 0, Date.UTC(2030, 0, 1)).length, 400, "a huge clock jump is bounded");
  assert.throws(() => ScheduleSpecSchema.parse(schedule({ trigger: { type: "daily", time: "18:00", timeZone: "Mars/Olympus" } })), /IANA/);
});

test("T3-TZ3 quiet hours hold delivery until they end (overnight window, named zone)", () => {
  const prefs = { categories: {}, quietHours: { enabled: true, start: "22:00", end: "07:00", timeZone: "Asia/Kolkata" } };
  const at = Date.UTC(2026, 9, 24, 18, 0); // 23:30 IST
  assert.equal(iso(deliverAt(prefs, at)), "2026-10-25T01:30:00.000Z"); // 07:00 IST
  assert.equal(deliverAt(prefs, Date.UTC(2026, 9, 24, 6, 0)), Date.UTC(2026, 9, 24, 6, 0)); // 11:30 IST, not quiet
});

// ── pure decision and change detection ───────────────────────────────────────────────────────────────────────────────

const facts = (o: Partial<DecisionFacts> = {}): DecisionFacts => ({
  now: T0, intact: true, state: "ACTIVE", specSha256: "a".repeat(64), approval: { by: "workstation", at: T0 - HOUR, expiresAt: T0 + DAY, specSha256: "a".repeat(64) },
  expiresAt: T0 + DAY, envelopeExpiresAt: T0 + DAY, goal: null, change: "meaningful", action: "task", overlapping: false, runsToday: 0, maxRunsPerDay: 4,
  proactiveEnabled: true, activeTasks: 0, maxConcurrentTasks: 1, modelCallsToday: 0, maxModelCallsPerDay: 40, modelSteps: 2, modelsAvailable: true, mayRunUnattended: true, approvalLive: true, ...o,
});
test("T3-D1 decide(): exactly one outcome per trigger, authority before anything else", () => {
  const cases: [Partial<DecisionFacts>, string, boolean?][] = [
    [{}, "queue"], [{ modelSteps: 0 }, "execute"], [{ action: "remind", modelSteps: 0 }, "notify"],
    [{ intact: false }, "fail_safe"], [{ state: "PAUSED" }, "fail_safe"], [{ expiresAt: T0 }, "stop_expired"], [{ envelopeExpiresAt: T0 - 1 }, "stop_expired"],
    [{ approval: null }, "request_approval"], [{ approval: { by: "workstation", at: 0, expiresAt: T0, specSha256: "a".repeat(64) } }, "request_approval"],
    [{ specSha256: "b".repeat(64) }, "request_approval"],
    [{ change: "no_change" }, "record_no_change"], [{ change: "routine_change" }, "record_no_change"], [{ change: "permission_expired" }, "stop_expired"],
    [{ change: "uncertain" }, "fail_safe"], [{ change: "source_unavailable" }, "fail_safe"], [{ change: "invalid" }, "fail_safe"],
    [{ runsToday: 4 }, "defer", false], [{ modelCallsToday: 39 }, "defer", false], [{ overlapping: true }, "defer", true], [{ activeTasks: 1 }, "defer", true],
    [{ modelsAvailable: false }, "defer", true], [{ mayRunUnattended: false }, "defer", true], [{ proactiveEnabled: false }, "defer", false],
    [{ goal: { state: "PAUSED", tasksUsed: 0, maxTasks: 5 } }, "defer", false], [{ goal: { state: "CANCELLED", tasksUsed: 0, maxTasks: 5 } }, "stop_expired"],
    [{ goal: { state: "ACTIVE", tasksUsed: 5, maxTasks: 5 } }, "defer", false],
    // A reminder needs no window and no model; an expired approval still blocks it.
    [{ action: "remind", modelSteps: 0, mayRunUnattended: false }, "notify"], [{ action: "remind", approval: null }, "request_approval"],
  ];
  for (const [o, outcome, transient] of cases) {
    const d = decide(facts(o));
    assert.ok(OUTCOMES.includes(d.outcome));
    assert.equal(d.outcome, outcome, JSON.stringify(o));
    if (transient !== undefined) assert.equal(d.transient, transient, JSON.stringify(o));
  }
});
test("T3-D2 change classification is deterministic and a source cannot hand over a verdict", () => {
  const pass = observation("PASS"), fail = observation("FAIL"), t = { type: "transition" as const, from: "PASS", to: "FAIL" };
  assert.equal(classify(null, pass, t), "routine_change", "a baseline is never news");
  assert.equal(classify(pass.ok ? pass : null, pass, t), "no_change");
  assert.equal(classify(pass.ok ? pass : null, fail, t), "meaningful");
  assert.equal(classify(fail.ok ? fail : null, fail, t), "no_change", "an unchanged failure is not news again");
  assert.equal(classify(fail.ok ? fail : null, pass, t), "routine_change", "recovery is an expected change");
  assert.equal(classify(null, { ok: false, reason: "permission", detail: "" }, t), "permission_expired");
  assert.equal(classify(null, { ok: false, reason: "uncertain", detail: "" }, t), "uncertain");
  // The hash is recomputed from the value; a forged sha or verdict in the payload changes nothing.
  assert.deepEqual(observation("FAIL"), { ok: true, value: "FAIL", sha256: sha256("FAIL") });
  assert.equal(observation({ value: "FAIL", matched: true }).ok, false, "objects are not values");
  assert.throws(() => MonitorSpecSchema.parse(monitor({ source: { kind: "url", url: "https://example.com/status" } })), "there is no internet source");
  assert.equal(sanitize("at C:\\Users\\me\\x.txt token sk-abcdefghijklmnopqrstuvwx"), "at [path] token [redacted]");
});

// ── goals ────────────────────────────────────────────────────────────────────────────────────────────────────────────

test("T3-G1 goal lifecycle: proposed, approved on the PC only, progress only from completed task receipts", () => withRig(async p => {
  const g = p.engine.goalCreate({ spec: goal(), suggested: true }, WS);
  assert.equal(g.state, "AWAITING_APPROVAL");
  assert.equal(g.origin, "suggested");
  assert.equal(p.engine.store.transitions("goal", g.id)[0].to, "PROPOSED");
  await assert.rejects(proactiveCommand(p.engine, "goal.approve", { id: g.id }, PHONE), WorkstationRequiredError);
  assert.throws(() => p.engine.goalCreate({ spec: goal() }, PHONE), /workstation/);
  assert.equal(p.engine.goalApprove(g.id, WS).state, "ACTIVE");
  // Work: one task completes with receipts, one fails, one has only a model's claim that it is done.
  const ok = p.rt.create({ spec: { title: "Run regression", projectId: "p1", steps: [{ id: "read", kind: "file.read", input: { root: "atlas", path: "STATUS.md" } }], acceptance: { requiredSteps: ["read"] } }, envelope: envelope(["file.read"], { files: [{ root: "atlas", access: "read" }] }) }, WS);
  const bad = p.rt.create({ spec: { title: "Draft notes", projectId: "p1", steps: [{ id: "read", kind: "file.read", input: { root: "atlas", path: "MISSING.md" } }], acceptance: { requiredSteps: ["read"] } }, envelope: envelope(["file.read"], { files: [{ root: "atlas", access: "read" }] }) }, WS);
  p.engine.goalLink(g.id, "tests", ok.id, WS);
  p.engine.goalLink(g.id, "notes", bad.id, WS);
  assert.throws(() => p.engine.goalLink(g.id, "nope", ok.id, WS), /criterion/);
  await p.tick();
  let view = p.engine.snapshot().goals[0];
  assert.deepEqual(view.progress, { met: 1, total: 3 });
  assert.equal(view.criteria[0].met, true);
  assert.equal(view.criteria[0].evidence.length, 1);
  assert.equal(view.criteria[1].met, false, "a failed task meets nothing");
  assert.equal(view.state, "NEEDS_ATTENTION");
  assert.equal(p.notes("goal_milestone").length, 1);
  await p.tick(); await p.tick();
  assert.equal(p.notes("goal_milestone").length, 1, "milestones are not repeated");
  // Relinking a fresh task clears attention; completing the rest completes the goal.
  for (const [crit, path] of [["notes", "STATUS.md"], ["build", "STATUS.md"]]) {
    const t = p.rt.create({ spec: { title: crit, projectId: "p1", steps: [{ id: "read", kind: "file.read", input: { root: "atlas", path } }], acceptance: { requiredSteps: ["read"] } }, envelope: envelope(["file.read"], { files: [{ root: "atlas", access: "read" }] }) }, WS);
    p.engine.goalLink(g.id, crit, t.id, WS);
  }
  await p.tick();
  view = p.engine.snapshot().goals[0];
  assert.equal(view.state, "COMPLETED");
  assert.deepEqual(view.progress, { met: 3, total: 3 });
  assert.equal(p.notes("goal_milestone").length, 4);
}));

test("T3-G2 goal expiry, pause from the phone, and project isolation of links", () => withRig(async p => {
  const g = p.engine.goalApprove(p.engine.goalCreate({ spec: goal({ expiresAt: T0 + 2 * DAY }) }, WS).id, WS);
  assert.equal((await proactiveCommand(p.engine, "goal.pause", { id: g.id }, PHONE) as { state: string }).state, "PAUSED");
  assert.equal((await proactiveCommand(p.engine, "goal.resume", { id: g.id }, PHONE) as { state: string }).state, "ACTIVE");
  const other = p.rt.create({ spec: { title: "x", projectId: "p2", steps: [{ id: "read", kind: "file.read", input: { root: "atlas", path: "STATUS.md" } }], acceptance: { requiredSteps: ["read"] } }, envelope: envelope(["file.read"], { files: [{ root: "atlas", access: "read" }] }, { projectScopes: ["p2"] }) }, WS);
  assert.throws(() => p.engine.goalLink(g.id, "tests", other.id, WS), /another project/);
  await p.at(T0 + 3 * DAY);
  assert.equal(p.engine.snapshot().goals[0].state, "EXPIRED");
  assert.equal(p.notes("permission_expired").length, 1);
}));

// ── schedules ────────────────────────────────────────────────────────────────────────────────────────────────────────

test("T3-S1 one-time reminder fires once, honours quiet hours, snooze and dismiss, then completes", () => withRig(async p => {
  p.engine.setPrefs({ quietHours: { enabled: true, start: "22:00", end: "07:00", timeZone: "UTC" } }, WS);
  const s = approved(p, schedule({ title: "Review the beta build", trigger: { type: "once", at: "2026-10-24T23:00", timeZone: "UTC" }, action: { type: "remind", text: "Review the beta build." }, expiresAt: T0 + 7 * DAY }));
  await p.at(T0 + 6 * HOUR);
  assert.equal(p.notes("reminder_due").length, 0, "not yet due");
  await p.at(Date.UTC(2026, 9, 24, 23, 0, 5));
  const [n] = p.notes("reminder_due");
  assert.ok(n, "recorded at its time");
  assert.equal(n.delivered, false, "held by quiet hours");
  assert.equal(p.engine.snapshot().held, 1);
  await p.at(Date.UTC(2026, 9, 25, 7, 0));
  assert.equal(p.notes("reminder_due")[0].delivered, true);
  assert.equal(p.engine.snapshot().notifications.filter(x => x.category === "reminder_due").length, 1);
  assert.equal((await proactiveCommand(p.engine, "proactive.notification.snooze", { key: n.key, minutes: 30 }, PHONE) as { snoozed: boolean }).snoozed, true);
  const shown = () => p.engine.snapshot().notifications.filter(x => x.category === "reminder_due").length;
  assert.equal(shown(), 0, "snoozed");
  await p.at(Date.UTC(2026, 9, 25, 7, 31));
  assert.equal(shown(), 1, "back after the snooze");
  await proactiveCommand(p.engine, "proactive.notification.dismiss", { key: n.key }, PHONE);
  assert.equal(shown(), 0);
  assert.equal(p.engine.snapshot().schedules.find(x => x.id === s.id)!.state, "COMPLETED");
  await p.at(Date.UTC(2026, 9, 26));
  assert.equal(p.notes("reminder_due").length, 1, "never twice");
  // A disabled category is recorded but never shown.
  p.engine.setPrefs({ categories: { reminder_due: false } }, WS);
  approved(p, schedule({ title: "Muted", trigger: { type: "once", at: "2026-10-26T12:00", timeZone: "UTC" }, action: { type: "remind", text: "Muted." }, expiresAt: T0 + 7 * DAY }));
  await p.at(Date.UTC(2026, 9, 26, 12, 1));
  assert.equal(p.notes("reminder_due").length, 2);
  assert.equal(p.engine.snapshot().notifications.filter(x => x.category === "reminder_due").length, 0);
}));

test("T3-S2 recurring scheduled summary: once per day, approved by the schedule, real receipts, one completion notice each", () => withRig(async p => {
  const s = approved(p, schedule());
  assert.equal(s.state, "ACTIVE");
  assert.equal(iso(s.nextAt), "2026-10-24T18:00:00.000Z");
  for (let day = 0; day < 3; day++) {
    await p.at(Date.UTC(2026, 9, 24 + day, 18, 0, 2));
    await p.at(Date.UTC(2026, 9, 24 + day, 18, 5));
  }
  const tasks = p.tasks();
  assert.equal(tasks.length, 3);
  assert.ok(tasks.every(t => t.state === "COMPLETED" && t.evidence.length === 3), JSON.stringify(tasks.map(t => [t.state, t.failure])));
  // The schedule (not a person) approved each occurrence, binding the same spec and envelope hashes.
  const tr = p.rt.store.transitions(tasks[0].id);
  assert.ok(tr.some(x => x.actor === `schedule:${s.id}` && x.to === "QUEUED"));
  assert.equal(p.notes("task_completed").length, 3);
  assert.deepEqual(p.model.prompts.map(x => x.role), ["Worker", "Reviewer", "Worker", "Reviewer", "Worker", "Reviewer"]);
  assert.ok(p.engine.lateness.every(l => l <= 5_000), String(p.engine.lateness));
  // The occurrence task's deadline is the run window, and the spec is otherwise exactly the approved template.
  const rec = p.rt.store.get(tasks[0].id).record;
  assert.equal(rec.spec.deadlineAt, Date.UTC(2026, 9, 24, 18, 0, 2) + HOUR, "the run window starts when the run starts");
  assert.deepEqual({ ...rec.spec, deadlineAt: undefined }, { ...ScheduleSpecSchema.parse(schedule()).action.spec, deadlineAt: undefined } as never);
}));

test("T3-S3 (adv 1) duplicate trigger after Host restart: one occurrence, one task", () => withRig(async p => {
  const s = approved(p, schedule());
  await p.at(Date.UTC(2026, 9, 24, 18, 0, 1));
  await p.restart();
  await p.tick();
  await p.restart();
  await p.at(Date.UTC(2026, 9, 24, 18, 3));
  assert.equal(occurrences(p, s.id).length, 1);
  assert.equal(p.tasks().length, 1);
}));

test("T3-S4 (adv 2, 21) missed while asleep or with the clock jumping: skip records, run_once runs only the latest", () => withRig(async p => {
  const skip = approved(p, schedule({ title: "Skip" }));
  const once = approved(p, schedule({ title: "Catch up", missedPolicy: "run_once", trigger: { type: "daily", time: "18:30", timeZone: "UTC" } }));
  // The PC sleeps for three days: no tick between.
  await p.at(Date.UTC(2026, 9, 27, 20, 0));
  const skipOcc = occurrences(p, skip.id), onceOcc = occurrences(p, once.id);
  assert.equal(p.tasks().filter(t => t.title === "Project summary").length, 1, "only the run_once schedule ran, once");
  assert.ok(skipOcc.every(o => o.outcome === "missed"));
  assert.equal(onceOcc.filter(o => o.taskId).length, 1);
  assert.equal(p.notes("schedule_missed").length, 3, "one for skip's backlog, one for skip's latest, one for run_once's backlog");
  assert.ok(p.engine.store.gapsSince(0).some(g => g.kind === "asleep"), "the sleep is recorded");
  assert.match(p.engine.snapshot().away!.text, /asleep for .*nothing ran then/);
  // Clock moves backwards by a day: nothing fires again.
  const before = p.engine.store.occurrencesSince(0).length;
  await p.at(Date.UTC(2026, 9, 26, 18, 31));
  await p.at(Date.UTC(2026, 9, 27, 20, 1));
  assert.equal(p.engine.store.occurrencesSince(0).length, before);
  assert.equal(p.tasks().length, 1);
}));

test("T3-S5 (adv 3) an approval that expired before the slot: nothing runs, the owner is asked again", () => withRig(async p => {
  const s = p.engine.scheduleCreate({ spec: schedule() }, WS);
  p.engine.scheduleApprove(s.id, WS, { ttlMs: HOUR });
  await p.at(Date.UTC(2026, 9, 24, 18, 0, 1));
  assert.equal(p.tasks().length, 0);
  const v = p.engine.snapshot().schedules[0];
  assert.equal(v.state, "AWAITING_APPROVAL");
  assert.equal(p.notes("permission_expired").length, 1);
  // Approving again covers only slots from now on: the missed 18:00 is not replayed.
  p.engine.scheduleApprove(s.id, WS);
  await p.at(Date.UTC(2026, 9, 24, 18, 10));
  assert.equal(p.tasks().length, 0);
  await p.at(Date.UTC(2026, 9, 25, 18, 0, 1));
  assert.equal(p.tasks().length, 1);
}));

test("T3-S6 (adv 9, 17) changed or tampered schedules never run on an old approval", () => withRig(async p => {
  const s = approved(p, schedule());
  p.engine.scheduleUpdate(s.id, schedule({ trigger: { type: "daily", time: "17:00", timeZone: "UTC" } }), WS);
  await p.at(Date.UTC(2026, 9, 24, 18, 1));
  assert.equal(p.tasks().length, 0);
  assert.equal(p.engine.snapshot().schedules[0].state, "AWAITING_APPROVAL");
  // Direct database tamper: widen the envelope's capabilities behind the Host's back.
  const s2 = approved(p, schedule({ title: "Tampered" }));
  const row = p.db.db.prepare("SELECT record FROM ma4_proactive WHERE kind='schedule' AND id=?").get(s2.id) as { record: string };
  const rec = JSON.parse(row.record);
  rec.spec.action.envelope.sideEffects = true;
  p.db.db.prepare("UPDATE ma4_proactive SET record=? WHERE kind='schedule' AND id=?").run(JSON.stringify(rec), s2.id);
  await p.at(Date.UTC(2026, 9, 25, 18, 1));
  assert.equal(p.tasks().length, 0);
  assert.equal(p.engine.snapshot().corrupt.length, 1);
  assert.match(p.engine.snapshot().corrupt[0].detail, /integrity/);
  // Malformed JSON, too.
  p.db.db.prepare("UPDATE ma4_proactive SET record='{oops' WHERE kind='schedule' AND id=?").run(s2.id);
  await p.at(Date.UTC(2026, 9, 26, 18, 1));
  assert.equal(p.tasks().length, 0);
}));

test("T3-S7 (adv 10) two Host instances on one database: every slot decided once", () => withRig(async p => {
  const s = approved(p, schedule());
  const second = new ProactiveEngine({ store: new ProactiveStore(new HostDatabase(join(p.dir, "data", "host.sqlite"))), runtime: p.rt, roots: p.connected.roots, modelAvailable: async () => true, uiAttached: () => true, now: () => p.clock.t, timers: false });
  p.clock.t = Date.UTC(2026, 9, 24, 18, 0, 1);
  await Promise.all([p.engine.tick(), second.tick(), p.engine.tick(), second.tick()]);
  await p.tick();
  assert.equal(occurrences(p, s.id).length, 1);
  assert.equal(p.tasks().length, 1);
  await second.close();
  second.store.host.close();
}));
