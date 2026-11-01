/**
 * RouteDecisionLedger — the recording layer BESIDE the router (master prompt §3 W1.5).
 *
 * Every route decision is captured with (1) the winner and why it won, (2) every
 * candidate that lost and the exact reason it lost, (3) the attempt outcome, so
 * routing can later be calibrated against reality. Unknown cost is never zero:
 * it is ranked last and labeled `unknown`.
 *
 * Pure module: no I/O, no clock access (callers pass `nowMs`), no imports.
 * It reads nothing and changes nothing in the existing router/policy modules.
 */

export type RouteCandidate = {
  id: string;
  provider: string;
  availability: "ready" | "busy" | "offline" | "not_installed" | "authentication_required" | "rate_limited" | "unavailable" | "unknown";
  /** 0..1 measurable quality from the capability/qualification layers. */
  qualityScore: number;
  estimatedCostUsd: number | null;
  costBasis: "known" | "estimated" | "unknown";
  latencyP50Ms: number | null;
  quotaUsedPercent: number | null;
  deviceRef: string | null;
  eligible: boolean;
  excludeReason?: string;
};

export type RouteAlternativesEntry = { candidateId: string; status: "chosen" | "rejected"; note: string };

export type RouteDecision = {
  decisionId: string;
  chosenCandidateId: string | null;
  /** Provider of the chosen candidate; null when nothing was chosen. */
  chosenProvider: string | null;
  chosenCostBasis: "known" | "estimated" | "unknown" | null;
  reason: string;
  /** Every candidate, sorted by candidateId ascending; exactly one "chosen". */
  alternatives: RouteAlternativesEntry[];
  decidedAtMs: number | null;
};

export type RouteOutcome = {
  decisionId: string;
  outcome: "success" | "verify_failed" | "quota_exhausted" | "provider_failed" | "cancelled";
  attemptedAtMs: number;
  attemptId: string;
};

export type LedgerRecord = { decision: RouteDecision; outcome: RouteOutcome | null };

