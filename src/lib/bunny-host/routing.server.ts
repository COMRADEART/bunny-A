/**
 * M-A-3 Gate T3: the dynamic model router core.
 *
 * Extends the existing BunnyRouter (no second router). This module is pure:
 * every input arrives as an argument and the same inputs produce the same
 * routing decision (§26). Facts come only from T1's ModelCapability registry
 * and T2's ProviderUsageService — nothing here probes, polls or invents (§3).
 *
 * Order is always FILTER (hard, §8) then SCORE (deterministic, §12), with a
 * documented, versioned policy. Model "willingness" and model choice never
 * grant authority — the Router chooses INTELLIGENCE, the Host chooses
 * AUTHORITY (§28).
 */
import { reliabilityCategory, reliabilityPoints, type ReliabilityCategory } from "./ma4/hybrid.ts";
import type { Mode, ProviderId, ProviderLive, TaskConstraints } from "../orch/types.ts";
import type { TaskRequirements } from "../orch/router-requirements.ts";
import { effortRequirement } from "../orch/router-requirements.ts";
import { MODEL_SOURCE_PROVIDERS, type ModelCapabilityProviderSnapshot, type ModelCapabilityRecord } from "./model-capability.server.ts";
import type { ProviderUsageSnapshot, UsageState } from "./provider-usage.server.ts";
import { CODEX_COMPATIBILITY_MAX_AGE_MS, CODEX_SECURITY_POLICY_VERSION } from "../orch/compatibility.ts";
import { eligibility } from "./router.ts";

export const ROUTING_POLICY_VERSION = "routing-policy-ma4-s1-v1";

/** T3 §10 candidate kinds. */
export type CandidateKind = "DISCOVERED_MODEL" | "PROVIDER_DEFAULT";
/** T3 §11 normalized effort scale. */
export type NormalizedEffort = "LOW" | "MEDIUM" | "HIGH" | "MAX";
/** T3 §7 provenance kinds for routing-policy metadata (never passed to providers). */
export type RoutingProfileProvenance =
  | "PROVIDER_REPORTED" | "BUNNY_BENCHMARKED" | "USER_CONFIGURED" | "EMPIRICAL_HISTORY" | "POLICY_DEFAULT" | "UNKNOWN";
export type RoutingTaskClass = import("../orch/router-requirements.ts").RoutingTaskClass;

/** T3 §7: Bunny's own ranking policy for one candidate. Never displayed as provider-reported. */
export type ModelRoutingProfile = {
  provider_id: ProviderId;
  model_id: string | null;
  candidate_kind: CandidateKind;
  provenance: RoutingProfileProvenance;
  coding_rank: number;
  reasoning_rank: number;
  latency_rank: number;
  quality_rank: number;
  specialization_tags: string[];
  note?: string;
};

export type CapabilityFact = { name: string; value: boolean | number | null; provenance: "model_probe" | "adapter_contract" | "provider_probe" };

export type ScoreComponent = { name: string; points: number; detail: string };

export type RoutingCandidate = {
  provider_id: ProviderId;
  model_id: string | null;
  candidate_kind: CandidateKind;
  effort_internal: NormalizedEffort | "PROVIDER_DEFAULT" | "UNKNOWN";
  effort_native: string | null;
  eligibility: "eligible" | "excluded";
  exclusion_reasons: string[];
  observed_capabilities: CapabilityFact[];
  routing_profile: ModelRoutingProfile | null;
  provider_readiness: { ready: boolean; authenticated: boolean; availability: string; capabilities: string[] };
  model_readiness: { listed: boolean; probedThisRun: boolean } | null;
  usage_snapshot: { status: UsageState; percentUsed: number | null; observedAt: number | null } | null;
  usage_quality: UsageState;
  local_or_cloud: "local" | "cloud";
  recent_failure_state: { failedOutcomes: number | null; note: string };
  score_components: ScoreComponent[] | null;
  final_score: number | null;
};

/**
 * T3 §8 escape hatch, kept explicit and honest: the adapter's verified
 * execution profile proves a capability at the provider level. These are
 * code-verified adapter truths (MA2 live sessions), not invented permissions:
 * - Codex/claude adapters run agentic sessions with filesystem/terminal tools.
 * - The Ollama adapter performs single-shot text generation only — it cannot
 *   drive tool calls regardless of what a model's metadata claims.
 */
export const ADAPTER_TOOL_CONTRACTS: Partial<Record<ProviderId, boolean>> = { codex: true, claude: true, ollama: false, openrouter: false };

const DISPLAY_ORDER: ProviderId[] = ["codex", "claude", "ollama", "opencode", "cline", "cursor", "openrouter"];

/**
 * Versioned candidate scoring policy (T3 §12). Weights are points out of 100,
 * documented here, exercised in tests, and never tuned at runtime.
 */
export const ROUTING_POLICY = {
  version: ROUTING_POLICY_VERSION,
  weights: { classFit: 26, capabilityFit: 10, reasoningFit: 14, contextFit: 8, readiness: 10, usagePressure: 12, latency: 8, localFit: 6, empirical: 6 },
  tieBreak: ["final_score desc", "catalogue default first among exact ties", "established provider display order", "model id localeCompare"],
  usageConfidenceBasis: "T2 snapshot status only; current full, stale half, estimated/unknown neutral, genuinely unavailable excluded at provider eligibility",
  policyNote: "Ranks are Bunny policy priors with POLICY_DEFAULT provenance; they are never presented as provider-reported facts.",
} as const;

