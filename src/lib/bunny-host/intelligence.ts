/**
 * M-A-3 T13.1: shared intelligence contracts (pure; no I/O, no authority).
 *
 * Laya is a flexible local model resource and TypeSafe Jev is an optional
 * hosted structured-decision service. Both advise the ONE BunnyRouter; neither
 * grants permission, selects outside the eligible set, or replaces it. The
 * deterministic fallback is labelled Local Decision Policy — never "Jev".
 */
import type { ProviderId } from "../orch/types.ts";
import type { RoutingTaskClass } from "../orch/router-requirements.ts";

export const TYPESAFE_API_BASE = "https://api.typesafe.ai";
export const TYPESAFE_API_HOST = "api.typesafe.ai";
export const TYPESAFE_MODELS_PATH = "/v1/models";
export const TYPESAFE_SYSTEM_ONE_PATH = "/v1/systemone";
export const TYPESAFE_DEFAULT_MODEL = "jev-latest";
/**
 * Price published at https://docs.typesafe.ai/models (read 2026-10-12) for jev-1.13.0 only:
 * $0.042 per million input tokens; output tokens free. Any other answering model has an
 * unknown price, so strict monetary ceilings fail closed for it.
 */
export const JEV_PRICED_MODEL = /^jev-1\.13(?:\.\d+)?$/;
export const JEV_INPUT_USD_PER_MTOK = 0.042;

export type JevConnectionState =
  | "DISABLED" | "NO_CREDENTIAL" | "SAVED_NOT_VERIFIED" | "CONNECTING" | "CONNECTED"
  | "AUTH_FAILED" | "RATE_LIMITED" | "BUDGET_EXHAUSTED" | "NETWORK_UNAVAILABLE" | "PROVIDER_ERROR";

export type DecisionQuestion =
  | { type: "choice"; instructions: string; criteria: Record<string, string | null> }
  | { type: "score"; instructions: string; criteria: string[] }
  | { type: "noul"; instructions: string; criteria?: { true?: string; false?: string } };

export type DecisionAnswer =
  | { type: "choice"; choice: string; probabilities: Record<string, number>; confidence: number }
  | { type: "score"; score: number; legend: Record<string, string>; probabilities: Record<string, number>; confidence: number }
  | { type: "noul"; noul: number };

export type SystemOneRequest = { state: string | Record<string, unknown> | unknown[]; model: string; questions: Record<string, DecisionQuestion> };
export type SystemOneResponse = { model: string; answers: Record<string, DecisionAnswer>; usage: { inputTokens: number | null; outputTokens: number | null } };

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const probOk = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;

/** Validates a System One request at the boundary. Throws with a safe, secret-free message. */
export function validateSystemOneRequest(request: SystemOneRequest): SystemOneRequest {
  if (!isRecord(request)) throw new Error("Jev request must be an object.");
  if (typeof request.model !== "string" || !request.model.trim() || request.model.length > 120) throw new Error("Jev model is required.");
  const stateText = typeof request.state === "string" ? request.state : JSON.stringify(request.state ?? null);
  if (!stateText || stateText.length > 120_000) throw new Error("Jev state is empty or too large.");
  if (!isRecord(request.questions)) throw new Error("Jev questions are required.");
  const entries = Object.entries(request.questions);
  if (!entries.length || entries.length > 16) throw new Error("Jev requires 1-16 questions.");
  for (const [id, question] of entries) {
    if (!id || id.length > 80) throw new Error("Invalid Jev question id.");
    if (!isRecord(question) || typeof question.instructions !== "string" || !question.instructions.trim() || question.instructions.length > 4000) throw new Error(`Jev question ${id} needs instructions.`);
    if (question.type === "choice") {
      if (!isRecord(question.criteria)) throw new Error(`Jev choice ${id} needs criteria.`);
      const options = Object.keys(question.criteria);
      if (options.length < 2 || options.length > 255) throw new Error(`Jev choice ${id} needs 2-255 options.`);
    } else if (question.type === "score") {
      if (!Array.isArray(question.criteria) || question.criteria.length < 2 || question.criteria.length > 10) throw new Error(`Jev score ${id} needs 2-10 levels.`);
    } else if (question.type !== "noul") throw new Error(`Jev question ${id} has an unknown type.`);
  }
  return request;
}

