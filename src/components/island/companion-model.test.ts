import test from "node:test";
import assert from "node:assert/strict";
import type { PersonalAgentView, PresentationState } from "../../lib/bunny-host/personal-agents.ts";
import { COMPANION_STATES, type CompanionView } from "../../lib/bunny-host/voice/voice-companion.ts";
import type { VoiceSnapshot } from "../../lib/bunny-host/voice/voice-protocol.ts";
import {
  advanceHappyMemo,
  COMPANION_LABEL,
  companionCue,
  companionDescriptor,
  companionView,
  HAPPY_WINDOW_MS,
  levelRingScale,
  resolveCompanion,
  verifiedHappyUntil,
} from "./companion-model.ts";
import { VOICE_STALE_MS } from "./voice-model.ts";

const NOW = 1_000_000;
const LIVE = { state: "live", snapshotAt: NOW - 500 } as const;

function voice(overrides: Partial<VoiceSnapshot> = {}): VoiceSnapshot {
  return {
    protocol: "bunny-voice/1",
    open: true,
    sessionId: "s1",
    hostEpoch: "e1",
    principal: "workstation",
    mode: "push_to_talk",
    state: "IDLE",
    capturing: false,
    playing: false,
    muted: false,
    level: null,
    turnId: null,
    generation: 1,
    partial: null,
    finalTranscript: null,
    turnKind: null,
    answer: null,
    answerSource: null,
    route: null,
    proposal: null,
    clarification: null,
    uiIntent: null,
    devices: { input: null, output: null, micPrivacy: "allow" },
    engines: { stt: "windows", tts: "windows", local: true },
    error: null,
    lastInterrupt: null,
    lastClose: null,
    timing: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  } as VoiceSnapshot;
}

function view(overrides: Partial<CompanionView> & { state: CompanionView["state"] }): CompanionView {
  return { reason: "host", ...overrides };
}

test("K01 a stale open voice feed reads as DISCONNECTED: the expression is not the Host's current one", () => {
  const stale = companionView({ now: NOW, connection: LIVE, voice: voice({ state: "PROCESSING" }), voiceReceivedAt: NOW - VOICE_STALE_MS - 1 });
  assert.equal(stale.state, "DISCONNECTED");
  assert.equal(stale.reason, "Voice updates stopped.");
});

test("K02 a voice snapshot received exactly at the stale limit is still fresh", () => {
  const edge = companionView({ now: NOW, connection: LIVE, voice: voice({ state: "IDLE" }), voiceReceivedAt: NOW - VOICE_STALE_MS });
  assert.equal(edge.state, "READY");
});

test("K03 a closed voice session that has gone stale is SLEEPING, matching voice-model's 'Voice is off'", () => {
  const closed = companionView({ now: NOW, connection: LIVE, voice: voice({ open: false }), voiceReceivedAt: NOW - 60_000 });
  assert.equal(closed.state, "SLEEPING");
});

test("K04 a voice snapshot that was never received is treated as stale only when open, and absent voice is unknown, not closed", () => {
  assert.equal(companionView({ now: NOW, connection: LIVE, voice: null, voiceReceivedAt: null }).state, "UNKNOWN");
  assert.equal(companionView({ now: NOW, connection: LIVE, voice: voice({ open: true }), voiceReceivedAt: null }).state, "DISCONNECTED");
});

test("K05 the Host or the connection not being live forces DISCONNECTED, even with a fresh speaking voice", () => {
  const speaking = voice({ open: true, playing: true, state: "SPEAKING" });
  for (const connection of [
    { state: "reconnecting", snapshotAt: NOW - 100 },
    { state: "offline", snapshotAt: NOW - 100 },
    { state: "live", snapshotAt: NOW - 30_000 },
    { state: "host-changed", snapshotAt: NOW - 100 },
    { state: "pairing", snapshotAt: null },
  ] as const) {
    const result = companionView({ now: NOW, connection, voice: speaking, voiceReceivedAt: NOW });
    assert.equal(result.state, "DISCONNECTED", `${connection.state} is not live`);
    assert.equal(result.reason, "Bunny-A Host is not live.");
  }
});

