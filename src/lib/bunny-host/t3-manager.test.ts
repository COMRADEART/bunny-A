import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { providerBase } from "./adapters.server.ts";
import { ModelCapabilityRegistry, type CodexCatalogLike } from "./model-capability.server.ts";
import type { Launchable } from "./discovery.server.ts";
import { HostDatabase } from "./persistence.server.ts";
import { TaskManager } from "./manager.server.ts";
import { RoutingDecisionStore } from "./routing-store.server.ts";
import { PROVIDER_EFFORT_CONTRACTS, ROUTING_POLICY_VERSION, type RoutingDecisionRecord } from "./routing.server.ts";
import { CODEX_SECURITY_POLICY_VERSION, CODEX_COMPATIBILITY_MAX_AGE_MS, type CodexCompatibilityProfile } from "../orch/compatibility.ts";
import type { AdapterHooks, AdapterResult, ProviderAdapter } from "./contracts.ts";
import type { OrchTask, ProviderId, ProviderLive } from "../orch/types.ts";

const NOW = 1_700_000_000_000;
const RESEARCH = "Summarize the tradeoffs of two approaches";
/** A code-and-run prompt: coding class, tools required — the class Codex wins on policy priors. */
const FILE_TASK = 'Create hello.py containing print("BUNNY_ROUTE_OK"). Run the script and verify stdout.';
/** Repository-evidence prompt: repository_coding with tools — Codex's 91 coding rank wins AUTO (§13). */
const REPO_TASK = "Debug the failing test in src/lib/bunny-host and fix it.";

/** A complete VALIDATED CodexCompatibilityProfile; only its freshness fields drive the T3 gate. */
function fixtureProfile(checkedAt: number): CodexCompatibilityProfile {
  return {
    policyVersion: CODEX_SECURITY_POLICY_VERSION,
    compatibilityClass: "VALIDATED",
    reason: "T3 fixture profile",
    checkedAt,
    validatedAt: checkedAt,
    evidenceSource: "T3 fixture",
    executable: null,
    versionRaw: "T3 fixture 9.9.9",
    versionParsed: "T3 fixture 9.9.9",
    validatedAgainstVersion: "T3 fixture 9.9.9",
    registryEntry: "T3 fixture",
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
  };
}

function fixtureLive(id: ProviderId, securityCompatibilityProfile: CodexCompatibilityProfile | null): ProviderLive {
  const extras: Partial<ProviderLive> = id === "codex"
    ? { models: ["gpt-5.3", "gpt-5.3-codex"], current_model: "gpt-5.3", ...(securityCompatibilityProfile ? { securityCompatibility: securityCompatibilityProfile } : {}) }
    : id === "ollama"
      ? { models: ["qwen3:8b"], current_model: "qwen3:8b" }
      : { current_model: "claude-default" };
  return {
    ...providerBase(id),
    installed: true,
    authenticated: true,
    authenticatedState: id === "ollama" ? "not_required" : "authenticated",
    availability: "ready",
    capabilities: id === "ollama" ? ["text"] : ["text", "filesystem", "terminal", "git"],
    probedAt: Date.now(),
    ...extras,
  };
}

/** A scripted adapter whose detect state is mutable and whose launch waits for a finish() call. */
function scripted(id: ProviderId) {
  const state = fixtureLive(id, id === "codex" ? fixtureProfile(Date.now()) : null);
  const launched: { task: OrchTask; hooks: AdapterHooks; finish: (result: AdapterResult) => void; stopped: boolean }[] = [];
  const adapter: ProviderAdapter = {
    id,
    detect: async () => state,
    health: async (previous) => previous,
    usage: async () => null, // Never probe any CLI, account or model service.
    launch: (task, hooks) => {
      let finish!: (result: AdapterResult) => void;
      const done = new Promise<AdapterResult>((resolve) => { finish = resolve; });
      const row = { task, hooks, finish, stopped: false };
      launched.push(row);
      return { done, stop: async () => { row.stopped = true; finish({ ok: false, output: "", stopped: true }); }, pid: () => null };
    },
  };
  return { adapter, state, launched };
}
type Scripted = ReturnType<typeof scripted>;

