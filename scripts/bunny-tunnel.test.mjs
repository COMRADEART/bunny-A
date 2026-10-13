import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { announcedQuickTunnel, readyTunnelAddress, loopbackTunnelOrigin, parseRegistrationEvents, startupTunnelDecision } from "./bunny-tunnel-state.mjs";
import { superviseTunnel } from "./bunny-tunnel-worker.mjs";

const announcement = [
  "2026-10-02T13:20:00Z INF | Your quick Tunnel has been created! Visit it at (it may take some time to be reachable): |",
  "2026-10-02T13:20:00Z INF | https://verified-bunny-candidate.trycloudflare.com |",
].join("\n");
const registered = "2026-10-02T13:20:01Z INF Registered tunnel connection connIndex=0 protocol=http2";

test("Cloudflare API errors and documentation are never public companion URLs", () => {
  const failure = 'failed to request quick Tunnel: Post "https://api.trycloudflare.com/tunnel": socket access forbidden';
  assert.equal(announcedQuickTunnel(failure), null);
  assert.equal(readyTunnelAddress(`${failure}\n${registered}`), null);
  assert.equal(announcedQuickTunnel("Visit https://other.trycloudflare.com in the docs"), null);
});

test("quick tunnel publishing requires both actual announcement and registered connection", () => {
  assert.equal(announcedQuickTunnel(announcement), "https://verified-bunny-candidate.trycloudflare.com");
  assert.equal(readyTunnelAddress(announcement), null);
  assert.equal(readyTunnelAddress(`${announcement}\n${registered}`), "https://verified-bunny-candidate.trycloudflare.com");
  assert.equal(readyTunnelAddress(registered), null);
});

test("chunked cloudflared output stays unavailable until the full hostname and connection arrive", () => {
  let buffered = "";
  const chunks = [announcement.slice(0, 90), announcement.slice(90, -24), announcement.slice(-24), `\n${registered}`];
  chunks.forEach((chunk, index) => {
    buffered += chunk;
    assert.equal(readyTunnelAddress(buffered), index === 3 ? "https://verified-bunny-candidate.trycloudflare.com" : null);
  });
});

test("an announced API service address is rejected even after connection text", () => {
  assert.equal(readyTunnelAddress(`${announcement.replace("verified-bunny-candidate", "api")}\n${registered}`), null);
});

test("named tunnels retain their configured origin and wait for registration", () => {
  assert.equal(readyTunnelAddress("Starting named tunnel", "https://bunny.example.com"), null);
  assert.equal(readyTunnelAddress(registered, "https://bunny.example.com"), "https://bunny.example.com");
});

test("candidate tunnel target is loopback-only without changing the installed default", () => {
  assert.equal(loopbackTunnelOrigin(), "http://127.0.0.1:8084");
  assert.equal(loopbackTunnelOrigin("http://127.0.0.1:8085/"), "http://127.0.0.1:8085");
  for (const address of ["https://127.0.0.1:8085", "http://0.0.0.0:8085", "http://example.com:8085", "http://127.0.0.1", "http://user@127.0.0.1:8085", "http://127.0.0.1:8085/path", "http://127.0.0.1:8085/?a=1"]) {
    assert.throws(() => loopbackTunnelOrigin(address));
  }
});

test("the child's registration ledger parses register and unregister events with connIndex", () => {
  assert.deepEqual(parseRegistrationEvents("2026-10-06T02:36:33Z INF Registered tunnel connection connIndex=2 ip=198.41.192.7"), [{ kind: "register", connIndex: 2 }]);
  assert.deepEqual(parseRegistrationEvents("2026-10-06T03:40:11Z INF Unregistered tunnel connection connIndex=2"), [{ kind: "unregister", connIndex: 2 }]);
  assert.deepEqual(parseRegistrationEvents("2026-10-06T03:40:11Z INF Registered tunnel connection"), [{ kind: "register", connIndex: null }]);
  assert.deepEqual(parseRegistrationEvents("ERR Register tunnel error from server side error=\"Unauthorized: Tunnel not found\""), []);
  assert.deepEqual(parseRegistrationEvents("Lost connection with the edge"), []);
  assert.deepEqual(parseRegistrationEvents("INF Unregistered tunnel connection connIndex=0"), [{ kind: "unregister", connIndex: 0 }]);
});

