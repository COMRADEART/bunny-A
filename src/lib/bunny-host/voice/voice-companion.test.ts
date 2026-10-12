import test from "node:test";
import assert from "node:assert/strict";
import { COMPANION_INTERRUPT_MS, COMPANION_LEVEL_FRESH_MS, COMPANION_STATES, companionState, type CompanionState } from "./voice-companion.ts";
import { VOICE_PROTOCOL, type VoiceSnapshot } from "./voice-protocol.ts";

/** M-A-3 T13: the companion expression is derived from the Host voice snapshot's own facts, never from a timer. */

const NOW = 50_000;

/** An open, idle, push-to-talk snapshot; each test overrides only the facts it is about. */
function snap(over: Record<string, unknown> = {}): VoiceSnapshot {
  return {
    protocol: VOICE_PROTOCOL,
    open: true,
    sessionId: "session-1",
    hostEpoch: "epoch-1",
    principal: "workstation",
    mode: "push_to_talk",
    state: "IDLE",
    capturing: false,
    playing: false,
    muted: false,
    level: null,
    turnId: null,
    generation: 0,
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
    engines: { stt: null, tts: null, local: true },
    error: null,
    lastInterrupt: null,
    lastClose: null,
    timing: null,
    createdAt: null,
    updatedAt: NOW,
    duplex: { available: true, active: false, aec: null, reference: null, fixture: false },
    outputHeld: false,
    lastBargeIn: null,
    ...over,
  } as unknown as VoiceSnapshot;
}

const stateOf = (over: Record<string, unknown> = {}) => companionState(snap(over), NOW).state;

test("T13 companion: a closed or missing session sleeps, whatever stale facts it still carries", () => {
  assert.equal(companionState(null, NOW).state, "SLEEPING");
  assert.equal(companionState(undefined, NOW).state, "SLEEPING");
  assert.equal(companionState(snap({ open: false, capturing: true, playing: true }), NOW).state, "SLEEPING");
});

test("T13 companion: an open idle session is READY, and nothing is shown as ready when the snapshot is not open", () => {
  assert.deepEqual(companionState(snap(), NOW), { state: "READY", reason: "Session open and idle." });
});

test("T13 companion: a lost worker or unavailable device is DISCONNECTED with the Host's own code", () => {
  for (const code of ["WORKER_EXITED", "WORKER_INTEGRITY", "NOT_WINDOWS", "DEVICE_LOST", "DEVICE_UNAVAILABLE"]) {
    assert.deepEqual(companionState(snap({ error: { code, message: "x" } }), NOW), { state: "DISCONNECTED", reason: code });
  }
  assert.deepEqual(companionState(snap({ state: "DEVICE_UNAVAILABLE" }), NOW), { state: "DISCONNECTED", reason: "DEVICE_UNAVAILABLE" });
});

test("T13 companion: an error state or an error receipt is ERROR and names the code", () => {
  assert.deepEqual(companionState(snap({ state: "ERROR" }), NOW), { state: "ERROR", reason: "ERROR" });
  assert.deepEqual(companionState(snap({ error: { code: "STT_UNAVAILABLE", message: "x" } }), NOW), { state: "ERROR", reason: "STT_UNAVAILABLE" });
});

test("T13 companion: a live proposal or clarification asks for permission; an expired one is ignored", () => {
  const proposal = { id: "p1", action: "agent.stop", agentId: "a", agentName: "A", revision: 1, confirmVia: "screen", createdAt: NOW - 1000, expiresAt: NOW + 5000, hostEpoch: "epoch-1" };
  assert.deepEqual(companionState(snap({ proposal }), NOW), { state: "PERMISSION", reason: "proposal" });
  const clarification = { question: "Which one?", candidates: [{ id: "a", name: "A" }], expiresAt: NOW + 1 };
  assert.deepEqual(companionState(snap({ clarification }), NOW), { state: "PERMISSION", reason: "clarification" });

  const stale = { ...proposal, expiresAt: NOW };
  assert.deepEqual(companionState(snap({ proposal: stale }), NOW), { state: "READY", reason: "Session open and idle." }, "a proposal that expired at this instant is stale");
  const staleClarification = { question: "Which one?", candidates: [], expiresAt: NOW - 1 };
  assert.equal(companionState(snap({ clarification: staleClarification }), NOW).state, "READY");
});

test("T13 companion: microphone privacy denial is a permission state even while the session is otherwise busy", () => {
  assert.deepEqual(companionState(snap({ devices: { input: null, output: null, micPrivacy: "deny" }, capturing: true }), NOW), { state: "PERMISSION", reason: "microphone privacy" });
});

test("T13 companion: a muted microphone is MUTED unless a permission question is open", () => {
  assert.deepEqual(companionState(snap({ muted: true }), NOW), { state: "MUTED", reason: "Microphone muted." });
  assert.equal(stateOf({ state: "MUTED" }), "MUTED");
  const proposal = { id: "p1", action: "agent.stop", agentId: "a", agentName: "A", revision: 1, confirmVia: "screen", createdAt: NOW - 1, expiresAt: NOW + 1, hostEpoch: "epoch-1" };
  assert.equal(stateOf({ muted: true, proposal }), "PERMISSION");
});

