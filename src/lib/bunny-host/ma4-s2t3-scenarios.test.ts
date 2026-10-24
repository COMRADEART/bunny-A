// MA4-S2-T3 end-to-end qualification through the real Host HTTP API (docs/ma4-s2-t3/END_TO_END_QUALIFICATION.md):
// A scheduled project summary, B build-failure watch, C persistent goal, D scheduled connected workflow — each with
// success, denial, cancellation, restart, expiration and deduplication. The Host's runtime and proactive engine share
// one clock: real time plus a test offset, so real timers fire (lateness is measured) and the test can jump ahead.
// Local model = recorded fake (pinned id); services = recorded synthetic workspace. Set S2T3_EVIDENCE=<file> for timings.
import test from "node:test";
import assert from "node:assert/strict";
import { createServer as netServer } from "node:net";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startHost } from "./http.server.ts";
import { localGenerate } from "./ma4/task-executors.server.ts";
import { localReview } from "./ma4/connected-workflow.server.ts";
import { fakeModel, MODEL, TEST_BASE, workspace } from "./ma4-s2t2-fixtures.ts";
import { writeFileSync as save } from "node:fs";

const ME = "me@example.test", MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;
const timings: Record<string, number[]> = {};
const time = (name: string, ms: number) => { (timings[name] ??= []).push(Math.round(ms)); };
async function freePort() { const s = netServer(); await new Promise<void>(r => s.listen(0, "127.0.0.1", r)); const p = (s.address() as { port: number }).port; await new Promise<void>(r => s.close(() => r())); return p; }
const telemetry = async () => ({ at: Date.now(), cpu: { utilization: null, clockMhz: null, temperatureC: null }, memory: { usedBytes: 0, availableBytes: 1, totalBytes: 1 }, gpus: [], notes: ["S2-T3 fixture telemetry"] });
const hhmm = (t: number) => new Date(t).toISOString().slice(11, 16);