test("K06 a fresh, live view shows the Host's own expression from the voice snapshot", () => {
  assert.equal(companionView({ now: NOW, connection: LIVE, voice: voice({ playing: true, state: "SPEAKING" }), voiceReceivedAt: NOW }).state, "SPEAKING");
  assert.equal(companionView({ now: NOW, connection: { state: "polling", snapshotAt: NOW - 1000 }, voice: voice({ state: "PROCESSING" }), voiceReceivedAt: NOW }).state, "THINKING");
});

test("K07 the Host companion is preferred over the client's own derivation while it is fresh", () => {
  const readyVoice = voice({ state: "IDLE" });
  const fromHost = companionView({ now: NOW, connection: LIVE, voice: readyVoice, voiceReceivedAt: NOW, host: { view: view({ state: "THINKING" }), at: NOW - 1000 } });
  assert.equal(fromHost.state, "THINKING", "the Host's view wins over the client's READY");
  assert.equal(fromHost.reason, "host");
});

test("K22 a Host companion view is refused when it claims HAPPY, names no real state, or carries an untrustworthy stamp", () => {
  const readyVoice = voice({ state: "IDLE" });
  const base = { now: NOW, connection: LIVE, voice: readyVoice, voiceReceivedAt: NOW };
  // HAPPY is a client overlay: only verifiedHappyUntil may open it, never a Host view.
  assert.equal(companionView({ ...base, host: { view: view({ state: "HAPPY" }), at: NOW } }).state, "READY", "a Host HAPPY claim is ignored");
  assert.equal(companionView({ ...base, host: { view: view({ state: "BOGUS" as CompanionView["state"] }), at: NOW } }).state, "READY", "an unknown state is ignored");
  assert.equal(companionView({ ...base, host: { view: view({ state: "THINKING" }), at: Number.NaN } }).state, "READY", "a non-finite stamp is not fresh");
  assert.equal(companionView({ ...base, host: { view: view({ state: "THINKING" }), at: NOW + 60_000 } }).state, "READY", "a far-future stamp is not fresh forever");
  assert.equal(companionView({ ...base, host: { view: view({ state: "DISCONNECTED" }), at: NOW } }).state, "DISCONNECTED", "a Host-reported worker disconnect is honored");
});

test("K08 a stale Host companion falls back to the voice snapshot's own view", () => {
  const fallback = companionView({
    now: NOW,
    connection: LIVE,
    voice: voice({ state: "IDLE" }),
    voiceReceivedAt: NOW,
    host: { view: view({ state: "THINKING" }), at: NOW - VOICE_STALE_MS - 1 },
  });
  assert.equal(fallback.state, "READY");
});

test("K09 HAPPY: while the window holds, an idle companion shows HAPPY; after it closes, READY again", () => {
  const until = NOW + HAPPY_WINDOW_MS;
  assert.equal(HAPPY_WINDOW_MS, 6000);
  // The voice feed keeps polling during the window, so each read carries its own receipt time.
  const at = (now: number) => companionView({ now, connection: { state: "live", snapshotAt: now }, voice: voice({ state: "IDLE" }), voiceReceivedAt: now, happyUntil: until });
  assert.equal(at(NOW).state, "HAPPY");
  assert.equal(at(until - 1).state, "HAPPY");
  assert.equal(at(until).state, "READY", "the window ends exactly at 6 s");
});

