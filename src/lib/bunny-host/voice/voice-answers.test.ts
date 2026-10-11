import test from "node:test";
import assert from "node:assert/strict";
import { answerApprovals, answerLastMission, answerModel, answerStatus, answerVerification, hostFactsFrom, pendingApprovalFacts, spokenModel, stepFact, type MissionFact } from "./voice-answers.server.ts";

const mission = (over: Partial<MissionFact> = {}): MissionFact => ({
  id: "m1",
  title: "Fix parser",
  status: "running",
  updatedAt: 10,
  steps: [{ title: "Run the suite", status: "running", model: "qwen3:8b", checks: [] }],
  ...over,
});

test("V30 status names the agent and its real mission and step", () => {
  const text = answerStatus([{ id: "a1", name: "Builder", state: "RUNNING", missionId: "m1", updatedAt: 1 }], [mission()]);
  assert.match(text, /Builder is running/);
  assert.match(text, /Fix parser/);
  assert.match(text, /Run the suite/);
});

test("V30 no active agent says none is running", () => {
  assert.equal(answerStatus([{ id: "a1", name: "Old", state: "COMPLETED", missionId: "m1", updatedAt: 1 }], []), "No agent is running right now.");
  assert.equal(answerStatus([], []), "No agent is running right now.");
});

test("V30 several active agents ask for a name instead of guessing", () => {
  const text = answerStatus([
    { id: "a1", name: "One", state: "RUNNING", missionId: null, updatedAt: 1 },
    { id: "a2", name: "Two", state: "PAUSED", missionId: null, updatedAt: 2 },
  ], []);
  assert.match(text, /2 agents are active/);
  assert.match(text, /One, Two/);
});

test("V31 verification counts only recorded checks and never reports a pending state", () => {
  const recorded = mission({ steps: [
    { title: "Unit tests", status: "completed", model: null, checks: [{ name: "unit tests", outcome: "passed" }] },
    { title: "Lint", status: "failed", model: null, checks: [{ name: "lint", outcome: "failed" }] },
  ] });
  const text = answerVerification(recorded);
  assert.match(text, /1 verification check passed and 1 failed/);
  assert.match(text, /Failed: lint/);
  assert.doesNotMatch(text, /pending/i);
});

test("V31 with no recorded results the answer says so, and an unverified step is not a pass", () => {
  assert.equal(answerVerification(mission()), "No verification results are recorded for that mission yet.");
  assert.equal(answerVerification(null), "No agent mission is available to check.");
});

test("V15 model is reported from the recorded value and never invented", () => {
  assert.equal(spokenModel(null), "unknown");
  assert.equal(spokenModel("auto"), "unknown");
  assert.equal(spokenModel("UNKNOWN"), "unknown");
  assert.equal(spokenModel("  "), "unknown");
  assert.equal(spokenModel("qwen3:8b"), "qwen3:8b");
  assert.match(answerModel(mission()), /qwen3:8b/);
  assert.match(answerModel(mission({ steps: [{ title: "Plan", status: "running", model: null, checks: [] }] })), /unknown/);
});