/** T3 §11 provider-native effort vocabulary, verified against the installed product surface. */
export type ProviderEffortContract = { supported: boolean; native: Partial<Record<NormalizedEffort, string>> | null; note?: string };
export const PROVIDER_EFFORT_CONTRACTS: Record<ProviderId, ProviderEffortContract> = {
  openrouter: { supported: false, native: null, note: "No inference effort override is asserted by this adapter." },
  codex: { supported: true, native: { LOW: "low", MEDIUM: "medium", HIGH: "high", MAX: "xhigh" } },
  claude: { supported: false, native: null, note: "The verified claude adapter passes no effort or model override (PROVIDER_DEFAULT only)." },
  ollama: { supported: false, native: null, note: "Ollama generate exposes no reasoning-effort knob." },
  opencode: { supported: false, native: null, note: "No execution adapter." },
  cline: { supported: false, native: null, note: "No execution adapter." },
  cursor: { supported: false, native: null, note: "No execution adapter." },
};

export type CandidateInput = {
  providers: ProviderLive[];
  modelSnapshot: { providers: ModelCapabilityProviderSnapshot[] };
  usage: { providers: ProviderUsageSnapshot[] };
  requirements: TaskRequirements;
  constraints: TaskConstraints;
  override: ProviderId | "auto";
  modelOverride?: string | null;
  mode: Mode;
  empirical?: (provider: ProviderId, model: string | null) => number | null;
  evaluated?: (provider: ProviderId, model: string | null) => number | null;
  /** MA4-S1R2: measured task-category correctness for a model; null is UNPROVEN (never a bonus). */
  reliability?: (provider: ProviderId, model: string | null, category: ReliabilityCategory) => { passes: number; samples: number } | null;
  /** M-A-3 T13.1: Laya benchmark gate; returns an exclusion reason for an unbenchmarked Laya model. */
  layaGate?: (model: string, taskClass: string) => string | null;
  connectionGate?: (provider: ProviderId, model: string | null) => string | null;
  /** M-A-3 T13.3 Gate F: the owner's routing priority. It only reorders eligible candidates; it never widens eligibility. */
  priority?: RoutingPriority;
};

/**
 * M-A-3 T13.3 Gate F (§18): quota exhaustion during write work pauses instead of switching providers, because Bunny
 * cannot confirm which side effects already landed. Read work keeps the bounded reroute.
 */
export const TRANSPORT_WRITE_PAUSE = "WRITE_PAUSE: the connection failed during work that may write files. Outcome uncertain — reconciliation required. Bunny paused instead of retrying on this or any other provider, because a connection failure does not prove that nothing landed. Review the workspace and any external effects, then retry or close.";
/** T13.3 N-C: any other failure of write work after its attempt may have started. */
export const OUTCOME_UNCERTAIN_PAUSE = "OUTCOME_UNCERTAIN: the attempt may have started changing files or external systems before it failed. Outcome uncertain — reconciliation required. Bunny paused instead of retrying on this or any other provider, because it cannot confirm what already landed. Review the workspace and any external effects, then retry or close.";
export const QUOTA_WRITE_PAUSE = "QUOTA_PAUSE: the provider's quota ran out during write work. Outcome uncertain — reconciliation required. Bunny paused instead of retrying or switching providers, because it cannot confirm which changes already landed. Completed steps are kept; review the workspace, then retry or choose another account.";
/** T13.3 N-C: a finished write attempt that failed Bunny-A's own check; repeating it could repeat its changes. */
export const VERIFY_WRITE_PAUSE = "VERIFY_PAUSE: the attempt finished but did not pass Bunny-A's own check. Outcome uncertain — reconciliation required. Bunny paused instead of re-running it on this or any other provider, because a re-run could repeat the changes it already made. Review the workspace, then retry or close.";
/** T13.3 N-C: write work stopped after it may have started. A stop is never replayed; the owner reconciles first. */
export const STOP_WRITE_PAUSE = "STOPPED: this work was stopped after it may have started changing files or external systems. Outcome uncertain — reconciliation required before any retry.";
/** T13.3 N-C: why write work that may have started is paused instead of re-executed. */
export function writePause(taxonomy: RoutingFailureTaxonomy): string {
  return taxonomy === "QUOTA_CONSTRAINED" ? QUOTA_WRITE_PAUSE
    : taxonomy === "TRANSIENT_TRANSPORT" ? TRANSPORT_WRITE_PAUSE
    : taxonomy === "VERIFICATION_FAILED" ? VERIFY_WRITE_PAUSE
    : OUTCOME_UNCERTAIN_PAUSE;
}

import type { RoutingPriority } from "./fairness.ts";
export { ROUTING_PRIORITIES, type RoutingPriority } from "./fairness.ts";
/** Points the owner's priority may add (doubled for lightweight work under minimize_cost); eligibility is decided before scoring. */
export const PRIORITY_WEIGHT = 8;

function priorityComponent(candidate: RoutingCandidate, requirements: TaskRequirements, priority: RoutingPriority | undefined): ScoreComponent | null {
  const local = candidate.local_or_cloud === "local";
  const lightweight = requirements.reasoning_complexity === "LOW" && (requirements.coding_complexity === "NONE" || requirements.coding_complexity === "LOW") && !requirements.needs_tools;
  if (priority === "minimize_cost")
    return { name: "priority", points: local ? PRIORITY_WEIGHT * (lightweight ? 2 : 1) : 0, detail: `Owner priority: minimize cost${lightweight ? " (lightweight work)" : ""}. Local models cost nothing; a cloud cost is never assumed free.` };
  if (priority === "prioritize_quality")
    return { name: "priority", points: round(rankFor(candidate.routing_profile, requirements.task_class) / 100 * PRIORITY_WEIGHT), detail: "Owner priority: quality (policy rank for this task class)." };
  if (priority === "fastest")
    return { name: "priority", points: round((candidate.routing_profile?.latency_rank ?? 50) / 100 * (PRIORITY_WEIGHT / 2) + (local ? PRIORITY_WEIGHT / 2 : 0)), detail: "Owner priority: fastest eligible (latency prior plus local advantage)." };
  return null;
}

const rankFor = (profile: ModelRoutingProfile | null, taskClass: RoutingTaskClass): number => {
  if (!profile) return 50;
  if (taskClass === "coding" || taskClass === "repository_coding" || taskClass === "structured_generation") return profile.coding_rank;
  if (taskClass === "research" || taskClass === "reasoning" || taskClass === "math" || taskClass === "verification") return profile.reasoning_rank;
  return profile.quality_rank;
};

