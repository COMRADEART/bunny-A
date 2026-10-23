import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostDatabase } from "./persistence.server.ts";
import { BASE_POLICY, PolicyEngine } from "./learning.server.ts";
import { RoutingDecisionStore } from "./routing-store.server.ts";
import type { RoutingDecisionRecord } from "./routing.server.ts";
import { providerBase } from "./adapters.server.ts";
import { startHost } from "./http.server.ts";
import { TestProtector } from "./jev-secrets.server.ts";
import {
  SHADOW_MIN_VERIFIED, acceptGate, evaluate, propose, repick, shadowGate, shadowSummary, validateWeights,
  type EmpiricalSignal, type LearningWeights, type RecordedCandidate, type RecordedDecision,
} from "./routing-feedback.ts";
import type { OrchTask, ProviderId, ProviderLive } from "../orch/types.ts";
import type { ProviderAdapter } from "./contracts.ts";

/**
 * M-A-3 T13.3 Gate G (§20): evaluation-gated routing improvement. Pure rules, the PolicyEngine lifecycle over seeded
 * recorded decisions and outcomes, and the real Host command surface. No provider, account or network is used.
 */

type Body = Record<string, any>;
const BASE: LearningWeights = { historyWeight: 1, latencyWeight: 0, perTaskType: false };
const PER_TYPE: LearningWeights = { historyWeight: 1, latencyWeight: 0, perTaskType: true };
const candidate = (provider: ProviderId, score: number, empirical = 0): RecordedCandidate => ({ provider, model: "m", eligible: true, score, empirical });
/** A signal where only per-task-type history knows codex fails and claude succeeds on "coding". */
const signal: EmpiricalSignal = (provider, taskType, _mode, weights) =>
  (weights.perTaskType && taskType === "coding" ? (provider === "codex" ? -0.036 : provider === "claude" ? 0.036 : 0) : 0) * weights.historyWeight;
const decision = (id: string, outcome: RecordedDecision["outcome"], selected: ProviderId = "codex"): RecordedDecision =>
  ({ decisionId: id, taskType: "coding", mode: "balanced", selected: { provider: selected, model: "m" }, outcome, candidates: [candidate("codex", 50.1), candidate("claude", 50)] });

test("T13.3 G rules: replay attributes outcomes only where the active policy still picks what ran", () => {
  assert.deepEqual(repick([candidate("codex", 50), candidate("claude", 50)], () => 0), { provider: "codex", model: "m" }, "exact ties break by display order");
  assert.deepEqual(repick([candidate("codex", 50.1, 0.3), candidate("claude", 50)], () => 0), { provider: "claude", model: "m" }, "only the empirical points are recomputed");
  assert.equal(repick([{ ...candidate("codex", 99), eligible: false }], () => 0), null, "an ineligible candidate is never picked");

  const evaluation = evaluate([
    decision("failed-1", "failed"), decision("failed-2", "failed"), decision("passed", "passed"), decision("unverified", "unverified"),
    decision("stopped", null), decision("rerouted", "failed", "claude"),
  ], BASE, PER_TYPE, signal, 6);
  assert.equal(evaluation.decisions, 6);
  assert.equal(evaluation.comparable, 4, "a stopped task and a decision the active policy would not make again say nothing");
  assert.equal(evaluation.verified, 3);
  assert.deepEqual([evaluation.changed, evaluation.improvements, evaluation.risks, evaluation.unmeasured], [4, 2, 1, 1]);
  assert.ok(evaluation.changes.every((change) => change.live === "codex/m" && change.candidate === "claude/m"));
  assert.deepEqual(shadowGate(evaluation, 0), { ok: false, reason: "Replayed on recorded decisions, it moves 1 verified success(es) to a different model." });
  assert.match((shadowGate(evaluate([decision("a", "failed")], BASE, PER_TYPE, signal, 6), 1) as { reason: string }).reason, /regresses 1 case/);
  assert.match((shadowGate(evaluate([decision("a", "passed")], BASE, BASE, signal, 6), 0) as { reason: string }).reason, /No measured improvement: 1 verified/);
});

