/**
 * M-A-3 Gate T3 §32: the complete adversarial routing matrix R01–R36.
 *
 * Every row is one test. Rows exercise the routing pipeline's pure surface
 * (classify → filter → score → select → revalidate → classify failure →
 * bounded recovery → safe record); the live manager-level twins of R22/R24/
 * R29/R30/R31/R32 run in t3-manager.test.ts against the real TaskManager.
 * The final test writes the row index as routing-matrix.json plus the
 * versioned routing policy as routing-policy.json into test-results/ma3/t3/
 * (§39) — it fails loudly if any R row did not execute, so a partial matrix
 * can never present itself as evidence.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, rmSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { providerBase } from "./adapters.server.ts";
import { classifyRequirements, effortRequirement } from "../orch/router-requirements.ts";
import type { TaskRequirements } from "../orch/router-requirements.ts";
import type { TaskConstraints } from "../orch/types.ts";
import {
  ADAPTER_TOOL_CONTRACTS, PROVIDER_EFFORT_CONTRACTS, RECOVERY_BOUNDS, ROUTING_POLICY, ROUTING_POLICY_VERSION,
  buildCandidates, classifyFailure, exhaustionNote, planRecovery, preLaunchRevalidate,
  safeDecisionRecord, selectRoutingCandidate,
  type CandidateInput, type RoutingCandidate, type RoutingDecisionRecord, type RoutingFailureTaxonomy,
} from "./routing.server.ts";
import { MODEL_SOURCE_PROVIDERS, ModelCapabilityRegistry } from "./model-capability.server.ts";
import type { ModelCapabilityRecord, ModelCapabilityProviderSnapshot } from "./model-capability.server.ts";
import { HostDatabase } from "./persistence.server.ts";
import type { ProviderId, ProviderLive } from "../orch/types.ts";
import type { ProviderUsageSnapshot, UsageState } from "./provider-usage.server.ts";

const now = 1_700_000_000_000;
const RESEARCH_PROMPT = "Summarize the tradeoffs of two approaches";
const REPO_PROMPT = "Debug the failing test in src/lib/bunny-host and fix it.";
const TOOL_PROMPT = "Run the script and confirm the output.";
const SIMPLE_PROMPT = "What is 2+2?";
const MAX_PROMPT = "Prove the correctness invariant as a formal proof against the distributed design.";
const VISION_PROMPT = "Describe this screenshot and identify the UI elements.";
const BIG_CONTEXT_PROMPT = "Summarize all files in the design docs folder.";

const live = (id: ProviderId, extra: Partial<ProviderLive> = {}): ProviderLive => ({
  ...providerBase(id),
  installed: true, authenticated: true,
  authenticatedState: id === "ollama" ? "not_required" : "authenticated",
  availability: "ready", capabilities: ["text", "filesystem", "terminal", "git"],
  current_model: null, probedAt: now, ...extra,
});
const fact = (fields: Record<string, unknown>): ModelCapabilityRecord => ({
  provider: "ollama", model: "qwen3:9b-instruct", local: true, toolCalling: null, vision: null,
  embedding: null, contextWindow: 131_072, loaded: null, isDefault: null, source: "matrix fixture",
  probedAt: now, evidence: [], ...fields,
} as unknown as ModelCapabilityRecord);
const codexFact = (model: string, fields: Record<string, unknown> = {}): ModelCapabilityRecord =>
  fact({ provider: "codex", model, local: false, contextWindow: null, ...fields });
const usageSnapshot = (id: ProviderId, status: UsageState, percentUsed: number | null, observedAt = now): ProviderUsageSnapshot => ({
  providerId: id, name: id, accountScope: null, status, observedAt, refreshedAt: observedAt,
  windows: [{
    label: "short window", kind: "short", limitValue: null, usedValue: null, remainingValue: null, unit: null, percentUsed,
    resetAt: null, resetDescription: null, sourceKind: "provider_native", sourceSurface: "matrix fixture",
    confidence: "provider_reported", observedAt, rawValueHash: "a".repeat(64),
  }],
  note: "", localTelemetry: null,
} as unknown as ProviderUsageSnapshot);
const snapshotOf = (...groups: { provider: ProviderId; facts: ModelCapabilityRecord[] }[]): { providers: ModelCapabilityProviderSnapshot[] } => ({
  providers: groups.map((group) => ({ provider: group.provider, probedThisRun: true, probedAt: now, models: group.facts })),
});
const req = (prompt: string, constraints: TaskConstraints = {}): TaskRequirements =>
  classifyRequirements({ prompt, mode: "balanced", constraints });

function candidates(input: Partial<CandidateInput>): RoutingCandidate[] {
  const requirements = input.requirements ?? req(RESEARCH_PROMPT);
  return buildCandidates({
    providers: input.providers ?? [],
    modelSnapshot: input.modelSnapshot ?? { providers: [] },
    usage: input.usage ?? { providers: [] },
    requirements,
    constraints: input.constraints ?? {},
    override: input.override ?? "auto",
    modelOverride: input.modelOverride,
    mode: input.mode ?? "balanced",
    empirical: input.empirical,
  });
}
const select = (list: RoutingCandidate[], requirements: TaskRequirements) => selectRoutingCandidate({ candidates: list, requirements });
const eligible = (list: RoutingCandidate[]) => list.filter((candidate) => candidate.eligibility === "eligible");
const excludedWith = (list: RoutingCandidate[], pattern: RegExp): string[] =>
  list.filter((candidate) => candidate.exclusion_reasons.some((reason) => pattern.test(reason))).map((candidate) => candidate.model_id ?? `<${candidate.candidate_kind}>`);
const usagePoints = (candidate: RoutingCandidate): number =>
  candidate.score_components?.find((component) => component.name === "usage")?.points ?? NaN;
const classFit = (candidate: RoutingCandidate): number =>
  candidate.score_components?.find((component) => component.name === "class_fit")?.points ?? NaN;

/** The §32 matrix text, verbatim per row. */
const matrixRows: { id: string; rule: string }[] = [
  { id: "R01", rule: "default does not always win" },
  { id: "R02", rule: "default wins when actually best" },
  { id: "R03", rule: "simple task not MAX effort" },
  { id: "R04", rule: "hard reasoning raises effort" },
  { id: "R05", rule: "coding task -> coding-capable" },
  { id: "R06", rule: "vision excludes non-vision" },
  { id: "R07", rule: "tools exclude tool=false" },
  { id: "R08", rule: "context limit excludes" },
  { id: "R09", rule: "local-only excludes cloud" },
  { id: "R10", rule: "cloud-only excludes local" },
  { id: "R11", rule: "project does not pin" },
  { id: "R12", rule: "new Ollama model via discovery fixture, no source edit" },
  { id: "R13", rule: "usage pressure prefers low-pressure" },
  { id: "R14", rule: "UNKNOWN usage neutral" },
  { id: "R15", rule: "stale usage lower confidence not truth" },
  { id: "R16", rule: "provider unavailable excluded/rerouted" },
  { id: "R17", rule: "model removed before launch -> revalidation catches" },
  { id: "R18", rule: "Claude-like PROVIDER_DEFAULT executable without invented identity" },
  { id: "R19", rule: "explicit provider honored" },
  { id: "R20", rule: "impossible constraint fails clearly" },
  { id: "R21", rule: "transient bounded retry" },
  { id: "R22", rule: "quota failure -> alternative" },
  { id: "R23", rule: "context overflow -> bigger context" },
  { id: "R24", rule: "verification failure -> second candidate/effort" },
  { id: "R25", rule: "refusal on allowed task -> alternative" },
  { id: "R26", rule: "refusal on denied task -> no reroute" },
  { id: "R27", rule: "specialized local model selectable on allowed task" },
  { id: "R28", rule: "model switch preserves envelope" },
  { id: "R29", rule: "manual exact model executes" },
  { id: "R30", rule: "manual disappears -> no substitution, unavailable" },
  { id: "R31", rule: "auto disappears -> reroute" },
  { id: "R32", rule: "determinism" },
  { id: "R33", rule: "concurrency independence" },
  { id: "R34", rule: "audit safe" },
  { id: "R35", rule: "execution matches decision" },
  { id: "R36", rule: "no infinite retry" },
];
/** Row ids that actually ran (pushed after the last assert of each test). */
const executed: string[] = [];
const done = (id: string) => executed.push(id);

