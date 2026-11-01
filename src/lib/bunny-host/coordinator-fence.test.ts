import assert from "node:assert/strict";
import test from "node:test";
import {
  applyOnce,
  acquireLease,
  createLeaseState,
  fenceTokenFor,
  guardAction,
  pickCoordinator,
  renewLease,
  takeoverLease,
  type CoordinatorLease,
  type LeaseState,
} from "./coordinator-fence.ts";

const BASE = 1_793_491_200_000;

function freshLease(state: LeaseState = createLeaseState()): { state: LeaseState; lease: CoordinatorLease } {
  const grant = acquireLease(state, { resourceRef: "task/t-1", holderDeviceId: "d-windows", ttlMs: 60_000, heartbeatMs: 15_000, nowMs: BASE });
  assert.equal(grant.granted, true);
  if (!grant.granted) throw new Error("unreachable");
  return { state, lease: grant.lease };
}

test("fence tokens derive monotonically from the epoch", () => {
  assert.equal(fenceTokenFor(1), "f-0001");
  assert.equal(fenceTokenFor(12), "f-0012");
  assert.throws(() => fenceTokenFor(0));
});

test("first acquisition grants epoch 1; a live rival is refused", () => {
  const { state } = freshLease();
  const rival = acquireLease(state, { resourceRef: "task/t-1", holderDeviceId: "d-relay", ttlMs: 60_000, heartbeatMs: 15_000, nowMs: BASE + 100 });
  assert.equal(rival.granted, false);
  assert.deepEqual(rival, { granted: false, reason: "held_by_other" } as const);
});

test("renew is credential-checked and extends expiry", () => {
  const { state, lease } = freshLease();
  const ok = renewLease(state, { resourceRef: "task/t-1", holderDeviceId: lease.holderDeviceId, epoch: lease.epoch, fenceToken: lease.fenceToken, ttlMs: 60_000, nowMs: BASE + 30_000 });
  assert.equal(ok.renewed, true);
  if (ok.renewed) assert.equal(ok.lease.expiresAtMs, BASE + 90_000);
  const wrongToken = renewLease(state, { resourceRef: "task/t-1", holderDeviceId: lease.holderDeviceId, epoch: lease.epoch, fenceToken: "f-9999", ttlMs: 60_000, nowMs: BASE + 31_000 });
  assert.deepEqual(wrongToken, { renewed: false, reason: "wrong_fence_token" });
  const wrongHolder = renewLease(state, { resourceRef: "task/t-1", holderDeviceId: "d-relay", epoch: lease.epoch, fenceToken: lease.fenceToken, ttlMs: 60_000, nowMs: BASE + 31_000 });
  assert.deepEqual(wrongHolder, { renewed: false, reason: "holder_mismatch" });
});

test("expired lease cannot renew but permits takeover with an epoch bump", () => {
  // Fresh state without seeding a live lease first: build one, then let it expire.
  const state = createLeaseState();
  const g = acquireLease(state, { resourceRef: "task/t-1", holderDeviceId: "d-windows", ttlMs: 1_000, heartbeatMs: 1_000, nowMs: BASE });
  assert.equal(g.granted, true);
  const afterExpiry = BASE + 2_000;
  const renew = renewLease(state, { resourceRef: "task/t-1", holderDeviceId: "d-windows", epoch: 1, fenceToken: "f-0001", ttlMs: 1_000, nowMs: afterExpiry });
  assert.deepEqual(renew, { renewed: false, reason: "expired_lease" });
  const takeover = takeoverLease(state, { resourceRef: "task/t-1", newHolderDeviceId: "d-relay", ttlMs: 60_000, heartbeatMs: 15_000, nowMs: afterExpiry });
  assert.equal(takeover.takeover, true);
  if (takeover.takeover) {
    assert.equal(takeover.lease.epoch, 2);
    assert.equal(takeover.lease.fenceToken, "f-0002");
    assert.equal(takeover.lease.holderDeviceId, "d-relay");
  }
  // Old-epoch credentials are now fenced out of every guarded action.
  const stale = guardAction(state, { resourceRef: "task/t-1", epoch: 1, fenceToken: "f-0001", holderDeviceId: "d-windows", actionKey: "delete-dest" }, afterExpiry + 1);
  assert.deepEqual(stale, { allowed: false, reason: "stale_epoch" });
});