type Host = Awaited<ReturnType<typeof startHost>>;
async function bench(o: { model: ReturnType<typeof fakeModel>; services?: ReturnType<typeof workspace> }) {
  mkdirSync(TEST_BASE, { recursive: true });
  const dir = mkdtempSync(join(TEST_BASE, "host3-")), project = join(dir, "project"), cwd = join(dir, "cwd"), stateDir = mkdtempSync(join(tmpdir(), "bunny-s2t3-host-"));
  mkdirSync(join(project, "build"), { recursive: true }); mkdirSync(cwd);
  writeFileSync(join(project, "STATUS.md"), "Atlas status: two open issues (login timeout, onboarding copy); RC3 built.\n");
  writeFileSync(join(project, "build", "status.json"), JSON.stringify({ status: "PASS" }));
  const clock = { offset: 0 };
  const now = () => Date.now() + clock.offset;
  const port = await freePort();
  const options = { dataDirectory: stateDir, root: cwd, port, adapters: [], sample: telemetry,
    ptasks: { executors: [localGenerate, localReview], call: o.model.call, modelAvailable: async (m: string) => m === MODEL, now },
    connected: { allowLoopback: true, services: o.services ?? null },
    proactive: { now, maxSleepMs: 2_000 } };
  let host: Host = await startHost(options);
  const h = () => ({ connection: "close", Authorization: `Bearer ${host.token}`, "Content-Type": "application/json" });
  const command = async (action: string, data: unknown = {}, token?: string) => {
    const r = await fetch(`http://127.0.0.1:${port}/command`, { method: "POST", headers: { ...h(), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ action, data }) });
    return { status: r.status, body: await r.json() as Record<string, any> };
  };
  const state = async (token?: string) => (await fetch(`http://127.0.0.1:${port}/state`, { headers: { ...h(), ...(token ? { Authorization: `Bearer ${token}` } : {}) } })).json() as Promise<Record<string, any>>;
  const ok = (r: { status: number; body: Record<string, any> }) => { assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body.data; };
  /** Polls the Host's own state (no wake) until the predicate holds. */
  const until = async <T,>(pick: (s: Record<string, any>) => T | undefined | null | false, ms = 15_000): Promise<T> => {
    const end = Date.now() + ms;
    for (;;) { const v = pick(await state()); if (v) return v; if (Date.now() > end) throw new Error("timed out waiting for the Host"); await new Promise(r => setTimeout(r, 25)); }
  };
  await state();
  ok(await command("connector.roots.set", { roots: [{ id: "atlas", label: "Atlas project", path: project }] }));
  const b = {
    dir, project, port, clock, now, command, state, ok, until, get host() { return host; },
    /** Jumps the shared clock (only while nothing runs) and wakes the engine through a read command. */
    async jump(to: number) { clock.offset = to - Date.now(); await command("proactive.list"); },
    write(name: string, content: string) { writeFileSync(join(project, name), content); },
    async restart() { await host.close(); host = await startHost(options); await state(); },
    async pair() { const p = await command("pairing.create"); return (await (await fetch(`http://127.0.0.1:${port}/pair`, { method: "POST", headers: { connection: "close", "Content-Type": "application/json" }, body: JSON.stringify({ code: p.body.pairCode, name: "S2T3 phone" }) })).json() as { token: string }).token; },
    async close() { await host.close(); rmSync(dir, { recursive: true, force: true, maxRetries: 10 }); rmSync(stateDir, { recursive: true, force: true, maxRetries: 10 }); },
  };
  return b;
}
type Bench = Awaited<ReturnType<typeof bench>>;
const envelope = (b: Bench, kinds: string[], grants: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ capabilities: [...new Set(kinds)], providers: ["ollama"], localOnly: true, models: [MODEL], projectScopes: ["p1"], sideEffects: false, background: true, budgets: { maxModelCalls: 10, maxWallMs: HOUR }, expiresAt: b.now() + 30 * DAY, grants, ...extra });
/** The next whole minute at least 3 s away (UTC), so creating and approving fit before it. */
const nextMinute = (b: Bench) => Math.ceil((b.now() + 3_000) / MIN) * MIN;
const tasksTitled = (s: Record<string, any>, title: string) => s.persistentTasks.tasks.filter((t: { title: string }) => t.title === title);
const notes = (s: Record<string, any>, category: string) => s.proactive.notifications.filter((n: { category: string }) => n.category === category);
const refusedOnPhone = (r: { status: number; body: Record<string, any> }) => { assert.equal(r.status, 400); assert.equal(r.body.code, "WORKSTATION_REQUIRED"); };

