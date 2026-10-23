// MA4-S2-T1 persistent task runtime: deterministic acceptance scenarios (docs/ma4-s2-t1/CRASH_INJECTION_RESULTS.md).
// Real store and runtime on SQLite files; a fake clock; recorded fake external services instead of real messages,
// publications or purchases. A "crash" stops a runtime without one more write and closes its database connection,
// exactly what a killed Host leaves behind; the real-process kill scenarios live in ma4-s2t1-process.test.ts.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { HostDatabase } from "./persistence.server.ts";
import { TASK_NEXT, TASK_STATES, taskCanTransition, displayState, type Envelope, type TaskState } from "./ma4/task-runtime.ts";
import { StaleLeaseError, TaskStore } from "./ma4/task-store.server.ts";
import { PersistentTaskRuntime, SimulatedCrash, type Executor, type FaultPoint, type RuntimeDeps } from "./ma4/task-runtime.server.ts";
import type { ModelCall } from "./ma4/coding-workflow.server.ts";

const HOUR = 3_600_000;
const T0 = 1_800_000_000_000;

/** A recorded fake external world: what was really "sent" and "upserted", by idempotency key. */
class World {
  sent: string[] = [];
  upserts = new Map<string, number>();
  reads = 0;
  calls: { model: string; prompt: string }[] = [];
  gates = new Map<string, { release: () => void; promise: Promise<void> }>();
  /** A step whose effect must wait for the test: hold(key) before, release(key) to let it finish. */
  hold(key: string) { let release!: () => void; const promise = new Promise<void>(r => { release = r; }); this.gates.set(key, { release, promise }); }
  release(key: string) { this.gates.get(key)?.release(); }
  async wait(key: string, signal: AbortSignal) {
    const gate = this.gates.get(key);
    if (!gate) return;
    await Promise.race([gate.promise, new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true }))]);
  }
}
function executors(world: World): Executor[] {
  return [
    { kind: "local.read", category: "read_only", gpu: false, sideEffect: false, timeoutMs: 60_000,
      async run(input, ctx) { world.reads++; try { await world.wait(ctx.idempotencyKey, ctx.signal); } catch { return { ok: false, error: "stopped", dispatched: true, definite: false }; } return { ok: true, output: `read ${String(input.n ?? "")}` }; } },
    { kind: "local.generate", category: "read_only", gpu: true, sideEffect: false, timeoutMs: 60_000,
      async run(input, ctx) {
        const r = await ctx.call({ role: "Worker", model: ctx.model!, prompt: String(input.prompt), schema: null, signal: ctx.signal, attempt: ctx.attempt });
        if (!r.ok) return { ok: false, error: r.error, dispatched: true, definite: false };
        if (r.servedModel !== ctx.model) return { ok: false, error: "served model differs from the pin", dispatched: true, definite: true, fatal: "PIN_VIOLATION" };
        return { ok: true, output: r.text };
      } },
    { kind: "external.send", category: "irreversible", gpu: false, sideEffect: true, timeoutMs: 60_000,
      async run(input, ctx) {
        try { await world.wait(`pre:${ctx.idempotencyKey}`, ctx.signal); } catch { return { ok: false, error: "stopped before sending", dispatched: false }; }
        world.sent.push(ctx.idempotencyKey);
        try { await world.wait(ctx.idempotencyKey, ctx.signal); } catch { return { ok: false, error: "connection lost after sending", dispatched: true, definite: false }; }
        return { ok: true, output: `sent ${String(input.to)}`, receipt: `receipt-${world.sent.length}` };
      } },
    { kind: "external.upsert", category: "idempotent", gpu: false, sideEffect: true, timeoutMs: 60_000,
      async run(_input, ctx) {
        world.upserts.set(ctx.idempotencyKey, (world.upserts.get(ctx.idempotencyKey) ?? 0) + 1);
        try { await world.wait(ctx.idempotencyKey, ctx.signal); } catch { return { ok: false, error: "lost", dispatched: true, definite: false }; }
        return { ok: true, output: "upserted", receipt: ctx.idempotencyKey };
      },
      async verify(key) { return { found: world.upserts.has(key), output: "upserted", receipt: key }; } },
    { kind: "local.child", category: "read_only", gpu: false, sideEffect: false, timeoutMs: 60_000,
      async run(_input, ctx) {
        const child = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], { stdio: "ignore" });
        ctx.track(child);
        (world as World & { children?: number[] }).children = [...((world as World & { children?: number[] }).children ?? []), child.pid!];
        try { await world.wait(ctx.idempotencyKey, ctx.signal); } catch { return { ok: false, error: "stopped", dispatched: true, definite: false }; }
        child.kill();
        return { ok: true, output: "child done" };
      } },
  ];
}

