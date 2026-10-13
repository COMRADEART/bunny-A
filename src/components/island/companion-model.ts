import type { PersonalAgentView } from "../../lib/bunny-host/personal-agents.ts";
import {
  COMPANION_LEVEL_FRESH_MS,
  COMPANION_STATES,
  companionState,
  type CompanionState,
  type CompanionView,
} from "../../lib/bunny-host/voice/voice-companion.ts";
import type { VoiceSnapshot } from "../../lib/bunny-host/voice/voice-protocol.ts";
import type { Connection } from "./connection-model.ts";
import { hostLive, RING_PULSE_MS, EASE } from "./character-model.ts";
import { VOICE_STALE_MS } from "./voice-model.ts";

/**
 * T13 Bunny companion model (pure). The companion's expression is the Host's, derived from the voice snapshot. This file
 * adds only the client overlays the Host cannot report: DISCONNECTED when the Host or the voice feed is not live, and
 * HAPPY for a short window after a Personal Agent slot is observed becoming VERIFIED.
 */

/** HAPPY lasts this long after a slot is observed transitioning into VERIFIED (spec §9 hop, client-owned window). */
export const HAPPY_WINDOW_MS = 6_000;
/** Level ring scale: 1.0 at silence up to 1 + LEVEL_RING_GAIN at full input. */
export const LEVEL_RING_GAIN = 0.2;

export type CompanionInput = {
  now: number;
  connection: Pick<Connection, "state" | "snapshotAt">;
  voice: VoiceSnapshot | null;
  /** When the client received `voice` (its own clock). Null means it has never been received. */
  voiceReceivedAt: number | null;
  /** The Host's own companion view, when a snapshot carries one, with the time it was taken. Absent today. */
  host?: { view: CompanionView; at: number } | null;
  /** Until when the HAPPY overlay holds (from verifiedHappyUntil). Zero or past means no overlay. */
  happyUntil?: number;
};

/**
 * The Host's own companion view, when it is fresh (either side of the clock, so a far-future stamp is not fresh forever)
 * and names a real companion state. HAPPY is a client overlay that only verifiedHappyUntil may open, so a Host view that
 * claims it is refused, as is any state the companion does not know.
 */
function honoredHostView(host: CompanionInput["host"], now: number): CompanionView | null {
  if (!host || !Number.isFinite(host.at) || Math.abs(now - host.at) > VOICE_STALE_MS) return null;
  const view = host.view;
  if (!view || view.state === "HAPPY" || view.state === "UNKNOWN" || !(COMPANION_STATES as readonly string[]).includes(view.state)) return null;
  return view;
}

/**
 * The companion as shown. Precedence: Host or connection not live → DISCONNECTED; a fresh Host companion view, else the
 * voice snapshot's own view (open but stale voice → DISCONNECTED, closed voice → SLEEPING, as voice-model.voiceStatus
 * reads it); then HAPPY over an idle expression (READY or SLEEPING) while the window holds. Never HAPPY over speech,
 * capture, errors, permission or disconnection.
 */
export function companionView(input: CompanionInput): CompanionView {
  const { now, connection, voice, voiceReceivedAt, host, happyUntil = 0 } = input;
  if (!hostLive(connection, now)) return { state: "DISCONNECTED", reason: "Bunny-A Host is not live." };
  let view: CompanionView;
  const hostView = honoredHostView(host, now);
  if (hostView) {
    view = hostView;
  } else {
    const stale = voice !== null && (voiceReceivedAt === null || now - voiceReceivedAt > VOICE_STALE_MS);
    if (voice !== null && stale && voice.open) return { state: "DISCONNECTED", reason: "Voice updates stopped." };
    // No voice snapshot has been received (a phone never gets one, and a Host that predates voice sends none): the voice
    // state is unknown, so the companion does not claim the session is closed.
    view = voice === null ? { state: "UNKNOWN", reason: "Voice status has not been received." } : companionState(voice, now);
  }
  if (now < happyUntil && (view.state === "READY" || view.state === "SLEEPING")) {
    return { state: "HAPPY", reason: "A Personal Agent result was verified." };
  }
  return view;
}

