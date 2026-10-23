// MA4-S2-T1 real-process crash injection: a stand-in Host process (scripts/ma4-s2t1/crash-runner.mjs) owns the store and
// is killed with taskkill /F (no /T) while a step is in flight. A fresh runtime then recovers the same database with the
// production, identity-verified orphan cleanup. Windows only: verified termination uses the reviewed native helper.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { HostDatabase } from "./persistence.server.ts";
import { TaskStore } from "./ma4/task-store.server.ts";
import { PersistentTaskRuntime, type Executor } from "./ma4/task-runtime.server.ts";
import { killVerifiedProcess, processIdentity } from "./ma4/task-executors.server.ts";

const root = resolve(fileURLToPath(new URL("../../../", import.meta.url)));
const skip = process.platform === "win32" ? false : "verified process cleanup is a Windows Host capability";
// Verified termination loads the reviewed native helper, which `npm run pretest` builds (it is not committed).
const nativeSkip = skip || (existsSync(join(root, "native/bunny-owned-process.node")) ? false : "the native ownership helper is not built (run npm run pretest)");
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };

async function killedMidStep(mode: "read" | "send", detached = false) {
  const dir = mkdtempSync(join(tmpdir(), `s2t1-proc-${mode}-`)), db = join(dir, "host.db");
  const runner = spawn(process.execPath, ["--experimental-strip-types", "scripts/ma4-s2t1/crash-runner.mjs", db, dir, mode, "task-1", detached ? "detached" : "joined"], { cwd: root, stdio: "ignore", windowsHide: true });
  for (let i = 0; i < 600 && !existsSync(join(dir, "in-flight")); i++) await new Promise(r => setTimeout(r, 50));
  assert.ok(existsSync(join(dir, "in-flight")), "the runner reached the step");
  const exited = new Promise(r => runner.once("exit", r));
  execFileSync("taskkill.exe", ["/PID", String(runner.pid), "/F"], { windowsHide: true }); // the Host dies; no /T
  await exited;
  return { dir, db, inFlight: JSON.parse(readFileSync(join(dir, "in-flight"), "utf8")) as { child?: number; sent?: boolean } };
}
function recoverer(db: string, executors: Executor[]) {
  const host = new HostDatabase(db), store = new TaskStore(host);
  store.setPolicy({ background: false, resumeOnStart: true });
  const rt = new PersistentTaskRuntime({ store, executors, call: async () => ({ ok: false, error: "none", durationMs: 0 }), modelAvailable: async () => true, uiAttached: () => true,
    identify: processIdentity, killVerified: killVerifiedProcess, exclusive: true });
  return { host, store, rt };
}

test("T1-18 real kill: a Host's ordinary child dies with it (kill-on-close Job); recovery forgets the stale record", { skip }, async () => {
  const { dir, db, inFlight } = await killedMidStep("read");
  try {
    await new Promise(r => setTimeout(r, 300));
    assert.ok(inFlight.child); assert.equal(alive(inFlight.child), false, "no orphan survives the Host");
    const r = recoverer(db, [{ kind: "proc.read", category: "read_only", gpu: false, sideEffect: false, timeoutMs: 10_000, async run() { return { ok: true, output: "done" }; } }]);
    await r.rt.start(); await r.rt.idle();
    assert.equal(r.store.processes().length, 0); assert.equal(r.store.get("task-1").record.state, "COMPLETED");
    await r.rt.close(); r.host.close();
  } finally { rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
});

test("T1-4/18 real kill during a read-only step: an escaped (detached) child is killed by verified identity; the step reruns once", { skip: nativeSkip }, async () => {
  const { dir, db, inFlight } = await killedMidStep("read", true);
  try {
    assert.ok(inFlight.child && alive(inFlight.child), "the escaped child outlived the killed Host (an orphan)");
    let reads = 0;
    const r = recoverer(db, [{ kind: "proc.read", category: "read_only", gpu: false, sideEffect: false, timeoutMs: 10_000, async run() { reads++; return { ok: true, output: "done" }; } }]);
    const started = performance.now();
    await r.rt.start();
    const recoveryMs = performance.now() - started;
    await r.rt.idle();
    assert.equal(alive(inFlight.child!), false, "recovery terminated the orphan");
    assert.equal(r.store.processes().length, 0);
    assert.equal(r.store.get("task-1").record.state, "COMPLETED"); assert.equal(reads, 1);
    assert.equal(r.store.operation("task-1:s")!.attempts, 2, "one interrupted attempt, one completed");
    console.log(`S2T1_RECOVERY_MS read ${recoveryMs.toFixed(1)}`);
    await r.rt.close(); r.host.close();
  } finally { if (inFlight.child && alive(inFlight.child)) process.kill(inFlight.child); rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
});

test("T1-5 real kill after an irreversible send: UNCERTAIN on every restart, never re-sent, resolved only by the owner", { skip }, async () => {
  const { dir, db } = await killedMidStep("send");
  try {
    const ledger = () => readFileSync(join(dir, "external-ledger.txt"), "utf8").trim().split("\n");
    assert.deepEqual(ledger(), ["task-1:s"]);
    let sends = 0;
    const send: Executor = { kind: "proc.send", category: "irreversible", gpu: false, sideEffect: true, timeoutMs: 10_000, async run() { sends++; return { ok: true, output: "sent" }; } };
    for (let life = 0; life < 3; life++) {
      const r = recoverer(db, [send]);
      const started = performance.now();
      await r.rt.start(); await r.rt.tick(); await r.rt.idle();
      if (life === 0) console.log(`S2T1_RECOVERY_MS send ${(performance.now() - started).toFixed(1)}`);
      assert.equal(r.store.get("task-1").record.state, "UNCERTAIN"); assert.equal(sends, 0);
      assert.equal(r.store.notifications().filter(n => n.kind === "recovery_blocked").length, 1, "one notification across Host lives");
      await r.rt.close(); r.host.close();
    }
    const r = recoverer(db, [send]);
    await r.rt.start();
    r.rt.reconcile("task-1", "happened", "workstation");
    await r.rt.tick(); await r.rt.idle();
    assert.equal(r.store.get("task-1").record.state, "COMPLETED"); assert.equal(sends, 0); assert.deepEqual(ledger(), ["task-1:s"]);
    await r.rt.close(); r.host.close();
  } finally { rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
});
