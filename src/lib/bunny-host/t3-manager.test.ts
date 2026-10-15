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
import { PROVIDER_EFFORT_CONTRACTS, ROUTING_POLICY, ROUTING_POLICY_VERSION, type RoutingDecisionRecord } from "./routing.server.ts";
import { toRecorded } from "./learning.server.ts";
import { taskStatus, UNCERTAIN_LABEL } from "./presentation.ts";
import { empiricalPoints, repick } from "./routing-feedback.ts";
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
    // T13.2: this recovery fixture explicitly authorizes both cloud destination vendors.
    await env.tasks.connections.command("connections.policy.set", {policy:{...env.tasks.connections.policy(),switchAllowlist:["openai","anthropic"]}}, "workstation");
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

test("T3 §22/R22: a quota-constrained READ attempt reroutes to the next candidate within the bounded recovery", async () => {
  const env = await t3Fixture(["codex", "claude"]);
  try {
    // T13.2: this recovery fixture explicitly authorizes both cloud destination vendors.
    await env.tasks.connections.command("connections.policy.set", {policy:{...env.tasks.connections.policy(),switchAllowlist:["openai","anthropic"]}}, "workstation");
    // T13.3 F4 (owner decision 2026-10-14): only declared read work reroutes on quota; unscoped work counts as write.
    const task = env.tasks.submit({ prompt: RESEARCH, mode: "balanced", executionScope: { access: "read" } });
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

test("T13.3 F §18: a quota-constrained WRITE attempt pauses instead of rerouting, even with the switch allowed", async () => {
  const env = await t3Fixture(["codex", "claude"]);
  try {
    await env.tasks.connections.command("connections.policy.set", {policy:{...env.tasks.connections.policy(),switchAllowlist:["openai","anthropic"]}}, "workstation");
    const task = env.tasks.submit({ prompt: RESEARCH, mode: "balanced", executionScope: { access: "write" } });
    assert.equal(task.provider, "claude");
    env.tasks.approve(task.id);
    await until(() => env.parts.claude.launched.length === 1, "claude launch");
    env.parts.claude.launched[0].finish({ ok: false, output: "", error: "usage limit reached (429)", exitCode: 1 });
    await until(() => env.db.get(task.id).state === "failed", "paused failure", () => eventsOf(env, task.id).slice(-6));
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(env.parts.codex.launched.length, 0, "no duplicate write on another provider");
    assert.match(env.db.get(task.id).error ?? "", /QUOTA_PAUSE/);
    assert.ok(!eventsOf(env, task.id).some(([type]) => type === "routing.rerouted"));
    assert.deepEqual(env.routing.attempts(task.id).map((attempt) => attempt.taxonomy), ["QUOTA_CONSTRAINED"], "the attempt is recorded accurately");
  } finally { env.cleanup(); }
});

test("T13.3 F4: an UNSCOPED direct task that hits quota pauses instead of rerouting (it may have written files)", async () => {
  const env = await t3Fixture(["codex", "claude"]);
  try {
    await env.tasks.connections.command("connections.policy.set", {policy:{...env.tasks.connections.policy(),switchAllowlist:["openai","anthropic"]}}, "workstation");
    // The exact reported case: a Chat or /submit task carries no executionScope.
    const task = env.tasks.submit({ prompt: RESEARCH, mode: "balanced" });
    assert.equal(env.db.get(task.id).executionScope, undefined);
    env.tasks.approve(task.id);
    await until(() => env.parts.claude.launched.length === 1, "claude launch");
    env.parts.claude.launched[0].finish({ ok: false, output: "", error: "usage limit reached (429)", exitCode: 1 });
    await until(() => env.db.get(task.id).state === "failed", "paused failure", () => eventsOf(env, task.id).slice(-6));
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(env.parts.codex.launched.length, 0, "no second provider repeats possibly-landed writes");
    assert.match(env.db.get(task.id).error ?? "", /QUOTA_PAUSE/);
    assert.ok(!eventsOf(env, task.id).some(([type]) => type === "routing.rerouted"));
  } finally { env.cleanup(); }
});

test("T13.3 N-C 1/2: after a connection failure declared read work retries and reroutes; unscoped work pauses at once with reconciliation", async () => {
  for (const scope of [undefined, { access: "read" as const }]) {
    const env = await t3Fixture(["codex", "claude"]);
    try {
      await env.tasks.connections.command("connections.policy.set", {policy:{...env.tasks.connections.policy(),switchAllowlist:["openai","anthropic"]}}, "workstation");
      const task = env.tasks.submit({ prompt: RESEARCH, mode: "balanced", ...(scope ? { executionScope: scope } : {}) });
      env.tasks.approve(task.id);
      await until(() => env.parts.claude.launched.length === 1, "first launch");
      env.parts.claude.launched[0].finish({ ok: false, output: "", error: "stream reset: socket hang up", exitCode: 1 });
      if (scope) {
        await until(() => env.parts.claude.launched.length === 2, "bounded same-candidate retry of read work");
        env.parts.claude.launched[1].finish({ ok: false, output: "", error: "request timed out", exitCode: 1 });
        await until(() => env.parts.codex.launched.length === 1, "read work reroutes", () => eventsOf(env, task.id).slice(-6));
        env.parts.codex.launched[0].finish({ ok: true, output: "done", exitCode: 0 });
        await until(() => env.db.get(task.id).state === "completed", "completion");
        assert.equal(env.db.get(task.id).reconciliation, undefined, "read work never needs reconciliation");
      } else {
        // The exact N-C case: a missing scope is treated as write, and a connection failure is not proof nothing landed.
        await until(() => env.db.get(task.id).state === "failed", "paused failure", () => eventsOf(env, task.id).slice(-6));
        await new Promise((resolve) => setTimeout(resolve, 80));
        assert.equal(env.parts.claude.launched.length, 1, "no same-provider replay");
        assert.equal(env.parts.codex.launched.length, 0, "no cross-provider replay");
        const paused = env.db.get(task.id);
        assert.match(paused.error ?? "", /WRITE_PAUSE/);
        assert.equal(paused.reconciliation?.required, true);
        assert.match(paused.reconciliation?.reason ?? "", /reconciliation required/);
        assert.equal(taskStatus(paused).label, UNCERTAIN_LABEL, "the owner sees the honest state");
      }
    } finally { env.cleanup(); }
  }
});

test("T13.3 N-C 4: a same-provider retry of write work is refused, even on a MANUAL pin", async () => {
  const env = await t3Fixture(["codex", "claude"]);
  try {
    const task = env.tasks.submit({ prompt: FILE_TASK, mode: "balanced", override: "codex", modelOverride: "gpt-5.3-codex", executionScope: { access: "write" } });
    env.tasks.approve(task.id);
    await until(() => env.parts.codex.launched.length === 1, "manual launch");
    env.parts.codex.launched[0].finish({ ok: false, output: "", error: "transient network error ECONNRESET", exitCode: 1 });
    await until(() => env.db.get(task.id).state === "failed", "paused", () => eventsOf(env, task.id).slice(-4));
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal(env.parts.codex.launched.length, 1, "the same provider and account are not asked twice");
    assert.equal(env.db.get(task.id).reconciliation?.required, true);
  } finally { env.cleanup(); }
});

test("T13.3 N-C 5: write work is not moved to another provider after any failure that may have started it", async () => {
  const env = await t3Fixture(["codex", "claude"]);
  try {
    await env.tasks.connections.command("connections.policy.set", {policy:{...env.tasks.connections.policy(),switchAllowlist:["openai","anthropic"]}}, "workstation");
    const task = env.tasks.submit({ prompt: RESEARCH, mode: "balanced" });
    env.tasks.approve(task.id);
    await until(() => env.parts.claude.launched.length === 1, "claude launch");
    // A provider refusal reroutes read work; for write work the attempt may already have acted before it refused.
    env.parts.claude.launched[0].finish({ ok: false, output: "", error: "I can't comply with that request.", exitCode: 1 });
    await until(() => env.db.get(task.id).state === "failed", "paused", () => eventsOf(env, task.id).slice(-4));
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal(env.parts.codex.launched.length, 0);
    assert.match(env.db.get(task.id).error ?? "", /OUTCOME_UNCERTAIN/);
    assert.ok(!eventsOf(env, task.id).some(([type]) => type === "routing.rerouted"));
  } finally { env.cleanup(); }
});

test("T13.3 N-C 6: a proven pre-dispatch failure earns exactly one bounded retry, and needs no reconciliation", async () => {
  const env = await t3Fixture(["codex", "claude"]);
  try {
    await env.tasks.connections.command("connections.policy.set", {policy:{...env.tasks.connections.policy(),switchAllowlist:["openai","anthropic"]}}, "workstation");
    const task = env.tasks.submit({ prompt: RESEARCH, mode: "balanced" });
    env.tasks.approve(task.id);
    await until(() => env.parts.claude.launched.length === 1, "claude launch");
    // The adapter certifies that no provider process was started (dispatched:false), as spawnSession does on a refused
    // authority check or a spawn error.
    env.parts.claude.launched[0].finish({ ok: false, output: "", error: "Provider dispatch refused: connection authority changed or could not be freshly verified.", dispatched: false });
    await until(() => env.parts.claude.launched.length + env.parts.codex.launched.length === 2, "the one bounded retry", () => eventsOf(env, task.id).slice(-6));
    const second = env.parts.codex.launched[0] ?? env.parts.claude.launched[1];
    second.finish({ ok: false, output: "", error: "Provider dispatch refused: connection authority changed or could not be freshly verified.", dispatched: false });
    await until(() => env.db.get(task.id).state === "failed", "bounded failure", () => eventsOf(env, task.id).slice(-6));
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal(env.parts.claude.launched.length + env.parts.codex.launched.length, 2, "exactly one retry");
    assert.match(env.db.get(task.id).error ?? "", /nothing was sent/);
    assert.equal(env.db.get(task.id).reconciliation, undefined, "nothing started, so nothing is uncertain");
  } finally { env.cleanup(); }
});

test("T3 §24/R24: a failed Bunny-A verification escalates the effort once on the same candidate, then exhausts honestly", async () => {
  const env = await t3Fixture(["codex"]);
  try {
    // T13.3 N-C baseline change: verification retry is write replay unless the work is read-only, so R24 now declares read scope.
    const task = env.tasks.submit({ prompt: REPO_TASK, mode: "balanced", executionScope: { access: "read" }, verify: { kind: "file", name: "bunny_t3_verify.txt", expected: "BUNNY_OK" } });
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

test("T13.3 N-C review F4: write work that fails Bunny-A verification pauses for reconciliation instead of re-executing", async () => {
  const env = await t3Fixture(["codex"]);
  try {
    const task = env.tasks.submit({ prompt: REPO_TASK, mode: "balanced", verify: { kind: "file", name: "bunny_t3_verify.txt", expected: "BUNNY_OK" } });
    env.tasks.approve(task.id);
    await until(() => env.parts.codex.launched.length === 1, "first attempt");
    env.parts.codex.launched[0].finish({ ok: true, output: "done", exitCode: 0 });
    await until(() => env.db.get(task.id).state === "failed", "paused", () => eventsOf(env, task.id).slice(-4));
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal(env.parts.codex.launched.length, 1, "the finished write attempt is not re-executed at a higher effort");
    const paused = env.db.get(task.id);
    assert.deepEqual([paused.reconciliation?.required, paused.verification?.passed], [true, false], "the failed check is kept as evidence");
    assert.match(paused.reconciliation?.reason ?? "", /VERIFY/);
    assert.equal(paused.dispatch, "may_have_started", "a failed check is not a verified terminal outcome (review round 2 N8)");
  } finally { env.cleanup(); }
});

test("T3 §5/§22/§23: a MANUAL selection retries its own candidate once and then fails instead of ever rerouting", async () => {
  const env = await t3Fixture(["codex", "claude"]);
  try {
    // T13.3 N-C (owner decision 2026-10-14): the same-candidate retry is kept for declared read work only; unscoped work
    // counts as write and pauses instead ("T13.3 N-C: same-provider ..."). This baseline therefore declares read.
    const task = env.tasks.submit({ prompt: FILE_TASK, mode: "balanced", override: "codex", modelOverride: "gpt-5.3-codex", executionScope: { access: "read" } });
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

test("T13.3 G §20: a shadow policy scores every live decision beside it and never changes what is dispatched", async () => {
  const env = await t3Fixture(["codex", "claude", "ollama"]);
  try {
    const control = env.tasks.submit({ prompt: RESEARCH, mode: "balanced" });
    const controlRecord = env.routing.decision(control.routingDecisionId!)!;
    // Verified history only in this task type's bucket: the shadow policy (per task type) sees it, the base policy does not.
    for (let n = 0; n < 6; n++)
      env.db.outcome({ id: `seed-${n}`, provider: "claude", decision: { task_type: control.decision.task_type, complexity: 0.5, scores: [] }, state: "completed", verification: { passed: false, detail: "fixture" }, startedAt: NOW, finishedAt: NOW + 1000, mode: "balanced", model: null } as unknown as OrchTask);
    // SIMULATED gate passage: an extreme per-task-type policy is placed in shadow directly; the gate has its own tests.
    const shadowWeights = { historyWeight: 2, latencyWeight: 0.05, perTaskType: true };
    env.db.db.prepare("INSERT INTO policies VALUES(?,?,?,?)").run("shadow-fixture", JSON.stringify({ id: "shadow-fixture", workloadWeight: 0, ...shadowWeights }), JSON.stringify({ regressions: 0, promotable: true }), env.tasks.policy.active().id);
    env.db.db.prepare("INSERT INTO policy_lifecycle(policy_id,state,proposed_by,created_at,shadow_started_at) VALUES('shadow-fixture','shadow','owner',?,?)").run(NOW, NOW);
    assert.equal(env.tasks.policy.shadowPolicy()!.id, "shadow-fixture");

    const task = env.tasks.submit({ prompt: RESEARCH, mode: "balanced" });
    assert.deepEqual({ provider: task.provider, model: task.model, effort: task.effort }, { provider: control.provider, model: control.model, effort: control.effort }, "dispatch is identical with and without a shadow run");
    const record = env.routing.decision(task.routingDecisionId!)!;
    assert.deepEqual(record.candidates_considered.map((row) => [row.provider_id, row.model_id, row.score]), controlRecord.candidates_considered.map((row) => [row.provider_id, row.model_id, row.score]));
    const row = env.db.db.prepare("SELECT * FROM policy_shadow WHERE decision_id=?").get(task.routingDecisionId!) as { policy_id: string; task_id: string; live_provider: string; live_model: string; shadow_provider: string | null; shadow_model: string | null };
    assert.deepEqual([row.policy_id, row.task_id, row.live_provider, row.live_model], ["shadow-fixture", task.id, record.selected!.provider_id, record.selected!.model_id]);
    const signal = env.tasks.policy.learningSignal();
    const livePoints = (provider: ProviderId, weights: ReturnType<typeof env.tasks.policy.liveWeights>) => empiricalPoints(signal(provider, task.decision.task_type, "balanced", weights), ROUTING_POLICY.weights.empirical);
    assert.notEqual(livePoints("claude", shadowWeights), livePoints("claude", env.tasks.policy.liveWeights()), "the seeded evidence separates the two policies");
    assert.deepEqual(
      record.candidates_considered.map((row) => toRecorded(row).empirical),
      record.candidates_considered.map((row) => livePoints(row.provider_id, env.tasks.policy.liveWeights())),
      "every live score carries the accepted policy's empirical points, never the shadow's",
    );
    const expected = repick(record.candidates_considered.map(toRecorded), (candidate) => empiricalPoints(signal(candidate.provider, task.decision.task_type, "balanced", shadowWeights), ROUTING_POLICY.weights.empirical));
    assert.deepEqual({ provider: row.shadow_provider, model: row.shadow_model }, { provider: expected!.provider, model: expected!.model }, "the shadow pick is the candidate policy replayed on this decision's own scores");
    assert.equal(env.db.db.prepare("SELECT COUNT(*) n FROM policy_shadow WHERE decision_id=?").get(control.routingDecisionId!)!.n, 0, "no shadow row before the run started");

    env.tasks.approve(task.id);
    await until(() => env.parts[task.provider as ProviderId].launched.length === 1, "launch under shadow");
    const launched = env.parts[task.provider as ProviderId].launched[0].task;
    assert.deepEqual([launched.provider, launched.model], [record.selected!.provider_id, task.model], "the launched configuration is the live selection");
    env.parts[task.provider as ProviderId].launched[0].finish({ ok: true, output: "done", exitCode: 0 });
    await until(() => env.db.get(task.id).state === "completed", "completion");
    const shadow = env.tasks.policy.view().candidates.find((candidate) => candidate.id === "shadow-fixture")!.shadow!;
    assert.deepEqual([shadow.decisions, shadow.verified], [1, 0], "a completed but unverified Task is not verified evidence");
  } finally { env.cleanup(); }
});
test("T13.3 N-C 9: a restart preserves an uncertain outcome and turns an interrupted write attempt into one", async () => {
  const env = await t3Fixture(["codex", "claude"]);
  const restarted: TaskManager[] = [];
  try {
    const uncertain = env.tasks.submit({ prompt: RESEARCH, mode: "balanced" });
    env.tasks.approve(uncertain.id);
    await until(() => env.parts.claude.launched.length === 1, "launch");
    env.parts.claude.launched[0].finish({ ok: false, output: "", error: "stream reset", exitCode: 1 });
    await until(() => env.db.get(uncertain.id).reconciliation?.required === true, "uncertain");
    // Two attempts are still running when the Host stops: one may write, one is declared read.
    const writing = env.tasks.submit({ prompt: RESEARCH, mode: "balanced" });
    const reading = env.tasks.submit({ prompt: RESEARCH, mode: "balanced", executionScope: { access: "read" } });
    env.tasks.approve(writing.id);
    env.tasks.approve(reading.id);
    await until(() => env.parts.claude.launched.length === 3, "both running");
    env.tasks.dispose();
    const next = new TaskManager(env.db, env.tasks.defaultRoot, [], { modelRegistry: new ModelCapabilityRegistry(env.db, { availableProviders: () => [] }) });
    restarted.push(next);
    assert.equal(next.db.get(uncertain.id).reconciliation?.required, true, "a restart never clears an uncertain outcome");
    assert.equal(next.db.get(writing.id).state, "failed");
    assert.equal(next.db.get(writing.id).reconciliation?.required, true, "an interrupted write attempt may already have taken effect");
    assert.match(next.db.get(writing.id).reconciliation?.reason ?? "", /Host restarted/);
    assert.equal(next.db.get(reading.id).reconciliation, undefined, "an interrupted read attempt needs no reconciliation");
    // The old process's sessions end now; a late result never revives a task the restart already settled.
    for (const row of env.parts.claude.launched.slice(1)) row.finish({ ok: true, output: "late", exitCode: 0 });
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal(next.db.get(writing.id).state, "failed");
    assert.equal(next.db.get(writing.id).reconciliation?.required, true);
  } finally { for (const manager of restarted) manager.dispose(); env.cleanup(); }
});

test("T13.3 N-C 10/11: reconciliation is explicit; a retry is a linked task pinned to the same destination that waits for a fresh approval and can be cancelled", async () => {
  const env = await t3Fixture(["codex", "claude"]);
  try {
    const fail = async (task: OrchTask, index: number) => {
      env.tasks.approve(task.id);
      await until(() => env.parts.claude.launched.length === index + 1, "launch");
      env.parts.claude.launched[index].finish({ ok: false, output: "", error: "stream reset", exitCode: 1 });
      await until(() => env.db.get(task.id).reconciliation?.required === true, "uncertain");
    };
    const original = env.tasks.submit({ prompt: RESEARCH, mode: "balanced" });
    await fail(original, 0);
    assert.throws(() => env.tasks.reconcile(original.id, "replay", "workstation"), /retry or close/);
    const done = env.tasks.submit({ prompt: RESEARCH, mode: "balanced", executionScope: { access: "read" } });
    env.tasks.approve(done.id);
    await until(() => env.parts.claude.launched.length === 2, "read launch");
    env.parts.claude.launched[1].finish({ ok: true, output: "ok", exitCode: 0 });
    await until(() => env.db.get(done.id).state === "completed", "completed");
    assert.throws(() => env.tasks.reconcile(done.id, "retry", "workstation"), /no uncertain outcome/);

    const { task, retry } = env.tasks.reconcile(original.id, "retry", "workstation");
    assert.ok(retry);
    assert.equal(task.state, "failed", "the original keeps its identity and history; a terminal task never reopens");
    assert.deepEqual([task.reconciliation?.required, task.reconciliation?.resolution, task.reconciliation?.resolvedBy, task.reconciliation?.retryTaskId], [false, "retry", "workstation", retry.id]);
    assert.equal(retry.state, "waiting_for_approval", "a fresh approval is required; the old approval is never reused");
    assert.deepEqual([retry.provider, retry.routingMode], [env.db.get(original.id).provider, "manual"], "the destination stays pinned");
    assert.deepEqual(retry.executionScope, original.executionScope);
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(env.parts.claude.launched.length, 2, "nothing launched before the approval");
    assert.throws(() => env.tasks.reconcile(original.id, "retry", "workstation"), /no uncertain outcome/, "one reconciliation per outcome");
    env.tasks.approve(retry.id);
    await until(() => env.parts.claude.launched.length === 3, "approved retry launches on the pinned provider");
    assert.equal(env.parts.codex.launched.length, 0);
    await env.tasks.stop(retry.id, "Owner cancelled the retry.");
    await until(() => env.db.get(retry.id).state === "stopped", "cancellation still works");
    // Review F9 baseline change: stopping a launched write attempt cannot prove the provider did nothing, so the stop leaves it
    // uncertain (the cancellation itself still works) and it can be reconciled again rather than silently forgotten.
    assert.deepEqual([env.db.get(retry.id).reconciliation?.required, env.db.get(retry.id).dispatch], [true, "may_have_started"], "a cancelled launched write is uncertain, not proven failed");
    assert.equal(taskStatus(env.db.get(retry.id)).label, UNCERTAIN_LABEL);
    const closedRetry = env.tasks.reconcile(retry.id, "close", "workstation");
    assert.deepEqual([closedRetry.task.state, closedRetry.task.reconciliation?.resolution, closedRetry.retry], ["stopped", "close", null], "a stopped uncertain task is closed without reopening");

    const closed = env.tasks.submit({ prompt: RESEARCH, mode: "balanced" });
    await fail(closed, 3);
    const result = env.tasks.reconcile(closed.id, "close", "workstation");
    assert.equal(result.retry, null);
    assert.deepEqual([result.task.state, result.task.reconciliation?.resolution], ["failed", "close"]);
  } finally { env.cleanup(); }
});

test("T13.3 N-C review F15: an UNSCOPED task on a MANUAL pin is write work and its same-provider retry is refused", async () => {
  const env = await t3Fixture(["codex", "claude"]);
  try {
    const task = env.tasks.submit({ prompt: RESEARCH, mode: "balanced", override: "codex", modelOverride: "gpt-5.3-codex" });
    env.tasks.approve(task.id);
    await until(() => env.parts.codex.launched.length === 1, "manual launch");
    env.parts.codex.launched[0].finish({ ok: false, output: "", error: "stream reset: socket hang up", exitCode: 1 });
    await until(() => env.db.get(task.id).state === "failed", "paused", () => eventsOf(env, task.id).slice(-4));
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal(env.parts.codex.launched.length, 1, "no same-provider replay of unscoped work");
    assert.deepEqual([env.db.get(task.id).reconciliation?.required, env.db.get(task.id).dispatch], [true, "may_have_started"]);
  } finally { env.cleanup(); }
});

test("T13.3 N-C review F2/F9: a Host fault or a stop during launched write work leaves it uncertain; read work stays settled", async () => {
  const env = await t3Fixture(["codex", "claude"]);
  try {
    const writing = env.tasks.submit({ prompt: RESEARCH, mode: "balanced" });
    const reading = env.tasks.submit({ prompt: RESEARCH, mode: "balanced", executionScope: { access: "read" } });
    const stopping = env.tasks.submit({ prompt: RESEARCH, mode: "balanced" });
    for (const task of [writing, reading, stopping]) env.tasks.approve(task.id);
    await until(() => env.parts.claude.launched.length === 3, "all running");
    await env.tasks.failOperation(writing.id, { name: "Error", message: "Unexpected Host boundary failure." });
    await env.tasks.failOperation(reading.id, { name: "Error", message: "Unexpected Host boundary failure." });
    await env.tasks.stop(stopping.id, "Owner stopped it.");
    await until(() => env.db.get(stopping.id).state === "stopped", "stopped");
    assert.deepEqual([env.db.get(writing.id).state, env.db.get(writing.id).reconciliation?.required, env.db.get(writing.id).dispatch], ["failed", true, "may_have_started"]);
    assert.match(env.db.get(writing.id).reconciliation?.reason ?? "", /OUTCOME_UNCERTAIN/);
    assert.equal(env.db.get(reading.id).reconciliation, undefined, "a read attempt that faulted needs no reconciliation");
    assert.equal(env.db.get(stopping.id).reconciliation?.required, true, "a stop does not prove the provider did nothing");
    assert.equal(taskStatus(env.db.get(stopping.id)).label, UNCERTAIN_LABEL);
    // A provider that ends its own session as stopped (no Host stop call) is recorded the same way by the attempt loop.
    const selfStopped = env.tasks.submit({ prompt: RESEARCH, mode: "balanced" });
    env.tasks.approve(selfStopped.id);
    await until(() => env.parts.claude.launched.length === 4, "fourth launch");
    env.parts.claude.launched[3].finish({ ok: false, output: "", stopped: true });
    await until(() => env.db.get(selfStopped.id).state === "stopped", "self-stopped");
    assert.deepEqual([env.db.get(selfStopped.id).reconciliation?.required, env.db.get(selfStopped.id).dispatch], [true, "may_have_started"]);
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal(env.parts.claude.launched.length + env.parts.codex.launched.length, 4, "nothing was replayed");
  } finally { env.cleanup(); }
});

test("T13.3 N-C review F7: a reconcile retry waits while a process of the original attempt may still be alive", async () => {
  const env = await t3Fixture(["codex", "claude"]);
  try {
    const task = env.tasks.submit({ prompt: RESEARCH, mode: "balanced" });
    env.tasks.approve(task.id);
    await until(() => env.parts.claude.launched.length === 1, "launch");
    env.parts.claude.launched[0].finish({ ok: false, output: "", error: "stream reset", exitCode: 1 });
    await until(() => env.db.get(task.id).reconciliation?.required === true, "uncertain");
    for (const [key, owner] of [[`${task.id}#1`, null], ["restart:op-1", { missionId: null, taskId: task.id }], ["unreadable:op-2.json", null]] as const) {
      env.tasks.lingering.set(key, "checking");
      if (owner) env.tasks.restartSurvivorMission.set(key, owner);
      assert.throws(() => env.tasks.reconcile(task.id, "retry", "workstation"), /may still be running/);
      assert.equal(env.db.get(task.id).reconciliation?.required, true, "a refused retry records no decision");
      env.tasks.lingering.delete(key); env.tasks.restartSurvivorMission.delete(key);
    }
    assert.ok(env.tasks.reconcile(task.id, "retry", "workstation").retry, "once nothing may be alive, the retry is accepted");
  } finally { env.cleanup(); }
});

test("T13.3 N-C review F11: a tool-free provider cannot write, so its failed attempt is never uncertain and keeps the bounded retry", async () => {
  const env = await t3Fixture(["ollama"]);
  try {
    const task = env.tasks.submit({ prompt: RESEARCH, mode: "balanced", override: "ollama" });
    env.tasks.approve(task.id);
    await until(() => env.parts.ollama.launched.length === 1, "ollama launch");
    env.parts.ollama.launched[0].finish({ ok: false, output: "", error: "stream reset: socket hang up", exitCode: 1 });
    await until(() => env.parts.ollama.launched.length === 2, "bounded retry of tool-free work", () => eventsOf(env, task.id).slice(-4));
    env.parts.ollama.launched[1].finish({ ok: true, output: "done", exitCode: 0 });
    await until(() => env.db.get(task.id).state === "completed", "completion");
    assert.equal(env.db.get(task.id).reconciliation, undefined);
  } finally { env.cleanup(); }
});

test("T13.3 N-C review round 2 N4: a launch that throws before any process records not_started and needs no reconciliation", async () => {
  const env = await t3Fixture(["claude"]);
  try {
    env.parts.claude.adapter.launch = () => { throw new Error("adapter could not prepare the session"); };
    const task = env.tasks.submit({ prompt: RESEARCH, mode: "balanced" });
    env.tasks.approve(task.id);
    await until(() => env.db.get(task.id).state === "failed", "launch failure");
    assert.deepEqual([env.db.get(task.id).dispatch, env.db.get(task.id).reconciliation], ["not_started", undefined]);
  } finally { env.cleanup(); }
});