/**
 * Advances the HAPPY window from two consecutive observations of the personal slots. `prev` null means first observation:
 * nothing is celebrated. A slot counts only when it was seen in the previous observation, was not VERIFIED there, is now
 * VERIFIED, and still holds the same Agent (a rebinding is not a verification).
 */
export function verifiedHappyUntil(
  prev: readonly PersonalAgentView[] | null,
  next: readonly PersonalAgentView[],
  now: number,
  happyUntil: number,
): number {
  if (!prev) return happyUntil;
  let until = happyUntil;
  for (const slot of next) {
    if (slot.presentation.state !== "VERIFIED") continue;
    const before = prev.find((candidate) => candidate.slot === slot.slot);
    if (!before || before.presentation.state === "VERIFIED") continue;
    if ((before.agent?.id ?? null) !== (slot.agent?.id ?? null)) continue;
    until = Math.max(until, now + HAPPY_WINDOW_MS);
  }
  return until;
}

export type HappyMemo = { latest: readonly PersonalAgentView[] | null; until: number };

/**
 * One render's step of the HAPPY memo. A Host that is not live is not observed: its retained slots neither seed nor compare
 * a later transition, so a verification that happened while offline is never celebrated on reconnect (the weapon cue
 * makes the same choice in transitionCue).
 */
export function advanceHappyMemo(memo: HappyMemo, slots: readonly PersonalAgentView[] | null, now: number, live: boolean): HappyMemo {
  if (!live) return memo.latest === null ? memo : { latest: null, until: memo.until };
  if (!slots || slots === memo.latest) return memo;
  return { latest: slots, until: verifiedHappyUntil(memo.latest, slots, now, memo.until) };
}

/**
 * The real input level as a ring scale. Only a level whose own timestamp is within COMPANION_LEVEL_FRESH_MS of the local
 * clock counts (either side, to tolerate clock skew between Host and client). No fresh level means no scale: the ring
 * stays static.
 */
export function levelRingScale(level: VoiceSnapshot["level"] | null | undefined, now: number): number | null {
  if (!level || !Number.isFinite(level.rms) || !Number.isFinite(level.at)) return null;
  if (Math.abs(now - level.at) > COMPANION_LEVEL_FRESH_MS) return null;
  const rms = Math.min(1, Math.max(0, level.rms));
  return Math.round((1 + LEVEL_RING_GAIN * rms) * 100) / 100;
}

export const COMPANION_LABEL: Record<CompanionState, string> = {
  SLEEPING: "Sleeping",
  READY: "Ready",
  ARMING: "Opening microphone",
  LISTENING: "Listening",
  LISTENING_WHILE_SPEAKING: "Listening while speaking",
  SPEAKING: "Speaking",
  HELD: "Paused for you",
  TRANSCRIBING: "Finishing your words",
  WAITING_FOR_RESPONSE: "Waiting for the answer",
  THINKING: "Thinking",
  INTERRUPTED: "Interrupted",
  PERMISSION: "Needs you",
  MUTED: "Muted",
  ERROR: "Voice error",
  DISCONNECTED: "Disconnected",
  HAPPY: "Result verified",
  UNKNOWN: "Voice unknown",
};

export type CompanionDescriptor = {
  state: CompanionState;
  label: string;
  badge: "attention" | "failed" | "muted" | "unplugged" | null;
  /** blue: capture or hold. amber: needs the user. none: no ring. */
  ring: "none" | "blue" | "amber";
  /** Amber ring pulse loop (PERMISSION, ERROR). */
  ringPulse: boolean;
  /** Real level ring scale, only while capturing states have a fresh level. Null means a static ring. */
  levelScale: number | null;
  /** Body loop: breathe (SLEEPING), float (READY), bob (speaking), orbit (waiting on text). */
  loop: "breathe" | "float" | "bob" | "orbit" | null;
  loopMs: number | null;
  easing: string | null;
  dim: boolean;
  greyscale: boolean;
};

