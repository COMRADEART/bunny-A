import test from "node:test";
import assert from "node:assert/strict";
import type { AgentSnapshot, AgentState } from "./agent-types.ts";
import type { MissionStep, MissionView } from "../bunny-missions/types.ts";
import {
  defaultPersonalAgentsConfig,
  isUserFacingAgent,
  parsePersonalAgentsConfig,
  PERSONAL_AGENTS_SCHEMA,
  PROVIDER_EVENT_FRESH_MS,
  projectPersonalAgents,
  validatePersonalAgentSlots,
  type PersonalAgentSlotConfig,
  type PersonalAgentsConfig,
  type PresentationState,
} from "./personal-agents.ts";

/** M-A-3 T13 pure contract: validation, persistence fallback, Host-derived presentation and projection. */

type AgentRow = AgentSnapshot["agents"][number];
type TaskFact = Parameters<typeof projectPersonalAgents>[0]["tasks"][number];
const NOW = 1_000_000;

function row(over: { id: string; state: AgentState } & Record<string, unknown>): AgentRow {
  return {
    name: over.id.toUpperCase(),
    missionId: null,
    createdAt: 1,
    updatedAt: 1,
    failure: null,
    run: null,
    checkpoints: 0,
    lastCheckpoint: null,
    pausedAt: null,
    stoppedAt: null,
    ...over,
  } as unknown as AgentRow;
}

function step(over: Partial<MissionStep> & { id: string }): MissionStep {
  return { state: "running", startedAt: 1, executor: { kind: "model" }, taskId: null, team: undefined, ...over } as unknown as MissionStep;
}

function mission(over: Partial<MissionView> & { id: string }): MissionView {
  return { title: "Mission", objective: "Objective", projectId: null, steps: [], requests: [], result: null, ...over } as unknown as MissionView;
}

function teamStep(id: string, kind: string, startedAt: number): MissionStep {
  return step({ id, startedAt, team: { key: id, role: "implementer", agentId: null, kind } as unknown as MissionStep["team"] });
}

function capabilityStep(id: string, action: string, params: Record<string, unknown> = {}, startedAt = 5): MissionStep {
  return step({ id, startedAt, executor: { kind: "capability", action, params } as unknown as MissionStep["executor"] });
}

function configOf(bindings: Partial<Record<1 | 2 | 3 | 4, string>> = {}): PersonalAgentsConfig {
  const base = defaultPersonalAgentsConfig(0);
  return { ...base, revision: 3, slots: base.slots.map((slot) => ({ ...slot, agentId: bindings[slot.slot] ?? null })) };
}

const valid = (overrides: Record<number, Record<string, unknown>> = {}) =>
  [1, 2, 3, 4].map((slot, index) => ({
    slot,
    weapon: ["gada", "spear", "chakra", "sword"][index],
    displayName: "",
    description: "",
    purpose: "",
    style: "concise",
    responsibilities: [],
    agentId: null,
    active: true,
    ...(overrides[slot] ?? {}),
  }));

const ids = (...list: string[]) => new Set(list);

// ---------------------------------------------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------------------------------------------

test("T13 validation accepts four slots, one per weapon, and returns them ordered by slot", () => {
  const input = valid({ 1: { agentId: "agent-a" }, 3: { agentId: "agent-b", displayName: "  Reviewer\u0007  " } }).reverse();
  const slots = validatePersonalAgentSlots(input, ids("agent-a", "agent-b"));
  assert.deepEqual(slots.map((slot) => slot.slot), [1, 2, 3, 4]);
  assert.equal(slots[0].agentId, "agent-a");
  assert.equal(slots[2].displayName, "Reviewer");
  assert.equal(slots[1].displayName, "Spear", "an empty name falls back to the weapon label");
  assert.deepEqual(slots[0].responsibilities, []);
  assert.equal(slots[0].active, true);
});

test("T13 validation refuses anything other than exactly four slots", () => {
  assert.throws(() => validatePersonalAgentSlots(valid().slice(0, 3), ids()), /Exactly four/);
  assert.throws(() => validatePersonalAgentSlots([...valid(), { ...valid()[0], slot: 5 }], ids()), /Exactly four/);
  assert.throws(() => validatePersonalAgentSlots("not a list", ids()), /Exactly four/);
  assert.throws(() => validatePersonalAgentSlots(null, ids()), /Exactly four/);
});