test("R01: the provider default does not always win — scoring decides, never the default tag", () => {
  // (a) research: the claude default outranks codex's own catalogue-preferred model.
  const research = req(RESEARCH_PROMPT);
  const a = candidates({ providers: [live("codex"), live("claude")], modelSnapshot: snapshotOf({ provider: "codex", facts: [codexFact("gpt-5.3", { isDefault: true }), codexFact("gpt-5.3-codex")] }), requirements: research });
  const pickA = select(a, research);
  assert.equal(pickA.selected?.provider_id, "claude");
  assert.equal(pickA.selected?.candidate_kind, "PROVIDER_DEFAULT", "a discovered-model default does not beat a better-fitting provider default");
  // (b) repository coding: the discovered codex model outranks the claude default.
  const repo = req(REPO_PROMPT);
  const b = candidates({ providers: [live("codex"), live("claude")], modelSnapshot: snapshotOf({ provider: "codex", facts: [codexFact("gpt-5.3", { isDefault: true }), codexFact("gpt-5.3-codex")] }), requirements: repo });
  const pickB = select(b, repo);
  assert.equal(pickB.selected?.provider_id, "codex", "the provider default never auto-wins");
  assert.equal(pickB.selected?.model_id, "gpt-5.3");
  done("R01");
});

test("R02: the provider default wins when it is actually the best candidate", () => {
  const research = req(RESEARCH_PROMPT);
  const list = candidates({ providers: [live("claude"), live("ollama", { models: ["qwen3:9b-instruct"] })], modelSnapshot: snapshotOf({ provider: "ollama", facts: [fact({})] }), requirements: research });
  const pick = select(list, research);
  assert.equal(pick.selected?.provider_id, "claude");
  assert.equal(pick.selected?.candidate_kind, "PROVIDER_DEFAULT");
  assert.equal(pick.reason, "research task → the provider default on claude. research fit of the candidate's routing profile (policy prior). Usage UNKNOWN: neither free, nor unlimited, nor exhausted, nor expensive — neutral.");
  assert.ok((pick.selected?.final_score ?? 0) > (pick.order[1]?.final_score ?? 0), "won on score, not by the default tag");
  done("R02");
});

test("R03: a simple task never maps to MAX effort", () => {
  const simple = req(SIMPLE_PROMPT);
  assert.equal(simple.task_class, "general");
  assert.equal(simple.reasoning_complexity, "LOW");
  assert.equal(effortRequirement(simple), "LOW");
  const list = candidates({ providers: [live("codex")], modelSnapshot: snapshotOf({ provider: "codex", facts: [codexFact("gpt-5.3", { isDefault: true })] }), requirements: simple });
  const pick = select(list, simple);
  assert.equal(pick.selected?.effort_internal, "LOW", "simple tasks never auto-consume MAX (§11)");
  assert.equal(pick.selected?.effort_native, "low");
  // mode only trims or lifts one step, never escalates.
  assert.equal(effortRequirement({ reasoning_complexity: "HIGH" }, "fast"), "MEDIUM");
  assert.equal(effortRequirement({ reasoning_complexity: "LOW" }, "deep"), "MEDIUM");
  assert.notEqual(effortRequirement({ reasoning_complexity: "MAX" }, "fast"), "MAX");
  done("R03");
});

test("R04: a hard-reasoning task raises the effort to MAX", () => {
  const hard = req(MAX_PROMPT);
  assert.equal(hard.reasoning_complexity, "MAX");
  assert.equal(effortRequirement(hard), "MAX");
  const list = candidates({ providers: [live("codex")], modelSnapshot: snapshotOf({ provider: "codex", facts: [codexFact("gpt-5.3", { isDefault: true })] }), requirements: hard });
  const pick = select(list, hard);
  assert.equal(pick.selected?.effort_internal, "MAX");
  assert.equal(pick.selected?.effort_native, "xhigh");
  done("R04");
});

test("R05: a coding task selects a coding-capable candidate by coding rank", () => {
  const coding = req("Fix the bug in the authentication function.");
  assert.equal(coding.task_class, "coding");
  const list = candidates({
    providers: [live("codex"), live("claude"), live("ollama", { models: ["qwen3:9b-instruct"] })],
    modelSnapshot: snapshotOf(
      { provider: "codex", facts: [codexFact("gpt-5.3", { isDefault: true })] },
      { provider: "ollama", facts: [fact({})] },
    ),
    requirements: coding,
  });
  const codex = list.find((candidate) => candidate.provider_id === "codex");
  const claudeDefault = list.find((candidate) => candidate.provider_id === "claude");
  const ollama = list.find((candidate) => candidate.provider_id === "ollama");
  assert.ok(ollama, "a plain coding task scores every candidate, including the local one");
  assert.ok(classFit(codex!) > classFit(claudeDefault!), "coding rank orders codex (91) above claude (82)");
  assert.ok(classFit(claudeDefault!) > classFit(ollama!), "and both above the generic local model (55)");
  assert.equal(select(list, coding).selected?.provider_id, "codex");
  done("R05");
});

