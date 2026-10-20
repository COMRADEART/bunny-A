import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { createServer } from "node:net";
import { HostDatabase } from "./persistence.server.ts";
import { TaskManager } from "./manager.server.ts";
import { ModelCapabilityRegistry } from "./model-capability.server.ts";
import type { ModelCapabilityRecord } from "./model-capability.server.ts";
import { TestProtector, DpapiProtector } from "./jev-secrets.server.ts";
import { providerBase } from "./adapters.server.ts";
import { buildCandidates, selectRoutingCandidate, type CandidateInput } from "./routing.server.ts";
import { classifyRequirements } from "../orch/router-requirements.ts";
import type { OrchTask, ProviderId, TaskConstraints } from "../orch/types.ts";
import type { AdapterHooks } from "./contracts.ts";
import { DEFAULT_CONFIGURATION, loadConfiguration, modelExclusion, parseOpenRouterModels } from "./ma4/registry.ts";
import { IntelligenceStore } from "./ma4/store.server.ts";
import { CompatibleProvider, InferenceError, boundedJson, redactOutput, retryAfter, retryDelay } from "./ma4/transport.server.ts";
import { AdmissionQueue, OpenRouterAdapter } from "./ma4/adapter.server.ts";
import { EvaluationEngine, BENCHMARK_VERSION } from "./ma4/evaluation.server.ts";
import { applySelection, ownerDirective } from "./ma4/selection.ts";
import { analyzeModelTask } from "./ma4/analyzer.ts";
import { MissionManager } from "../bunny-missions/manager.server.ts";
import { planMission } from "../bunny-missions/planner.server.ts";
import { startHost, validateConstraints } from "./http.server.ts";

const MODEL = "fixture/code:free", KEY = "sk-or-v1-MA4_FIXTURE_ONLY_0123456789";
const CONFIG = { ...DEFAULT_CONFIGURATION, enabled: true, models: [MODEL], upstreams: ["fixture"], evaluationsAllowed: true };
const catalogue = (id = MODEL) => ({ data: [{ id, context_length: 131072, top_provider: { max_completion_tokens: 4096 },
  architecture: { input_modalities: ["text"], output_modalities: ["text"] }, supported_parameters: ["response_format"], pricing: { prompt: "0", completion: "0" } }] });
const reply = (content = "Fixture answer", finish = "stop", model = MODEL) => new Response(JSON.stringify({ model,
  choices: [{ message: { content }, finish_reason: finish }], usage: { prompt_tokens: 7, completion_tokens: 3 } }), { status: 200 });
const request = (patch: Partial<Parameters<CompatibleProvider["generate"]>[0]> = {}) => ({ requestId: "r", model: MODEL, prompt: "hello", maxTokens: 64, timeoutMs: 1000, ...patch });
function fixture() {
  const db = new HostDatabase(":memory:"); const store = new IntelligenceStore(db);
  store.replaceModels(parseOpenRouterModels(catalogue()));
  store.configure(CONFIG);
  return { db, store };
}
const hooks = (events: string[] = [], output: string[] = []): AdapterHooks => ({ beforeDispatch: async () => {}, event: type => events.push(type), output: text => output.push(text), session: () => {} });
const task = (constraints: TaskConstraints = {}): OrchTask => ({ id: "task", model: MODEL, prompt: "hello", maxRuntimeMs: 1000, constraints, inferencePolicy: createHash("sha256").update(JSON.stringify(CONFIG)).digest("hex") } as OrchTask);
const requirements = { contextTokens: 100, outputTokens: 100, structured: false, tools: false, input: ["text"] as ["text"], language: null, sensitive: false };

