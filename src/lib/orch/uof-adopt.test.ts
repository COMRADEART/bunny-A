import assert from "node:assert/strict";
import test from "node:test";
import { assertNoSecretKeys, ContractBundleSchema } from "./contracts.ts";
import { decideRoute, type RouteCandidate, type LedgerRecord } from "./route-ledger.ts";
import { advertisedCapability, noteQuota429, recordProbeResult } from "./capability-surface.ts";
import { acquireLease, takeoverLease, createLeaseState, type CoordinatorLease } from "../bunny-host/coordinator-fence.ts";
import {
  capabilityToUof,
  decisionEvent,
  epochToUof,
  leaseToUof,
  outcomeEvent,
  quotaToUof,
  usageEstimate,
  toBundle,
} from "./uof-adopt.ts";

const NOW = 1_793_500_000_000;

function candidate(overrides: Partial<RouteCandidate> & { id: string }): RouteCandidate {
  return {
    provider: "ollama",
    availability: "ready",
    qualityScore: 0.9,
    estimatedCostUsd: 0,
    costBasis: "known",
    latencyP50Ms: 2_000,
    quotaUsedPercent: null,
    deviceRef: null,
    eligible: true,
    ...overrides,
  };
}

function leaseAt(ref: string, holder: string, atMs: number): CoordinatorLease {
  const state = createLeaseState();
  const grant = acquireLease(state, { resourceRef: ref, holderDeviceId: holder, ttlMs: 60_000, heartbeatMs: 15_000, nowMs: atMs });
  if (!grant.granted) throw new Error("unreachable");
  return grant.lease;
}

test("Phase 1B gate scenario: goal -> decision -> probe -> lease -> one contract-valid bundle", () => {
  const taskId = "t-gate-1";
  const decision = decideRoute({
    candidates: [
      candidate({ id: "a-ollama", estimatedCostUsd: 0.004, latencyP50Ms: 2_000 }),
      candidate({ id: "b-codex", provider: "codex", estimatedCostUsd: 0.02 }),
      candidate({ id: "c-codex-unknown", provider: "codex", costBasis: "unknown", estimatedCostUsd: null }),
    ],
    qualityFloor: 0.6,
    nowMs: NOW,
  })!;
  const cap = recordProbeResult(advertisedCapability("cap-gate-1", "ollama", "text", true), { ok: true, atMs: NOW, note: "local run receipt" });
  const q429 = noteQuota429("codex", NOW, { retryAfterMs: 90_000 }); // usedPercent null — provider gave no window
  // Handover on the LIVE state: acquire at epoch 1, then B presents A's live credentials; epoch bumps to 2.
  const fenceState = createLeaseState();
  const acquired = acquireLease(fenceState, { resourceRef: "task/" + taskId, holderDeviceId: "d-windows", ttlMs: 60_000, heartbeatMs: 15_000, nowMs: NOW });
  if (!acquired.granted) throw new Error("unreachable");
  const take = takeoverLease(fenceState, { resourceRef: "task/" + taskId, newHolderDeviceId: "d-relay", ttlMs: 60_000, heartbeatMs: 15_000, nowMs: NOW + 1_000, epoch: acquired.lease.epoch, fenceToken: acquired.lease.fenceToken });
  if (!take.takeover) throw new Error("unreachable");
  assert.equal(take.lease.epoch, 2);
  assert.equal(take.lease.fenceToken, "f-0002");

  const { bundle, violations } = toBundle({
    tasks: [{ taskId, goal: "gate scenario", traceId: "trace-gate", createdAtMs: NOW, priority: "normal", state: "running" }],
    events: [
      decisionEvent(decision, taskId, 1, NOW),
      outcomeEvent({ decisionId: decision.decisionId, outcome: "success", attemptedAtMs: NOW + 5, attemptId: "att-gate-1" }, taskId, 2, NOW + 6),
    ],
    capabilities: [capabilityToUof(cap)],
    quotaSignals: [quotaToUof(q429)],
    usageEstimates: [usageEstimate(decision, 0.004, "u-gate-1")],
    devices: [
      { deviceId: "d-windows", platform: "windows", roles: ["worker"], health: "healthy", powerPolicy: "unrestricted", lastSeenAtMs: NOW },
      { deviceId: "d-relay", platform: "server", roles: ["coordinator", "worker"], health: "healthy", powerPolicy: "unrestricted", lastSeenAtMs: NOW },
    ],
    leases: [leaseToUof(take.lease)],
    coordinatorEpochs: [epochToUof(2, "d-relay", NOW)],
  });

  assert.deepEqual(violations, []);
  const round = ContractBundleSchema.parse(JSON.parse(JSON.stringify(bundle)));
  assert.equal(round.contractsVersion, "uof.v1");
  assertNoSecretKeys(bundle);
  // The 429 with a provider-supplied reset but NO fill number is representable (adoption drifted the contract).
  assert.equal(bundle.quotaSignals[0]?.usedPercent, null);
  assert.equal(bundle.quotaSignals[0]?.source, "http_429");
  // Fence arithmetic survived adoption: epoch bump carried into the contract projection.
  assert.equal(leaseToUof(take.lease).epoch, 2);
});