test("K10 HAPPY never overrides speech, capture, errors, permission or disconnection", () => {
  const until = NOW + HAPPY_WINDOW_MS;
  assert.equal(companionView({ now: NOW, connection: LIVE, voice: voice({ playing: true, state: "SPEAKING" }), voiceReceivedAt: NOW, happyUntil: until }).state, "SPEAKING");
  assert.equal(companionView({ now: NOW, connection: LIVE, voice: voice({ capturing: true, state: "LISTENING" }), voiceReceivedAt: NOW, happyUntil: until }).state, "LISTENING");
  assert.equal(companionView({ now: NOW, connection: LIVE, voice: voice({ state: "ERROR", error: { code: "STT_UNAVAILABLE", message: "x" } }), voiceReceivedAt: NOW, happyUntil: until }).state, "ERROR");
  assert.equal(companionView({ now: NOW, connection: LIVE, voice: voice({ muted: true, state: "MUTED" }), voiceReceivedAt: NOW, happyUntil: until }).state, "MUTED");
  assert.equal(companionView({ now: NOW, connection: { state: "offline", snapshotAt: NOW }, voice: voice(), voiceReceivedAt: NOW, happyUntil: until }).state, "DISCONNECTED");
});

test("K11 verifiedHappyUntil: the first observation never celebrates", () => {
  const next = [slot(1, "VERIFIED")];
  assert.equal(verifiedHappyUntil(null, next, NOW, 0), 0);
});

test("K12 verifiedHappyUntil: a slot observed moving into VERIFIED opens the window; a slot already VERIFIED does not", () => {
  const before = [slot(1, "COMPLETED"), slot(2, "RESEARCHING")];
  const after = [slot(1, "VERIFIED"), slot(2, "RESEARCHING")];
  assert.equal(verifiedHappyUntil(before, after, NOW, 0), NOW + HAPPY_WINDOW_MS);
  assert.equal(verifiedHappyUntil(after, after, NOW, 0), 0, "no transition, no window");
  assert.equal(verifiedHappyUntil(after, [slot(1, "VERIFIED")], NOW + 9_000, 0), 0, "VERIFIED staying VERIFIED never re-celebrates");
});

test("K13 verifiedHappyUntil counts only VERIFIED: completed, verifying or failed never open the window", () => {
  const before = [slot(1, "VERIFYING"), slot(2, "RESEARCHING"), slot(3, "CODING"), slot(4, "IDLE")];
  for (const state of ["COMPLETED", "VERIFYING", "FAILED", "ACTIVE"] as PresentationState[]) {
    const after = [slot(1, state), slot(2, "RESEARCHING"), slot(3, "CODING"), slot(4, "IDLE")];
    assert.equal(verifiedHappyUntil(before, after, NOW, 0), 0, `${state} is not a verification`);
  }
});

test("K14 verifiedHappyUntil: a rebinding to a different Agent is not a verification, and a window never shortens", () => {
  const before = [slot(1, "COMPLETED", "agent-a")];
  const rebound = [slot(1, "VERIFIED", "agent-b")];
  assert.equal(verifiedHappyUntil(before, rebound, NOW, 0), 0, "a different Agent's VERIFIED is not this Agent's result");
  const verified = [slot(1, "VERIFIED", "agent-a")];
  assert.equal(verifiedHappyUntil(before, verified, NOW, NOW + 60_000), NOW + 60_000, "an existing later deadline is kept");
});

test("K15 levelRingScale: a fresh real level scales the ring; a stale or missing level gives no scale", () => {
  assert.equal(levelRingScale({ rms: 0.5, peak: 0.7, speech: true, at: NOW - 500 }, NOW), 1.1);
  assert.equal(levelRingScale({ rms: 0, peak: 0, speech: false, at: NOW }, NOW), 1);
  assert.equal(levelRingScale({ rms: 9, peak: 9, speech: true, at: NOW }, NOW), 1.2, "rms is clamped to 1");
  assert.equal(levelRingScale({ rms: 0.5, peak: 0.7, speech: true, at: NOW - 1500 }, NOW), null, "a level older than 1 s does not prove speech now");
  assert.equal(levelRingScale({ rms: 0.5, peak: 0.7, speech: true, at: NOW + 1500 }, NOW), null, "a level from far in the future is not fresh either");
  assert.equal(levelRingScale(null, NOW), null);
  assert.equal(levelRingScale(undefined, NOW), null);
  assert.equal(levelRingScale({ rms: Number.NaN, peak: 0, speech: false, at: NOW }, NOW), null);
});