test("MA4 registry: discovered models disabled, provenance explicit, configuration version strict and corrupt saved config fails closed", () => {
  const { db, store } = fixture();
  try {
    const models = parseOpenRouterModels(catalogue()); assert.equal(models[0].enabled, false); assert.equal(models[0].tier, "rate-limited-free");
    assert.equal(models[0].evidence, "provider-reported"); assert.equal(models[0].tools, false);
    assert.equal(parseOpenRouterModels({ data: [{ id: "untrusted", pricing: { prompt: "unknown", completion: "unknown" } }] })[0].tier, "unknown");
    assert.throws(() => loadConfiguration({ ...DEFAULT_CONFIGURATION, version: 2 }));
    assert.throws(() => loadConfiguration({ ...DEFAULT_CONFIGURATION, maxConcurrent: 99 }));
    assert.throws(() => loadConfiguration({ ...DEFAULT_CONFIGURATION, apiKey: KEY }));
    db.db.prepare("UPDATE settings SET value='broken' WHERE key='ma4_config_v1'").run(); assert.equal(store.configuration().enabled, false);
  } finally { db.close(); }
});

test("MA4 privacy/capabilities: sensitive, unapproved, stale, language, modality, tools, structured and context mismatches rejected", () => {
  const { db, store } = fixture();
  try {
    const m = store.models()[0]; assert.equal(modelExclusion(m, requirements), null);
    assert.match(modelExclusion(m, { ...requirements, sensitive: true })!, /local/);
    assert.match(modelExclusion({ ...m, enabled: false }, requirements)!, /approval/);
    assert.match(modelExclusion(m, { ...requirements, input: ["audio"] })!, /modality/);
    assert.match(modelExclusion(m, { ...requirements, tools: true })!, /Tool/);
    assert.match(modelExclusion({ ...m, structured: null }, { ...requirements, structured: true })!, /Structured/);
    assert.match(modelExclusion(m, { ...requirements, language: "French" })!, /language/);
    assert.match(modelExclusion(m, { ...requirements, contextTokens: 200000 })!, /context/);
    assert.equal(store.models(Date.now() + 25 * 60 * 60_000)[0].enabled, false);
    assert.equal(classifyRequirements({ prompt: "Here is a patient record" }).privacy_requirement, "local_only");
  } finally { db.close(); }
});

function routing(extra: Partial<CandidateInput> = {}) {
  const fact = (provider: ProviderId, model: string): ModelCapabilityRecord => ({ provider, model, local: provider === "ollama", contextWindow: 131072, toolCalling: false, vision: false, source: "mock probe", probedAt: Date.now(), evidence: [] });
  const input: CandidateInput = { providers: (["ollama", "openrouter"] as const).map(id => ({ ...providerBase(id), installed: true, authenticated: true, availability: "ready", models: [id === "ollama" ? "local" : MODEL] })),
    modelSnapshot: { providers: (["ollama", "openrouter"] as const).map(provider => ({ provider, probedThisRun: true, probedAt: Date.now(), models: [fact(provider, provider === "ollama" ? "local" : MODEL)] })) },
    usage: { providers: [] }, requirements: classifyRequirements({ prompt: "Explain gravity" }), constraints: {}, override: "auto", mode: "balanced", ...extra };
  return { input, candidates: buildCandidates(input), decision: selectRoutingCandidate({ candidates: buildCandidates(input), requirements: input.requirements }) };
}
test("MA4 routing: automatic eligible/local choice, manual provider/model hard pins and no silent fallback when pinned model unavailable", () => {
  assert.equal(routing().decision.selected?.provider_id, "ollama");
  assert.equal(routing({ override: "openrouter", modelOverride: MODEL }).decision.selected?.model_id, MODEL);
  assert.equal(routing({ override: "openrouter", modelOverride: "unavailable" }).decision.selected, null);
  assert.equal(routing({ constraints: { sensitive: true } }).decision.selected?.provider_id, "ollama");
  assert.equal(routing({ connectionGate: p => p === "openrouter" ? "Unapproved external provider" : null }).decision.selected?.provider_id, "ollama");
  assert.equal(routing({ constraints: { requiresAudio: true } }).decision.selected, null);
  assert.equal(routing({ override: "openrouter", requirements: classifyRequirements({ prompt: "run a command" }) }).decision.selected, null);
});

