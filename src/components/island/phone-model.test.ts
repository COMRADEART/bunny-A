import test from "node:test";
import assert from "node:assert/strict";
import {
  agentActionAvailability,
  agentRoute,
  approvalCaption,
  boundSlots,
  canSend,
  missionRoute,
  missionRows,
  normalizeSteps,
  otherAgentRows,
  parentRoute,
  phoneCapabilities,
  phoneStatus,
  requestTargetId,
  recentTaskRows,
  routeFromSearch,
  routeTab,
  sessionLine,
  stepProgressText,
  stepSegments,
  statusCopy,
  tabFromParam,
  technicalLine,
  verifiedArtifactRows,
  voiceEntry,
  animatesFor,
  HOME_ROUTE,
  PHONE_TABS,
  AGENT_ACTION_STATES,
} from "./phone-model.ts";
import type { SnapshotViewer } from "../../lib/bunny-host/contracts.ts";
import type { AgentSnapshot, AgentState } from "../../lib/bunny-host/agent-types.ts";
import type { PersonalAgentView } from "../../lib/bunny-host/personal-agents.ts";
import type { MissionView } from "../../lib/bunny-missions/types.ts";
import type { OrchTask } from "../../lib/orch/types.ts";

const workstation: SnapshotViewer = { kind: "workstation" };
const FULL_RIGHTS = ["agent.get", "agent.pause", "agent.resume", "agent.stop", "mission.respond", "submit", "device.revoke"];
const device = (rights: string[]): SnapshotViewer => ({
  kind: "device",
  deviceId: "d1",
  name: "Pixel companion",
  role: "paired-device",
  pairedAt: 0,
  expiresAt: 1,
  lastSeenAt: null,
  rights,
});
const fullDevice = device(FULL_RIGHTS);
const format = (at: number) => `T${at}`;

// ---------------------------------------------------------------------------------------------------------------
// Tab and detail routing
// ---------------------------------------------------------------------------------------------------------------

test("the bottom bar offers exactly the five phone tabs in thumb-reach order", () => {
  assert.deepEqual([...PHONE_TABS], ["home", "chat", "agents", "missions", "settings"]);
});

test("unknown or missing tab names fall back to Home", () => {
  assert.equal(tabFromParam("missions"), "missions");
  assert.equal(tabFromParam("projects"), "home");
  assert.equal(tabFromParam("<script>"), "home");
  assert.equal(tabFromParam(null), "home");
  assert.equal(tabFromParam(undefined), "home");
});

test("the query string picks the starting route: tab, Agent detail, Mission detail or Projects", () => {
  assert.deepEqual(routeFromSearch("?companion=1"), { kind: "tab", tab: "home" });
  assert.deepEqual(routeFromSearch("?companion=1&tab=agents"), { kind: "tab", tab: "agents" });
  assert.deepEqual(routeFromSearch("?slot=3"), { kind: "agent", slot: 3, from: "home" });
  assert.deepEqual(routeFromSearch("?slot=9"), { kind: "tab", tab: "home" });
  assert.deepEqual(routeFromSearch("?mission=m-1"), { kind: "mission", missionId: "m-1", from: "missions" });
  assert.deepEqual(routeFromSearch(`?mission=${"x".repeat(201)}`), { kind: "tab", tab: "home" });
  assert.deepEqual(routeFromSearch("?view=projects"), { kind: "projects", from: "home" });
});

test("a detail keeps its origin tab highlighted and Back returns there; a tab returns Home", () => {
  const agent = agentRoute(2, "agents");
  assert.equal(routeTab(agent), "agents");
  assert.deepEqual(parentRoute(agent), { kind: "tab", tab: "agents" });
  assert.equal(routeTab(missionRoute("m", "missions")), "missions");
  assert.deepEqual(parentRoute(missionRoute("m", "missions")), { kind: "tab", tab: "missions" });
  assert.equal(routeTab({ kind: "tab", tab: "chat" }), "chat");
  assert.deepEqual(parentRoute({ kind: "tab", tab: "chat" }), HOME_ROUTE);
});

