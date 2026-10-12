import test from "node:test";
import assert from "node:assert/strict";
import {
  backoffMs,
  canAct,
  commandCaption,
  connectionReducer,
  freshnessLabel,
  initialConnection,
  isMutating,
  LIVE_REFRESH_MS,
  mayStream,
  nextRefreshMs,
  pairingReason,
  pollIntervalMs,
  reconcileCaption,
  shouldRetry,
  SNAPSHOT_FRESH_MS,
  STREAM_READY_MS,
  STREAM_STALE_MS,
  type Connection,
  type ConnectionEvent,
} from "./connection-model.ts";
import { HEARTBEAT_SIGNAL, READY_SIGNAL, signalStream } from "../../lib/bunny-host/event-signal.ts";

const run = (events: ConnectionEvent[], start: Connection = initialConnection()) =>
  events.reduce(connectionReducer, start);

test("T9 connection: a fresh snapshot without a proven stream is polling, never live", () => {
  const c = run([{ type: "read-ok", at: 1_000, hostChanged: false }]);
  assert.equal(c.state, "polling");
  assert.equal(canAct(c, 1_500), true);
});
test("T9 connection: live only after the stream's ready/hb signal and while the snapshot is fresh", () => {
  let c = run([
    { type: "read-ok", at: 1_000, hostChanged: false },
    { type: "stream-open", at: 1_100 },
    { type: "stream-signal", at: 1_200 },
  ]);
  assert.equal(c.state, "live");
  // Heartbeats stop: after the stale bound the same view is only polling.
  c = connectionReducer(c, { type: "tick", at: 1_200 + STREAM_STALE_MS + 1 });
  assert.equal(c.state, "polling");
  // The snapshot itself ages out: controls stop acting even though nothing failed yet.
  assert.equal(canAct(c, 1_000 + SNAPSHOT_FRESH_MS + 1), false);
});
test("T9 connection: a stream that never says ready within its deadline counts as stalled", () => {
  let c = run([
    { type: "read-ok", at: 0, hostChanged: false },
    { type: "stream-open", at: 0 },
  ]);
  c = connectionReducer(c, { type: "tick", at: STREAM_READY_MS - 1 });
  assert.equal(c.state, "polling");
  assert.equal(c.streamErrors, 0);
  c = connectionReducer(c, { type: "tick", at: STREAM_READY_MS + 1 });
  assert.ok(c.streamErrors >= 3, "stalled stream is marked failed");
  c = connectionReducer(c, { type: "read-ok", at: STREAM_READY_MS + 2, hostChanged: false });
  assert.equal(c.state, "polling", "a buffering tunnel never shows as live");
});
test("T9 connection: read failures go reconnecting then offline, and success resets", () => {
  let c = run([{ type: "read-ok", at: 0, hostChanged: false }]);
  c = connectionReducer(c, { type: "read-fail", at: 10 });
  assert.equal(c.state, "reconnecting");
  assert.equal(canAct(c, 11), false, "no control acts on a view that just failed to refresh");
  c = connectionReducer(c, { type: "read-fail", at: 20 });
  assert.equal(c.state, "offline");
  assert.equal(c.snapshotAt, 0, "retained data keeps its real (stale) time");
  c = connectionReducer(c, { type: "read-ok", at: 30, hostChanged: false });
  assert.equal(c.state, "polling");
  assert.equal(c.readFailures, 0);
});
test("T9 connection: first-load failure stays connecting, not reconnecting", () => {
  assert.equal(run([{ type: "read-fail", at: 0 }]).state, "connecting");
});
test("T9 connection: pairing is terminal — no retries, no streams, ignores later reads", () => {
  let c = run([
    { type: "read-ok", at: 0, hostChanged: false },
    { type: "stream-signal", at: 1 },
    { type: "pairing", code: "DEVICE_REVOKED" },
  ]);
  assert.equal(c.state, "pairing");
  assert.equal(c.pairingCode, "DEVICE_REVOKED");
  assert.equal(c.snapshotAt, null, "protected view is forgotten");
  assert.equal(shouldRetry(c.state), false);
  assert.equal(mayStream(c.state), false);
  assert.equal(nextRefreshMs(c, true), null);
  assert.equal(canAct(c, 2), false);
  c = connectionReducer(c, { type: "read-ok", at: 5, hostChanged: false });
  c = connectionReducer(c, { type: "read-fail", at: 6 });
  assert.equal(c.state, "pairing");
  c = connectionReducer(c, { type: "paired", at: 7 });
  assert.equal(c.state, "connecting");
  assert.equal(pairingReason("DEVICE_EXPIRED"), "This device's session expired.");
  assert.match(pairingReason(null), /pair/);
});
test("T9 connection: a different Host blocks every control until the user trusts it", () => {
  let c = run([{ type: "read-ok", at: 0, hostChanged: true }]);
  assert.equal(c.state, "host-changed");
  assert.equal(canAct(c, 1), false);
  assert.equal(shouldRetry(c.state), false);
  c = connectionReducer(c, { type: "read-ok", at: 2, hostChanged: true });
  assert.equal(c.state, "host-changed");
  c = connectionReducer(c, { type: "trust-host", at: 3 });
  assert.equal(c.state, "polling");
  assert.equal(canAct(c, 4), true);
  // Trust is a no-op unless a change is pending.
  assert.equal(connectionReducer(c, { type: "trust-host", at: 5 }), c);
});
test("T9 connection: backoff and polling cadence are bounded", () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 50].map(backoffMs), [3_000, 6_000, 12_000, 30_000, 60_000, 60_000, 60_000]);
  assert.equal(backoffMs(0), 3_000);
  assert.equal(pollIntervalMs(true), 3_000);
  assert.equal(pollIntervalMs(false), 30_000);
  const polling = run([{ type: "read-ok", at: 0, hostChanged: false }]);
  assert.equal(nextRefreshMs(polling, true), 3_000);
  assert.equal(nextRefreshMs(polling, false), 30_000);
  const live = run([{ type: "read-ok", at: 0, hostChanged: false }, { type: "stream-signal", at: 1 }]);
  assert.equal(nextRefreshMs(live, true), LIVE_REFRESH_MS, "a live stream reconciles on the live cadence");
  assert.equal(nextRefreshMs(live, false), LIVE_REFRESH_MS, "hidden does not slow a live stream's reconcile");
  const failing = run([{ type: "read-ok", at: 0, hostChanged: false }, { type: "read-fail", at: 1 }, { type: "read-fail", at: 2 }, { type: "read-fail", at: 3 }]);
  assert.equal(nextRefreshMs(failing, true), 12_000);
});
test("T13 liveness: a healthy live connection never ages its snapshot past the freshness window", () => {
  // The character liveness check (hostLive) reads the snapshot age against SNAPSHOT_FRESH_MS. The schedule itself is
  // under test: at the scheduled wake-up the snapshot is LIVE_REFRESH_MS old and must still be live (otherwise a
  // healthy connection flickers OFFLINE between reads). Ending every cycle with a read-ok at the same instant would
  // make that vacuous, so the tick is evaluated alone, before its re-read.
  assert.ok(LIVE_REFRESH_MS < SNAPSHOT_FRESH_MS, "the live cadence must be shorter than the freshness window");
  let c = run([{ type: "read-ok", at: 0, hostChanged: false }, { type: "stream-signal", at: 1 }]);
  assert.equal(c.state, "live");
  let at = 0;
  for (let cycle = 0; cycle < 40; cycle += 1) {
    at += nextRefreshMs(c, true) ?? Number.NaN;
    c = run([{ type: "tick", at }], c);
    assert.equal(c.state, "live", `cycle ${cycle}: a scheduled wake-up inside the cadence is still live`);
    assert.equal(at - (c.snapshotAt ?? 0), LIVE_REFRESH_MS, `cycle ${cycle}: the wake-up snapshot age equals the live cadence`);
    c = run([{ type: "stream-signal", at }, { type: "read-ok", at, hostChanged: false }], c);
    assert.equal(c.state, "live", `cycle ${cycle}: still live after a scheduled re-read`);
    assert.ok(at - (c.snapshotAt ?? 0) <= SNAPSHOT_FRESH_MS);
  }
});
test("T13 liveness: a live connection whose re-read stops really goes stale (not silently live)", () => {
  // Correctness half: when the Host stops answering, the state must leave `live` once the snapshot ages out.
  const c = run([{ type: "read-ok", at: 0, hostChanged: false }, { type: "stream-signal", at: 1 }]);
  const aged = connectionReducer(c, { type: "tick", at: SNAPSHOT_FRESH_MS + 1 });
  assert.equal(aged.state, "polling", "an aged snapshot is polling (retained, labelled), never live and never a false OFFLINE");
  assert.equal(aged.readFailures, 0);
});
test("T9 connection: an unchanged tick returns the same object (no re-render storm)", () => {
  const c = run([{ type: "read-ok", at: 0, hostChanged: false }]);
  assert.equal(connectionReducer(c, { type: "tick", at: 1 }), c);
});
test("T9 commands: only mutating actions carry operation ids and epochs", () => {
  for (const action of ["agent.get", "mission.get", "operation.status", "project.artifact", "project.list", "project.get", "agent.list"])
    assert.equal(isMutating(action), false, action);
  for (const action of ["agent.stop", "agent.pause", "agent.resume", "mission.respond", "agent.authorization.approve", "device.revoke", "submit"])
    assert.equal(isMutating(action), true, action);
});
test("T9 commands: captions come from codes and outcomes, never parsed text", () => {
  assert.match(commandCaption({ code: "OUTCOME_UNKNOWN", message: "x", outcome: "unknown" }), /Outcome unknown/);
  assert.match(commandCaption({ code: "HOST_EPOCH_CHANGED", message: "Pair this device" }), /Nothing was changed/);
  assert.match(commandCaption({ code: "RATE_LIMITED", message: "" }), /Too many/);
  assert.equal(commandCaption({ code: "WORKSTATION_REQUIRED", message: "Approval required on Windows Host." }), "Approval required on Windows Host.");
  assert.match(commandCaption({ code: "DEVICE_REVOKED", message: "", pairing: true }), /revoked/);
  assert.match(commandCaption({ code: "HOST_UNREACHABLE", message: "" }), /Nothing was sent/);
});
test("T9 commands: a lost acknowledgement resolves only from the Host's own record", () => {
  assert.equal(reconcileCaption("applied", true), "Confirmed by the Host.");
  assert.equal(reconcileCaption("refused", true, "Approval required on Windows Host."), "Approval required on Windows Host.");
  assert.match(reconcileCaption("unknown", true), /no record/);
  assert.match(reconcileCaption("applied", false), /restarted/, "a new epoch never confirms an old operation");
  assert.match(reconcileCaption("failed", true), /failure/);
});
test("T9 freshness: retained data shows the real time it was last confirmed", () => {
  assert.equal(freshnessLabel(null, 5, String), "Not yet updated from the Host");
  assert.equal(freshnessLabel(1_000, 2_000, String), "Updated just now");
  assert.equal(freshnessLabel(1_000, 60_000, (ms) => `t${ms}`), "Last updated t1000");
});
test("T9 bridge liveness: ready first, heartbeats become named hb events, content never crosses", async () => {
  const encoder = new TextEncoder();
  const source = new ReadableStream<Uint8Array>({
    start(output) {
      output.enqueue(encoder.encode(": heartbeat\n\n"));
      output.enqueue(encoder.encode('data: {"sequence":7,"detail":"private prompt"}\n\n'));
      output.close();
    },
  });
  let cleaned = 0;
  const text = await new Response(signalStream(source, () => cleaned++, true, true)).text();
  assert.equal(text, READY_SIGNAL + HEARTBEAT_SIGNAL + 'id: 7\ndata: {"sequence":7}\n\n');
  assert.ok(!text.includes("private"));
  assert.equal(cleaned, 1);
});