test("R06: a vision requirement excludes non-vision and UNKNOWN-vision candidates", () => {
  const vision = req(VISION_PROMPT);
  assert.equal(vision.task_class, "vision");
  assert.ok(vision.required_capabilities.includes("vision"));
  const list = candidates({
    providers: [live("codex"), live("ollama"), live("claude")],
    modelSnapshot: snapshotOf(
      { provider: "ollama", facts: [fact({ model: "llava:7b", vision: true }), fact({ model: "qwen3:9b-instruct", vision: false })] },
      { provider: "codex", facts: [codexFact("gpt-5.3", { isDefault: true })] },
    ),
    requirements: vision,
  });
  const survivors = eligible(list);
  assert.deepEqual(survivors.map((candidate) => candidate.model_id), ["llava:7b"], "only the vision-verified model survives");
  const lost = list.filter((candidate) => candidate.eligibility === "excluded");
  assert.equal(excludedWith(list, /this candidate cannot process images/).length, 1, "the verified non-vision model is excluded by its probe fact");
  assert.ok(lost.some((candidate) => candidate.exclusion_reasons.some((reason) => reason === 'Capability "vision" is UNKNOWN for this candidate and the requirement is hard (§8).')), "UNKNOWN vision excludes a cloud candidate without probe facts");
  done("R06");
});

test("R07: a tool requirement excludes a model whose adapter contract is tool=false", () => {
  const tool = req(TOOL_PROMPT);
  assert.equal(tool.task_class, "tool_execution");
  assert.ok(tool.required_capabilities.includes("tools"));
  assert.equal(ADAPTER_TOOL_CONTRACTS.ollama, false, "Bunny's ollama adapter cannot drive tool calls (§8 escape hatch)");
  const list = candidates({
    providers: [live("codex"), live("ollama", { models: ["qwen3:9b-instruct", "qwen3-omni:8b"] })],
    modelSnapshot: snapshotOf(
      { provider: "codex", facts: [codexFact("gpt-5.3", { isDefault: true })] },
      { provider: "ollama", facts: [fact({ model: "qwen3-omni:8b", toolCalling: true })] },
    ),
    requirements: tool,
  });
  const survivors = eligible(list);
  assert.deepEqual(survivors.map((candidate) => candidate.model_id), ["gpt-5.3"], "the tool-calling model metadata never overrides the Bunny ollama adapter's proven contract");
  const omni = list.find((candidate) => candidate.model_id === "qwen3-omni:8b");
  assert.ok(omni!.exclusion_reasons.includes("Verified fact: this candidate cannot make tool calls."));
  const toolsFact = omni!.observed_capabilities.find((capability) => capability.name === "tools");
  assert.deepEqual(toolsFact, { name: "tools", value: false, provenance: "adapter_contract" });
  done("R07");
});

test("R08: a large-context requirement excludes models with a smaller verified window or an UNKNOWN one", () => {
  const big = req(BIG_CONTEXT_PROMPT);
  assert.ok(big.required_capabilities.includes("large_context"));
  const list = candidates({
    providers: [live("codex"), live("ollama", { models: ["tiny:3b", "qwen3:9b-instruct"] })],
    modelSnapshot: snapshotOf(
      { provider: "codex", facts: [codexFact("gpt-5.3", { isDefault: true })] },
      { provider: "ollama", facts: [fact({ model: "tiny:3b", contextWindow: 4096 }), fact({ contextWindow: 131_072 })] },
    ),
    requirements: big,
  });
  const survivors = eligible(list);
  assert.deepEqual(survivors.map((candidate) => candidate.model_id), ["qwen3:9b-instruct"]);
  assert.equal(excludedWith(list, /Verified context window \(4096\) is below the requirement/).length, 1);
  assert.ok(list.some((candidate) => candidate.provider_id === "codex" && candidate.exclusion_reasons.some((reason) => reason === "Verified context window is UNKNOWN and a large-context requirement is hard (§8).")), "UNKNOWN context is never invented into a window");
  done("R08");
});

test("R09: a local-only task excludes the cloud candidates", () => {
  const research = req(RESEARCH_PROMPT, { localOnly: true });
  const list = candidates({
    providers: [live("codex"), live("claude"), live("ollama", { models: ["qwen3:9b-instruct"] })],
    modelSnapshot: snapshotOf({ provider: "ollama", facts: [fact({})] }, { provider: "codex", facts: [codexFact("gpt-5.3", { isDefault: true })] }),
    requirements: research, constraints: { localOnly: true },
  });
  const survivors = eligible(list);
  assert.deepEqual(survivors.map((candidate) => candidate.provider_id), ["ollama"]);
  const codex = list.find((candidate) => candidate.provider_id === "codex");
  assert.ok(codex!.exclusion_reasons.some((reason) => reason.includes("this provider runs in the cloud.")), "the provider-level eligibility blocks the cloud executor");
  assert.ok(codex!.exclusion_reasons.includes("User constraint: local only."), "and the router records the constraint it honored");
  done("R09");
});

test("R10: a cloud-only task excludes the local candidates", () => {
  const research = req(RESEARCH_PROMPT, { cloudOnly: true });
  const list = candidates({
    providers: [live("codex"), live("claude"), live("ollama", { models: ["qwen3:9b-instruct"] })],
    modelSnapshot: snapshotOf({ provider: "ollama", facts: [fact({})] }, { provider: "codex", facts: [codexFact("gpt-5.3", { isDefault: true })] }),
    requirements: research, constraints: { cloudOnly: true },
  });
  const survivors = eligible(list);
  assert.deepEqual(survivors.map((candidate) => candidate.provider_id), ["codex", "claude"]);
  const ollama = list.find((candidate) => candidate.provider_id === "ollama");
  assert.ok(ollama!.exclusion_reasons.includes("User constraint: cloud only."));
  assert.equal(select(list, research).selected?.provider_id, "claude");
  done("R10");
});