// ---------------------------------------------------------------------------------------------------------------
// Capabilities: workstation versus paired device.
// ---------------------------------------------------------------------------------------------------------------

test("the workstation may use voice, the Studio, chat, supervision and answers", () => {
  assert.deepEqual(phoneCapabilities(workstation), {
    workstation: true, device: false, voice: true, studio: true, chat: true, supervise: true, missionStop: true, answer: true, approve: true, delegate: true, signOut: false,
  });
});

test("a paired device never gets voice or Studio writes, even with every right", () => {
  const caps = phoneCapabilities(fullDevice);
  assert.equal(caps.device, true);
  assert.equal(caps.voice, false);
  assert.equal(caps.studio, false);
  assert.equal(caps.signOut, true);
  assert.equal(caps.chat, true);
  assert.equal(caps.supervise, true);
  assert.equal(caps.answer, true);
});

test("a device only gets each capability its Host rights name", () => {
  assert.equal(phoneCapabilities(device(["agent.get"])).chat, false);
  assert.equal(phoneCapabilities(device(["agent.get"])).supervise, false);
  assert.equal(phoneCapabilities(device(["agent.get"])).answer, false);
  assert.equal(phoneCapabilities(device(["submit"])).chat, true);
  // Supervision needs all three rights; one alone is not enough to pause, resume and stop.
  assert.equal(phoneCapabilities(device(["agent.pause", "agent.stop"])).supervise, false);
  assert.equal(phoneCapabilities(device(["agent.pause", "agent.resume", "agent.stop"])).supervise, true);
  assert.equal(phoneCapabilities(device(["mission.respond"])).answer, true);
  assert.equal(phoneCapabilities(device(["submit"])).signOut, false);
  assert.equal(phoneCapabilities(device(["mission.respond"])).approve, false);
  assert.equal(phoneCapabilities(device(["mission.approve"])).approve, true);
});

test("each Agent control needs the exact Host right it names, not the whole supervise set", () => {
  const pauseOnly = device(["agent.get", "agent.pause"]);
  assert.equal(act({ action: "pause", viewer: pauseOnly }).visible, true);
  assert.equal(act({ action: "stop", viewer: pauseOnly }).visible, false);
  assert.equal(act({ action: "resume", state: "PAUSED", viewer: pauseOnly }).visible, false);
  const stopOnly = device(["agent.stop"]);
  assert.equal(act({ action: "stop", viewer: stopOnly }).visible, true);
  assert.equal(act({ action: "pause", viewer: stopOnly }).visible, false);
});

test("Stop Mission follows mission.stop and delegation follows agent.authorization.approve, never each other", () => {
  assert.equal(phoneCapabilities(device(["mission.respond"])).missionStop, false);
  assert.equal(phoneCapabilities(device(["mission.stop"])).missionStop, true);
  assert.equal(phoneCapabilities(device(["mission.respond"])).delegate, false);
  assert.equal(phoneCapabilities(device(["agent.authorization.approve"])).delegate, true);
  assert.equal(phoneCapabilities(device(["agent.authorization.approve"])).answer, false);
});

test("the workstation holds every Host right here, but never signs itself out from the phone", () => {
  const caps = phoneCapabilities(workstation);
  assert.equal(caps.missionStop, true);
  assert.equal(caps.delegate, true);
  assert.equal(caps.signOut, false);
});

test("an ask is keyed to the Agent whose Mission or authorization owns it, else to its Mission, else to itself", () => {
  const agents = [
    { id: "agent-1", missionId: "m-1", authorization: null },
    { id: "agent-2", missionId: "m-2", authorization: { pending: [{ id: "offer-9" }] } },
  ];
  const missions = [
    { id: "m-1", requests: [{ id: "req-1" }] },
    { id: "m-3", requests: [{ id: "req-3" }] },
  ];
  assert.equal(requestTargetId("req-1", agents, missions), "agent-1");
  assert.equal(requestTargetId("offer-9", agents, missions), "agent-2");
  assert.equal(requestTargetId("req-3", agents, missions), "m-3");
  assert.equal(requestTargetId("unknown", agents, missions), "unknown");
});