test("K16 the level ring appears only for the capturing states, and never under reduced motion", () => {
  assert.equal(companionDescriptor("LISTENING", { levelScale: 1.1 }).levelScale, 1.1);
  assert.equal(companionDescriptor("ARMING", { levelScale: 1.05 }).levelScale, 1.05);
  assert.equal(companionDescriptor("LISTENING_WHILE_SPEAKING", { levelScale: 1.2 }).levelScale, 1.2);
  assert.equal(companionDescriptor("READY", { levelScale: 1.1 }).levelScale, null, "no level ring while idle");
  assert.equal(companionDescriptor("SPEAKING", { levelScale: 1.1 }).levelScale, null, "speaking uses the bob, not the mic level");
  assert.equal(companionDescriptor("LISTENING", { levelScale: 1.1, reducedMotion: true }).levelScale, null, "reduced motion freezes the ring");
  assert.equal(companionDescriptor("LISTENING").levelScale, null, "no level means a static ring");
});

test("K17 companion descriptors: each state's ring, badge, loop and tone follow the spec", () => {
  assert.equal(companionDescriptor("SLEEPING").loop, "breathe");
  assert.equal(companionDescriptor("SLEEPING").loopMs, 5000);
  assert.equal(companionDescriptor("READY").loop, "float");
  assert.equal(companionDescriptor("READY").loopMs, 4000);
  assert.equal(companionDescriptor("SPEAKING").loop, "bob");
  assert.equal(companionDescriptor("SPEAKING").loopMs, 1200);
  assert.equal(companionDescriptor("THINKING").loop, "orbit");
  assert.equal(companionDescriptor("THINKING").loopMs, 2400);
  assert.equal(companionDescriptor("WAITING_FOR_RESPONSE").loopMs, 2400);
  assert.equal(companionDescriptor("INTERRUPTED").loop, null, "the recoil is a one-shot, not a loop");
  assert.equal(companionDescriptor("HELD").ring, "blue");
  assert.equal(companionDescriptor("HELD").loop, null, "held is a static listening pose");
  assert.equal(companionDescriptor("PERMISSION").ring, "amber");
  assert.equal(companionDescriptor("PERMISSION").ringPulse, true);
  assert.equal(companionDescriptor("PERMISSION").badge, "attention");
  assert.equal(companionDescriptor("ERROR").badge, "failed");
  assert.equal(companionDescriptor("ERROR").ringPulse, true);
  assert.equal(companionDescriptor("MUTED").badge, "muted");
  assert.equal(companionDescriptor("MUTED").dim, true);
  assert.equal(companionDescriptor("DISCONNECTED").badge, "unplugged");
  assert.equal(companionDescriptor("DISCONNECTED").greyscale, true);
  assert.equal(companionDescriptor("DISCONNECTED").loop, null, "disconnected is static");
  assert.equal(companionDescriptor("HAPPY").loop, null, "the hop is one-shot");
  assert.equal(companionDescriptor("READY").badge, null);
});

test("K18 reduced motion removes every companion loop and the amber pulse; the ring and badge stay", () => {
  for (const state of COMPANION_STATES) {
    const d = companionDescriptor(state, { reducedMotion: true });
    assert.equal(d.loop, null, `${state}: no loop`);
    assert.equal(d.ringPulse, false, `${state}: no pulse`);
    assert.equal(d.levelScale, null, `${state}: no live scale`);
  }
  const permission = companionDescriptor("PERMISSION", { reducedMotion: true });
  assert.equal(permission.ring, "amber", "the amber ring stays");
  assert.equal(permission.badge, "attention", "the attention badge stays");
});