test("T3-E2E-A scheduled project summary: approved, fires on time, reviewed, notified once; restart, cancel, expiry", { timeout: 180_000 }, async () => {
  const model = fakeModel({ Worker: "Atlas: two open issues (login timeout, onboarding copy). RC3 is built." });
  const b = await bench({ model });
  try {
    const phone = await b.pair();
    const slot = nextMinute(b);
    const steps = [{ id: "read", kind: "file.read", input: { root: "atlas", path: "STATUS.md" }, model: null },
      { id: "sum", kind: "local.generate", input: { prompt: "Summarize the project status in three lines.", contextFrom: "read" }, model: MODEL },
      { id: "check", kind: "local.review", input: { criteria: "Every statement is supported by the sources.", subjectFrom: "sum", contextFrom: "read" }, model: MODEL }];
    const spec = { title: "Evening summary", projectId: "p1", trigger: { type: "daily", time: hhmm(slot), timeZone: "UTC" }, expiresAt: b.now() + 7 * DAY,
      action: { type: "task", spec: { title: "Project summary", projectId: "p1", steps, acceptance: { requiredSteps: ["read", "sum", "check"] } }, envelope: envelope(b, steps.map(s => s.kind), { files: [{ root: "atlas", access: "read" }] }) } };
    // Denial: the phone cannot create or approve; an unapproved schedule never runs.
    refusedOnPhone(await b.command("schedule.create", { spec }, phone));
    const created = b.ok(await b.command("schedule.create", { spec }));
    refusedOnPhone(await b.command("schedule.approve", { id: created.id }, phone));
    assert.equal(created.state, "AWAITING_APPROVAL");
    b.ok(await b.command("schedule.approve", { id: created.id }));
    // Restart before the slot: the approved schedule survives and fires once, on time.
    await b.restart();
    assert.equal((await b.state()).proactive.schedules[0].nextAt, slot);
    await b.jump(slot - 300);
    const done = await b.until(s => tasksTitled(s, "Project summary").find((t: { state: string }) => t.state === "COMPLETED"));
    time("A.lateness_ms", b.host.proactive.lateness[0]);
    time("A.fire_to_completed_ms", b.now() - slot);
    assert.ok(b.host.proactive.lateness[0] < 2_000, `fired ${b.host.proactive.lateness[0]} ms late`);
    assert.equal(done.evidence.length, 3);
    await b.until(s => notes(s, "task_completed").length === 1);
    // Dedup: restarts and later ticks change nothing.
    await b.restart(); await b.jump(slot + 5 * MIN); await b.restart(); await b.jump(slot + 6 * MIN);
    let s = await b.state();
    assert.equal(tasksTitled(s, "Project summary").length, 1);
    assert.equal(notes(s, "task_completed").length, 1);
    assert.deepEqual(model.prompts.map(p => p.role), ["Worker", "Reviewer"]);
    // The phone sees the schedule, its next run and the notification — no paths or prompts.
    const onPhone = await b.state(phone);
    assert.equal(onPhone.proactive.schedules[0].nextAt, slot + DAY);
    assert.equal(JSON.stringify(onPhone.proactive).includes(b.project), false);
    assert.equal(JSON.stringify(onPhone.proactive).includes("Summarize the project"), false);
    // Cancellation from the phone: the next day passes with no run.
    assert.equal(b.ok(await b.command("schedule.cancel", { id: created.id }, phone)).state, "CANCELLED");
    await b.jump(slot + DAY + MIN);
    s = await b.state();
    assert.equal(tasksTitled(s, "Project summary").length, 1);
    // Expiration: a one-hour approval lapses before the next slot; the owner is asked again and nothing runs.
    const second = b.ok(await b.command("schedule.create", { spec: { ...spec, title: "Short approval", trigger: { type: "daily", time: hhmm(slot), timeZone: "UTC" } } }));
    b.ok(await b.command("schedule.approve", { id: second.id, ttlMs: HOUR }));
    await b.jump(slot + 2 * DAY + MIN);
    s = await b.until(x => x.proactive.schedules.find((y: { id: string; state: string }) => y.id === second.id && y.state === "AWAITING_APPROVAL") && x);
    assert.equal(tasksTitled(s, "Project summary").length, 1);
    assert.ok(notes(s, "permission_expired").some((n: { sourceId: string }) => n.sourceId === second.id));
  } finally { await b.close(); }
});