test("T13.3 G rules: weights are bounded; propose searches only the bounded grid and says why when nothing helps", () => {
  assert.throws(() => validateWeights({ historyWeight: 2.5 }), /bounds/);
  assert.throws(() => validateWeights({ historyWeight: 1, latencyWeight: 0.06 }), /bounds/);
  assert.throws(() => validateWeights({ historyWeight: Number.NaN }), /bounds/);
  assert.deepEqual(validateWeights({ historyWeight: 0.5, perTaskType: "yes" as never }), { historyWeight: 0.5, latencyWeight: 0, perTaskType: false });

  const failures = [1, 2, 3].map((n) => decision(`f${n}`, "failed"));
  const proposal = propose(failures, BASE, signal, 6, () => 0);
  assert.ok(proposal.weights);
  assert.deepEqual(proposal.weights, PER_TYPE, "among equal improvements the nearest bounded change wins");
  assert.equal(proposal.evaluation.improvements, 3);
  const regressing = propose(failures, BASE, signal, 6, (weights) => (weights.perTaskType ? 1 : 0));
  assert.equal(regressing.weights, null, "a benchmark regression disqualifies every otherwise-improving candidate");
  const none = propose([decision("p", "passed")], BASE, signal, 6, () => 0);
  assert.equal(none.weights, null);
  assert.match((none as { reason: string }).reason, /^No bounded policy improves on the current one: 1 verified decision/);
});

test("T13.3 G rules: a shadow run is accepted only with enough verified live decisions and no risked success", () => {
  const live = { provider: "codex" as ProviderId, model: "m" };
  const other = { provider: "claude" as ProviderId, model: "m" };
  const summary = shadowSummary([
    { live, shadow: live, outcome: "passed" }, { live, shadow: other, outcome: "failed" }, { live, shadow: other, outcome: null }, { live, shadow: other, outcome: "unverified" },
  ]);
  assert.deepEqual(summary, { decisions: 4, agreed: 1, differed: 3, verified: 2, risks: 0, avoided: 1 });
  const good = evaluate([decision("a", "failed")], BASE, PER_TYPE, signal, 6);
  assert.match((acceptGate(good, 0, null) as { reason: string }).reason, /not been shadow tested/);
  assert.match((acceptGate(good, 0, summary) as { reason: string }).reason, new RegExp(`2 verified live decision\\(s\\); ${SHADOW_MIN_VERIFIED} are required`));
  const enough = { ...summary, verified: SHADOW_MIN_VERIFIED };
  assert.deepEqual(acceptGate(good, 0, enough), { ok: true });
  assert.match((acceptGate(good, 0, { ...enough, risks: 1 }) as { reason: string }).reason, /disagreed with 1 live choice/);
});

// ---- PolicyEngine over seeded evidence --------------------------------------------------------------------------

const PROVIDERS: ProviderLive[] = (["codex", "claude", "ollama"] as ProviderId[]).map((id) => ({
  ...providerBase(id), installed: true, authenticated: true, availability: "ready" as const, capabilities: id === "ollama" ? ["text"] : ["text", "filesystem", "terminal"],
}));
let clock = 1_700_000_000_000;
function seed(db: HostDatabase, routing: RoutingDecisionStore | null, input: { id: string; provider: ProviderId; verification: "passed" | "failed" | null; state?: OrchTask["state"]; feedback?: "positive" | "negative" }) {
  const at = (clock += 10_000);
  db.outcome({
    id: input.id, provider: input.provider, decision: { task_type: "coding", complexity: 0.5, scores: [] }, state: input.state ?? "completed",
    verification: input.verification ? { passed: input.verification === "passed" } : undefined, startedAt: at, finishedAt: at + 1000, mode: "balanced",
    manual: false, retries: 0, feedback: input.feedback, model: "m",
  } as unknown as OrchTask);
  routing?.saveDecision({
    routing_decision_id: `d-${input.id}`, task_id: input.id, mission_id: null, created_at: at, policy_version: "fixture",
    selected: { provider_id: input.provider, model_id: "m" },
    candidates_considered: [
      { provider_id: "codex", model_id: "m", eligible: true, score: 50.1, components: [{ name: "empirical", points: 0 }] },
      { provider_id: "claude", model_id: "m", eligible: true, score: 50, components: [{ name: "empirical", points: 0 }] },
    ],
  } as unknown as RoutingDecisionRecord);
}
const shadowFor = (policy: PolicyEngine, id: string) => ({
  decisionId: `d-${id}`, taskId: id, taskType: "coding", mode: "balanced" as const, selected: { provider: "codex" as ProviderId, model: "m" },
  candidates: [candidate("codex", 50.1), candidate("claude", 50)],
});