/** Deterministic policy priors (T3 §7). POLICY_DEFAULT provenance — Bunny's documented priors. */
export function routingProfileFor(provider: ProviderId, record: ModelCapabilityRecord | null, candidateKind: CandidateKind): ModelRoutingProfile {
  const tags: string[] = [];
  if (record?.vision === true) tags.push("vision");
  if (record?.toolCalling === true) tags.push("tools");
  if (record?.local) tags.push("local");
  if (candidateKind === "PROVIDER_DEFAULT") {
    // Claude's verified session behavior under MA2: strong reasoning/research, capable coding.
    return { provider_id: provider, model_id: null, candidate_kind: candidateKind, provenance: "POLICY_DEFAULT", coding_rank: 82, reasoning_rank: 92, latency_rank: 50, quality_rank: 90, specialization_tags: tags, note: "Provider default: Bunny policy prior, not a provider-reported ranking." };
  }
  if (provider === "codex") {
    const preferred = record?.isDefault === true;
    if (preferred) tags.push("catalogue-default");
    return { provider_id: provider, model_id: record!.model, candidate_kind: candidateKind, provenance: "POLICY_DEFAULT", coding_rank: preferred ? 91 : 86, reasoning_rank: preferred ? 88 : 84, latency_rank: 48, quality_rank: preferred ? 90 : 86, specialization_tags: tags, note: record?.isDefault === true ? "Codex catalogue-preferred model." : undefined };
  }
  if (provider === "openrouter") return { provider_id: provider, model_id: record!.model, candidate_kind: candidateKind, provenance: "POLICY_DEFAULT", coding_rank: 50, reasoning_rank: 50, latency_rank: 50, quality_rank: 50, specialization_tags: tags, note: "Neutral policy prior; no measured capability is inferred from a model name." };
  // Ollama local models: modest priors, adjusted only by verified probe facts.
  const context = typeof record?.contextWindow === "number" ? record.contextWindow : null;
  if (context && context >= 100_000) tags.push("large-context");
  if (record?.isDefault === true) tags.push("catalogue-default");
  return { provider_id: provider, model_id: record!.model, candidate_kind: candidateKind, provenance: "POLICY_DEFAULT", coding_rank: 55, reasoning_rank: 55, latency_rank: 80, quality_rank: 62, specialization_tags: tags };
}

/** Resolves one capability: verified model fact, else the adapter contract, else UNKNOWN (never true). */
export function resolveCapability(provider: ProviderId, record: ModelCapabilityRecord | null, name: string): CapabilityFact {
  if (name === "tools") {
    const contract = ADAPTER_TOOL_CONTRACTS[provider];
    // A verified adapter CANNOT is terminal (§8 escape hatch): Bunny's ollama adapter runs
    // single-shot text generation, so model metadata never routes tool work into it.
    if (contract === false) return { name, value: false, provenance: "adapter_contract" };
    if (record && record.provider === "ollama" && record.toolCalling != null) return { name, value: record.toolCalling, provenance: "model_probe" };
    if (contract != null) return { name, value: contract, provenance: "adapter_contract" };
    return { name, value: null, provenance: "adapter_contract" };
  }
  if (name === "vision") {
    if (record && record.vision != null) return { name, value: record.vision, provenance: "model_probe" };
    return { name, value: null, provenance: "model_probe" };
  }
  if (name === "large_context") {
    if (record && typeof record.contextWindow === "number") return { name, value: record.contextWindow, provenance: "model_probe" };
    return { name, value: null, provenance: "model_probe" };
  }
  return { name, value: null, provenance: "model_probe" };
}

/** T3 §8 hard eligibility. Returns exclusion reasons; empty means the candidate survives to scoring. */
export function hardExclusions(input: { provider: ProviderLive; record: ModelCapabilityRecord | null; candidateKind: CandidateKind; requirements: TaskRequirements; constraints: TaskConstraints; modelOverride?: string | null }): string[] {
  const { provider, record, candidateKind, requirements, constraints } = input;
  const reasons: string[] = [];
  if (constraints.maxCostUsd !== undefined && provider.id !== "openrouter" && record?.local !== true) reasons.push("A strict monetary budget requires known per-request pricing; unavailable for this candidate.");
  if (constraints.sensitive && !record?.local) reasons.push("Sensitive data requires local inference.");
  if (constraints.requiresAudio) reasons.push("No installed execution adapter has a verified audio input contract.");
  if (constraints.language && !record?.languages?.includes(constraints.language)) reasons.push("Required language support is unverified.");
  if (constraints.responseFormat && record?.structuredOutput !== true && provider.id !== "ollama") reasons.push("Structured output capability is unknown or unavailable.");
  if (constraints.outputTokens && (record?.outputTokens == null || record.outputTokens < constraints.outputTokens) && provider.id !== "ollama") reasons.push("Output-token capacity is unknown or insufficient.");
  const features = provider.features ?? null;
  if (!features?.launch?.supported) reasons.push("No execution adapter for this provider.");
  const providerBlock = eligibility(provider, constraints);
  if (providerBlock) reasons.push(providerBlock);

  if (candidateKind === "DISCOVERED_MODEL") {
    if (!record) reasons.push("Model is not a currently discovered model.");
  }
  const isLocal = candidateKind === "PROVIDER_DEFAULT" ? provider.local_or_cloud === "local" : (record?.local ?? provider.local_or_cloud === "local");
  if (requirements.privacy_requirement === "local_only" && !isLocal) reasons.push("Privacy requirement keeps data on this workstation; this candidate leaves the machine.");
  if (requirements.needs_local_execution && !isLocal) reasons.push("Task requires local execution.");
  if (constraints.localOnly === true && !isLocal) reasons.push("User constraint: local only.");
  if (constraints.offlineOnly === true && !isLocal) reasons.push("User constraint: offline only.");
  if (constraints.cloudOnly === true && isLocal) reasons.push("User constraint: cloud only.");
  if (constraints.privacyLocal === true && !isLocal) reasons.push("User constraint: privacy local.");

  // Hard capability requirements (§8): verified false, or UNKNOWN without an adapter-contract proof, excludes.
  for (const name of ["tools", "vision"] as const) {
    if (name === "tools" && !requirements.needs_tools) continue;
    if (name === "vision" && !requirements.needs_vision) continue;
    const fact = resolveCapability(provider.id, record, name);
    if (fact.value !== true) {
      reasons.push(fact.value === false
        ? `Verified fact: this candidate cannot ${name === "tools" ? "make tool calls" : "process images"}.`
        : `Capability "${name}" is UNKNOWN for this candidate and the requirement is hard (§8).`);
    }
  }
  if (requirements.needs_large_context) {
    const fact = resolveCapability(provider.id, record, "large_context");
    const need = requirements.estimated_context_requirement ?? 0;
    const windowChars = typeof fact.value === "number" ? fact.value : null;
    if (windowChars == null) reasons.push("Verified context window is UNKNOWN and a large-context requirement is hard (§8).");
    else if (windowChars < Math.max(need * 1.25, 8_000)) reasons.push(`Verified context window (${windowChars}) is below the requirement.`);
  }
  // Model pins (§27) are eligibility filters with audit reasons — never silent substitutions. A
  // provider without a model surface cannot honor a pin and says so instead of substituting its default.
  if (constraints.modelExact && record?.model !== constraints.modelExact) {
    reasons.push(candidateKind === "PROVIDER_DEFAULT"
      ? "User pinned an exact model; this provider has no model-selection surface (§9), so the pin cannot be honored."
      : "User requires a different exact model.");
  }
  if (constraints.modelAllowlist?.length && (record ? !constraints.modelAllowlist.includes(record.model) : true)) {
    reasons.push(candidateKind === "PROVIDER_DEFAULT"
      ? "User allowlist names specific models; this provider has no model-selection surface (§9)."
      : "User model allowlist does not include this candidate.");
  }
  if (input.modelOverride && record?.model !== input.modelOverride) {
    reasons.push("Manual selection targets a different model.");
  }
  return reasons;
}

