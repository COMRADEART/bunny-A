/**
 * M-A-3 T13.3 Gate G (§20): evaluation-gated routing improvement. Pure rules only.
 *
 * A learning policy changes one thing in live routing: how much the bounded verified-success history (and, optionally,
 * measured latency) moves the `empirical` score component. These rules replay a policy against recorded live routing
 * decisions joined to their outcomes, summarize shadow runs, and decide whether a candidate may enter shadow or be
 * accepted. Only independently verified outcomes count: completion, user praise and explicit feedback never establish
 * that a Task was technically correct.
 */
import type { Mode, ProviderId } from "../orch/types.ts";

export type LearningWeights = { historyWeight: number; latencyWeight: number; perTaskType: boolean };
export const LEARNING_BOUNDS = { historyWeight: [0, 2], latencyWeight: [0, 0.05] } as const;
export const LEARNING_GRID = { historyWeight: [0, 0.5, 1, 1.5, 2], latencyWeight: [0, 0.025, 0.05], perTaskType: [false, true] } as const;
/** Live verified decisions a shadow run must observe before acceptance. */
export const SHADOW_MIN_VERIFIED = 5;
export const LIFECYCLE_STATES = ["evaluated", "shadow", "accepted", "rejected", "superseded"] as const;
export type LifecycleState = (typeof LIFECYCLE_STATES)[number];

const DISPLAY_ORDER: ProviderId[] = ["codex", "claude", "ollama", "opencode", "cline", "cursor"];
const round = (value: number): number => Math.round(value * 10) / 10;

export type Outcome = "passed" | "failed" | "unverified";
/** One candidate as a routing decision recorded it: its final score and the empirical points inside that score. */
export type RecordedCandidate = { provider: ProviderId; model: string | null; eligible: boolean; score: number | null; empirical: number };
export type RecordedDecision = {
  decisionId: string;
  taskType: string;
  mode: Mode;
  selected: { provider: ProviderId; model: string | null } | null;
  /** The verified outcome of the dispatched candidate; null when it was stopped or never finished. */
  outcome: Outcome | null;
  candidates: RecordedCandidate[];
};
/** The empirical value (before the 0..1 clamp and the weight) one policy assigns to a provider for a task. */
export type EmpiricalSignal = (provider: ProviderId, taskType: string, mode: Mode, weights: LearningWeights) => number;

export function validateWeights(input: Partial<LearningWeights>): LearningWeights {
  const historyWeight = Number(input.historyWeight);
  const latencyWeight = input.latencyWeight === undefined ? 0 : Number(input.latencyWeight);
  if (!Number.isFinite(historyWeight) || historyWeight < LEARNING_BOUNDS.historyWeight[0] || historyWeight > LEARNING_BOUNDS.historyWeight[1]
    || !Number.isFinite(latencyWeight) || latencyWeight < LEARNING_BOUNDS.latencyWeight[0] || latencyWeight > LEARNING_BOUNDS.latencyWeight[1])
    throw new Error("Candidate weights exceed allowed bounds.");
  return { historyWeight, latencyWeight, perTaskType: input.perTaskType === true };
}

export const sameWeights = (a: LearningWeights, b: LearningWeights): boolean =>
  a.historyWeight === b.historyWeight && a.latencyWeight === b.latencyWeight && a.perTaskType === b.perTaskType;

/** The candidate a policy would pick from recorded scores: only the empirical points are recomputed. */
export function repick(candidates: RecordedCandidate[], points: (candidate: RecordedCandidate) => number): { provider: ProviderId; model: string | null } | null {
  const scored = candidates
    .filter((candidate) => candidate.eligible && candidate.score != null)
    .map((candidate) => ({ candidate, final: round((candidate.score as number) - candidate.empirical + points(candidate)) }))
    .sort((a, b) => b.final - a.final
      || DISPLAY_ORDER.indexOf(a.candidate.provider) - DISPLAY_ORDER.indexOf(b.candidate.provider)
      || (a.candidate.model ?? "").localeCompare(b.candidate.model ?? ""));
  const best = scored[0]?.candidate;
  return best ? { provider: best.provider, model: best.model } : null;
}