type Env = { dir: string; path: string; db: HostDatabase; store: TaskStore; rt: PersistentTaskRuntime; world: World; clock: { t: number }; ui: { attached: boolean }; models: Set<string>; resources: { ok: boolean }; events: { type: string; detail: string; taskId: string | null }[]; faults: Map<string, FaultPoint> };
function env(options: { instance?: string; faults?: Map<string, FaultPoint>; existing?: Env } = {}): Env {
  const prior = options.existing;
  const dir = prior?.dir ?? mkdtempSync(join(tmpdir(), "s2t1-"));
  const path = prior?.path ?? join(dir, "host.db");
  const db = new HostDatabase(path), store = new TaskStore(db);
  const world = prior?.world ?? new World(), clock = prior?.clock ?? { t: T0 }, ui = prior?.ui ?? { attached: true };
  const models = prior?.models ?? new Set(["pin:7b"]), resources = prior?.resources ?? { ok: true };
  const events: Env["events"] = [], faults = options.faults ?? new Map<string, FaultPoint>();
  const call: ModelCall = async req => { world.calls.push({ model: req.model, prompt: req.prompt }); return { ok: true, text: `answer from ${req.model}`, servedModel: req.model, durationMs: 1 }; };
  const deps: RuntimeDeps = {
    store, executors: executors(world), call, instanceId: options.instance ?? `host-${Math.random().toString(36).slice(2)}`,
    modelAvailable: async m => models.has(m), resources: () => ({ ok: resources.ok, detail: "Free memory is below the 4 GiB floor." }),
    uiAttached: () => ui.attached, emit: (type, detail, taskId) => events.push({ type, detail, taskId }), now: () => clock.t, leaseMs: 30_000, maintenanceMs: 60_000,
    faults: (point, taskId) => { if (faults.get(taskId) === point) { faults.delete(taskId); throw new SimulatedCrash(point); } },
    killVerified: async p => { try { process.kill(p.pid); return true; } catch { return false; } },
    identify: async pid => ({ pid, createdAt: clock.t, name: "node.exe" }),
  };
  return { dir, path, db, store, rt: new PersistentTaskRuntime(deps), world, clock, ui, models, resources, events, faults };
}
/** The Host dies: no more writes, the connection closes. Leases and "started" operations stay exactly as they were. */
function kill(e: Env) { e.rt.crash(); e.db.close(); }
/** A new Host process on the same database, later in time. */
async function restart(e: Env, options: { advanceMs?: number; resumeOnStart?: boolean; faults?: Map<string, FaultPoint> } = {}): Promise<Env> {
  e.clock.t += options.advanceMs ?? 60_000;
  const next = env({ existing: e, faults: options.faults });
  if (options.resumeOnStart !== undefined) next.store.setPolicy({ ...next.store.policy(), resumeOnStart: options.resumeOnStart });
  await next.rt.start();
  return next;
}
const cleanup = (e: Env) => { try { e.rt.crash(); e.db.close(); } catch { /* closed */ } rmSync(e.dir, { recursive: true, force: true }); };
const envelope = (over: Partial<Envelope> = {}): Envelope => ({ capabilities: ["local.read", "local.generate", "external.send", "external.upsert", "local.child"], providers: ["ollama"], localOnly: true, models: ["pin:7b"], projectScopes: ["proj-a"], sideEffects: true, background: true, budgets: { maxModelCalls: 20, maxWallMs: 24 * HOUR }, expiresAt: T0 + 7 * 24 * HOUR, ...over });
const spec = (steps: { id: string; kind: string; input?: Record<string, string | number | boolean | null>; model?: string | null; maxAttempts?: number }[], over: Record<string, unknown> = {}) =>
  ({ title: "Weekly report", projectId: "proj-a", steps: steps.map(s => ({ input: {}, model: null, ...s })), acceptance: { requiredSteps: steps.map(s => s.id) }, ...over });
async function settle(e: Env) { await e.rt.tick(); await e.rt.idle(); }
const state = (e: Env, id: string) => e.store.get(id).record.state;

// ── state machine, storage, migrations ──────────────────────────────────────────────────────────────────────────────
test("T1 state machine: explicit table, terminal states never exit, UNCERTAIN leaves only by reconciliation targets", () => {
  for (const from of TASK_STATES) for (const to of TASK_STATES) assert.equal(taskCanTransition(from, to), TASK_NEXT[from].includes(to), `${from}→${to}`);
  for (const terminal of ["COMPLETED", "FAILED", "CANCELLED"] as TaskState[]) assert.deepEqual(TASK_NEXT[terminal], []);
  assert.deepEqual([...TASK_NEXT.UNCERTAIN].sort(), ["CANCELLED", "FAILED", "QUEUED"]);
  assert.equal(taskCanTransition("UNCERTAIN", "COMPLETED"), false, "an uncertain action is never turned into success without evidence");
  assert.equal(taskCanTransition("QUEUED", "COMPLETED"), false);
  assert.equal(displayState({ state: "RESUMING", blocked: null }), "Recovering");
  assert.equal(displayState({ state: "PAUSED", blocked: { code: "MODEL_UNAVAILABLE", detail: "", at: 0 } }), "Needs attention");
  assert.equal(displayState({ state: "PAUSED", blocked: { code: "OWNER_PAUSED", detail: "", at: 0 } }), "Paused");
});