test("R11: a project context never pins a model — routing reads requirements, not folders", () => {
  // Two calls that differ only in project/working-directory flavor must route identically.
  const base = req(REPO_PROMPT);
  const facts = [codexFact("gpt-5.3", { isDefault: true }), codexFact("gpt-5.3-codex")];
  const a = candidates({ providers: [live("codex"), live("claude")], modelSnapshot: snapshotOf({ provider: "codex", facts }), requirements: base });
  const withProject = candidates({
    providers: [live("codex", { current_model: "gpt-5.3-codex" }), live("claude")], modelSnapshot: snapshotOf({ provider: "codex", facts }),
    requirements: classifyRequirements({ prompt: REPO_PROMPT + " Work inside project-alpha.", mode: "balanced" }), constraints: { workingDirectory: "C:\\tmp\\project-alpha" },
  });
  assert.deepEqual(withProject.map((candidate) => ({ provider_id: candidate.provider_id, model_id: candidate.model_id, eligible: candidate.eligibility, final_score: candidate.final_score })), a.map((candidate) => ({ provider_id: candidate.provider_id, model_id: candidate.model_id, eligible: candidate.eligibility, final_score: candidate.final_score })), "a project never owns or pins a model (§2/§11)");
  assert.equal(select(withProject, req(REPO_PROMPT + " Work inside project-alpha.")).selected?.provider_id, "codex");
  done("R11");
});

test("R12: a brand-new Ollama model reaches the router through the T1 probe — no source edit", async () => {
  const directory = mkdtempSync(join(tmpdir(), "bunny-t3-matrix-r12-"));
  const db = new HostDatabase(join(directory, "host.sqlite"));
  try {
    const registry = new ModelCapabilityRegistry(db, {
      availableProviders: () => ["ollama"],
      ollamaProbe: async () => ({ up: true, models: ["zephyr:9b"], remote: [] }),
      ollamaShow: async (model: string) => model === "zephyr:9b" ? { name: "zephyr:9b", family: "qwen3", parameter_size: "9B", capabilities: ["tools"], context_length: 65_536 } : null,
      ollamaPs: async () => null,
      now: () => now,
    });
    await registry.refresh({ force: true });
    const snap = registry.snapshot();
    const ollamaFacts = snap.providers.find((group) => group.provider === "ollama")!.models;
    assert.ok(ollamaFacts.some((record) => record.model === "zephyr:9b"), "discovery picked up the new tag");
    const research = req(RESEARCH_PROMPT);
    const list = candidates({ providers: [live("ollama", { models: ["zephyr:9b"] })], modelSnapshot: { providers: snap.providers }, requirements: research });
    const zephyr = list.find((candidate) => candidate.model_id === "zephyr:9b");
    assert.ok(zephyr, "the new model is a first-class candidate");
    assert.equal(zephyr!.candidate_kind, "DISCOVERED_MODEL");
    assert.equal(zephyr!.eligibility, "eligible", "no hard-coded model list was involved");
    assert.equal(select(list, research).selected?.model_id, "zephyr:9b");
  } finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
  done("R12");
});

test("R13: usage pressure prefers the low-pressure candidate", () => {
  const research = req(RESEARCH_PROMPT);
  const list = candidates({
    providers: [live("codex"), live("claude")],
    modelSnapshot: snapshotOf({ provider: "codex", facts: [codexFact("gpt-5.3", { isDefault: true })] }),
    usage: { providers: [usageSnapshot("codex", "current", 98), usageSnapshot("claude", "current", 5)] },
    requirements: research,
  });
  const codex = list.find((candidate) => candidate.provider_id === "codex");
  const claude = list.find((candidate) => candidate.provider_id === "claude");
  assert.ok(Math.abs(usagePoints(claude!) - 11.55) < 0.06, "current usage at 5% costs almost nothing");
  assert.ok(usagePoints(claude!) > usagePoints(codex!) + 5, "98% pressure costs a heavy share of the 12-point weight");
  assert.equal(select(list, research).selected?.provider_id, "claude");
  done("R13");
});

test("R14: UNKNOWN usage is neutral — neither free, nor exhausted, nor penalized", () => {
  const research = req(RESEARCH_PROMPT);
  const list = candidates({
    providers: [live("codex"), live("claude"), live("ollama", { models: ["qwen3:9b-instruct"] })],
    modelSnapshot: snapshotOf(
      { provider: "codex", facts: [codexFact("gpt-5.3", { isDefault: true })] },
      { provider: "ollama", facts: [fact({})] },
    ),
    requirements: research,
  });
  for (const survivor of eligible(list)) {
    assert.equal(survivor.usage_quality, "unknown");
    assert.equal(usagePoints(survivor), ROUTING_POLICY.weights.usagePressure / 2, "exactly half the weight, equal for every candidate");
    assert.equal(survivor.score_components?.find((component) => component.name === "usage")?.detail, "Usage UNKNOWN: neither free, nor unlimited, nor exhausted, nor expensive — neutral.");
  }
  done("R14");
});

test("R15: stale usage lowers confidence, never flips the direction or excludes", () => {
  const research = req(RESEARCH_PROMPT);
  const list = candidates({
    providers: [live("codex"), live("claude")],
    modelSnapshot: snapshotOf({ provider: "codex", facts: [codexFact("gpt-5.3", { isDefault: true })] }),
    usage: { providers: [usageSnapshot("codex", "stale", 98), usageSnapshot("claude", "stale", 10)] },
    requirements: research,
  });
  const codex = list.find((candidate) => candidate.provider_id === "codex");
  const claude = list.find((candidate) => candidate.provider_id === "claude");
  assert.ok(Math.abs(usagePoints(claude!) - 5.55) < 0.06, "half weight minus the small pressure");
  assert.ok(Math.abs(usagePoints(codex!) - 1.59) < 0.06, "half weight minus the heavy pressure — direction preserved");
  assert.ok(usagePoints(claude!) > usagePoints(codex!));
  assert.equal(eligible(list).length, 2, "staleness is lower confidence, not unavailability (§14)");
  assert.ok(claude!.score_components?.find((component) => component.name === "usage")?.detail.includes("half weight"));
  done("R15");
});

test("R16: an unavailable provider is excluded pre-launch and rerouted in recovery", () => {
  const offlineOllama = live("ollama", { models: ["qwen3:9b-instruct"], availability: "offline" });
  const research = req(RESEARCH_PROMPT);
  const list = candidates({ providers: [live("codex"), offlineOllama], modelSnapshot: snapshotOf({ provider: "ollama", facts: [fact({})] }), requirements: research });
  const ollama = list.find((candidate) => candidate.provider_id === "ollama");
  assert.equal(ollama!.exclusion_reasons.some((reason) => reason === "Ollama is offline."), true, "eligibility excludes an offline provider at the hard filter");
  const refused = preLaunchRevalidate({ provider_id: "ollama", model_id: "qwen3:9b-instruct", candidate_kind: "DISCOVERED_MODEL" }, [live("codex"), offlineOllama], snapshotOf({ provider: "ollama", facts: [fact({})] }), {}, now);
  assert.deepEqual(refused, { ok: false, reason: "Provider Ollama is no longer ready (offline)." }, "a cached selection against an offline provider is refused at launch");
  assert.deepEqual(planRecovery({ taxonomy: "PROVIDER_UNAVAILABLE", attemptIndex: 0, sameRetriesUsed: 0, alternatesUsed: 0, escalationsUsed: 0, reroutesUsed: 0 }), { action: "reroute", reason: "Provider unavailable; routing to an alternate candidate.", excludeProvider: undefined });
  done("R16");
});