test("MA4 task analyzer: validated categories, capabilities, sensitivity and bounded-agent hint reuse MA3 classification", () => {
  for (const [prompt, category] of [["debug this function", "debugging"], ["summarize this", "summarization"], ["plan a release", "planning"], ["calculate 2+2", "mathematics"], ["research gravity", "research"], ["implement a function", "coding"]]) {
    assert.equal(analyzeModelTask({ prompt }).analysis.category, category);
  }
  const a = analyzeModelTask({ prompt: "build and test", mode: "deep", constraints: { sensitive: true, outputTokens: 300, language: "en" } });
  assert.equal(a.analysis.multipleAgentsSuggested, true); assert.equal(a.analysis.sensitivity, "local-only");
  assert.equal(a.analysis.required.outputTokens, 300); assert.equal(a.analysis.required.language, "en");
  assert.equal(a.analysis.maximumUsd, null); assert.equal(analyzeModelTask({ prompt: "hello" }).analysis.multipleAgentsSuggested, false);
});

test("MA4 model selection: leading owner directive, task and per-agent pins, conflicting scope rejected; tools unchanged", () => {
  assert.equal(ownerDirective("Bunny, use Claude for this entire task.")?.task?.provider, "claude");
  assert.equal(ownerDirective('Summarize this quote: "use Claude for this task"'), null);
  assert.equal(ownerDirective("Bunny, use Claude for coding, but select the best available model for testing.")?.agents.Coding.provider, "claude");
  const base = { complexity: "simple" as const, rationale: [], steps: [{ key: "code", role: "Coding", executor: { kind: "model" as const }, providerConstraints: {}, modelConstraint: null },
    { key: "test", role: "Testing", executor: { kind: "model" as const }, providerConstraints: {}, modelConstraint: null },
    { key: "tool", role: "Tool", executor: { kind: "capability" as const, action: "x", params: {} }, providerConstraints: {}, modelConstraint: null }] } as unknown as ReturnType<typeof planMission>;
  const all = applySelection(base, { task: { provider: "claude" }, agents: {} });
  assert.deepEqual(all.steps[0].providerConstraints.allow, ["claude"]); assert.deepEqual(all.steps[1].providerConstraints.allow, ["claude"]); assert.equal(all.steps[2], base.steps[2]);
  const hybrid = applySelection(base, { agents: { code: { provider: "openrouter", model: MODEL } } });
  assert.equal(hybrid.steps[0].modelConstraint, MODEL); assert.equal(hybrid.steps[1].modelConstraint, null);
  assert.throws(() => applySelection(base, { task: { provider: "claude" }, agents: { code: { provider: "openrouter", model: MODEL } } }), /conflicts/);
  assert.throws(() => applySelection(base, { agents: { MissingRole: { provider: "claude" } } }), /absent/);
});

test("MA4 transport contract: exact model, explicit unsupported stream, usage, JSON validation and secret redaction", async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const transport = new CompatibleProvider("https://approved.example/v1", async () => KEY, async (url, init) => { calls.push({ url: String(url), init }); return reply(`Echo ${KEY} Bearer another-secret`); });
  const result = await transport.generate(request());
  assert.equal(result.text.includes(KEY), false); assert.equal(result.text.includes("another-secret"), false); assert.equal(result.inputTokens, 7);
  assert.equal(new Headers(calls[0].init?.headers).get("Authorization"), `Bearer ${KEY}`);
  assert.equal(JSON.parse(String(calls[0].init?.body)).model, MODEL);
  await assert.rejects(async () => { for await (const _ of transport.stream(request())) {} }, /unsupported/);
  assert.throws(() => new CompatibleProvider("http://untrusted.example/v1", async () => KEY));
  for (const response of [reply("bad", "length"), reply("bad", "error"), reply("bad", "stop", "different"), new Response('{"error":{"message":"private prompt"}}')]) {
    const p = new CompatibleProvider("https://approved.example/v1", async () => KEY, async () => response); await assert.rejects(p.generate(request()), InferenceError);
  }
  const p = new CompatibleProvider("https://approved.example/v1", async () => KEY, async () => reply("not JSON"));
  await assert.rejects(p.generate(request({ structured: true })), /422/);
});

