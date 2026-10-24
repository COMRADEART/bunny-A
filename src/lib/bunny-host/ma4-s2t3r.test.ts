// MA4-S2-T3R: Host behaviour behind the creation UIs and the Approval Center, and the milestone's adversarial cases
// (docs/ma4-s2t3r/SECURITY_VALIDATION.md). Same rigs as S2-T2/S2-T3: real stores, runtime, broker and engine on SQLite
// files, a fake clock, a recorded fake model and the recorded synthetic workspace. Nothing external is reached.
import test from "node:test";
import assert from "node:assert/strict";
import { ScheduleSpecSchema, slotNote } from "./ma4/proactive.ts";
import { proactiveCommand } from "./ma4/proactive-commands.server.ts";
import { actionContext, ptaskCommand } from "./ma4/task-commands.server.ts";
import { WorkstationRequiredError } from "./device-authority.server.ts";
import { ProactiveEngine } from "./ma4/proactive.server.ts";
import { ProactiveStore } from "./ma4/proactive-store.server.ts";
import { localModelCall } from "./ma4/task-executors.server.ts";
import { create, rig, workspace } from "./ma4-s2t2-fixtures.ts";
import { DAY, envelope, goal, HOUR, MIN, MODEL, monitor, PHONE, prig, schedule, summaryAction, T0, WS, type PRig } from "./ma4-s2t3-fixtures.ts";

async function withRig(fn: (p: PRig) => Promise<void>) {
  const p = await prig();
  try { p.root("atlas", { "STATUS.md": "Atlas status.\n", "build/status.json": JSON.stringify({ status: "PASS" }) }); await fn(p); } finally { await p.close(); }
}
const once = (at: string, timeZone = "UTC") => ({ type: "once", at, timeZone });

test("T3R-T1 invalid dates, times, zones and recurrences are refused, not normalized", () => {
  for (const trigger of [once("2026-02-30T09:00"), once("2026-13-01T09:00"), once("2025-02-29T09:00"), once("2026-04-31T09:00"), once("2026-10-24T24:00"), once("2026-10-24T09:00", "Mars/Olympus"),
    { type: "daily", time: "9:00", timeZone: "UTC" }, { type: "daily", time: "09:00", timeZone: "UTC", days: [7] }, { type: "daily", time: "09:00", timeZone: "UTC", days: [] }, { type: "hourly", every: 1 }])
    assert.equal(ScheduleSpecSchema.safeParse(schedule({ trigger })).success, false, JSON.stringify(trigger));
  assert.equal(ScheduleSpecSchema.safeParse(schedule({ trigger: once("2028-02-29T09:00") })).success, true, "a real leap day is accepted");
});

test("T3R-T2 DST notes say exactly what will happen to a nonexistent or repeated local time", () => {
  const spring = { type: "daily" as const, time: "02:30", timeZone: "America/New_York" }, fall = { type: "daily" as const, time: "01:30", timeZone: "America/New_York" };
  assert.match(slotNote(spring, Date.UTC(2026, 2, 8, 7, 30))!, /02:30 does not exist on 2026-03-08 .* runs at 03:30/);
  assert.match(slotNote(fall, Date.UTC(2026, 10, 1, 5, 30))!, /01:30 happens twice on 2026-11-01 .* runs once, at the first/);
  assert.equal(slotNote(spring, Date.UTC(2026, 2, 9, 6, 30)), null);
});

test("T3R-T3 schedule preview: next runs, what it does and reads, model use, approvals and expiry; creates nothing", () => withRig(async p => {
  const before = p.engine.store.list("schedule").length;
  const v = p.engine.previewSchedule(schedule({ trigger: { type: "daily", time: "18:00", timeZone: "Europe/London", days: [1, 3] } }), WS);
  assert.ok(v.ok, JSON.stringify(v.problems));
  if (!("next" in v)) throw new Error("no preview");
  assert.equal(v.next.length, 3);
  assert.deepEqual(v.next.map(n => new Date(n.at).toISOString()), ["2026-10-26T18:00:00.000Z", "2026-10-28T18:00:00.000Z", "2026-11-02T18:00:00.000Z"]);
  assert.deepEqual(v.willDo, ["Read STATUS.md in folder \"atlas\"", `Write text with the local model ${MODEL} (Worker)`, `Check that result with the local model ${MODEL} (Reviewer)`]);
  assert.deepEqual(v.reads, ["Folder \"atlas\" (read)"]);
  assert.deepEqual(v.model, { runs: true, calls: 2, models: [MODEL] });
  assert.deepEqual(v.approvals, []);
  assert.equal(v.background, true);
  assert.equal(p.engine.store.list("schedule").length, before, "a preview stores nothing");
  // DST note in the preview, and problems instead of a preview for an invalid or unauthorized schedule.
  const ny = p.engine.previewSchedule(schedule({ trigger: { type: "once", at: "2026-11-01T01:30", timeZone: "America/New_York" } }), WS);
  if (!("next" in ny) || !ny.next) throw new Error("no preview");
  assert.match(ny.next[0].note!, /happens twice/);
  const bad = p.engine.previewSchedule(schedule({ trigger: once("2026-02-30T09:00") }), WS);
  assert.equal(bad.ok, false); assert.match(bad.problems.join(), /does not exist/);
  const wrongFolder = p.engine.previewSchedule(schedule({ action: { ...summaryAction(), spec: { ...summaryAction().spec, steps: [{ id: "read", kind: "file.read", input: { root: "home", path: "x" }, model: null }], acceptance: { requiredSteps: ["read"] } } } }), WS);
  assert.equal(wrongFolder.ok, false, "a template that reads outside its grants is refused before approval");
  await assert.rejects(proactiveCommand(p.engine, "schedule.preview", { spec: schedule() }, PHONE), WorkstationRequiredError);
}));

