/**
 * Agent-pill truth locks (M2 Sprint: agent-visual truthfulness lock).
 *
 * The notch's active row may only show state words the Host itself knows:
 * the exact TruthState, or the canonical taskStatus label. No invented words,
 * no percentages, and no silent hiding of capped rows.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { PILL_TONE_BACKGROUND, activeAgentPills, agentRowLayout, isKnownPillLabel, taskPill, MAX_ACTIVE_PILLS, type AgentPill } from "./agent-pill-model.ts";
import { UNCERTAIN_LABEL } from "../../lib/bunny-host/presentation.ts";
import type { OrchTask, TruthState } from "../../lib/orch/types.ts";

const RUN_STATES: OrchTask["state"][] = ["queued", "routing", "waiting_for_approval", "launching", "running", "waiting_for_input", "waiting_for_agent_approval", "verifying", "paused"];
const ALL_TRUTH_STATES = ["Proposed", "Awaiting approval", "Queued", "Planning", "Working", "Testing", "Reviewing", "Paused", "Completed", "Failed", "Cancelled", "Uncertain"];

const baseTask = (over: Partial<OrchTask> & { id: string; state: OrchTask["state"] }): OrchTask =>
  ({ provider: "codex", title: "Task " + over.id, ...over }) as unknown as OrchTask;

const labelSet = (pills: AgentPill[]) => pills.map((p) => p.label);

test("every TruthState passes through verbatim - no relabeling, no invention", () => {
  for (const truth of ALL_TRUTH_STATES as TruthState[]) {
    const pill = taskPill(baseTask({ id: "t-" + truth, state: "running", truthState: truth }));
    assert.equal(pill.label, truth, `truth state ${truth} must be shown verbatim`);
    assert.ok(isKnownPillLabel(pill.label));
  }
});

test("missing truthState falls back to the canonical taskStatus label, never 'Working'", () => {
  const expected: Record<string, string> = {
    queued: "Queued",
    routing: "Routing",
    waiting_for_approval: "Approval required",
    launching: "Provider starting",
    running: "Provider turn running",
    waiting_for_input: "Waiting for user",
    waiting_for_agent_approval: "Approval required",
    verifying: "Bunny verifying",
    paused: "Paused",
  };
  for (const state of RUN_STATES) {
    const pill = taskPill(baseTask({ id: "t-" + state, state, truthState: null }));
    assert.equal(pill.label, expected[state], `${state} must use its canonical label`);
    assert.notEqual(pill.label, "Working", "no pill may claim Working without the Host truth state");
    assert.ok(isKnownPillLabel(pill.label));
  }
});

test("reconciliation-pending tasks are labeled with the reconciliation truth, not a guess", () => {
  const pill = taskPill(baseTask({ id: "t-rec", state: "running", truthState: null, reconciliation: { required: true, reason: "post-condition unclear", at: 0 } }) as OrchTask);
  assert.equal(pill.label, UNCERTAIN_LABEL);
  assert.ok(isKnownPillLabel(pill.label));
});

test("'Working' appears only when the Host truth state says Working", () => {
  const rows = [
    taskPill(baseTask({ id: "w1", state: "running", truthState: "Working" })),
    taskPill(baseTask({ id: "w2", state: "running" })),
    taskPill(baseTask({ id: "w3", state: "queued" })),
  ];
  const working = rows.filter((p) => p.label === "Working");
  assert.equal(working.length, 1);
  assert.equal(working[0].id, "w1");
});

test("approval states get the approval tone, with or without a truthState", () => {
  const a = taskPill(baseTask({ id: "a1", state: "waiting_for_approval" }));
  const b = taskPill(baseTask({ id: "a2", state: "running", truthState: "Awaiting approval" }));
  const inputs = taskPill(baseTask({ id: "a3", state: "waiting_for_input" }));
  assert.equal(a.tone, "approval");
  assert.equal(b.tone, "approval");
  assert.equal(inputs.tone, "approval");
  assert.equal(a.label, "Approval required");
  assert.equal(b.label, "Awaiting approval");
  assert.equal(inputs.label, "Waiting for user");
});

test("pill detail carries the task title and the shown state - no raw enum", () => {
  const pill = taskPill(baseTask({ id: "d1", state: "running", truthState: "Testing", title: "Ship report" }));
  assert.equal(pill.detail, "Ship report: Testing");
  assert.ok(!pill.detail.includes("running:"));
});

test("tone backgrounds keep the shipped visual mapping and define every tone", () => {
  assert.equal(PILL_TONE_BACKGROUND.testing, "rgba(79, 140, 255, 0.2)");
  assert.equal(PILL_TONE_BACKGROUND.reviewing, "rgba(147, 83, 211, 0.2)");
  assert.equal(PILL_TONE_BACKGROUND.neutral, "rgba(255, 255, 255, 0.1)");
  for (const tone of ["neutral", "testing", "reviewing", "approval", "paused"] as const) {
    assert.ok(PILL_TONE_BACKGROUND[tone], `tone ${tone} has a background`);
  }
});

test("row caps at three pills and reports the exact overflow count", () => {
  const tasks = [1, 2, 3, 4, 5].map((n) => baseTask({ id: "p" + n, state: "queued" as const }));
  const row = activeAgentPills(tasks);
  assert.equal(row.total, 5);
  assert.equal(row.pills.length, MAX_ACTIVE_PILLS);
  assert.equal(row.overflow, 2);
  assert.deepEqual(labelSet(row.pills), ["Queued", "Queued", "Queued"]);
  assert.deepEqual(activeAgentPills(tasks.slice(0, 3)), { total: 3, pills: row.pills, overflow: 0 });
  assert.deepEqual(activeAgentPills([], 3), { total: 0, pills: [], overflow: 0 });
});

test("no pill label ever invents percentages or ETAs", () => {
  const tasks = ["queued", "running", "verifying", "waiting_for_input", "waiting_for_approval", "launching", "routing", "paused"].map((s) =>
    baseTask({ id: "np-" + s, state: s as OrchTask["state"] }),
  );
  const row = activeAgentPills(tasks);
  for (const pill of row.pills) {
    assert.ok(!/\d+\s*%/.test(pill.label), `no percentage in ${pill.label}`);
    assert.ok(!/\d+s\b/.test(pill.label), `no ETA in ${pill.label}`);
    assert.ok(isKnownPillLabel(pill.label.replace(/^\+/, "")), `known label only: ${pill.label}`);
  }
});

test("notch axis follows the placement doctrine: center = horizontal row, left/right = vertical column", () => {
  assert.deepEqual(agentRowLayout("center"), { direction: "row", vertical: false, axisClass: "notch-horizontal-left" });
  assert.deepEqual(agentRowLayout("left"), { direction: "column", vertical: true, axisClass: "notch-vertical-top" });
  assert.deepEqual(agentRowLayout("right"), { direction: "column", vertical: true, axisClass: "notch-vertical-top" });
});