const LOOPS: Partial<Record<CompanionState, { loop: "breathe" | "float" | "bob" | "orbit"; ms: number; ease: string }>> = {
  SLEEPING: { loop: "breathe", ms: 5000, ease: EASE.standard },
  READY: { loop: "float", ms: 4000, ease: EASE.standard },
  SPEAKING: { loop: "bob", ms: 1200, ease: EASE.standard },
  LISTENING_WHILE_SPEAKING: { loop: "bob", ms: 1200, ease: EASE.standard },
  TRANSCRIBING: { loop: "orbit", ms: RING_PULSE_MS, ease: EASE.orbital },
  WAITING_FOR_RESPONSE: { loop: "orbit", ms: RING_PULSE_MS, ease: EASE.orbital },
  THINKING: { loop: "orbit", ms: RING_PULSE_MS, ease: EASE.orbital },
};

const LEVEL_RING: ReadonlySet<CompanionState> = new Set(["ARMING", "LISTENING", "LISTENING_WHILE_SPEAKING"]);

/**
 * The visual description of a companion state (spec §9). `levelScale` is honored only for the listening states and
 * never under reduced motion, so the reduced setting freezes the ring at its static size. Reduced motion also removes
 * the loops and the amber pulse; the ring and badge remain.
 */
export function companionDescriptor(
  state: CompanionState,
  options: { reducedMotion?: boolean; levelScale?: number | null } = {},
): CompanionDescriptor {
  const reduced = options.reducedMotion === true;
  const loop = reduced ? undefined : LOOPS[state];
  const ring: CompanionDescriptor["ring"] =
    state === "PERMISSION" || state === "ERROR" ? "amber"
    : state === "HELD" || LEVEL_RING.has(state) ? "blue"
    : "none";
  return {
    state,
    label: COMPANION_LABEL[state],
    badge:
      state === "PERMISSION" ? "attention"
      : state === "ERROR" ? "failed"
      : state === "MUTED" ? "muted"
      : state === "DISCONNECTED" ? "unplugged"
      : null,
    ring,
    ringPulse: !reduced && (state === "PERMISSION" || state === "ERROR"),
    levelScale: !reduced && LEVEL_RING.has(state) ? (options.levelScale ?? null) : null,
    loop: loop?.loop ?? null,
    loopMs: loop?.ms ?? null,
    easing: loop?.ease ?? null,
    dim: state === "MUTED" || state === "SLEEPING",
    greyscale: state === "DISCONNECTED",
  };
}

/**
 * One-shot cue for a companion move: `hop` into HAPPY, `recoil` into INTERRUPTED. Never on the first observation, never
 * out of DISCONNECTED (a reconnect is not an observed transition), never under reduced motion (the caller skips it).
 */
export function companionCue(prev: CompanionState | null | undefined, next: CompanionState, firstObservation: boolean): "hop" | "recoil" | null {
  if (firstObservation || !prev || prev === next || prev === "DISCONNECTED") return null;
  if (next === "HAPPY") return "hop";
  if (next === "INTERRUPTED") return "recoil";
  return null;
}

/**
 * The companion as the island resolves it: the view from companion-model plus the real level ring scale. The level is
 * dropped while disconnected and under reduced motion. Pure: call it on every render with the current `now`.
 */
export function resolveCompanion(input: {
  now: number;
  connection: Pick<Connection, "state" | "snapshotAt">;
  voice: VoiceSnapshot | null;
  voiceReceivedAt: number | null;
  host?: { view: CompanionView; at: number } | null;
  happyUntil?: number;
  reduced?: boolean;
}): { state: CompanionState; level: number | null; reason: string } {
  const view = companionView(input);
  const level = input.voice && view.state !== "DISCONNECTED" ? levelRingScale(input.voice.level, input.now) : null;
  return { state: view.state, level: input.reduced ? null : level, reason: view.reason };
}

/** Companion one-shot durations (spec §8/§9), read by characters.css through the component's style. */
export const COMPANION_ONESHOT_MS = { hop: 600, recoil: 200 } as const;
