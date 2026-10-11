/**
 * M-A-3 T10: the voice session state machine. Pure: no I/O, no clocks.
 *
 * Transitions are an explicit table. An illegal transition is refused (never applied) and counted, so a late or
 * out-of-order event can never move the session into a state the worker did not confirm.
 */
import type { VoiceState } from "./voice-protocol.ts";

export const VOICE_TRANSITIONS: Readonly<Record<VoiceState, readonly VoiceState[]>> = {
  IDLE: ["ARMING", "PROCESSING", "MUTED", "ERROR", "DEVICE_UNAVAILABLE"],
  ARMING: ["LISTENING", "IDLE", "ERROR", "DEVICE_UNAVAILABLE", "MUTED", "INTERRUPTED"],
  LISTENING: ["TRANSCRIBING", "IDLE", "ARMING", "ERROR", "DEVICE_UNAVAILABLE", "MUTED"],
  TRANSCRIBING: ["PROCESSING", "IDLE", "ARMING", "ERROR", "DEVICE_UNAVAILABLE"],
  PROCESSING: ["SPEAKING", "IDLE", "ARMING", "INTERRUPTED", "ERROR"],
  SPEAKING: ["PROCESSING", "INTERRUPTED", "IDLE", "ARMING", "ERROR"],
  INTERRUPTED: ["IDLE", "ARMING", "ERROR"],
  MUTED: ["IDLE", "ARMING", "ERROR"],
  ERROR: ["IDLE", "ARMING", "DEVICE_UNAVAILABLE", "MUTED"],
  DEVICE_UNAVAILABLE: ["IDLE", "ARMING", "ERROR", "MUTED"],
};

export class IllegalVoiceTransition extends Error {
  readonly from: VoiceState;
  readonly to: VoiceState;
  constructor(from: VoiceState, to: VoiceState) {
    super(`Illegal voice transition ${from} -> ${to}.`);
    this.name = "IllegalVoiceTransition";
    this.from = from;
    this.to = to;
  }
}

export function canTransition(from: VoiceState, to: VoiceState): boolean {
  return from === to ? false : VOICE_TRANSITIONS[from].includes(to);
}

/** Applies a transition or throws; use `tryTransition` where a refusal must be counted instead. */
export function transition(from: VoiceState, to: VoiceState): VoiceState {
  if (!canTransition(from, to)) throw new IllegalVoiceTransition(from, to);
  return to;
}

export type VoiceFsm = { state: VoiceState; refused: number };

export function createFsm(state: VoiceState = "IDLE"): VoiceFsm {
  return { state, refused: 0 };
}

/** Moves the machine when legal; an illegal request leaves the state unchanged and increments `refused`. */
export function tryTransition(fsm: VoiceFsm, to: VoiceState): boolean {
  if (!canTransition(fsm.state, to)) {
    fsm.refused += 1;
    return false;
  }
  fsm.state = to;
  return true;
}

/** Capture truth comes only from the worker's `capture.started` (confirmed) and is cleared by any stop. */
export function capturingTruth(state: VoiceState, workerConfirmedCapture: boolean): boolean {
  return state === "LISTENING" && workerConfirmedCapture;
}

/** Playback truth comes only from `playback.started` for the current generation and is cleared by idle or cancel. */
export function playingTruth(state: VoiceState, workerConfirmedPlayback: boolean): boolean {
  return state === "SPEAKING" && workerConfirmedPlayback;
}

/** States in which a barge-in (new listen or interrupt) has audible or in-flight speech to cancel. */
export function hasSpeechInFlight(state: VoiceState): boolean {
  return state === "SPEAKING" || state === "PROCESSING";
}