test("T1 storage: versioned migration is additive and idempotent; a newer schema is refused; the store rejects invalid transitions", async () => {
  const e = env();
  try {
    const t = e.rt.create({ spec: spec([{ id: "r", kind: "local.read" }]), envelope: envelope({ sideEffects: false, background: false }) }, "workstation");
    assert.equal(t.state, "QUEUED", "read-only, foreground work needs no approval");
    new TaskStore(e.db); new TaskStore(e.db);
    assert.equal((e.db.db.prepare("SELECT COUNT(*) n FROM migrations WHERE key='ma4.task-runtime.v1'").get() as { n: number }).n, 1);
    assert.equal(e.store.get(t.id).record.spec.title, "Weekly report", "existing rows survive re-opening");
    assert.deepEqual(e.store.transitions(t.id).map(x => x.to), ["CREATED", "VALIDATED", "QUEUED"], "append-only transition history");
    assert.throws(() => e.store.update(t.id, { actor: "x", reason: "x", now: e.clock.t, to: "COMPLETED" }), /Invalid transition QUEUED → COMPLETED/);
    assert.throws(() => e.store.update(t.id, { actor: "x", reason: "x", now: e.clock.t, expectVersion: 1, to: "PAUSED" }), /changed since this view/);
    e.db.db.prepare("UPDATE settings SET value='2' WHERE key='ma4_task_runtime_schema'").run();
    assert.throws(() => new TaskStore(e.db), /newer than this Host/);
  } finally { cleanup(e); }
});

test("T1 crash-safe writes: an interrupted transaction leaves no partial task; repeated recovery is a no-op", async () => {
  let e = env();
  try {
    e.rt.create({ spec: spec([{ id: "r", kind: "local.read" }]), envelope: envelope() , id: "kept" }, "workstation");
    // A writer dies mid-transaction (BEGIN, row written, never committed).
    const raw = new DatabaseSync(e.path);
    raw.exec("BEGIN IMMEDIATE");
    raw.prepare("INSERT INTO ma4_tasks(id,project_id,state,version,fence,created_at,updated_at,record,record_sha256) VALUES('ghost','proj-a','QUEUED',1,0,1,1,'{}','x')").run();
    raw.close();
    kill(e);
    e = await restart(e);
    assert.equal(e.store.list().length, 1, "the uncommitted row is gone");
    assert.equal(e.store.integrity().ok, true);
    const before = e.store.transitions("kept").length;
    await e.rt.recover(false); await e.rt.recover(false);
    assert.equal(e.store.transitions("kept").length, before, "recovery is idempotent");
  } finally { cleanup(e); }
});

test("T1-14 malformed persisted records are detected and never executed", async () => {
  const e = env();
  try {
    const t = e.rt.create({ spec: spec([{ id: "r", kind: "local.read" }]), envelope: envelope({ sideEffects: false, background: false }) }, "workstation");
    e.db.db.prepare("UPDATE ma4_tasks SET record=replace(record,'Weekly report','Weekly REPORT') WHERE id=?").run(t.id);
    await settle(e);
    assert.equal(e.world.reads, 0, "a tampered record never runs");
    const view = e.rt.views()[0];
    assert.ok(view.corrupt && view.display === "Needs attention" && /integrity check/.test(view.detail));
    // A forged row whose hash matches but whose envelope widens authority is still refused.
    const forged = JSON.parse(e.db.db.prepare("SELECT record FROM ma4_tasks WHERE id=?").get(t.id)!.record as string);
    forged.spec.title = "Weekly report"; forged.envelope.providers = ["openrouter"];
    const json = JSON.stringify(forged), { createHash } = await import("node:crypto");
    e.db.db.prepare("UPDATE ma4_tasks SET record=?,record_sha256=? WHERE id=?").run(json, createHash("sha256").update(json).digest("hex"), t.id);
    assert.throws(() => e.store.get(t.id), /integrity check/);
    await settle(e);
    assert.equal(e.world.reads, 0);
  } finally { cleanup(e); }
});

// ── scenario 1: UI closes, Host keeps working; reconnect shows the same task ────────────────────────────────────────
test("T1-1 UI closes: an authorized background task keeps running on the Host; reconnect shows the same task, no duplicate", async () => {
  const e = env();
  try {
    e.store.setPolicy({ background: true, resumeOnStart: false });
    const t = e.rt.create({ spec: spec([{ id: "a", kind: "local.read", input: { n: 1 } }, { id: "b", kind: "local.generate", model: "pin:7b", input: { prompt: "summarize" } }]), envelope: envelope({ sideEffects: false }) }, "workstation");
    assert.equal(t.state, "AWAITING_APPROVAL", "background work needs explicit approval");
    e.rt.approve(t.id, "workstation");
    e.world.hold(`${t.id}:a`);
    await e.rt.tick();
    e.ui.attached = false; // every window closes
    e.world.release(`${t.id}:a`);
    await e.rt.idle();
    const reconnect = e.rt.snapshot();
    assert.equal(reconnect.tasks.length, 1);
    const view = reconnect.tasks[0] as Exclude<typeof reconnect.tasks[0], { corrupt: true }>;
    assert.equal(view.id, t.id); assert.equal(view.state, "COMPLETED"); assert.deepEqual(view.progress, { done: 2, total: 2, current: null });
    assert.equal(e.world.reads, 1); assert.equal(e.world.calls.length, 1, "each step ran exactly once");
    assert.equal(JSON.stringify(reconnect).includes("summarize"), false, "views never carry step inputs");
  } finally { cleanup(e); }
});