test("startup decisions reconcile a dead worker's stale publication and refuse a live duplicate", () => {
  const pidAlive = (pid) => pid === 111;
  assert.deepEqual(startupTunnelDecision({ remote: null, recorded: null, pid: 7, pidAlive }), { action: "none" });
  assert.deepEqual(startupTunnelDecision({ remote: null, recorded: { pid: 111 }, pid: 7, pidAlive }), { action: "refuse", recordedPid: 111 });
  assert.deepEqual(startupTunnelDecision({ remote: null, recorded: { pid: 200 }, pid: 7, pidAlive }), { action: "none" });
  assert.deepEqual(startupTunnelDecision({ remote: { tunnelPid: 200 }, recorded: { pid: 200 }, pid: 7, pidAlive }), { action: "reconcile", reason: "recorded-worker-200-not-running" });
  assert.deepEqual(startupTunnelDecision({ remote: { tunnelPid: 111 }, recorded: { pid: 111 }, pid: 7, pidAlive }), { action: "refuse", recordedPid: 111 });
  assert.deepEqual(startupTunnelDecision({ remote: { tunnelPid: 7 }, recorded: { pid: 7 }, pid: 7, pidAlive }), { action: "reconcile", reason: "publication-predates-current-worker" });
  assert.deepEqual(startupTunnelDecision({ remote: { url: "https://stale.trycloudflare.com" }, recorded: null, pid: 7, pidAlive }), { action: "reconcile", reason: "remote-publication-has-no-worker-record" });
  assert.deepEqual(startupTunnelDecision({ remote: { tunnelPid: 200 }, recorded: null, pid: 7, pidAlive }), { action: "reconcile", reason: "recorded-worker-200-not-running" });
});

// The supervisor tests use a fake owned child (EventEmitter pipe + kill) with
// the production health policy shrunk to sub-second windows.
function fakeChild(lines) {
  const child = new EventEmitter();
  child.pid = 40000;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.killed = false;
  child.kill = () => {
    if (child.killed) return;
    child.killed = true;
    queueMicrotask(() => child.emit("exit", 1, null));
  };
  child.write = (text) => queueMicrotask(() => child.stdout.emit("data", text));
  child.emitLines = (text) => child.write(text.endsWith("\n") ? text : `${text}\n`);
  if (lines) queueMicrotask(() => lines.forEach((line) => child.emitLines(line)));
  return child;
}
const containmentStub = { contain: async () => {}, fatal: () => {}, background: () => {} };
const registeredLine = (index) => `INF Registered tunnel connection connIndex=${index} ip=198.41.192.${index}`;
const unregisteredLine = (index) => `INF Unregistered tunnel connection connIndex=${index}`;

test("a healthy child keeps the supervisor quiet; abort ends the single attempt", async () => {
  const controller = new AbortController();
  const children = [];
  const pending = superviseTunnel({
    start: () => {
      const child = fakeChild([registeredLine(0), registeredLine(1)]);
      children.push(child);
      return child;
    },
    output: async () => {},
    unavailable: async () => {},
    signal: controller.signal,
    containment: containmentStub,
    delayMs: 30,
    health: { zeroActiveWindowMs: 120, churnWindowMs: 5000, churnEventFloor: 7, checkIntervalMs: 20, probeIntervalMs: 30, probe: async () => ({ outcome: "ok" }) },
  });
  try {
    await new Promise((resolve) => setTimeout(resolve, 400));
  } finally {
    controller.abort();
  }
  const result = await pending;
  assert.equal(result.attempts, 1);
  assert.equal(result.recoveryRequired, false);
  assert.deepEqual(result.degradations, []);
  assert.equal(children[0].killed, true);
});

test("zero active edge connections sustained beyond the window stop the owned child and retry", async () => {
  const controller = new AbortController();
  const children = [];
  let attempt = 0;
  const unavailableCalls = [];
  const pending = superviseTunnel({
    start: () => {
      attempt++;
      const child = fakeChild(attempt === 1 ? [registeredLine(0)] : [registeredLine(0), registeredLine(1)]);
      children.push(child);
      return child;
    },
    output: async () => {},
    unavailable: async (exit) => unavailableCalls.push(exit),
    signal: controller.signal,
    containment: containmentStub,
    delayMs: 30,
    health: { zeroActiveWindowMs: 120, churnWindowMs: 5000, churnEventFloor: 7, checkIntervalMs: 20, probeIntervalMs: 3000, probe: async () => null },
  });
  try {
    await new Promise((resolve) => setTimeout(resolve, 400));
    children[0].emitLines(unregisteredLine(0));
    await new Promise((resolve) => setTimeout(resolve, 500));
    assert.equal(attempt, 2);
    assert.equal(children[0].killed, true);
    assert.equal(unavailableCalls.length, 1);
  } finally {
    controller.abort();
  }
  const result = await pending;
  assert.equal(result.attempts, 2);
  assert.equal(result.degradations.length, 1);
  assert.equal(result.degradations[0].reason, "zero-active-edge-connections");
  assert.equal(result.degradations[0].registeredTotal, 1);
  assert.equal(result.recoveryRequired, false);
});