/** Validates an untrusted provider response against the questions that were asked. */
export function validateSystemOneResponse(raw: unknown, questions: Record<string, DecisionQuestion>): SystemOneResponse {
  if (!isRecord(raw) || typeof raw.model !== "string" || !isRecord(raw.answers)) throw new Error("Jev returned a malformed response.");
  const answers: Record<string, DecisionAnswer> = {};
  for (const [id, question] of Object.entries(questions)) {
    const answer = raw.answers[id];
    if (!isRecord(answer) || answer.type !== question.type) throw new Error(`Jev answer ${id} is missing or has the wrong type.`);
    if (question.type === "noul") {
      if (!probOk(answer.noul)) throw new Error(`Jev answer ${id} has an invalid noul probability.`);
      answers[id] = { type: "noul", noul: answer.noul as number };
    } else if (question.type === "choice") {
      const probabilities = answer.probabilities;
      if (!isRecord(probabilities) || typeof answer.choice !== "string" || !Object.hasOwn(question.criteria, answer.choice) || !probOk(answer.confidence)) throw new Error(`Jev answer ${id} is malformed.`);
      let sum = 0;
      for (const [key, value] of Object.entries(probabilities)) { if (!Object.hasOwn(question.criteria, key) || !probOk(value)) throw new Error(`Jev answer ${id} has an unknown option or bad probability.`); sum += value as number; }
      if (Math.abs(sum - 1) > 0.05) throw new Error(`Jev answer ${id} probabilities do not sum to 1.`);
      answers[id] = { type: "choice", choice: answer.choice, probabilities: probabilities as Record<string, number>, confidence: answer.confidence as number };
    } else {
      const probabilities = answer.probabilities;
      if (!isRecord(probabilities) || typeof answer.score !== "number" || !Number.isFinite(answer.score) || !isRecord(answer.legend) || !probOk(answer.confidence)) throw new Error(`Jev answer ${id} is malformed.`);
      let sum = 0;
      for (const value of Object.values(probabilities)) { if (!probOk(value)) throw new Error(`Jev answer ${id} has a bad probability.`); sum += value as number; }
      if (Math.abs(sum - 1) > 0.05) throw new Error(`Jev answer ${id} probabilities do not sum to 1.`);
      answers[id] = { type: "score", score: answer.score, legend: answer.legend as Record<string, string>, probabilities: probabilities as Record<string, number>, confidence: answer.confidence as number };
    }
  }
  const usage = isRecord(raw.usage) ? raw.usage : {};
  const count = (value: unknown) => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : null);
  return { model: raw.model.slice(0, 120), answers, usage: { inputTokens: count(usage.input_tokens), outputTokens: count(usage.output_tokens) } };
}

/** `GET /v1/models` lists model cards ({name, description, release_date}); only names cross the boundary. */
export function parseModelList(raw: unknown): string[] | null {
  const rows = Array.isArray(raw) ? raw : isRecord(raw) && Array.isArray(raw.models) ? raw.models : isRecord(raw) && Array.isArray(raw.data) ? raw.data : null;
  if (!rows) return null;
  const names = rows
    .map((row) => (typeof row === "string" ? row : isRecord(row) ? (typeof row.name === "string" ? row.name : row.id) : null))
    .filter((name): name is string => typeof name === "string" && /^[\w.:-]{1,120}$/.test(name));
  return [...new Set(names)].slice(0, 64);
}

/** Stable identity of one eligible routing candidate. Jev may only name one of these keys. */
export const candidateKey = (provider: ProviderId, model: string | null) => `${provider}::${model ?? "default"}`;

export type DecisionThresholds = { acceptConfidence: number; fallbackBelow: number; clarifyNoul: number };
/**
 * Starting thresholds, not vendor calibration: Jev's confidence has not been measured on
 * Bunny's workload, so a recommendation must clear a high bar before it changes a route.
 */
export const DEFAULT_THRESHOLDS: DecisionThresholds = { acceptConfidence: 0.75, fallbackBelow: 0.5, clarifyNoul: 0.8 };
/** Advice older than this, or from an earlier policy generation, is stale and never applied. */
export const ADVICE_MAX_AGE_MS = 30_000;

export type DecisionAdvice = {
  source: "jev";
  recommendedKey: string | null;
  confidence: number | null;
  needsClarification: boolean;
  /** Raw yes-probability for clarification, kept for provenance. */
  clarifyProbability: number | null;
  taskClass: string | null;
  /** Jev policy generation and issue time; stale advice is discarded. */
  generation: number;
  issuedAt: number;
  answeredBy: string | null;
};

