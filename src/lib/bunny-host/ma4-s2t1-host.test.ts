// MA4-S2-T1 through the real Host HTTP API: workstation authority, paired-device default-deny, privacy of the phone view,
// and a Host restart on the same data directory. Executors are recorded fakes injected through the test-only seam.
import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:net";
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
const envelope = (background: boolean) => ({ capabilities: ["local.read"], providers: ["ollama"], localOnly: true, models: [], projectScopes: ["p1"], sideEffects: false, background, budgets: { maxModelCalls: 0, maxWallMs: 3_600_000 }, expiresAt: Date.now() + 86_400_000 });
const spec = (steps: { id: string; input?: Record<string, unknown> }[], title = "Nightly digest") => ({ title, projectId: "p1", steps: steps.map(s => ({ kind: "local.read", input: {}, ...s })), acceptance: { requiredSteps: steps.map(s => s.id) } });

test("T1-11/12 Host API: workstation creates and runs; a paired phone reads and supervises but cannot create, approve, resolve or read outputs", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bunny-s2t1-host-")); const root = join(dir, "project"); mkdirSync(root);
  const port = await freePort();
  const options = { dataDirectory: dir, root, port, adapters: [], ptasks: { executors: [slow], call: async () => ({ ok: false as const, error: "no model", durationMs: 0 }), modelAvailable: async () => false } };
  let host = await startHost(options);
  const base = `http://127.0.0.1:${port}`;
  const command = async (action: string, data: unknown = {}, token = host.token) => {
    const r = await fetch(`${base}/command`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ action, data }) });
    return { status: r.status, body: await r.json() as Record<string, any> };
  };
  const state = async (token = host.token) => (await fetch(`${base}/state`, { headers: { Authorization: `Bearer ${token}` } })).json() as Promise<Record<string, any>>;
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
    const phone = (await (await fetch(`${base}/pair`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: pairing.body.pairCode, name: "S2T1 phone" }) })).json() as { token: string }).token;
    for (const action of ["ptask.create", "ptask.approve", "ptask.reconcile", "ptask.revoke", "ptask.policy", "ptask.output"]) {
      const r = await command(action, { id, stepId: "a", decision: "happened", spec: spec([{ id: "x" }]), envelope: envelope(true), policy: { background: true } }, phone);
      assert.equal(r.status, 400, action); assert.equal(r.body.code, "WORKSTATION_REQUIRED", action);
    }
    assert.equal((await state()).persistentTasks.tasks.length, 1, "nothing was created by the phone");
    assert.equal((await state()).persistentTasks.policy.background, false, "the phone cannot turn background work on");
    const phoneView = await state(phone);
    assert.equal(phoneView.persistentTasks.tasks[0].id, id);
    const text = JSON.stringify(phoneView);
    assert.equal(text.includes("private-prompt-text"), false); assert.equal(text.includes("secret-output"), false);
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
    assert.equal(after.persistentTasks.tasks.length, 2, "same tasks, no duplicates");
    assert.equal((await command("ptask.resume", { id: second }, phone)).status, 200, "the phone may resume within the task's envelope");
    for (let i = 0; i < 50 && (await state()).persistentTasks.tasks.find((t: { id: string }) => t.id === second).state !== "COMPLETED"; i++) await new Promise(r => setTimeout(r, 20));
    assert.equal((await state()).persistentTasks.tasks.find((t: { id: string }) => t.id === second).state, "COMPLETED");
    assert.deepEqual(runs.filter(r => r.startsWith(second)), [`${second}:w`, `${second}:z`], "the paused step was not re-run");
  } finally { await host.close(); rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
});
