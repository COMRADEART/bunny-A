import assert from "node:assert/strict";
import test from "node:test";
import { decideRoute, recordOutcome, summarizeCalibration, type LedgerRecord, type RouteCandidate } from "./route-ledger.ts";

const NOW = 1_793_491_200_000;

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

test("decisions are deterministic, including the fingerprinted decisionId", () => {
  const input = {
    candidates: [
      candidate({ id: "a-ollama", latencyP50Ms: 1_000 }),
      candidate({ id: "z-codex", provider: "codex", estimatedCostUsd: 0.02 }),
    ],
    qualityFloor: 0.5,
    nowMs: NOW,
  };
  const first = decideRoute(input);
  const second = decideRoute(input);
  assert.deepEqual(first, second);
  assert.equal(first?.decidedAtMs, NOW);
});

test("quality floor elimination carries the exact note", () => {
  const decision = decideRoute({
    candidates: [candidate({ id: "weak-1", qualityScore: 0.3 }), candidate({ id: "ok-1" })],
    qualityFloor: 0.5,
    nowMs: NOW,
  });
  const weak = decision?.alternatives.find((a) => a.candidateId === "weak-1");
  assert.equal(weak?.status, "rejected");
  assert.equal(weak?.note, "quality below floor");
});

test("quota-exhausted candidates are eliminated", () => {
  const decision = decideRoute({
    candidates: [candidate({ id: "full-1", quotaUsedPercent: 100 }), candidate({ id: "spare-1" })],
    qualityFloor: 0.5,
    nowMs: NOW,
  });
  assert.equal(decision?.chosenCandidateId, "spare-1");
  const full = decision?.alternatives.find((a) => a.candidateId === "full-1");
  assert.equal(full?.note, "quota exhausted");
});

test("unknown cost is not zero: it ranks last and is labeled", () => {
  const decision = decideRoute({
    candidates: [
      candidate({ id: "unknown-1", provider: "codex", costBasis: "unknown", estimatedCostUsd: null, latencyP50Ms: 1 }),
      candidate({ id: "known-1", estimatedCostUsd: 5, costBasis: "known", latencyP50Ms: 9_000 }),
    ],
    qualityFloor: 0.5,
    nowMs: NOW,
  });
  assert.equal(decision?.chosenCandidateId, "known-1");
  const loser = decision?.alternatives.find((a) => a.candidateId === "unknown-1");
  assert.equal(loser?.status, "rejected");
  assert.ok(loser?.note.includes("unknown"));
});

test("estimated cost pays the 1.25 premium against a known cost", () => {
  const decision = decideRoute({
    candidates: [
      candidate({ id: "est-1", estimatedCostUsd: 0.008, costBasis: "estimated" }),
      candidate({ id: "known-2", estimatedCostUsd: 0.009, costBasis: "known" }),
    ],
    qualityFloor: 0.5,
    nowMs: NOW,
  });
  // 0.008 * 1.25 = 0.010 eff vs 0.009 known -> known wins.
  assert.equal(decision?.chosenCandidateId, "known-2");
  assert.ok(decision?.alternatives.find((a) => a.candidateId === "est-1")?.note.includes("higher effective cost"));
});

test("happy path: cheapest chosen, alternatives sorted, losing survivors rejected", () => {
  const decision = decideRoute({
    candidates: [
      candidate({ id: "z-codex", provider: "codex", estimatedCostUsd: 0.02 }),
      candidate({ id: "a-ollama", estimatedCostUsd: 0.004 }),
    ],
    qualityFloor: 0.5,
    nowMs: NOW,
  });
  assert.equal(decision?.chosenCandidateId, "a-ollama");
  assert.equal(decision?.chosenProvider, "ollama");
  assert.deepEqual(
    decision?.alternatives.map((a) => [a.candidateId, a.status]),
    [
      ["a-ollama", "chosen"],
      ["z-codex", "rejected"],
    ],
  );
  const rejected = decision?.alternatives.find((a) => a.candidateId === "z-codex");
  assert.ok(rejected?.note.includes("higher effective cost"));
  assert.ok(decision?.reason.startsWith("lowest effective cost"));
});

