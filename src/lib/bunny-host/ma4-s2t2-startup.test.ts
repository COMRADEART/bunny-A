// MA4-S2-T2 Phase 1 (F-CI1-1): a Host that cannot hold its port opens no state, changes no state and leaks nothing.
// The port is the single-Host guard, so it is taken before the database is opened or any recovery runs. A start that
// fails after that point closes what it opened and frees the port.
import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:net";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startHost } from "./http.server.ts";
import type { Executor } from "./ma4/task-runtime.server.ts";

async function freePort() {
  const s = createServer(); await new Promise<void>(r => s.listen(0, "127.0.0.1", r));
  const a = s.address(); assert.ok(a && typeof a !== "string"); await new Promise<void>(r => s.close(() => r())); return a.port;
}
const telemetry = async () => ({ at: Date.now(), cpu: { utilization: null, clockMhz: null, temperatureC: null }, memory: { usedBytes: 0, availableBytes: 1, totalBytes: 1 }, gpus: [], notes: ["S2-T2 fixture telemetry"] });
let release: (() => void) | null = null;
const runs: string[] = [];
const slow: Executor = { kind: "local.read", category: "read_only", gpu: false, sideEffect: false, timeoutMs: 30_000,
  async run(input, ctx) { runs.push(ctx.stepId); if (input.wait) await new Promise<void>(r => { release = r; ctx.signal.addEventListener("abort", () => r(), { once: true }); }); return { ok: true, output: "x" }; } };
const ptasks = { executors: [slow], call: async () => ({ ok: false as const, error: "no model", durationMs: 0 }), modelAvailable: async () => false };
const envelope = { capabilities: ["local.read"], providers: ["ollama"], localOnly: true, models: [], projectScopes: ["p1"], sideEffects: false, background: false, budgets: { maxModelCalls: 0, maxWallMs: 3_600_000 }, expiresAt: Date.now() + 86_400_000 };
/** The listeners and timers a refused start must not add, once this test's own closed fetch sockets have settled. */
const handles = async () => { await new Promise(r => setTimeout(r, 50)); return process.getActiveResourcesInfo().filter(kind => kind === "TCPServerWrap" || kind === "Timeout").sort().join(","); };
const removable = (dir: string) => { try { rmSync(dir, { recursive: true, force: true }); return "removed"; } catch (error) { return (error as NodeJS.ErrnoException).code ?? "error"; } };

test("T2-H1 a second Host on the same data directory and port is refused before it opens or changes any state", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bunny-s2t2-same-")); const root = join(dir, "project"); mkdirSync(root);
  const port = await freePort();
  const options = { dataDirectory: dir, root, port, adapters: [], sample: telemetry, ptasks };
  const first = await startHost(options);
  const h = { connection: "close", Authorization: `Bearer ${first.token}`, "Content-Type": "application/json" };
  const state = async () => (await fetch(`http://127.0.0.1:${port}/state`, { headers: h })).json() as Promise<Record<string, any>>;
  try {
    await state();
    const created = await (await fetch(`http://127.0.0.1:${port}/command`, { method: "POST", headers: h, body: JSON.stringify({ action: "ptask.create", data: { spec: { title: "Held", projectId: "p1", steps: [{ id: "w", kind: "local.read", input: { wait: true } }, { id: "z", kind: "local.read", input: {} }], acceptance: { requiredSteps: ["w", "z"] } }, envelope } }) })).json() as Record<string, any>;
    assert.ok(created.data?.id, JSON.stringify(created));
    for (let i = 0; i < 100 && !release; i++) await new Promise(r => setTimeout(r, 20));
    // An MA3 task the first Host is running. A Host that recovers this data directory marks such a task failed.
    first.manager.db.db.prepare("INSERT INTO tasks(id,record) VALUES(?,?)").run("live-ma3", JSON.stringify({ id: "live-ma3", state: "running", provider: "ollama", prompt: "p", createdAt: Date.now(), startedAt: Date.now(), executionScope: { access: "read" }, logs: [], mode: "fast", model: null, decision: { task_type: "chat", complexity: "low", scores: [] } }));
    const snapshot = () => JSON.stringify({
      tasks: first.manager.db.db.prepare("SELECT id, record FROM tasks ORDER BY id").all(),
      events: first.manager.db.cursor(),
      ptasks: first.manager.db.db.prepare("SELECT * FROM ma4_tasks ORDER BY id").all(),
    });
    const before = snapshot(); const beforeHandles = await handles();
    for (let attempt = 0; attempt < 5; attempt++)
      await assert.rejects(startHost(options), (error: NodeJS.ErrnoException) => error.code === "EADDRINUSE");
    assert.equal(snapshot(), before, "the refused Host changed no task, event or persistent-task row");
    assert.equal(JSON.parse((first.manager.db.db.prepare("SELECT record FROM tasks WHERE id='live-ma3'").get() as { record: string }).record).state, "running");
    assert.equal(await handles(), beforeHandles, "five refused starts left no handle behind");
    release!();
    for (let i = 0; i < 100 && (await state()).persistentTasks.tasks[0].state !== "COMPLETED"; i++) await new Promise(r => setTimeout(r, 20));
    assert.equal((await state()).persistentTasks.tasks[0].state, "COMPLETED");
    assert.deepEqual(runs, ["w", "z"], "each step ran once, on the first Host");
  } finally {
    await first.close();
  }
  assert.equal(removable(dir), "removed", "no refused Host kept the state files open (F-CI1-1)");
});

test("T2-H2 a Host refused at listen() on its own data directory creates no state there and leaks no handle", async () => {
  const blocker = createServer(); await new Promise<void>(r => blocker.listen(0, "127.0.0.1", r));
  const port = (blocker.address() as { port: number }).port;
  const dir = mkdtempSync(join(tmpdir(), "bunny-s2t2-port-")); const root = join(dir, "project"); mkdirSync(root);
  const before = await handles();
  try {
    await assert.rejects(startHost({ dataDirectory: dir, root, port, adapters: [], sample: telemetry, ptasks }), (error: NodeJS.ErrnoException) => error.code === "EADDRINUSE");
    assert.equal(existsSync(join(dir, "host.sqlite")), false, "no database was opened");
    assert.equal(existsSync(join(dir, "credentials.json")), false, "no credentials were registered");
    assert.equal(await handles(), before);
  } finally {
    await new Promise<void>(r => blocker.close(() => r()));
  }
  assert.equal(removable(dir), "removed");
});

test("T2-H3 a start that fails after the port is taken closes its database, frees the port, and a retry then succeeds", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bunny-s2t2-abort-")); const root = join(dir, "project"); mkdirSync(root);
  const port = await freePort();
  const before = await handles();
  // The default root does not exist: TaskManager refuses it after the database is open (aborted initialisation).
  for (let attempt = 0; attempt < 3; attempt++)
    await assert.rejects(startHost({ dataDirectory: dir, root: join(dir, "missing"), port, adapters: [], sample: telemetry, ptasks }), (error: NodeJS.ErrnoException) => error.code === "ENOENT");
  assert.equal(await handles(), before, "the listener and every timer were released");
  assert.equal(removable(join(dir, "host.sqlite")), "removed", "the database file is closed");
  const host = await startHost({ dataDirectory: dir, root, port, adapters: [], sample: telemetry, ptasks });
  try {
    const r = await fetch(`http://127.0.0.1:${port}/state`, { headers: { connection: "close", Authorization: `Bearer ${host.token}` } });
    assert.equal(r.status, 200); await r.body?.cancel();
  } finally {
    await host.close();
  }
  assert.equal(removable(dir), "removed");
});