test("takeover of a live lease needs the live credentials (voluntary handover)", () => {
  const { state, lease } = freshLease();
  const noCreds = takeoverLease(state, { resourceRef: "task/t-1", newHolderDeviceId: "d-relay", ttlMs: 60_000, heartbeatMs: 15_000, nowMs: BASE + 100 });
  assert.deepEqual(noCreds, { takeover: false, reason: "active_lease" });
  const badCreds = takeoverLease(state, { resourceRef: "task/t-1", newHolderDeviceId: "d-relay", ttlMs: 60_000, heartbeatMs: 15_000, nowMs: BASE + 100, epoch: lease.epoch, fenceToken: "f-9999" });
  assert.deepEqual(badCreds, { takeover: false, reason: "wrong_credentials" });
  const handover = takeoverLease(state, { resourceRef: "task/t-1", newHolderDeviceId: "d-relay", ttlMs: 60_000, heartbeatMs: 15_000, nowMs: BASE + 100, epoch: lease.epoch, fenceToken: lease.fenceToken });
  assert.equal(handover.takeover, true);
  if (handover.takeover) assert.equal(handover.lease.epoch, lease.epoch + 1);
  // A future epoch claim is never accepted.
  const ahead = takeoverLease(state, { resourceRef: "task/t-1", newHolderDeviceId: "d-android", ttlMs: 60_000, heartbeatMs: 15_000, nowMs: BASE + 150, epoch: 999, fenceToken: "whatever" });
  assert.deepEqual(ahead, { takeover: false, reason: "wrong_credentials" });
});

test("guardAction admits exactly the current lease holder under the live epoch", () => {
  const { state, lease } = freshLease();
  const ok = guardAction(state, { resourceRef: "task/t-1", epoch: lease.epoch, fenceToken: lease.fenceToken, holderDeviceId: lease.holderDeviceId, actionKey: "a-1" }, BASE + 1_000);
  assert.deepEqual(ok, { allowed: true });
  const none = createLeaseState();
  assert.deepEqual(guardAction(none, { resourceRef: "task/t-1", epoch: 1, fenceToken: "f-0001", holderDeviceId: "d-windows", actionKey: "a-1" }, BASE), { allowed: false, reason: "no_lease" });
  assert.deepEqual(guardAction(state, { resourceRef: "task/t-1", epoch: lease.epoch, fenceToken: lease.fenceToken, holderDeviceId: "d-relay", actionKey: "a-1" }, BASE + 1_000), { allowed: false, reason: "holder_mismatch" });
  assert.deepEqual(guardAction(state, { resourceRef: "task/t-1", epoch: lease.epoch, fenceToken: "f-9999", holderDeviceId: lease.holderDeviceId, actionKey: "a-1" }, BASE + 1_000), { allowed: false, reason: "wrong_fence_token" });
  const expired = guardAction(state, { resourceRef: "task/t-1", epoch: lease.epoch, fenceToken: lease.fenceToken, holderDeviceId: lease.holderDeviceId, actionKey: "a-1" }, BASE + 60_000);
  assert.deepEqual(expired, { allowed: false, reason: "expired_lease" });
});

test("applyOnce runs a duplicate delivery exactly once", () => {
  const cache = new Map<string, string>();
  let effects = 0;
  const first = applyOnce(cache, "reconcile/t-1/shutdown-worker", () => {
    effects += 1;
    return "did-once";
  });
  const replay = applyOnce(cache, "reconcile/t-1/shutdown-worker", () => {
    effects += 1;
    return "did-twice";
  });
  assert.equal(effects, 1);
  assert.equal(first.alreadyApplied, false);
  assert.equal(replay.alreadyApplied, true);
  assert.equal(replay.result, "did-once");
});

test("pickCoordinator prefers the healthy server, falls back to Windows, and reports none", () => {
  const serverUp = { deviceId: "d-relay", platform: "server" as const, roles: ["coordinator"], health: "healthy" as const };
  const windows = { deviceId: "d-windows", platform: "windows" as const, roles: ["coordinator", "worker"], health: "healthy" as const };
  assert.deepEqual(pickCoordinator([windows, serverUp]), { deviceId: "d-relay", basis: "server-primary: healthy self-hosted server coordinator" });
  const sickServer = { ...serverUp, health: "offline" as const };
  assert.deepEqual(pickCoordinator([windows, sickServer]), { deviceId: "d-windows", basis: "windows-fallback: server not healthy, healthy Windows coordinator" });
  const phone = { deviceId: "d-android", platform: "android" as const, roles: ["worker"], health: "healthy" as const };
  assert.deepEqual(pickCoordinator([phone, sickServer]).deviceId, null);
});