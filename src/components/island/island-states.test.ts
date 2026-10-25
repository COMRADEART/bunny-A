import test from "node:test";
import assert from "node:assert/strict";
import {
  ISLAND_STATES,
  islandPresence,
  type IslandFacts,
  type IslandState,
} from "./journey-model.ts";

const base = (over: Partial<IslandFacts> = {}): IslandFacts => ({
  live: true,
  disconnectTitle: "Offline",
  voiceListening: false,
  pendingApprovals: 0,
  workingAgents: 0,
  planningAgents: 0,
  events: [],
  agentName: null,
  taskName: null,
  taskState: "idle",
  elapsed: null,
  ...over,
});

/** One fact set per Island state, each derived from authoritative runtime facts. */
const STATE_FACTS: Record<IslandState, Partial<IslandFacts>> = {
  idle: {},
  listening: { voiceListening: true },
  processing: { voicePhase: "processing" },
  speaking: { voicePhase: "speaking" },
  interrupted: { voicePhase: "interrupted" },
  thinking: { taskState: "routing" },
  planning: { planningAgents: 1 },
  working: { workingAgents: 1, taskName: "Edit notes" },
  multi: { workingAgents: 2 },
  handoff: {
    workingAgents: 1,
    events: [{ type: "mission.team.handoff", at: 5, sequence: 5, detail: "Spear to Sword" }],
  },
  approval: { pendingApprovals: 1, taskState: "approval" },
  streaming: {
    taskState: "running",
    events: [{ type: "agent.output", at: 9, sequence: 9, detail: "partial" }],
  },
  completed: { taskState: "completed", taskName: "Build site" },
  failed: { taskState: "failed", taskName: "Build site" },
  error: { voicePhase: "error" },
  offline: { live: false, disconnectTitle: "Reconnecting", workingAgents: 2, taskState: "running" },
};

test("T2 island matrix: every notch state derives from runtime facts", () => {
  assert.equal(ISLAND_STATES.length, 16);
  for (const state of ISLAND_STATES) {
    const presence = islandPresence(base(STATE_FACTS[state]));
    assert.equal(presence.state, state, `${state} is reachable from Host facts`);
    assert.ok(presence.title.length > 0, `${state} has a text title, never color or motion alone`);
    assert.match(presence.detail, /Status: /, `${state} detail names its status in words`);
  }
});

test("T13 island matrix: no state fabricates a percentage, an ETA, or a local-only claim", () => {
  for (const state of ISLAND_STATES) {
    const presence = islandPresence(
      base({ ...STATE_FACTS[state], agentName: "Gada", taskName: "Ship", elapsed: "00:41" }),
    );
    assert.equal(presence.detail.includes("%"), false, `${state} shows no invented percentage`);
    assert.equal(/ETA|remaining|estimated/i.test(presence.detail), false, `${state} shows no estimated time`);
    assert.equal(/local-only|stayed local|remained local/i.test(presence.detail), false, `${state} makes no local-only claim`);
  }
});
