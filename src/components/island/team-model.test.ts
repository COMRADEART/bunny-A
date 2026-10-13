import test from "node:test";
import assert from "node:assert/strict";
import { parseRequirementLines, teamAgentIds, teamPanels } from "./team-model.ts";

// M-A-3 T11 — the Agentic team panel is a projection of canonical rows (M65): nothing is invented or summarized by a model.

const step = (id: string, key: string, role: string, kind: string, state: string, extra: Record<string, unknown> = {}) => ({
  id, objective: `${key} objective`, state, dependsOn: [] as string[], attempts: state === "pending" ? [] : [{ taskId: null, outcome: state }], result: state === "completed" ? { verified: true } : null,
  team: { key, role, agentId: role, kind, inputs: [], round: 0, ...extra }, ...("deps" in extra ? { dependsOn: extra.deps as string[] } : {}),
});
const mission = {
  id: "m", state: "running", requests: [{ id: "q", resolvedAt: null }],
  steps: [
    step("s1", "plan", "planner", "plan", "completed"),
    step("s2", "t1", "researcher", "generate_json", "completed"),
    step("s3", "t2", "implementer", "generate_html", "running", { deps: ["s2"] }),
    step("s4", "t3", "tester", "verify_output", "failed", { supersededBy: "s6" }),
    step("s5", "t2_r1", "implementer", "generate_html", "pending", { round: 1, dormant: true }),
    step("s6", "t3_r1", "tester", "verify_output", "running", { round: 1 }),
  ],
  teamView: {
    phase: "executing", planReference: null, planRevisions: 1, reworkRounds: 1,
    rejected: [{ at: 1, reasons: ["t5.target must be a plain file name."] }],
    handoffs: [{ id: "h", sourceAgentId: "researcher", destinationAgentId: "implementer", artifactType: "structured_result", artifactSha256: "a".repeat(64), purpose: "context", state: "DELIVERED" }],
    requirementResults: [{ id: "R1", text: "Summary", passed: false, detail: "failed — element id missing", round: 0 }, { id: "R2", text: "Items", passed: null, detail: null, round: null }],
    findings: [{ agentId: "reviewer", verdict: "changes_requested", findings: [{ requirement: "R1", severity: "blocking", summary: "No summary", confirmedByHost: true }] }],
  },
};
const agents = {
  cursor: 1,
  agents: [
    { id: "c", name: "Team", state: "RUNNING", missionId: "m", updatedAt: 1, team: { role: "coordinator", coordinatorId: null, missionId: "m" } },
    { id: "researcher", name: "Team · Researcher", state: "WAITING_FOR_DEPENDENCY", missionId: "m", updatedAt: 1, team: { role: "researcher", coordinatorId: "c", missionId: "m" }, current: { stepId: "s2", role: "Researcher", kind: "generate_json", state: "completed", provider: "ollama", model: "qwen2.5-coder:7b", taskId: "t" }, owned: { total: 1, completed: 1, running: 0, failed: 0, verified: 1 } },
    { id: "implementer", name: "Team · Implementer", state: "RUNNING", missionId: "m", updatedAt: 1, team: { role: "implementer", coordinatorId: "c", missionId: "m" }, current: { stepId: "s3", role: "Implementer", kind: "generate_html", state: "running", provider: "ollama", model: "qwen2.5-coder:7b", taskId: "u" }, owned: { total: 1, completed: 0, running: 1, failed: 0, verified: 0 } },
    { id: "solo", name: "ledger", state: "RUNNING", missionId: "z", updatedAt: 1 },
  ],
};

test("M65: the team panel shows members, own tasks, routed models, graph, handoffs and Host verdicts truthfully", () => {
  const [panel] = teamPanels(agents as never, [mission] as never);
  assert.equal(panel.coordinatorId, "c");
  assert.deepEqual(panel.members.map((member) => [member.roleLabel, member.stateLabel, member.task]), [["Researcher", "Waiting on a step", "Building dataset"], ["Implementer", "Running", "Building page"]]);
  assert.equal(panel.members[1].model, "ollama · qwen2.5-coder:7b (routed per task)");
  assert.deepEqual(panel.graph.map((node) => node.key), ["plan", "t1", "t2", "t3", "t3_r1"], "a reserved replica appears only once activated");
  assert.equal(panel.reserved, 1);
  assert.deepEqual(panel.graph.find((node) => node.key === "t2")!.dependsOn, ["t1"]);
  assert.deepEqual(panel.progress, { done: 2, total: 4 }, "a superseded failure is not counted twice");
  assert.deepEqual(panel.requirements.map((item) => item.state), ["failed", "pending"], "unchecked is never shown as passed");
  assert.equal(panel.findings[0].items[0].host, "confirmed");
  assert.deepEqual(panel.handoffs[0], { id: "h", from: "Researcher", to: "Implementer", type: "structured_result", sha: "aaaaaaaaaaaa", purpose: "context", state: "DELIVERED" });
  assert.equal(panel.approvals, 1);
  assert.deepEqual([...teamAgentIds(agents as never)].sort(), ["c", "implementer", "researcher"], "team Agents leave the flat list; single Agents stay");
});

test("New team form: requirement lines parse into bounded checks with fixed ids, or name the problem", () => {
  const parsed = parseRequirementLines("html_id summary | Has a summary\n\nno_external_resources | Offline\nmarkdown_heading Usage | Usage section");
  assert.deepEqual(parsed.errors, []);
  assert.deepEqual(parsed.requirements, [
    { id: "R1", text: "Has a summary", check: { kind: "html_id", value: "summary" } },
    { id: "R2", text: "Offline", check: { kind: "no_external_resources" } },
    { id: "R3", text: "Usage section", check: { kind: "markdown_heading", value: "Usage" } },
  ]);
  assert.match(parseRequirementLines("shell rm -rf | x").errors[0], /unknown check "shell"/);
  assert.match(parseRequirementLines("html_id | missing value").errors[0], /needs a value/);
  assert.match(parseRequirementLines("dataset_values").errors[0], /description/);
});