test("an unknown viewer is default-deny: nothing is offered", () => {
  assert.deepEqual(phoneCapabilities(null), {
    workstation: false, device: false, voice: false, studio: false, chat: false, supervise: false, missionStop: false, answer: false, approve: false, delegate: false, signOut: false,
  });
  assert.equal(phoneCapabilities(undefined).voice, false);
});

test("voice shows a microphone only for the workstation and names the PC for devices", () => {
  assert.deepEqual(voiceEntry(workstation), { available: true, caption: "Talk to Bunny" });
  assert.deepEqual(voiceEntry(fullDevice), { available: false, caption: "Voice is available on your PC" });
  assert.deepEqual(voiceEntry(null), { available: false, caption: "Voice is available on your PC" });
});

test("the session line names the workstation or the paired device", () => {
  assert.equal(sessionLine(workstation), "This workstation");
  assert.equal(sessionLine(fullDevice), "Paired device · Pixel companion");
  assert.equal(sessionLine(null), "Checking this device");
});

// ---------------------------------------------------------------------------------------------------------------
// Connection status: offline, stale, pairing and host-changed.
// ---------------------------------------------------------------------------------------------------------------

const conn = (state: "live" | "polling" | "reconnecting" | "offline" | "connecting" | "pairing" | "host-changed", snapshotAt: number | null) => ({
  state,
  snapshotAt,
});

test("only a fresh snapshot on a working connection is live, and only live animates", () => {
  assert.equal(phoneStatus(conn("live", 1000), 1500), "live");
  assert.equal(phoneStatus(conn("polling", 1000), 1500), "live");
  assert.equal(animatesFor("live"), true);
  assert.equal(animatesFor("stale"), false);
  assert.equal(animatesFor("offline"), false);
});

test("a live connection whose snapshot aged out is stale, not live", () => {
  assert.equal(phoneStatus(conn("live", 1000), 1000 + 20_001), "stale");
  assert.equal(phoneStatus(conn("reconnecting", 1000), 1200), "stale");
});

test("offline with a retained view is offline with the last known state, never live", () => {
  assert.equal(phoneStatus(conn("offline", 1000), 1200), "offline");
  const copy = statusCopy("offline", { snapshotAt: 1000, pairingCode: null, format });
  assert.equal(copy.tone, "danger");
  assert.equal(copy.title, "Bunny-A Host is unreachable");
  assert.equal(copy.detail, "Showing last known state from T1000. Controls are paused.");
});

test("offline with nothing retained says so without inventing a time", () => {
  assert.equal(phoneStatus(conn("offline", null), 1200), "offline");
  assert.equal(phoneStatus(conn("connecting", null), 1200), "connecting");
  const copy = statusCopy("offline", { snapshotAt: null, pairingCode: null, format });
  assert.equal(copy.detail, "Controls are paused until the Host answers.");
});

test("stale copy names the last confirmed time and says animations are stopped", () => {
  assert.equal(phoneStatus(conn("live", 1000), 99_000), "stale");
  const copy = statusCopy("stale", { snapshotAt: 1000, pairingCode: null, format });
  assert.equal(copy.title, "Showing last known state from T1000");
  assert.equal(copy.detail, "Animations are stopped. Updates resume when the Host answers.");
});

test("pairing and a changed Host are their own states and never look live", () => {
  assert.equal(phoneStatus(conn("pairing", 1000), 1100), "pairing");
  assert.equal(phoneStatus(conn("host-changed", 1000), 1100), "host-changed");
  const pairing = statusCopy("pairing", { snapshotAt: 1000, pairingCode: "DEVICE_REVOKED", format });
  assert.equal(pairing.title, "Pairing required");
  assert.equal(pairing.detail, "This device's access was revoked on the workstation.");
  assert.equal(statusCopy("host-changed", { snapshotAt: 1000, pairingCode: null, format }).tone, "danger");
  assert.equal(statusCopy("live", { snapshotAt: 1000, pairingCode: null, format }).detail, null);
});