// ── scenario 10: background disabled ─────────────────────────────────────────────────────────────────────────────────
test("T1-10 background execution is refused when disabled (policy off, or the task's envelope does not allow it)", async () => {
  const e = env();
  try {
    const q = e.rt.create({ spec: spec([{ id: "a", kind: "local.read" }]), envelope: envelope({ sideEffects: false, background: false }) }, "workstation");
    e.ui.attached = false;
    await settle(e);
    assert.equal(state(e, q.id), "QUEUED", "no window, policy off: nothing is claimed");
    e.store.setPolicy({ background: true, resumeOnStart: false });
    await settle(e);
    assert.equal(state(e, q.id), "QUEUED", "policy on, but this envelope did not authorize background work");
    // A running foreground task pauses at its next step boundary when the window closes.
    e.ui.attached = true;
    e.store.setPolicy({ background: false, resumeOnStart: false });
    const r = e.rt.create({ spec: spec([{ id: "a", kind: "local.read" }, { id: "b", kind: "local.read" }]), envelope: envelope({ sideEffects: false, background: false }) }, "workstation");
    e.world.hold(`${r.id}:a`);
    await e.rt.tick();
    e.ui.attached = false;
    e.world.release(`${r.id}:a`);
    await e.rt.idle();
    const rec = e.store.get(r.id).record;
    assert.equal(rec.state, "PAUSED"); assert.equal(rec.blocked?.code, "BACKGROUND_DISABLED");
    assert.deepEqual(rec.steps.map(s => s.state), ["succeeded", "pending"]);
  } finally { cleanup(e); }
});

// ── scenario 2 + 3: pause/resume and cancellation ───────────────────────────────────────────────────────────────────
test("T1-2 pause and resume: pause lands at a step boundary, resume re-verifies and continues, no step runs twice", async () => {
  const e = env();
  try {
    const t = e.rt.create({ spec: spec([{ id: "a", kind: "local.read" }, { id: "b", kind: "local.read" }, { id: "c", kind: "local.read" }]), envelope: envelope({ sideEffects: false, background: false }) }, "workstation");
    e.world.hold(`${t.id}:a`);
    await e.rt.tick();
    e.rt.pause(t.id, "workstation");
    e.world.release(`${t.id}:a`);
    await e.rt.idle();
    assert.equal(state(e, t.id), "PAUSED"); assert.equal(e.world.reads, 1);
    await settle(e);
    assert.equal(e.world.reads, 1, "a paused task is not claimed");
    assert.equal(e.rt.resume(t.id, "device:phone").state, "RESUMING");
    await settle(e);
    assert.equal(state(e, t.id), "COMPLETED"); assert.equal(e.world.reads, 3, "a, b, c exactly once each");
    assert.ok(e.store.transitions(t.id).some(x => x.from === "RESUMING" && x.to === "RUNNING"));
  } finally { cleanup(e); }
});

test("T1-3 cancel an active task: the step is stopped, its child process is terminated, nothing further runs", async () => {
  const e = env();
  try {
    const t = e.rt.create({ spec: spec([{ id: "a", kind: "local.child" }, { id: "b", kind: "local.read" }]), envelope: envelope({ sideEffects: false, background: false }) }, "workstation");
    e.world.hold(`${t.id}:a`);
    await e.rt.tick();
    await new Promise(r => setTimeout(r, 200));
    const pid = (e.world as World & { children?: number[] }).children![0];
    assert.doesNotThrow(() => process.kill(pid, 0), "the child is alive while the step runs");
    e.rt.cancel(t.id, "device:phone");
    await e.rt.idle();
    await new Promise(r => setTimeout(r, 300));
    assert.throws(() => process.kill(pid, 0), "the child was terminated");
    assert.equal(state(e, t.id), "CANCELLED"); assert.equal(e.world.reads, 0, "step b never ran");
  } finally { cleanup(e); }
});

// ── scenarios 4, 5: crash injection at every boundary ───────────────────────────────────────────────────────────────
test("T1-4 Host killed during a read-only step: recovery retries it within budget and completes", async () => {
  let e = env();
  try {
    const t = e.rt.create({ spec: spec([{ id: "a", kind: "local.read" }]), envelope: envelope({ sideEffects: false, background: false }) }, "workstation");
    e.faults.set(t.id, "after-effect");
    await settle(e);
    assert.equal(e.world.reads, 1); assert.equal(state(e, t.id), "RUNNING");
    kill(e);
    e = await restart(e, { resumeOnStart: true });
    assert.equal(state(e, t.id), "RESUMING");
    assert.equal(e.store.operation(`${t.id}:a`)!.state, "interrupted");
    await settle(e);
    assert.equal(state(e, t.id), "COMPLETED"); assert.equal(e.world.reads, 2, "read-only work is retried, once");
  } finally { cleanup(e); }
});