test("MA4 rate limit: Retry-After date/seconds floors, bounded jitter/backoff, no retry storm, cooldown survives restart", async () => {
  assert.equal(retryAfter("7"), 7000); assert.equal(retryAfter("garbage"), null);
  assert.equal(retryAfter("Wed, 21 Oct 2026 00:00:00 GMT", Date.parse("2026-10-20T23:59:00Z")), 60000);
  assert.equal(retryDelay(10, 120000, () => 0), 120000); assert.ok(retryDelay(3, null, () => 0) <= 30000);
  const { db, store } = fixture(); let calls = 0; const events: string[] = [];
  try {
    const adapter = new OpenRouterAdapter(store, async () => KEY, () => true, async () => { calls++; return new Response("private", { status: 429, headers: { "Retry-After": "120" } }); });
    const before = Date.now(); assert.equal((await adapter.launch(task(), hooks(events)).done).ok, false);
    assert.equal(calls, 1); assert.ok(events.includes("provider.rate_limited")); assert.ok(store.cooldownUntil() >= before + 120000);
    assert.equal(new IntelligenceStore(db).cooldownUntil(), store.cooldownUntil());
    assert.equal((await adapter.detect()).availability, "rate_limited");
    assert.equal((await adapter.launch(task(), hooks()).done).ok, false); assert.equal(calls, 1);
  } finally { db.close(); }
});

test("MA4 accounting: atomic request/token/day/cost reservations count failures and cannot exceed budget concurrently", () => {
  const { db, store } = fixture();
  try {
    store.configure({ ...store.configuration(), requestsPerMinute: 1 });
    store.reserve(MODEL, 200, 0); assert.throws(() => store.reserve(MODEL, 200, 0), /rate_limited/);
    assert.throws(() => store.reserve(MODEL, 200, 1), /budget/);
    const row = db.db.prepare("SELECT COUNT(*) AS n FROM ma4_usage").get() as { n: number }; assert.equal(row.n, 1);
  } finally { db.close(); }
});

test("MA4 cancellation: waiting agents stop promptly; completed and cancelled calls release concurrency resources", async () => {
  const q = new AdmissionQueue(); const a = new AbortController(), b = new AbortController();
  const first = await q.enter(() => 1, a.signal); const waiting = q.enter(() => 1, b.signal); b.abort(); await assert.rejects(waiting);
  assert.equal(q.active, 1); first(); first(); assert.equal(q.active, 0);
  const release = await q.enter(() => 1, a.signal); release(); assert.equal(q.active, 0);
  const { db, store } = fixture(); let fetched = false;
  try {
    const adapter = new OpenRouterAdapter(store, async () => KEY, () => true, async (_url, init) => {
      fetched = true; return new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("Abort")), { once: true }));
    });
    const session = adapter.launch(task(), hooks());
    await until(() => fetched); await session.stop(); assert.equal((await session.done).stopped, true); assert.equal(adapter.queue.active, 0);
  } finally { db.close(); }
});

test("MA4 timeout: bounded recovery, partial response never succeeds and body size is bounded", async () => {
  const { db, store } = fixture();
  try {
    const adapter = new OpenRouterAdapter(store, async () => KEY, () => true, async (_url, init) => new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("timeout")), { once: true })));
    const running = adapter.launch({ ...task(), maxRuntimeMs: 15 }, hooks());
    const keepalive = setTimeout(() => {}, 500);
    try { const result = await running.done; assert.equal(result.ok, false); assert.match(result.error!, /timeout/); assert.equal(adapter.queue.active, 0); } finally { clearTimeout(keepalive); }
    await assert.rejects(boundedJson(new Response(" ".repeat(100)), new AbortController().signal, 8), /502/);
  } finally { db.close(); }
});