// ---------------------------------------------------------------------------------------------------------------
// Agent action availability per device rights and Agent state.
// ---------------------------------------------------------------------------------------------------------------

const act = (input: Partial<Parameters<typeof agentActionAvailability>[0]> & { action: "pause" | "resume" | "stop" }) =>
  agentActionAvailability({
    state: "RUNNING",
    viewer: fullDevice,
    targetId: "agent-1",
    canAct: true,
    pending: {},
    uncertain: [],
    ...input,
  });

test("a device holding all three supervise rights sees pause and stop on a running Agent", () => {
  assert.deepEqual(act({ action: "pause" }), { visible: true, enabled: true, caption: null });
  assert.deepEqual(act({ action: "stop" }), { visible: true, enabled: true, caption: null });
  assert.equal(act({ action: "resume" }).visible, false);
});

test("a device without supervise rights sees no pause, resume or stop at all", () => {
  const readOnly = device(["agent.get", "submit"]);
  assert.equal(act({ action: "pause", viewer: readOnly }).visible, false);
  assert.equal(act({ action: "stop", viewer: readOnly }).visible, false);
  assert.equal(act({ action: "resume", state: "PAUSED", viewer: readOnly }).visible, false);
});

test("resume is offered only for a paused Agent, matching the Host transition table", () => {
  assert.deepEqual(act({ action: "resume", state: "PAUSED" }), { visible: true, enabled: true, caption: null });
  assert.equal(act({ action: "resume", state: "RUNNING" }).visible, false);
  assert.equal(act({ action: "pause", state: "PAUSED" }).visible, false);
});

test("terminal and unknown Agents offer no controls", () => {
  for (const state of ["COMPLETED", "FAILED", "STOPPED"] as AgentState[]) {
    assert.equal(act({ action: "stop", state }).visible, false, state);
    assert.equal(act({ action: "pause", state }).visible, false, state);
  }
  assert.equal(act({ action: "stop", state: null }).visible, false);
});

test("controls are disabled with a caption while offline, while waiting for the Host, or while unconfirmed", () => {
  const offline = act({ action: "pause", canAct: false });
  assert.equal(offline.visible, true);
  assert.equal(offline.enabled, false);
  assert.equal(offline.caption, "Reconnect to the Host to use controls.");
  const waiting = act({ action: "pause", pending: { "agent-1": "agent.pause" } });
  assert.equal(waiting.enabled, false);
  assert.equal(waiting.caption, "Waiting for the Host…");
  const unknown = act({ action: "stop", uncertain: [{ targetId: "agent-1" }] });
  assert.equal(unknown.enabled, false);
  assert.equal(unknown.caption, "Outcome unknown — checking the Host…");
  // A pending command on a different Agent does not block this one.
  assert.equal(act({ action: "pause", pending: { "agent-2": "agent.pause" } }).enabled, true);
});

test("the stop control's Host states exclude finished Agents", () => {
  assert.equal(AGENT_ACTION_STATES.stop.includes("COMPLETED"), false);
  assert.equal(AGENT_ACTION_STATES.stop.includes("PAUSED"), true);
});

test("an approval the device may not give shows the Host's own reason", () => {
  assert.equal(approvalCaption({ allowed: false, caption: "Approval required on Windows Host." }), "Approval required on Windows Host.");
  assert.equal(approvalCaption({ allowed: true, caption: null }), null);
});

// ---------------------------------------------------------------------------------------------------------------
// Progress: real step counts, never a percentage.
// ---------------------------------------------------------------------------------------------------------------

test("progress reads as real step counts with the verified count", () => {
  assert.equal(stepProgressText({ completed: 3, total: 7, verified: 2 }), "3 of 7 steps · 2 verified");
  assert.equal(stepProgressText({ completed: 0, total: 4, verified: 0 }), "0 of 4 steps · 0 verified");
  assert.equal(stepProgressText({ completed: 1, total: 1, verified: 1 }), "1 of 1 step · 1 verified");
});