const BOUNDARIES: { point: FaultPoint; expect: TaskState; sent: number; note: string }[] = [
  { point: "after-claim", expect: "RESUMING", sent: 0, note: "claimed, nothing started" },
  { point: "before-operation-start", expect: "RESUMING", sent: 0, note: "no intent recorded, nothing sent" },
  { point: "after-operation-start", expect: "UNCERTAIN", sent: 0, note: "intent recorded; the Host cannot know whether it was sent" },
  { point: "after-effect", expect: "UNCERTAIN", sent: 1, note: "sent, no receipt recorded" },
  { point: "after-receipt", expect: "RESUMING", sent: 1, note: "sent and receipted" },
];
for (const b of BOUNDARIES) {
  test(`T1-5 crash at ${b.point} (${b.note}): no consequential action is ever duplicated`, async () => {
    let e = env();
    try {
      const t = e.rt.create({ spec: spec([{ id: "send", kind: "external.send", input: { to: "team" } }, { id: "after", kind: "local.read" }]), envelope: envelope({ background: false }) }, "workstation");
      e.rt.approve(t.id, "workstation");
      e.faults.set(t.id, b.point);
      await settle(e);
      assert.equal(e.world.sent.length, b.sent);
      kill(e);
      e = await restart(e, { resumeOnStart: true });
      assert.equal(state(e, t.id), b.expect);
      for (let i = 0; i < 3; i++) { await settle(e); await e.rt.recover(false); }
      // Uncertain: nothing more is sent while the owner decides. Otherwise the send happens once, never twice.
      assert.equal(e.world.sent.length, b.expect === "UNCERTAIN" ? b.sent : 1, "repeated recovery does not resend");
      if (b.expect === "UNCERTAIN") {
        assert.equal(e.rt.views()[0].display, "Needs attention");
        assert.throws(() => e.rt.reconcile(t.id, "happened", "device:phone"), /workstation owner/);
        // The owner knows the truth: here it is what the recorded world says.
        e.rt.reconcile(t.id, b.sent ? "happened" : "not_happened", "workstation");
        await settle(e);
      }
      assert.equal(state(e, t.id), "COMPLETED");
      assert.equal(e.world.sent.length, 1, "exactly one send in total");
    } finally { cleanup(e); }
  });
}

test("T1-5 idempotent step after a crash is verified under its stable key before any re-execution", async () => {
  let e = env();
  try {
    const t = e.rt.create({ spec: spec([{ id: "up", kind: "external.upsert" }]), envelope: envelope({ background: false }) }, "workstation");
    e.rt.approve(t.id, "workstation");
    e.faults.set(t.id, "after-effect");
    await settle(e);
    kill(e);
    e = await restart(e, { resumeOnStart: true });
    assert.equal(e.store.operation(`${t.id}:up`)!.state, "needs_verify");
    await settle(e);
    assert.equal(state(e, t.id), "COMPLETED");
    assert.equal(e.world.upserts.get(`${t.id}:up`), 1, "found by key; not applied again");
  } finally { cleanup(e); }
});

test("T1-5 cancelling during an irreversible send after dispatch yields UNCERTAIN, never a silent success or a retry", async () => {
  const e = env();
  try {
    const t = e.rt.create({ spec: spec([{ id: "send", kind: "external.send", input: { to: "team" } }]), envelope: envelope({ background: false }) }, "workstation");
    e.rt.approve(t.id, "workstation");
    e.world.hold(`${t.id}:send`);
    await e.rt.tick();
    await new Promise(r => setTimeout(r, 20));
    e.rt.cancel(t.id, "workstation");
    await e.rt.idle();
    assert.equal(state(e, t.id), "UNCERTAIN"); assert.equal(e.world.sent.length, 1);
    await settle(e);
    assert.equal(e.world.sent.length, 1);
  } finally { cleanup(e); }
});

// ── scenario 6: dependency order across recovery ───────────────────────────────────────────────────────────────────
test("T1-6 queued tasks recover in dependency order; a failed dependency fails its dependents", async () => {
  let e = env();
  try {
    const order: string[] = [];
    const a = e.rt.create({ spec: spec([{ id: "s", kind: "local.read", input: { n: "A" } }], { title: "A" }), envelope: envelope({ sideEffects: false, background: false }) }, "workstation");
    const b = e.rt.create({ spec: spec([{ id: "s", kind: "local.read", input: { n: "B" } }], { title: "B", dependsOn: [a.id] }), envelope: envelope({ sideEffects: false, background: false }) }, "workstation");
    const c = e.rt.create({ spec: spec([{ id: "s", kind: "local.read", input: { n: "C" } }], { title: "C", dependsOn: [b.id] }), envelope: envelope({ sideEffects: false, background: false }) }, "workstation");
    e.faults.set(a.id, "after-claim");
    await settle(e);
    kill(e);
    e = await restart(e, { resumeOnStart: true });
    e.events.length = 0;
    for (let i = 0; i < 4; i++) await settle(e);
    for (const ev of e.events) if (ev.type === "ptask.changed" && / RUNNING$/.test(ev.detail) && !order.includes(ev.detail.split(":")[0])) order.push(ev.detail.split(":")[0]);
    assert.deepEqual(order, ["A", "B", "C"]);
    for (const t of [a, b, c]) assert.equal(state(e, t.id), "COMPLETED");
    const x = e.rt.create({ spec: spec([{ id: "s", kind: "local.read" }], { title: "X" }), envelope: envelope({ sideEffects: false, background: false }) }, "workstation");
    const y = e.rt.create({ spec: spec([{ id: "s", kind: "local.read" }], { title: "Y", dependsOn: [x.id] }), envelope: envelope({ sideEffects: false, background: false }) }, "workstation");
    e.rt.pause(x.id, "workstation"); e.rt.cancel(x.id, "workstation");
    await settle(e);
    assert.equal(state(e, y.id), "FAILED"); assert.equal(e.store.get(y.id).record.failure?.code, "DEPENDENCY_FAILED");
  } finally { cleanup(e); }
});

