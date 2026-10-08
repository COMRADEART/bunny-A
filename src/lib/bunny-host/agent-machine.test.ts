import test from "node:test";
import assert from "node:assert/strict";
import { AGENT_FAILURES, AGENT_LIFECYCLE_EVENTS, AGENT_NEXT, AGENT_STATES, agentCanTransition, agentLifecycleLabel, deriveAgentState, mapFailure, routingExhausted, type AgentFlags } from "./agent-types.ts";
import type { AgentStepFacts } from "./agent-types.ts";
import type { MissionState } from "../bunny-missions/types.ts";

const flags = (paused = false, stopped = false): AgentFlags => ({ paused, stopped });
const stepFacts = (state: AgentStepFacts["state"], attempts: AgentStepFacts["attempts"] = []): AgentStepFacts => ({ state, attempts });
const mission = (state: string) => ({ state: state as MissionState });

// Gate T4 — the agent state machine is validated as a table: every listed transition is legal, every
// unlisted one is refused, and the three terminal states never exit (A09/A10/A22).
test("T4 agent machine: eleven states exactly; COMPLETED/FAILED/STOPPED have no exits", () => {
  assert.deepEqual([...AGENT_STATES as readonly string[]].sort(), [...AGENT_STATES].sort(), "AGENT_STATES is the exhaustive list");
  assert.equal(AGENT_STATES.length, 11);
  for (const state of ["COMPLETED", "FAILED", "STOPPED"] as const) assert.deepEqual(AGENT_NEXT[state], [], `${state} never exits`);
  for (const from of AGENT_STATES) for (const to of AGENT_STATES) {
    assert.equal(agentCanTransition(from, to), AGENT_NEXT[from].includes(to), `${from}→${to} matches the table exactly`);
  }
});

test("T4 agent machine: every state must offer at least one path to RUNNING except the terminals", () => {
  for (const state of ["CREATED", "PLANNING", "RUNNING", "WAITING_FOR_USER", "WAITING_FOR_DEPENDENCY", "PAUSED", "VERIFYING", "INTERRUPTED"] as const) {
    assert.ok(AGENT_NEXT[state].length > 0, `${state} can continue`);
  }
  // RUNNING→PAUSED and PAUSED→RUNNING hold; pause is a legal pause of work, not an exit.
  assert.ok(agentCanTransition("RUNNING", "PAUSED"));
  assert.ok(agentCanTransition("PAUSED", "RUNNING"));
  assert.ok(agentCanTransition("RUNNING", "INTERRUPTED"));
  assert.ok(!agentCanTransition("COMPLETED", "PAUSED"), "no resurrect of COMPLETED via pause");
  assert.ok(!agentCanTransition("STOPPED", "RUNNING"), "no resurrect of STOPPED");
  assert.ok(!agentCanTransition("FAILED", "RUNNING"), "FAILED is terminal until the user starts a new run elsewhere");
});

test("T4 agent machine: derivation precedence — pause flag wins over a running mission, stop over pause, terminal over both", () => {
  const steps = [stepFacts("running")];
  assert.equal(deriveAgentState(mission("running"), steps, flags(false, false)), "RUNNING");
  assert.equal(deriveAgentState(mission("running"), steps, flags(true, false)), "PAUSED", "the pause flag is persisted state, not inferred");
  assert.equal(deriveAgentState(mission("running"), steps, flags(true, true)), "STOPPED", "a stop outranks a pause");
  assert.equal(deriveAgentState(mission("completed"), steps, flags(true, false)), "COMPLETED", "the canonical mission result outranks any flag");
  assert.equal(deriveAgentState(mission("failed"), steps, flags(false, false)), "FAILED");
  assert.equal(deriveAgentState(mission("stopped"), steps, flags(false, false)), "STOPPED");
});

test("T4 agent machine: derivation lands WAITING_FOR_USER only on canonical user asks", () => {
  assert.equal(deriveAgentState(mission("running"), [stepFacts("running")], flags()), "RUNNING");
  assert.equal(deriveAgentState(mission("running"), [stepFacts("waiting_for_approval")], flags()), "WAITING_FOR_USER", "A05: a permission ask is a user ask");
  assert.equal(deriveAgentState(mission("waiting_for_user"), [stepFacts("pending")], flags()), "WAITING_FOR_USER");
  assert.equal(deriveAgentState(mission("ready"), [], flags()), "WAITING_FOR_USER", "ready-but-unstarted still waits for a start decision");
  assert.equal(deriveAgentState(mission("draft"), [], flags()), "PLANNING", "unplanned work waits in PLANNING");
  assert.equal(deriveAgentState(mission("planning"), [], flags()), "PLANNING");
  assert.equal(deriveAgentState(mission("waiting_for_approval"), [], flags()), "PLANNING", "awaiting the plan approval is PLANNING, not a user ask");
  assert.equal(deriveAgentState(mission("running"), [], flags()), "RUNNING", "a running mission with no admitted step is still running");
  assert.equal(deriveAgentState(mission("running"), [stepFacts("pending")], flags()), "RUNNING");
});

