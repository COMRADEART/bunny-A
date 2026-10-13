import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { HostDatabase } from "./persistence.server.ts";
import { AGENT_RUNTIME_SCHEMA, AgentStore, MAX_CHECKPOINTS_PER_RUN } from "./agent-store.server.ts";
import { assertCheckpointSafe, scanCheckpointJson } from "./agent-checkpoint.server.ts";
import type { AgentCheckpoint, AgentProfile } from "./agent-types.ts";

const profile = (id: string, overrides: Partial<AgentProfile> = {}): AgentProfile => ({
  id, name: `Agent ${id}`, missionId: "m1", createdAt: 1, createdBy: "test",
  pausedAt: null, stoppedAt: null, failure: null, completedAt: null, updatedAt: 1, ...overrides,
});
const checkpoint = (id: string, runId: string, overrides: Partial<AgentCheckpoint> = {}): AgentCheckpoint => ({
  id, agentId: "a1", runId, boundary: "before_task_admission", at: 1, revision: 1,
  replaySafety: "SAFE_TO_REPLAY", summary: "Test checkpoint", refs: { missionId: "m1", generation: 1 },
  facts: { revision: 1, generation: 1 }, ...overrides,
});
const until = async (check: () => boolean, label: string, timeout = 4000) => {
  const start = Date.now();
  while (!check()) { if (Date.now() - start > timeout) throw new Error(`Timed out waiting for ${label}`); await new Promise((r) => setTimeout(r, 5)); }
};

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "bunny-agent-store-"));
  const host = new HostDatabase(join(dir, "host.sqlite"));
  const cleanup = () => { try { host.close(); } catch { /* closed */ } try { rmSync(dir, { recursive: true, force: true }); } catch { /* Windows file locks settle late */ } };
  return { dir, host, store: new AgentStore(host), cleanup };
}