function usagePressure(snapshot: ProviderUsageSnapshot | null): { status: UsageState; worst: number | null; observedAt: number | null } {
  if (!snapshot) return { status: "unknown", worst: null, observedAt: null };
  const percent = snapshot.windows.map((window) => window.percentUsed).filter((value): value is number => typeof value === "number");
  return { status: snapshot.status, worst: percent.length ? Math.max(...percent) : null, observedAt: snapshot.observedAt };
}

/** T3 §12 deterministic, inspectable scoring. */
export function scoreCandidate(candidate: RoutingCandidate, requirements: TaskRequirements, input: CandidateInput): { components: ScoreComponent[]; final: number } {
  const w = ROUTING_POLICY.weights;
  const profile = candidate.routing_profile;
  const components: ScoreComponent[] = [];

  const fit = rankFor(profile, requirements.task_class) * (w.classFit / 100);
  components.push({ name: "class_fit", points: round(fit), detail: `${requirements.task_class} fit of the candidate's routing profile (policy prior).` });

  let capability = 0; const caps: string[] = [];
  for (const name of requirements.preferred_capabilities) {
    if (profile?.specialization_tags.includes(name)) { capability += 2; caps.push(name); }
    else if (name === "privacy_capacity" && candidate.local_or_cloud === "local") { capability += 1; caps.push("local-privacy"); }
  }
  if (profile?.specialization_tags.includes("large-context") && requirements.estimated_context_requirement) { capability += 2; caps.push("large-context"); }
  components.push({ name: "capability_fit", points: round(Math.min(capability, w.capabilityFit)), detail: caps.length ? `Verified/preferred: ${caps.join(", ")}.` : "No verified preference match." });

  const reasoning = requirements.reasoning_complexity === "MAX" ? (profile?.reasoning_rank ?? 50) >= 85 ? w.reasoningFit : profile ? (profile.reasoning_rank / 100) * w.reasoningFit * 0.5 : 3 : profile ? (profile.reasoning_rank / 100) * w.reasoningFit : w.reasoningFit / 2;
  components.push({ name: "reasoning_fit", points: round(reasoning), detail: `reasoning_complexity ${requirements.reasoning_complexity} vs reasoning rank (policy prior).` });

  const context = candidateRoutingContextFit(candidate, requirements);
  components.push({ name: "context_fit", points: round(context), detail: requirements.estimated_context_requirement ? "Verified context window vs the requirement." : "No explicit context requirement; neutral." });

  const readiness = (candidate.provider_readiness.ready ? 6 : 0) + (candidate.provider_readiness.authenticated ? 3 : 1) + (candidate.model_readiness?.listed ? 1 : candidate.candidate_kind === "PROVIDER_DEFAULT" ? 1 : 0);
  components.push({ name: "readiness", points: round(Math.min(readiness, w.readiness)), detail: `${candidate.provider_readiness.availability}${candidate.model_readiness?.probedThisRun ? "; facts probed this run" : "; facts from a previous run"}.` });

  const usagePoints = usageComponent(candidate, w.usagePressure);
  components.push(usagePoints);

  const latency = (profile?.latency_rank ?? 50) / 100 * (w.latency / 2) + (candidate.local_or_cloud === "local" ? w.latency / 4 : 0) + (requirements.preferred_capabilities.includes("latency") && candidate.local_or_cloud === "local" ? w.latency / 4 : 0);
  components.push({ name: "latency", points: round(latency), detail: "Policy latency prior plus the local inference advantage." });

  const localFit = requirements.privacy_requirement === "local_only" ? 0 : w.localFit / 2;
  components.push({ name: "local_fit", points: round(localFit), detail: "Neutral by design: local is never auto-inferior, cloud never auto-superior (T3 §15)." });

  const empirical = input.empirical ? safeEmpirical(input.empirical, candidate) : 0;
  components.push({ name: "empirical", points: round(empirical * w.empirical), detail: "Bounded verified-success history (EMPIRICAL_HISTORY), zero below the minimum sample count." });
  const measured = input.evaluated?.(candidate.provider_id, candidate.model_id);
  if (measured !== undefined && measured !== null && Number.isFinite(measured)) components.push({ name: "benchmark", points: round(Math.max(-1, Math.min(1, measured)) * 6), detail: "Versioned synthetic benchmark evidence; limited scope, not a general capability guarantee." });

  // MA4-S1R2 H1: correctness evidence per task category is separate from capability flags; valid JSON is not correct code.
  const category = reliabilityCategory(requirements.model_intelligence);
  if (category && input.reliability) {
    let evidence: { passes: number; samples: number } | null = null;
    try { evidence = input.reliability(candidate.provider_id, candidate.model_id, category); } catch { evidence = null; }
    const r = reliabilityPoints(evidence);
    components.push({ name: "reliability", points: r.points, detail: `${category}: ${r.detail}` });
  }

  const priority = priorityComponent(candidate, requirements, input.priority);
  if (priority) components.push(priority);

  const final = round(components.reduce((sum, c) => sum + c.points, 0));
  return { components, final };
}