export type AdviceAction = "router" | "accept" | "fallback" | "clarify" | "rejected";
export type AdviceOutcome = { action: AdviceAction; finalKey: string; reason: string };
export type CandidateTraits = { key: string; local: boolean; tools: boolean };

/**
 * The router stays authoritative. Advice is accepted only when it names an
 * already-eligible candidate with enough confidence AND the switch widens
 * nothing: never local -> cloud, never tool-free -> tool-capable. Anything
 * else keeps the router's own choice; a clarification signal grants nothing.
 */
export function applyDecisionAdvice(input: {
  routerKey: string;
  eligible: readonly CandidateTraits[];
  advice: DecisionAdvice | null;
  thresholds?: DecisionThresholds;
  currentGeneration?: number;
  now?: number;
}): AdviceOutcome {
  const thresholds = input.thresholds ?? DEFAULT_THRESHOLDS;
  const advice = input.advice;
  if (!advice) return { action: "router", finalKey: input.routerKey, reason: "Local Decision Policy: BunnyRouter's deterministic selection stands." };
  const now = input.now ?? Date.now();
  if ((input.currentGeneration !== undefined && advice.generation !== input.currentGeneration) || now - advice.issuedAt > ADVICE_MAX_AGE_MS || now < advice.issuedAt)
    return { action: "rejected", finalKey: input.routerKey, reason: "Decision assistance was stale (policy changed or too old) and was discarded; BunnyRouter choice stands." };
  if (advice.needsClarification) return { action: "clarify", finalKey: input.routerKey, reason: "Decision assistance suggests the request may need clarification; BunnyRouter choice stands and the Task still waits for your approval." };
  const recommended = advice.recommendedKey;
  const target = recommended ? input.eligible.find((row) => row.key === recommended) : undefined;
  if (!recommended || !target) return { action: "rejected", finalKey: input.routerKey, reason: "Recommendation was outside the eligible set and was rejected." };
  const confidence = advice.confidence;
  if (confidence === null || confidence < thresholds.fallbackBelow) return { action: "fallback", finalKey: input.routerKey, reason: "Recommendation confidence is too low; BunnyRouter choice stands." };
  if (confidence < thresholds.acceptConfidence) return { action: "fallback", finalKey: input.routerKey, reason: "Recommendation confidence is below the accept threshold; BunnyRouter choice stands." };
  if (recommended === input.routerKey) return { action: "accept", finalKey: input.routerKey, reason: `Decision assistance agreed with BunnyRouter (confidence ${confidence.toFixed(2)}).` };
  const current = input.eligible.find((row) => row.key === input.routerKey);
  if (current && current.local && !target.local) return { action: "rejected", finalKey: input.routerKey, reason: "Recommendation would move local work to a hosted model; BunnyRouter choice stands." };
  if (current && !current.tools && target.tools) return { action: "rejected", finalKey: input.routerKey, reason: "Recommendation would move tool-free work to a tool-capable provider; BunnyRouter choice stands." };
  return { action: "accept", finalKey: recommended, reason: `Decision assistance recommended an eligible candidate with confidence ${confidence.toFixed(2)}; BunnyRouter validated and adopted it. Approval is still required.` };
}

/** Bounded, auditable question library (§14). Never asks for code, tool calls or free text. */
export const QUESTION_LIBRARY = {
  model_choice: "Select the best eligible model among explicit alternatives.",
  complexity: "Classify simple, moderate or complex task requirements.",
  needs_clarification: "Whether a request lacks necessary nonprivileged information.",
  task_category: "Identify research, code, planning, analysis, testing or conversation.",
  result_assessment: "Advisory score of an already obtained result (never proof of work).",
} as const;

export function routingQuestions(eligibleKeys: readonly string[]): Record<string, DecisionQuestion> {
  const criteria: Record<string, string | null> = {};
  for (const key of eligibleKeys) criteria[key] = `Eligible candidate ${key} supplied by BunnyRouter.`;
  return {
    model_choice: { type: "choice", instructions: "Select the best eligible model candidate for the task described in the state. Choose only from the listed candidates.", criteria },
    complexity: { type: "score", instructions: "Classify the task complexity.", criteria: ["Simple: one direct step", "Moderate: several steps or tools", "Complex: multi-step reasoning, repository work or verification"] },
    needs_clarification: { type: "noul", instructions: "Does the request lack necessary nonprivileged information that must be asked before work can proceed?", criteria: { true: "Essential information is missing.", false: "Enough information is present." } },
    task_category: { type: "choice", instructions: "Identify the likely task category.", criteria: { research: "Research or investigation", code: "Coding or repository work", planning: "Planning or strategy", analysis: "Analysis or reasoning", testing: "Testing or verification", conversation: "Ordinary conversation" } },
  };
}