// ── scenario 7: leases and fencing ───────────────────────────────────────────────────────────────────────────────────
test("T1-7 stale ownership: a reclaimed task's old worker cannot commit; two Hosts never both claim one task", async () => {
  const one = env({ instance: "host-one" });
  const two = env({ instance: "host-two", existing: one });
  try {
    const t = one.rt.create({ spec: spec([{ id: "a", kind: "local.read" }, { id: "b", kind: "local.read" }]), envelope: envelope({ sideEffects: false, background: false }) }, "workstation");
    await Promise.all([one.rt.tick(), two.rt.tick()]);
    one.world.hold(`${t.id}:a`);
    const holder = one.store.get(t.id).leaseHolder;
    assert.ok(holder === "host-one" || holder === "host-two");
    assert.equal(one.rt.activeCount() + two.rt.activeCount(), 1, "exactly one claim");
    await one.rt.idle(); await two.rt.idle();
    // A stuck worker: host-one claims a new task and stalls; its lease expires; host-two takes over.
    const s = one.rt.create({ spec: spec([{ id: "a", kind: "local.read" }, { id: "b", kind: "local.read" }]), envelope: envelope({ sideEffects: false, background: false }) }, "workstation");
    one.world.hold(`${s.id}:a`);
    await one.rt.tick();
    const oldFence = one.store.get(s.id).fence;
    one.clock.t += 31_000;
    await two.rt.recover(false);
    assert.equal(two.store.get(s.id).record.state, "RESUMING");
    assert.ok(two.store.get(s.id).fence > oldFence, "the takeover bumped the fencing token");
    assert.throws(() => one.store.update(s.id, { actor: "host-one", reason: "late", now: one.clock.t, lease: { holder: "host-one", fence: oldFence }, mutate: () => {} }), StaleLeaseError);
    one.world.release(`${s.id}:a`);
    await one.rt.idle();
    assert.ok(one.events.some(ev => ev.type === "ptask.stale_worker_rejected" && ev.taskId === s.id), "the old worker's commit was refused");
    await two.rt.tick(); await two.rt.idle();
    assert.equal(two.store.get(s.id).record.state, "COMPLETED");
    assert.equal(two.store.operation(`${s.id}:a`)!.attempts, 2, "read-only work redone once by the new owner");
  } finally { two.rt.crash(); two.db.close(); cleanup(one); }
});

// ── scenario 8: authority after restart ─────────────────────────────────────────────────────────────────────────────
test("T1-8 restart re-verifies authority: expired approval waits, expired envelope and revocation stop the task", async () => {
  let e = env();
  try {
    const mk = (title: string, over: Partial<Envelope> = {}) => e.rt.create({ spec: spec([{ id: "send", kind: "external.send", input: { to: title } }], { title }), envelope: envelope({ background: false, ...over }) }, "workstation");
    const approval = mk("approval"), expiring = mk("envelope", { expiresAt: T0 + 2 * HOUR }), revoked = mk("revoked");
    for (const t of [approval, expiring, revoked]) e.rt.approve(t.id, "workstation", { ttlMs: HOUR });
    e.rt.revoke(revoked.id, "workstation");
    assert.throws(() => e.rt.revoke(approval.id, "device:phone"), /workstation owner/);
    e.ui.attached = false; // nothing runs before the restart
    await settle(e);
    kill(e);
    e = await restart(e, { advanceMs: 3 * HOUR, resumeOnStart: true });
    e.ui.attached = true;
    await settle(e);
    assert.equal(state(e, approval.id), "AWAITING_APPROVAL", "a one-hour approval is not standing authority");
    assert.equal(state(e, expiring.id), "FAILED"); assert.equal(e.store.get(expiring.id).record.failure?.code, "ENVELOPE_EXPIRED");
    assert.equal(state(e, revoked.id), "FAILED"); assert.equal(e.store.get(revoked.id).record.failure?.code, "AUTHORITY_REVOKED");
    assert.equal(e.world.sent.length, 0, "nothing was sent without live authority");
  } finally { cleanup(e); }
});

// ── scenarios 9, 13: pins and hardware ──────────────────────────────────────────────────────────────────────────────
test("T1-9/13 pins survive recovery; a missing pinned model or low memory blocks the task — no other model is used", async () => {
  let e = env();
  try {
    const t = e.rt.create({ spec: spec([{ id: "g1", kind: "local.generate", model: "pin:7b", input: { prompt: "p1" } }, { id: "g2", kind: "local.generate", model: "pin:7b", input: { prompt: "p2" } }]), envelope: envelope({ sideEffects: false, background: false, models: ["pin:7b", "other:7b"] }) }, "workstation");
    e.faults.set(t.id, "after-receipt");
    await settle(e);
    kill(e);
    e = await restart(e, { resumeOnStart: true });
    e.models.delete("pin:7b"); e.models.add("other:7b");
    await settle(e);
    const blocked = e.store.get(t.id).record;
    assert.equal(blocked.state, "PAUSED"); assert.equal(blocked.blocked?.code, "MODEL_UNAVAILABLE"); assert.equal(e.rt.views()[0].display, "Needs attention");
    assert.deepEqual(e.world.calls.map(c => c.model), ["pin:7b"], "no substitute model was called");
    assert.ok(e.store.notifications().some(n => n.kind === "recovery_blocked"), "recovery-blocked notification");
    e.models.add("pin:7b"); e.resources.ok = false;
    e.rt.resume(t.id, "workstation"); await settle(e);
    assert.equal(e.store.get(t.id).record.blocked?.code, "RESOURCES_UNAVAILABLE");
    e.resources.ok = true;
    e.rt.resume(t.id, "workstation"); await settle(e);
    assert.equal(state(e, t.id), "COMPLETED");
    assert.deepEqual(e.world.calls.map(c => c.model), ["pin:7b", "pin:7b"]);
    assert.equal(e.rt.gateStats().peakConcurrent, 1, "one GPU-heavy call at a time");
  } finally { cleanup(e); }
});