function candidateRoutingContextFit(candidate: RoutingCandidate, requirements: TaskRequirements): number {
  const need = requirements.estimated_context_requirement;
  const cap = candidate.observed_capabilities.find((fact) => fact.name === "large_context")?.value;
  if (!need || typeof cap !== "number") return 3; // Soft case or honest UNKNOWN: neutral, never invented.
  // Eligible candidates already passed the §8 hard filter (window ≥ 1.25× the requirement); headroom earns more.
  return round(Math.min(1.5, cap / need) / 1.5 * ROUTING_POLICY.weights.contextFit);
}
function usageComponent(candidate: RoutingCandidate, weight: number): ScoreComponent {
  const status = candidate.usage_quality;
  const worst = candidate.usage_snapshot?.percentUsed ?? null;
  if (status === "current") {
    const penalty = worst == null ? 0 : (worst / 100) * 9; // Current truth may affect ranking (§14).
    return { name: "usage", points: round(Math.max(0, weight - penalty)), detail: `Usage CURRENT${worst == null ? "" : ` · ${Math.round(worst)}% used on the fullest window`}.` };
  }
  if (status === "stale") return { name: "usage", points: round(Math.max(0, weight / 2 - (worst == null ? 0 : (worst / 100) * 4.5))), detail: `Usage STALE: lower confidence; same direction, half weight.` };
  if (status === "estimated") return { name: "usage", points: 5, detail: "Usage ESTIMATED: soft preference only." };
  return { name: "usage", points: weight / 2, detail: "Usage UNKNOWN: neither free, nor unlimited, nor exhausted, nor expensive — neutral." };
}
function safeEmpirical(lookup: (provider: ProviderId, model: string | null) => number | null, candidate: RoutingCandidate): number {
  try { return Math.max(-1, Math.min(1, lookup(candidate.provider_id, candidate.model_id) ?? 0)); } catch { return 0; }
}
const round = (value: number): number => Math.round(value * 10) / 10;

/** T3 §13: the catalogue default never auto-wins; it is only the first among exact ties. */
export function selectRoutingCandidate(input: { candidates: RoutingCandidate[]; requirements: TaskRequirements }): { selected: RoutingCandidate | null; order: RoutingCandidate[]; reason: string } {
  const { candidates, requirements } = input;
  const eligible = candidates.filter((candidate) => candidate.eligibility === "eligible" && candidate.final_score != null);
  const order = [...eligible].sort((a, b) =>
    (b.final_score ?? 0) - (a.final_score ?? 0)
    || Number(b.routing_profile?.specialization_tags.includes("catalogue-default") ?? false) - Number(a.routing_profile?.specialization_tags.includes("catalogue-default") ?? false)
    || DISPLAY_ORDER.indexOf(a.provider_id) - DISPLAY_ORDER.indexOf(b.provider_id)
    || (a.model_id ?? "").localeCompare(b.model_id ?? ""));
  const selected = order[0] ?? null;
  if (!selected) return { selected: null, order, reason: "No eligible candidate." };
  const classFit = selected.score_components?.find((c) => c.name === "class_fit");
  const usage = selected.score_components?.find((c) => c.name === "usage");
  const choice = selected.candidate_kind === "PROVIDER_DEFAULT" ? "the provider default" : selected.model_id;
  const reason = `${requirements.task_class} task → ${choice} on ${selected.provider_id}. ${classFit?.detail ?? ""}${usage && selected.usage_quality !== "current" ? ` ${usage.detail}` : ""}`.trim();
  return { selected, order, reason };
}

/** T3 §17: cached discovery is not launch authority. */
export type RevalidationContext = { providers: ProviderLive[]; modelSnapshot: { providers: ModelCapabilityProviderSnapshot[] }; now: number };
export function preLaunchRevalidate(candidate: { provider_id: ProviderId; model_id: string | null; candidate_kind: CandidateKind }, providers: ProviderLive[], modelSnapshot: { providers: ModelCapabilityProviderSnapshot[] }, constraints: TaskConstraints, _now: number): { ok: true } | { ok: false; reason: string } {
  const provider = providers.find((entry) => entry.id === candidate.provider_id);
  if (!provider) return { ok: false, reason: `Provider ${candidate.provider_id} is no longer known.` };
  // Launchable availability matches eligibility() exactly: busy is alive and the adapters own
  // concurrent jobs (pre-T3 contract); only a provider that went dark is "no longer ready".
  if (!["ready","busy"].includes(provider.availability)) return { ok: false, reason: `Provider ${provider.name} is no longer ready (${provider.availability}).` };
  const block = eligibility(provider, constraints);
  if (block) return { ok: false, reason: block };
  if (candidate.candidate_kind === "DISCOVERED_MODEL") {
    // Registry absence for a listing provider is UNKNOWN (never probed, or a probe that produced
    // nothing) — never evidence of emptiness: pass and let the adapter's own launch-time re-probe
    // be the backstop; a real miss classifies as MODEL_UNAVAILABLE and reroutes (§17).
    const facts = modelSnapshot.providers.find((entry) => entry.provider === candidate.provider_id)?.models ?? [];
    if (!facts.length) return { ok: true };
    const listed = (provider.models ?? []).includes(candidate.model_id!);
    const snapshotted = facts.some((entry) => entry.model === candidate.model_id);
    if (!listed || !snapshotted) return { ok: false, reason: `Selected model ${candidate.model_id} is no longer verified as listed by ${provider.name}.` };
    return { ok: true };
  }
  // PROVIDER_DEFAULT: the provider is ready and its adapter executes; Claude reports the model inside the session.
  return { ok: true };
}

