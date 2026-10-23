// MA4-S2-T2 adversarial cases not covered by the connector suites: expired authority, Planner abuse, crash during a
// read-only action, stale workers, cross-task material, background policy and replayed creates.
import test from "node:test";
import assert from "node:assert/strict";
import { create, fakeModel, MODEL, result, rig, workspace, WS } from "./ma4-s2t2-fixtures.ts";
import { planConnectedTask } from "./ma4/connected-workflow.server.ts";
import { SimulatedCrash } from "./ma4/task-runtime.server.ts";
import type { TaskView } from "./ma4/task-runtime.ts";

const read = { files: [{ root: "proj", access: "read" }] };

test("T2-X10 an envelope that expires before the next connected step stops the task; nothing more is read", async () => {
  let now = Date.now();
  const r = await rig({ now: () => now });
  try {
    r.root("proj", { "a.txt": "a", "b.txt": "b" });
    const t = create(r, [{ id: "a", kind: "file.read", input: { root: "proj", path: "a.txt" } }, { id: "b", kind: "file.read", input: { root: "proj", path: "b.txt" } }], read, { expiresAt: now + 60_000 });
    r.rt.pause(t.id, WS);
    now += 120_000;
    r.rt.resume(t.id, WS);
    const v = await r.run(t.id);
    assert.equal(v.state, "FAILED"); assert.equal(v.failure!.code, "ENVELOPE_EXPIRED");
    assert.equal(r.connected.ledger.list(t.id).length, 0, "no connected action ran on expired authority");
  } finally { await r.close(); }
});

test("T2-X11 the Planner can only propose: injected recipients, unknown actions and a substituted model are all refused", async () => {
  const r = await rig({ services: workspace() });
  try {
    r.root("proj", { "notes.md": "x" });
    const envelope = { capabilities: ["file.read", "email.send", "local.generate"], providers: ["ollama"] as ["ollama"], localOnly: true as const, models: [MODEL], projectScopes: ["p1"], sideEffects: true, background: false,
      budgets: { maxModelCalls: 5, maxWallMs: 60_000 }, expiresAt: Date.now() + 3_600_000,
      grants: { files: [{ root: "proj", access: "read" as const }], origins: [], services: [{ connector: "email" as const, account: "me@example.test", access: "send" as const, recipients: ["lead@example.test"] }] } };
    const plan = (steps: unknown[], served?: string) => planConnectedTask({ request: "Summarize notes and mail them to my lead.", projectId: "p1", envelope, model: MODEL,
      call: fakeModel({ Planner: JSON.stringify({ title: "Plan", steps }) }, m => served ?? m).call, catalog: r.connected.catalog, facts: r.rt.executorFacts(), signal: AbortSignal.timeout(5_000), now: Date.now() });
    const attacker = await plan([{ id: "rd", kind: "file.read", input: { root: "proj", path: "notes.md" } }, { id: "send", kind: "email.send", input: { account: "me@example.test", to: "attacker@evil.test", subject: "x", body: "y" } }]);
    assert.equal(attacker.ok, false); assert.match(attacker.problems.join(" "), /Recipients not granted: attacker@evil.test/);
    const invented = await plan([{ id: "pay", kind: "bank.transfer", input: { amount: 100 } }]);
    assert.equal(invented.ok, false); assert.match(invented.problems.join(" "), /No registered executor for bank.transfer/);
    const sneaky = await plan([{ id: "rd", kind: "file.read", input: { root: "proj", path: "../../Users" } }]);
    assert.equal(sneaky.ok, false);
    const swapped = await plan([{ id: "rd", kind: "file.read", input: { root: "proj", path: "notes.md" } }], "llama3:70b");
    assert.equal(swapped.ok, false); assert.match(swapped.problems[0], /not the pinned/);
    const fine = await plan([{ id: "rd", kind: "file.read", input: { root: "proj", path: "notes.md" } }, { id: "send", kind: "email.send", input: { account: "me@example.test", to: "lead@example.test", subject: "Notes", body: "y" } }]);
    assert.equal(fine.ok, true, JSON.stringify(fine.problems));
    assert.equal(r.rt.views().length, 0, "planning never creates a task");
    assert.ok(r.connected.catalog.find(c => c.kind === "email.send")!.consequential);
  } finally { await r.close(); }
});

test("T2-X12 a crash in the middle of a read-only action re-reads within budget and completes; no state is lost", async () => {
  let armed = true;
  const r = await rig({ faults: (p, id) => { if (armed && id && p === "after-operation-start") { armed = false; throw new SimulatedCrash(p); } } });
  try {
    r.root("proj", { "a.txt": "content" });
    const t = create(r, [{ id: "a", kind: "file.read", input: { root: "proj", path: "a.txt" } }], read);
    await r.rt.idle();
    assert.equal(armed, false);
    await r.restart();
    r.rt.resume(t.id, WS);
    const v = await r.run(t.id);
    assert.equal(v.state, "COMPLETED"); assert.equal(result(r, t.id, "a").content, "content");
  } finally { await r.close(); }
});