test("T13 companion: playback confirmed by the worker is SPEAKING, with capture too it is LISTENING_WHILE_SPEAKING", () => {
  assert.deepEqual(companionState(snap({ playing: true, state: "SPEAKING" }), NOW), { state: "SPEAKING", reason: "Playback confirmed by the worker." });
  assert.deepEqual(companionState(snap({ playing: true, capturing: true, state: "SPEAKING" }), NOW), { state: "LISTENING_WHILE_SPEAKING", reason: "Capture and playback both confirmed by the worker." });
});

test("T13 companion: a held reply is HELD, and a cancelled one is INTERRUPTED", () => {
  assert.deepEqual(companionState(snap({ outputHeld: true, state: "IDLE", capturing: true }), NOW), { state: "HELD", reason: "Reply paused while you speak." });
  assert.deepEqual(companionState(snap({ state: "INTERRUPTED" }), NOW), { state: "INTERRUPTED", reason: "Playback cancelled." });
});

test("T13 companion: an acoustic barge-in receipt shows INTERRUPTED only for its own window", () => {
  const receipt = (decidedAt: number, outcome = "interrupted") => ({ inputTurnId: "i", outputTurnId: "o", gen: 1, outcome, decidedAt, reason: "speech", echoRejected: 0 });
  assert.deepEqual(companionState(snap({ lastBargeIn: receipt(NOW - 1000) }), NOW), { state: "INTERRUPTED", reason: "Recent interruption receipt." });
  assert.equal(companionState(snap({ lastBargeIn: receipt(NOW - COMPANION_INTERRUPT_MS) }), NOW).state, "INTERRUPTED", "the window's edge still counts");
  assert.equal(companionState(snap({ lastBargeIn: receipt(NOW - COMPANION_INTERRUPT_MS - 1) }), NOW).state, "READY", "a receipt older than the window is gone");
  assert.equal(companionState(snap({ lastBargeIn: receipt(NOW - 100, "resumed") }), NOW).state, "READY", "a resumed reply is not an interruption");
  assert.equal(companionState(snap({ lastBargeIn: receipt(NOW - 100, "pending") }), NOW).state, "READY");
});

test("T13 companion: a recent button or hotkey interrupt is INTERRUPTED for the same window", () => {
  const interrupt = (requestedAt: number) => ({ turnId: "t", gen: 1, requestedAt, source: "button" });
  assert.deepEqual(companionState(snap({ lastInterrupt: interrupt(NOW - 500) }), NOW), { state: "INTERRUPTED", reason: "Recent interruption receipt." });
  assert.equal(companionState(snap({ lastInterrupt: interrupt(NOW - COMPANION_INTERRUPT_MS - 1) }), NOW).state, "READY");
});

test("T13 companion: an interruption receipt never hides an answer being produced", () => {
  const receipt = { inputTurnId: "i", outputTurnId: "o", gen: 1, outcome: "interrupted", decidedAt: NOW - 100, reason: "speech", echoRejected: 0 };
  assert.equal(companionState(snap({ state: "PROCESSING", lastBargeIn: receipt, timing: { admittedAt: 1, firstTokenAt: 2 } }), NOW).state, "THINKING");
  assert.equal(companionState(snap({ state: "SPEAKING", lastBargeIn: receipt }), NOW).state, "READY", "a receipt is read only while the answer is not being spoken");
});

test("T13 companion: transcribing and the response wait are shown while hands-free capture is open", () => {
  const handsFree = { available: true, active: true, aec: "on", reference: "ok", fixture: false };
  assert.deepEqual(companionState(snap({ state: "TRANSCRIBING", capturing: true, duplex: handsFree }), NOW), { state: "TRANSCRIBING", reason: "Finishing your words." });
  assert.deepEqual(companionState(snap({ state: "PROCESSING", capturing: true, duplex: handsFree, timing: { admittedAt: 10, firstTokenAt: null } }), NOW), { state: "WAITING_FOR_RESPONSE", reason: "Answer admitted; no text yet." });
});

test("T13 companion: an answer being produced is THINKING even while hands-free capture is open", () => {
  const handsFree = { available: true, active: true, aec: "on", reference: "ok", fixture: false };
  assert.deepEqual(companionState(snap({ state: "PROCESSING", capturing: true, duplex: handsFree, timing: { admittedAt: 10, firstTokenAt: 20 } }), NOW), { state: "THINKING", reason: "Answer being produced." });
  assert.deepEqual(companionState(snap({ state: "PROCESSING", timing: null }), NOW), { state: "THINKING", reason: "Answer being produced." });
});

test("T13 companion: arming shows while the microphone is opening, including the hands-free start", () => {
  assert.deepEqual(companionState(snap({ state: "ARMING" }), NOW), { state: "ARMING", reason: "Opening microphone." });
  assert.deepEqual(companionState(snap({ duplex: { available: true, active: false, starting: true } }), NOW), { state: "ARMING", reason: "Opening microphone." });
});

