import test from "node:test";
import assert from "node:assert/strict";
import { VOICE_STAGE_BUDGETS_MS, voiceStageTrace } from "./voice-stages.ts";
import type { VoiceTiming } from "./voice-protocol.ts";

const timing = (over: Partial<VoiceTiming> = {}): VoiceTiming => ({
  turnId: "t1",
  activatedAt: 1_000,
  captureStartedAt: 1_020,
  firstAudioAt: 1_080,
  firstPartialAt: 1_400,
  speechEndAt: 2_000,
  finalAt: 2_220,
  admittedAt: 2_250,
  firstTokenAt: 2_900,
  firstTtsReadyAt: 3_050,
  firstPlaybackAt: 3_180,
  inferenceCompletedAt: 4_000,
  completedAt: 5_000,
  ...over,
});

test("T2 stage trace: each stamp pair is a millisecond delta, and a missing stamp stays null", () => {
  const rows = voiceStageTrace(timing());
  const ms = Object.fromEntries(rows.map((row) => [row.stage, row.ms]));
  assert.equal(ms.activationToFirstAudio, 80);
  assert.equal(ms.speechEndToFinal, 220);
  assert.equal(ms.finalToAdmitted, 30);
  assert.equal(ms.admittedToFirstToken, 650);
  assert.equal(ms.firstTokenToFirstTts, 150);
  assert.equal(ms.firstTtsToPlayback, 130);
  assert.equal(ms.speechEndToFirstPlayback, 1_180);
  assert.equal(ms.admittedToInferenceDone, 1_750);
  const missing = voiceStageTrace(timing({ firstTokenAt: null, firstPlaybackAt: null }));
  assert.equal(missing.find((row) => row.stage === "admittedToFirstToken")?.ms, null);
  assert.equal(missing.find((row) => row.stage === "speechEndToFirstPlayback")?.ms, null);
  assert.equal(voiceStageTrace(null).every((row) => row.ms === null), true);
});

test("T2 stage trace: a reversed clock does not become a negative latency", () => {
  const rows = voiceStageTrace(timing({ finalAt: 3_000, admittedAt: 2_000 }));
  assert.equal(rows.find((row) => row.stage === "finalToAdmitted")?.ms, null);
});

test("T2 budgets were registered as constants and are not derived from a sample", () => {
  assert.deepEqual(VOICE_STAGE_BUDGETS_MS, {
    activationToFirstAudio: 400,
    speechEndToFinal: 1_500,
    finalToAdmitted: 100,
    interruptToSilence: 250,
  });
});