test("approvals list the count and names and say that voice cannot approve", () => {
  assert.equal(answerApprovals([]), "Nothing is waiting for your approval right now.");
  const text = answerApprovals([{ name: "Write notes", kind: "task" }, { name: "Mission step", kind: "mission_request" }]);
  assert.match(text, /^2 items are waiting/);
  assert.match(text, /I can't approve anything by voice/);
});

test("last mission reports title, terminal status and the recorded verification summary", () => {
  assert.equal(answerLastMission(null), "I don't have a finished mission to report.");
  const text = answerLastMission(mission({ status: "completed", steps: [{ title: "a", status: "completed", model: null, checks: [{ name: "a", outcome: "passed" }, { name: "b", outcome: "failed" }] }] }));
  assert.match(text, /Fix parser, completed/);
  assert.match(text, /1 of 2 recorded verification checks passed/);
});

test("the adapter maps only real agent rows and mission records", () => {
  const facts = hostFactsFrom({
    agents: [{ id: "a1", name: "Builder", state: "RUNNING", missionId: "m1", createdAt: 1, updatedAt: 5, failure: null, run: null, checkpoints: 0, lastCheckpoint: null, pausedAt: null, stoppedAt: null, note: null } as never],
    mission: (id) => (id === "m1" ? ({ id: "m1", title: "Fix parser", state: "running", updatedAt: 9, steps: [{ objective: "Run tests", state: "completed", taskId: "t1", result: { summary: "", artifactIds: [], verified: true, verification: [] }, attempts: [] }] } as never) : null),
    approvals: () => [],
    taskModel: () => "qwen3:8b",
  });
  assert.equal(facts.agents[0].name, "Builder");
  assert.equal(facts.missions[0].steps[0].model, "qwen3:8b");
  assert.deepEqual(facts.missions[0].steps[0].checks, [{ name: "Run tests", outcome: "passed" }]);
});

test("a step with no recorded verdict contributes no check", () => {
  const fact = stepFact({ objective: "Build", state: "completed", result: { summary: "", artifactIds: [], verified: null, verification: [] } }, null);
  assert.deepEqual(fact.checks, []);
});

// M-A-3 T10 round 2 (H7): what needs the workstation's decision comes from canonical records only.

test("T10 H7 pending approvals include unresolved mission permission requests and agents waiting for the user", () => {
  const facts = pendingApprovalFacts({
    tasks: [
      { state: "waiting_for_approval", provider: "codex", mission: null },
      { state: "waiting_for_approval", provider: "codex", mission: { missionId: "m1" } },
      { state: "running", provider: "ollama", mission: null },
    ],
    missions: [
      { title: "Refactor parser", requests: [{ resolvedAt: null }, { resolvedAt: 5 }] },
      { title: "Idle mission", requests: [{ resolvedAt: 9 }] },
    ],
    agents: [
      { name: "Builder", state: "WAITING_FOR_USER" },
      { name: "Reviewer", state: "RUNNING" },
    ],
  });
  assert.deepEqual(facts, [
    { name: "codex task", kind: "task" },
    { name: "Refactor parser permission", kind: "mission_request" },
    { name: "Builder agent", kind: "mission_request" },
  ]);
});

test("T10 H7 nothing pending in the records means an empty list, never an invented item", () => {
  assert.deepEqual(pendingApprovalFacts({ tasks: [], missions: [], agents: [] }), []);
  assert.match(answerApprovals(pendingApprovalFacts({ tasks: [], missions: [], agents: [] })), /Nothing is waiting/);
});

test("T10 H7 the approvals answer counts every pending kind and still refuses approval by voice", () => {
  const text = answerApprovals(pendingApprovalFacts({ tasks: [], missions: [{ title: "Plan", requests: [{ resolvedAt: null }] }], agents: [{ name: "Builder", state: "WAITING_FOR_USER" }] }));
  assert.match(text, /2 items are waiting/);
  assert.match(text, /Plan permission/);
  assert.match(text, /Builder agent/);
  assert.match(text, /can't approve anything by voice/);
});

// ---------------------------------------------------------------------------------------------------------------------
// M-A-3 T10 review round 2 regressions (approvals facts)
// ---------------------------------------------------------------------------------------------------------------------

test("R2-truth#2 an agent running while its consent offer is pending is named in the approvals answer, as the screen shows it", () => {
  const facts = pendingApprovalFacts({
    tasks: [],
    missions: [],
    agents: [{ name: "Scout", state: "RUNNING", authorization: { state: "WAITING_FOR_USER" } }, { name: "Quiet", state: "RUNNING", authorization: { state: "ACTIVE" } }],
  });
  assert.deepEqual(facts, [{ name: "Scout agent", kind: "mission_request" }]);
  const text = answerApprovals(facts);
  assert.match(text, /Scout agent/);
  assert.doesNotMatch(text, /Nothing is waiting/);
});

test("R2-truth#2 an agent in both WAITING_FOR_USER forms is listed once", () => {
  const facts = pendingApprovalFacts({ tasks: [], missions: [], agents: [{ name: "Builder", state: "WAITING_FOR_USER", authorization: { state: "WAITING_FOR_USER" } }] });
  assert.deepEqual(facts, [{ name: "Builder agent", kind: "mission_request" }]);
});

test("V31 T10-SUP#3 one pending ask is one item: an agent waiting on its Mission's unresolved request is not counted twice", () => {
  const facts = pendingApprovalFacts({
    tasks: [],
    missions: [{ id: "m-bravo", title: "Bravo mission", requests: [{ resolvedAt: null }] }],
    agents: [
      { name: "Bravo", state: "WAITING_FOR_USER", missionId: "m-bravo" },
      { name: "Charlie", state: "WAITING_FOR_USER", missionId: "m-charlie" },
    ],
  });
  assert.deepEqual(facts.map((f) => f.name), ["Bravo mission permission", "Charlie agent"]);
  assert.match(answerApprovals(facts), /2 items are waiting/);
});