test("R17: a model removed before launch is caught by revalidation — the cache is not authority", () => {
  const providers = [live("codex", { models: ["gpt-5.3"] })];
  const stale = snapshotOf({ provider: "codex", facts: [codexFact("gpt-5.3")] });
  const removed = preLaunchRevalidate({ provider_id: "codex", model_id: "gpt-5.3-codex", candidate_kind: "DISCOVERED_MODEL" }, providers, stale, {}, now);
  assert.deepEqual(removed, { ok: false, reason: "Selected model gpt-5.3-codex is no longer verified as listed by Codex." });
  // Registry absence (a probe that produced nothing) is UNKNOWN, never evidence of emptiness.
  const empty = preLaunchRevalidate({ provider_id: "codex", model_id: "gpt-5.3-codex", candidate_kind: "DISCOVERED_MODEL" }, [live("codex", { models: ["gpt-5.3-codex"] })], snapshotOf({ provider: "codex", facts: [] }), {}, now);
  assert.deepEqual(empty, { ok: true }, "UNKNOWN stays UNKNOWN; the adapter's own launch re-probe stays the backstop");
  const stillThere = preLaunchRevalidate({ provider_id: "codex", model_id: "gpt-5.3-codex", candidate_kind: "DISCOVERED_MODEL" }, [live("codex", { models: ["gpt-5.3-codex"] })], snapshotOf({ provider: "codex", facts: [codexFact("gpt-5.3-codex")] }), {}, now);
  assert.deepEqual(stillThere, { ok: true });
  done("R17");
});

test("R18: a Claude-like non-listing provider routes as PROVIDER_DEFAULT with no invented identity", () => {
  const research = req(RESEARCH_PROMPT);
  const list = candidates({ providers: [live("claude")], requirements: research });
  const single = list[0];
  assert.equal(list.length, 1);
  assert.deepEqual({ candidate_kind: single.candidate_kind, model_id: single.model_id, effort_internal: single.effort_internal, effort_native: single.effort_native }, {
    candidate_kind: "PROVIDER_DEFAULT", model_id: null, effort_internal: "PROVIDER_DEFAULT", effort_native: null,
  });
  assert.equal(single.routing_profile?.provenance, "POLICY_DEFAULT");
  assert.equal(single.routing_profile?.note, "Provider default: Bunny policy prior, not a provider-reported ranking.");
  const pick = select(list, research);
  assert.equal(pick.selected?.candidate_kind, "PROVIDER_DEFAULT");
  assert.equal(pick.reason.includes("the provider default on claude"), true);
  assert.ok(!JSON.stringify(list.map((candidate) => candidate.routing_profile)).includes("claude-default"), "no invented model id is ever fabricated for a non-listing provider");
  done("R18");
});

test("R19: an explicit provider override is honored — every other provider leaves the set", () => {
  const research = req(RESEARCH_PROMPT);
  const list = candidates({
    providers: [live("codex"), live("claude"), live("ollama", { models: ["qwen3:9b-instruct"] })],
    modelSnapshot: snapshotOf({ provider: "ollama", facts: [fact({})] }),
    requirements: research, override: "ollama",
  });
  const providers = [...new Set(list.map((candidate) => candidate.provider_id))];
  assert.deepEqual(providers, ["ollama"]);
  assert.equal(eligible(list).length, 1);
  assert.equal(select(list, research).selected?.provider_id, "ollama");
  done("R19");
});

test("R20: an impossible constraint fails clearly — never a silent substitution", () => {
  const research = req(RESEARCH_PROMPT, { localOnly: true });
  const list = candidates({
    providers: [live("codex"), live("claude")],
    modelSnapshot: snapshotOf({ provider: "codex", facts: [codexFact("gpt-5.3", { isDefault: true })] }),
    requirements: research, constraints: { localOnly: true },
  });
  assert.equal(eligible(list).length, 0, "cloud-only providers cannot serve a local-only task");
  assert.equal(excludedWith(list, /User constraint: local only\./).length, 2);
  const pick = select(list, research);
  assert.equal(pick.selected ?? null, null);
  assert.equal(pick.reason, "No eligible candidate.");
  assert.deepEqual(pick.order, []);
  const record = safeDecisionRecord({
    id: "matrix-r20", taskId: "task-r20", missionId: null, routingMode: "auto",
    requirements: research, candidates: list, selection: pick, policyVersion: ROUTING_POLICY_VERSION, createdAt: now,
  });
  assert.equal(record.selected ?? null, null, "the record is honest: nothing was routed");
  assert.deepEqual(record.fallback_order, []);
  done("R20");
});

test("R21: a transient transport failure retries once, then reroutes within bounds", () => {
  assert.deepEqual(RECOVERY_BOUNDS, { sameCandidateRetries: 1, alternates: 2, maxAttempts: 4, verificationEscalations: 1 });
  const walk: string[] = [];
  let attemptIndex = 0; let same = 0; let alts = 0;
  for (;;) {
    const action = planRecovery({ taxonomy: "TRANSIENT_TRANSPORT", attemptIndex, sameRetriesUsed: same, alternatesUsed: alts, escalationsUsed: 0, reroutesUsed: 0 });
    walk.push(action.action);
    if (action.action === "fail") { assert.match(action.reason, /transient transport persisted beyond the retry bound/); break; }
    if (action.action === "retry-same") same++; else if (action.action === "reroute") alts++;
    attemptIndex++;
  }
  assert.deepEqual(walk, ["retry-same", "reroute", "reroute", "fail"], "one same-candidate retry, two alternates, then an honest failure");
  assert.equal(attemptIndex, RECOVERY_BOUNDS.maxAttempts - 1, "termination sits inside the attempt bound");
  done("R21");
});