test("T13 companion: a fresh speech level means the user is speaking; a stale level does not prove it", () => {
  const speech = { rms: 0.4, peak: 0.6, speech: true, at: NOW - 100 };
  assert.deepEqual(companionState(snap({ capturing: true, level: speech }), NOW), { state: "LISTENING", reason: "You are speaking." });
  const stale = { ...speech, at: NOW - COMPANION_LEVEL_FRESH_MS - 1 };
  assert.deepEqual(companionState(snap({ capturing: true, level: stale }), NOW), { state: "LISTENING", reason: "Microphone open for this turn." });
  assert.equal(companionState(snap({ state: "LISTENING" }), NOW).state, "LISTENING");
});

test("T13 companion: a receipt or level stamped after this instant is not fresh (a clock step backwards proves nothing)", () => {
  const bargeIn = { inputTurnId: "i", outputTurnId: "o", gen: 1, outcome: "interrupted", decidedAt: NOW + 5000, reason: "speech", echoRejected: 0 };
  assert.equal(companionState(snap({ lastBargeIn: bargeIn }), NOW).state, "READY");
  assert.equal(companionState(snap({ lastInterrupt: { turnId: "t", gen: 1, requestedAt: NOW + 5000, source: "button" } }), NOW).state, "READY");
  const future = { rms: 0.4, peak: 0.6, speech: true, at: NOW + 5000 };
  assert.deepEqual(companionState(snap({ capturing: true, level: future }), NOW), { state: "LISTENING", reason: "Microphone open for this turn." });
});

test("T13 companion: hands-free capture is LISTENING, never READY, and an unconfirmed capture is not shown", () => {
  const handsFree = { available: true, active: true, aec: "on", reference: "ok", fixture: false };
  assert.deepEqual(companionState(snap({ capturing: true, duplex: handsFree }), NOW), { state: "LISTENING", reason: "Hands-free microphone open." });
  assert.deepEqual(companionState(snap({ capturing: true }), NOW), { state: "LISTENING", reason: "Microphone open for this turn." });
  assert.deepEqual(companionState(snap({ duplex: handsFree, capturing: false }), NOW), { state: "READY", reason: "Session open and idle." }, "an active lane with no confirmed capture is not listening");
});

test("T13 companion: a hands-free receipt still wins over the listening pose", () => {
  const handsFree = { available: true, active: true, aec: "on", reference: "ok", fixture: false };
  const receipt = { inputTurnId: "i", outputTurnId: "o", gen: 1, outcome: "interrupted", decidedAt: NOW - 50, reason: "speech", echoRejected: 0 };
  assert.equal(companionState(snap({ capturing: true, duplex: handsFree, lastBargeIn: receipt }), NOW).state, "INTERRUPTED");
});

test("T13 companion: every expression the Host can prove is reachable, and HAPPY is never Host-derived", () => {
  const scenarios: [CompanionState, Record<string, unknown> | null][] = [
    ["SLEEPING", null],
    ["READY", {}],
    ["ARMING", { state: "ARMING" }],
    ["LISTENING", { capturing: true }],
    ["LISTENING_WHILE_SPEAKING", { capturing: true, playing: true }],
    ["SPEAKING", { playing: true }],
    ["HELD", { outputHeld: true }],
    ["TRANSCRIBING", { state: "TRANSCRIBING" }],
    ["WAITING_FOR_RESPONSE", { state: "PROCESSING", timing: { admittedAt: 1, firstTokenAt: null } }],
    ["THINKING", { state: "PROCESSING", timing: { admittedAt: 1, firstTokenAt: 2 } }],
    ["INTERRUPTED", { state: "INTERRUPTED" }],
    ["PERMISSION", { devices: { input: null, output: null, micPrivacy: "deny" } }],
    ["MUTED", { muted: true }],
    ["ERROR", { state: "ERROR" }],
    ["DISCONNECTED", { error: { code: "WORKER_EXITED", message: "x" } }],
  ];
  const produced = new Set<CompanionState>();
  for (const [expected, facts] of scenarios) {
    const view = facts === null ? companionState(null, NOW) : companionState(snap(facts), NOW);
    assert.equal(view.state, expected, `facts ${JSON.stringify(facts)}`);
    produced.add(view.state);
  }
  const hostDerived = COMPANION_STATES.filter((state) => state !== "HAPPY" && state !== "UNKNOWN");
  assert.deepEqual([...produced].sort(), [...hostDerived].sort());
  assert.ok(!produced.has("HAPPY"), "HAPPY is a client overlay for a Host-verified result, never a voice fact");
});

test("T13 companion: a muted input endpoint is MUTED even when the capture flag is open", () => {
  const base = snap({ capturing: true });
  const endpointMuted = { ...base, devices: { ...base.devices, input: { ...base.devices.input, muted: true } } } as VoiceSnapshot;
  assert.equal(companionState(endpointMuted, NOW).state, "MUTED", "the companion must not say Listening into a muted endpoint");
  const endpointOpen = { ...base, devices: { ...base.devices, input: { ...base.devices.input, muted: false } } } as VoiceSnapshot;
  assert.equal(companionState(endpointOpen, NOW).state, "LISTENING");
});
