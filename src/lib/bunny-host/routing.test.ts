import test from "node:test";
import assert from "node:assert/strict";
import { providerBase } from "./adapters.server.ts";
import { classifyRequirements, effortRequirement, LARGE_CONTEXT_CHARS, type TaskRequirements } from "../orch/router-requirements.ts";
import {
  ADAPTER_TOOL_CONTRACTS,
  PROVIDER_EFFORT_CONTRACTS,
  RECOVERY_BOUNDS,
  ROUTING_POLICY,
  ROUTING_POLICY_VERSION,
  buildCandidates,
  classifyFailure,
  codexCompatibilityFresh,
  exhaustionNote,
  hardExclusions,
  planRecovery,
  preLaunchRevalidate,
  resolveCapability,
  routingProfileFor,
  safeDecisionRecord,
  selectRoutingCandidate,
  type CandidateInput,
  type RoutingCandidate,
  type RoutingFailureTaxonomy,
} from "./routing.server.ts";
import { MODEL_SOURCE_PROVIDERS, type ModelCapabilityProviderSnapshot, type ModelCapabilityRecord } from "./model-capability.server.ts";
import type { ProviderUsageSnapshot, UsageState } from "./provider-usage.server.ts";
import type { ProviderId, ProviderLive } from "../orch/types.ts";

const now = 1_700_000_000_000;
const live = (id: ProviderId, extra: Partial<ProviderLive> = {}): ProviderLive => ({
  ...providerBase(id),
  installed: true,
  authenticated: true,
  authenticatedState: id === "ollama" ? "not_required" : "authenticated",
  availability: "ready",
  capabilities: ["text", "filesystem", "terminal", "git"],
  current_model: null,
  probedAt: now,
  ...extra,
});

const fact = (fields: Record<string, unknown>): ModelCapabilityRecord => ({
  provider: "ollama",
  model: "qwen3:8b",
  local: true,
  toolCalling: null,
  vision: null,
  embedding: null,
  contextWindow: 131_072,
  loaded: null,
  isDefault: null,
  source: "fixture probe",
  probedAt: now,
  evidence: [],
  ...fields,
} as unknown as ModelCapabilityRecord);
const codexFact = (model: string, preferred = false): ModelCapabilityRecord =>
  fact({
    provider: "codex",
    model,
    local: false,
    isDefault: preferred ? true : null,
    source: "codex app-server model/list",
  });
const snapshot = (providers: ModelCapabilityProviderSnapshot[]) => ({ providers });
const ollamaSnapshot = (models: ModelCapabilityRecord[]): ModelCapabilityProviderSnapshot => ({
  provider: "ollama",
  probedThisRun: true,
  probedAt: now,
  models,
});
const codexSnapshot = (models: ModelCapabilityRecord[]): ModelCapabilityProviderSnapshot => ({
  provider: "codex",
  probedThisRun: true,
  probedAt: now,
  models,
});
const usageWindow = (percentUsed: number | null) => ({
  kind: "short",
  limitValue: null,
  usedValue: null,
  remainingValue: null,
  unit: null,
  percentUsed,
  resetAt: null,
  resetDescription: null,
  sourceKind: "provider_native",
  sourceSurface: "fixture",
  confidence: "provider_reported",
  observedAt: now,
  rawValueHash: "f".repeat(64),
});
const usage = (rows: { providerId: ProviderId; status: UsageState; percentUsed?: number | null }[]): { providers: ProviderUsageSnapshot[] } => ({
  providers: rows.map((row) => ({
    providerId: row.providerId,
    name: row.providerId,
    accountScope: null,
    status: row.status,
    observedAt: row.status === "current" || row.status === "stale" ? now : null,
    refreshedAt: now,
    windows: row.percentUsed == null ? [] : [usageWindow(row.percentUsed)],
    note: "",
    localTelemetry: null,
  }) as unknown as ProviderUsageSnapshot),
});

const research = classifyRequirements({ prompt: "Summarize the tradeoffs of two approaches", mode: "balanced" });
const fileTask = 'Create hello.py containing print("BUNNY_ROUTE_OK"). Run the script and verify stdout.';
const withComplexity = (prompt: string, reasoning: TaskRequirements["reasoning_complexity"]): TaskRequirements => ({
  ...classifyRequirements({ prompt, mode: "balanced" }),
  reasoning_complexity: reasoning,
});
const baseInput = (overrides: Partial<CandidateInput> = {}): CandidateInput => ({
  providers: [live("claude"), live("codex")],
  modelSnapshot: snapshot([]),
  usage: { providers: [] },
  requirements: research,
  constraints: {},
  override: "auto",
  mode: "balanced",
  ...overrides,
});
const claudeOf = (candidates: RoutingCandidate[]) => candidates.find((candidate) => candidate.provider_id === "claude")!;
const codexOf = (candidates: RoutingCandidate[]) => candidates.find((candidate) => candidate.provider_id === "codex")!;
const pointsFor = (candidate: RoutingCandidate, name: string) => candidate.score_components!.find((component) => component.name === name)!.points;

