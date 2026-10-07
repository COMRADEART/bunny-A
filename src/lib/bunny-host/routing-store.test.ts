import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { providerBase } from "./adapters.server.ts";
import { classifyRequirements } from "../orch/router-requirements.ts";
import { buildCandidates, ROUTING_POLICY_VERSION, safeDecisionRecord, selectRoutingCandidate, type RoutingDecisionRecord } from "./routing.server.ts";
import type { ModelRoutingProfile } from "./routing.server.ts";
import { HostDatabase } from "./persistence.server.ts";
import { RoutingDecisionStore } from "./routing-store.server.ts";
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
const fact = (fields: Record<string, unknown>): ModelCapabilityRecordLike => ({
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
} as unknown as ModelCapabilityRecordLike);
type ModelCapabilityRecordLike = import("./model-capability.server.ts").ModelCapabilityRecord;

function recordFixture(id: string, taskId: string, createdAt: number, overrides: Partial<RoutingDecisionRecord> = {}): RoutingDecisionRecord {
  const requirements = classifyRequirements({ prompt: "Summarize the tradeoffs", mode: "balanced" });
  const candidates = buildCandidates({
    providers: [live("ollama")],
    modelSnapshot: { providers: [{ provider: "ollama", probedThisRun: true, probedAt: now, models: [fact({ model: "qwen3:8b" })] }] },
    usage: { providers: [] },
    requirements,
    constraints: {},
    override: "auto",
    mode: "balanced",
  });
  const selection = selectRoutingCandidate({ candidates, requirements });
  return {
    ...safeDecisionRecord({
      id,
      taskId,
      missionId: null,
      routingMode: "auto",
      requirements,
      candidates,
      selection,
      policyVersion: ROUTING_POLICY_VERSION,
      createdAt,
      snapshotProviders: [{ provider: "ollama", probedThisRun: true, probedAt: now, models: [fact({ model: "qwen3:8b" })] }],
      usageStatuses: [],
    }),
    ...overrides,
  };
}

