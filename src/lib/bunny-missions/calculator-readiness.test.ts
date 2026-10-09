import test from "node:test";
import assert from "node:assert/strict";
import { ComputerCapability, CALCULATOR_SCRIPTS } from "./capabilities/computer.server.ts";
import type { ExecutionContext } from "./capabilities/bus.server.ts";
import type { CalculatorIdentity } from "./capabilities/calculator-targets.server.ts";
import type { ApprovalBatch } from "./types.ts";

// Injected native responses test the actual adapter admission boundary. These are SIMULATED;
// the original, unchanged X53 supplies independent real Windows UIA acceptance.
const identity: CalculatorIdentity = { handle: "17", processId: 31, processStartedAt: "100", contentProcessId: 32, contentStartedAt: "101" };
const context = (): ExecutionContext => ({ missionId: "A", stepId: "s", capabilityRunId: "r", cwd: ".", roots: ["."], dataDirectory: ".", signal: new AbortController().signal, timeoutMs: 10000, crossApp: true, revalidate: () => null, desktopBatch: { expiresAt: Date.now() + 10000, windowIdentity: identity } });

test("T9R readiness: preparation is a pure probe; only admitted open requests restoration", async () => {
  const flags: unknown[] = [];
  const adapter = new ComputerCapability("unused", undefined, async (script, args, _signal, _timeout, scope) => {
    assert.equal(script, CALCULATOR_SCRIPTS.valid);
    assert.deepEqual(scope!.windowIdentity, identity);
    flags.push(args.prepareReadiness);
    return { valid: true, needsReadiness: !args.prepareReadiness, readiness: args.prepareReadiness ? { restored: true, attempts: 2, elapsedMs: 100 } : null };
  });
  await assert.rejects(adapter.prepareBatchAction("computer.open_app", { app: "calculator", prepareReadiness: true }, {} as ApprovalBatch), /outside the Calculator batch policy/);
  assert.equal(flags.length, 0, "a caller cannot request preparation effects");
  assert.deepEqual(await adapter.prepareBatchAction("computer.open_app", { app: "calculator" }, { missionId: "A", expiresAt: Date.now() + 10000, windowIdentity: identity } as ApprovalBatch), identity);
  const result = await adapter.execute("computer.open_app", { app: "calculator" }, context());
  assert.equal(result.ok, true);
  assert.deepEqual(flags, [undefined, true]);
  assert.match(result.evidence.join("\n"), /Calculator readiness:.*"restored":true/);
});

for (const fault of ["Wrong signed application", "Frame PID lifetime changed", "Content PID lifetime changed", "HWND replacement", "Stale UIA element", "Readiness budget exhausted", "Modal or password control"]) {
  test(`T9R readiness refuses ${fault} without replacement or invocation`, async () => {
    const scripts: string[] = [];
    const adapter = new ComputerCapability("unused", undefined, async script => { scripts.push(script); throw new Error(fault); });
    await assert.rejects(adapter.execute("computer.open_app", { app: "calculator" }, context()), new RegExp(fault));
    assert.deepEqual(scripts, [CALCULATOR_SCRIPTS.valid]);
  });
}

test("T9R readiness: revoked canonical consent prevents every native call", async () => {
  let calls = 0;
  const adapter = new ComputerCapability("unused", undefined, async () => { calls++; return {}; });
  await assert.rejects(adapter.execute("computer.open_app", { app: "calculator" }, { ...context(), revalidate: () => "Canonical approval revoked" }), /revoked/);
  assert.equal(calls, 0);
});

test("T9R readiness: Stop while another Mission owns the desktop queue cannot restore", async () => {
  let release!: () => void, calls = 0;
  const adapter = new ComputerCapability("unused", undefined, async () => { calls++; await new Promise<void>(resolve => { release = resolve; }); return { valid: true }; });
  const first = adapter.execute("computer.open_app", { app: "calculator" }, context());
  await new Promise(resolve => setImmediate(resolve));
  const aborted = new AbortController();
  const second = adapter.execute("computer.open_app", { app: "calculator" }, { ...context(), missionId: "B", signal: aborted.signal });
  aborted.abort(); release();
  assert.equal((await first).ok, true);
  await assert.rejects(second, /abort/i);
  assert.equal(calls, 1);
});

test("T9R readiness: another active Mission cannot restore the leased target", async () => {
  let calls = 0;
  const adapter = new ComputerCapability("unused", undefined, async () => { calls++; return { valid: true }; });
  await adapter.execute("computer.open_app", { app: "calculator" }, context());
  await assert.rejects(adapter.execute("computer.open_app", { app: "calculator" }, { ...context(), missionId: "B" }), /busy in another Mission/);
  assert.equal(calls, 1);
});