// ── §6 classifier ────────────────────────────────────────────────────────────
test("T3 §6/§26: classification is deterministic; ambiguity stays conservative with UNKNOWN privacy", () => {
  assert.deepEqual(research, classifyRequirements({ prompt: "Summarize the tradeoffs of two approaches", mode: "balanced" }), "the same prompt classifies identically (§26)");
  assert.equal(research.task_class, "research");
  assert.equal(research.privacy_requirement, "unknown", "no signal → UNKNOWN, never invented");
  assert.equal(research.reasoning_complexity, "HIGH", "tradeoff phrasing is a soft HIGH reasoning signal");
  const tools = classifyRequirements({ prompt: "Restart the service and report status", constraints: {} });
  assert.equal(tools.task_class, "tool_execution");
  assert.equal(tools.needs_tools, true);
  assert.ok(tools.evidence.some((reason) => /command\/tool execution/.test(reason)));
  const repo = classifyRequirements({ prompt: "Fix the failing test suite in src/", constraints: {} });
  assert.equal(repo.task_class, "repository_coding");
  assert.ok(repo.evidence.some((evidence) => /Repository/.test(evidence)));
  assert.equal(classifyRequirements({ prompt: "Calculate the derivation", constraints: {} }).task_class, "math");
  const vision = classifyRequirements({ prompt: "Describe this screenshot", constraints: {} });
  assert.equal(vision.task_class, "vision");
  assert.equal(vision.needs_vision, true);
  const privacy = classifyRequirements({ prompt: "Keep everything local on this machine", constraints: {} });
  assert.equal(privacy.task_class, "general", "privacy alone does not invent a capability class");
  assert.equal(privacy.privacy_requirement, "local_only");
  assert.ok(privacy.required_capabilities.includes("privacy_local"));
  assert.ok(privacy.evidence.some((evidence) => /matched/.test(evidence)));
});
test("T3 §6: a giant prompt makes large context a sized hard requirement; plainer prompts never do", () => {
  const prompt = `${"x".repeat(LARGE_CONTEXT_CHARS)} summarize`;
  const huge = classifyRequirements({ prompt, constraints: {} });
  assert.equal(huge.needs_large_context, true);
  assert.equal(huge.estimated_context_requirement, prompt.length);
  assert.ok(huge.required_capabilities.includes("large_context"));
  assert.ok(huge.evidence.some((evidence) => /characters/.test(evidence)));
  const small = classifyRequirements({ prompt: "short prompt", constraints: {} });
  assert.equal(small.needs_large_context, false);
  assert.equal(small.estimated_context_requirement, null, "no explicit need stays UNKNOWN, not a zero");
});
// ── §11 effort ───────────────────────────────────────────────────────────────
test("T3 §11: effort normalizes, fast trims, deep bumps only LOW", () => {
  for (const level of ["LOW", "MEDIUM", "HIGH", "MAX"] as const) assert.equal(effortRequirement({ reasoning_complexity: level }), level);
  assert.equal(effortRequirement({ reasoning_complexity: "MAX" }, "fast"), "HIGH", "fast never runs MAX effort");
  assert.equal(effortRequirement({ reasoning_complexity: "HIGH" }, "fast"), "MEDIUM");
  assert.equal(effortRequirement({ reasoning_complexity: "LOW" }, "fast"), "LOW", "fast does not escalate");
  assert.equal(effortRequirement({ reasoning_complexity: "LOW" }, "deep"), "MEDIUM");
  assert.equal(effortRequirement({ reasoning_complexity: "MEDIUM" }, "deep"), "MEDIUM", "deep bumps only LOW");
});
test("T3 §11/R03/R04: codex gets its native knob; simple work never consumes MAX", () => {
  const catalogue = codexSnapshot([codexFact("gpt-5.3", true)]);
  const simple = buildCandidates(baseInput({
    providers: [live("codex")],
    modelSnapshot: snapshot([catalogue]),
    requirements: classifyRequirements({ prompt: "Say hello in one sentence", mode: "balanced" }),
  }));
  assert.equal(simple[0].effort_internal, "LOW");
  assert.equal(simple[0].effort_native, "low");
  const hard = buildCandidates(baseInput({
    providers: [live("codex")],
    modelSnapshot: snapshot([catalogue]),
    requirements: withComplexity("Reason carefully about this", "MAX"),
  }));
  assert.equal(hard[0].effort_internal, "MAX");
  assert.equal(hard[0].effort_native, "xhigh");
});
test("T3 §11/R03: providers without a real effort contract stay PROVIDER_DEFAULT — never a fabricated knob", () => {
  for (const [provider, contract] of Object.entries(PROVIDER_EFFORT_CONTRACTS) as [ProviderId, (typeof PROVIDER_EFFORT_CONTRACTS)[ProviderId]][]) {
    assert.equal(contract.supported, provider === "codex");
    if (provider === "codex") assert.deepEqual(contract.native, { LOW: "low", MEDIUM: "medium", HIGH: "high", MAX: "xhigh" });
    else assert.equal(contract.native, null);
  }
  const candidates = buildCandidates(baseInput({ providers: [live("claude")] }));
  for (const candidate of candidates) assert.equal(candidate.effort_internal, "PROVIDER_DEFAULT");
});
// ── §8 filter then score ─────────────────────────────────────────────────────
test("T3 §8: UNKNOWN under a hard requirement excludes; a verified adapter no is terminal; a verified contract yes satisfies", () => {
  // An adapter-less provider: tools facts are UNKNOWN → the hard requirement honestly excludes.
  const unknownTools = buildCandidates(baseInput({
    providers: [live("opencode")],
    requirements: classifyRequirements({ prompt: fileTask, constraints: {} }),
  }));
  assert.ok(unknownTools.length >= 1);
  assert.ok(unknownTools.every((candidate) => candidate.eligibility === "excluded"));
  assert.ok(unknownTools[0].exclusion_reasons.some((reason) => /is UNKNOWN for this candidate and the requirement is hard/.test(reason)));
  // Ollama model metadata (even toolCalling true) cannot route tool work into a single-shot adapter (§8).
  const ollamaYes = buildCandidates(baseInput({
    providers: [live("ollama")],
    modelSnapshot: snapshot([ollamaSnapshot([fact({ model: "qwen3:8b", toolCalling: true })])]),
    requirements: classifyRequirements({ prompt: fileTask, constraints: {} }),
  }));
  assert.ok(ollamaYes[0].exclusion_reasons.some((reason) => /cannot make tool calls/.test(reason)));
  const ollamaNo = buildCandidates(baseInput({
    providers: [live("ollama")],
    modelSnapshot: snapshot([ollamaSnapshot([fact({ model: "qwen3:8b", toolCalling: false })])]),
    requirements: classifyRequirements({ prompt: fileTask, constraints: {} }),
  }));
  assert.ok(ollamaNo[0].exclusion_reasons.some((reason) => /cannot make tool calls/.test(reason)));
  // Claude's verified adapter contract (MA2 live sessions) satisfies tools without model facts (§9/R18).
  const claudeDefault = buildCandidates(baseInput({
    providers: [live("claude")],
    requirements: classifyRequirements({ prompt: fileTask, constraints: {} }),
  }));
  assert.equal(claudeDefault.length, 1);
  assert.equal(claudeDefault[0].candidate_kind, "PROVIDER_DEFAULT");
  assert.equal(claudeDefault[0].eligibility, "eligible");
  assert.equal(claudeDefault[0].model_id, null);
  const toolsProof = claudeDefault[0].observed_capabilities.find((capability) => capability.name === "tools");
  assert.equal(toolsProof?.value, true);
  assert.equal(toolsProof?.provenance, "adapter_contract");
});
test("T3 §8/R09/R10: local-only and cloud-only constraints exclude on every other candidate with a reason", () => {
  const localCandidates = buildCandidates(baseInput({
    providers: [live("ollama", { models: ["qwen3:8b", "cloud-bridge:8b"] })],
    modelSnapshot: snapshot([ollamaSnapshot([fact({ model: "qwen3:8b" }), fact({ model: "cloud-bridge:8b", local: false })])]),
    constraints: { localOnly: true },
    requirements: classifyRequirements({ prompt: "Summarize", constraints: { localOnly: true } }),
  }));
  assert.equal(localCandidates.find((candidate) => candidate.model_id === "qwen3:8b")?.eligibility, "eligible", "the truly local candidate survives a local-only constraint");
  const cloudOut = localCandidates.find((candidate) => candidate.model_id === "cloud-bridge:8b")!;
  assert.ok(cloudOut.exclusion_reasons.some((reason) => /User constraint: local only/.test(reason)));
  assert.ok(cloudOut.exclusion_reasons.some((reason) => /Privacy requirement|leaves the machine/.test(reason)));
  for (const providerId of ["claude", "codex"] as ProviderId[]) {
    const reasons = hardExclusions({
      provider: live(providerId),
      record: null,
      candidateKind: "PROVIDER_DEFAULT",
      requirements: classifyRequirements({ prompt: "Summarize", constraints: { localOnly: true } }),
      constraints: { localOnly: true },
    });
    assert.ok(reasons.some((reason) => /Requires local execution|User constraint: local only/.test(reason)), `${providerId} is not routable under a local-only constraint`);
  }
  assert.deepEqual(hardExclusions({
    provider: live("claude"),
    record: null,
    candidateKind: "PROVIDER_DEFAULT",
    requirements: classifyRequirements({ prompt: "Summarize", constraints: { cloudOnly: true } }),
    constraints: { cloudOnly: true },
  }), [], "a cloud provider serves a cloud-only task");
  const offlineOnly = hardExclusions({
    provider: live("claude"),
    record: null,
    candidateKind: "PROVIDER_DEFAULT",
    requirements: classifyRequirements({ prompt: "Summarize", constraints: { offlineOnly: true } }),
    constraints: { offlineOnly: true },
  });
  assert.ok(offlineOnly.length >= 1, "an offline-only requirement excludes every cloud provider (R10)");
});
test("T3 §8/R16: an unavailable or unauthenticated provider is excluded, never scored; a small context window excludes", () => {
  for (const extra of [{ availability: "offline" as const }, { authenticated: false, authenticatedState: "not_authenticated" as const }]) {
    const candidates = buildCandidates(baseInput({
      providers: [live("codex", extra)],
      modelSnapshot: snapshot([codexSnapshot([codexFact("gpt-5.3", true)])]),
    }));
    assert.ok(candidates.every((candidate) => candidate.eligibility === "excluded"));
  }
  const smallContext = buildCandidates(baseInput({
    providers: [live("ollama")],
    modelSnapshot: snapshot([ollamaSnapshot([fact({ model: "tiny", contextWindow: 4_096 })])]),
    requirements: classifyRequirements({ prompt: "x".repeat(200_000), constraints: {} }),
  }));
  assert.ok(smallContext[0].exclusion_reasons.some((reason) => /context window/.test(reason)));
});
test("T3 §27/R19/R20: exact-model pins filter; pins the provider surface cannot honor say so", () => {
  const pinned = buildCandidates(baseInput({
    providers: [live("codex")],
    modelSnapshot: snapshot([codexSnapshot([codexFact("gpt-5.3-codex", true), codexFact("gpt-5.3")])]),
    constraints: { modelExact: "gpt-5.3" },
    requirements: classifyRequirements({ prompt: "Fix the bug", constraints: {} }),
  }));
  assert.equal(pinned.filter((candidate) => candidate.eligibility === "eligible").length, 1, "the pin keeps only the exact model");
  assert.equal(pinned.find((candidate) => candidate.eligibility === "eligible")?.model_id, "gpt-5.3");
  assert.ok(pinned.find((candidate) => candidate.model_id === "gpt-5.3-codex")?.exclusion_reasons.some((reason) => /different exact model/.test(reason)));
  const claudePinned = buildCandidates(baseInput({
    providers: [live("claude")],
    constraints: { modelExact: "claude-5-thinking" },
    requirements: classifyRequirements({ prompt: "Fix the bug", constraints: {} }),
  }));
  assert.ok(claudePinned[0].exclusion_reasons.some((reason) => /no model-selection surface \(§9\), so the pin cannot be honored/.test(reason)));
  const claudeOverride = buildCandidates(baseInput({
    providers: [live("claude")],
    modelOverride: "claude-5-thinking",
    requirements: classifyRequirements({ prompt: "Fix the bug", constraints: {} }),
  }));
  assert.ok(claudeOverride[0].exclusion_reasons.some((reason) => /Manual selection targets a different model/.test(reason)));
});
// ── §10 listing truth ────────────────────────────────────────────────────────
test("T3 §10: discovered-model candidates come only from providers with real listing probes", () => {
  assert.deepEqual(MODEL_SOURCE_PROVIDERS, ["ollama", "codex"], "only these providers have a real model-listing probe (T1)");
  const candidates = buildCandidates(baseInput({
    providers: [live("claude"), live("codex")],
    modelSnapshot: snapshot([codexSnapshot([codexFact("gpt-5.3")])]),
  }));
  assert.equal(candidates.length, 2, "codex's one listed model plus claude's provider default");
  assert.equal(candidates.filter((candidate) => candidate.candidate_kind === "DISCOVERED_MODEL").length, 1);
  assert.equal(candidates.find((candidate) => candidate.provider_id === "codex")?.model_id, "gpt-5.3");
  assert.equal(candidates.find((candidate) => candidate.provider_id === "claude")?.model_id, null);
  // A fact-less listing provider yields NO candidates rather than invented ones (§9).
  const empty = buildCandidates(baseInput({
    providers: [live("claude"), live("ollama")],
    modelSnapshot: snapshot([]),
  }));
  assert.ok(empty.every((candidate) => candidate.provider_id !== "ollama"));
});
// ── §12/§13/§26 scoring, default policy, determinism ─────────────────────────
test("T3 §12/R32: scoring is versioned, decomposed into finite inspectable components, and byte-deterministic", () => {
  const input = baseInput({
    providers: [live("claude"), live("codex")],
    modelSnapshot: snapshot([codexSnapshot([codexFact("gpt-5.3-codex", true), codexFact("gpt-5.3")])]),
  });
  const first = buildCandidates(input);
  const again = buildCandidates(structuredClone(input));
  assert.deepEqual(first.map((candidate) => candidate.final_score), again.map((candidate) => candidate.final_score));
  for (const candidate of first) {
    assert.ok(candidate.score_components?.every((component) => Number.isFinite(component.points)));
    assert.ok(Number.isFinite(candidate.final_score!));
  }
  const weights = Object.values(ROUTING_POLICY.weights) as number[];
  assert.equal(weights.reduce((sum, weight) => sum + weight, 0), 100);
});
test("T3 §13/R01/R02: the catalogue default wins only when actually best — never by being the default", () => {
  const researchCandidates = buildCandidates(baseInput({
    providers: [live("claude"), live("codex")],
    modelSnapshot: snapshot([codexSnapshot([codexFact("gpt-5.3-codex", true)])]),
  }));
  const researchSelection = selectRoutingCandidate({ candidates: researchCandidates, requirements: research });
  assert.ok(claudeOf(researchCandidates).final_score! > codexOf(researchCandidates).final_score!, "the catalogue default does not beat a ranked-higher provider default");
  assert.equal(researchSelection.selected?.provider_id, "claude");
  const codingRequirements = classifyRequirements({ prompt: "Fix the failing test suite in src/", constraints: {} });
  const codingCandidates = buildCandidates(baseInput({
    providers: [live("claude"), live("codex")],
    modelSnapshot: snapshot([codexSnapshot([codexFact("gpt-5.3-codex", true)])]),
    requirements: codingRequirements,
  }));
  const codingSelection = selectRoutingCandidate({ candidates: codingCandidates, requirements: codingRequirements });
  assert.ok(codexOf(codingCandidates).final_score! > claudeOf(codingCandidates).final_score!, "the same policy flips toward codex for coding");
  assert.equal(codingSelection.selected?.provider_id, "codex");
});
test("T3 §13/§26: exact ties break to the catalogue default, then display order, then model id — never randomness", () => {
  const taggedInput = baseInput({
    providers: [live("ollama")],
    modelSnapshot: snapshot([ollamaSnapshot([
      fact({ model: "zeta:8b", isDefault: true }),
      fact({ model: "alpha:8b" }),
    ])]),
  });
  const tagged = selectRoutingCandidate({ candidates: buildCandidates(taggedInput), requirements: research });
  assert.equal(tagged.selected?.model_id, "zeta:8b", "the catalogue-default tag wins an exact tie before other tie-breaks");
  const plainInput = baseInput({
    providers: [live("codex")],
    modelSnapshot: snapshot([codexSnapshot([codexFact("gpt-5.3-codex"), codexFact("gpt-5.3")])]),
  });
  const plain = selectRoutingCandidate({ candidates: buildCandidates(plainInput), requirements: research });
  assert.equal(plain.selected?.model_id, "gpt-5.3", "localeCompare breaks a tagless exact tie deterministically (§26)");
  assert.deepEqual(
    selectRoutingCandidate({ candidates: buildCandidates(structuredClone(plainInput)), requirements: research }).order.map((candidate) => candidate.model_id),
    plain.order.map((candidate) => candidate.model_id),
  );
});
test("T3 §7: routing profiles are Bunny policy priors (POLICY_DEFAULT), never provider-reported", () => {
  const profile = routingProfileFor("claude", null, "PROVIDER_DEFAULT");
  assert.equal(profile.provenance, "POLICY_DEFAULT");
  assert.ok(/not a provider-reported ranking/.test(profile.note ?? ""));
  const codexProfile = routingProfileFor("codex", codexFact("gpt-5.3-codex", true), "DISCOVERED_MODEL");
  assert.ok(codexProfile.specialization_tags.includes("catalogue-default"));
  const localProfile = routingProfileFor("ollama", fact({ model: "qwen3:8b" }), "DISCOVERED_MODEL");
  assert.ok(localProfile.specialization_tags.includes("local"));
});
// ── §14 usage truth ──────────────────────────────────────────────────────────
test("T3 §14/R13/R14/R15: current usage ranks, stale halves, UNKNOWN is neutral, refusal excludes", () => {
  const catalogue = codexSnapshot([codexFact("gpt-5.3", true)]);
  const plain = buildCandidates(baseInput({
    providers: [live("claude"), live("codex")],
    modelSnapshot: snapshot([catalogue]),
  }));
  assert.equal(claudeOf(plain).usage_quality, "unknown");
  assert.equal(pointsFor(claudeOf(plain), "usage"), pointsFor(codexOf(plain), "usage"), "UNKNOWN usage is exactly neutral for everyone (R14)");
  const pressure = buildCandidates(baseInput({
    providers: [live("claude"), live("codex")],
    modelSnapshot: snapshot([catalogue]),
    usage: usage([{ providerId: "claude", status: "current", percentUsed: 5 }, { providerId: "codex", status: "current", percentUsed: 98 }]),
  }));
  assert.equal(claudeOf(pressure).usage_quality, "current");
  assert.equal(codexOf(pressure).usage_quality, "current");
  assert.ok(pointsFor(claudeOf(pressure), "usage") > pointsFor(codexOf(pressure), "usage"), "current low pressure out-ranks current high pressure (R13)");
  assert.ok(claudeOf(pressure).final_score! > codexOf(pressure).final_score!);
  const stale = buildCandidates(baseInput({
    providers: [live("claude"), live("codex")],
    modelSnapshot: snapshot([catalogue]),
    usage: usage([{ providerId: "claude", status: "stale", percentUsed: 5 }]),
  }));
  assert.equal(claudeOf(stale).usage_quality, "stale");
  assert.ok(pointsFor(claudeOf(stale), "usage") < pointsFor(claudeOf(plain), "usage"), "stale usage loses influence but keeps direction (R15)");
  assert.ok(pointsFor(claudeOf(pressure), "usage") > pointsFor(claudeOf(stale), "usage"));
  const estimated = buildCandidates(baseInput({
    providers: [live("claude")],
    usage: usage([{ providerId: "claude", status: "estimated" }]),
  }));
  assert.equal(estimated[0].usage_quality, "estimated");
  assert.equal(pointsFor(estimated[0], "usage"), 5, "ESTIMATED usage is the documented soft preference");
  const refused = hardExclusions({
    provider: live("claude", { availability: "rate_limited", usage_note: "Usage limit reached; resets soon." }),
    record: null,
    candidateKind: "PROVIDER_DEFAULT",
    requirements: research,
    constraints: {},
  });
  assert.ok(refused.some((reason) => /rate|usage limit/i.test(reason)), "an honest usage refusal is excluded at eligibility, never scored as a cost");
});
// ── §17 pre-launch revalidation ──────────────────────────────────────────────
test("T3 §17/R17: cached discovery is not launch authority, and registry absence is UNKNOWN — not emptiness", () => {
  const present = snapshot([ollamaSnapshot([fact({ model: "qwen3:8b" })])]);
  const ollama = live("ollama", { models: ["qwen3:8b"] });
  assert.deepEqual(
    preLaunchRevalidate({ provider_id: "ollama", model_id: "qwen3:8b", candidate_kind: "DISCOVERED_MODEL" }, [ollama], present, {}, now),
    { ok: true },
  );
  const gone = preLaunchRevalidate({ provider_id: "ollama", model_id: "gone:8b", candidate_kind: "DISCOVERED_MODEL" }, [ollama], present, {}, now);
  assert.equal(gone.ok, false);
  assert.match(gone.ok ? "" : gone.reason, /no longer verified as listed/);
  // Facts absent from the registry is UNKNOWN → pass with the adapter's launch gate as backstop (§17).
  assert.deepEqual(
    preLaunchRevalidate({ provider_id: "ollama", model_id: "unprobed:8b", candidate_kind: "DISCOVERED_MODEL" }, [ollama], snapshot([]), {}, now),
    { ok: true },
  );
  // Provider-level truth still refuses: offline, unknown.
  assert.equal(preLaunchRevalidate({ provider_id: "ollama", model_id: null, candidate_kind: "PROVIDER_DEFAULT" }, [live("ollama", { availability: "offline" })], present, {}, now).ok, false);
  assert.equal(preLaunchRevalidate({ provider_id: "unknown-provider" as ProviderId, model_id: null, candidate_kind: "PROVIDER_DEFAULT" }, [ollama], present, {}, now).ok, false);
  // The default pick of a ready provider passes; a local-only constraint with a cloud provider does not.
  assert.deepEqual(preLaunchRevalidate({ provider_id: "ollama", model_id: null, candidate_kind: "PROVIDER_DEFAULT" }, [ollama], present, {}, now), { ok: true });
  assert.equal(
    preLaunchRevalidate({ provider_id: "claude", model_id: null, candidate_kind: "PROVIDER_DEFAULT" }, [live("claude")], present, { localOnly: true }, now).ok,
    false,
  );
});
test("T3 §17/§34: codex compatibility freshness is a pre-launch gate; absent profile stays UNKNOWN for the adapter's own gate", () => {
  const profile = (checkedAt: number) => ({
    policyVersion: 1,
    compatibilityClass: "VALIDATED",
    reason: "fixture",
    checkedAt,
    validatedAt: checkedAt,
    evidenceSource: "fixture",
    executable: null,
    versionRaw: null,
    versionParsed: null,
    validatedAgainstVersion: null,
    registryEntry: null,
    supportsSandboxReadOnly: true,
    supportsSandboxWorkspaceWrite: true,
    supportsIgnoreUserConfig: true,
    supportsIgnoreRules: true,
    supportsConfigOverride: true,
    supportsWindowsSandboxElevated: true,
    disabledFeaturesVerified: true,
    readIsolationValidated: true,
    writeIsolationValidated: true,
    connectorIsolationValidated: true,
    pluginIsolationValidated: true,
    mcpIsolationValidated: true,
  });
  const fresh = live("codex", { securityCompatibility: profile(now - 60_000) as ProviderLive["securityCompatibility"] });
  assert.equal(codexCompatibilityFresh(fresh, now).ok, true);
  const stale = codexCompatibilityFresh(live("codex", { securityCompatibility: profile(now - 11 * 60_000) as ProviderLive["securityCompatibility"] }), now);
  assert.equal(stale.ok, false, "stale compatibility evidence refuses at the launch gate");
  assert.match(stale.reason ?? "", /stale/);
  assert.equal(codexCompatibilityFresh(live("codex"), now).ok, true, "absence is UNKNOWN: the untouched MA2 adapter gate remains the authority");
  assert.equal(codexCompatibilityFresh(live("claude"), now).ok, true);
});
// ── §21 taxonomy ─────────────────────────────────────────────────────────────
test("T3 §21: every failure signature classifies into exactly one taxonomy; the default stays EXECUTION_FAILED", () => {
  const cases: [string, RoutingFailureTaxonomy][] = [
    ["timed out while streaming", "TRANSIENT_TRANSPORT"],
    ["socket hang up", "TRANSIENT_TRANSPORT"],
    ["ECONNREFUSED localhost:11434", "PROVIDER_UNAVAILABLE"],
    ["Selected model gone:8b is no longer available", "MODEL_UNAVAILABLE"],
    ["usage limit reached (429)", "QUOTA_CONSTRAINED"],
    ["context window exceeded", "CONTEXT_OVERFLOW"],
    ["tool not supported by this endpoint", "TOOL_UNSUPPORTED"],
    ["capability mismatch during a run", "CAPABILITY_MISMATCH"],
    ["I can't help with that request", "PROVIDER_REFUSAL"],
    ["unexpected end of json input", "MALFORMED_RESULT"],
    ["everything else", "EXECUTION_FAILED"],
  ];
  for (const [error, taxonomy] of cases) assert.equal(classifyFailure({ error, exitCode: 1 }), taxonomy, error);
  assert.equal(classifyFailure({ verificationFailed: true, error: "Bunny-A verification failed: missing file", exitCode: 1 }), "VERIFICATION_FAILED");
  assert.equal(classifyFailure({ policyDenied: true, error: "whatever else", exitCode: 1 }), "POLICY_DENIED");
  assert.equal(classifyFailure({ stopped: true, exitCode: null }), "EXECUTION_FAILED");
  assert.equal(classifyFailure({ exitCode: 0 }), "EXECUTION_FAILED", "no signal stays conservative");
  assert.equal(classifyFailure({ usageLimitStatus: "rejected", error: "provider said no", exitCode: 1 }), "QUOTA_CONSTRAINED");
});
// ── §22/§23/§24/§25 bounded recovery ─────────────────────────────────────────
test("T3 §22/§23/§25/R36: recovery is taxonomy-driven, bounded, and exhaustion is truthful", () => {
  assert.equal(planRecovery({ taxonomy: "TRANSIENT_TRANSPORT", attemptIndex: 0, sameRetriesUsed: 0, alternatesUsed: 0, escalationsUsed: 0, reroutesUsed: 0 }).action, "retry-same");
  assert.equal(planRecovery({ taxonomy: "TRANSIENT_TRANSPORT", attemptIndex: 1, sameRetriesUsed: 1, alternatesUsed: 0, escalationsUsed: 0, reroutesUsed: 0 }).action, "reroute");
  assert.equal(planRecovery({ taxonomy: "TRANSIENT_TRANSPORT", attemptIndex: 2, sameRetriesUsed: 1, alternatesUsed: 1, escalationsUsed: 0, reroutesUsed: 1 }).action, "reroute");
  const exhausted = planRecovery({ taxonomy: "TRANSIENT_TRANSPORT", attemptIndex: 3, sameRetriesUsed: 1, alternatesUsed: 2, escalationsUsed: 0, reroutesUsed: 2 });
  assert.equal(exhausted.action, "fail");
  assert.match(exhausted.reason, /all_eligible_models_failed/);
  assert.equal(planRecovery({ taxonomy: "MALFORMED_RESULT", attemptIndex: 0, sameRetriesUsed: 0, alternatesUsed: 0, escalationsUsed: 0, reroutesUsed: 0 }).action, "retry-same");
  assert.equal(planRecovery({ taxonomy: "MALFORMED_RESULT", attemptIndex: 1, sameRetriesUsed: 1, alternatesUsed: 0, escalationsUsed: 0, reroutesUsed: 0 }).action, "fail");
  for (const taxonomy of ["PROVIDER_UNAVAILABLE", "MODEL_UNAVAILABLE", "QUOTA_CONSTRAINED", "CONTEXT_OVERFLOW", "CAPABILITY_MISMATCH", "TOOL_UNSUPPORTED"] as RoutingFailureTaxonomy[]) {
    const first = planRecovery({ taxonomy, attemptIndex: 0, sameRetriesUsed: 0, alternatesUsed: 0, escalationsUsed: 0, reroutesUsed: 0 });
    assert.equal(first.action, taxonomy === "CONTEXT_OVERFLOW" ? "reroute-larger-context" : "reroute", taxonomy);
    assert.equal(
      planRecovery({ taxonomy, attemptIndex: 3, sameRetriesUsed: 0, alternatesUsed: RECOVERY_BOUNDS.alternates, escalationsUsed: 0, reroutesUsed: RECOVERY_BOUNDS.alternates }).action,
      "fail",
      taxonomy,
    );
  }
  assert.equal(planRecovery({ taxonomy: "PROVIDER_REFUSAL", attemptIndex: 0, sameRetriesUsed: 0, alternatesUsed: 0, escalationsUsed: 0, reroutesUsed: 0, policyAllows: false }).action, "fail");
  assert.equal(planRecovery({ taxonomy: "PROVIDER_REFUSAL", attemptIndex: 0, sameRetriesUsed: 0, alternatesUsed: 0, escalationsUsed: 0, reroutesUsed: 0, policyAllows: true }).action, "reroute");
  assert.equal(planRecovery({ taxonomy: "POLICY_DENIED", attemptIndex: 0, sameRetriesUsed: 0, alternatesUsed: 0, escalationsUsed: 0, reroutesUsed: 0 }).action, "fail");
  assert.equal(planRecovery({ taxonomy: "EXECUTION_FAILED", attemptIndex: 0, sameRetriesUsed: 0, alternatesUsed: 0, escalationsUsed: 0, reroutesUsed: 0 }).action, "fail");
  assert.equal(planRecovery({ taxonomy: "VERIFICATION_FAILED", attemptIndex: 0, sameRetriesUsed: 0, alternatesUsed: 0, escalationsUsed: 0, reroutesUsed: 0 }).action, "escalate-effort");
  assert.equal(planRecovery({ taxonomy: "VERIFICATION_FAILED", attemptIndex: 1, sameRetriesUsed: 0, alternatesUsed: 0, escalationsUsed: 1, reroutesUsed: 0 }).action, "fail");
  assert.equal(planRecovery({ taxonomy: "MODEL_UNAVAILABLE", attemptIndex: RECOVERY_BOUNDS.maxAttempts, sameRetriesUsed: 0, alternatesUsed: 0, escalationsUsed: 0, reroutesUsed: 0 }).action, "fail", "the attempt bound dominates every counter");
});
test("T3 §23: the exhaustion note names every attempted candidate and the failure truth", () => {
  assert.match(
    exhaustionNote([
      { provider_id: "codex", model_id: "gpt-5.3-codex", taxonomy: "QUOTA_CONSTRAINED" },
      { provider_id: "claude", model_id: null, taxonomy: "EXECUTION_FAILED" },
    ]),
    /^all_eligible_models_failed \(codex · gpt-5\.3-codex → QUOTA_CONSTRAINED; claude · provider default → EXECUTION_FAILED\)$/,
  );
  assert.match(exhaustionNote([]), /no eligible candidates/);
});
// ── §18 safe decision record ─────────────────────────────────────────────────
test("T3 §18/R34: the safe record carries no prompt text or secrets, caps candidates at 24, and trims every component to name+points", () => {
  const secretPrompt = "MAGENTA-SECRET-VALUE summarize the tradeoffs of two approaches";
  const requirements = classifyRequirements({ prompt: secretPrompt, mode: "balanced" });
  const thirty = Array.from({ length: 30 }, (_unused, index) => fact({ model: `model-${String(index).padStart(2, "0")}:8b` }));
  const candidates = buildCandidates(baseInput({
    providers: [live("ollama")],
    modelSnapshot: snapshot([ollamaSnapshot(thirty)]),
    requirements,
  }));
  assert.equal(candidates.length, 30);
  const selection = selectRoutingCandidate({ candidates, requirements });
  const record = safeDecisionRecord({
    id: "routing-test-record",
    taskId: "task-1",
    missionId: null,
    routingMode: "auto",
    requirements,
    candidates,
    selection,
    policyVersion: ROUTING_POLICY_VERSION,
    createdAt: now,
    snapshotProviders: [{ provider: "ollama", probedThisRun: true, probedAt: now, models: thirty }],
    usageStatuses: [],
  });
  const serialized = JSON.stringify(record);
  assert.ok(!serialized.includes("MAGENTA-SECRET-VALUE"), "prompt text never enters the persisted record");
  assert.equal(record.candidates_considered.length, 24, "CANDIDATE_CAP is 24 (§18)");
  assert.ok(record.candidates_considered.every((candidate) => (candidate.components ?? []).every((component) => !("detail" in component))), "component details stay display-only");
  assert.ok(record.candidates_considered.every((candidate) => candidate.score != null || candidate.eligible === false));
  assert.equal(record.selected?.reason, selection.reason);
  assert.equal(record.fallback_order.length, 24);
  assert.equal(record.snapshot_references[0].models, 30);
  assert.equal(record.policy_version, ROUTING_POLICY_VERSION);
  const exhaustedRecord = safeDecisionRecord({
    id: "routing-exhausted",
    taskId: "task-2",
    missionId: null,
    routingMode: "auto",
    requirements,
    candidates: [],
    selection: selectRoutingCandidate({ candidates: [], requirements }),
    policyVersion: ROUTING_POLICY_VERSION,
    createdAt: now,
    terminalNote: exhaustionNote([{ provider_id: "codex", model_id: "gpt-5.3-codex", taxonomy: "QUOTA_CONSTRAINED" }]),
  });
  assert.equal(exhaustedRecord.selected, null);
  assert.deepEqual(exhaustedRecord.fallback_order, []);
  assert.match(exhaustedRecord.terminal_note ?? "", /all_eligible_models_failed/);
});
// ── §34 adapter tool contracts stay the MA2-verified truth ───────────────────
test("T3 §34: the adapter tool contract table matches the verified execution surfaces", () => {
  assert.deepEqual(ADAPTER_TOOL_CONTRACTS, { codex: true, claude: true, ollama: false });
  assert.equal(resolveCapability("ollama", fact({ model: "qwen3:8b", toolCalling: true }), "tools").provenance, "adapter_contract", "an adapter CANNOT is terminal, even against model metadata");
  assert.equal(resolveCapability("ollama", fact({ model: "qwen3:8b", toolCalling: true }), "tools").value, false);
  assert.equal(resolveCapability("codex", null, "tools").value, true);
  assert.equal(resolveCapability("unknown-provider" as ProviderId, null, "tools").value, null, "UNKNOWN stays UNKNOWN");
});
test("T13.3 F §17: owner priority reorders eligible candidates only; balanced leaves the baseline untouched", () => {
  const light = classifyRequirements({ prompt: "Say hello in one sentence", mode: "balanced" });
  const input = (priority?: CandidateInput["priority"]) => baseInput({
    providers: [live("claude"), live("ollama", { models: ["qwen3:8b"] })],
    modelSnapshot: snapshot([ollamaSnapshot([fact({ model: "qwen3:8b" })])]),
    requirements: light,
    ...(priority ? { priority } : {}),
  });
  const pick = (priority?: CandidateInput["priority"]) => selectRoutingCandidate({ candidates: buildCandidates(input(priority)), requirements: light }).selected?.provider_id;
  const baseline = buildCandidates(input());
  assert.deepEqual(buildCandidates(input("balanced")).map((c) => [c.provider_id, c.final_score]), baseline.map((c) => [c.provider_id, c.final_score]), "balanced adds nothing");
  assert.ok(baseline.every((c) => !c.score_components?.some((component) => component.name === "priority")));
  assert.equal(pick("minimize_cost"), "ollama", "lightweight work prefers the free local model when cost matters");
  const cost = buildCandidates(input("minimize_cost"));
  assert.equal(pointsFor(cost.find((c) => c.provider_id === "claude")!, "priority"), 0, "a cloud plan is never assumed free");
  const quality = buildCandidates(input("prioritize_quality"));
  assert.ok(pointsFor(quality.find((c) => c.provider_id === "claude")!, "priority") > pointsFor(quality.find((c) => c.provider_id === "ollama")!, "priority"));
  // A priority never makes an ineligible candidate eligible.
  const heavy: TaskRequirements = { ...withComplexity("Refactor the repository and run the full test suite", "MAX"), needs_tools: true };
  const toolsNeeded = buildCandidates({ ...input("minimize_cost"), requirements: heavy });
  assert.ok(toolsNeeded.filter((c) => c.provider_id === "ollama").every((c) => c.eligibility !== "eligible"), "cost preference cannot route tool work to a tool-less model");
  assert.equal(selectRoutingCandidate({ candidates: toolsNeeded, requirements: heavy }).selected?.provider_id, "claude", "heavy tool work still selects the stronger authorized provider");
});