test("T3-E2E-B build-failure watch: one notice per failure, nothing for unchanged state, survives restart; disable and expiry", { timeout: 180_000 }, async () => {
  const model = fakeModel();
  const b = await bench({ model });
  try {
    const phone = await b.pair();
    const spec = { title: "Release check", label: "Build status", projectId: "p1", source: { kind: "file", root: "atlas", path: "build/status.json", field: "status" },
      predicate: { type: "transition", from: "PASS", to: "FAIL" }, intervalMs: MIN, maxChecksPerHour: 60, dedupMs: 30 * MIN, expiresAt: b.now() + 7 * DAY };
    refusedOnPhone(await b.command("monitor.create", { spec }, phone));
    const m = b.ok(await b.command("monitor.create", { spec }));
    refusedOnPhone(await b.command("monitor.approve", { id: m.id }, phone));
    b.ok(await b.command("monitor.approve", { id: m.id }));
    let t = b.now();
    const check = async (expectChecks: number) => { t += MIN + 1_000; await b.jump(t); return b.until(s => s.proactive.monitors[0].lastCheckAt !== null && s.proactive.monitors.find((x: { id: string }) => x.id === m.id).checksLastHour >= expectChecks && s); };
    await check(1); // baseline PASS
    b.write("build/status.json", JSON.stringify({ status: "FAIL" }));
    const t0 = performance.now();
    let s = await check(2);
    s = await b.until(x => notes(x, "source_changed").length === 1 && x);
    time("B.change_to_notice_ms", performance.now() - t0);
    assert.match(notes(s, "source_changed")[0].reason, /Build status: now "FAIL"/);
    await check(3); await check(4); // still failing
    await b.restart();
    await check(5); // after a restart the stored baseline holds: still no news
    s = await b.state();
    assert.equal(notes(s, "source_changed").length, 1);
    assert.equal(s.proactive.monitors[0].lastClass, "no_change");
    // The phone sees the notice and may dismiss it; it may also revoke (disable) the monitor.
    const onPhone = await b.state(phone);
    const key = notes(onPhone, "source_changed")[0].key;
    assert.equal(JSON.stringify(onPhone.proactive).includes("status.json"), false, "no paths on the phone");
    b.ok(await b.command("proactive.notification.dismiss", { key }, phone));
    b.write("build/status.json", JSON.stringify({ status: "PASS" }));
    await check(6);
    assert.equal(b.ok(await b.command("monitor.disable", { id: m.id }, phone)).state, "DISABLED");
    const checked = (await b.state()).proactive.monitors[0].lastCheckAt;
    b.write("build/status.json", JSON.stringify({ status: "FAIL" }));
    t += 5 * MIN; await b.jump(t);
    s = await b.state();
    assert.equal(s.proactive.monitors[0].lastCheckAt, checked, "a disabled monitor reads nothing");
    assert.equal(notes(s, "source_changed").length, 0, "the dismissed notice stays dismissed and no new one appears");
    assert.equal(model.prompts.length, 0, "no model call for any check");
    // Expiry: a monitor whose end date passes stops on its own and says so.
    const short = b.ok(await b.command("monitor.create", { spec: { ...spec, title: "Short watch", expiresAt: b.now() + 2 * MIN } }));
    b.ok(await b.command("monitor.approve", { id: short.id }));
    await b.jump(b.now() + 3 * MIN);
    await b.until(x => x.proactive.monitors.find((y: { id: string; state: string }) => y.id === short.id && y.state === "EXPIRED"));
  } finally { await b.close(); }
});