test("T3R-T4 monitor and goal previews describe the read, the condition, cost and the progress rule", () => withRig(async p => {
  const m = p.engine.previewMonitor(monitor(), WS);
  assert.ok(m.ok);
  if (!("reads" in m)) throw new Error("no preview");
  assert.equal(m.reads, "the \"status\" field of build/status.json in folder \"atlas\"");
  assert.equal(m.condition, "when it changes from \"PASS\" to \"FAIL\"");
  assert.equal(m.checksPerHour, 12); assert.deepEqual(m.model, { runs: false });
  assert.equal(p.engine.store.observations("x").length, 0);
  assert.equal(p.engine.previewMonitor(monitor({ intervalMs: 5_000 }), WS).ok, false);
  const g = p.engine.previewGoal(goal(), WS);
  assert.ok(g.ok);
  if (!("progressRule" in g)) throw new Error("no preview");
  assert.match(g.progressRule, /verified step receipts/);
  assert.equal(p.engine.previewGoal(goal({ title: "Ship it api_key=sk-abcdefghijklmnopqrstuv" }), WS).ok, false);
}));

test("T3R-A1 malicious goal and schedule text is stored inert and shown sanitized; credentials are refused", () => withRig(async p => {
  const g = p.engine.goalCreate({ spec: goal({ title: "<img src=x onerror=alert(1)> Release", description: String.raw`See C:\Users\me\secrets\plan.txt` + "\n    at evil (x.js:1:1)" }) }, WS);
  assert.equal(g.title, "<img src=x onerror=alert(1)> Release", "kept as text; React renders it escaped");
  const view = p.engine.snapshot().goals[0];
  assert.doesNotMatch(JSON.stringify(view), /C:\\\\Users/);
  assert.throws(() => p.engine.goalCreate({ spec: goal({ title: "x".repeat(121) }) }, WS));
  assert.throws(() => p.engine.goalCreate({ spec: goal({ description: "token: ghp_abcdefghijklmnopqrstuvwxyz0123" }) }, WS), /credential/);
  assert.throws(() => p.engine.scheduleCreate({ spec: schedule({ action: { type: "remind", text: "Bearer abcdefghijklmnopqrstu" } }) }, WS), /credential/);
}));

test("T3R-A2 forged or stale approvals: wrong version, phone, tampered approval record", () => withRig(async p => {
  const s = p.engine.scheduleCreate({ spec: schedule() }, WS);
  await assert.rejects(proactiveCommand(p.engine, "schedule.approve", { id: s.id, version: s.version + 5 }, WS), /changed since this view/);
  await assert.rejects(proactiveCommand(p.engine, "schedule.approve", { id: s.id }, PHONE), WorkstationRequiredError);
  // A stale UI approving after the owner changed the schedule elsewhere: the version moved, so nothing is approved.
  p.engine.scheduleUpdate(s.id, schedule({ title: "Changed elsewhere" }), WS);
  await assert.rejects(proactiveCommand(p.engine, "schedule.approve", { id: s.id, version: s.version }, WS), /changed since this view/);
  // An approval written straight into the database (no owner command) breaks the record hash and never runs.
  const row = p.db.db.prepare("SELECT record FROM ma4_proactive WHERE kind='schedule' AND id=?").get(s.id) as { record: string };
  const rec = JSON.parse(row.record);
  Object.assign(rec, { state: "ACTIVE", approval: { by: "workstation", at: T0, expiresAt: T0 + DAY, specSha256: rec.specSha256 } });
  p.db.db.prepare("UPDATE ma4_proactive SET record=?,state='ACTIVE' WHERE kind='schedule' AND id=?").run(JSON.stringify(rec), s.id);
  await p.at(Date.UTC(2026, 9, 24, 18, 1));
  assert.equal(p.tasks().length, 0);
  assert.equal(p.engine.snapshot().corrupt.length, 1);
}));