test("T13 validation refuses duplicate slots and slot ids outside 1..4", () => {
  const duplicate = valid();
  duplicate[1] = { ...duplicate[1], slot: 1 };
  assert.throws(() => validatePersonalAgentSlots(duplicate, ids()), /once each/);
  assert.throws(() => validatePersonalAgentSlots(valid({ 2: { slot: 0 } }), ids()), /once each/);
  assert.throws(() => validatePersonalAgentSlots(valid({ 2: { slot: "2" } }), ids()), /once each/);
});

test("T13 validation keeps each weapon once: no duplicate, no extra weapon type", () => {
  const duplicate = valid();
  duplicate[3] = { ...duplicate[3], weapon: "gada" };
  assert.throws(() => validatePersonalAgentSlots(duplicate, ids()), /exactly once/);
  assert.throws(() => validatePersonalAgentSlots(valid({ 4: { weapon: "letter-a" } }), ids()), /exactly once/);
  assert.throws(() => validatePersonalAgentSlots(valid({ 4: { weapon: "openai" } }), ids()), /exactly once/);
});

test("T13 validation binds only to supplied user-facing Agent ids and never twice", () => {
  assert.throws(() => validatePersonalAgentSlots(valid({ 1: { agentId: "team-planner" } }), ids("agent-a")), /own Agents/);
  assert.throws(() => validatePersonalAgentSlots(valid({ 1: { agentId: "claude" } }), ids("agent-a")), /own Agents/);
  assert.throws(() => validatePersonalAgentSlots(valid({ 1: { agentId: "a".repeat(201) } }), ids("a".repeat(201))), /own Agents/);
  assert.throws(() => validatePersonalAgentSlots(valid({ 1: { agentId: 7 } }), ids("agent-a")), /own Agents/);
  assert.throws(
    () => validatePersonalAgentSlots(valid({ 1: { agentId: "agent-a" }, 2: { agentId: "agent-a" } }), ids("agent-a")),
    /only one slot/,
  );
  const slots = validatePersonalAgentSlots(valid({ 1: { agentId: "agent-a" } }), ids("agent-a"));
  assert.equal(slots.filter((slot) => slot.agentId !== null).length, 1);
});

test("T13 validation refuses unknown keys so authority-looking fields never enter presentation state", () => {
  for (const key of ["permissions", "provider", "model", "schedule", "missionId", "grant"]) {
    assert.throws(() => validatePersonalAgentSlots(valid({ 1: { [key]: "x" } }), ids()), /Unsupported Personal Agent field/);
  }
});

test("T13 validation enforces name, description and purpose lengths and rejects non-text", () => {
  assert.equal(validatePersonalAgentSlots(valid({ 1: { displayName: "x".repeat(40) } }), ids())[0].displayName.length, 40);
  assert.throws(() => validatePersonalAgentSlots(valid({ 1: { displayName: "x".repeat(41) } }), ids()), /longer than 40/);
  assert.throws(() => validatePersonalAgentSlots(valid({ 1: { description: "d".repeat(281) } }), ids()), /longer than 280/);
  assert.throws(() => validatePersonalAgentSlots(valid({ 1: { purpose: "p".repeat(281) } }), ids()), /longer than 280/);
  assert.throws(() => validatePersonalAgentSlots(valid({ 1: { displayName: 12 } }), ids()), /must be text/);
  assert.throws(() => validatePersonalAgentSlots(valid({ 1: { description: { text: "x" } } }), ids()), /must be text/);
});

test("T13 validation strips control characters and collapses whitespace so a name cannot break a layout", () => {
  const [slot] = validatePersonalAgentSlots(valid({ 1: { displayName: "A\u0000\u001b[31m\t\n   B\u007f" } }), ids());
  assert.equal(slot.displayName, "A [31m B");
  assert.doesNotMatch(slot.displayName, /[\p{Cc}]/u);
});

test("T13 validation also strips C1 controls and bidi overrides, so a name cannot spoof its own text", () => {
  const [slot] = validatePersonalAgentSlots(valid({ 1: { displayName: "Sword‮gnp.exe⁩ ‏X" } }), ids());
  assert.equal(slot.displayName, "Sword gnp.exe X");
  assert.doesNotMatch(slot.displayName, /[-‪-‮⁦-⁩]/);
});

test("T13 validation strips the Arabic letter mark, a bidi control, from names and descriptions", () => {
  const [slot] = validatePersonalAgentSlots(valid({ 1: { displayName: "Gada؜(x)", description: "a؜b" } }), ids());
  assert.equal(slot.displayName, "Gada (x)");
  assert.equal(slot.description, "a b");
  assert.doesNotMatch(slot.displayName, /؜/);
});

