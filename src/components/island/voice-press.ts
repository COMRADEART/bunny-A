/**
 * Push-to-talk sequencing as a pure state machine. The store runs the effects it returns and feeds each outcome back.
 * Invariants: one listen.start per press; listen.end is never sent before the matching listen.start is acknowledged;
 * a release before the session opens, a duplicate press and a duplicate release all send nothing extra.
 * A listen.start whose outcome is unknown (transport failure, timeout) may already be a live capture on the Host, so
 * it is ended defensively and a new press waits for that end before it starts again.
 * Speaking or processing does not gate a press: a press during playback is barge-in (the Host cancels speech).
 */

export type PressStart = "none" | "in_flight" | "active" | "ending";
export type PressState = { pressed: boolean; opening: boolean; start: PressStart };
export type PressEffect = { type: "open_session" } | { type: "listen_start" } | { type: "listen_end" };
export type PressStep = { state: PressState; effects: PressEffect[] };
/** started: the Host acknowledged a capture. refused: the Host answered with a refusal. unknown: no answer arrived. */
export type StartOutcome = "started" | "refused" | "unknown";

export const PRESS_IDLE: PressState = { pressed: false, opening: false, start: "none" };

/** The listen.start payload. Hold-to-talk is push-to-talk on the Host: manual endpointing, so a pause never ends a held turn. */
export function pressListenPayload(): { source: "push_to_talk" } {
  return { source: "push_to_talk" };
}

const step = (state: PressState, effects: PressEffect[] = []): PressStep => ({ state, effects });

/** The user pressed. `sessionOpen` is whether the held snapshot says a session is open right now. */
export function pressDown(state: PressState, sessionOpen: boolean): PressStep {
  if (state.pressed) return step(state);
  const next = { ...state, pressed: true };
  // A session open is already in flight: pressOpened() starts the listen once it lands.
  if (state.opening) return step(next);
  // A listen.start is already in flight for an earlier press: pressStarted() activates it because the key is held.
  if (state.start === "in_flight") return step(next);
  // An unknown start is being ended: pressEnded() starts the listen once that end is acknowledged.
  if (state.start === "ending") return step(next);
  if (!sessionOpen) return step({ ...next, opening: true }, [{ type: "open_session" }]);
  return step({ ...next, start: "in_flight" }, [{ type: "listen_start" }]);
}

/** The session-open request finished. `sessionOpen` is the snapshot after it. */
export function pressOpened(state: PressState, sessionOpen: boolean): PressStep {
  if (!state.opening) return step(state);
  const settled = { ...state, opening: false };
  if (!sessionOpen) return step({ ...settled, pressed: false });
  if (!settled.pressed) return step(settled);
  return step({ ...settled, start: "in_flight" }, [{ type: "listen_start" }]);
}

/** The listen.start request finished. */
export function pressStarted(state: PressState, outcome: StartOutcome): PressStep {
  if (state.start !== "in_flight") return step(state);
  if (outcome === "refused") return step({ ...state, start: "none", pressed: false });
  if (outcome === "unknown") {
    // The Host may have opened a capture whose answer was lost: end it, and hold a new press until that end lands.
    return step({ ...state, start: "ending", pressed: false }, [{ type: "listen_end" }]);
  }
  if (state.pressed) return step({ ...state, start: "active" });
  // Released while the start was in flight: the capture is live on the Host, so end it now that it is acknowledged.
  return step({ ...state, start: "none" }, [{ type: "listen_end" }]);
}

/** The defensive listen.end for an unknown start was acknowledged (or failed); a press held meanwhile starts now. */
export function pressEnded(state: PressState): PressStep {
  if (state.start !== "ending") return step(state);
  if (!state.pressed) return step({ ...state, start: "none" });
  return step({ ...state, start: "in_flight" }, [{ type: "listen_start" }]);
}

/** The user released (pointer up, cancel, leave, or Space/Enter up). */
export function pressUp(state: PressState): PressStep {
  if (!state.pressed) return step(state);
  const next = { ...state, pressed: false };
  if (state.start === "active") return step({ ...next, start: "none" }, [{ type: "listen_end" }]);
  // Released before the open or start landed: pressOpened() / pressStarted() settle it without a capture or with an end.
  return step(next);
}

/** The session closed or a new Host epoch replaced the snapshot. Late answers are ignored once this runs. */
export function pressReset(): PressState {
  return PRESS_IDLE;
}
