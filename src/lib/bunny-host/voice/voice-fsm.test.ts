import test from "node:test";
import assert from "node:assert/strict";
import { VOICE_TRANSITIONS, canTransition, capturingTruth, createFsm, hasSpeechInFlight, IllegalVoiceTransition, playingTruth, transition, tryTransition } from "./voice-fsm.ts";

test("V01 the default session is IDLE and capture cannot start without an explicit ARMING step", () => {
  const fsm = createFsm();
  assert.equal(fsm.state, "IDLE");
  assert.equal(fsm.refused, 0);
  assert.equal(canTransition("IDLE", "LISTENING"), false);
});

test("V02 explicit activation goes IDLE -> ARMING -> LISTENING", () => {
  const fsm = createFsm();
  assert.equal(tryTransition(fsm, "ARMING"), true);
  assert.equal(tryTransition(fsm, "LISTENING"), true);
  assert.equal(fsm.state, "LISTENING");
});

test("V22 an illegal transition is refused, counted and leaves the state unchanged", () => {
  const fsm = createFsm("SPEAKING");
  assert.equal(tryTransition(fsm, "LISTENING"), false);
  assert.equal(fsm.state, "SPEAKING");
  assert.equal(fsm.refused, 1);
  assert.throws(() => transition("SPEAKING", "LISTENING"), IllegalVoiceTransition);
});

test("V21 a self-transition is not a transition and is refused", () => {
  assert.equal(canTransition("IDLE", "IDLE"), false);
});

test("the table names only real states and every state is reachable from IDLE", () => {
  const states = Object.keys(VOICE_TRANSITIONS);
  for (const targets of Object.values(VOICE_TRANSITIONS)) for (const target of targets) assert.ok(states.includes(target), target);
  const seen = new Set(["IDLE"]);
  const queue = ["IDLE"];
  while (queue.length) {
    const from = queue.shift() as keyof typeof VOICE_TRANSITIONS;
    for (const to of VOICE_TRANSITIONS[from]) if (!seen.has(to)) { seen.add(to); queue.push(to); }
  }
  assert.equal(seen.size, states.length);
});

test("V25 capture and playback truth require the worker confirmation and the matching state", () => {
  assert.equal(capturingTruth("LISTENING", true), true);
  assert.equal(capturingTruth("ARMING", true), false);
  assert.equal(capturingTruth("LISTENING", false), false);
  assert.equal(playingTruth("SPEAKING", true), true);
  assert.equal(playingTruth("PROCESSING", true), false);
  assert.equal(playingTruth("SPEAKING", false), false);
});

test("V29 barge-in applies only where speech is in flight", () => {
  assert.equal(hasSpeechInFlight("SPEAKING"), true);
  assert.equal(hasSpeechInFlight("PROCESSING"), true);
  assert.equal(hasSpeechInFlight("IDLE"), false);
  assert.equal(hasSpeechInFlight("LISTENING"), false);
});

test("V03 V04 device errors route to DEVICE_UNAVAILABLE only from capture-capable states", () => {
  assert.equal(canTransition("ARMING", "DEVICE_UNAVAILABLE"), true);
  assert.equal(canTransition("LISTENING", "DEVICE_UNAVAILABLE"), true);
  assert.equal(canTransition("SPEAKING", "DEVICE_UNAVAILABLE"), false);
});