test("R22: a quota failure reroutes to an alternative, bounded", () => {
  assert.equal(classifyFailure({ error: "usage limit reached (429)", exitCode: 1 }), "QUOTA_CONSTRAINED");
  assert.equal(classifyFailure({ error: "not allowed right now", exitCode: 1, usageLimitStatus: "rejected" }), "QUOTA_CONSTRAINED");
  const first = planRecovery({ taxonomy: "QUOTA_CONSTRAINED", attemptIndex: 0, sameRetriesUsed: 1, alternatesUsed: 0, escalationsUsed: 0, reroutesUsed: 0 });
  assert.deepEqual(first, { action: "reroute", reason: "Quota exhausted on this candidate; routing to a lower-pressure candidate." });
  const exhausted = planRecovery({ taxonomy: "QUOTA_CONSTRAINED", attemptIndex: 3, sameRetriesUsed: 1, alternatesUsed: 2, escalationsUsed: 0, reroutesUsed: 0 });
  assert.match(exhausted.reason, /all eligible candidates are quota-constrained/);
  done("R22");
});

test("R23: a context overflow prefers a verified larger window, bounded", () => {
  assert.equal(classifyFailure({ error: "prompt too long: exceeds the maximum context length of 200000 tokens", exitCode: 1 }), "CONTEXT_OVERFLOW");
  const first = planRecovery({ taxonomy: "CONTEXT_OVERFLOW", attemptIndex: 0, sameRetriesUsed: 0, alternatesUsed: 0, escalationsUsed: 0, reroutesUsed: 0 });
  assert.deepEqual(first, { action: "reroute-larger-context", reason: "Context overflow; preferring a candidate with a verified larger window." });
  const exhausted = planRecovery({ taxonomy: "CONTEXT_OVERFLOW", attemptIndex: 3, sameRetriesUsed: 0, alternatesUsed: 2, escalationsUsed: 0, reroutesUsed: 0 });
  assert.match(exhausted.reason, /no larger verified context available/);
  done("R23");
});

test("R24: a verification failure escalates once, then exhausts — candidates or effort", () => {
  assert.equal(classifyFailure({ verificationFailed: true, error: "I can't comply with that request.", exitCode: 1 }), "VERIFICATION_FAILED", "verification is classified before any provider refusal text");
  const first = planRecovery({ taxonomy: "VERIFICATION_FAILED", attemptIndex: 0, sameRetriesUsed: 0, alternatesUsed: 0, escalationsUsed: 0, reroutesUsed: 0 });
  assert.deepEqual(first, { action: "escalate-effort", reason: "Verification failed; escalating effort or candidate once (§24)." });
  const second = planRecovery({ taxonomy: "VERIFICATION_FAILED", attemptIndex: 1, sameRetriesUsed: 0, alternatesUsed: 0, escalationsUsed: 1, reroutesUsed: 0 });
  assert.match(second.reason, /all_eligible_models_failed after 1 attempt\(s\): verification failed after the single escalation\./);
  done("R24");
});

test("R25: a refusal on a task Bunny's policy allows reroutes to an alternative", () => {
  assert.equal(classifyFailure({ error: "I can't comply with that request.", exitCode: 1 }), "PROVIDER_REFUSAL");
  const first = planRecovery({ taxonomy: "PROVIDER_REFUSAL", attemptIndex: 0, sameRetriesUsed: 1, alternatesUsed: 0, escalationsUsed: 0, reroutesUsed: 0, policyAllows: true });
  assert.deepEqual(first, { action: "reroute", reason: "Provider declined a Task Bunny's own policy allows; routing to an alternate candidate." });
  const exhausted = planRecovery({ taxonomy: "PROVIDER_REFUSAL", attemptIndex: 3, sameRetriesUsed: 1, alternatesUsed: 2, escalationsUsed: 0, reroutesUsed: 0, policyAllows: true });
  assert.match(exhausted.reason, /refusal and reroute bound reached/);
  done("R25");
});

test("R26: a refusal on a task Bunny's policy forbids never reroutes", () => {
  const denied = planRecovery({ taxonomy: "PROVIDER_REFUSAL", attemptIndex: 0, sameRetriesUsed: 0, alternatesUsed: 0, escalationsUsed: 0, reroutesUsed: 0, policyAllows: false });
  assert.equal(denied.action, "fail");
  assert.match(denied.reason, /Bunny policy does not route around refusals for this Task/);
  assert.equal(classifyFailure({ policyDenied: true, exitCode: 1 }), "POLICY_DENIED");
  const policy = planRecovery({ taxonomy: "POLICY_DENIED", attemptIndex: 0, sameRetriesUsed: 0, alternatesUsed: 0, escalationsUsed: 0, reroutesUsed: 0 });
  assert.match(policy.reason, /rerouting is forbidden \(§22\)/);
  done("R26");
});

test("R27: a specialized local model is selectable — and pinnable — on an allowed task", () => {
  const research = req(RESEARCH_PROMPT);
  const list = candidates({
    providers: [live("ollama", { models: ["qwen3:9b-instruct"] })],
    modelSnapshot: snapshotOf({ provider: "ollama", facts: [fact({ contextWindow: 131_072 })] }),
    requirements: research,
  });
  const pick = select(list, research);
  assert.equal(pick.selected?.provider_id, "ollama");
  assert.equal(pick.selected?.candidate_kind, "DISCOVERED_MODEL");
  assert.ok(pick.selected?.routing_profile?.specialization_tags.includes("local"), "the local specialization is visible in the profile");
  // And the same local model honors an exact pin.
  const pinned = candidates({
    providers: [live("ollama", { models: ["qwen3:9b-instruct"] })],
    modelSnapshot: snapshotOf({ provider: "ollama", facts: [fact({ contextWindow: 131_072 })] }),
    requirements: research, modelOverride: "qwen3:9b-instruct",
  });
  const survivors = eligible(pinned);
  assert.deepEqual(survivors.map((candidate) => candidate.model_id), ["qwen3:9b-instruct"]);
  assert.deepEqual(select(pinned, research).selected?.model_id, "qwen3:9b-instruct");
  done("R27");
});

