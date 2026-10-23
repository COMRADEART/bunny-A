// MA4-S2-T1 through the real Host HTTP API: workstation authority, paired-device default-deny, privacy of the phone view,
// and a Host restart on the same data directory. Executors are recorded fakes injected through the test-only seam.
import test from "node:test";
import assert from "node:assert/strict";
import { connect, createServer } from "node:net";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startHost } from "./http.server.ts";
import type { Executor } from "./ma4/task-runtime.server.ts";

async function freePort() {
  const s = createServer(); await new Promise<void>(r => s.listen(0, "127.0.0.1", r));
  const a = s.address(); assert.ok(a && typeof a !== "string"); await new Promise<void>(r => s.close(() => r())); return a.port;
}
const runs: string[] = [];
let release: (() => void) | null = null;
const slow: Executor = { kind: "local.read", category: "read_only", gpu: false, sideEffect: false, timeoutMs: 30_000,
  async run(input, ctx) { runs.push(`${ctx.taskId}:${ctx.stepId}`); if (input.wait) await new Promise<void>(r => { release = r; ctx.signal.addEventListener("abort", () => r(), { once: true }); }); return ctx.signal.aborted ? { ok: false, error: "stopped", dispatched: true, definite: false } : { ok: true, output: `secret-output-${ctx.stepId}` }; } };
const failing: Executor = { kind: "local.fail", category: "read_only", gpu: false, sideEffect: false, timeoutMs: 30_000,
  async run() { return { ok: false, error: "C:\Users\owner\secret-folder\report.txt could not be read", dispatched: false, fatal: "STEP_FAILED" }; } };
const envelope = (background: boolean) => ({ capabilities: ["local.read", "local.fail"], providers: ["ollama"], localOnly: true, models: [], projectScopes: ["p1"], sideEffects: false, background, budgets: { maxModelCalls: 0, maxWallMs: 3_600_000 }, expiresAt: Date.now() + 86_400_000 });
// Fixture telemetry: startup then takes the same few milliseconds after listen() here as on a clean hosted runner, where
// no hardware probe runs. With the PC's real probes (~600 ms) the restart race below was hidden locally (MA4-S2-T1-CI1).
const telemetry = async () => ({ at: Date.now(), cpu: { utilization: null, clockMhz: null, temperatureC: null }, memory: { usedBytes: 0, availableBytes: 1, totalBytes: 1 }, gpus: [], notes: ["S2-T1 fixture telemetry"] });
const spec = (steps: { id: string; input?: Record<string, unknown> }[], title = "Nightly digest") => ({ title, projectId: "p1", steps: steps.map(s => ({ kind: "local.read", input: {}, ...s })), acceptance: { requiredSteps: steps.map(s => s.id) } });