test("T3-E2E-C persistent goal: progress only from receipted work, never from a model's claim; restart, cancel, expiry", { timeout: 180_000 }, async () => {
  // The Worker always claims everything is done; the Reviewer catches the one claim the sources do not support.
  const model = fakeModel({ Worker: "All release criteria are complete.", Reviewer: p => JSON.stringify(/release notes/i.test(p) ? { approved: false, issues: ["The sources contain no release notes."] } : { approved: true, issues: [] }) });
  const b = await bench({ model });
  try {
    const phone = await b.pair();
    const spec = { title: "Prepare Bunny A for beta", projectId: "p1", successCriteria: [{ id: "status", description: "Status reviewed" }, { id: "notes", description: "Release notes drafted" }, { id: "build", description: "Build checked" }], expiresAt: b.now() + 30 * DAY };
    refusedOnPhone(await b.command("goal.create", { spec }, phone));
    const g = b.ok(await b.command("goal.create", { spec, suggested: true }));
    assert.equal(g.state, "AWAITING_APPROVAL");
    refusedOnPhone(await b.command("goal.approve", { id: g.id }, phone));
    b.ok(await b.command("goal.approve", { id: g.id }));
    const task = async (title: string, prompt: string) => {
      const steps = [{ id: "read", kind: "file.read", input: { root: "atlas", path: "STATUS.md" } }, { id: "gen", kind: "local.generate", input: { prompt, contextFrom: "read" }, model: MODEL },
        { id: "rev", kind: "local.review", input: { criteria: prompt, subjectFrom: "gen", contextFrom: "read" }, model: MODEL }];
      const t = b.ok(await b.command("ptask.create", { spec: { title, projectId: "p1", steps, acceptance: { requiredSteps: ["read", "gen", "rev"] } }, envelope: envelope(b, steps.map(s => s.kind), { files: [{ root: "atlas", access: "read" }] }, { background: false }) }));
      return t.state === "AWAITING_APPROVAL" ? b.ok(await b.command("ptask.approve", { id: t.id })) : t;
    };
    const status = await task("Review status", "Summarize the status."), notesTask = await task("Draft release notes", "Draft the release notes."), build = await task("Check build", "Confirm RC3 is built.");
    for (const [crit, t] of [["status", status], ["notes", notesTask], ["build", build]] as const) b.ok(await b.command("goal.link", { id: g.id, criterionId: crit, taskId: t.id }));
    let s = await b.until(x => x.proactive.goals[0].state === "NEEDS_ATTENTION" && x.proactive.goals[0].progress.met === 2 && x);
    const view = s.proactive.goals[0];
    assert.deepEqual(view.criteria.map((c: { met: boolean }) => c.met), [true, false, true], "the model's claim met nothing; the Reviewer's rejection failed the task");
    assert.match(view.attention, /Release notes drafted.*failed/);
    assert.equal(notes(s, "goal_milestone").length, 2);
    // Restart: progress and milestones persist and are not repeated.
    await b.restart(); await b.command("proactive.list");
    s = await b.state();
    assert.deepEqual(s.proactive.goals[0].progress, { met: 2, total: 3 });
    assert.equal(notes(s, "goal_milestone").length, 2);
    // New, honest work for the missing criterion completes the goal.
    model.prompts.length = 0;
    const redo = await task("Draft beta notes", "List the open issues for the beta notes.");
    b.ok(await b.command("goal.link", { id: g.id, criterionId: "notes", taskId: redo.id }));
    s = await b.until(x => x.proactive.goals[0].state === "COMPLETED" && x);
    assert.equal(notes(s, "goal_milestone").length, 4);
    assert.ok(s.proactive.goals[0].criteria.every((c: { evidence: string[] }) => c.evidence.length === 3), "each criterion carries its task's three step receipts");
    // Cancellation from the phone and expiry of an unattended goal.
    const g2 = b.ok(await b.command("goal.create", { spec: { ...spec, title: "Second goal" } }));
    b.ok(await b.command("goal.approve", { id: g2.id }));
    assert.equal(b.ok(await b.command("goal.cancel", { id: g2.id }, phone)).state, "CANCELLED");
    const g3 = b.ok(await b.command("goal.create", { spec: { ...spec, title: "Short goal", expiresAt: b.now() + MIN } }));
    b.ok(await b.command("goal.approve", { id: g3.id }));
    await b.jump(b.now() + 2 * MIN);
    await b.until(x => x.proactive.goals.find((y: { id: string; state: string }) => y.id === g3.id && y.state === "EXPIRED"));
  } finally { await b.close(); }
});