test("edge-connection churn with a sub-floor active count stops the child exactly as the T6 diagnostic recorded", async () => {
  const controller = new AbortController();
  const children = [];
  let attempt = 0;
  const pending = superviseTunnel({
    start: () => {
      attempt++;
      const lines = attempt === 1
        ? [registeredLine(0), registeredLine(1), unregisteredLine(1), registeredLine(1), unregisteredLine(1), registeredLine(1), unregisteredLine(1)]
        : [registeredLine(0), registeredLine(1)];
      const child = fakeChild(lines);
      children.push(child);
      return child;
    },
    output: async () => {},
    unavailable: async () => {},
    signal: controller.signal,
    containment: containmentStub,
    delayMs: 30,
    health: { zeroActiveWindowMs: 60000, churnWindowMs: 5000, churnEventFloor: 7, churnActiveFloor: 2, checkIntervalMs: 20, probeIntervalMs: 3000, probe: async () => null },
  });
  try {
    await new Promise((resolve) => setTimeout(resolve, 500));
    assert.equal(attempt, 2);
    assert.equal(children[0].killed, true);
  } finally {
    controller.abort();
  }
  const result = await pending;
  assert.equal(result.attempts, 2);
  assert.equal(result.degradations.length, 1);
  assert.equal(result.degradations[0].reason, "edge-connection-churn");
  assert.equal(result.degradations[0].registeredTotal, 4);
  assert.equal(result.degradations[0].unregisteredTotal, 3);
  assert.equal(result.degradations[0].activeCount, 1);
  assert.equal(result.recoveryRequired, false);
});

test("sustained public failures reach the streak floor while a gateway fault breaks the streak without counting", async () => {
  const controller = new AbortController();
  const children = [];
  let attempt = 0;
  let calls = 0;
  const answers = ["public", "public", "public", "origin", "public", "public", "public", "public", "public", "public"];
  const pending = superviseTunnel({
    start: () => {
      attempt++;
      const child = fakeChild(attempt === 1 ? [registeredLine(0)] : [registeredLine(0), registeredLine(1)]);
      children.push(child);
      return child;
    },
    output: async () => {},
    unavailable: async () => {},
    signal: controller.signal,
    containment: containmentStub,
    delayMs: 30,
    health: {
      zeroActiveWindowMs: 60000,
      churnWindowMs: 5000,
      churnEventFloor: 50,
      checkIntervalMs: 20,
      probeIntervalMs: 30,
      probeFailureStreakFloor: 6,
      probeRateSampleFloor: 12, // rate rule disabled for this test
      probeRateFailureFloor: 1,
      probe: async () => {
        const answer = answers[calls++];
        return answer === "public" ? { outcome: "public" } : answer === "origin" ? { outcome: "origin" } : { outcome: "ok" };
      },
    },
  });
  try {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    assert.equal(attempt, 2);
    assert.equal(children[0].killed, true);
  } finally {
    controller.abort();
  }
  const result = await pending;
  assert.equal(result.attempts, 2);
  assert.equal(result.degradations.length, 1);
  assert.equal(result.degradations[0].reason, "public-endpoint-unreachable");
  assert.equal(result.recoveryRequired, false);
});

test("a degradation-triggered child exit still counts against the bounded attempt budget", async () => {
  const controller = new AbortController();
  let attempt = 0;
  const result = await superviseTunnel({
    start: () => {
      attempt++;
      return fakeChild([registeredLine(0), registeredLine(1), unregisteredLine(1), registeredLine(1), unregisteredLine(1), registeredLine(1), unregisteredLine(1)]);
    },
    output: async () => {},
    unavailable: async () => {},
    signal: controller.signal,
    containment: containmentStub,
    delayMs: 20,
    health: { zeroActiveWindowMs: 60000, churnWindowMs: 5000, churnEventFloor: 7, churnActiveFloor: 2, checkIntervalMs: 20, probeIntervalMs: 3000, probe: async () => null },
  });
  assert.equal(result.attempts, 3);
  assert.equal(result.degradations.length, 3);
  assert.equal(result.recoveryRequired, true);
  controller.abort();
  await new Promise((resolve) => setTimeout(resolve, 120));
});