test("T13.3 G engine: base weights are live; Bunny proposes from verified evidence; praise is never counted as success", () => {
  const db = new HostDatabase(":memory:");
  const routing = new RoutingDecisionStore(db);
  const policy = new PolicyEngine(db);
  try {
    assert.deepEqual(policy.liveWeights(), BASE, "the base policy reproduces pre-Gate-G routing");
    assert.throws(() => policy.proposeFromEvidence(PROVIDERS), /^Error: No bounded policy improves on the current one: 0 verified/);

    for (let n = 0; n < 6; n++) seed(db, routing, { id: `codex-${n}`, provider: "codex", verification: "failed", feedback: n < 3 ? "positive" : undefined });
    for (let n = 0; n < 6; n++) seed(db, null, { id: `claude-${n}`, provider: "claude", verification: "passed" });
    seed(db, routing, { id: "stopped", provider: "codex", verification: null, state: "stopped" });
    assert.ok(db.learned("codex", "coding") < 0, "praise on a verified failure does not make it a success");
    assert.equal(db.learned("codex", "general"), 0, "the base policy's bucket is untouched");

    const recorded = policy.recordedDecisions();
    assert.equal(recorded.length, 7);
    assert.equal(recorded.find((row) => row.decisionId === "d-stopped")!.outcome, null, "a stopped task attributes nothing");

    const view = policy.view();
    const codex = view.observations.find((row) => row.provider === "codex")!;
    assert.deepEqual([codex.samples, codex.verified, codex.verifiedFailed, codex.stopped, codex.costUsd], [7, 0, 6, 1, null]);
    assert.deepEqual(codex.feedback, { positive: 3, negative: 0 }, "explicit feedback is shown beside, never inside, verified results");
    assert.equal(view.observations.find((row) => row.provider === "claude")!.verified, 6);

    const proposal = policy.proposeFromEvidence(PROVIDERS);
    assert.deepEqual({ h: proposal.policy.historyWeight, l: proposal.policy.latencyWeight, t: proposal.policy.perTaskType }, { h: 1, l: 0, t: true });
    assert.equal(proposal.replay.decisions!.improvements, 6);
    assert.equal(proposal.replay.regressions, 0);
    assert.equal(proposal.replay.promotable, true);
    assert.equal(policy.view().candidates[0].state, "evaluated");
    assert.equal(policy.view().candidates[0].proposedBy, "evidence");
    assert.deepEqual(policy.liveWeights(), BASE, "evaluation never changes live routing");
  } finally { db.close(); }
});