test("T1-11/12 Host API: workstation creates and runs; a paired phone reads and supervises but cannot create, approve, resolve or read outputs", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bunny-s2t1-host-")); const root = join(dir, "project"); mkdirSync(root);
  const port = await freePort();
  const options = { dataDirectory: dir, root, port, adapters: [], sample: telemetry, ptasks: { executors: [slow, failing], call: async () => ({ ok: false as const, error: "no model", durationMs: 0 }), modelAvailable: async () => false } };
  let host = await startHost(options);
  const base = `http://127.0.0.1:${port}`;
  // One connection per request: this test restarts the Host in-process on the same port. A keep-alive socket the first
  // Host already closed can still look idle to fetch when the restarted Host's first request goes out; that request is
  // then reset (read ECONNRESET) without reaching any Host (hosted Windows; MA4-S1R3-CI2, MA4-S2-T1-CI1).
  const fresh = { connection: "close" };
  const command = async (action: string, data: unknown = {}, token = host.token) => {
    const r = await fetch(`${base}/command`, { method: "POST", headers: { ...fresh, Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ action, data }) });
    return { status: r.status, body: await r.json() as Record<string, any> };
  };
  const state = async (token = host.token) => (await fetch(`${base}/state`, { headers: { ...fresh, Authorization: `Bearer ${token}` } })).json() as Promise<Record<string, any>>;
  try {
    await state(); // the Island's poll: a workstation window is attached
    const created = await command("ptask.create", { spec: spec([{ id: "a", input: { note: "private-prompt-text" } }, { id: "b" }]), envelope: envelope(false) });
    assert.equal(created.status, 200, JSON.stringify(created.body));
    const id = created.body.data.id as string;
    for (let i = 0; i < 50 && (await state()).persistentTasks.tasks[0].state !== "COMPLETED"; i++) await new Promise(r => setTimeout(r, 20));
    const ws = await state();
    assert.equal(ws.persistentTasks.tasks[0].state, "COMPLETED"); assert.equal(ws.persistentTasks.tasks[0].display, "Completed");
    assert.deepEqual(runs, [`${id}:a`, `${id}:b`]);
    assert.equal((await command("ptask.output", { id, stepId: "a" })).body.data.content, "secret-output-a", "the owner can read results");

    const pairing = await command("pairing.create");
    const phone = (await (await fetch(`${base}/pair`, { method: "POST", headers: { ...fresh, "Content-Type": "application/json" }, body: JSON.stringify({ code: pairing.body.pairCode, name: "S2T1 phone" }) })).json() as { token: string }).token;
    for (const action of ["ptask.create", "ptask.approve", "ptask.reconcile", "ptask.revoke", "ptask.policy", "ptask.output"]) {
      const r = await command(action, { id, stepId: "a", decision: "happened", spec: spec([{ id: "x" }]), envelope: envelope(true), policy: { background: true } }, phone);
      assert.equal(r.status, 400, action); assert.equal(r.body.code, "WORKSTATION_REQUIRED", action);
    }
    assert.equal((await state()).persistentTasks.tasks.length, 1, "nothing was created by the phone (before the owner's next task)");
    assert.equal((await state()).persistentTasks.policy.background, false, "the phone cannot turn background work on");
    const broken = (await command("ptask.create", { spec: { ...spec([{ id: "f" }], "Broken"), steps: [{ id: "f", kind: "local.fail", input: {} }] }, envelope: envelope(false) })).body.data.id as string;
    for (let i = 0; i < 50 && (await state()).persistentTasks.tasks.find((t: { id: string }) => t.id === broken).state !== "FAILED"; i++) await new Promise(r => setTimeout(r, 20));
    assert.match(JSON.stringify((await state()).persistentTasks), /secret-folder/, "the owner sees the failure detail");
    const phoneView = await state(phone);
    const phoneBroken = phoneView.persistentTasks.tasks.find((t: { id: string }) => t.id === broken);
    assert.equal(phoneBroken.failure.code, "STEP_FAILED"); assert.equal(phoneBroken.failure.detail, "Details are retained on the Windows Host.");
    assert.equal(phoneView.persistentTasks.tasks[0].id, id);
    const text = JSON.stringify(phoneView);
    assert.equal(text.includes("private-prompt-text"), false); assert.equal(text.includes("secret-output"), false); assert.equal(text.includes("secret-folder"), false, "local paths in failure text stay on the PC");
    assert.equal((await command("ptask.list", {}, phone)).status, 200);

    // A long-running task the phone pauses; the Host then restarts with the default startup policy.
    const second = (await command("ptask.create", { spec: spec([{ id: "w", input: { wait: true } }, { id: "z" }], "Long job"), envelope: envelope(false) })).body.data.id as string;
    for (let i = 0; i < 50 && !release; i++) await new Promise(r => setTimeout(r, 20));
    assert.equal((await command("ptask.pause", { id: second }, phone)).status, 200);
    release!();
    for (let i = 0; i < 50 && (await state()).persistentTasks.tasks.find((t: { id: string }) => t.id === second).state !== "PAUSED"; i++) await new Promise(r => setTimeout(r, 20));
    assert.equal(runs.filter(r => r.startsWith(second)).length, 1);
    await host.close();
    host = await startHost(options);
    const after = await state();
    const recovered = after.persistentTasks.tasks.find((t: { id: string }) => t.id === second);
    assert.equal(recovered.state, "PAUSED", "still paused after the restart: nothing resumed on its own");
    assert.equal(after.persistentTasks.tasks.length, 3, "same tasks, no duplicates");
    assert.equal((await command("ptask.resume", { id: second }, phone)).status, 200, "the phone may resume within the task's envelope");
    for (let i = 0; i < 50 && (await state()).persistentTasks.tasks.find((t: { id: string }) => t.id === second).state !== "COMPLETED"; i++) await new Promise(r => setTimeout(r, 20));
    assert.equal((await state()).persistentTasks.tasks.find((t: { id: string }) => t.id === second).state, "COMPLETED");
    assert.deepEqual(runs.filter(r => r.startsWith(second)), [`${second}:w`, `${second}:z`], "the paused step was not re-run");
  } finally { await host.close(); rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
});