/** Advisory score of an already obtained result. A score is a signal, never proof that work happened. */
export function resultAssessmentQuestion(): Record<string, DecisionQuestion> {
  return { result_assessment: { type: "score", instructions: "How well does the result in the state address the stated objective? This is advisory only.", criteria: ["Does not address it", "Partially addresses it", "Fully addresses it"] } };
}

export function adviceFromAnswers(answers: Record<string, DecisionAnswer>, thresholds: DecisionThresholds, meta: { generation: number; issuedAt: number; answeredBy: string | null }): DecisionAdvice {
  const choice = answers.model_choice?.type === "choice" ? answers.model_choice : null;
  const clarify = answers.needs_clarification?.type === "noul" ? answers.needs_clarification : null;
  const category = answers.task_category?.type === "choice" ? answers.task_category : null;
  return {
    source: "jev",
    recommendedKey: choice?.choice ?? null,
    confidence: choice?.confidence ?? null,
    needsClarification: (clarify?.noul ?? 0) >= thresholds.clarifyNoul,
    clarifyProbability: clarify?.noul ?? null,
    taskClass: category?.choice ?? null,
    ...meta,
  };
}

// ---------------------------------------------------------------- Laya ----

/** A model is Laya only when the runtime's own id says so; nothing is assumed. */
export const isLayaModel = (model: string) => /(^|[/:_.-])laya([/:_.-]|$)/i.test(model);

export type LayaBenchmark = { model: string; taskClass: string; passed: boolean; detail: string; latencyMs: number | null; at: number };

/** Capabilities a probed record actually demonstrates. Absent facts stay unknown (null). */
export function layaCapabilityMatrix(record: { toolCalling?: boolean | null; vision?: boolean | null; embedding?: boolean | null; contextWindow?: number | null } | null): { capability: string; demonstrated: boolean | null }[] {
  if (!record) return [{ capability: "inference", demonstrated: null }];
  return [
    { capability: "tool_calling", demonstrated: record.toolCalling ?? null },
    { capability: "vision", demonstrated: record.vision ?? null },
    { capability: "embedding", demonstrated: record.embedding ?? null },
    { capability: "large_context", demonstrated: typeof record.contextWindow === "number" ? record.contextWindow >= 32_000 : null },
  ];
}

/** Routing task classes a passed benchmark class qualifies. Unlisted classes need their own benchmark. */
export const LAYA_BENCHMARK_COVERS: Record<string, readonly RoutingTaskClass[]> = {
  general: ["general"],
  math: ["math"],
  extraction: ["extraction"],
  reasoning: ["reasoning"],
};

/** R03: an unbenchmarked Laya capability never routes. Returns the exclusion reason or null. */
export function layaExclusion(model: string, taskClass: string, benchmarks: readonly LayaBenchmark[]): string | null {
  if (!isLayaModel(model)) return null;
  const passed = benchmarks.some((row) => row.model === model && row.passed && (LAYA_BENCHMARK_COVERS[row.taskClass] ?? []).includes(taskClass as RoutingTaskClass));
  return passed ? null : `Laya model ${model} has no passed benchmark for ${taskClass}; independent evaluation is required before routing.`;
}

// ------------------------------------------------------------- Jev policy ----

export type JevPrivacyPolicy = { allowDecisionMetadata: boolean; allowTaskDescription: boolean };
export type JevLimits = { maxRequestsPerSession: number; maxRequestsPerDay: number; maxTokensPerDay: number | null; maxConcurrent: number; timeoutMs: number; monetaryCapUsdPerDay: number | null; strictBudget: boolean };
export type JevPolicy = { enabled: boolean; model: string; privacy: JevPrivacyPolicy; limits: JevLimits; thresholds: DecisionThresholds };

export const DEFAULT_JEV_POLICY: JevPolicy = {
  enabled: false,
  model: TYPESAFE_DEFAULT_MODEL,
  privacy: { allowDecisionMetadata: false, allowTaskDescription: false },
  limits: { maxRequestsPerSession: 0, maxRequestsPerDay: 0, maxTokensPerDay: null, maxConcurrent: 1, timeoutMs: 8_000, monetaryCapUsdPerDay: null, strictBudget: true },
  thresholds: { ...DEFAULT_THRESHOLDS },
};