/** M-A-2 Codex binary-compatibility freshness, mirrored from orch/compatibility.ts as a fail-fast pre-launch (§17). The adapter's own gate stays the authority. */
export function codexCompatibilityFresh(provider: ProviderLive, now: number): { ok: boolean; reason?: string } {
  if (provider.id !== "codex") return { ok: true };
  const profile = provider.securityCompatibility;
  // Absence here is UNKNOWN, never a refusal: the adapter's own MA2 binary gate (untouched, §34)
  // remains the authority that refuses an unvalidated codex at launch.
  if (!profile) return { ok: true };
  if (profile.policyVersion !== CODEX_SECURITY_POLICY_VERSION) return { ok: false, reason: "Codex security policy version has not been validated." };
  if (profile.compatibilityClass !== "VALIDATED") return { ok: false, reason: profile.reason };
  if (!Number.isFinite(profile.checkedAt) || now - profile.checkedAt >= CODEX_COMPATIBILITY_MAX_AGE_MS || profile.checkedAt > now + 1000) return { ok: false, reason: "Codex security compatibility evidence is stale; refresh providers." };
  return { ok: true };
}

/** T3 §21 failure taxonomy. */
export type RoutingFailureTaxonomy =
  | "TRANSIENT_TRANSPORT" | "PROVIDER_UNAVAILABLE" | "MODEL_UNAVAILABLE" | "QUOTA_CONSTRAINED" | "CONTEXT_OVERFLOW"
  | "CAPABILITY_MISMATCH" | "TOOL_UNSUPPORTED" | "PROVIDER_REFUSAL" | "MALFORMED_RESULT" | "EXECUTION_FAILED"
  | "VERIFICATION_FAILED" | "POLICY_DENIED";

