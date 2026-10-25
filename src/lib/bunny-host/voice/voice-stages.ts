/**
 * MA4-S3-T2: stage deltas from the stamps a voice turn already records.
 * A missing or reversed stamp stays null. This module does not invent a measurement.
 */
import type { VoiceTiming } from "./voice-protocol.ts";

export type VoiceStageName =
  | "activationToFirstAudio"
  | "speechEndToFinal"
  | "finalToAdmitted"
  | "admittedToFirstToken"
  | "firstTokenToFirstTts"
  | "firstTtsToPlayback"
  | "speechEndToFirstPlayback"
  | "admittedToInferenceDone";

export type VoiceStageSample = {
  stage: VoiceStageName;
  ms: number | null;
  from: keyof VoiceTiming;
  to: keyof VoiceTiming;
};

/**
 * Budgets registered before the MA4-S3-T2 measurement run. They are not results.
 * Interrupt-to-silence is a worker receipt, not a stamp on VoiceTiming, so it is listed here only.
 */
export const VOICE_STAGE_BUDGETS_MS = {
  activationToFirstAudio: 400,
  speechEndToFinal: 1_500,
  finalToAdmitted: 100,
  interruptToSilence: 250,
} as const;

function delta(from: number | null | undefined, to: number | null | undefined): number | null {
  if (from == null || to == null) return null;
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return null;
  return Math.round(to - from);
}

/** One row per pipeline stage. `ms` is null when either stamp was not recorded. */
export function voiceStageTrace(timing: VoiceTiming | null | undefined): VoiceStageSample[] {
  const stamp = (stage: VoiceStageName, from: keyof VoiceTiming, to: keyof VoiceTiming): VoiceStageSample => ({
    stage,
    from,
    to,
    ms: timing ? delta(timing[from] as number | null, timing[to] as number | null) : null,
  });
  return [
    stamp("activationToFirstAudio", "activatedAt", "firstAudioAt"),
    stamp("speechEndToFinal", "speechEndAt", "finalAt"),
    stamp("finalToAdmitted", "finalAt", "admittedAt"),
    stamp("admittedToFirstToken", "admittedAt", "firstTokenAt"),
    stamp("firstTokenToFirstTts", "firstTokenAt", "firstTtsReadyAt"),
    stamp("firstTtsToPlayback", "firstTtsReadyAt", "firstPlaybackAt"),
    stamp("speechEndToFirstPlayback", "speechEndAt", "firstPlaybackAt"),
    stamp("admittedToInferenceDone", "admittedAt", "inferenceCompletedAt"),
  ];
}