test("T13.3 G engine: shadow → accept → rollback, with every refusal path", () => {
  const db = new HostDatabase(":memory:");
  const routing = new RoutingDecisionStore(db);
  const policy = new PolicyEngine(db);
  try {
    for (let n = 0; n < 6; n++) seed(db, routing, { id: `codex-${n}`, provider: "codex", verification: "failed" });
    for (let n = 0; n < 6; n++) seed(db, null, { id: `claude-${n}`, provider: "claude", verification: "passed" });

    const flat = policy.candidate(0, 0, PROVIDERS);
    assert.equal(flat.replay.promotable, false);
    assert.throws(() => policy.startShadow(flat.policy.id), /^Error: Shadow refused: No measured improvement/);
    assert.throws(() => policy.accept(flat.policy.id, PROVIDERS), /Promotion gate refused: only the candidate being shadow tested/);

    const proposed = policy.proposeFromEvidence(PROVIDERS).policy;
    const second = policy.candidate(1.5, 0, PROVIDERS, 0, true).policy;
    policy.startShadow(proposed.id);
    assert.throws(() => policy.startShadow(second.id), /another candidate is already being shadow tested/);
    assert.equal(policy.shadowPolicy()!.id, proposed.id);
    assert.deepEqual(policy.liveWeights(), BASE, "a shadow run never changes live routing");
    assert.throws(() => policy.accept(proposed.id, PROVIDERS), /The shadow run has 0 verified live decision\(s\); 5 are required/);

    for (let n = 0; n < SHADOW_MIN_VERIFIED; n++) {
      policy.recordShadow(shadowFor(policy, `live-${n}`));
      if (n < SHADOW_MIN_VERIFIED - 1) seed(db, routing, { id: `live-${n}`, provider: "codex", verification: "failed" });
    }
    const pending = policy.view().candidates.find((row) => row.id === proposed.id)!;
    assert.equal(pending.state, "shadow");
    assert.deepEqual(pending.shadow, { decisions: 5, agreed: 0, differed: 5, verified: 4, risks: 0, avoided: 4 }, "an unfinished task is not yet verified");
    assert.throws(() => policy.accept(proposed.id, PROVIDERS), /4 verified live decision/);
    seed(db, routing, { id: `live-${SHADOW_MIN_VERIFIED - 1}`, provider: "codex", verification: "failed" });

    const accepted = policy.accept(proposed.id, PROVIDERS);
    assert.equal(accepted.id, proposed.id);
    assert.deepEqual(policy.liveWeights(), PER_TYPE, "only an accepted candidate changes live routing");
    assert.equal(policy.shadowPolicy(), null);
    assert.ok(db.events().some((event) => event.type === "policy.promoted" && event.detail.includes(BASE_POLICY.id)), "the rollback artifact is named");
    assert.throws(() => policy.startShadow(second.id), /evaluated against a policy that is no longer active/);
    policy.reject(second.id);
    assert.equal(policy.view().candidates.find((row) => row.id === second.id)!.state, "rejected");
    assert.throws(() => policy.reject(second.id), /Only an evaluated or shadow-tested candidate/);

    policy.rollback();
    assert.equal(policy.active().id, BASE_POLICY.id);
    assert.deepEqual(policy.liveWeights(), BASE);
    assert.equal(policy.view().candidates.find((row) => row.id === proposed.id)!.state, "superseded");
    assert.throws(() => policy.rollback(), /No previous/);
  } finally { db.close(); }
});

test("T13.3 G engine: a policy promoted before Gate G keeps live weights at the base", () => {
  const db = new HostDatabase(":memory:");
  const policy = new PolicyEngine(db);
  try {
    db.db.prepare("INSERT INTO policies VALUES(?,?,NULL,?)").run("legacy", JSON.stringify({ id: "legacy", historyWeight: 2, workloadWeight: 0, latencyWeight: 0.05 }), BASE_POLICY.id);
    db.db.prepare("UPDATE settings SET value='legacy' WHERE key='active_policy'").run();
    assert.equal(policy.active().id, "legacy");
    assert.deepEqual(policy.liveWeights(), BASE);
    assert.deepEqual(policy.view().active.weights, BASE, "the view reports the weights live routing actually uses");
  } finally { db.close(); }
});

// ---- Real Host HTTP surface --------------------------------------------------------------------------------------