/** Classifies one finished attempt from safe adapter facts; the default stays conservative (EXECUTION_FAILED). */
export function classifyFailure(input: { error?: string | null; stopped?: boolean; exitCode: number | null | undefined; policyDenied?: boolean; verificationFailed?: boolean; usageLimitStatus?: string | null }): RoutingFailureTaxonomy {
  if (input.verificationFailed) return "VERIFICATION_FAILED";
  if (input.policyDenied) return "POLICY_DENIED";
  if (input.stopped) return "EXECUTION_FAILED";
  const text = (input.error ?? "").slice(0, 4000);
  // T13.3 N7: quota is checked first, so "usage limit … no longer available" keeps the quota write pause.
  if (/usage limit|not allowed right now|quota|rate limit|\b429\b/i.test(text) || input.usageLimitStatus === "rejected") return "QUOTA_CONSTRAINED";
  if (/no longer available|Model missing|no models? installed/i.test(text)) return "MODEL_UNAVAILABLE";
  if (/is offline|unreachable|ECONNREFUSED|connection refused|not configured|probe failed/i.test(text)) return "PROVIDER_UNAVAILABLE";
  if (/context (window|length)|too (long|large)|exceeds the (context|token)|maximum context/i.test(text)) return "CONTEXT_OVERFLOW";
  if (/invalid json|parse error|malformed|unexpected end of json/i.test(text)) return "MALFORMED_RESULT";
  if (/\btool(s)?\b.{0,24}(?:not |un)supported|\bunsupported (tool|capability)|does not support tools?/i.test(text)) return "TOOL_UNSUPPORTED";
  if (/capabilit(?:y|ies)/i.test(text)) return "CAPABILITY_MISMATCH";
  if (/\bI can'?t\b|\brefus(?:e|ed|al|es)\b|\bdeclined\b|unable to (?:assist|comply)|against (?:my|their) policy/i.test(text)) return "PROVIDER_REFUSAL";
  if (/timed? ?out|timeout|transient|ECONNRESET|socket hang up|network error|stream (?:ended|reset)|disconnect/i.test(text)) return "TRANSIENT_TRANSPORT";
  return "EXECUTION_FAILED";
}

export type RecoveryAction =
  | { action: "retry-same"; reason: string }
  | { action: "reroute"; reason: string; excludeModel?: string | null; excludeProvider?: ProviderId }
  | { action: "reroute-larger-context"; reason: string; excludeModel?: string | null }
  | { action: "escalate-effort"; reason: string }
  | { action: "fail"; reason: string };

export const RECOVERY_BOUNDS = { sameCandidateRetries: 1, alternates: 2, maxAttempts: 4, verificationEscalations: 1 } as const;

/**
 * T3 §22/§23: bounded, taxonomy-driven recovery. POLICY_DENIED and bare
 * EXECUTION_FAILED never recover; everything recovers at most to the
 * documented bounds; VERIFICATION_FAILED escalates at most once.
 */
export function planRecovery(input: { taxonomy: RoutingFailureTaxonomy; attemptIndex: number; sameRetriesUsed: number; alternatesUsed: number; escalationsUsed: number; reroutesUsed: number; policyAllows?: boolean }): RecoveryAction {
  const { taxonomy, attemptIndex, sameRetriesUsed, alternatesUsed, escalationsUsed } = input;
  const exhausted = (reason: string): RecoveryAction => ({ action: "fail", reason: `all_eligible_models_failed after ${attemptIndex} attempt(s): ${reason}.` });
  if (attemptIndex >= RECOVERY_BOUNDS.maxAttempts) return exhausted("attempt bound reached (§23)");
  switch (taxonomy) {
    case "TRANSIENT_TRANSPORT":
      return sameRetriesUsed < RECOVERY_BOUNDS.sameCandidateRetries
        ? { action: "retry-same", reason: "Transient transport failure; one bounded same-candidate retry (§22)." }
        : alternatesUsed < RECOVERY_BOUNDS.alternates
          ? { action: "reroute", reason: "Transient transport persisted; routing to the next eligible candidate." }
          : exhausted("transient transport persisted beyond the retry bound");
    case "MALFORMED_RESULT":
      return sameRetriesUsed < RECOVERY_BOUNDS.sameCandidateRetries
        ? { action: "retry-same", reason: "One bounded same-candidate retry after a malformed result (§22)." }
        : exhausted("malformed result persisted");
    case "PROVIDER_UNAVAILABLE":
      return alternatesUsed < RECOVERY_BOUNDS.alternates
        ? { action: "reroute", reason: "Provider unavailable; routing to an alternate candidate.", excludeProvider: undefined }
        : exhausted("provider unavailable");
    case "MODEL_UNAVAILABLE":
      return alternatesUsed < RECOVERY_BOUNDS.alternates
        ? { action: "reroute", reason: "Selected model unavailable; routing to an alternate candidate." }
        : exhausted("model unavailable");
    case "QUOTA_CONSTRAINED":
      return alternatesUsed < RECOVERY_BOUNDS.alternates
        ? { action: "reroute", reason: "Quota exhausted on this candidate; routing to a lower-pressure candidate." }
        : exhausted("all eligible candidates are quota-constrained");
    case "CONTEXT_OVERFLOW":
      return alternatesUsed < RECOVERY_BOUNDS.alternates
        ? { action: "reroute-larger-context", reason: "Context overflow; preferring a candidate with a verified larger window." }
        : exhausted("no larger verified context available");
    case "CAPABILITY_MISMATCH":
    case "TOOL_UNSUPPORTED":
      return alternatesUsed < RECOVERY_BOUNDS.alternates
        ? { action: "reroute", reason: "Candidate lacks a required capability; excluded and rerouting." }
        : exhausted("capability mismatch beyond the reroute bound");
    case "PROVIDER_REFUSAL":
      // Bunny's policy gate decides: refusals reroute ONLY when the Host policy itself allows the Task.
      if (input.policyAllows === false) return exhausted("a provider declined; Bunny policy does not route around refusals for this Task");
      return alternatesUsed < RECOVERY_BOUNDS.alternates
        ? { action: "reroute", reason: "Provider declined a Task Bunny's own policy allows; routing to an alternate candidate." }
        : exhausted("refusal and reroute bound reached");
    case "VERIFICATION_FAILED":
      return escalationsUsed < RECOVERY_BOUNDS.verificationEscalations
        ? { action: "escalate-effort", reason: "Verification failed; escalating effort or candidate once (§24)." }
        : exhausted("verification failed after the single escalation");
    case "EXECUTION_FAILED":
    case "POLICY_DENIED":
      return exhausted(taxonomy === "POLICY_DENIED" ? "Bunny policy denied this execution; rerouting is forbidden (§22)" : "execution failed without a recoverable signature");
    default: {
      const never: never = taxonomy;
      return exhausted(`unhandled taxonomy ${String(never)}`);
    }
  }
}

/** Builds the complete candidate list (filter then score) for one routing call. Pure. */
export function buildCandidates(input: CandidateInput): RoutingCandidate[] {
  const { providers, modelSnapshot, usage, requirements, constraints, override, modelOverride } = input;
  const modelMaps = new Map(modelSnapshot.providers.map((entry) => [entry.provider, entry] as const));
  const usageMap = new Map(usage.providers.map((entry) => [entry.providerId, entry] as const));
  const candidates: RoutingCandidate[] = [];
  for (const provider of providers) {
    if (override !== "auto" && provider.id !== override) continue;
    const records = modelMaps.get(provider.id);
    const listingProvider = MODEL_SOURCE_PROVIDERS.includes(provider.id);
    // Model pins are handled as eligibility rules inside hardExclusions, so the record shows why
    // each non-honoring candidate was dropped instead of pre-filtering it away silently.
    const shapes: { kind: CandidateKind; record: ModelCapabilityRecord | null }[] = listingProvider
      ? (records?.models ?? []).map((record) => ({ kind: "DISCOVERED_MODEL" as const, record }))
      : [{ kind: "PROVIDER_DEFAULT" as const, record: null }];
    for (const shape of shapes) {
      const snapshot = usageMap.get(provider.id) ?? null;
      const press = usagePressure(snapshot);
      const profile = routingProfileFor(provider.id, shape.record, shape.kind);
      const candidate: RoutingCandidate = {
        provider_id: provider.id, model_id: shape.record?.model ?? null, candidate_kind: shape.kind,
        effort_internal: "PROVIDER_DEFAULT", effort_native: null,
        eligibility: "eligible", exclusion_reasons: [],
        observed_capabilities: ["tools", "vision", "large_context"].map((name) => resolveCapability(provider.id, shape.record, name)),
        routing_profile: profile,
        provider_readiness: { ready: provider.availability === "ready", authenticated: provider.authenticated, availability: provider.availability, capabilities: provider.capabilities ?? [] },
        model_readiness: shape.kind === "DISCOVERED_MODEL" ? { listed: true, probedThisRun: records?.probedThisRun ?? false } : null,
        usage_snapshot: snapshot ? { status: snapshot.status, percentUsed: press.worst, observedAt: snapshot.observedAt } : null,
        usage_quality: snapshot?.status ?? "unknown",
        local_or_cloud: shape.kind === "DISCOVERED_MODEL" ? (shape.record?.local ? "local" : "cloud") : (provider.local_or_cloud === "local" ? "local" : "cloud"),
        recent_failure_state: { failedOutcomes: null, note: "No recorded failures for this candidate." },
        score_components: null, final_score: null,
      };
      const exclusions = hardExclusions({ provider, record: shape.record, candidateKind: shape.kind, requirements, constraints, modelOverride });
      const connectionReason = input.connectionGate?.(provider.id, shape.record?.model ?? null);
      if (connectionReason) exclusions.push(connectionReason);
      if (shape.record && input.layaGate) {
        const layaReason = input.layaGate(shape.record.model, requirements.task_class);
        if (layaReason) exclusions.push(layaReason);
      }
      if (exclusions.length) {
        candidate.eligibility = "excluded";
        candidate.exclusion_reasons = exclusions;
        candidates.push(candidate);
        continue;
      }
      const effortInternal = effortRequirement(requirements, input.mode);
      const contract = PROVIDER_EFFORT_CONTRACTS[provider.id];
      candidate.effort_internal = contract.supported ? effortInternal : "PROVIDER_DEFAULT";
      candidate.effort_native = contract.supported ? contract.native?.[effortInternal] ?? null : null;
      const scored = scoreCandidate(candidate, requirements, input);
      candidate.score_components = scored.components;
      candidate.final_score = scored.final;
      candidates.push(candidate);
    }
  }
  return candidates;
}

/** Safe RoutingDecision record (T3 §18): no transcripts, no hidden reasoning, no credentials. */
export type RoutingDecisionRecord = {
  routing_decision_id: string;
  task_id: string;
  mission_id: string | null;
  policy_version: string;
  created_at: number;
  routing_mode: "auto" | "manual";
  classification: { task_class: string; evidence: string[] };
  requirements: TaskRequirements;
  snapshot_references: { provider: ProviderId; models: number; probedThisRun: boolean; usage_status: UsageState | null }[];
  candidates_considered: { provider_id: ProviderId; model_id: string | null; candidate_kind: CandidateKind; effort_mode: string; eligible: boolean; exclusion_reasons: string[]; score: number | null; components: { name: string; points: number }[] | null }[];
  selected: { provider_id: ProviderId; model_id: string | null; candidate_kind: CandidateKind; effort_internal: string; effort_native: string | null; reason: string } | null;
  fallback_order: { provider_id: ProviderId; model_id: string | null; score: number }[];
  reroutes: number;
  terminal_note?: string;
  /** M-A-3 T13.1: hosted decision-assistance provenance, present only when hosted advice was consulted (never authority, never a secret). */
  assistance?: { source: "jev"; recommended: string | null; confidence: number | null; action: string; reason: string; answeredBy: string | null; adopted?: { provider_id: ProviderId; model_id: string | null } } | null;
};

const CANDIDATE_CAP = 24;
/** Serializes the safe record from live candidates (caps and trims nothing user-private). */
export function safeDecisionRecord(input: { id: string; taskId: string; missionId: string | null; routingMode: "auto" | "manual"; requirements: TaskRequirements; candidates: RoutingCandidate[]; selection: { selected: RoutingCandidate | null; order: RoutingCandidate[]; reason: string }; policyVersion: string; createdAt: number; reroutes?: number; snapshotProviders?: ModelCapabilityProviderSnapshot[]; usageStatuses?: { provider: ProviderId; status: UsageState }[]; terminalNote?: string; assistance?: RoutingDecisionRecord["assistance"] }): RoutingDecisionRecord {
  const { candidates, selection, snapshotProviders, usageStatuses } = input;
  const cap = (list: RoutingCandidate[]) => list.slice(0, CANDIDATE_CAP).map((candidate) => ({
    provider_id: candidate.provider_id, model_id: candidate.model_id, candidate_kind: candidate.candidate_kind,
    effort_mode: candidate.effort_internal, eligible: candidate.eligibility === "eligible",
    exclusion_reasons: candidate.exclusion_reasons, score: candidate.final_score,
    components: candidate.score_components?.map((component) => ({ name: component.name, points: component.points })) ?? null,
  }));
  return {
    routing_decision_id: input.id, task_id: input.taskId, mission_id: input.missionId,
    policy_version: input.policyVersion, created_at: input.createdAt, routing_mode: input.routingMode,
    classification: { task_class: input.requirements.task_class, evidence: input.requirements.evidence },
    requirements: input.requirements,
    snapshot_references: (snapshotProviders ?? []).map((entry) => ({
      provider: entry.provider, models: entry.models.length, probedThisRun: entry.probedThisRun,
      usage_status: usageStatuses?.find((usage) => usage.provider === entry.provider)?.status ?? null,
    })),
    candidates_considered: cap(candidates),
    selected: selection.selected ? {
      provider_id: selection.selected.provider_id, model_id: selection.selected.model_id,
      candidate_kind: selection.selected.candidate_kind, effort_internal: selection.selected.effort_internal,
      effort_native: selection.selected.effort_native, reason: selection.reason,
    } : null,
    fallback_order: selection.order.slice(0, CANDIDATE_CAP).map((candidate) => ({ provider_id: candidate.provider_id, model_id: candidate.model_id, score: candidate.final_score ?? 0 })),
    reroutes: input.reroutes ?? 0,
    ...(input.terminalNote ? { terminal_note: input.terminalNote } : {}),
    ...(input.assistance ? { assistance: input.assistance } : {}),
  };
}

/** The truthful exhaustion note (T3 §23) with attempted candidates. */
export function exhaustionNote(attempted: { provider_id: ProviderId; model_id: string | null; taxonomy: RoutingFailureTaxonomy }[]): string {
  const list = attempted.map((entry) => `${entry.provider_id}${entry.model_id ? ` · ${entry.model_id}` : " · provider default"} → ${entry.taxonomy}`).join("; ");
  return `all_eligible_models_failed (${list || "no eligible candidates"})`;
}