test("CI1-F4 a client that drops its connection mid-request never gets a task created or run twice; a phone's dropped create is still refused", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bunny-s2t1-drop-")); const root = join(dir, "project"); mkdirSync(root);
  const port = await freePort();
  const options = { dataDirectory: dir, root, port, adapters: [], sample: telemetry, ptasks: { executors: [slow, failing], call: async () => ({ ok: false as const, error: "no model", durationMs: 0 }), modelAvailable: async () => false } };
  let host = await startHost(options);
  const fresh = { connection: "close" };
  const base = `http://127.0.0.1:${port}`;
  const command = async (action: string, data: unknown = {}, token = host.token) => {
    const r = await fetch(`${base}/command`, { method: "POST", headers: { ...fresh, Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ action, data }) });
    return { status: r.status, body: await r.json() as Record<string, any> };
  };
  const tasks = async () => (await (await fetch(`${base}/state`, { headers: { ...fresh, Authorization: `Bearer ${host.token}` } })).json() as Record<string, any>).persistentTasks.tasks as { id: string; title: string; state: string }[];
  // Writes the request on a raw socket and destroys it without reading the response; `cut` truncates the body first.
  const dropped = (token: string, body: string, cut = body.length) => new Promise<void>((done, fail) => {
    const socket = connect(port, "127.0.0.1", () => {
      socket.write(`POST /command HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nAuthorization: Bearer ${token}\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body.slice(0, cut)}`, () => { socket.destroy(); done(); });
    });
    socket.on("error", fail);
  });
  const settle = async (title: string, state: string) => { for (let i = 0; i < 100 && (await tasks()).find(t => t.title === title)?.state !== state; i++) await new Promise(r => setTimeout(r, 20)); };
  try {
    const create = (title: string) => JSON.stringify({ action: "ptask.create", data: { spec: spec([{ id: "a" }, { id: "b" }], title), envelope: envelope(false) } });
    await tasks(); // the Island's poll: a workstation window is attached
    await dropped(host.token, create("Dropped after send"));
    await settle("Dropped after send", "COMPLETED");
    const sent = (await tasks()).filter(t => t.title === "Dropped after send");
    assert.equal(sent.length, 1, "a complete request whose client vanished creates the task exactly once");
    assert.equal(sent[0].state, "COMPLETED");
    assert.deepEqual(runs.filter(r => r.startsWith(sent[0].id)), [`${sent[0].id}:a`, `${sent[0].id}:b`], "each step ran once");

    await dropped(host.token, create("Dropped mid-body"), 40);
    await new Promise(r => setTimeout(r, 200));
    assert.equal((await tasks()).some(t => t.title === "Dropped mid-body"), false, "a truncated request creates nothing");

    const pairing = await command("pairing.create");
    const phone = (await (await fetch(`${base}/pair`, { method: "POST", headers: { ...fresh, "Content-Type": "application/json" }, body: JSON.stringify({ code: pairing.body.pairCode, name: "CI1 phone" }) })).json() as { token: string }).token;
    await dropped(phone, create("Phone dropped create"));
    await new Promise(r => setTimeout(r, 200));
    assert.equal((await tasks()).some(t => t.title === "Phone dropped create"), false, "a dropped connection never turns a phone create into an authorized one");
    assert.equal((await command("ptask.create", { spec: spec([{ id: "x" }]), envelope: envelope(false) }, phone)).body.code, "WORKSTATION_REQUIRED");

    // The Host is restarted on the same port and data: nothing re-runs, nothing is duplicated.
    const before = runs.length;
    await host.close();
    host = await startHost(options);
    const after = (await tasks()).filter(t => t.title === "Dropped after send");
    assert.equal(after.length, 1); assert.equal(after[0].state, "COMPLETED");
    assert.equal((await tasks()).length, 1, "only the one real task exists after the restart");
    await new Promise(r => setTimeout(r, 200));
    assert.equal(runs.length, before, "no step ran again after the restart");
  } finally { await host.close(); rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
});