async function freePort() {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}
async function boot(directory: string) {
  const root = join(directory, "project");
  mkdirSync(root, { recursive: true });
  const adapters: ProviderAdapter[] = (["claude", "ollama"] as ProviderId[]).map((id) => ({
    id,
    detect: async () => ({ ...providerBase(id), installed: true, authenticated: true, availability: "ready", current_model: id === "ollama" ? "qwen3:8b" : "fixture", models: id === "ollama" ? ["qwen3:8b"] : undefined, capabilities: ["text"], probedAt: Date.now() }),
    launch: () => { throw new Error("No Task is launched in this fixture."); },
  }));
  const host = await startHost({
    dataDirectory: directory, root, port: await freePort(), adapters,
    connections: { protector: new TestProtector(), fetch: async () => new Response("{}", { status: 200 }), launcher: () => { throw new Error("No sign-in in this fixture."); } },
  });
  const base = `http://127.0.0.1:${host.port}`;
  const command = async (action: string, data: unknown = {}, token = host.token) => {
    const response = await fetch(`${base}/command`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ action, data }) });
    return { status: response.status, body: (await response.json()) as Body };
  };
  const state = async (token = host.token) => (await (await fetch(`${base}/state`, { headers: { authorization: `Bearer ${token}` } })).json()) as Body;
  const pair = async () => {
    const code = (await command("pairing.create")).body.pairCode;
    return ((await (await fetch(`${base}/pair`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code, name: "Phone" }) })).json()) as { token: string }).token;
  };
  return { host, command, state, pair };
}