/** A disposable Host with the fixture registry (fake probe seams) and scripted adapters. */
async function t3Fixture(providers: ProviderId[] = ["codex", "claude", "ollama"], factLess = false) {
  const directory = mkdtempSync(join(tmpdir(), "bunny-t3-mgr-"));
  const db = new HostDatabase(join(directory, "host.sqlite"));
  const catalog = { models: ["gpt-5.3", "gpt-5.3-codex"], preferred: "gpt-5.3" };
  const ollamaTags = { tags: ["qwen3:8b"] };
  const modelRegistry = factLess
    ? new ModelCapabilityRegistry(db, { availableProviders: () => [] }) // Legacy parity: probe nothing, know nothing.
    : new ModelCapabilityRegistry(db, {
      availableProviders: () => providers,
      ollamaProbe: async () => ({ up: true, models: ollamaTags.tags, remote: [] }),
      ollamaShow: async (tag) => (tag === "qwen3:8b" ? { capabilities: ["tools"], context_length: 8192 } : null),
      ollamaPs: async () => { const empty: { name?: string }[] = []; return { models: empty }; },
      codexLaunch: () => ({ command: "fixture-codex", args: [], kind: "native" }) as unknown as Launchable,
      codexCatalog: async () => ({ model: catalog.preferred, models: catalog.models, limited: false, usageRead: false }) satisfies CodexCatalogLike,
      now: () => NOW,
    });
  const parts = {} as Record<ProviderId, Scripted>;
  for (const id of providers) parts[id] = scripted(id);
  const tasks = new TaskManager(db, directory, providers.map((id) => parts[id].adapter), { modelRegistry });
  await tasks.discover();
  const routing = new RoutingDecisionStore(db);
  const cleanup = () => { db.close(); rmSync(directory, { recursive: true, force: true }); };
  return { db, tasks, routing, catalog, ollamaTags, parts, cleanup };
}