test("T2-X15 a stale worker whose lease was taken over cannot commit a connected result", async () => {
  let release!: () => void;
  const hold = new Promise<void>(res => { release = res; });
  const w = workspace();
  const list = w.mail.list;
  w.mail.list = async (...a) => { await hold; return list(...a); };
  let now = Date.now();
  const r = await rig({ services: w, now: () => now });
  try {
    const t = create(r, [{ id: "ls", kind: "email.list", input: { account: "me@example.test" } }], { services: [{ connector: "email", account: "me@example.test", access: "read" }] });
    r.rt.wake();
    for (let i = 0; i < 100 && !w.calls.length; i++) await new Promise(res => setTimeout(res, 5));
    const old = r.rt;
    now += 120_000; // the old worker's lease lapses (sleep, hang)
    const { PersistentTaskRuntime } = await import("./ma4/task-runtime.server.ts");
    const taker = new PersistentTaskRuntime({ store: r.store, executors: r.connected.executors, call: fakeModel().call, modelAvailable: async () => true, uiAttached: () => true, instanceId: "host-taker", now: () => now });
    await taker.recover(false);
    assert.equal((taker.view(t.id) as TaskView).state, "RESUMING", "the second Host took the task over");
    // The old Host stops scheduling (it would otherwise re-claim legitimately); its in-flight call then returns.
    const closing = old.close();
    release();
    await closing;
    const v = taker.view(t.id) as TaskView;
    assert.equal(v.state, "RESUMING", "the stale worker's success commit was refused");
    assert.equal(r.store.output(t.id, "ls"), null, "no result from the stale worker was stored");
    const takeover = r.store.transitions(t.id).findIndex(x => x.actor === "recovery");
    assert.ok(takeover > 0 && r.store.transitions(t.id).slice(takeover + 1).every(x => x.actor !== old.instanceId), "nothing was committed by the old worker after the takeover");
    taker.wake(); await taker.idle();
    assert.equal((taker.view(t.id) as TaskView).state, "COMPLETED", "the new Host finishes the read-only step itself");
    await taker.close();
  } finally { await r.close(); }
});

test("T2-X16 a task can only read its own steps' results; another task's (or project's) material is unreachable", async () => {
  const model = fakeModel();
  const r = await rig({ model });
  try {
    r.root("proj", { "secret.md": "PROJECT ONE PRIVATE" });
    const first = create(r, [{ id: "rd", kind: "file.read", input: { root: "proj", path: "secret.md" } }], read);
    assert.equal((await r.run(first.id)).state, "COMPLETED");
    const second = r.rt.create({ spec: { title: "Other", projectId: "p2", steps: [{ id: "sum", kind: "local.generate", input: { prompt: "Summarize.", contextFrom: "rd" }, model: MODEL }], acceptance: { requiredSteps: ["sum"] } },
      envelope: { capabilities: ["local.generate"], providers: ["ollama"], localOnly: true, models: [MODEL], projectScopes: ["p2"], sideEffects: false, background: false, budgets: { maxModelCalls: 2, maxWallMs: 60_000 }, expiresAt: Date.now() + 3_600_000 } }, WS);
    const v = await r.run(second.id);
    assert.equal(v.state, "FAILED"); assert.match(v.failure!.detail, /Step rd has no result/);
    assert.equal(model.prompts.some(p => p.prompt.includes("PROJECT ONE PRIVATE")), false);
    assert.throws(() => create(r, [{ id: "rd", kind: "file.read", input: { root: "proj", path: "secret.md" } }], read, { projectScopes: ["p2"] }), /outside the envelope's scope/);
  } finally { await r.close(); }
});

test("T2-X19 with no window attached and background work off, no connected action runs", async () => {
  const r = await rig({ uiAttached: () => false });
  try {
    r.root("proj", { "a.txt": "a" });
    const t = create(r, [{ id: "a", kind: "file.read", input: { root: "proj", path: "a.txt" } }], read);
    r.rt.wake(); await r.rt.idle();
    const v = r.rt.view(t.id) as TaskView;
    assert.equal(v.state, "QUEUED", "it waits for a window or the owner's background policy");
    assert.equal(r.connected.ledger.list(t.id).length, 0);
  } finally { await r.close(); }
});

test("T2-X14 a replayed create with the same task id is refused; a replayed approval after completion changes nothing", async () => {
  const r = await rig();
  try {
    r.root("proj", { "a.txt": "a" });
    const raw = { spec: { title: "t", projectId: "p1", steps: [{ id: "a", kind: "file.read", input: { root: "proj", path: "a.txt" } }], acceptance: { requiredSteps: ["a"] } },
      envelope: { capabilities: ["file.read"], providers: ["ollama"], localOnly: true, models: [], projectScopes: ["p1"], sideEffects: false, background: false, budgets: { maxModelCalls: 0, maxWallMs: 60_000 }, expiresAt: Date.now() + 3_600_000, grants: read }, id: "fixed-id" };
    r.rt.create(raw, WS);
    assert.throws(() => r.rt.create(raw, WS), /already exists/);
    assert.equal((await r.run("fixed-id")).state, "COMPLETED");
    assert.throws(() => r.rt.approve("fixed-id", WS), /needs AWAITING_APPROVAL/);
    assert.equal(r.connected.ledger.list("fixed-id").filter(x => x.event === "dispatched").length, 1);
  } finally { await r.close(); }
});