test("T13.3 G Host: routing-improvement commands are workstation-only, refuse honestly and persist", async () => {
  const directory = mkdtempSync(join(tmpdir(), "bunny-t13-3-learning-"));
  let h = await boot(directory);
  try {
    const learning = (await h.state()).routingLearning as Body;
    assert.equal(learning.active.id, BASE_POLICY.id);
    assert.deepEqual(learning.active.weights, BASE);
    assert.deepEqual([learning.minimumSamples, learning.shadowMinVerified], [5, SHADOW_MIN_VERIFIED]);

    const none = await h.command("routing.learning.propose");
    assert.equal(none.status, 400);
    assert.match(String(none.body.error), /^No bounded policy improves on the current one/);
    assert.equal((await h.command("routing.learning.candidate", { historyWeight: 9 })).status, 400);
    const owner = await h.command("routing.learning.candidate", { historyWeight: 0.5, latencyWeight: 0.025, perTaskType: true });
    assert.equal(owner.status, 200, JSON.stringify(owner.body));
    const listed = ((await h.state()).routingLearning as Body).candidates[0];
    assert.deepEqual([listed.state, listed.proposedBy, listed.weights], ["evaluated", "owner", { historyWeight: 0.5, latencyWeight: 0.025, perTaskType: true }]);
    assert.equal(listed.gate.ok, false);
    const shadow = await h.command("routing.learning.shadow", { id: listed.id });
    assert.equal(shadow.status, 400);
    assert.match(String(shadow.body.error), /^Shadow refused: No measured improvement/);
    assert.equal((await h.command("routing.learning.accept", { id: listed.id })).status, 400);
    assert.match(String((await h.command("routing.learning.rollback")).body.error), /No previous policy/);

    const phone = await h.pair();
    assert.equal((await h.state(phone)).routingLearning, undefined, "devices never see routing evidence");
    for (const action of ["propose", "candidate", "shadow", "accept", "reject", "rollback"])
      assert.equal((await h.command(`routing.learning.${action}`, { id: listed.id, historyWeight: 1 }, phone)).body.code, "WORKSTATION_REQUIRED", action);

    ok(await h.command("routing.learning.reject", { id: listed.id }));
    await h.host.close();
    h = await boot(directory);
    const restarted = (await h.state()).routingLearning as Body;
    assert.equal(restarted.candidates.find((row: Body) => row.id === listed.id).state, "rejected", "the lifecycle persists across a Host restart");
    assert.equal(restarted.active.id, BASE_POLICY.id);
  } finally {
    await h.host.close();
    rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});
function ok(result: { status: number; body: Body }) {
  assert.equal(result.status, 200, JSON.stringify(result.body));
  return result.body;
}

test("Autopilot: off by default; proposes only on new verified evidence, shadows, then accepts through the same gate", () => {
  const db = new HostDatabase(":memory:");
  const routing = new RoutingDecisionStore(db);
  const policy = new PolicyEngine(db);
  try {
    for (let n = 0; n < 6; n++) seed(db, routing, { id: `codex-${n}`, provider: "codex", verification: "failed" });
    for (let n = 0; n < 6; n++) seed(db, null, { id: `claude-${n}`, provider: "claude", verification: "passed" });
    assert.equal(policy.autopilot(), false);
    assert.equal(policy.autopilotStep(PROVIDERS), null, "off means the owner decides every step");
    assert.equal(policy.view().candidates.length, 0);

    policy.setAutopilot(true);
    assert.equal(policy.view().autopilot, true);
    const shadowed = policy.autopilotStep(PROVIDERS)!;
    assert.match(shadowed.detail, /shadow testing/);
    assert.equal(shadowed.changed, false);
    const id = policy.shadowPolicy()!.id;
    assert.deepEqual(policy.liveWeights(), BASE, "a shadow run never changes live routing");
    assert.equal(policy.autopilotStep(PROVIDERS), null, "the shadow waits for verified live decisions");

    for (let n = 0; n < SHADOW_MIN_VERIFIED; n++) {
      policy.recordShadow(shadowFor(policy, `live-${n}`));
      seed(db, routing, { id: `live-${n}`, provider: "codex", verification: "failed" });
    }
    const accepted = policy.autopilotStep(PROVIDERS)!;
    assert.equal(accepted.changed, true);
    assert.equal(policy.active().id, id);
    assert.deepEqual(policy.liveWeights(), PER_TYPE);
    const rows = policy.view().candidates.length;
    assert.equal(policy.autopilotStep(PROVIDERS), null, "no new verified evidence, no new proposal");
    assert.equal(policy.view().candidates.length, rows, "the autopilot does not spam candidates");
    policy.rollback();
    assert.deepEqual(policy.liveWeights(), BASE, "the owner can still roll back");
  } finally { db.close(); }
});

test("Autopilot: nothing to learn adds nothing; a shadow that risks a verified success is dropped", () => {
  const db = new HostDatabase(":memory:");
  const routing = new RoutingDecisionStore(db);
  const policy = new PolicyEngine(db);
  try {
    policy.setAutopilot(true);
    for (let n = 0; n < 6; n++) seed(db, routing, { id: `ok-${n}`, provider: "codex", verification: "passed" });
    assert.equal(policy.autopilotStep(PROVIDERS), null);
    assert.equal(policy.view().candidates.length, 0, "no improvement means no candidate row");

    const fresh = new HostDatabase(":memory:");
    const freshRouting = new RoutingDecisionStore(fresh);
    const engine = new PolicyEngine(fresh);
    try {
      engine.setAutopilot(true);
      for (let n = 0; n < 6; n++) seed(fresh, freshRouting, { id: `codex-${n}`, provider: "codex", verification: "failed" });
      for (let n = 0; n < 6; n++) seed(fresh, null, { id: `claude-${n}`, provider: "claude", verification: "passed" });
      assert.ok(engine.autopilotStep(PROVIDERS));
      const id = engine.shadowPolicy()!.id;
      engine.recordShadow(shadowFor(engine, "risky"));
      seed(fresh, freshRouting, { id: "risky", provider: "codex", verification: "passed" });
      const dropped = engine.autopilotStep(PROVIDERS)!;
      assert.match(dropped.detail, /dropped/);
      const row = engine.view().candidates.find((candidate) => candidate.id === id)!;
      assert.equal(row.state, "rejected");
      assert.match(row.reason ?? "", /^Autopilot: /);
      assert.deepEqual(engine.liveWeights(), BASE, "a dropped candidate never ran");
    } finally { fresh.close(); }
  } finally { db.close(); }
});
