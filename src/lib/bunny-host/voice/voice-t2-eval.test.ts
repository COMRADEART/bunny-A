/**
 * MA4-S3-T2 evaluation categories. Every case here is a simulator or a source audit.
 * None of them is a physical acoustic qualification.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { classifyTranscript, isSpokenCorrection } from "./voice-intent.ts";
import { isUnfinishedChat } from "./voice-session.server.ts";
import { VoiceTurnTaking, echoMatch, echoTokens } from "./voice-turn-taking.ts";
import { answerStatus, answerVerification, type AgentFact, type MissionFact } from "./voice-answers.server.ts";

const kind = (text: string, proposalPending = false) => classifyTranscript(text, { proposalPending }).kind;

test("T2-1 simulator: speech onset during output pauses; it does not interrupt on energy alone", () => {
  const controller = new VoiceTurnTaking();
  assert.equal(controller.decide({ kind: "speech_start", outputActive: true })?.action, "pause");
  assert.equal(controller.decide({ kind: "level", speechMs: 2_000 }), null);
  assert.equal(controller.decided, false);
});

test("T2-2 simulator: a sustained interrupt phrase cancels playback", () => {
  const controller = new VoiceTurnTaking();
  controller.decide({ kind: "level", speechMs: 200 });
  const decision = controller.decide({ kind: "partial", text: "stop", echo: false, outputActive: true });
  assert.equal(decision?.action, "interrupt");
  assert.equal(decision?.reason, "interrupt_phrase");
});

test("T2-3 simulator: yeah and mm-hmm during output are backchannels", () => {
  for (const text of ["yeah", "mm-hmm", "uh-huh"]) {
    const controller = new VoiceTurnTaking();
    controller.decide({ kind: "level", speechMs: 700 });
    const decision = controller.decide({ kind: "final", text, confidence: 0.9, echo: false, outputActive: true });
    assert.equal(decision?.action, "resume", text);
    assert.equal(decision?.reason, "backchannel");
  }
});

test("T2-4 simulator: a short burst during output resumes the held reply", () => {
  const controller = new VoiceTurnTaking();
  assert.equal(controller.decide({ kind: "speech_end", short: true, outputActive: true })?.action, "resume");
});

test("T2-5 simulator: an unfinished chat final is held; a status question is not", () => {
  assert.equal(isUnfinishedChat("I want to create a task that", false), true);
  assert.equal(isUnfinishedChat("What's my agent doing?", false), false);
});

test("T2-6 simulator: Bunny's own chunk is echo; a short stop is not", () => {
  const chunk = echoTokens("The report is ready for review now");
  assert.equal(echoMatch("the report is ready for review", [chunk], 0.6), true);
  assert.equal(echoMatch("stop", [chunk], 0.6), false);
});

test("T2-7 simulator: a correction stays chat and is marked as a correction", () => {
  assert.equal(kind("No, I meant the other file"), "chat");
  assert.equal(isSpokenCorrection("No, I meant the other file"), true);
  assert.equal(kind("Stop the agent"), "agent_control");
});

test("T2-8 simulator: device loss is an error phase input, not a silent reopen", () => {
  assert.equal(kind("end voice"), "voice_close");
});

test("T2-11 simulator: status, tests, build, and model questions use Host-fact kinds", () => {
  assert.equal(kind("What's my agent doing?"), "agent_status");
  assert.equal(kind("Did the tests pass?"), "agent_verification");
  assert.equal(kind("Is the build finished?"), "agent_verification");
  assert.equal(kind("Which model is running?"), "agent_model");
});

test("T2-11 simulator: a status answer names only the supplied Host rows", () => {
  const agents: AgentFact[] = [{ id: "a", name: "Gada", state: "RUNNING", missionId: "m", updatedAt: 1, role: "implementer", task: null }];
  const missions: MissionFact[] = [{ id: "m", title: "Notes", status: "RUNNING", updatedAt: 1, steps: [] }];
  assert.match(answerStatus(agents, missions), /Gada is running/);
  assert.match(answerStatus([], []), /No agent is running/);
  assert.match(answerVerification(null), /No agent mission is available/);
});

test("T2-12 simulator: speech cannot approve, grant, or claim a pass", () => {
  assert.equal(kind("approve it"), "sensitive_refused");
  assert.equal(kind("grant microphone access"), "sensitive_refused");
  assert.equal(kind("mark the tests passed"), "sensitive_refused");
  assert.equal(kind("stop"), "speech_stop");
});

test("T2-15 source audit: Android does not declare microphone capture", () => {
  const manifest = readFileSync(new URL("../../../../android/app/src/main/AndroidManifest.xml", import.meta.url), "utf8");
  const activity = readFileSync(new URL("../../../../android/app/src/main/java/com/routeragent/jev/MainActivity.java", import.meta.url), "utf8");
  assert.doesNotMatch(manifest, /RECORD_AUDIO|MODIFY_AUDIO_SETTINGS/);
  assert.doesNotMatch(activity, /onPermissionRequest|RECORD_AUDIO/);
  assert.match(manifest, /INTERNET/);
});
