import type { VoiceSnapshot } from "./voice-protocol.ts";

/**
 * M-A-3 T13 — the Bunny companion's expression, derived only from the Host voice snapshot.
 *
 * The companion reads the snapshot's independent facts (open, state, capturing, playing, outputHeld, muted, duplex,
 * proposal/clarification, error, timing, level) instead of one label, so hands-free capture can never hide thinking,
 * interruption or readiness. Nothing here is timer-driven or decorative: if the snapshot does not prove a state, the
 * companion does not show it. DISCONNECTED for a stale or unreachable Host and HAPPY for a Host-verified Agent result
 * are client overlays (the Host cannot report its own unreachability, and voice carries no verification outcome).
 */

export const COMPANION_STATES = [
  "SLEEPING", "READY", "ARMING", "LISTENING", "LISTENING_WHILE_SPEAKING", "SPEAKING", "HELD", "TRANSCRIBING",
  "WAITING_FOR_RESPONSE", "THINKING", "INTERRUPTED", "PERMISSION", "MUTED", "ERROR", "DISCONNECTED", "HAPPY",
  // Client-only: no voice snapshot has been received, so the client does not know the voice state. The Host never derives it.
  "UNKNOWN",
] as const;
export type CompanionState = (typeof COMPANION_STATES)[number];

/** How long an acoustic barge-in receipt keeps the interrupted expression after it was recorded. */
export const COMPANION_INTERRUPT_MS = 2500;
/** A level sample older than this does not prove the user is speaking now. */
export const COMPANION_LEVEL_FRESH_MS = 1000;

export type CompanionView = { state: CompanionState; reason: string };

const DISCONNECT_CODES = new Set(["WORKER_EXITED", "WORKER_INTEGRITY", "NOT_WINDOWS", "DEVICE_LOST", "DEVICE_UNAVAILABLE"]);

/**
 * Precedence (first match wins): closed → error/device → permission → muted → overlapped speech → speaking → held →
 * interrupted → transcribing → response wait → thinking → arming → listening → ready.
 */
export function companionState(snap: VoiceSnapshot | null | undefined, now: number): CompanionView {
  if (!snap || !snap.open) return { state: "SLEEPING", reason: "Voice session closed." };
  if (snap.error && DISCONNECT_CODES.has(snap.error.code)) return { state: "DISCONNECTED", reason: snap.error.code };
  if (snap.state === "DEVICE_UNAVAILABLE") return { state: "DISCONNECTED", reason: "DEVICE_UNAVAILABLE" };
  if (snap.state === "ERROR" || snap.error) return { state: "ERROR", reason: snap.error?.code ?? "ERROR" };
  const proposalLive = !!snap.proposal && snap.proposal.expiresAt > now;
  const clarificationLive = !!snap.clarification && snap.clarification.expiresAt > now;
  if (proposalLive || clarificationLive || snap.devices?.micPrivacy === "deny") {
    return { state: "PERMISSION", reason: proposalLive ? "proposal" : clarificationLive ? "clarification" : "microphone privacy" };
  }
  // The endpoint mute counts too, so the companion agrees with the client's voice status line.
  if (snap.muted || snap.state === "MUTED" || snap.devices?.input?.muted === true) return { state: "MUTED", reason: "Microphone muted." };
  if (snap.capturing && snap.playing) return { state: "LISTENING_WHILE_SPEAKING", reason: "Capture and playback both confirmed by the worker." };
  if (snap.playing) return { state: "SPEAKING", reason: "Playback confirmed by the worker." };
  if (snap.outputHeld) return { state: "HELD", reason: "Reply paused while you speak." };
  if (snap.state === "INTERRUPTED") return { state: "INTERRUPTED", reason: "Playback cancelled." };
  const bargeAt = snap.lastBargeIn?.outcome === "interrupted" ? snap.lastBargeIn.decidedAt ?? null : null;
  const interruptAt = snap.lastInterrupt?.requestedAt ?? null;
  // A receipt stamped after this instant (a clock step backwards) proves nothing about now, so it is not recent.
  const receipts = [bargeAt, interruptAt].filter((at): at is number => at !== null && at > 0);
  const recent = receipts.some((at) => now - at >= 0 && now - at <= COMPANION_INTERRUPT_MS);
  if (recent && snap.state !== "PROCESSING" && snap.state !== "SPEAKING") {
    return { state: "INTERRUPTED", reason: "Recent interruption receipt." };
  }
  if (snap.state === "TRANSCRIBING") return { state: "TRANSCRIBING", reason: "Finishing your words." };
  if (snap.state === "PROCESSING") {
    if (snap.timing?.admittedAt != null && snap.timing.firstTokenAt == null) return { state: "WAITING_FOR_RESPONSE", reason: "Answer admitted; no text yet." };
    return { state: "THINKING", reason: "Answer being produced." };
  }
  if (snap.state === "ARMING" || snap.duplex?.starting) return { state: "ARMING", reason: "Opening microphone." };
  const levelAge = snap.level ? now - snap.level.at : Number.NaN;
  const speakingNow = !!snap.level?.speech && levelAge >= 0 && levelAge <= COMPANION_LEVEL_FRESH_MS;
  if (snap.state === "LISTENING" || (snap.capturing && (speakingNow || !snap.duplex?.active))) return { state: "LISTENING", reason: speakingNow ? "You are speaking." : "Microphone open for this turn." };
  if (snap.capturing && snap.duplex?.active) return { state: "LISTENING", reason: "Hands-free microphone open." };
  return { state: "READY", reason: "Session open and idle." };
}
