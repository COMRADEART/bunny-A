import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CalculatorTargets, type CalculatorIdentity, type CalculatorDriver, type CalculatorTarget } from "./capabilities/calculator-targets.server.ts";
import { ComputerCapability, CALCULATOR_SCRIPTS } from "./capabilities/computer.server.ts";
import type { ExecutionContext } from "./capabilities/bus.server.ts";
import { HostDatabase } from "../bunny-host/persistence.server.ts";
import { MissionStore } from "./store.server.ts";

function world() {
  const live = new Map<string, CalculatorIdentity>(), records = new Map<string, CalculatorTarget>();
  let launches = 0, probes = 0;
  const storage = { load: (owner: string) => records.get(owner) ?? null, save: (owner: string, target: CalculatorTarget) => { records.set(owner, target); } };
  const driver: CalculatorDriver = {
    valid: async identity => { probes++; return JSON.stringify(live.get(identity.handle)) === JSON.stringify(identity); },
    existing: async () => {
      if (live.size > 1) throw new Error("Ambiguous target");
      return [...live.values()][0] ?? null;
    },
    launch: async () => {
      launches++;
      const identity = { handle: String(launches), processId: 101, processStartedAt: "1000", contentProcessId: 102, contentStartedAt: String(2000 + launches) };
      live.set(identity.handle, identity);
      return { identity, decision: "launched" };
    },
  };
  const targets = new CalculatorTargets(storage);
  const acquire = (owner = "mission:A", signal = new AbortController().signal) => targets.acquire(owner, "run", driver, signal);
  return { live, records, driver, storage, targets, acquire, launches: () => launches, probes: () => probes };
}