test("T3R-A3 no recurring authority from anywhere but the owner's command: tasks, monitors and pages cannot create schedules", () => withRig(async p => {
  const kinds = [...p.rt.executorFacts().keys()];
  assert.equal(kinds.some(k => /schedule|monitor|goal/.test(k)), false, "no executor can create proactive records");
  for (const action of ["schedule.create", "monitor.create", "goal.create", "goal.link"]) await assert.rejects(proactiveCommand(p.engine, action, { spec: schedule(), id: "g", criterionId: "c", taskId: "t" }, PHONE), WorkstationRequiredError);
  approved(p, schedule());
  await p.at(Date.UTC(2026, 9, 24, 18, 5));
  assert.equal(p.engine.store.list("schedule").length, 1, "running a scheduled task created no other schedule");
}));
const approved = (p: PRig, spec: Record<string, unknown>) => p.engine.scheduleApprove(p.engine.scheduleCreate({ spec }, WS).id, WS);

test("T3R-A4 a UI that submits an inconsistent scope is refused by the Host, not trusted", () => withRig(async p => {
  const a = summaryAction();
  // The envelope grants folder atlas; a step names another root.
  assert.throws(() => p.engine.scheduleCreate({ spec: schedule({ action: { ...a, spec: { ...a.spec, steps: [{ id: "read", kind: "file.read", input: { root: "other", path: "x" }, model: null }], acceptance: { requiredSteps: ["read"] } } } }) }, WS));
  // A model pinned in a step but not in the envelope.
  assert.throws(() => p.engine.scheduleCreate({ spec: schedule({ action: { ...a, spec: { ...a.spec, steps: a.spec.steps.map(s => s.model ? { ...s, model: "llama-not-pinned" } : s) } } }) }, WS), /not in the envelope/);
  // A capability the envelope does not grant.
  assert.throws(() => p.engine.scheduleCreate({ spec: schedule({ action: { ...a, envelope: { ...a.envelope, capabilities: ["file.read"] } } }) }, WS), /capability/);
  // A cloud provider or non-local flag is not expressible.
  assert.throws(() => p.engine.scheduleCreate({ spec: schedule({ action: { ...a, envelope: { ...a.envelope, providers: ["openai"] } } }) }, WS));
  assert.throws(() => p.engine.scheduleCreate({ spec: schedule({ action: { ...a, envelope: { ...a.envelope, localOnly: false } } }) }, WS));
  // A goal whose permitted actions exclude what the schedule needs.
  const g = p.engine.goalApprove(p.engine.goalCreate({ spec: goal({ permittedActions: ["file.read"] }) }, WS).id, WS);
  assert.throws(() => p.engine.scheduleCreate({ spec: schedule({ goal: { id: g.id, criterionId: "tests" } }) }, WS), /does not permit local.generate/);
}));