const until = async (check: () => boolean, label: string, detail?: () => unknown) => {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > 8000) throw new Error(`Timed out waiting for ${label}${detail ? `: ${JSON.stringify(detail())}` : ""}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};
const eventsOf = (env: Awaited<ReturnType<typeof t3Fixture>>, id: string) => env.db.taskEvents(id).map((event) => [event.type, event.detail] as const);
const contractEfforts = (provider: ProviderId): string[] => Object.values(PROVIDER_EFFORT_CONTRACTS[provider].native ?? {}).filter((value): value is string => typeof value === "string");

test("T3 §20/§35/§32: the launched configuration is the selected candidate, end to end, deterministically", async () => {
  const env = await t3Fixture(["codex"]);
  try {
    const task = env.tasks.submit({ prompt: FILE_TASK, mode: "balanced" });
    assert.equal(task.provider, "codex");
    assert.equal(task.model, "gpt-5.3");
    assert.equal(task.routingMode, "auto");
    assert.ok(task.effort != null && contractEfforts("codex").includes(task.effort), `codex never launches without its own native effort (got ${task.effort})`);
    // §18 additive fields on the task's RouteDecision, present only when the pipeline engaged.
    assert.equal(task.decision.policy_version, ROUTING_POLICY_VERSION);
    assert.equal(task.decision.routing_mode, "auto");
    assert.equal(task.decision.candidate_count, 2, "both catalogue models are candidates, exactly as discovered");
    assert.equal(task.decision.eligible_candidate_count, 2);
    assert.equal(task.decision.reroutes, 0);
    assert.ok(task.decision.task_requirements, "the classified requirements are carried on the decision");
    assert.equal(task.decision.task_requirements!.task_class, "tool_execution", "the manager classifies the run-and-verify prompt with its inferred constraints");
    assert.ok((task.decision.selection_reason ?? "").startsWith("tool_execution task → gpt-5.3 on codex."));
    assert.equal(task.decision.candidates?.length, 2);
    const record = env.routing.decision(task.routingDecisionId!)!;
    assert.equal(record.selected!.provider_id, "codex");
    assert.equal(record.selected!.model_id, "gpt-5.3");
    assert.equal(record.selected!.effort_native, task.effort);
    assert.equal(record.selected!.reason, task.decision.selection_reason);
    assert.equal(record.routing_mode, "auto");
    assert.equal(record.reroutes, 0);
    assert.equal(record.snapshot_references.find((row) => row.provider === "codex")!.models, 2);
    assert.ok(record.snapshot_references.find((row) => row.provider === "codex")!.probedThisRun);
    env.tasks.approve(task.id);
    await until(() => env.parts.codex.launched.length === 1, "codex launch", () => eventsOf(env, task.id).slice(-3));
    const launched = env.parts.codex.launched[0].task;
    assert.equal(launched.provider, "codex");
    assert.equal(launched.model, "gpt-5.3");
    assert.equal(launched.effort, record.selected!.effort_native, "§20: the decision record and the launched configuration are the same facts");
    assert.ok(eventsOf(env, task.id).some(([type, detail]) => type === "routing.selected" && detail === `Selected codex · gpt-5.3 · effort ${task.effort} from 2 eligible of 2 candidates.`));
    assert.ok(eventsOf(env, task.id).some(([type, detail]) => type === "routing.classified" && /Task class tool_execution; tools required; privacy unknown\./.test(detail)));
    assert.ok(eventsOf(env, task.id).some(([type, detail]) => type === "routing.revalidated" && /Launch revalidation passed for codex · gpt-5\.3\./.test(detail)));
    env.parts.codex.launched[0].finish({ ok: true, output: "done", exitCode: 0 });
    await until(() => env.db.get(task.id).state === "completed", "completion", () => env.db.get(task.id).error);
    assert.deepEqual(env.routing.attempts(task.id), [], "a first-pass completion records no recovery attempts");
    // §26/§32: the same inputs route the same way, with independent decision records.
    const twin = env.tasks.submit({ prompt: FILE_TASK, mode: "balanced" });
    assert.deepEqual({ provider: twin.provider, model: twin.model, effort: twin.effort }, { provider: task.provider, model: task.model, effort: task.effort });
    assert.notEqual(twin.routingDecisionId, task.routingDecisionId);
    assert.equal(env.routing.decision(twin.routingDecisionId!)!.selected!.model_id, "gpt-5.3");
  } finally { env.cleanup(); }
});

test("T3 §5 legacy parity: a fact-less Host routes exactly like pre-T3 BunnyRouter — no effort knob, no routing events, honest record", async () => {
  // Listing providers only: zero model facts means zero candidates (§9), so the legacy provider
  // decision stands byte-for-byte. (A Claude in the set always yields a §9 PROVIDER_DEFAULT candidate.)
  const env = await t3Fixture(["codex", "ollama"], true);
  try {
    const task = env.tasks.submit({ prompt: RESEARCH, mode: "balanced" });
    assert.equal(task.decision.policy_version ?? null, null, "the fallback decision is the untouched legacy RouteDecision");
    assert.equal(task.decision.candidates ?? null, null);
    assert.equal(task.decision.selection_reason ?? null, null);
    assert.equal(task.provider, task.decision.recommended_provider, "no pipeline rewrite of the provider");
    assert.equal(task.model, task.decision.recommended_model, "no pipeline rewrite of the model");
    assert.equal(task.effort, null, "pre-T3 behavior: no effort knob engages without model facts");
    assert.equal(task.routingMode, "auto");
    assert.equal(task.routingRerouted, false);
    // "routing.started" is the pre-T3 legacy event; every other routing.* event is T3-added.
    assert.ok(!eventsOf(env, task.id).some(([type]) => type.startsWith("routing.") && type !== "routing.started"), "fact-less hosts route silently beyond the legacy routing.started, exactly as before T3");
    const record = env.routing.decision(task.routingDecisionId!)!;
    assert.ok(record);
    assert.equal(record.selected ?? null, null);
    assert.equal(record.routing_mode, "auto");
    assert.equal(record.reroutes, 0);
    assert.equal(record.terminal_note, "No model facts on this Host; BunnyRouter provider decision stands.");
    env.tasks.approve(task.id);
    await until(() => env.parts[task.provider as ProviderId].launched.length === 1, "fallback launch");
    assert.equal(env.parts[task.provider as ProviderId].launched[0].task.model, task.model);
    env.parts[task.provider as ProviderId].launched[0].finish({ ok: true, output: "ok", exitCode: 0 });
    await until(() => env.db.get(task.id).state === "completed", "completion");
    assert.ok(!eventsOf(env, task.id).some(([type]) => type.startsWith("routing.") && type !== "routing.started"), "no T3 launch gate ran for the legacy path either");
  } finally { env.cleanup(); }
});

test("T3 §5/§27 MANUAL provider override on a fact-less Host: the legacy decision carries it; retarget keeps it explicit", async () => {
  const env = await t3Fixture(["codex", "ollama"], true);
  try {
    // §5/§36: a manual PROVIDER override never dies because Bunny cannot verify models — the
    // legacy BunnyRouter decision (which honors the provider) stands, documented in the record.
    // "Unknown stays unknown": no selection is claimed, no invented model facts, no effort (§11).
    const overridden = env.tasks.submit({ prompt: RESEARCH, mode: "balanced", override: "codex" });
    assert.equal(overridden.provider, "codex");
    assert.equal(overridden.effort, null, "no effort knob without routing facts (§11)");
    assert.equal(overridden.decision.policy_version ?? null, null);
    const overrideRecord = env.routing.decision(overridden.routingDecisionId!)!;
    assert.equal(overrideRecord.routing_mode, "manual");
    assert.equal(overrideRecord.selected ?? null, null);
    assert.equal(overrideRecord.terminal_note, "No model facts on this Host; BunnyRouter provider decision stands.");
    assert.equal(env.db.get(overridden.id).state, "waiting_for_approval");
    const task = env.tasks.submit({ prompt: RESEARCH, mode: "balanced" });
    assert.equal(task.decision.policy_version ?? null, null, "the fallback route is the legacy decision surface");
    const retargeted = env.tasks.retarget(task.id, "codex");
    assert.equal(retargeted.provider, "codex");
    assert.equal(retargeted.model, retargeted.decision.recommended_model);
    assert.equal(retargeted.effort, null);
    assert.equal(retargeted.manual, true);
    assert.equal(retargeted.routingMode, "manual");
    assert.equal(retargeted.decision.policy_version ?? null, null, "still the legacy decision surface; retarget never silently reroutes the model");
    const record = env.routing.decision(retargeted.routingDecisionId!)!;
    assert.equal(record.routing_mode, "manual");
    assert.equal(record.selected ?? null, null);
    assert.ok(record.terminal_note);
    assert.ok(!eventsOf(env, task.id).some(([type]) => ["routing.classified", "routing.selected", "routing.revalidated"].includes(type)));
  } finally { env.cleanup(); }
});

test("T3 §27/R29: a MANUAL exact model executes exactly that model", async () => {
  const env = await t3Fixture(["codex", "claude"]);
  try {
    const task = env.tasks.submit({ prompt: FILE_TASK, mode: "balanced", override: "codex", modelOverride: "gpt-5.3-codex" });
    assert.equal(task.provider, "codex");
    assert.equal(task.model, "gpt-5.3-codex");
    assert.equal(task.routingMode, "manual");
    assert.equal(task.manual, true);
    assert.ok(task.effort != null && contractEfforts("codex").includes(task.effort));
    const record = env.routing.decision(task.routingDecisionId!)!;
    assert.equal(record.selected!.model_id, "gpt-5.3-codex");
    assert.equal(record.routing_mode, "manual");
    // The pin is an eligibility rule: the un-pinned twin is recorded excluded with the exact reason.
    const pinned = record.candidates_considered.find((row) => row.model_id === "gpt-5.3")!;
    assert.equal(pinned.eligible, false);
    assert.deepEqual(pinned.exclusion_reasons, ["Manual selection targets a different model."]);
    assert.equal(record.candidates_considered.filter((row) => row.eligible).length, 1);
    env.tasks.approve(task.id);
    await until(() => env.parts.codex.launched.length === 1, "codex launch");
    const launched = env.parts.codex.launched[0].task;
    assert.equal(launched.model, "gpt-5.3-codex");
    env.parts.codex.launched[0].finish({ ok: true, output: "done", exitCode: 0 });
    await until(() => env.db.get(task.id).state === "completed", "completion");
    assert.equal(env.parts.codex.launched[0].task.model, record.selected!.model_id, "§20: the manual pin and the launched model are the same fact");
  } finally { env.cleanup(); }
});

test("T3 §27: an impossible manual selection fails clearly and persists nothing", async () => {
  const env = await t3Fixture(["codex", "claude"]);
  try {
    assert.throws(
      () => env.tasks.submit({ prompt: FILE_TASK, mode: "balanced", override: "codex", modelOverride: "never-listed-model" }),
      /No eligible model candidate for this Task\. Manual selection targets a different model\./,
    );
    assert.equal(env.db.tasks().length, 0);
  } finally { env.cleanup(); }
});

test("T3 §17/§27/R30: a MANUAL model that disappears before launch refuses the click and waits — never rerouted, never silent", async () => {
  const env = await t3Fixture(["codex", "claude"]);
  try {
    const task = env.tasks.submit({ prompt: FILE_TASK, mode: "balanced", override: "codex", modelOverride: "gpt-5.3-codex" });
    env.catalog.models = ["gpt-5.3"];
    env.parts.codex.state.models = ["gpt-5.3"];
    env.parts.codex.state.current_model = "gpt-5.3";
    await env.tasks.discover(); // The model vanished from the live catalogue between approval rounds.
    assert.throws(
      () => env.tasks.approve(task.id),
      /The selected codex model gpt-5\.3-codex is unavailable: Selected model gpt-5\.3-codex is no longer verified as listed by Codex\. Route again\./,
    );
    assert.equal(env.db.get(task.id).state, "waiting_for_approval", "the task waits instead of silently switching models");
    assert.equal(env.parts.codex.launched.length, 0, "nothing was spawned");
    const failed = eventsOf(env, task.id).find(([type]) => type === "routing.revalidated");
    assert.match(failed![1], /Launch revalidation failed: Selected model gpt-5\.3-codex is no longer verified as listed by Codex\./);
    assert.ok(!eventsOf(env, task.id).some(([type]) => type === "routing.rerouted"), "MANUAL selections never reroute (§5)");
    const record: RoutingDecisionRecord = env.routing.decision(task.routingDecisionId!)!;
    assert.equal(record.reroutes, 0);
  } finally { env.cleanup(); }
});

test("T3 §17/§28/R31: an AUTO task whose selected Codex evidence goes stale reroutes at launch to the next eligible candidate", async () => {
  const env = await t3Fixture(["codex", "claude"]);
  try {
    const task = env.tasks.submit({ prompt: REPO_TASK, mode: "balanced" });
    assert.equal(task.provider, "codex");
    assert.equal(task.model, "gpt-5.3", "repository_coding: the catalogue-preferred Codex model wins AUTO on the 91 coding rank");
    assert.equal(task.decision.task_requirements!.task_class, "repository_coding");
    // The evidence ages out (the MA2 binary gate's own freshness contract, mirrored fail-fast pre-launch).
    env.parts.codex.state.securityCompatibility = fixtureProfile(Date.now() - CODEX_COMPATIBILITY_MAX_AGE_MS - 1000);
    await env.tasks.discover();
    env.tasks.approve(task.id);
    await until(() => env.parts.claude.launched.length === 1, "rerouted launch", () => eventsOf(env, task.id).slice(-4));
    assert.equal(env.parts.codex.launched.length, 0, "the stale candidate never spawned");
    const launched = env.parts.claude.launched[0].task;
    assert.equal(launched.provider, "claude");
    assert.equal(launched.model, "auto", "a PROVIDER_DEFAULT fallback carries no pinned model id");
    const current = env.db.get(task.id);
    assert.equal(current.provider, "claude");
    assert.equal(current.model, "auto");
    assert.equal(current.routingRerouted, true);
    assert.equal(current.effort, null, "the claude adapter passes no effort knob (§11)");
    assert.equal(current.decision.reroutes, 1);
    const record = env.routing.decision(task.routingDecisionId!)!;
    assert.equal(record.reroutes, 1);
    assert.match(record.terminal_note!, /^Rerouted to claude · provider default: Codex security compatibility evidence is stale; refresh providers\.$/);
    const events = eventsOf(env, task.id);
    assert.ok(events.some(([type, detail]) => type === "routing.revalidated" && /Launch revalidation failed: Codex security compatibility evidence is stale/.test(detail)));
    assert.ok(events.some(([type, detail]) => type === "routing.rerouted" && /Launch revalidation failed \((.*)\); re-routed to claude · provider default\./.test(detail)));
    env.parts.claude.launched[0].finish({ ok: true, output: "done", exitCode: 0 });
    await until(() => env.db.get(task.id).state === "completed", "completion");
  } finally { env.cleanup(); }
});

test("T3 §22/R22: a quota-constrained attempt reroutes to the next candidate within the bounded recovery", async () => {
  const env = await t3Fixture(["codex", "claude"]);
  try {
    const task = env.tasks.submit({ prompt: RESEARCH, mode: "balanced" });
    assert.equal(task.provider, "claude", "research prefers Claude on policy priors");
    env.tasks.approve(task.id);
    await until(() => env.parts.claude.launched.length === 1, "claude launch");
    env.parts.claude.launched[0].finish({ ok: false, output: "", error: "usage limit reached (429)", exitCode: 1 });
    await until(() => env.parts.codex.launched.length === 1, "codex reroute", () => eventsOf(env, task.id).slice(-6));
    const relaunch = env.parts.codex.launched[0].task;
    assert.equal(relaunch.provider, "codex");
    assert.equal(relaunch.model, "gpt-5.3");
    assert.equal(relaunch.routingRerouted, true);
    assert.ok(relaunch.effort != null && contractEfforts("codex").includes(relaunch.effort));
    const current = env.db.get(task.id);
    assert.equal(current.provider, "codex");
    assert.equal(current.decision.reroutes, 1);
    const record = env.routing.decision(task.routingDecisionId!)!;
    assert.equal(record.reroutes, 1);
    const events = eventsOf(env, task.id);
    assert.ok(events.some(([type, detail]) => type === "routing.rerouted" && /Rerouted to codex · gpt-5\.3 after QUOTA_CONSTRAINED on claude/.test(detail)));
    assert.ok(events.some(([type, detail]) => type === "routing.retrying" && /Routing to codex · gpt-5\.3 after QUOTA_CONSTRAINED: Quota exhausted/.test(detail)));
    env.parts.codex.launched[0].finish({ ok: true, output: "done", exitCode: 0 });
    await until(() => env.db.get(task.id).state === "completed", "completion", () => env.db.get(task.id).error);
    const attempts = env.routing.attempts(task.id);
    assert.deepEqual(attempts.map((attempt) => [attempt.attemptIndex, attempt.taxonomy]), [[0, "QUOTA_CONSTRAINED"]]);
    assert.equal(attempts[0].provider, "claude");
    assert.equal(attempts[0].model, env.db.get(task.id).model === "auto" ? null : env.parts.claude.launched[0].task.model, "attempt identity matches the launched configuration");
    assert.equal(attempts[0].detail, "usage limit reached (429)");
  } finally { env.cleanup(); }
});

test("T3 §24/R24: a failed Bunny-A verification escalates the effort once on the same candidate, then exhausts honestly", async () => {
  const env = await t3Fixture(["codex"]);
  try {
    const task = env.tasks.submit({ prompt: REPO_TASK, mode: "balanced", verify: { kind: "file", name: "bunny_t3_verify.txt", expected: "BUNNY_OK" } });
    assert.equal(task.provider, "codex");
    env.tasks.approve(task.id);
    await until(() => env.parts.codex.launched.length === 1, "first attempt");
    const first = env.parts.codex.launched[0].task;
    assert.ok(first.effort != null && contractEfforts("codex").includes(first.effort), `launch effort ${first.effort} comes from the codex contract`);
    const ladder = contractEfforts("codex");
    // The file Bunny-A checks for is never written: both attempts fail verification, never execution.
    env.parts.codex.launched[0].finish({ ok: true, output: "done", exitCode: 0 });
    await until(() => env.parts.codex.launched.length === 2, "effort escalation", () => eventsOf(env, task.id).slice(-6));
    const second = env.parts.codex.launched[1].task;
    assert.equal(second.provider, "codex");
    assert.equal(second.model, first.model, "the escalation stays on the same candidate first");
    assert.equal(second.effort, ladder[ladder.indexOf(first.effort!) + 1] ?? null, "the effort ladder steps up exactly once");
    assert.equal(second.routingRerouted, false, "a same-candidate escalation is not a reroute");
    env.parts.codex.launched[1].finish({ ok: true, output: "done", exitCode: 0 });
    await until(() => env.db.get(task.id).state === "failed", "exhaustion", () => ({ state: env.db.get(task.id).state, events: eventsOf(env, task.id).slice(-3) }));
    const current = env.db.get(task.id);
    assert.match(current.error!, /all_eligible_models_failed \(codex · gpt-5\.3 → VERIFICATION_FAILED; codex · gpt-5\.3 → VERIFICATION_FAILED\) — all_eligible_models_failed after 1 attempt\(s\): verification failed after the single escalation\.$/);
    assert.match(current.error!, /^Bunny-A verification failed: .+ all_eligible_models_failed \(codex · gpt-5\.3 → VERIFICATION_FAILED; codex · gpt-5\.3 → VERIFICATION_FAILED\)/);
    assert.equal(current.verification?.passed, false, "the failed verification is retained as evidence");
    assert.equal(current.routingRerouted, false);
    assert.equal(current.decision.reroutes, 0, "escalating effort is not a reroute either");
    const attempts = env.routing.attempts(task.id);
    assert.deepEqual(
      attempts.map((attempt) => [attempt.attemptIndex, attempt.provider, attempt.model, attempt.taxonomy]),
      [[0, "codex", "gpt-5.3", "VERIFICATION_FAILED"], [1, "codex", "gpt-5.3", "VERIFICATION_FAILED"]],
    );
    const events = eventsOf(env, task.id);
    assert.ok(events.some(([type, detail]) => type === "routing.retrying" && /Re-executing codex · gpt-5\.3 at .* effort after a failed verification; Bunny-A verifies again on completion \(§24\)\./.test(detail)));
  } finally { env.cleanup(); }
});

test("T3 §5/§22/§23: a MANUAL selection retries its own candidate once and then fails instead of ever rerouting", async () => {
  const env = await t3Fixture(["codex", "claude"]);
  try {
    const task = env.tasks.submit({ prompt: FILE_TASK, mode: "balanced", override: "codex", modelOverride: "gpt-5.3-codex" });
    env.tasks.approve(task.id);
    await until(() => env.parts.codex.launched.length === 1, "manual launch");
    env.parts.codex.launched[0].finish({ ok: false, output: "", error: "transient network error ECONNRESET", exitCode: 1 });
    await until(() => env.parts.codex.launched.length === 2, "the single bounded same-candidate retry", () => eventsOf(env, task.id).slice(-4));
    const retried = env.parts.codex.launched[1].task;
    assert.equal(retried.provider, "codex");
    assert.equal(retried.model, "gpt-5.3-codex", "the retry stays on the pinned model");
    assert.equal(retried.routingRerouted, false);
    env.parts.codex.launched[1].finish({ ok: false, output: "", error: "I can't comply with that request.", exitCode: 1 });
    await until(() => env.db.get(task.id).state === "failed", "exhaustion", () => env.db.get(task.id).state);
    const current = env.db.get(task.id);
    assert.match(current.error!, /^I can't comply with that request\. all_eligible_models_failed \(codex · gpt-5\.3-codex → TRANSIENT_TRANSPORT; codex · gpt-5\.3-codex → PROVIDER_REFUSAL\) — Manual model selection is fixed; the task failed instead of re-routing\. Provider declined a Task Bunny's own policy allows; routing to an alternate candidate\.$/);
    assert.equal(current.routingRerouted, false);
    assert.equal(env.parts.claude.launched.length, 0, "a manual task never reroutes to a different candidate");
    const record: RoutingDecisionRecord = env.routing.decision(task.routingDecisionId!)!;
    assert.equal(record.reroutes, 0);
    const attempts = env.routing.attempts(task.id);
    assert.deepEqual(attempts.map((attempt) => [attempt.attemptIndex, attempt.provider, attempt.taxonomy]), [[0, "codex", "TRANSIENT_TRANSPORT"], [1, "codex", "PROVIDER_REFUSAL"]]);
    assert.ok(eventsOf(env, task.id).some(([type, detail]) => type === "routing.exhausted" && /all_eligible_models_failed \(codex · gpt-5\.3-codex → TRANSIENT_TRANSPORT; codex · gpt-5\.3-codex → PROVIDER_REFUSAL\)/.test(detail)));
  } finally { env.cleanup(); }
});