test("progress without steps says there are none, not zero of zero percent", () => {
  assert.equal(stepProgressText(null), "No steps yet");
  assert.equal(stepProgressText(undefined), "No steps yet");
  assert.equal(stepProgressText({ completed: 0, total: 0, verified: 0 }), "No steps yet");
});

test("progress text never contains a percentage sign for any count the Host can report", () => {
  for (let total = 0; total <= 12; total++)
    for (let completed = 0; completed <= total; completed++)
      for (let verified = 0; verified <= completed; verified++)
        assert.equal(stepProgressText({ completed, total, verified }).includes("%"), false);
});

test("impossible counts are clamped so the sentence and the bar agree", () => {
  assert.deepEqual(normalizeSteps({ completed: 9, total: 4, verified: 9 }), { total: 4, completed: 4, verified: 4 });
  assert.deepEqual(normalizeSteps({ completed: -2, total: 3.9, verified: 1 }), { total: 3, completed: 0, verified: 0 });
  assert.deepEqual(normalizeSteps({ completed: Number.NaN, total: 2, verified: 1 }), { total: 2, completed: 0, verified: 0 });
  assert.equal(stepProgressText({ completed: 9, total: 4, verified: 9 }), "4 of 4 steps · 4 verified");
});

test("segments always sum to the step total", () => {
  const cases = [
    { completed: 3, total: 7, verified: 2 },
    { completed: 0, total: 5, verified: 0 },
    { completed: 5, total: 5, verified: 5 },
    { completed: 9, total: 4, verified: 9 },
  ];
  for (const progress of cases) {
    const seg = stepSegments(progress);
    assert.equal(seg.verified + seg.done + seg.pending, normalizeSteps(progress).total);
    assert.ok(seg.done >= 0 && seg.pending >= 0 && seg.verified >= 0);
  }
  assert.deepEqual(stepSegments({ completed: 3, total: 7, verified: 2 }), { verified: 2, done: 1, pending: 4 });
});

// ---------------------------------------------------------------------------------------------------------------
// Agents list: the four slots are bound characters, the rest are neutral rows.
// ---------------------------------------------------------------------------------------------------------------

const view = (slot: number, agentId: string | null, active = true): PersonalAgentView =>
  ({ slot, weapon: "gada", displayName: "Gada", agentId, active }) as unknown as PersonalAgentView;

test("only bound, active slots are drawn; unassigned slots are counted, not drawn", () => {
  const slots = [view(1, "a1"), view(2, null), view(3, "a3", false), view(4, "a4")];
  const bound = boundSlots(slots);
  assert.deepEqual(bound.drawn.map((slot) => slot.slot), [1, 4]);
  assert.equal(bound.unassigned, 1);
  // Attention follows the Agent, not the drawn character: a turned-off bound slot still counts its asks.
  assert.deepEqual(bound.attentionSlots.map((slot) => slot.slot), [1, 3, 4]);
});

test("other Agents are listed neutrally, without internal team members", () => {
  const agents = {
    cursor: 0,
    agents: [
      { id: "a1", name: "Gada one", state: "RUNNING", updatedAt: 5, team: undefined },
      { id: "t1", name: "Planner", state: "RUNNING", updatedAt: 9, team: { role: "planner", coordinatorId: "c1", missionId: "m" } },
      { id: "c1", name: "Coordinator", state: "PAUSED", updatedAt: 7, team: { role: "coordinator", coordinatorId: null, missionId: "m" } },
      { id: "a2", name: "Quiet", state: "COMPLETED", updatedAt: 1, team: undefined },
    ],
  } as unknown as AgentSnapshot;
  const rows = otherAgentRows(agents, new Set(["a1"]));
  assert.deepEqual(rows.map((row) => row.id), ["c1", "a2"]);
  assert.equal(rows[0].stateLabel, "Paused");
  assert.equal(otherAgentRows(null, new Set()).length, 0);
});

test("the model line is small technical text, and absent when nothing runs", () => {
  assert.equal(technicalLine(null), null);
  assert.equal(technicalLine({ provider: "ollama", model: "qwen", taskId: "t" }), "ollama · qwen");
  assert.equal(technicalLine({ provider: null, model: null, taskId: null }), "Unknown provider");
});