test("K19 companion cues: hop into HAPPY and recoil into INTERRUPTED, never on first observation or out of DISCONNECTED", () => {
  for (const next of COMPANION_STATES) assert.equal(companionCue("READY", next, true), null, "first observation never cues");
  assert.equal(companionCue("READY", "HAPPY", false), "hop");
  assert.equal(companionCue("SPEAKING", "INTERRUPTED", false), "recoil");
  assert.equal(companionCue("INTERRUPTED", "INTERRUPTED", false), null, "no change, no cue");
  assert.equal(companionCue("DISCONNECTED", "HAPPY", false), null, "a reconnect is not an observed transition");
  assert.equal(companionCue("READY", "SPEAKING", false), null);
  assert.equal(companionCue(null, "HAPPY", false), null);
});

test("K20 every companion state has a label", () => {
  for (const state of COMPANION_STATES) assert.ok(COMPANION_LABEL[state].length > 0, state);
});

function slot(id: 1 | 2 | 3 | 4, state: PresentationState, agentId = "agent-a"): PersonalAgentView {
  return {
    slot: id,
    weapon: (["gada", "spear", "chakra", "sword"] as const)[id - 1],
    displayName: "Agent",
    description: "",
    purpose: "",
    style: "concise",
    responsibilities: [],
    agentId,
    active: true,
    agent: { id: agentId, name: "Agent", state: "RUNNING", missionId: null, missionTitle: null, objective: null, projectId: null, failure: null, team: false, updatedAt: NOW },
    presentation: { state, label: state, basis: { kind: "no-category", reason: "test" } },
    attention: { pendingApprovals: 0 },
    progress: null,
    result: null,
    technical: null,
  } as PersonalAgentView;
}

test("K21 resolveCompanion: the real level ring is kept only while connected, fresh and not reduced", () => {
  const level = { rms: 0.5, peak: 0.7, speech: true, at: NOW };
  const listening = { now: NOW, connection: { state: "live" as const, snapshotAt: NOW }, voice: voice({ capturing: true, state: "LISTENING" }), voiceReceivedAt: NOW };
  const withLevel = { ...listening, voice: voice({ capturing: true, state: "LISTENING", level }) };
  assert.deepEqual(resolveCompanion(withLevel), { state: "LISTENING", level: 1.1, reason: "You are speaking." });
  assert.equal(resolveCompanion({ ...withLevel, reduced: true }).level, null, "reduced motion freezes the ring");
  assert.equal(resolveCompanion({ ...withLevel, now: NOW + 5000, connection: { state: "live", snapshotAt: NOW + 5000 }, voiceReceivedAt: NOW + 5000 }).level, null, "a level 5 s old is not fresh");
  const offline = resolveCompanion({ ...withLevel, connection: { state: "offline", snapshotAt: NOW } });
  assert.deepEqual({ state: offline.state, level: offline.level }, { state: "DISCONNECTED", level: null });
});

test("K15 advanceHappyMemo: a retained offline snapshot never seeds a comparison, so a reconnect does not celebrate", () => {
  const before = [slot(2, "ACTIVE")];
  const verified = [slot(2, "VERIFIED")];
  let memo = advanceHappyMemo({ latest: null, until: 0 }, before, NOW, true);
  memo = advanceHappyMemo(memo, before, NOW + 1_000, false);
  memo = advanceHappyMemo(memo, before, NOW + 2_000, false);
  memo = advanceHappyMemo(memo, verified, NOW + 3_000, true);
  assert.equal(memo.until, 0, "the first live observation after an outage seeds only; the verification was not observed");
  memo = advanceHappyMemo(memo, [slot(2, "ACTIVE")], NOW + 4_000, true);
  memo = advanceHappyMemo(memo, verified, NOW + 5_000, true);
  assert.equal(memo.until, NOW + 5_000 + HAPPY_WINDOW_MS, "a verification observed live still celebrates");
});