test("R28: a model switch never widens the task's capability envelope", () => {
  // The same hard constraints re-filter every alternate candidate — a reroute can only pick from
  // candidates that satisfy the identical envelope (§28: Router chooses INTELLIGENCE; Host AUTHORITY).
  const research = req(RESEARCH_PROMPT, { localOnly: true });
  const list = candidates({
    providers: [live("codex"), live("claude"), live("ollama", { models: ["qwen3:9b-instruct"] })],
    modelSnapshot: snapshotOf({ provider: "ollama", facts: [fact({})] }, { provider: "codex", facts: [codexFact("gpt-5.3", { isDefault: true })] }),
    requirements: research, constraints: { localOnly: true },
  });
  const switchable = eligible(list);
  assert.ok(switchable.every((candidate) => candidate.local_or_cloud === "local"), "every selectable alternate satisfies the same local-only envelope");
  for (const taxonomy of ["PROVIDER_UNAVAILABLE", "MODEL_UNAVAILABLE", "QUOTA_CONSTRAINED", "PROVIDER_REFUSAL"] as RoutingFailureTaxonomy[]) {
    const action = planRecovery({ taxonomy, attemptIndex: 0, sameRetriesUsed: 1, alternatesUsed: 0, escalationsUsed: 0, reroutesUsed: 0, policyAllows: true });
    assert.ok(action.action === "reroute" || action.action === "reroute-larger-context");
    assert.ok(!/permission|authoriz/i.test(action.reason), "recovery reasons never speak of permissions — authority never came from the router");
  }
  done("R28");
});

test("R29: a manual exact-model selection filters to exactly that model", () => {
  const research = req(RESEARCH_PROMPT);
  const list = candidates({
    providers: [live("codex")],
    modelSnapshot: snapshotOf({ provider: "codex", facts: [codexFact("gpt-5.3", { isDefault: true }), codexFact("gpt-5.3-codex")] }),
    requirements: research, modelOverride: "gpt-5.3-codex",
  });
  const gpt = list.find((candidate) => candidate.model_id === "gpt-5.3");
  assert.deepEqual(gpt!.exclusion_reasons, ["Manual selection targets a different model."]);
  const pick = select(list, research);
  assert.equal(pick.selected?.model_id, "gpt-5.3-codex");
  assert.equal(pick.selected?.candidate_kind, "DISCOVERED_MODEL");
  assert.equal(pick.selected?.effort_native, "high", "the pinned model still gets the classified effort through the codex contract (research → HIGH → high)");
  done("R29");
});

test("R30: a manual model that disappeared leaves no candidates — unavailable, never substituted", () => {
  const research = req(RESEARCH_PROMPT);
  const list = candidates({
    providers: [live("codex")],
    modelSnapshot: snapshotOf({ provider: "codex", facts: [codexFact("gpt-5.3", { isDefault: true })] }),
    requirements: research, modelOverride: "gpt-5.3-codex",
  });
  assert.equal(eligible(list).length, 0);
  const pick = select(list, research);
  assert.equal(pick.selected ?? null, null);
  assert.equal(pick.reason, "No eligible candidate.");
  // At launch, revalidation would refuse the cached selection the same way.
  const refused = preLaunchRevalidate({ provider_id: "codex", model_id: "gpt-5.3-codex", candidate_kind: "DISCOVERED_MODEL" }, [live("codex", { models: ["gpt-5.3"] })], snapshotOf({ provider: "codex", facts: [codexFact("gpt-5.3")] }), {}, now);
  assert.match(refused.ok === false ? refused.reason : "", /Selected model gpt-5\.3-codex is no longer verified as listed by Codex/);
  done("R30");
});

test("R31: an auto selection that disappears reroutes from the recorded fallback order", () => {
  const research = req(RESEARCH_PROMPT);
  const list = candidates({
    providers: [live("codex"), live("claude")],
    modelSnapshot: snapshotOf({ provider: "codex", facts: [codexFact("gpt-5.3"), codexFact("gpt-5.3-codex")] }),
    usage: { providers: [usageSnapshot("codex", "current", 98), usageSnapshot("claude", "current", 5)] },
    requirements: research,
  });
  const pick = select(list, research);
  assert.equal(pick.selected?.provider_id, "claude", "the low-pressure candidate is selected");
  assert.equal(pick.order.length, 3, "the fallback order is recorded for reroutes");
  const scores = pick.order.map((candidate) => candidate.final_score ?? 0);
  assert.deepEqual(scores, [...scores].sort((a, b) => b - a), "the order is score-sorted, stable");
  // If that selection fails as MODEL_UNAVAILABLE, recovery reroutes to the next eligible candidate.
  const next = pick.order[1];
  assert.ok(next && next.provider_id !== "claude");
  const action = planRecovery({ taxonomy: "MODEL_UNAVAILABLE", attemptIndex: 0, sameRetriesUsed: 0, alternatesUsed: 0, escalationsUsed: 0, reroutesUsed: 0 });
  assert.deepEqual(action, { action: "reroute", reason: "Selected model unavailable; routing to an alternate candidate." });
  done("R31");
});

test("R32: determinism — identical inputs produce identical candidates, selection, and scores", () => {
  const build = () => candidates({
    providers: [live("codex"), live("ollama", { models: ["qwen3:9b-instruct"] })],
    modelSnapshot: snapshotOf({ provider: "codex", facts: [codexFact("gpt-5.3", { isDefault: true })] }),
    modelOverride: undefined,
    requirements: req(RESEARCH_PROMPT),
  });
  const first = build(); const second = build();
  assert.deepEqual(second, first, "buildCandidates is pure and order-stable");
  const pickA = select(first, req(RESEARCH_PROMPT));
  const pickB = select(second, req(RESEARCH_PROMPT));
  assert.deepEqual(pickA, pickB);
  done("R32");
});

test("R33: routing is per-Task — no mutable global model state leaks between decisions", () => {
  const research = req(RESEARCH_PROMPT);
  const coding = req(REPO_PROMPT);
  const facts = [codexFact("gpt-5.3", { isDefault: true }), codexFact("gpt-5.3-codex")];
  const providers = [live("codex"), live("claude")];
  const buildWith = (requirements: TaskRequirements) => candidates({ providers, modelSnapshot: snapshotOf({ provider: "codex", facts }), requirements });
  const researchFirst = select(buildWith(research), research);
  const codingResult = select(buildWith(coding), coding);
  const researchAgain = select(buildWith(research), research);
  assert.deepEqual(researchAgain.selected?.provider_id, researchFirst.selected?.provider_id, "the interleaved coding decision changed nothing");
  assert.deepEqual(researchAgain.reason, researchFirst.reason);
  assert.notEqual(codingResult.selected?.provider_id, researchFirst.selected?.provider_id, "two different Tasks route independently");
  done("R33");
});