test("T4 store: the additive schema creates its key and four tables, and is idempotent on reopen", () => {
  const { dir, host, store, cleanup } = setup();
  const keys = (host.db.prepare("SELECT key FROM migrations").all() as { key: string }[]).map((r) => r.key);
  assert.ok(keys.includes(AGENT_RUNTIME_SCHEMA), "the runtime registers exactly one migrations key");
  const tables = (host.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map((r) => r.name);
  for (const table of ["agents", "agent_runs", "agent_checkpoints", "agent_recovery_claims"]) assert.ok(tables.includes(table), table);
  // Reopen on the same file: idempotent, and the key is not duplicated.
  const before = keys.filter((k) => k === AGENT_RUNTIME_SCHEMA).length;
  new AgentStore(host);
  const after = (host.db.prepare("SELECT key FROM migrations").all() as { key: string }[]).filter((r) => r.key === AGENT_RUNTIME_SCHEMA).length;
  assert.equal(after, before, "reopen adds no second migrations row");
  cleanup();
  void dir;
});

test("T4 store: agent rows persist and upsert; the profile round-trips", () => {
  const { store, cleanup } = setup();
  const original = profile("a1", { name: "Writer" });
  store.saveAgent(original, "CREATED", { paused: false, stopped: false });
  const read = store.agent("a1");
  assert.deepEqual(read, original);
  store.saveAgent({ ...original, name: "Renamed" }, "RUNNING", { paused: true, stopped: false });
  const updated = store.agent("a1");
  assert.equal(updated?.name, "Renamed");
  assert.equal(store.agentFlags("a1").paused, true, "durable flags persist in the row, not the record alone");
  assert.deepEqual(store.agentFlags("unknown"), { paused: false, stopped: false }, "unknown agent reads as unflagged");
  assert.equal(store.agent("ghost"), null);
  cleanup();
});

test("T4 store: corrupt agent records fail closed instead of reviving garbage", () => {
  const { host, store, cleanup } = setup();
  store.saveAgent(profile("a1"), "CREATED", { paused: false, stopped: false });
  host.db.prepare("UPDATE agents SET record='{ not json' WHERE id='a1'").run();
  assert.throws(() => store.agent("a1"), /property name|Unexpected token|corrupt/i);
  // The NOT NULL record column refuses an all-null wipe; structurally-broken JSON that parses still fails closed.
  host.db.prepare("UPDATE agents SET record='{\"x\":1}' WHERE id='a1'").run();
  assert.throws(() => store.agent("a1"), /corrupt/);
  cleanup();
});

test("T4 A20 store claim: ONE worker per agent — a second claim is refused until released or expired", () => {
  const { store, cleanup } = setup();
  const now = Date.now();
  const first = store.claimRecovery("a1", "claim-w1", 1, "host:111", now);
  assert.deepEqual(first, { ok: true, holder: "host:111" });
  const second = store.claimRecovery("a1", "claim-w2", 1, "host:222", now);
  assert.equal(second.ok, false);
  assert.equal(second.holder, "host:111");
  // The same worker re-entering with ITS OWN claim is fine (idempotent re-entry during the walk).
  assert.equal(store.claimRecovery("a1", "claim-w1", 1, "host:111", now).ok, true);
  store.releaseClaim("a1", "claim-w1");
  assert.equal(store.claimRecovery("a1", "claim-w2", 1, "host:222", now).ok, true, "a released claim admits the loser");
  cleanup();
});

test("T4 A20/store: an expired claim is not authority — TTL lapse releases the agent", () => {
  const { store, cleanup } = setup();
  const now = Date.now();
  store.claimRecovery("a1", "claim-w1", 1, "host:111", now - 121_000);
  assert.equal(store.claimHolder("a1"), null, "a lapsed claim holder is not reported");
  assert.equal(store.claimRecovery("a1", "claim-w2", 1, "host:222", now).ok, true, "the stale claim loses to a fresh one");
  cleanup();
});

test("T4 runs: generations are ordered lineages; closeRun seals with a reason; latestRun reads the open tip", () => {
  const { store, cleanup } = setup();
  const run1 = { id: "r1", agentId: "a1", generation: 1, state: "RUNNING" as const, startedAt: 1, endedAt: null, endReason: null, resumedFromRunId: null, resumedFromCheckpointId: null };
  store.openRun(run1);
  assert.deepEqual(store.latestRun("a1"), run1);
  store.closeRun("r1", "INTERRUPTED", "Host restarted during generation 1.", 99);
  const closed = store.latestRun("a1")!;
  assert.equal(closed.state, "INTERRUPTED");
  assert.equal(closed.endedAt, 99);
  assert.equal(closed.endReason, "Host restarted during generation 1.");
  const run2 = { ...run1, id: "r2", generation: 2, startedAt: 100, resumedFromRunId: "r1" };
  store.openRun(run2);
  assert.deepEqual(store.runs("a1").map((r) => r.id), ["r1", "r2"]);
  assert.equal(store.latestRun("a1")?.generation, 2);
  store.closeRun("ghost", "STOPPED", "n/a", 1); // unknown runs close silently
  cleanup();
});

test("T4 A33/A34 checkpoint guard: secrets, forbidden keys and oversized strings are refused before any insert", () => {
  const { store, cleanup } = setup();
  const base = checkpoint("c1", "r1");
  for (const [label, patch] of [
    ["api key in refs", { refs: { missionId: "m1", apiKey: "sk-abcdefghijklmnop1234" } }],
    ["bearer header", { refs: { missionId: "m1", auth: null }, summary: "Bearer abcdefghijklmnop1234 was here", }],
    ["provider token shape", { refs: { missionId: "m1", token: "ghp_" + "A1b2C3d4E5f6G7h8I9j0K1" }, }],
    ["cookie session", { refs: { missionId: "m1", session_cookie: "abc123456789" }, }],
  ] as [string, Partial<AgentCheckpoint>][]) {
    assert.throws(() => { assertCheckpointSafe({ ...base, ...patch }); }, /Checkpoint refused by material guard/, label);
    assert.throws(() => store.saveCheckpoint({ ...base, id: `c-${label.replace(/\W/g, "")}`, ...patch }), /Checkpoint refused by material guard/, `store refuses ${label}`);
  }
  // Forbidden structural keys at any depth.
  for (const [label, patch] of [
    ["pid key", { refs: { pid: "9341" } }],
    ["chain of thought", { facts: { chain_of_thought: "thinking..." } }],
    ["hidden state", { facts: { hidden_state: 1 } }],
    ["thinking", { refs: { thinking: true } }],
    ["handle", { refs: { handle: 42 } }],
    ["hwnd", { refs: { hwnd: "0x00" } }],
  ] as [string, Partial<AgentCheckpoint>][]) {
    const scan = scanCheckpointJson(JSON.stringify({ ...base, ...patch }));
    assert.equal(scan.safe, false, label);
    assert.ok(scan.findings.some((f) => f.startsWith("forbidden-key:")), `${label} reports a forbidden key, never the value`);
  }
  // An oversized free-text string is structural slop, not a checkpoint.
  assert.ok(scanCheckpointJson(JSON.stringify({ ...base, summary: "x".repeat(401) })).findings.includes("oversized-string"));
  // The scanner reports findings structurally; it must never echo the matched secret.
  const leak = scanCheckpointJson(JSON.stringify({ ...base, refs: { value: "sk-abcdefghijklmnop1234" } }));
  assert.ok(!JSON.stringify(leak.findings).includes("sk-abcdefghijklmnop"), "findings name patterns, not secrets");
  cleanup();
});

test("T4 checkpoints: parse-then-read, monotonic revisions, and the 200-per-run trim keeps the newest", () => {
  const { store, cleanup } = setup();
  store.saveCheckpoint(checkpoint("c1", "r1"));
  assert.deepEqual(store.checkpoint("c1")?.boundary, "before_task_admission");
  assert.deepEqual(store.checkpoints("r1").map((c) => c.revision), [1], "read back in revision order");
  // Corrupt row fails closed on read.
  store.host.db.prepare("UPDATE agent_checkpoints SET record='{bad' WHERE id='c1'").run();
  assert.throws(() => store.checkpoints("r1"));
  const fresh = store.host.db.prepare("DELETE FROM agent_checkpoints WHERE id='c1'").run();
  assert.equal(fresh.changes, 1);
  for (let revision = 1; revision <= MAX_CHECKPOINTS_PER_RUN + 2; revision++) {
    store.saveCheckpoint(checkpoint(`cp${revision}`, "r2", { revision, at: revision }));
  }
  store.trimCheckpoints("r2");
  assert.equal(store.checkpointCount("r2"), MAX_CHECKPOINTS_PER_RUN, "the trim keeps the bounded history size");
  const remaining = store.checkpoints("r2").map((c) => c.revision);
  assert.equal(Math.min(...remaining), 3, "the OLDEST checkpoints go first");
  assert.equal(store.lastCheckpoint("r2")?.boundary, "before_task_admission");
  cleanup();
});

test("T4 countActive/snapshot: terminals no longer count active; the cursor follows the event journal", () => {
  const { host, store, cleanup } = setup();
  store.saveAgent(profile("a1"), "RUNNING", { paused: false, stopped: false });
  store.saveAgent(profile("a2", { missionId: "m2" }), "COMPLETED", { paused: false, stopped: false });
  store.saveAgent(profile("a3", { missionId: "m2" }), "STOPPED", { paused: false, stopped: false });
  assert.equal(store.countActive(), 1);
  host.event("task.completed", "t1", "x");
  const snapshot = store.snapshot();
  assert.deepEqual(snapshot.agents.map((a) => a.id), ["a1", "a2", "a3"]);
  const running = snapshot.agents.find((a) => a.id === "a1")!;
  assert.equal(running.state, "RUNNING");
  assert.equal(running.checkpoints, 0);
  assert.equal(snapshot.cursor > 0, true, "cursor reads the canonical journal maximum");
  assert.equal(store.snapshot().cursor, snapshot.cursor + 0, "snapshots are stable without new events");
  cleanup();
});

test("A20 runtime claim: exactly one recovery walk runs while a claim is held; released afterwards", async () => {
  const { host, store, cleanup } = setup();
  store.saveAgent(profile("a"), "RUNNING", { paused: false, stopped: false });
  const holder = "host:1234";
  assert.equal(store.claimRecovery("a", "c1", 1, holder, Date.now()).ok, true);
  const contender = store.claimRecovery("a", "c2", 1, "host:5678", Date.now());
  assert.equal(contender.ok, false, "A20: the second worker must skip, not queue");
  assert.equal(store.claimHolder("a"), holder);
  store.releaseClaim("a", "c1");
  assert.equal(store.claimHolder("a"), null, "after release the claim table is empty for this agent");
  store.releaseAllClaims();
  await until(() => true, "noop settle");
  cleanup();
});