export const empiricalPoints = (value: number, weight: number): number => round(Math.max(-1, Math.min(1, value)) * weight);
const key = (pick: { provider: ProviderId; model: string | null } | null) => (pick ? `${pick.provider}/${pick.model ?? "default"}` : "none");

export type DecisionChange = { decisionId: string; taskType: string; live: string; candidate: string; outcome: Outcome };
export type Evaluation = {
  decisions: number;
  /** Decisions where the active policy, replayed today, still picks what actually ran, so the outcome is attributable. */
  comparable: number;
  verified: number;
  changed: number;
  /** Changed away from a verified failure. */
  improvements: number;
  /** Changed away from a verified success. */
  risks: number;
  /** Changed where the outcome was never verified. */
  unmeasured: number;
  changes: DecisionChange[];
};

export function evaluate(decisions: RecordedDecision[], active: LearningWeights, candidate: LearningWeights, signal: EmpiricalSignal, empiricalWeight: number): Evaluation {
  const result: Evaluation = { decisions: decisions.length, comparable: 0, verified: 0, changed: 0, improvements: 0, risks: 0, unmeasured: 0, changes: [] };
  for (const decision of decisions) {
    if (!decision.selected || !decision.outcome) continue;
    const under = (weights: LearningWeights) => repick(decision.candidates, (c) => empiricalPoints(signal(c.provider, decision.taskType, decision.mode, weights), empiricalWeight));
    const live = under(active);
    if (key(live) !== key(decision.selected)) continue;
    result.comparable += 1;
    if (decision.outcome !== "unverified") result.verified += 1;
    const next = under(candidate);
    if (key(next) === key(live)) continue;
    result.changed += 1;
    if (decision.outcome === "failed") result.improvements += 1;
    else if (decision.outcome === "passed") result.risks += 1;
    else result.unmeasured += 1;
    if (result.changes.length < 20) result.changes.push({ decisionId: decision.decisionId, taskType: decision.taskType, live: key(live), candidate: key(next), outcome: decision.outcome });
  }
  return result;
}

export type ShadowRow = { live: { provider: ProviderId; model: string | null }; shadow: { provider: ProviderId; model: string | null } | null; outcome: Outcome | null };
export type ShadowSummary = { decisions: number; agreed: number; differed: number; verified: number; risks: number; avoided: number };

/** A shadow pick that differs from a live pick later verified successful is a risk; from one verified failed, an avoided failure. */
export function shadowSummary(rows: ShadowRow[]): ShadowSummary {
  const summary: ShadowSummary = { decisions: rows.length, agreed: 0, differed: 0, verified: 0, risks: 0, avoided: 0 };
  for (const row of rows) {
    const same = key(row.shadow) === key(row.live);
    if (same) summary.agreed += 1; else summary.differed += 1;
    if (row.outcome === "passed" || row.outcome === "failed") summary.verified += 1;
    if (!same && row.outcome === "passed") summary.risks += 1;
    if (!same && row.outcome === "failed") summary.avoided += 1;
  }
  return summary;
}

export type GateResult = { ok: true } | { ok: false; reason: string };

/** EVALUATE → SHADOW: no benchmark regression, no replayed risk, and at least one measured improvement. */
export function shadowGate(evaluation: Evaluation, benchmarkRegressions: number): GateResult {
  if (benchmarkRegressions > 0) return { ok: false, reason: `It regresses ${benchmarkRegressions} case(s) of the fixed routing benchmark.` };
  if (evaluation.risks > 0) return { ok: false, reason: `Replayed on recorded decisions, it moves ${evaluation.risks} verified success(es) to a different model.` };
  if (evaluation.improvements < 1)
    return { ok: false, reason: `No measured improvement: ${evaluation.verified} verified decision(s) were replayed and none moved away from a verified failure.` };
  return { ok: true };
}