test("T13 validation refuses unsupported styles, responsibilities and a non-boolean active flag", () => {
  assert.throws(() => validatePersonalAgentSlots(valid({ 1: { style: "shouty" } }), ids()), /interaction style/);
  assert.throws(() => validatePersonalAgentSlots(valid({ 1: { responsibilities: "research" } }), ids()), /responsibilities/);
  assert.throws(() => validatePersonalAgentSlots(valid({ 1: { responsibilities: ["deploy"] } }), ids()), /responsibility/);
  assert.throws(
    () => validatePersonalAgentSlots(valid({ 1: { responsibilities: ["research", "coding", "testing", "files", "planning", "review", "writing", "research"] } }), ids()),
    /responsibilities/,
  );
  assert.throws(() => validatePersonalAgentSlots(valid({ 1: { active: "yes" } }), ids()), /true or false/);
  const [slot] = validatePersonalAgentSlots(valid({ 1: { responsibilities: ["research", "research", "review"], active: false } }), ids());
  assert.deepEqual(slot.responsibilities, ["research", "review"], "a repeated tag collapses to one");
  assert.equal(slot.active, false);
});

test("T13 validation refuses a slot that is not an object", () => {
  const input = valid();
  input[0] = "gada" as unknown as (typeof input)[number];
  assert.throws(() => validatePersonalAgentSlots(input, ids()), /must be an object/);
  input[0] = [] as unknown as (typeof input)[number];
  assert.throws(() => validatePersonalAgentSlots(input, ids()), /must be an object/);
});

// ---------------------------------------------------------------------------------------------------------------
// Persistence fallback
// ---------------------------------------------------------------------------------------------------------------

test("T13 persisted config: absent or malformed rows fall back to defaults and never invent a binding", () => {
  const defaults = defaultPersonalAgentsConfig(0);
  assert.deepEqual(parsePersonalAgentsConfig(null), defaults);
  assert.deepEqual(parsePersonalAgentsConfig(undefined), defaults);
  assert.deepEqual(parsePersonalAgentsConfig(""), defaults);
  assert.deepEqual(parsePersonalAgentsConfig("{not json"), defaults);
  assert.deepEqual(parsePersonalAgentsConfig(JSON.stringify({ schema: "other", revision: 2, slots: [] })), defaults);
  assert.deepEqual(parsePersonalAgentsConfig(JSON.stringify({ schema: PERSONAL_AGENTS_SCHEMA, revision: -1, slots: [] })), defaults);
  assert.deepEqual(parsePersonalAgentsConfig(JSON.stringify({ schema: PERSONAL_AGENTS_SCHEMA, revision: 1.5, slots: [] })), defaults);
  // A row that names an unknown weapon is malformed as a whole: the defaults hold, no partial binding survives.
  const stored = configOf({ 1: "agent-a" });
  const bad = { ...stored, slots: stored.slots.map((slot) => (slot.slot === 2 ? { ...slot, weapon: "letter" } : slot)) };
  assert.deepEqual(parsePersonalAgentsConfig(JSON.stringify(bad)), defaults);
});

test("T13 persisted config round-trips its revision and bindings", () => {
  const stored = configOf({ 2: "agent-b" });
  const parsed = parsePersonalAgentsConfig(JSON.stringify(stored), 99);
  assert.equal(parsed.revision, 3);
  assert.equal(parsed.schema, PERSONAL_AGENTS_SCHEMA);
  assert.equal(parsed.slots.find((slot: PersonalAgentSlotConfig) => slot.slot === 2)?.agentId, "agent-b");
  assert.equal(parsed.slots.find((slot: PersonalAgentSlotConfig) => slot.slot === 1)?.agentId, null);
});

test("T13 user-facing filter: team members are internal, a coordinator or single Agent is bindable", () => {
  assert.equal(isUserFacingAgent({ team: undefined }), true);
  assert.equal(isUserFacingAgent({ team: { role: "coordinator", coordinatorId: null, missionId: "m" } } as never), true);
  assert.equal(isUserFacingAgent({ team: { role: "planner", coordinatorId: "coord", missionId: "m" } } as never), false);
  assert.equal(isUserFacingAgent({ team: { role: "reviewer", coordinatorId: "coord", missionId: "m" } } as never), false);
});

// ---------------------------------------------------------------------------------------------------------------
// Derivation: canonical AgentState to presentation state
// ---------------------------------------------------------------------------------------------------------------

function stateOf(agentRow: AgentRow, missionView: MissionView | null = null, tasks: TaskFact[] = []) {
  const view = projectPersonalAgents({ config: configOf({ 1: agentRow.id }), agents: [agentRow], missions: missionView ? [missionView] : [], tasks, now: NOW });
  return view.slots[0].presentation;
}