test("T1-9 a served model that differs from the pin fails the task (PIN_VIOLATION); budgets bound inference", async () => {
  const e = env();
  try {
    const wrong: ModelCall = async () => ({ ok: true, text: "x", servedModel: "other:7b", durationMs: 1 });
    const rt = new PersistentTaskRuntime({ store: e.store, executors: executors(e.world), call: wrong, modelAvailable: async () => true, uiAttached: () => true, now: () => e.clock.t });
    const t = rt.create({ spec: spec([{ id: "g", kind: "local.generate", model: "pin:7b", input: { prompt: "p" } }]), envelope: envelope({ sideEffects: false, background: false }) }, "workstation");
    await rt.tick(); await rt.idle();
    assert.equal(e.store.get(t.id).record.failure?.code, "PIN_VIOLATION");
    const b = rt.create({ spec: spec([{ id: "g1", kind: "local.generate", model: "pin:7b", input: { prompt: "p" } }, { id: "g2", kind: "local.generate", model: "pin:7b", input: { prompt: "p" } }]), envelope: envelope({ sideEffects: false, background: false, budgets: { maxModelCalls: 1, maxWallMs: HOUR } }) }, "workstation");
    const ok: ModelCall = async req => ({ ok: true, text: "x", servedModel: req.model, durationMs: 1 });
    const rt2 = new PersistentTaskRuntime({ store: e.store, executors: executors(e.world), call: ok, modelAvailable: async () => true, uiAttached: () => true, now: () => e.clock.t });
    await rt2.tick(); await rt2.idle();
    assert.equal(e.store.get(b.id).record.failure?.code, "BUDGET_EXHAUSTED");
    rt.crash(); rt2.crash();
  } finally { cleanup(e); }
});

// ── scenario 11: startup policy ─────────────────────────────────────────────────────────────────────────────────────
test("T1-11 after a restart, work resumes only under the owner's startup policy (default: wait for the user)", async () => {
  let e = env();
  try {
    const t = e.rt.create({ spec: spec([{ id: "a", kind: "local.read" }, { id: "b", kind: "local.read" }]), envelope: envelope({ sideEffects: false, background: false }) }, "workstation");
    e.faults.set(t.id, "after-receipt");
    await settle(e);
    kill(e);
    e = await restart(e);
    const rec = e.store.get(t.id).record;
    assert.equal(rec.state, "PAUSED"); assert.equal(rec.blocked?.code, "HOST_RESTARTED"); assert.equal(e.rt.views()[0].display, "Paused");
    await settle(e);
    assert.equal(e.world.reads, 1, "nothing ran on its own after the restart");
    e.rt.resume(t.id, "workstation"); await settle(e);
    assert.equal(state(e, t.id), "COMPLETED"); assert.equal(e.world.reads, 2);
    assert.throws(() => e.rt.setPolicy({ background: true }, "device:phone"), /owner settings/);
  } finally { cleanup(e); }
});