test("T3R-A5 Approval Center context names the task, schedule, role, effect class, exact scope and recovery", async () => {
  const w = workspace();
  const r = await rig({ services: w });
  try {
    const ME = "me@example.test";
    r.root("atlas", { "ISSUES.md": "- [ ] login timeout\n" });
    const steps = [{ id: "issues", kind: "file.read", input: { root: "atlas", path: "ISSUES.md" } }, { id: "send", kind: "email.send", input: { account: ME, to: "lead@example.test", subject: "Status", body: "Two open issues." } }];
    const t = create(r, steps, { files: [{ root: "atlas", access: "read" }], services: [{ connector: "email", account: ME, access: "send", recipients: ["lead@example.test"] }] }, { sideEffects: true }, "Status email");
    const waiting = await r.run(t.id);
    assert.equal(waiting.state, "AWAITING_APPROVAL");
    const ctx = actionContext(r.rt, t.id, { taskContext: () => ({ schedule: "Daily status reply", goal: "Beta" }) })!;
    assert.equal(ctx.task, "Status email"); assert.equal(ctx.step, "send (step 2 of 2)"); assert.equal(ctx.role, "Worker"); assert.equal(ctx.operation, "email.send");
    assert.match(ctx.sideEffect, /consequential, cannot be undone/);
    assert.deepEqual(ctx.scope, ["Folder atlas (read)", "email account me@example.test (send; only to lead@example.test)"]);
    assert.match(ctx.recovery, /checks .* whether it was already applied/);
    assert.match(ctx.expected, /\. \S/, "outcome sentences are separated");
    assert.equal(ctx.schedule, "Daily status reply"); assert.equal(ctx.goal, "Beta");
    // The command returns it to the workstation only; a phone gets WORKSTATION_REQUIRED and the stale-payload approval does nothing.
    const inspected = await ptaskCommand(r.rt, "action.inspect", { id: t.id }, WS, r.connected) as { context: { scope: string[] } };
    assert.equal(inspected.context.scope.length, 2);
    await assert.rejects(ptaskCommand(r.rt, "action.inspect", { id: t.id }, PHONE, r.connected), WorkstationRequiredError);
    await assert.rejects(ptaskCommand(r.rt, "action.approve", { id: t.id, actionId: waiting.pendingAction!.actionId, payloadSha256: "e".repeat(64) }, WS, r.connected), /changed since you reviewed/);
    assert.equal(w.sent.length, 0);
    // Cancel associated task from the Approval Center: nothing is sent.
    await ptaskCommand(r.rt, "ptask.cancel", { id: t.id }, WS, r.connected);
    assert.equal(w.sent.length, 0);
    const cancelled = r.rt.view(t.id) as import("./ma4/task-runtime.ts").TaskView;
    assert.equal(cancelled.state, "CANCELLED"); assert.equal(cancelled.pendingAction, null, "a cancelled task offers no action to approve");
    await assert.rejects(ptaskCommand(r.rt, "action.approve", { id: t.id, actionId: waiting.pendingAction!.actionId, payloadSha256: waiting.pendingAction!.payloadSha256 }, WS, r.connected));
  } finally { await r.close(); }
});

test("T3R-A6 duplicate scheduling after restart and two engines stays at one task per slot (S2-T3 guard, re-checked)", () => withRig(async p => {
  approved(p, schedule());
  p.clock.t = Date.UTC(2026, 9, 24, 18, 0, 1);
  const second = new ProactiveEngine({ store: new ProactiveStore(p.db), runtime: p.rt, roots: p.connected.roots, modelAvailable: async () => true, uiAttached: () => true, now: () => p.clock.t, timers: false });
  await Promise.all([p.engine.tick(), second.tick()]);
  await p.restart(); await p.at(Date.UTC(2026, 9, 24, 18, 3));
  assert.equal(p.tasks().length, 1);
  await second.close();
  void HOUR; void MIN; void envelope;
}));

test("T3R-T5 a start date holds back every run until it arrives; preview and the schedule agree", () => withRig(async p => {
  const startsAt = Date.UTC(2026, 9, 27, 0, 0), spec = schedule({ startsAt });
  const v = p.engine.previewSchedule(spec, WS);
  if (!("next" in v) || !v.next) throw new Error("no preview");
  assert.equal(v.next[0].at, Date.UTC(2026, 9, 27, 18, 0), "first run is on the start day, not today");
  approved(p, spec);
  await p.at(Date.UTC(2026, 9, 26, 18, 5));
  assert.equal(p.tasks().length, 0, "no run before the start date");
  await p.at(Date.UTC(2026, 9, 27, 18, 3));
  assert.equal(p.tasks().length, 1);
  assert.equal(ScheduleSpecSchema.safeParse(schedule({ startsAt: T0 + 400 * DAY, expiresAt: T0 + 30 * DAY })).success, false, "must start before it ends");
}));

test("T3R-H1 the production model call sends the Reviewer's schema and temperature to Ollama (found by the real-model smoke)", async () => {
  const sent: Record<string, unknown>[] = [], real = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    if (String(url).endsWith("/api/tags")) return new Response(JSON.stringify({ models: [{ name: "pin:7b" }] }));
    sent.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({ model: "pin:7b", response: '{"approved":true,"issues":[]}', done: true, done_reason: "stop" }));
  }) as typeof fetch;
  try {
    const schema = { type: "object", properties: { approved: { type: "boolean" } }, required: ["approved"] };
    const r = await localModelCall({ role: "Reviewer", model: "pin:7b", prompt: "check", schema, signal: new AbortController().signal, attempt: 1, options: { temperature: 0, numPredict: 512 } });
    assert.ok(r.ok);
    assert.deepEqual(sent[0].format, schema); assert.deepEqual(sent[0].options, { num_ctx: 8192, num_predict: 512, temperature: 0 });
    await localModelCall({ role: "Worker", model: "pin:7b", prompt: "write", schema: null, signal: new AbortController().signal, attempt: 1 });
    assert.equal(sent[1].format, undefined, "free text stays free text");
  } finally { globalThis.fetch = real; }
});