test("same workflow acquires twice with one launch and exact identity reuse", async () => {
  const w = world(); const first = await w.acquire(), second = await w.acquire();
  assert.equal(first.decision, "launched"); assert.equal(second.decision, "reuse_bound");
  assert.deepEqual(first.identity, second.identity); assert.equal(w.launches(), 1);
});
test("ten repeated acquisition calls preserve target and do not create windows", async () => {
  const w = world(); const first = await w.acquire();
  for (let i = 0; i < 10; i++) assert.deepEqual((await w.acquire()).identity, first.identity);
  assert.equal(w.launches(), 1); assert.ok(w.probes() >= 10);
});
test("recoverable action failure and retry leave valid acquisition unchanged", async () => {
  const w = world(); const first = await w.acquire();
  // The failed action neither clears target identity nor calls the launcher. A later explicit
  // acquire from retry must still validate and reuse, rather than treating retry as a new app.
  await assert.rejects(async () => { throw new Error("Recoverable postcondition failure"); });
  assert.deepEqual((await w.acquire()).identity, first.identity); assert.equal(w.launches(), 1);
});
test("stale closed native target produces one controlled replacement", async () => {
  const w = world(); const first = await w.acquire(); w.live.delete(first.identity.handle);
  const next = await w.acquire(); assert.equal(next.decision, "launched");
  assert.notDeepEqual(next.identity, first.identity); assert.match(next.reason!, /invalid/);
  await w.acquire(); assert.equal(w.launches(), 2); assert.equal(w.live.size, 1);
});
test("reused handle or PID with another content lifetime is stale", async () => {
  const w = world(); const first = await w.acquire();
  const replacement = { ...first.identity, contentStartedAt: "9999" }; w.live.set(first.identity.handle, replacement);
  const next = await w.acquire(); assert.equal(next.decision, "reuse_existing");
  assert.deepEqual(next.identity, replacement); assert.equal(w.launches(), 1);
});
test("simultaneous same-workflow acquisition and rapid retries serialize to one launch", async () => {
  const w = world(); const all = await Promise.all(Array.from({ length: 12 }, () => w.acquire()));
  assert.equal(w.launches(), 1); assert.ok(all.every(r => r.identity.handle === all[0].identity.handle));
});
test("unrelated workflows hold independent records while intentionally sharing a verified existing target", async () => {
  const w = world(); const a = await w.acquire("mission:A"), b = await w.acquire("mission:B");
  assert.equal(b.decision, "reuse_existing"); assert.deepEqual(a.identity, b.identity);
  assert.equal(w.records.size, 2); assert.notEqual(w.records.get("mission:A"), w.records.get("mission:B"));
  assert.equal(w.records.get("mission:B")!.createdByBunny, false);
  assert.ok(!("grantId" in w.records.get("mission:B")!), "Execution identity carries no approval");
});
test("pre-existing verified target is acquired without launch or cleanup authority", async () => {
  const w = world(); const identity = { handle: "user", processId: 5, processStartedAt: "10" };
  w.live.set(identity.handle, identity);
  assert.deepEqual((await w.acquire()).identity, identity); assert.equal(w.launches(), 0);
  assert.equal(w.records.get("mission:A")!.createdByBunny, false); assert.equal(w.live.size, 1);
});
test("ambiguous existing targets refuse acquisition instead of spawning or choosing arbitrarily", async () => {
  const w = world(); w.live.set("x", { handle: "x", processId: 1, processStartedAt: "1" }); w.live.set("y", { handle: "y", processId: 2, processStartedAt: "2" });
  await assert.rejects(w.acquire(), /Ambiguous/); assert.equal(w.launches(), 0);
});
test("unknown launch failure persists a guard and rapid retries cannot launch again", async () => {
  const w = world(); let attempted = 0;
  w.driver.launch = async () => { attempted++; throw new Error("Launch result lost"); };
  await assert.rejects(w.acquire(), /result lost/);
  for (let i = 0; i < 5; i++) await assert.rejects(w.acquire(), /uncertain/);
  assert.equal(attempted, 1); assert.equal(w.records.get("mission:A")!.phase, "acquiring");
});
test("uncertain launch can recover a verified target without an additional attempt", async () => {
  const w = world(); w.records.set("mission:A", { phase: "acquiring", identity: null, acquiredAt: 1, createdByBunny: false, runId: "old" });
  const identity = { handle: "recovered", processId: 1, processStartedAt: "1" }; w.live.set(identity.handle, identity);
  assert.deepEqual((await w.acquire()).identity, identity); assert.equal(w.launches(), 0);
});
test("Stop before acquisition or while queued prevents any future launch", async () => {
  const w = world(); let release!: () => void;
  w.driver.existing = async () => { await new Promise<void>(r => { release = r; }); return null; };
  const controller = new AbortController(); const pending = w.acquire("mission:A", controller.signal);
  await new Promise(r => setImmediate(r)); controller.abort(); release();
  await assert.rejects(pending); assert.equal(w.launches(), 0);
  await assert.rejects(w.acquire("mission:A", controller.signal)); assert.equal(w.launches(), 0);
});
test("Host restart retains non-authoritative identity but must revalidate it before reuse", async () => {
  const w = world(); const first = await w.acquire(); const probes = w.probes();
  const restarted = new CalculatorTargets(w.storage);
  assert.deepEqual((await restarted.acquire("mission:A", "new-run", w.driver, new AbortController().signal)).identity, first.identity);
  assert.ok(w.probes() > probes); assert.equal(w.launches(), 1);
});
test("target records use existing SQLite settings and do not create a grant or schema", () => {
  const db = new HostDatabase(":memory:"); const store = new MissionStore(db);
  const target: CalculatorTarget = { phase: "bound", identity: { handle: "1", processId: 1, processStartedAt: "2" }, acquiredAt: 1, createdByBunny: false, runId: "r" };
  try { store.saveCalculatorTarget("mission:A", target); assert.deepEqual(store.calculatorTarget("mission:A"), target); assert.equal(store.calculatorTarget("mission:B"), null); assert.equal(store.grants().length, 0); assert.equal(store.requests("A").length, 0); } finally { db.close(); }
});
test("actual Computer adapter repeated action/retry uses recorded native identity without launcher preamble", async () => {
  let launches = 0, invokes = 0; let identity: CalculatorIdentity | null = null;
  const adapter = new ComputerCapability("unused", undefined, async (script, _args, _signal, _timeout, scope) => {
    if (script === CALCULATOR_SCRIPTS.existing) return { identity };
    if (script === CALCULATOR_SCRIPTS.valid) return { valid: JSON.stringify(scope!.windowIdentity) === JSON.stringify(identity) };
    if (script === CALCULATOR_SCRIPTS.acquire) { launches++; identity = { handle: "1", processId: 2, processStartedAt: "3" }; return { identity, decision: "launched" }; }
    assert.deepEqual(scope!.windowIdentity, identity);
    invokes++; if (invokes === 1) throw new Error("Recoverable invocation failure");
    return { windowIdentity: identity, windowPid: 2, pattern: "invoke", control: { name: "2" } };
  });
  const context: ExecutionContext = { missionId: "A", stepId: "s", capabilityRunId: "r", cwd: ".", roots: ["."], dataDirectory: ".", signal: new AbortController().signal, timeoutMs: 10000 };
  await adapter.execute("computer.open_app", { app: "calculator" }, context);
  await assert.rejects(adapter.execute("computer.invoke_control", { title: "Calculator", automationId: "num2Button" }, context), /Recoverable/);
  for (let i = 0; i < 10; i++) await adapter.execute("computer.invoke_control", { title: "Calculator", automationId: "num2Button" }, context);
  assert.equal(launches, 1); assert.equal(invokes, 11);
});
test("production acquisition has no destructive cleanup and validates native/package/content identity", () => {
  const source = readFileSync(new URL("./capabilities/computer.server.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /Stop-Process|taskkill|\.Kill\(|WM_CLOSE|PostMessage/);
  assert.match(source, /contentStartedAt/); assert.match(source, /PublisherId -eq '8wekyb3d8bbwe'/);
  assert.match(CALCULATOR_SCRIPTS.valid, /IsWindow/); assert.match(CALCULATOR_SCRIPTS.valid, /GetWindowThreadProcessId/);
  assert.match(CALCULATOR_SCRIPTS.acquire, /no automatic relaunch/);
});
test("target disappearance after batch admission cannot cause a replacement launch", async () => {
  let launchCalls = 0;
  const adapter = new ComputerCapability("unused", undefined, async script => {
    if (script === CALCULATOR_SCRIPTS.valid) return { valid: false };
    if (script === CALCULATOR_SCRIPTS.acquire) launchCalls++;
    throw new Error("No other native operation may run after bound-target loss");
  });
  const context: ExecutionContext = { missionId: "A", stepId: "s", capabilityRunId: "r", cwd: ".", roots: ["."], dataDirectory: ".", signal: new AbortController().signal, timeoutMs: 10000, desktopBatch: { expiresAt: Date.now() + 10000, windowIdentity: { handle: "1", processId: 2, processStartedAt: "3" } } };
  await assert.rejects(adapter.execute("computer.open_app", { app: "calculator" }, context), /fresh approval/);
  assert.equal(launchCalls, 0);
});