function fnv1aHex(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** Unknown cost is not zero: it ranks last; estimated cost pays a 1.25 premium. */
export function effectiveCostRank(candidate: RouteCandidate): number {
  if (candidate.costBasis === "unknown") return Number.POSITIVE_INFINITY;
  if (candidate.estimatedCostUsd === null || !Number.isFinite(candidate.estimatedCostUsd)) return Number.POSITIVE_INFINITY;
  return candidate.costBasis === "estimated" ? candidate.estimatedCostUsd * 1.25 : candidate.estimatedCostUsd;
}

const UNPREPARED = new Set<string>();

export function decideRoute(input: { candidates: RouteCandidate[]; qualityFloor: number; nowMs: number | null }): RouteDecision | null {
  const { candidates, qualityFloor, nowMs } = input;
  const entries: RouteAlternativesEntry[] = [];
  const survivors: RouteCandidate[] = [];

  const ordered = [...candidates].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (new Set(candidates.map((c) => c.id)).size !== candidates.length) {
    throw new Error("duplicate candidate id — an id is the candidate's identity");
  }
  for (const candidate of ordered) {
    // NaN quality must fail the floor: unknown quality is not quality.
    if (!(candidate.qualityScore >= qualityFloor)) {
      entries.push({ candidateId: candidate.id, status: "rejected", note: "quality below floor" });
      continue;
    }
    if (!candidate.eligible) {
      entries.push({ candidateId: candidate.id, status: "rejected", note: `ineligible: ${candidate.excludeReason ?? "no reason given"}` });
      continue;
    }
    if (candidate.quotaUsedPercent !== null && candidate.quotaUsedPercent >= 100) {
      entries.push({ candidateId: candidate.id, status: "rejected", note: "quota exhausted" });
      continue;
    }
    survivors.push(candidate);
    entries.push({ candidateId: candidate.id, status: "chosen", note: "" });
  }

  if (survivors.length === 0) return null;

  survivors.sort((a, b) => {
    const rankA = effectiveCostRank(a);
    const rankB = effectiveCostRank(b);
    // Compare with < / >: rank subtraction yields NaN for Infinity - Infinity
    // (two unknown-cost candidates), which would make the ordering unlawful.
    if (rankA < rankB) return -1;
    if (rankA > rankB) return 1;
    const latA = a.latencyP50Ms !== null && Number.isFinite(a.latencyP50Ms) ? a.latencyP50Ms : Number.POSITIVE_INFINITY;
    const latB = b.latencyP50Ms !== null && Number.isFinite(b.latencyP50Ms) ? b.latencyP50Ms : Number.POSITIVE_INFINITY;
    if (latA < latB) return -1;
    if (latA > latB) return 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  const winner = survivors[0]!;
  const survivorIds = new Set(survivors.map((s) => s.id));
  const winnerRank = effectiveCostRank(winner);
  for (const entry of entries) {
    if (!survivorIds.has(entry.candidateId)) continue;
    if (entry.candidateId === winner.id) {
      entry.status = "chosen";
      entry.note = "selected";
    } else {
      const loser = survivors.find((s) => s.id === entry.candidateId)!;
      entry.status = "rejected";
      entry.note = loser.costBasis === "unknown" || !Number.isFinite(effectiveCostRank(loser)) ? "unknown cost ranks last" : `higher effective cost than ${winner.id}`;
    }
  }
  const alternatives = entries.sort((a, b) => (a.candidateId < b.candidateId ? -1 : a.candidateId > b.candidateId ? 1 : 0));

  let reason: string;
  if (survivors.length === 1) {
    reason = "sole eligible candidate";
  } else {
    const runnerUp = survivors[1]!;
    const fmt = (rank: number) => (Number.isFinite(rank) ? `$${rank.toFixed(4)}` : "unknown");
    const premium = winner.costBasis === "estimated" ? " (estimated premium applied)" : "";
    reason = `lowest effective cost ${fmt(winnerRank)} vs ${fmt(effectiveCostRank(runnerUp))}${premium}; alternatives ${alternatives.length}`;
  }

  // decisionId is a content address: candidates + floor only. nowMs is excluded on
  // purpose so the same decision made at two moments shares its id (replay-friendly).
  const fingerprint = fnv1aHex(JSON.stringify({ candidates, qualityFloor }));
  return {
    decisionId: `rd-${winner.id}-${fingerprint}`,
    chosenCandidateId: winner.id,
    chosenProvider: winner.provider,
    chosenCostBasis: winner.costBasis,
    reason,
    alternatives,
    decidedAtMs: nowMs,
  };
}

export function recordOutcome(records: LedgerRecord[], decisionId: string, outcome: RouteOutcome): LedgerRecord[] {
  return records.map((record) => (record.decision.decisionId === decisionId ? { ...record, outcome } : record));
}

export function summarizeCalibration(records: LedgerRecord[]): {
  total: number;
  chosenByProvider: Record<string, number>;
  outcomes: Record<string, number>;
  unknownCostShare: number;
} {
  const chosenByProvider: Record<string, number> = {};
  const outcomes: Record<string, number> = {};
  let unknownCost = 0;
  for (const record of records) {
    if (record.decision.chosenProvider) {
      chosenByProvider[record.decision.chosenProvider] = (chosenByProvider[record.decision.chosenProvider] ?? 0) + 1;
    }
    if (record.decision.chosenCostBasis === "unknown") unknownCost += 1;
    if (record.outcome) {
      outcomes[record.outcome.outcome] = (outcomes[record.outcome.outcome] ?? 0) + 1;
    }
  }
  return {
    total: records.length,
    chosenByProvider,
    outcomes,
    unknownCostShare: records.length === 0 ? 0 : unknownCost / records.length,
  };
}