test("T3 §35: the routing tables are additive and idempotent, leaving user_version untouched", () => {
  const directory = mkdtempSync(join(tmpdir(), "bunny-t3-store-"));
  const db = new HostDatabase(join(directory, "host.sqlite"));
  try {
    const before = db.db.prepare("PRAGMA user_version").get() as { user_version: number };
    new RoutingDecisionStore(db);
    const midway = db.db.prepare("PRAGMA user_version").get() as { user_version: number };
    assert.equal(midway.user_version, before.user_version, "no user_version change, ever");
    new RoutingDecisionStore(db); // Re-create: idempotent.
    new RoutingDecisionStore(db); // And again.
    const after = db.db.prepare("PRAGMA user_version").get() as { user_version: number };
    assert.equal(after.user_version, before.user_version);
    const tables = (db.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'routing%'").all() as { name: string }[]).map((row) => row.name).sort();
    assert.deepEqual(tables, ["routing_attempts", "routing_decisions"]);
    const profileTables = (db.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('model_routing_profiles')").all() as { name: string }[]).map((row) => row.name);
    assert.deepEqual(profileTables, ["model_routing_profiles"]);
    // The installed-state marker owns schema reconciliation elsewhere: nothing here bumps it.
  } finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("T3 §35: decisions persist, round-trip, and latestForTask picks the newest record", () => {
  const directory = mkdtempSync(join(tmpdir(), "bunny-t3-store-"));
  const db = new HostDatabase(join(directory, "host.sqlite"));
  try {
    const store = new RoutingDecisionStore(db);
    store.saveDecision(recordFixture("decision-1", "task-1", now - 2000));
    store.saveDecision(recordFixture("decision-2", "task-1", now - 1000, { reroutes: 2, terminal_note: "all_eligible_models_failed (test)" }));
    assert.equal(store.decision("decision-1")!.policy_version, ROUTING_POLICY_VERSION);
    assert.equal(store.decision("missing") ?? null, null, "a missing row is null, never fabricated");
    const latest = store.latestForTask("task-1")!;
    assert.equal(latest.routing_decision_id, "decision-2", "the newest record wins");
    assert.equal(latest.reroutes, 2, "the updated record keeps its reroute count");
    assert.equal(latest.terminal_note, "all_eligible_models_failed (test)", "the honesty note survives persistence");
    assert.equal(store.latestForTask("unknown-task") ?? null, null);
    // A decision carries no prompt text (§18 holds through persistence).
    assert.ok(!JSON.stringify(latest).includes("Summarize the tradeoffs"));
  } finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("T3 §35: a foreign policy_version or corrupt row fails closed to null — never a fabricated decision", () => {
  const directory = mkdtempSync(join(tmpdir(), "bunny-t3-store-"));
  const db = new HostDatabase(join(directory, "host.sqlite"));
  try {
    const store = new RoutingDecisionStore(db);
    store.saveDecision(recordFixture("decision-1", "task-1", now));
    const foreign = recordFixture("decision-2", "task-1", now, { policy_version: "routing-policy-v999" });
    store.saveDecision(foreign);
    assert.equal(store.decision("decision-2") ?? null, null, "a mismatched policy version is unreadable, not executable");
    store.saveDecision(recordFixture("decision-3", "task-1", now + 1));
    db.db.prepare("UPDATE routing_decisions SET decision='{broken' WHERE id='decision-3'").run();
    assert.equal(store.decision("decision-3") ?? null, null, "corrupt JSON is never fabricated into a decision");
    assert.equal(store.latestForTask("task-1") ?? null, null, "a corrupt newest row fails closed to null — never fabricated, never silently substituted");
  } finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("T3 §22: attempts persist per Task, ordered by index, with taxonomy and detail", () => {
  const directory = mkdtempSync(join(tmpdir(), "bunny-t3-store-"));
  const db = new HostDatabase(join(directory, "host.sqlite"));
  try {
    const store = new RoutingDecisionStore(db);
    store.saveAttempt({ id: "attempt-1", decisionId: "decision-1", taskId: "task-1", attemptIndex: 0, provider: "codex", model: "gpt-5.3-codex", effort: "high", taxonomy: "QUOTA_CONSTRAINED", detail: "usage limit reached (429)", createdAt: now });
    store.saveAttempt({ id: "attempt-2", decisionId: "decision-1", taskId: "task-1", attemptIndex: 1, provider: "claude", model: null, effort: null, taxonomy: "EXECUTION_FAILED", detail: "", createdAt: now });
    store.saveAttempt({ id: "attempt-3", decisionId: "decision-9", taskId: "task-2", attemptIndex: 0, provider: "ollama", model: "qwen3:8b", effort: "PROVIDER_DEFAULT", taxonomy: "MODEL_UNAVAILABLE", detail: "unavailable", createdAt: now });
    const attempts = store.attempts("task-1");
    assert.deepEqual(attempts.map((attempt) => attempt.attemptIndex), [0, 1]);
    assert.equal(attempts[0].provider, "codex");
    assert.equal(attempts[0].model, "gpt-5.3-codex");
    assert.equal(attempts[0].taxonomy, "QUOTA_CONSTRAINED");
    assert.equal(attempts[1].model, null);
    assert.equal(attempts[1].taxonomy, "EXECUTION_FAILED");
    assert.deepEqual(store.attempts("task-2").map((attempt) => attempt.decisionId), ["decision-9"], "attempts stay scoped by Task");
    assert.deepEqual(store.attempts("never-happened"), []);
    // Replacement by id is a replace (INSERT OR REPLACE), not a duplicate.
    store.saveAttempt({ id: "attempt-1", decisionId: "decision-1", taskId: "task-1", attemptIndex: 0, provider: "codex", model: "gpt-5.3-codex", effort: "high", taxonomy: "TRANSIENT_TRANSPORT", detail: "reclassified on re-read", createdAt: now });
    assert.deepEqual(store.attempts("task-1").filter((attempt) => attempt.id === "attempt-1").length, 1);
    assert.equal(store.attempts("task-1")[0].taxonomy, "TRANSIENT_TRANSPORT");
  } finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("T3 §7/§35: stored routing profiles are per-model policy metadata; PROVIDER_DEFAULT profiles are constants, not rows", () => {
  const directory = mkdtempSync(join(tmpdir(), "bunny-t3-store-"));
  const db = new HostDatabase(join(directory, "host.sqlite"));
  try {
    const store = new RoutingDecisionStore(db);
    const providerDefault: ModelRoutingProfile = { provider_id: "claude", model_id: null, candidate_kind: "PROVIDER_DEFAULT", provenance: "POLICY_DEFAULT", coding_rank: 82, reasoning_rank: 92, latency_rank: 50, quality_rank: 90, specialization_tags: [], note: "Provider default: Bunny policy prior, not a provider-reported ranking." };
    const discovered: ModelRoutingProfile = { provider_id: "codex", model_id: "gpt-5.3-codex", candidate_kind: "DISCOVERED_MODEL", provenance: "BUNNY_BENCHMARKED", coding_rank: 91, reasoning_rank: 88, latency_rank: 48, quality_rank: 90, specialization_tags: ["catalogue-default"] };
    store.saveProfile(providerDefault, now);
    const count = (db.db.prepare("SELECT COUNT(*) AS n FROM model_routing_profiles").get() as { n: number }).n;
    assert.equal(count, 0, "the null-model default is skipped, not persisted");
    store.saveProfile(discovered, now);
    const stored = store.profile("codex", "gpt-5.3-codex")!;
    assert.equal(stored.provenance, "BUNNY_BENCHMARKED");
    assert.equal(stored.profile.reasoning_rank, 88);
    assert.equal(stored.profile.provider_id, "codex");
    assert.equal(store.profile("claude", "gpt-5.3-codex") ?? null, null, "provider mismatch is not forgivable");
    assert.equal(store.profile("codex", "never-listed") ?? null, null);
    // Corrupt JSON falls back to policy defaults, never fabricated ranks.
    db.db.prepare("UPDATE model_routing_profiles SET profile='{broken' WHERE model='gpt-5.3-codex'").run();
    assert.equal(store.profile("codex", "gpt-5.3-codex") ?? null, null);
  } finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
});