/** SHADOW → ACCEPT: the evaluation gate still holds and the shadow run saw enough verified live decisions with no risk. */
export function acceptGate(evaluation: Evaluation, benchmarkRegressions: number, shadow: ShadowSummary | null): GateResult {
  const first = shadowGate(evaluation, benchmarkRegressions);
  if (!first.ok) return first;
  if (!shadow) return { ok: false, reason: "It has not been shadow tested." };
  if (shadow.verified < SHADOW_MIN_VERIFIED) return { ok: false, reason: `The shadow run has ${shadow.verified} verified live decision(s); ${SHADOW_MIN_VERIFIED} are required.` };
  if (shadow.risks > 0) return { ok: false, reason: `During the shadow run it disagreed with ${shadow.risks} live choice(s) that were later verified successful.` };
  return { ok: true };
}

/** PROPOSE: the bounded grid point with the most measured improvements that passes the shadow gate; nearest to the active policy on ties. */
export function propose(
  decisions: RecordedDecision[],
  active: LearningWeights,
  signal: EmpiricalSignal,
  empiricalWeight: number,
  benchmarkRegressions: (weights: LearningWeights) => number,
): { weights: LearningWeights; evaluation: Evaluation } | { weights: null; reason: string; verified: number } {
  let best: { weights: LearningWeights; evaluation: Evaluation; distance: number } | null = null;
  let verified = 0;
  for (const historyWeight of LEARNING_GRID.historyWeight)
    for (const latencyWeight of LEARNING_GRID.latencyWeight)
      for (const perTaskType of LEARNING_GRID.perTaskType) {
        const weights = { historyWeight, latencyWeight, perTaskType };
        if (sameWeights(weights, active)) continue;
        const evaluation = evaluate(decisions, active, weights, signal, empiricalWeight);
        verified = evaluation.verified;
        if (!shadowGate(evaluation, benchmarkRegressions(weights)).ok) continue;
        const distance = Math.abs(historyWeight - active.historyWeight) + Math.abs(latencyWeight - active.latencyWeight) * 20 + (perTaskType === active.perTaskType ? 0 : 0.5);
        if (!best || evaluation.improvements > best.evaluation.improvements || (evaluation.improvements === best.evaluation.improvements && distance < best.distance))
          best = { weights, evaluation, distance };
      }
  if (best) return { weights: best.weights, evaluation: best.evaluation };
  return { weights: null, verified, reason: `No bounded policy improves on the current one: ${verified} verified decision(s) were replayed and none changed a verified failure without risking a verified success.` };
}

/** The workstation's view of routing improvement (never projected to a paired device). */
export type RoutingLearningView = {
  active: { id: string; weights: LearningWeights; since: number | null; previousId: string | null };
  candidates: {
    id: string;
    weights: LearningWeights;
    state: LifecycleState;
    proposedBy: "owner" | "evidence";
    createdAt: number;
    evaluation: Evaluation | null;
    benchmarkRegressions: number | null;
    shadow: ShadowSummary | null;
    gate: GateResult | null;
    reason: string | null;
  }[];
  observations: {
    provider: ProviderId;
    taskType: string;
    samples: number;
    verified: number;
    verifiedFailed: number;
    stopped: number;
    repairs: number;
    /** Tasks that ended failed; outcomes do not separate tool errors from other failures. */
    failed: number;
    medianMs: number | null;
    inputTokens: number;
    outputTokens: number;
    /** Local inference costs nothing; a cloud cost is never assumed. */
    costUsd: number | null;
    feedback: { positive: number; negative: number };
  }[];
  minimumSamples: number;
  shadowMinVerified: number;
  /** Owner opt-in: Bunny runs propose → shadow → accept on its own, through the same gates. */
  autopilot: boolean;
};