test("T13 derivation: every AgentState maps to a presentation state", () => {
  const expected: Record<AgentState, PresentationState> = {
    CREATED: "IDLE",
    PLANNING: "PLANNING",
    RUNNING: "ACTIVE",
    WAITING_FOR_USER: "WAITING_FOR_USER",
    WAITING_FOR_DEPENDENCY: "WAITING",
    PAUSED: "PAUSED",
    VERIFYING: "VERIFYING",
    COMPLETED: "COMPLETED",
    FAILED: "FAILED",
    STOPPED: "STOPPED",
    INTERRUPTED: "RECOVERING",
  };
  for (const [state, presentation] of Object.entries(expected)) {
    const result = stateOf(row({ id: "a", state: state as AgentState }));
    assert.equal(result.state, presentation, `${state} maps to ${presentation}`);
    // A RUNNING Agent carries the basis of the Host fact that named its work (checked below), not the bare state.
    if (state !== "RUNNING") assert.deepEqual(result.basis, { kind: "agent-state", agentState: state }, `${state} carries its basis`);
  }
});

test("T13 derivation: COMPLETED is VERIFIED only with verified steps and zero unverified steps", () => {
  const verified = stateOf(row({ id: "a", state: "COMPLETED", missionId: "m1" }), mission({ id: "m1", result: { summary: "", verifiedSteps: 2, unverifiedSteps: 0, artifactIds: [] } } as Partial<MissionView> & { id: string }));
  assert.equal(verified.state, "VERIFIED");
  assert.equal(verified.label, "Completed and verified");
  assert.deepEqual(verified.basis, { kind: "mission-result", verifiedSteps: 2, unverifiedSteps: 0 });

  const partly = stateOf(row({ id: "a", state: "COMPLETED", missionId: "m1" }), mission({ id: "m1", result: { summary: "", verifiedSteps: 2, unverifiedSteps: 1, artifactIds: [] } } as Partial<MissionView> & { id: string }));
  assert.equal(partly.state, "COMPLETED");
  assert.equal(partly.label, "Completed · 1 unverified");
});

test("T13 derivation: COMPLETED with unverified steps, zero verified steps, or no result never becomes VERIFIED", () => {
  const zeroVerified = stateOf(row({ id: "a", state: "COMPLETED", missionId: "m1" }), mission({ id: "m1", result: { summary: "", verifiedSteps: 0, unverifiedSteps: 3, artifactIds: [] } } as Partial<MissionView> & { id: string }));
  assert.equal(zeroVerified.state, "COMPLETED");
  const zeroZero = stateOf(row({ id: "a", state: "COMPLETED", missionId: "m1" }), mission({ id: "m1", result: { summary: "", verifiedSteps: 0, unverifiedSteps: 0, artifactIds: [] } } as Partial<MissionView> & { id: string }));
  assert.equal(zeroZero.state, "COMPLETED", "no verified step is never a verified claim");
  const noResult = stateOf(row({ id: "a", state: "COMPLETED", missionId: "m1" }), mission({ id: "m1", result: null }));
  assert.equal(noResult.state, "COMPLETED");
  assert.equal(noResult.label, "Completed");
  const noMission = stateOf(row({ id: "a", state: "COMPLETED" }));
  assert.equal(noMission.state, "COMPLETED");
  assert.deepEqual(noMission.basis, { kind: "agent-state", agentState: "COMPLETED" });
});

test("T13 derivation: a pending consent ask outranks a paused or waiting Agent, and a finished Agent stays finished", () => {
  const asked = { state: "NONE", pending: [{ id: "req-2" }] };
  assert.equal(stateOf(row({ id: "a", state: "PAUSED", authorization: asked })).state, "WAITING_FOR_USER");
  assert.equal(stateOf(row({ id: "a", state: "WAITING_FOR_DEPENDENCY", authorization: asked })).state, "WAITING_FOR_USER");
  assert.equal(stateOf(row({ id: "a", state: "COMPLETED", authorization: asked })).state, "COMPLETED");
});

test("T13 derivation: a pending consent ask makes a RUNNING Agent WAITING_FOR_USER and nothing is auto-granted", () => {
  const asked = row({ id: "a", state: "RUNNING", authorization: { state: "NONE", pending: [{ id: "req-1" }] } });
  const waiting = stateOf(asked);
  assert.equal(waiting.state, "WAITING_FOR_USER");
  assert.deepEqual(waiting.basis, { kind: "agent-state", agentState: "RUNNING" });
  const byState = stateOf(row({ id: "a", state: "RUNNING", authorization: { state: "WAITING_FOR_USER", pending: [] } }));
  assert.equal(byState.state, "WAITING_FOR_USER");
});