const clampInt = (value: unknown, lo: number, hi: number, fallback: number) => (typeof value === "number" && Number.isFinite(value) ? Math.max(lo, Math.min(hi, Math.floor(value))) : fallback);
const unit = (value: unknown, fallback: number) => (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1 ? value : fallback);

/** Normalizes untrusted policy input. Unknown fields are dropped; every bound is clamped. */
export function parseJevPolicy(raw: unknown): JevPolicy {
  if (!isRecord(raw)) return structuredClone(DEFAULT_JEV_POLICY);
  const privacy = isRecord(raw.privacy) ? raw.privacy : {};
  const limits = isRecord(raw.limits) ? raw.limits : {};
  const thresholds = isRecord(raw.thresholds) ? raw.thresholds : {};
  const model = typeof raw.model === "string" && /^[\w.:-]{1,120}$/.test(raw.model) ? raw.model : DEFAULT_JEV_POLICY.model;
  const acceptConfidence = unit(thresholds.acceptConfidence, DEFAULT_THRESHOLDS.acceptConfidence);
  return {
    enabled: raw.enabled === true,
    model,
    privacy: { allowDecisionMetadata: privacy.allowDecisionMetadata === true, allowTaskDescription: privacy.allowTaskDescription === true },
    limits: {
      maxRequestsPerSession: clampInt(limits.maxRequestsPerSession, 0, 10_000, 0),
      maxRequestsPerDay: clampInt(limits.maxRequestsPerDay, 0, 100_000, 0),
      maxTokensPerDay: limits.maxTokensPerDay === null || limits.maxTokensPerDay === undefined ? null : clampInt(limits.maxTokensPerDay, 0, 100_000_000, 0),
      maxConcurrent: clampInt(limits.maxConcurrent, 1, 4, 1),
      timeoutMs: clampInt(limits.timeoutMs, 1_000, 30_000, DEFAULT_JEV_POLICY.limits.timeoutMs),
      monetaryCapUsdPerDay: typeof limits.monetaryCapUsdPerDay === "number" && Number.isFinite(limits.monetaryCapUsdPerDay) && limits.monetaryCapUsdPerDay >= 0 ? Math.min(limits.monetaryCapUsdPerDay, 10_000) : null,
      strictBudget: limits.strictBudget !== false,
    },
    thresholds: {
      acceptConfidence,
      fallbackBelow: Math.min(unit(thresholds.fallbackBelow, DEFAULT_THRESHOLDS.fallbackBelow), acceptConfidence),
      clarifyNoul: unit(thresholds.clarifyNoul, DEFAULT_THRESHOLDS.clarifyNoul),
    },
  };
}

const SECRET_PATTERNS: readonly RegExp[] = [
  /-----BEGIN [A-Z0-9 ]{2,40}-----/i,
  /\bsk-[\w-]{8,}/,
  /\bts[-_][\w-]{16,}/,
  /\bxai-[A-Za-z0-9]{20,}/,
  /\bBearer\s+\S{8,}/i,
  /\b(?:api[_-]?key|apikey|access[_-]?key|client[_-]?secret|password|passwd|pwd|secret|token)\s*[:=]/i,
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/,
  /\bglpat-[A-Za-z0-9_-]{20,}/,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/,
  /\bAIza[0-9A-Za-z_-]{30,}/,
  /\b[sr]k_(?:live|test)_[A-Za-z0-9]{16,}/,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/,
  /\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:[^\s@/]+@/i,
];

/** True when text contains something shaped like a credential; such text is never sent to a hosted service. */
export const looksSecret = (text: string) => SECRET_PATTERNS.some((pattern) => pattern.test(text));

/**
 * Builds the only state Jev may receive: minimal structured metadata by
 * default. The user's request text is included only when the user explicitly
 * allowed task descriptions — and text that looks like a secret is refused.
 * Project files, transcripts, repository source and Agent scratch never enter.
 */
export function buildDecisionState(input: { taskClass: string; eligibleKeys: readonly string[]; mode: string; privacy: JevPrivacyPolicy; taskDescription?: string | null }): Record<string, unknown> {
  if (!input.privacy.allowDecisionMetadata) throw new Error("Cloud decision sharing is not enabled.");
  const state: Record<string, unknown> = {
    task_category_candidates: ["research", "code", "planning", "analysis", "testing", "conversation"],
    classified_task_class: input.taskClass,
    eligible_models: [...input.eligibleKeys],
    resource_budget_class: input.mode,
    latency_preference: input.mode === "fast" ? "low" : input.mode === "deep" ? "quality" : "balanced",
  };
  if (input.privacy.allowTaskDescription && input.taskDescription) {
    const text = input.taskDescription.slice(0, 2000);
    if (looksSecret(text)) throw new Error("The request appears to contain a secret; it was not sent.");
    state.task_description = text;
  }
  return state;
}