test("estimate honesty is preserved through adoption", () => {
  const decision = decideRoute({ candidates: [candidate({ id: "x-1", costBasis: "known", estimatedCostUsd: 0.01 })], qualityFloor: 0.5, nowMs: NOW })!;
  const est = usageEstimate(decision, 0.01, "u-1");
  assert.deepEqual(est.cost, { amountUsd: 0.01, basis: "known" });
  assert.throws(() => usageEstimate(decision, null, "u-2"), /requires an amount/);
  const unknownDecision = decideRoute({ candidates: [candidate({ id: "y-1", costBasis: "unknown", estimatedCostUsd: null })], qualityFloor: 0.5, nowMs: NOW })!;
  const unknownEst = usageEstimate(unknownDecision, null, "u-3");
  assert.equal(unknownEst.cost.basis, "unknown");
  assert.equal(unknownEst.cost.amountUsd, null);
  assert.throws(() => usageEstimate(unknownDecision, 0.5, "u-4"), /forbids an amount/);
});

test("outcome mapping is total over the lane's outcome kinds", () => {
  const kinds = (["success", "verify_failed", "quota_exhausted", "provider_failed", "cancelled"] as const)
    .map((outcome) => outcomeEvent({ decisionId: "rd-1", outcome, attemptedAtMs: NOW, attemptId: "a-" + outcome }, "t", 1, NOW).kind);
  assert.deepEqual(kinds, ["completed", "failure", "quota_signal", "failure", "cancelled"]);
});

test("adoption feeds the contract checker: a rogue lease is caught at bundle level", () => {
  const lease = leaseToUof(leaseAt("task/t-rogue", "d-windows", NOW));
  const { violations } = toBundle({
    tasks: [{ taskId: "t-rogue", goal: "rogue test", traceId: "tr", createdAtMs: NOW, priority: "normal", state: "open" }],
    leases: [{ ...lease, holderDeviceId: "d-android" }],
    devices: [
      { deviceId: "d-windows", platform: "windows", roles: ["worker"], health: "healthy", powerPolicy: "unrestricted", lastSeenAtMs: NOW },
      { deviceId: "d-solo", platform: "server", roles: ["coordinator"], health: "healthy", powerPolicy: "unrestricted", lastSeenAtMs: NOW },
    ],
    coordinatorEpochs: [epochToUof(1, "d-solo", NOW)],
  });
  assert.ok(violations.some((v) => v.code === "lease_rogue_holder" && v.detail.includes("d-android")));
});

test("lane records without a ledger decision never fabricate events", () => {
  const records: LedgerRecord[] = [];
  assert.throws(() => usageEstimate({ ...decideRoute({ candidates: [candidate({ id: "z-1" })], qualityFloor: 0.5, nowMs: NOW })!, chosenCostBasis: null } as never, 1, "u-x"));
  assert.equal(records.length, 0);
});