test("T13 derivation: an unknown state never invents a category", () => {
  const unknown = stateOf(row({ id: "a", state: "SOMETHING_NEW" as AgentState }));
  assert.equal(unknown.state, "UNKNOWN");
});

// ---------------------------------------------------------------------------------------------------------------
// RUNNING category: Host facts in precedence order
// ---------------------------------------------------------------------------------------------------------------

function runningWith(steps: MissionStep[], tasks: TaskFact[] = []) {
  const view = projectPersonalAgents({
    config: configOf({ 1: "a" }),
    agents: [row({ id: "a", state: "RUNNING", missionId: "m1" })],
    missions: [mission({ id: "m1", steps })],
    tasks,
    now: NOW,
  });
  return view.slots[0].presentation;
}

test("T13 RUNNING: a planned team kind names the work the Host planned", () => {
  const cases: [string, PresentationState][] = [
    ["plan", "PLANNING"],
    ["observe", "RESEARCHING"],
    ["generate_json", "CODING"],
    ["generate_html", "CODING"],
    ["generate_markdown", "FILE_WORK"],
    ["write_file", "FILE_WORK"],
    ["review", "VERIFYING"],
    ["verify_output", "VERIFYING"],
  ];
  for (const [kind, state] of cases) {
    const result = runningWith([teamStep("s1", kind, 5)]);
    assert.equal(result.state, state, `team kind ${kind}`);
    assert.deepEqual(result.basis, { kind: "team-step", teamKind: kind, role: "implementer", stepId: "s1" });
  }
});

test("T13 RUNNING: a step in verifying is VERIFYING, but that is a work state and never a verified claim", () => {
  const result = runningWith([step({ id: "s1", state: "verifying", startedAt: 5 })]);
  assert.equal(result.state, "VERIFYING");
  assert.equal(result.label, "Verifying");
  assert.deepEqual(result.basis, { kind: "step-state", stepState: "verifying", stepId: "s1" });
});

test("T13 RUNNING: Host-recorded capability actions map by read, write, or other", () => {
  const cap = (action: string) => capabilityStep("s", action);
  assert.equal(runningWith([cap("filesystem.read")]).state, "RESEARCHING");
  assert.equal(runningWith([cap("filesystem.list")]).state, "RESEARCHING");
  assert.equal(runningWith([cap("git.status")]).state, "RESEARCHING");
  assert.equal(runningWith([cap("browser.open")]).state, "RESEARCHING");
  assert.equal(runningWith([cap("filesystem.write")]).state, "FILE_WORK");
  assert.equal(runningWith([cap("filesystem.delete")]).state, "FILE_WORK");
  assert.equal(runningWith([cap("git.commit")]).state, "FILE_WORK");
  const other = runningWith([cap("http.fetch")]);
  assert.equal(other.state, "ACTIVE");
  assert.deepEqual(other.basis, { kind: "capability", action: "http.fetch", stepId: "s" });
});

test("T13 RUNNING: terminal.exec is classified from the command the Host will run", () => {
  const exec = (command: unknown) => capabilityStep("s", "terminal.exec", { command });
  const testing = runningWith([exec("npm test")]);
  assert.equal(testing.state, "TESTING");
  assert.deepEqual(testing.basis, { kind: "command", classified: "agent.testing", stepId: "s" });

  const building = runningWith([exec("npm run build")]);
  assert.equal(building.state, "ACTIVE", "building is not a category of its own: it stays neutral");
  assert.equal(building.label, "Building");
  assert.deepEqual(building.basis, { kind: "command", classified: "agent.building", stepId: "s" });

  const other = runningWith([exec("ls -la")]);
  assert.equal(other.state, "ACTIVE");
  assert.equal(other.label, "Running a command");
  assert.deepEqual(other.basis, { kind: "command", classified: "agent.command", stepId: "s" });

  // A terminal.exec without a string command has no command fact: it stays a neutral capability fact, never a guess.
  const missing = runningWith([exec(42)]);
  assert.equal(missing.state, "ACTIVE");
  assert.deepEqual(missing.basis, { kind: "capability", action: "terminal.exec", stepId: "s" });
});

test("T13 RUNNING: shell-free terminal arguments distinguish tests from neutral commands", () => {
  const exec = (command: string, args: unknown) => capabilityStep("s", "terminal.exec", { command, args });
  for (const [command, args] of [["node", ["--test", "t.test.mjs"]], ["npm", ["test"]], ["npx", ["vitest", "run"]]] as const) {
    const view = runningWith([exec(command, [...args])]);
    assert.equal(view.state, "TESTING", `${command} ${args.join(" ")}`);
    assert.deepEqual(view.basis, { kind: "command", classified: "agent.testing", stepId: "s" });
  }
  assert.equal(runningWith([exec("node", ["script.mjs"])]).state, "ACTIVE");
  assert.equal(runningWith([exec("node", { test: true })]).state, "ACTIVE", "invalid argv is not invented work");
  assert.equal(runningWith([exec("node", ["--test", 42])]).state, "ACTIVE", "invalid arguments cannot prove a test command");
});

