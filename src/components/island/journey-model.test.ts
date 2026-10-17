import test from "node:test";
import assert from "node:assert/strict";
import {
  islandPresence,
  newestIslandEvent,
  onboardingRecord,
  ONBOARDING_STEPS,
  pairingCodeFromLocation,
  providerSetupLine,
  type IslandFacts,
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

test("T13 island: idle is the absence of live work", () => {
  const presence = islandPresence(base());
  assert.equal(presence.state, "idle");
  assert.match(presence.detail, /Status: Idle/);
  assert.equal(presence.detail.includes("%"), false);
});

test("T13 island: a non-live view is offline and does not describe leftover work as current", () => {
  const presence = islandPresence(base({ live: false, disconnectTitle: "Reconnecting", workingAgents: 2, taskState: "running", taskName: "Write notes" }));
  assert.equal(presence.state, "offline");
  assert.equal(presence.title, "Reconnecting");
  assert.match(presence.detail, /Status: Reconnecting/);
});

test("T13 island: an approval outranks listening, work, and a completed task", () => {
  const presence = islandPresence(
    base({
      pendingApprovals: 2,
      voiceListening: true,
      workingAgents: 3,
      taskState: "completed",
      taskName: "Ship",
      agentName: "Gada",
    }),
  );
  assert.equal(presence.state, "approval");
  assert.match(presence.detail, /2 approvals waiting/);
  assert.match(presence.detail, /Gada/);
});

test("T13 island: listening, planning, several agents, handoff, streaming, and failure follow Host facts", () => {
  assert.equal(islandPresence(base({ voiceListening: true })).state, "listening");
  assert.equal(islandPresence(base({ planningAgents: 1, agentName: "Chakra", elapsed: "00:12" })).state, "planning");
  assert.match(islandPresence(base({ planningAgents: 1, elapsed: "00:12" })).detail, /00:12/);
  assert.equal(islandPresence(base({ workingAgents: 2 })).state, "multi");
  assert.equal(
    islandPresence(base({ events: [{ type: "mission.team.handoff", at: 5, sequence: 5, detail: "Spear to Sword" }] })).state,
    "handoff",
  );
  assert.equal(
    islandPresence(base({ taskState: "running", events: [{ type: "agent.output", at: 9, sequence: 9, detail: "partial" }] })).state,
    "streaming",
  );
  assert.equal(islandPresence(base({ events: [{ type: "agent.thinking", at: 3, sequence: 3, detail: "" }] })).state, "thinking");
  assert.equal(islandPresence(base({ taskState: "routing", taskName: "Ask" })).state, "thinking");
  assert.equal(islandPresence(base({ workingAgents: 1, taskName: "Edit" })).state, "working");
  assert.equal(islandPresence(base({ taskState: "failed", taskName: "Build" })).state, "failed");
  assert.equal(islandPresence(base({ taskState: "completed" })).state, "completed");
});

test("T13 island: output is not streaming once the task has stopped", () => {
  const presence = islandPresence(
    base({ taskState: "completed", events: [{ type: "agent.output", at: 1, sequence: 1, detail: "done" }] }),
  );
  assert.equal(presence.state, "completed");
});

test("T13 island: the newest event is the highest sequence", () => {
  const newest = newestIslandEvent([
    { type: "agent.output", at: 50, sequence: 1, detail: "old" },
    { type: "mission.team.handoff", at: 10, sequence: 4, detail: "later" },
  ]);
  assert.equal(newest?.type, "mission.team.handoff");
  assert.equal(newestIslandEvent([]), null);
});

test("T13 onboarding: unknown storage starts at the welcome step and a saved step resumes", () => {
  assert.deepEqual(onboardingRecord(null), { status: "active", step: 0 });
  assert.deepEqual(onboardingRecord({ status: "skipped", step: 3 }), { status: "skipped", step: 3 });
  assert.equal(onboardingRecord({ status: "nope", step: 99 }).step, ONBOARDING_STEPS.length - 1);
  assert.equal(ONBOARDING_STEPS[0].id, "welcome");
  assert.equal(ONBOARDING_STEPS.at(-1)?.id, "phone");
});

test("T13 providers: the setup line names discovered providers and refuses an invented one", () => {
  assert.match(providerSetupLine([]), /No providers discovered/);
  assert.equal(providerSetupLine([{ name: "Ollama", availability: "Ready" }]), "Ollama: Ready");
});

test("T13 pairing: only a one-time code shape is accepted, and the fragment wins over the query", () => {
  assert.equal(pairingCodeFromLocation("?pair=querycode1", "#pair=hashcode12"), "hashcode12");
  assert.equal(pairingCodeFromLocation("?pair=short", ""), null);
  assert.equal(pairingCodeFromLocation("?pair=has space", ""), null);
  assert.equal(pairingCodeFromLocation("", ""), null);
});
