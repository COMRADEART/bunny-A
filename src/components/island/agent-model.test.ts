import test from "node:test";
import assert from "node:assert/strict";
import { AGENT_NON_TERMINAL, AGENT_STATE_LABEL, agentPanelRows, CHECKPOINT_LABEL } from "./agent-model.ts";
import type { AgentSnapshot } from "../../lib/bunny-host/agent-types.ts";

type AgentRow = AgentSnapshot["agents"][number];

const agent = (id: string, state: AgentRow["state"], extra: Partial<AgentRow> = {}): AgentRow => ({
  id,
  name: `Agent ${id}`,
  state,
  missionId: "m1",
  createdAt: 1,
  updatedAt: 10,
  failure: null,
  run: null,
  checkpoints: 0,
  lastCheckpoint: null,
  pausedAt: state === "PAUSED" ? 5 : null,
  stoppedAt: state === "STOPPED" ? 5 : null,
  note: null,
  ...extra,
});
type Agent = AgentRow;

// Gate T4: the panel states agent truths only — the runtime's states, checkpoints and controls.
test("T4: every one of the eleven agent states has a product label, terminals read as finished", () => {
  const states: Agent["state"][] = ["CREATED", "PLANNING", "RUNNING", "WAITING_FOR_USER", "WAITING_FOR_DEPENDENCY", "PAUSED", "VERIFYING", "COMPLETED", "FAILED", "STOPPED", "INTERRUPTED"];
  for (const state of states) assert.ok(AGENT_STATE_LABEL[state]?.length, `${state} has a label`);
  assert.equal(Object.keys(AGENT_STATE_LABEL).length, 11);
  assert.equal(AGENT_STATE_LABEL.WAITING_FOR_USER, "Needs you");
  assert.equal(AGENT_STATE_LABEL.INTERRUPTED, "Interrupted");
});

test("T4: rows order needs-you first, active next, finished last, newest first inside a band", () => {
  const snapshot = {
    agents: [agent("done", "COMPLETED", { updatedAt: 20 }), agent("asking", "WAITING_FOR_USER", { updatedAt: 3 }), agent("run", "RUNNING", { updatedAt: 9 }), agent("paused", "PAUSED", { updatedAt: 30 })],
    cursor: 0,
  } satisfies AgentSnapshot;
  const { rows } = agentPanelRows(snapshot);
  assert.deepEqual(rows.map((r) => r.id), ["asking", "paused", "run", "done"]);
  // needs-you ranks first (band 0); paused is an active band-1 row sorted by recency
  assert.ok(rows.every((r) => r.label.length > 0));
});

test("T4: honesty per row — paused/controllable flags, generation and last checkpoint are shown", () => {
  const snapshot = {
    agents: [
      agent("live", "RUNNING", { run: { id: "r1", generation: 3, state: "RUNNING", startedAt: 1, endedAt: null }, checkpoints: 2, lastCheckpoint: { boundary: "after_task_completion", at: 7, replaySafety: "VERIFY_BEFORE_REPLAY" } }),
      agent("over", "COMPLETED"),
      agent("held", "PAUSED"),
    ],
    cursor: 0,
  } satisfies AgentSnapshot;
  const { rows, more } = agentPanelRows(snapshot);
  const live = rows.find((r) => r.id === "live")!;
  assert.equal(live.generation, 3);
  assert.equal(live.checkpoints, 2);
  assert.deepEqual(live.lastCheckpoint, { boundary: "after_task_completion", at: 7, replaySafety: "VERIFY_BEFORE_REPLAY" });
  assert.equal(live.controllable, true, "a running agent can be commanded");
  assert.equal(live.paused, false);
  const over = rows.find((r) => r.id === "over")!;
  assert.equal(over.controllable, false, "a completed agent cannot be commanded");
  assert.equal(over.paused, false);
  const held = rows.find((r) => r.id === "held")!;
  assert.equal(held.paused, true);
  assert.equal(held.controllable, true);
  assert.equal(more, 0);
});

test("T4: the cap hides the overflow honestly with +N, never silently", () => {
  const snapshot = { agents: Array.from({ length: 9 }, (_, i) => agent(`a${i}`, "RUNNING", { updatedAt: i })), cursor: 0 } satisfies AgentSnapshot;
  const { rows, more } = agentPanelRows(snapshot);
  assert.equal(rows.length, 6);
  assert.equal(more, 3);
  const small = agentPanelRows(snapshot, 20);
  assert.equal(small.rows.length, 9);
  assert.equal(small.more, 0);
});

test("T4: no Host answers yet — the panel renders nothing rather than an empty block", () => {
  assert.deepEqual(agentPanelRows(null), { rows: [], more: 0 });
  assert.deepEqual(agentPanelRows(undefined), { rows: [], more: 0 });
  assert.deepEqual(agentPanelRows({ agents: [], cursor: 0 }), { rows: [], more: 0 });
});

test("T4: control truth follows the runtime's refusals — only non-terminal states command, resume only paused", () => {
  const terminal: Agent["state"][] = ["COMPLETED", "FAILED", "STOPPED"];
  const nonTerminal: Agent["state"][] = AGENT_NON_TERMINAL as Agent["state"][];
  assert.equal(terminal.some((s) => AGENT_NON_TERMINAL.includes(s)), false, "terminal states are never controllable");
  for (const state of nonTerminal) {
    assert.ok(AGENT_NON_TERMINAL.includes(state));
    const row = agentPanelRows({ agents: [agent("x", state)], cursor: 0 }).rows[0];
    assert.equal(row.controllable, true, state);
    assert.equal(row.paused, state === "PAUSED");
  }
  assert.equal(AGENT_NON_TERMINAL.length, 8);
});

test("T4: checkpoint boundaries have human labels for all eight reconstruction points", () => {
  for (const boundary of ["before_task_admission", "after_task_completion", "after_verification", "before_waiting_for_user", "after_approval_decision", "before_provider_reroute", "after_artifact_commit", "before_terminal_state"]) {
    assert.ok(CHECKPOINT_LABEL[boundary]?.length, `${boundary} has a label`);
  }
});