function providerTask(id: string, eventType: string, at: number, state = "running"): TaskFact {
  return { id, state, provider: "claude", model: "model-x", latestEvent: { type: eventType, detail: "", at } } as unknown as TaskFact;
}

test("T13 RUNNING: a fresh provider-proven activity event names the kind of work", () => {
  const cases: [string, PresentationState][] = [
    ["agent.planning", "PLANNING"],
    ["agent.reading", "RESEARCHING"],
    ["agent.searching", "RESEARCHING"],
    ["agent.editing", "CODING"],
    ["agent.testing", "TESTING"],
    ["agent.verifying", "VERIFYING"],
  ];
  for (const [event, state] of cases) {
    const result = runningWith([step({ id: "s1", startedAt: 5, taskId: "t1" })], [providerTask("t1", event, NOW - 10_000)]);
    assert.equal(result.state, state, event);
    assert.deepEqual(result.basis, { kind: "provider-event", event, at: NOW - 10_000, taskId: "t1" });
  }
});

test("T13 RUNNING: a provider event exactly at the freshness bound counts; one millisecond older does not", () => {
  const at = NOW - PROVIDER_EVENT_FRESH_MS;
  assert.equal(runningWith([step({ id: "s1", startedAt: 5, taskId: "t1" })], [providerTask("t1", "agent.editing", at)]).state, "CODING");
  const stale = runningWith([step({ id: "s1", startedAt: 5, taskId: "t1" })], [providerTask("t1", "agent.editing", at - 1)]);
  assert.equal(stale.state, "ACTIVE");
  assert.deepEqual(stale.basis, { kind: "no-category", reason: "No Host or provider fact names the current kind of work." });
});

test("T13 RUNNING: a provider event stamped in the future is not proof of current work either", () => {
  const future = runningWith([step({ id: "s1", startedAt: 5, taskId: "t1" })], [providerTask("t1", "agent.editing", NOW + 1)]);
  assert.equal(future.state, "ACTIVE");
  assert.deepEqual(future.basis, { kind: "no-category", reason: "No Host or provider fact names the current kind of work." });
  assert.equal(runningWith([step({ id: "s1", startedAt: 5, taskId: "t1" })], [providerTask("t1", "agent.editing", NOW)]).state, "CODING", "an event stamped now is fresh");
});

test("T13 RUNNING: a provider event never counts on a task that is not running or verifying, or for an unmapped event", () => {
  const admitted = [step({ id: "s1", startedAt: 5, taskId: "t1" })];
  assert.equal(runningWith(admitted, [providerTask("t1", "agent.editing", NOW - 1, "completed")]).state, "ACTIVE");
  assert.equal(runningWith(admitted, [providerTask("t1", "agent.chat", NOW - 1)]).state, "ACTIVE");
  assert.equal(runningWith(admitted, [providerTask("t1", "agent.editing", NOW - 1, "verifying")]).state, "CODING");
  assert.equal(runningWith(admitted, []).state, "ACTIVE", "no task fact for the step means no provider claim");
});

test("T13 RUNNING: with no admitted step the Agent is ACTIVE with no category, not a guessed one", () => {
  const idle = runningWith([step({ id: "s1", state: "completed", startedAt: 5 })]);
  assert.equal(idle.state, "ACTIVE");
  assert.deepEqual(idle.basis, { kind: "no-category", reason: "No step is admitted right now." });
  assert.equal(runningWith([]).state, "ACTIVE");
});

test("T13 RUNNING: a Team Coordinator is shown by its newest admitted team step", () => {
  const result = runningWith([teamStep("old", "plan", 10), teamStep("new", "generate_json", 20)]);
  assert.equal(result.state, "CODING");
  assert.equal(result.basis.kind === "team-step" ? result.basis.stepId : null, "new");
});

test("T13 RUNNING: an unmapped team kind falls through to the neutral state", () => {
  assert.equal(runningWith([teamStep("s1", "mystery_kind", 5)]).state, "ACTIVE");
});

// ---------------------------------------------------------------------------------------------------------------
// Projection: slots, bindings, internal members, providers, attention, progress, bindable
// ---------------------------------------------------------------------------------------------------------------