test("MA4 output-validation failure never completes task; preflight denies tools/sensitivity/unknown models before any external call", async () => {
  const { db, store } = fixture(); let calls = 0;
  try {
    const adapter = new OpenRouterAdapter(store, async () => KEY, () => true, async () => { calls++; return reply("invalid"); });
    assert.equal((await adapter.launch(task({ responseFormat: { type: "object" } }), hooks()).done).ok, false);
    assert.equal(calls, 1);
    assert.equal((await adapter.launch(task({ sensitive: true }), hooks()).done).ok, false);
    assert.equal((await adapter.launch(task({ requiresTerminal: true }), hooks()).done).ok, false);
    assert.equal((await adapter.launch({ ...task(), model: "unapproved" }, hooks()).done).ok, false);
    assert.equal(calls, 1);
    assert.equal(redactOutput(`api_key=${KEY}`, [KEY]).includes(KEY), false);
  } finally { db.close(); }
});

test("MA4 evaluation: explicit permission, reproducible version/sample sizes, no answer leakage, missing/stale evidence neutral and measured ranking changes", async () => {
  const { db, store } = fixture(); const engine = new EvaluationEngine(store); let calls = 0;
  try {
    const answers = ["yes", "323", "function add(a,b){return a+b;}", '{"ok":true}', '{"name":"calculator","arguments":{"a":2,"b":3}}'];
    const evaluation = await engine.run(MODEL, async prompt => { assert.equal(prompt.includes("323"), false); return { text: answers[calls++], inputTokens: 10, outputTokens: 3 }; }, new AbortController().signal);
    assert.equal(evaluation.passed, 5); assert.equal(evaluation.samples, 5); assert.equal(evaluation.version, BENCHMARK_VERSION); assert.equal(evaluation.toolExecutionMeasured, false);
    assert.equal(engine.score(MODEL), 1); assert.equal(engine.score("unknown"), null); assert.equal(engine.score(MODEL, Date.now() + 31 * 24 * 60 * 60_000), null);
    assert.equal(routing({ evaluated: p => p === "openrouter" ? engine.score(MODEL) : -1 }).decision.selected?.provider_id, "openrouter");
    store.configure({ ...store.configuration(), evaluationsAllowed: false });
    await assert.rejects(engine.run(MODEL, async () => { throw new Error(); }, new AbortController().signal), /permission/);
    const record = db.db.prepare("SELECT record FROM ma4_evaluations").get() as { record: string }; assert.equal(record.record.includes("function add"), false);
  } finally { db.close(); }
});

async function until(predicate: () => boolean, timeout = 5000) {
  const end = Date.now() + timeout; while (!predicate()) { if (Date.now() >= end) throw new Error("Fixture deadline."); await new Promise(r => setTimeout(r, 5)); }
}

test("MA4 real Windows DPAPI encrypt/decrypt round trip", { skip: process.platform !== "win32" }, async () => {
  const protector = new DpapiProtector("Bunny-A/MA4/test-only"); const cipher = await protector.protect(KEY);
  assert.equal(cipher.includes(Buffer.from(KEY)), false); assert.equal(await protector.unprotect(cipher), KEY);
});