// ── scenario 12, 15: authority boundaries and privacy ───────────────────────────────────────────────────────────────
test("T1-12/15 only the workstation creates or approves; envelopes cannot be widened; no cross-project leakage; no credentials stored", async () => {
  const e = env();
  try {
    const good = { spec: spec([{ id: "a", kind: "local.read" }]), envelope: envelope({ sideEffects: false, background: false }) };
    assert.throws(() => e.rt.create(good, "device:phone"), /workstation only/);
    assert.throws(() => e.rt.create({ ...good, envelope: { ...envelope(), providers: ["openrouter"] } }, "workstation"), /ollama/, "cloud inference is not expressible");
    assert.throws(() => e.rt.create({ ...good, envelope: { ...envelope(), localOnly: false } }, "workstation"));
    assert.throws(() => e.rt.create({ spec: spec([{ id: "s", kind: "external.send" }]), envelope: envelope({ sideEffects: false }) }, "workstation"), /side effects/);
    assert.throws(() => e.rt.create({ spec: spec([{ id: "s", kind: "external.send" }]), envelope: envelope({ capabilities: ["local.read"] }) }, "workstation"), /capability external.send/);
    assert.throws(() => e.rt.create({ spec: spec([{ id: "g", kind: "local.generate", model: "big:70b" }]), envelope: envelope() }, "workstation"), /not in the envelope/);
    assert.throws(() => e.rt.create({ spec: spec([{ id: "a", kind: "local.read" }], { projectId: "proj-b" }), envelope: envelope() }, "workstation"), /outside the envelope's scope/);
    assert.throws(() => e.rt.create({ spec: spec([{ id: "a", kind: "local.read", input: { key: "api_key=sk-abcdefghijklmnopqrstuv" } }]), envelope: envelope() }, "workstation"), /credential/);
    const other = e.rt.create({ spec: spec([{ id: "a", kind: "local.read" }], { projectId: "proj-b" }), envelope: envelope({ projectScopes: ["proj-b"], sideEffects: false, background: false }) }, "workstation");
    assert.throws(() => e.rt.create({ spec: spec([{ id: "a", kind: "local.read" }], { dependsOn: [other.id] }), envelope: envelope() }, "workstation"), /another project/);
    const pending = e.rt.create({ spec: spec([{ id: "s", kind: "external.send", input: { to: "private-recipient@example.com" } }]), envelope: envelope() }, "workstation");
    assert.throws(() => e.rt.approve(pending.id, "device:phone"), /workstation owner/);
    const json = JSON.stringify(e.rt.snapshot()) + JSON.stringify(e.store.checkpoints(pending.id));
    assert.equal(json.includes("private-recipient"), false, "views and checkpoints carry no step input");
  } finally { cleanup(e); }
});

// ── scenario 16: notifications ──────────────────────────────────────────────────────────────────────────────────────
test("T1-16 notifications are local, respect settings and are never duplicated by recovery", async () => {
  let e = env();
  try {
    const t = e.rt.create({ spec: spec([{ id: "send", kind: "external.send", input: { to: "x" } }]), envelope: envelope({ background: false }) }, "workstation");
    e.rt.approve(t.id, "workstation");
    e.faults.set(t.id, "after-effect");
    await settle(e);
    kill(e);
    for (let i = 0; i < 3; i++) { e = await restart(e, { resumeOnStart: true }); await settle(e); await e.rt.recover(false); kill(e); }
    e = await restart(e, { resumeOnStart: true });
    const kinds = () => e.store.notifications().filter(n => n.taskId === t.id).map(n => n.kind).sort();
    assert.deepEqual(kinds(), ["approval_required", "recovery_blocked"], "one each across four Host lives");
    e.rt.reconcile(t.id, "happened", "workstation"); await settle(e);
    await e.rt.recover(false); await settle(e);
    assert.deepEqual(kinds(), ["approval_required", "completed", "recovery_blocked"]);
    e.store.setPolicy({ ...e.store.policy(), notifications: { enabled: true, kinds: ["failed"] } });
    const q = e.rt.create({ spec: spec([{ id: "a", kind: "local.read" }]), envelope: envelope({ sideEffects: false, background: false }) }, "workstation");
    await settle(e);
    const done = e.store.notifications().find(n => n.taskId === q.id && n.kind === "completed")!;
    assert.equal(done.delivered, false, "a kind the user turned off is recorded but not delivered");
    assert.equal(e.events.filter(ev => ev.type === "ptask.notification" && ev.taskId === q.id).length, 0);
  } finally { cleanup(e); }
});

// ── deadlines, sleep, scenario 18 ───────────────────────────────────────────────────────────────────────────────────
test("T1 deadlines fail waiting tasks honestly; a sleep gap is recorded, never counted as progress", async () => {
  const e = env();
  try {
    const t = e.rt.create({ spec: spec([{ id: "a", kind: "local.read" }], { deadlineAt: T0 + HOUR }), envelope: envelope({ sideEffects: false, background: false }) }, "workstation");
    e.ui.attached = false;
    e.clock.t += 2 * HOUR;
    e.ui.attached = true;
    await settle(e);
    assert.equal(e.store.get(t.id).record.failure?.code, "DEADLINE_MISSED"); assert.equal(e.world.reads, 0);
    assert.ok(e.store.notifications().some(n => n.kind === "deadline_missed"));
    const s = e.rt.create({ spec: spec([{ id: "a", kind: "local.read" }]), envelope: envelope({ sideEffects: false, background: false }) }, "workstation");
    e.world.hold(`${s.id}:a`);
    await e.rt.tick();
    await e.rt.maintain();
    e.clock.t += 10 * 60_000; // the machine slept for ten minutes
    await e.rt.maintain();
    const rec = e.store.get(s.id).record;
    assert.ok(rec.suspendedMs >= 9 * 60_000, "the gap is recorded"); assert.equal(rec.usage.workMs, 0, "no work time was claimed for it");
    e.world.release(`${s.id}:a`); await e.rt.idle();
  } finally { cleanup(e); }
});

test("T1-18 repeated crash and recovery leaves no runaway child processes", async () => {
  let e = env();
  try {
    const t = e.rt.create({ spec: spec([{ id: "c", kind: "local.child", maxAttempts: 3 }]), envelope: envelope({ sideEffects: false, background: false }) }, "workstation");
    for (let i = 0; i < 3; i++) {
      e.world.hold(`${t.id}:c`);
      e.ui.attached = true;
      await e.rt.tick();
      await new Promise(r => setTimeout(r, 300));
      assert.equal(e.store.processes().length, 1, "the child's identity is recorded durably");
      // A real Host death orphans the child: mark the runtime dead WITHOUT aborting its step, then the next Host cleans up.
      Object.assign(e.rt, { dead: true, closed: true });
      e.db.close();
      e.ui.attached = false; // the next Host only recovers; it starts nothing until the test opens a window again
      e = await restart(e, { resumeOnStart: true, advanceMs: 31_000 });
      assert.equal(e.store.processes().length, 0, "recovery killed and forgot the orphan");
    }
    e.ui.attached = true;
    await settle(e);
    await new Promise(r => setTimeout(r, 300));
    const alive = ((e.world as World & { children?: number[] }).children ?? []).filter(pid => { try { process.kill(pid, 0); return true; } catch { return false; } });
    assert.deepEqual(alive, [], "every child from every Host life is gone");
    assert.equal(e.store.get(t.id).record.state, "FAILED", "three interrupted attempts exhaust the step's budget");
  } finally { cleanup(e); }
});