test("T13 projection: an unassigned slot is UNASSIGNED and a binding to a missing Agent is UNKNOWN, never another Agent", () => {
  const view = projectPersonalAgents({
    config: configOf({ 2: "ghost" }),
    agents: [row({ id: "agent-a", state: "CREATED" })],
    missions: [],
    tasks: [],
    now: NOW,
  });
  assert.equal(view.slots[0].presentation.state, "UNASSIGNED");
  assert.deepEqual(view.slots[0].presentation.basis, { kind: "unassigned" });
  assert.equal(view.slots[1].agent, null);
  assert.equal(view.slots[1].presentation.state, "UNKNOWN");
  assert.deepEqual(view.slots[1].presentation.basis, { kind: "agent-missing" });
});

test("T13 projection: a binding that became an internal team member is UNKNOWN; team members never appear as slots or bindable", () => {
  const planner = row({ id: "member-planner", state: "RUNNING", team: { role: "planner", coordinatorId: "coord", missionId: "m1" } });
  const coordinator = row({ id: "coord", state: "RUNNING", missionId: "m1", team: { role: "coordinator", coordinatorId: null, missionId: "m1" } });
  const view = projectPersonalAgents({
    config: configOf({ 1: "member-planner", 2: "coord" }),
    agents: [planner, coordinator],
    missions: [mission({ id: "m1" })],
    tasks: [],
    now: NOW,
  });
  assert.equal(view.slots[0].presentation.state, "UNKNOWN", "a bound team member is never shown as an Agent");
  assert.equal(view.slots[0].agent, null);
  assert.equal(view.slots[1].agent?.id, "coord");
  assert.equal(view.slots[1].agent?.team, true);
  assert.deepEqual(view.bindable.map((item) => item.id), ["coord"]);
});

test("T13 projection: AI providers and internal members are never bindable and never drawn", () => {
  const view = projectPersonalAgents({
    config: defaultPersonalAgentsConfig(0),
    agents: [
      row({ id: "agent-a", state: "CREATED" }),
      row({ id: "member-researcher", state: "RUNNING", team: { role: "researcher", coordinatorId: "coord", missionId: "m1" } }),
      row({ id: "codex", name: "Codex", state: "RUNNING", team: { role: "reviewer", coordinatorId: "coord", missionId: "m1" } }),
    ],
    missions: [],
    tasks: [],
    now: NOW,
  });
  assert.deepEqual(view.bindable.map((item) => item.id), ["agent-a"]);
  assert.ok(view.slots.every((slot) => slot.agentId === null && slot.agent === null));
  assert.equal(view.unslottedAgents, 1, "internal members and provider rows do not count as the user's Agents");
});

test("T13 projection: bindable is newest first, user-facing only and bounded to 50", () => {
  const agents = Array.from({ length: 60 }, (_, index) => row({ id: `agent-${index}`, state: "CREATED", updatedAt: index }));
  agents.push(row({ id: "member", state: "RUNNING", updatedAt: 999, team: { role: "planner", coordinatorId: "c", missionId: "m" } }));
  const view = projectPersonalAgents({ config: defaultPersonalAgentsConfig(0), agents, missions: [], tasks: [], now: NOW });
  assert.equal(view.bindable.length, 50);
  assert.equal(view.bindable[0].id, "agent-59");
  assert.ok(!view.bindable.some((item) => item.id === "member"));
});

test("T13 projection: old confirmed bindings remain saveable when fifty newer Agents exist", () => {
  const agents = Array.from({ length: 60 }, (_, index) => row({ id: `recent-${index}`, state: "RUNNING", updatedAt: 100 + index }));
  const old = ["old-1", "old-2", "old-3", "old-4"].map((id) => row({ id, state: "COMPLETED", updatedAt: 1 }));
  const config = configOf({ 1: "old-1", 2: "old-2", 3: "old-3", 4: "old-4" });
  const view = projectPersonalAgents({ config, agents: [...agents, ...old], missions: [], tasks: [], now: NOW });
  assert.equal(view.bindable.length, 54, "only the four confirmed bindings extend the fifty recent entries");
  assert.equal(view.bindable[0].id, "recent-59", "newest-first order stays stable");
  const bindable = new Set(view.bindable.map((agent) => agent.id));
  for (const agent of old) assert.ok(bindable.has(agent.id), `${agent.id} remains bindable`);
  const edited = config.slots.map((slot) => ({ ...slot, displayName: "Updated name" }));
  assert.doesNotThrow(() => validatePersonalAgentSlots(edited, bindable), "unrelated presentation edits retain confirmed bindings");
});