// ---------------------------------------------------------------------------------------------------------------
// Missions, artifacts and chat.
// ---------------------------------------------------------------------------------------------------------------

const mission = (id: string, state: MissionView["state"], updatedAt: number, extra: Partial<MissionView> = {}): MissionView =>
  ({
    id,
    title: `Mission ${id}`,
    state,
    updatedAt,
    progress: { kind: "steps", completed: 1, total: 3, failed: 0, running: 0 },
    steps: [],
    artifacts: [],
    requests: [],
    ...extra,
  }) as unknown as MissionView;

test("missions needing you come first, then live ones, then the rest, newest first within a group", () => {
  const rows = missionRows([
    mission("done", "completed", 50),
    mission("run", "running", 10),
    mission("ask", "waiting_for_approval", 5),
    mission("run2", "running", 20),
  ]);
  assert.deepEqual(rows.map((row) => row.id), ["ask", "run2", "run", "done"]);
  assert.equal(rows[0].label, "Needs approval");
  assert.equal(rows[3].live, false);
});

test("mission progress counts verified steps and never shows a percentage", () => {
  const rows = missionRows([
    mission("m", "running", 1, {
      progress: { kind: "steps", completed: 2, total: 3, failed: 0, running: 1 },
      steps: [
        { state: "completed", result: { verified: true } },
        { state: "completed", result: { verified: false } },
        { state: "running", result: null },
      ] as MissionView["steps"],
    }),
  ]);
  assert.equal(rows[0].progress, "2 of 3 steps · 1 verified");
});

test("open approvals are counted from unresolved requests only", () => {
  const rows = missionRows([
    mission("m", "waiting_for_approval", 1, {
      requests: [
        { id: "r1", resolvedAt: null },
        { id: "r2", resolvedAt: 4 },
      ] as MissionView["requests"],
    }),
  ]);
  assert.equal(rows[0].openRequests, 1);
});

test("only verified artifacts are listed as results; unverified ones are counted apart", () => {
  const artifacts = [
    { id: "a1", title: "Receipt", type: "text", verification: "verified" },
    { id: "a2", title: "Draft", type: "text", verification: "unverified" },
    { id: "a3", title: "Broken", type: "text", verification: "failed" },
  ];
  const m = mission("m", "completed", 1, { artifacts: artifacts as MissionView["artifacts"] });
  assert.deepEqual(verifiedArtifactRows(m), [{ id: "a1", title: "Receipt", type: "text" }]);
  const row = missionRows([m])[0];
  assert.equal(row.verifiedArtifacts, 1);
  assert.equal(row.unverifiedArtifacts, 2);
});

test("recent tasks are newest first, bounded, and keep the user's own title", () => {
  const tasks = [
    { id: "t1", title: "First", state: "completed", createdAt: 1 },
    { id: "t2", title: "Second", state: "waiting_for_approval", createdAt: 3 },
    { id: "t3", title: "Third", state: "queued", createdAt: 2 },
  ] as unknown as OrchTask[];
  const rows = recentTaskRows(tasks, 2);
  assert.deepEqual(rows.map((row) => row.id), ["t2", "t3"]);
  assert.equal(rows[0].stateLabel, "Waiting for approval");
  assert.equal(rows[0].title, "Second");
});

test("sending needs the chat right, a fresh view, a non-empty prompt and no send already in flight", () => {
  const base = { prompt: "Summarize the notes", submitting: false, canAct: true, viewer: fullDevice };
  assert.equal(canSend(base), true);
  assert.equal(canSend({ ...base, prompt: "   " }), false);
  assert.equal(canSend({ ...base, submitting: true }), false);
  assert.equal(canSend({ ...base, canAct: false }), false);
  assert.equal(canSend({ ...base, viewer: device(["agent.get"]) }), false);
  assert.equal(canSend({ ...base, prompt: "x".repeat(16001) }), false);
  assert.equal(canSend({ ...base, viewer: workstation }), true);
});