export type JevUsage = { sessionRequests: number; dayRequests: number; dayInputTokens: number | null; dayCostUsd: number | null; unknownUsageRows: number };

/** Pure budget gate. Unknown usage or price under a strict ceiling fails closed (§16). */
export function budgetCheck(policy: JevPolicy, usage: JevUsage): { ok: true } | { ok: false; state: JevConnectionState; reason: string } {
  const limits = policy.limits;
  if (!policy.enabled) return { ok: false, state: "DISABLED", reason: "Hosted decisions are disabled." };
  if (limits.maxRequestsPerSession <= 0 || limits.maxRequestsPerDay <= 0) return { ok: false, state: "BUDGET_EXHAUSTED", reason: "No hosted request allowance is set (the default is zero)." };
  if (usage.sessionRequests >= limits.maxRequestsPerSession) return { ok: false, state: "BUDGET_EXHAUSTED", reason: "Session request limit reached." };
  if (usage.dayRequests >= limits.maxRequestsPerDay) return { ok: false, state: "BUDGET_EXHAUSTED", reason: "Daily request limit reached." };
  if (limits.maxTokensPerDay !== null) {
    if (usage.dayInputTokens === null) return { ok: false, state: "BUDGET_EXHAUSTED", reason: "Token usage is unknown for an earlier request; the strict token ceiling fails closed." };
    if (usage.dayInputTokens >= limits.maxTokensPerDay) return { ok: false, state: "BUDGET_EXHAUSTED", reason: "Daily token limit reached." };
  }
  if (limits.monetaryCapUsdPerDay !== null) {
    if (usage.dayCostUsd === null && limits.strictBudget) return { ok: false, state: "BUDGET_EXHAUSTED", reason: "Cost is unknown (unpriced model or unreported usage); the strict spending limit fails closed." };
    if (usage.dayCostUsd !== null && usage.dayCostUsd >= limits.monetaryCapUsdPerDay) return { ok: false, state: "BUDGET_EXHAUSTED", reason: "Daily spending limit reached." };
  }
  return { ok: true };
}

/** Cost of one request from provider-reported input tokens; null when price or usage is unknown. */
export function requestCostUsd(answeredBy: string | null, inputTokens: number | null): number | null {
  if (inputTokens === 0) return 0;
  if (inputTokens === null || !answeredBy || !JEV_PRICED_MODEL.test(answeredBy)) return null;
  return (inputTokens / 1_000_000) * JEV_INPUT_USD_PER_MTOK;
}

// ------------------------------------------------------------- evaluation ----

export function percentile(values: readonly number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))];
}

const CALIBRATION_EDGES = [0, 0.25, 0.5, 0.75, 0.9, 1.0001];
/** Held-out routing accuracy + calibration bins for §15 comparisons. */
export function evaluateDecisions(rows: readonly { expected: string; chosen: string; confidence: number | null }[]) {
  const correct = rows.filter((row) => row.expected === row.chosen).length;
  const bins = CALIBRATION_EDGES.slice(0, -1).map((lo, index) => {
    const hi = CALIBRATION_EDGES[index + 1];
    const inBin = rows.filter((row) => row.confidence !== null && row.confidence >= lo && row.confidence < hi);
    const meanConfidence = inBin.length ? inBin.reduce((sum, row) => sum + (row.confidence ?? 0), 0) / inBin.length : null;
    return { range: `${lo}-${Math.min(hi, 1)}`, count: inBin.length, accuracy: inBin.length ? inBin.filter((row) => row.expected === row.chosen).length / inBin.length : null, meanConfidence };
  });
  const scored = bins.filter((bin) => bin.count && bin.accuracy !== null && bin.meanConfidence !== null);
  const ece = scored.length ? scored.reduce((sum, bin) => sum + (bin.count / rows.length) * Math.abs((bin.accuracy as number) - (bin.meanConfidence as number)), 0) : null;
  return { total: rows.length, correct, accuracy: rows.length ? correct / rows.length : null, bins, expectedCalibrationError: ece };
}