test("T13 projection: unslottedAgents counts user-facing unfinished Agents that are in no slot", () => {
  const view = projectPersonalAgents({
    config: configOf({ 1: "bound" }),
    agents: [
      row({ id: "bound", state: "RUNNING" }),
      row({ id: "free-a", state: "CREATED" }),
      row({ id: "free-b", state: "PAUSED" }),
      row({ id: "done", state: "COMPLETED" }),
      row({ id: "failed", state: "FAILED" }),
      row({ id: "stopped", state: "STOPPED" }),
    ],
    missions: [],
    tasks: [],
    now: NOW,
  });
  assert.equal(view.unslottedAgents, 2);
});

test("T13 projection: attention counts consent asks and unresolved Mission requests, with real step counts and no percentage", () => {
  const agent = row({ id: "a", state: "RUNNING", missionId: "m1", authorization: { state: "NONE", pending: [{ id: "c1" }] } });
  const view = projectPersonalAgents({
    config: configOf({ 1: "a" }),
    agents: [agent],
    missions: [
      mission({
        id: "m1",
        requests: [{ id: "r1", resolution: null }, { id: "r2", resolution: "allow" }] as never,
        steps: [step({ id: "s1", state: "completed", startedAt: 1 }), step({ id: "s2", state: "running", startedAt: 2 })],
      }),
    ],
    tasks: [],
    now: NOW,
  });
  assert.equal(view.slots[0].attention.pendingApprovals, 2);
  assert.deepEqual(view.slots[0].progress, { completed: 1, total: 2, verified: 0 });
  assert.equal(view.slots[0].result, null);
  assert.equal(view.slots[0].technical, null, "no running task means no provider or model detail");
});

test("T13 projection: an Agentic envelope's pending permission requests are the mission's own asks and count once", () => {
  // The Host projection derives authorization.pending from the same permission_requests rows the Mission view
  // exposes; counting both lists verbatim reported every ask twice on a slot with a single 'Needs you'.
  const agent = row({ id: "a", state: "RUNNING", missionId: "m1", authorization: { state: "ACTIVE", pending: [{ id: "r1" }, { id: "r2" }] } });
  const view = projectPersonalAgents({
    config: configOf({ 1: "a" }),
    agents: [agent],
    missions: [
      mission({
        id: "m1",
        requests: [
          { id: "r1", resolution: null },
          { id: "r2", resolution: null },
          { id: "r3", resolution: null },
        ] as never,
      }),
    ],
    tasks: [],
    now: NOW,
  });
  assert.equal(view.slots[0].attention.pendingApprovals, 3, "r1/r2 come only from the envelope, r3 only from the mission list");
});

test("T13 projection: technical detail names the running task's provider and model; the Agent's own name stays its identity", () => {
  const view = projectPersonalAgents({
    config: configOf({ 1: "a" }),
    agents: [row({ id: "a", state: "RUNNING", missionId: "m1" })],
    missions: [mission({ id: "m1", steps: [step({ id: "s1", startedAt: 5, taskId: "t1" })] })],
    tasks: [providerTask("t1", "agent.editing", NOW)],
    now: NOW,
  });
  assert.deepEqual(view.slots[0].technical, { provider: "claude", model: "model-x", taskId: "t1" });
  assert.equal(view.slots[0].agent?.name, "A");
});

test("T13 projection: a Host verification count is a real count, with no percentage field", () => {
  const view = projectPersonalAgents({
    config: configOf({ 1: "a" }),
    agents: [row({ id: "a", state: "COMPLETED", missionId: "m1" })],
    missions: [
      mission({
        id: "m1",
        result: { summary: "", verifiedSteps: 2, unverifiedSteps: 0, artifactIds: [] },
        steps: [
          step({ id: "s1", state: "completed", startedAt: 1, result: { verified: true } as never }),
          step({ id: "s2", state: "completed", startedAt: 2, result: { verified: true } as never }),
        ],
      } as Partial<MissionView> & { id: string }),
    ],
    tasks: [],
    now: NOW,
  });
  assert.deepEqual(view.slots[0].progress, { completed: 2, total: 2, verified: 2 });
  assert.equal(view.slots[0].presentation.state, "VERIFIED");
  assert.doesNotMatch(JSON.stringify(view), /percent/i);
});

test("T13 projection: the snapshot carries the revision and schema of the config it projected", () => {
  const view = projectPersonalAgents({ config: configOf(), agents: [], missions: [], tasks: [], now: NOW });
  assert.equal(view.revision, 3);
  assert.equal(view.schema, PERSONAL_AGENTS_SCHEMA);
  assert.equal(view.slots.length, 4);
});