test("R34: the decision record is audit-safe — no prompt text, no credentials, no transcript fields", () => {
  const research = req(RESEARCH_PROMPT);
  const list = candidates({
    providers: [live("codex"), live("claude")],
    modelSnapshot: snapshotOf({ provider: "codex", facts: [codexFact("gpt-5.3", { isDefault: true })] }),
    usage: { providers: [usageSnapshot("codex", "current", 12)] },
    requirements: research,
  });
  const pick = select(list, research);
  const record: RoutingDecisionRecord = safeDecisionRecord({
    id: "matrix-r34", taskId: "task-r34", missionId: "mission-r34", routingMode: "auto",
    requirements: research, candidates: list, selection: pick, policyVersion: ROUTING_POLICY_VERSION,
    createdAt: now, snapshotProviders: [{ provider: "codex", probedThisRun: true, probedAt: now, models: [codexFact("gpt-5.3", { isDefault: true })] }],
    usageStatuses: [{ provider: "codex", status: "current" }],
  });
  const text = JSON.stringify(record);
  assert.ok(!text.includes(RESEARCH_PROMPT), "no prompt text is ever persisted");
  assert.ok(!/bearer|authorization|api[_-]?key|secret/i.test(text), "no credentials or secrets");
  assert.deepEqual(Object.keys(record).sort(), ["candidates_considered", "classification", "created_at", "fallback_order", "mission_id", "policy_version", "requirements", "reroutes", "routing_decision_id", "routing_mode", "selected", "snapshot_references", "task_id"], "the record's shape is exactly the §18 surface");
  assert.deepEqual(Object.keys(record.classification).sort(), ["evidence", "task_class"]);
  for (const entry of record.candidates_considered) {
    assert.deepEqual(Object.keys(entry).sort(), ["candidate_kind", "components", "effort_mode", "eligible", "exclusion_reasons", "model_id", "provider_id", "score"]);
  }
  assert.deepEqual(record.snapshot_references, [{ provider: "codex", models: 1, probedThisRun: true, usage_status: "current" }], "snapshots are counts and statuses only");
  done("R34");
});

test("R35: the selected candidate is exactly the configuration the launch would use", () => {
  // The selection carries provider+model+effort; the launch gate revalidates the very same triple.
  const repo = req(REPO_PROMPT);
  const list = candidates({
    providers: [live("codex"), live("claude")],
    modelSnapshot: snapshotOf({ provider: "codex", facts: [codexFact("gpt-5.3", { isDefault: true }), codexFact("gpt-5.3-codex")] }),
    requirements: repo,
  });
  const pick = select(list, repo);
  assert.ok(pick.selected, "a deterministic selection exists");
  assert.deepEqual({ provider_id: pick.selected!.provider_id, model_id: pick.selected!.model_id }, { provider_id: "codex", model_id: "gpt-5.3" });
  const requirementEffort = effortRequirement(repo);
  assert.equal(pick.selected!.effort_native, PROVIDER_EFFORT_CONTRACTS.codex.native?.[requirementEffort] ?? null, "the normalized requirement resolves through the provider's verified effort contract");
  assert.equal(pick.selected, pick.order[0], "the selection is the head of the recorded fallback order");
  // And the same triple passes pre-launch revalidation against the facts it was built from.
  const rechecked = preLaunchRevalidate({ provider_id: pick.selected!.provider_id, model_id: pick.selected!.model_id, candidate_kind: pick.selected!.candidate_kind }, [live("codex", { models: ["gpt-5.3", "gpt-5.3-codex"] })], snapshotOf({ provider: "codex", facts: [codexFact("gpt-5.3", { isDefault: true }), codexFact("gpt-5.3-codex")] }), {}, now);
  assert.deepEqual(rechecked, { ok: true });
  done("R35");
});

test("R36: no infinite retry — every taxonomy terminates inside the recovery bounds", () => {
  const taxonomies: RoutingFailureTaxonomy[] = ["TRANSIENT_TRANSPORT", "PROVIDER_UNAVAILABLE", "MODEL_UNAVAILABLE", "QUOTA_CONSTRAINED", "CONTEXT_OVERFLOW", "CAPABILITY_MISMATCH", "TOOL_UNSUPPORTED", "PROVIDER_REFUSAL", "MALFORMED_RESULT", "EXECUTION_FAILED", "VERIFICATION_FAILED", "POLICY_DENIED"];
  for (const taxonomy of taxonomies) {
    let attemptIndex = 0; let same = 0; let alts = 0; let escalations = 0; let steps = 0;
    let action: ReturnType<typeof planRecovery>;
    do {
      action = planRecovery({ taxonomy, attemptIndex, sameRetriesUsed: same, alternatesUsed: alts, escalationsUsed: escalations, reroutesUsed: 0, policyAllows: true });
      if (action.action === "fail") break;
      if (action.action === "retry-same") same++;
      else if (action.action === "reroute" || action.action === "reroute-larger-context") alts++;
      else if (action.action === "escalate-effort") escalations++;
      attemptIndex++; steps++;
    } while (steps < 20);
    assert.equal(action.action, "fail", `${taxonomy} terminates`);
    assert.ok(steps <= RECOVERY_BOUNDS.maxAttempts, `${taxonomy} terminates within the attempt bound (${steps} steps)`);
  }
  // The exhaustion note is honest on both edges.
  assert.equal(exhaustionNote([]), "all_eligible_models_failed (no eligible candidates)");
  assert.equal(
    exhaustionNote([{ provider_id: "codex", model_id: "gpt-5.3", taxonomy: "VERIFICATION_FAILED" }, { provider_id: "claude", model_id: null, taxonomy: "PROVIDER_REFUSAL" }]),
    "all_eligible_models_failed (codex · gpt-5.3 → VERIFICATION_FAILED; claude · provider default → PROVIDER_REFUSAL)",
  );
  done("R36");
});

test("T3 §39: the full R01–R36 matrix ran; writes routing-matrix.json and routing-policy.json", () => {
  assert.deepEqual(executed.length, 36, "every matrix row executed");
  assert.deepEqual(executed, matrixRows.map((row) => row.id), "and in order, with no gaps");
  const dir = join("test-results", "ma3", "t3");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "routing-policy.json"), JSON.stringify({
    policy: ROUTING_POLICY,
    recovery_bounds: RECOVERY_BOUNDS,
    provider_effort_contracts: PROVIDER_EFFORT_CONTRACTS,
    adapter_tool_contracts: ADAPTER_TOOL_CONTRACTS,
    model_source_providers: MODEL_SOURCE_PROVIDERS,
    generated_at: new Date().toISOString(),
  }, null, 2));
  writeFileSync(join(dir, "routing-matrix.json"), JSON.stringify({
    policy_version: ROUTING_POLICY_VERSION,
    rows: matrixRows.map((row) => ({ id: row.id, rule: row.rule, executed: true })),
    note: "R01–R36 all executed by routing-matrix.test.ts; manager-level twins of R22/R24/R29/R30/R31/R32 in t3-manager.test.ts.",
    generated_at: new Date().toISOString(),
  }, null, 2));
});