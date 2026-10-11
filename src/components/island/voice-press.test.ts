import test from "node:test";
import assert from "node:assert/strict";
import {
  PRESS_IDLE,
  pressDown,
  pressEnded,
  pressListenPayload,
  pressOpened,
  pressReset,
  pressStarted,
  pressUp,
  type PressStep,
} from "./voice-press.ts";

const kinds = (step: PressStep) => step.effects.map((effect) => effect.type);

test("T10 press with an open session starts exactly one listen and holds the press", () => {
  const down = pressDown(PRESS_IDLE, true);
  assert.deepEqual(kinds(down), ["listen_start"]);
  assert.equal(down.state.pressed, true);
  assert.equal(down.state.start, "in_flight");
});

test("T10 press with a closed session opens first, then listens once the session is open", () => {
  const down = pressDown(PRESS_IDLE, false);
  assert.deepEqual(kinds(down), ["open_session"]);
  assert.equal(down.state.opening, true);
  const opened = pressOpened(down.state, true);
  assert.deepEqual(kinds(opened), ["listen_start"]);
  assert.equal(opened.state.opening, false);
});

test("T10 release before the session opens sends no listen and leaves the press released", () => {
  const down = pressDown(PRESS_IDLE, false);
  const up = pressUp(down.state);
  assert.deepEqual(kinds(up), []);
  assert.equal(up.state.pressed, false);
  const opened = pressOpened(up.state, true);
  assert.deepEqual(kinds(opened), [], "a session that opened after release never starts a capture");
  assert.equal(opened.state.start, "none");
});

test("T10 release while listen.start is in flight waits for the ack and then ends once", () => {
  const down = pressDown(PRESS_IDLE, true);
  const up = pressUp(down.state);
  assert.deepEqual(kinds(up), [], "no listen.end before the start is acknowledged");
  const acked = pressStarted(up.state, "started");
  assert.deepEqual(kinds(acked), ["listen_end"]);
  assert.equal(acked.state.start, "none");
  assert.deepEqual(kinds(pressUp(acked.state)), [], "the ack-driven end is the only end");
});

test("T10 release after the start is acknowledged sends listen.end immediately", () => {
  const acked = pressStarted(pressDown(PRESS_IDLE, true).state, "started");
  assert.equal(acked.state.start, "active");
  const up = pressUp(acked.state);
  assert.deepEqual(kinds(up), ["listen_end"]);
  assert.equal(up.state.pressed, false);
});

test("T10 duplicate release sends nothing the second time", () => {
  const acked = pressStarted(pressDown(PRESS_IDLE, true).state, "started");
  const first = pressUp(acked.state);
  assert.deepEqual(kinds(first), ["listen_end"]);
  const second = pressUp(first.state);
  assert.deepEqual(kinds(second), []);
});

test("T10 duplicate press while held sends no second listen.start", () => {
  const down = pressDown(PRESS_IDLE, true);
  const again = pressDown(down.state, true);
  assert.deepEqual(kinds(again), []);
  assert.equal(again.state.pressed, true);
});

test("T10 press while speaking is barge-in: the sequencer takes no playback input and starts a listen", () => {
  const down = pressDown(PRESS_IDLE, true);
  assert.deepEqual(kinds(down), ["listen_start"]);
});

test("T10 press during an earlier in-flight start sends no second start, and the ack keeps the capture live", () => {
  const first = pressDown(PRESS_IDLE, true);
  const released = pressUp(first.state);
  const second = pressDown(released.state, true);
  assert.deepEqual(kinds(second), [], "the earlier start is still in flight");
  const acked = pressStarted(second.state, "started");
  assert.deepEqual(kinds(acked), [], "still held, so no end is sent");
  assert.equal(acked.state.start, "active");
});

test("T10 a refused listen.start releases the press and sends no end", () => {
  const refused = pressStarted(pressDown(PRESS_IDLE, true).state, "refused");
  assert.deepEqual(kinds(refused), []);
  assert.equal(refused.state.pressed, false);
  assert.equal(refused.state.start, "none");
});

test("T10 a session that fails to open clears the press and starts nothing", () => {
  const failed = pressOpened(pressDown(PRESS_IDLE, false).state, false);
  assert.deepEqual(kinds(failed), []);
  assert.equal(failed.state.pressed, false);
  assert.equal(failed.state.opening, false);
});

test("T10 reset during an in-flight open or start makes the late answers no-ops", () => {
  const reset = pressReset();
  assert.deepEqual(reset, PRESS_IDLE);
  assert.deepEqual(kinds(pressStarted(reset, "started")), []);
  assert.deepEqual(kinds(pressOpened(pressDown(PRESS_IDLE, false).state, true)), ["listen_start"], "precondition: open in flight");
  assert.deepEqual(kinds(pressOpened(reset, true)), [], "an open that lands after reset starts nothing");
});

test("R2-fixcheck#1 the hold-to-talk listen.start payload is source push_to_talk (manual endpointing on the Host)", () => {
  assert.deepEqual(pressListenPayload(), { source: "push_to_talk" });
});

test("R2-races#2 a listen.start lost in transport still sends a defensive listen.end", () => {
  const started = pressStarted(pressDown(PRESS_IDLE, true).state, "unknown");
  assert.deepEqual(kinds(started), ["listen_end"], "the Host may hold a live capture whose answer was lost");
  assert.equal(started.state.pressed, false);
  assert.equal(started.state.start, "ending");
});

test("R2-races#2 a release while the lost start is in flight still ends the capture, once", () => {
  const down = pressDown(PRESS_IDLE, true);
  const released = pressUp(down.state);
  assert.deepEqual(kinds(released), []);
  const lost = pressStarted(released.state, "unknown");
  assert.deepEqual(kinds(lost), ["listen_end"]);
  assert.deepEqual(kinds(pressEnded(lost.state)), [], "nothing is held, so no new listen");
  assert.equal(pressEnded(lost.state).state.start, "none");
});

test("R2-races#2 a press made while the defensive end is in flight starts only after that end lands", () => {
  const lost = pressStarted(pressDown(PRESS_IDLE, true).state, "unknown");
  const again = pressDown(lost.state, true);
  assert.deepEqual(kinds(again), [], "no listen.start overtakes the pending end");
  assert.equal(again.state.pressed, true);
  const ended = pressEnded(again.state);
  assert.deepEqual(kinds(ended), ["listen_start"]);
  assert.equal(ended.state.start, "in_flight");
  assert.equal(pressStarted(ended.state, "started").state.start, "active");
});

test("R2-races#2 a refused start is not ended (the Host answered; no capture exists)", () => {
  const refused = pressStarted(pressDown(PRESS_IDLE, true).state, "refused");
  assert.deepEqual(kinds(refused), []);
  assert.equal(refused.state.start, "none");
});