test("T4 agent machine: derivation lands VERIFYING and WAITING_FOR_DEPENDENCY from step shapes", () => {
  assert.equal(deriveAgentState(mission("running"), [stepFacts("verifying"), stepFacts("completed")], flags()), "VERIFYING");
  assert.equal(deriveAgentState(mission("verifying"), [stepFacts("completed")], flags()), "VERIFYING");
  assert.equal(deriveAgentState(mission("running"), [stepFacts("blocked"), stepFacts("pending", [{ taskId: null, outcome: "completed" }])], flags()), "WAITING_FOR_DEPENDENCY");
  assert.equal(deriveAgentState(mission("running"), [stepFacts("blocked")], flags()), "WAITING_FOR_DEPENDENCY");
  assert.equal(deriveAgentState(mission("running"), [stepFacts("blocked"), stepFacts("running")], flags()), "RUNNING", "admitted work outranks a blocked dependency");
});

test("T4 agent machine: a null mission row derives CREATED, never a guess", () => {
  assert.equal(deriveAgentState(null, [], flags()), "CREATED");
  assert.equal(deriveAgentState(null, [stepFacts("running")], flags(false)), "CREATED");
});

// §10 failure taxonomy: canonical mission categories map to the agent vocabulary; details never cross.
test("T4 failure taxonomy: canonical categories map onto the nine agent categories", () => {
  assert.equal(AGENT_FAILURES.length, 9);
  assert.equal(mapFailure("host_restart", "was running").category, "HOST_INTERRUPTED");
  assert.equal(mapFailure("host_failure", "x").category, "HOST_INTERRUPTED");
  assert.equal(mapFailure("user_stopped", "x").category, "STOP_REQUESTED");
  assert.equal(mapFailure("permission_denied", "x").category, "AUTHORITY_LOST");
  assert.equal(mapFailure("dependency_failed", "x").category, "DEPENDENCY_FAILED");
  assert.equal(mapFailure("workspace_conflict", "x").category, "DEPENDENCY_FAILED");
  assert.equal(mapFailure("capability_unavailable", "x").category, "DEPENDENCY_FAILED");
  assert.equal(mapFailure("verification_failed", "x").category, "VERIFICATION_FAILED");
  assert.equal(mapFailure("budget_exceeded", "x").category, "ROUTING_EXHAUSTED");
  assert.equal(mapFailure("timeout", "x").category, "TASK_FAILED");
  assert.equal(mapFailure("invalid_plan", "x").category, "TASK_FAILED");
  assert.equal(mapFailure("something_new", "x").category, "TASK_FAILED", "unknown categories fail closed to TASK_FAILED");
});

test("T4 failure taxonomy: details are fixed phrases, never forward provider or mission prose (A33)", () => {
  const leaked = mapFailure("provider_failed", "Internal: the model said to run rm -rf and the api key is sk-abcdef1234567890abcdef");
  assert.equal(leaked.category, "TASK_FAILED");
  assert.doesNotMatch(leaked.detail, /rm -rf|api key|sk-abcdef/);
  assert.equal(mapFailure("host_restart", "PID 4242 was live").detail, "Host was restarted or failed; the previous execution was not resumed.");
});

test("T4 routing exhaustion follows the routed trail phrases, not arbitrary prose", () => {
  assert.ok(routingExhausted("Routing exhausted: no eligible provider remains."));
  assert.ok(routingExhausted("no eligible model after revalidation"));
  assert.ok(routingExhausted("routing attempts exhausted for this task"));
  assert.ok(!routingExhausted("routed to claude successfully"));
  assert.ok(!routingExhausted("the router is routing fine"));
});

test("T4 §25 label surface: lifecycle vocabulary is labeled as lifecycle, provider activity stays unlabeled here", () => {
  assert.equal(AGENT_LIFECYCLE_EVENTS.length, 15);
  for (const type of AGENT_LIFECYCLE_EVENTS) assert.ok(agentLifecycleLabel(type)?.length, type);
  assert.equal(agentLifecycleLabel("agent.editing"), null, "provider ACTIVITY rows (always taskId-bound) are not lifecycle rows");
  assert.equal(agentLifecycleLabel("task.completed"), null);
  assert.equal(agentLifecycleLabel("mission.step.started"), null);
});