test("T3-E2E-D scheduled connected workflow: authorized read, prepared send waits for the PC; approve, deny, restart, expiry, cancel", { timeout: 240_000 }, async () => {
  const model = fakeModel({ Worker: "Status: RC3 built. Open: login timeout, onboarding copy." });
  const w = workspace();
  const b = await bench({ model, services: w });
  try {
    const phone = await b.pair();
    const slot = nextMinute(b);
    const steps = [{ id: "inbox", kind: "email.list", input: { account: ME, folder: "inbox", limit: 5 } },
      { id: "summary", kind: "local.generate", input: { prompt: "Write a short status reply.", contextFrom: "inbox" }, model: MODEL },
      { id: "send", kind: "email.send", input: { account: ME, to: "lead@example.test", subject: "Atlas status", bodyFrom: "summary" } }];
    const grants = { services: [{ connector: "email", account: ME, access: "send", recipients: ["lead@example.test"] }] };
    const spec = { title: "Daily status reply", projectId: "p1", trigger: { type: "daily", time: hhmm(slot), timeZone: "UTC" }, expiresAt: b.now() + 7 * DAY,
      action: { type: "task", spec: { title: "Status reply", projectId: "p1", steps, acceptance: { requiredSteps: steps.map(s => s.id) } }, envelope: envelope(b, steps.map(s => s.kind), grants, { sideEffects: true }) } };
    const sched = b.ok(await b.command("schedule.create", { spec }));
    b.ok(await b.command("schedule.approve", { id: sched.id }));
    const waitFor = async (day: number) => {
      await b.jump(slot + day * DAY - 200);
      return b.until(s => tasksTitled(s, "Status reply").find((t: { state: string; pendingAction: unknown; createdAt: number }) => t.state === "AWAITING_APPROVAL" && t.pendingAction && t.createdAt >= slot + day * DAY - 1_000));
    };
    // Day 1: the schedule's approval covers the read and the draft text; the send itself waits for the owner.
    let waiting = await waitFor(0);
    assert.equal(waiting.pendingAction.kind, "email.send");
    assert.equal(w.sent.length, 0);
    let s = await b.until(x => notes(x, "approval_required").find((n: { sourceId: string }) => n.sourceId === waiting.id) && x);
    const onPhone = await b.state(phone);
    assert.equal(JSON.stringify(onPhone.proactive).includes("lead@example.test"), false, "the phone learns that something waits, not to whom");
    for (const action of ["action.approve", "action.deny"]) refusedOnPhone(await b.command(action, { id: waiting.id, actionId: waiting.pendingAction.actionId, payloadSha256: waiting.pendingAction.payloadSha256 }, phone));
    await b.restart(); await b.command("proactive.list");
    s = await b.state();
    assert.equal(notes(s, "approval_required").filter((n: { sourceId: string }) => n.sourceId === waiting.id).length, 1, "no second notice after a restart");
    b.ok(await b.command("action.approve", { id: waiting.id, actionId: waiting.pendingAction.actionId, payloadSha256: waiting.pendingAction.payloadSha256 }));
    await b.until(x => tasksTitled(x, "Status reply").find((t: { id: string; state: string }) => t.id === waiting.id && t.state === "COMPLETED"));
    assert.equal(w.sent.length, 1);
    // Day 2: denied — nothing is sent, the owner is told it failed.
    waiting = await waitFor(1);
    b.ok(await b.command("action.deny", { id: waiting.id, actionId: waiting.pendingAction.actionId }));
    s = await b.until(x => notes(x, "task_failed").find((n: { sourceId: string }) => n.sourceId === waiting.id) && x);
    assert.equal(w.sent.length, 1);
    // Day 3: the proposal expires unanswered; it is prepared again, and approving the stale one does nothing.
    waiting = await waitFor(2);
    await b.jump(slot + 2 * DAY + 16 * MIN);
    b.host.ptasks.wake();
    const fresh = await b.until(x => tasksTitled(x, "Status reply").find((t: { id: string; state: string; pendingAction: { actionId: string } | null }) => t.id === waiting.id && t.state === "AWAITING_APPROVAL" && t.pendingAction && t.pendingAction.actionId !== waiting.pendingAction.actionId));
    const stale = await b.command("action.approve", { id: waiting.id, actionId: waiting.pendingAction.actionId, payloadSha256: waiting.pendingAction.payloadSha256 });
    assert.equal(stale.status, 400);
    // Cancelling the schedule stops the waiting run; nothing is ever sent for it.
    b.ok(await b.command("schedule.cancel", { id: sched.id }));
    await b.until(x => tasksTitled(x, "Status reply").find((t: { id: string; state: string }) => t.id === fresh.id && t.state === "CANCELLED"));
    await b.jump(slot + 3 * DAY + MIN);
    s = await b.state();
    assert.equal(tasksTitled(s, "Status reply").length, 3);
    assert.equal(w.sent.length, 1);
    assert.equal(b.host.connected.ledger.verify().ok, true);
  } finally {
    await b.close();
    if (process.env.S2T3_EVIDENCE) save(process.env.S2T3_EVIDENCE, JSON.stringify(timings, null, 2));
  }
});