test("ineligible candidates carry the exclusion reason", () => {
  const decision = decideRoute({
    candidates: [candidate({ id: "block-1", eligible: false, excludeReason: "device offline" }), candidate({ id: "ok-2" })],
    qualityFloor: 0.5,
    nowMs: NOW,
  });
  assert.ok(decision?.alternatives.find((a) => a.candidateId === "block-1")?.note.includes("ineligible: device offline"));
});

test("NaN quality and unknown quality fail the floor, never pass it", () => {
  const decision = decideRoute({
    candidates: [
      candidate({ id: "nan-1", qualityScore: Number.NaN }),
      candidate({ id: "ok-3" }),
    ],
    qualityFloor: 0.5,
    nowMs: NOW,
  });
  assert.equal(decision?.chosenCandidateId, "ok-3");
  const nan = decision?.alternatives.find((a) => a.candidateId === "nan-1");
  assert.equal(nan?.status, "rejected");
  assert.equal(nan?.note, "quality below floor");
});

test("NaN latency cannot corrupt the tie-break (survivor ordering stays lawful)", () => {
  const decision = decideRoute({
    candidates: [
      candidate({ id: "lag-a", costBasis: "unknown", estimatedCostUsd: null, latencyP50Ms: Number.NaN }),
      candidate({ id: "lag-b", costBasis: "unknown", estimatedCostUsd: null, latencyP50Ms: 1_000 }),
    ],
    qualityFloor: 0.5,
    nowMs: NOW,
  });
  // Both unknown-cost; finite latency wins the tie-break deterministically.
  assert.equal(decision?.chosenCandidateId, "lag-b");
});

test("duplicate candidate ids are rejected outright", () => {
  assert.throws(
    () =>
      decideRoute({
        candidates: [candidate({ id: "twice" }), candidate({ id: "twice" })],
        qualityFloor: 0.5,
        nowMs: NOW,
      }),
    /duplicate candidate id/,
  );
});

test("decideRoute returns null when nobody survives", () => {
  const decision = decideRoute({
    candidates: [candidate({ id: "dead-1", qualityScore: 0.1 })],
    qualityFloor: 0.5,
    nowMs: NOW,
  });
  assert.equal(decision, null);
});

test("recordOutcome appends immutably to the matching record", () => {
  const decision = decideRoute({ candidates: [candidate({ id: "a-ollama" })], qualityFloor: 0.5, nowMs: NOW })!;
  const records: LedgerRecord[] = [{ decision, outcome: null }];
  const frozen = structuredClone(records);
  const updated = recordOutcome(records, decision.decisionId, { decisionId: decision.decisionId, outcome: "provider_failed", attemptedAtMs: NOW + 1, attemptId: "att-1" });
  assert.deepEqual(records, frozen);
  assert.equal(records[0]?.outcome, null);
  assert.equal(updated[0]?.outcome?.outcome, "provider_failed");
});

test("summarizeCalibration counts providers, outcomes, and unknown-cost share", () => {
  const d1 = decideRoute({ candidates: [candidate({ id: "u-1", costBasis: "unknown", estimatedCostUsd: null })], qualityFloor: 0.5, nowMs: NOW })!;
  const d2 = decideRoute({ candidates: [candidate({ id: "k-1", estimatedCostUsd: 0.01 })], qualityFloor: 0.5, nowMs: NOW })!;
  let records: LedgerRecord[] = [
    { decision: d1, outcome: null },
    { decision: d2, outcome: null },
  ];
  records = recordOutcome(records, d2.decisionId, { decisionId: d2.decisionId, outcome: "success", attemptedAtMs: NOW, attemptId: "att-2" });
  const summary = summarizeCalibration(records);
  assert.equal(summary.total, 2);
  assert.equal(summary.chosenByProvider["ollama"], 2);
  assert.equal(summary.outcomes["success"], 1);
  assert.equal(summary.unknownCostShare, 0.5);
  assert.deepEqual(summarizeCalibration([]), { total: 0, chosenByProvider: {}, outcomes: {}, unknownCostShare: 0 });
});