test("MA4 premium: paid and unknown-priced models denied by default; explicit finite spend ceilings reserve worst-case cost", async () => {
  const { db, store } = fixture(); let calls = 0;
  try {
    const data = catalogue("fixture/paid"); data.data[0].pricing = { prompt: "0.00001", completion: "0.00002" };
    store.replaceModels(parseOpenRouterModels(data)); store.configure({ ...store.configuration(), models: ["fixture/paid"] });
    const adapter = new OpenRouterAdapter(store, async () => KEY, () => true, async () => { calls++; return reply("ok", "stop", "fixture/paid"); });
    assert.match(adapter.exclusion("fixture/paid", requirements)!, /Paid/);
    store.configure({ ...store.configuration(), allowPaid: true, maxUsdPerRequest: 0.001, maxUsdPerDay: 0.002 });
    const expensive = { ...task(), model: "fixture/paid", inferencePolicy: store.fingerprint() };
    assert.equal((await adapter.launch(expensive, hooks()).done).ok, false); assert.equal(calls, 0);
    store.configure({ ...store.configuration(), maxUsdPerRequest: 0.03, maxUsdPerDay: 0.03 });
    assert.equal((await adapter.launch({ ...expensive, inferencePolicy: store.fingerprint() }, hooks()).done).ok, true);
    assert.equal((await adapter.launch({ ...expensive, inferencePolicy: store.fingerprint() }, hooks()).done).ok, false); assert.equal(calls, 1, "daily budget accounts for the first request before another starts");
  } finally { db.close(); }
});

test("MA4 actual Host API: workstation-only activation/evaluation, unauthenticated/paired clients denied and snapshots contain no secrets", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bunny-ma4-http-")); const root = join(dir, "project"); mkdirSync(root);
  const reservation = createServer(); await new Promise<void>(resolve => reservation.listen(0, "127.0.0.1", resolve));
  const allocated = reservation.address(); assert.ok(allocated && typeof allocated !== "string"); const port = allocated.port;
  await new Promise<void>((resolve, reject) => reservation.close(e => e ? reject(e) : resolve()));
  const host = await startHost({ dataDirectory: dir, root, port, adapters: [], ma4Fetch: async () => new Response(JSON.stringify(catalogue())) });
  const address = host.server.address(); assert.ok(address && typeof address !== "string"); const base = `http://127.0.0.1:${address.port}`;
  const command = async (action: string, data: unknown = {}, token = host.token) => fetch(`${base}/command`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ action, data }) });
  try {
    assert.ok([401, 403].includes((await command("ma4.configure", { configuration: CONFIG }, "invalid")).status));
    const pairing = await (await command("pairing.create")).json() as { pairCode: string };
    const pair = await (await fetch(`${base}/pair`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: pairing.pairCode, name: "MA4 phone fixture" }) })).json() as { token: string };
    for (const action of ["ma4.configure", "ma4.discover", "ma4.evaluate"]) {
      const response = await command(action, { configuration: CONFIG, model: MODEL, confirm: true }, pair.token);
      assert.notEqual(response.status, 200); assert.equal(host.manager.ma4.configuration().enabled, false);
    }
    assert.equal((await command("ma4.configure", { configuration: CONFIG })).status, 200);
    assert.equal((await command("ma4.discover")).status, 200);
    const response = await fetch(`${base}/state`, { headers: { Authorization: `Bearer ${host.token}` } });
    const state = await response.text(); assert.equal(state.includes(KEY), false); assert.ok(state.includes("modelIntelligence"));
    const mobile = await (await fetch(`${base}/state`, { headers: { Authorization: `Bearer ${pair.token}` } })).json() as Record<string, unknown>;
    assert.equal(mobile.modelIntelligence, undefined);
  } finally { await host.close(); rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
});

