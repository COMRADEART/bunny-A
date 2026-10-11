import test from "node:test";
import assert from "node:assert/strict";
import {
  PRESS_IDLE,
  pressDown,
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
  const acked = pressStarted(up.state, true);
  assert.deepEqual(kinds(acked), ["listen_end"]);
  assert.equal(acked.state.start, "none");
  assert.deepEqual(kinds(pressUp(acked.state)), [], "the ack-driven end is the only end");
});

test("T10 release after the start is acknowledged sends listen.end immediately", () => {
  const acked = pressStarted(pressDown(PRESS_IDLE, true).state, true);
  assert.equal(acked.state.start, "active");
  const up = pressUp(acked.state);
  assert.deepEqual(kinds(up), ["listen_end"]);
  assert.equal(up.state.pressed, false);
});

test("T10 duplicate release sends nothing the second time", () => {
  const acked = pressStarted(pressDown(PRESS_IDLE, true).state, true);
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
  const acked = pressStarted(second.state, true);
  assert.deepEqual(kinds(acked), [], "still held, so no end is sent");
  assert.equal(acked.state.start, "active");
});

test("T10 a refused listen.start releases the press and sends no end", () => {
  const refused = pressStarted(pressDown(PRESS_IDLE, true).state, false);
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
  assert.deepEqual(kinds(pressStarted(reset, true)), []);
  assert.deepEqual(kinds(pressOpened(pressDown(PRESS_IDLE, false).state, true)), ["listen_start"], "precondition: open in flight");
  assert.deepEqual(kinds(pressOpened(reset, true)), [], "an open that lands after reset starts nothing");
});