test("MA4 Host integration: existing consent, exact-model dispatch, status/output/usage propagation and backward-compatible configuration", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bunny-ma4-")); const root = join(dir, "project"); mkdirSync(root);
  const db = new HostDatabase(join(dir, "host.sqlite")); const bodies: Record<string, unknown>[] = [];
  let running = 0, peak = 0;
  const manager = new TaskManager(db, root, [], { connections: { protector: new TestProtector(), fetch: async () => new Response("{}") },
    ma4Fetch: async (url, init) => {
      if (String(url).endsWith("/models")) return new Response(JSON.stringify(catalogue()));
      const body = JSON.parse(String(init?.body)); bodies.push(body); running++; peak = Math.max(peak, running);
      await new Promise(r => setTimeout(r, 20)); running--; return reply(`Answer ${KEY}`);
    } });
  manager.adapters.push(manager.ma4Adapter);
  try {
    assert.equal(manager.ma4.configuration().enabled, false);
    await manager.discoverMA4(); assert.equal(manager.ma4.models()[0].enabled, false);
    manager.configureMA4({ ...DEFAULT_CONFIGURATION, enabled: true, models: [MODEL], upstreams: ["fixture"], maxConcurrent: 2, tokensPerMinute: 100000 });
    const id = "openrouter:api_key:default";
    await manager.connections.command("connections.credential.save", { id, apiKey: KEY }, "workstation");
    await manager.connections.command("connections.check", { id }, "workstation");
    await manager.discover();
    assert.throws(() => manager.submit({ prompt: "hello", mode: "fast", override: "openrouter", modelOverride: MODEL }), /eligible|permission|off|opt|allowance/i);
    const consent = manager.connections.views().find(r => r.id === id)!.consent;
    await manager.connections.command("connections.consent.set", { id, consent: { ...consent, allowTasks: true, billingOptIn: true, maxRequestsPerDay: 20, strictBudget: true } }, "workstation");
    await manager.discover();
    const submitted = manager.submit({ prompt: "hello", mode: "fast", override: "openrouter", modelOverride: MODEL, executionScope: { access: "read" } });
    assert.equal(submitted.provider, "openrouter"); assert.equal(submitted.model, MODEL);
    manager.approve(submitted.id); await until(() => ["completed", "failed"].includes(db.get(submitted.id).state));
    const result = db.get(submitted.id); assert.equal(result.state, "completed", result.error ?? ""); assert.equal(result.output.includes(KEY), false); assert.equal(result.usage?.inputTokens, 7);
    assert.equal(bodies.length, 1); assert.equal(bodies[0].model, MODEL);
    assert.deepEqual((bodies[0].provider as Record<string, unknown>).only, ["fixture"]); assert.equal((bodies[0].provider as Record<string, unknown>).allow_fallbacks, false);
    assert.ok(db.events(0).some(e => e.type === "agent.working")); assert.ok(db.events(0).some(e => e.type === "task.completed"));
    assert.throws(() => manager.submit({ prompt: "hello", mode: "fast", override: "openrouter", modelOverride: "missing" }), /eligible|selected/i);
    assert.throws(() => manager.submit({ prompt: "hello", mode: "fast", override: "openrouter", constraints: { sensitive: true } }), /eligible|local/i);
    assert.equal(validateConstraints({ sensitive: true, language: "en", outputTokens: 300 }).sensitive, true);
    const pending = manager.submit({ prompt: "hello", mode: "fast", override: "openrouter", modelOverride: MODEL, executionScope: { access: "read" } });
    manager.configureMA4({ ...manager.ma4.configuration(), upstreams: ["other-approved-host"] });
    manager.approve(pending.id); await until(() => ["completed", "failed"].includes(db.get(pending.id).state));
    assert.equal(db.get(pending.id).state, "failed"); assert.equal(bodies.length, 1, "queued policy change cannot send to a new downstream host");
    manager.configureMA4({ ...manager.ma4.configuration(), upstreams: ["fixture"] });
    const missions = new MissionManager(manager, { dataDirectory: dir, adapters: [] });
    try {
      missions.configure({ enabled: true }, "workstation");
      const m = missions.create({ objective: "Three bounded explanations", mode: "balanced", origin: "workstation",
        modelSelection: { task: { provider: "openrouter", model: MODEL }, agents: {} }, steps: [
          { role: "Alpha", objective: "Explain alpha", executor: { kind: "model" } },
          { role: "Beta", objective: "Explain beta", executor: { kind: "model" } },
          { role: "Review", objective: "Compare both explanations", executor: { kind: "model" }, dependsOn: [0, 1] },
        ] });
      missions.approve(m.id, "workstation");
      await until(() => ["completed", "failed"].includes(missions.mission(m.id).state), 10000);
      const view = missions.view(missions.mission(m.id)); assert.equal(view.state, "completed", JSON.stringify(view.steps.map(s => s.failure)));
      assert.equal(bodies.length, 4); assert.equal(peak, 2, "two independent steps overlap; provider concurrency remains two");
      assert.ok(view.steps.every(s => s.accounting.provider === "openrouter" && s.accounting.model === MODEL));
      assert.ok(view.steps[2].startedAt! >= Math.max(view.steps[0].finishedAt!, view.steps[1].finishedAt!), "dependent review runs after both predecessors");
    } finally { await missions.close(); }
  } finally { manager.dispose(); db.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("MA4 MA3 integration: mission pins persist across planning/restart; dependency graph and single-agent work remain bounded", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bunny-ma4-mission-")); const root = join(dir, "project"); mkdirSync(root);
  const db = new HostDatabase(join(dir, "host.sqlite"));
  const tasks = new TaskManager(db, root, [], { modelRegistry: new ModelCapabilityRegistry(db, { availableProviders: () => [] }) });
  const missions = new MissionManager(tasks, { dataDirectory: dir, adapters: [] });
  try {
    missions.configure({ enabled: true }, "workstation");
    const m = missions.create({ objective: "bounded reasoning", mode: "fast", origin: "workstation", modelSelection: { agents: { Coding: { provider: "openrouter", model: MODEL } } }, steps: [
      { role: "Coding", objective: "Explain the algorithm", executor: { kind: "model" }, dependsOn: [] },
      { role: "Testing", objective: "Check the explanation", executor: { kind: "model" }, dependsOn: [0] },
    ] });
    assert.equal(m.steps.length, 2); assert.equal(m.steps[0].modelConstraint, MODEL); assert.equal(m.steps[1].modelConstraint, null);
    assert.deepEqual(m.steps[0].providerConstraints.allow, ["openrouter"]); assert.deepEqual(m.steps[1].dependsOn, [m.steps[0].id]);
    assert.equal(missions.mission(m.id).modelSelection?.agents.Coding.model, MODEL);
    const single = missions.create({ objective: "Explain gravity", mode: "fast", origin: "workstation", steps: [{ role: "Assistant", objective: "Explain gravity", executor: { kind: "model" } }] });
    assert.equal(single.steps.length, 1);
  } finally { await missions.close(); tasks.dispose(); db.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("MA4 exact-model constraints never escape through the legacy Host path when discovery has no facts", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bunny-ma4-no-facts-")); const db = new HostDatabase(":memory:");
  let launches = 0;
  const manager = new TaskManager(db, dir, [{ id: "claude", detect: async () => ({ ...providerBase("claude"), installed: true, authenticated: true, availability: "ready", current_model: "configured-default", capabilities: ["text"] }),
    launch: () => { launches++; throw new Error("Must not launch"); } }], { modelRegistry: new ModelCapabilityRegistry(db, { availableProviders: () => [] }) });
  try {
    await manager.discover();
    assert.throws(() => manager.submit({ prompt: "hello", mode: "fast", override: "claude", modelOverride: "exact-unavailable" }), /Approve a different model/);
    assert.throws(() => manager.submit({ prompt: "hello", mode: "fast", constraints: { modelExact: "exact-unavailable" } }), /Approve a different model/);
    const pending = manager.submit({ prompt: "hello", mode: "fast", override: "claude" });
    assert.throws(() => manager.retarget(pending.id, "claude", "exact-unavailable"), /No eligible/);
    assert.equal(launches, 0);
  } finally { manager.dispose(); db.close(); rmSync(dir, { recursive: true, force: true }); }
});
