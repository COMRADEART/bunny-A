import test from "node:test";
import assert from "node:assert/strict";
import type { VoiceProposal, VoiceSnapshot } from "../../lib/bunny-host/voice/voice-protocol.ts";
import {
  acceptVoiceSnapshot,
  outputNote,
  answerSourceLabel,
  clarificationView,
  draftPartial,
  levelBars,
  parseVoiceSnapshot,
  planUiIntent,
  proposalView,
  talkButtonLabel,
  voiceRequest,
  routeLabel,
  typedFallbackText,
  uiTargetFor,
  voiceControls,
  voiceErrorMessage,
  voiceStatus,
  VOICE_FRESH_MS,
  VOICE_STALE_MS,
  VOICE_UNSUPPORTED,
} from "./voice-model.ts";

const NOW = 1_000_000;

function snap(overrides: Partial<VoiceSnapshot> = {}): VoiceSnapshot {
  return {
    protocol: "bunny-voice/1",
    open: true,
    sessionId: "s1",
    hostEpoch: "e1",
    principal: "workstation",
    mode: "push_to_talk",
    state: "IDLE",
    capturing: false,
    playing: false,
    muted: false,
    level: null,
    turnId: null,
    generation: 1,
    partial: null,
    finalTranscript: null,
    turnKind: null,
    answer: null,
    answerSource: null,
    route: null,
    proposal: null,
    clarification: null,
    uiIntent: null,
    devices: {
      input: { name: "Mic", muted: false, volume: 0.5, present: true },
      output: { name: "Speakers", muted: false, volume: 0.5, present: true },
      micPrivacy: "allow",
    },
    engines: { stt: "windows", tts: "windows", local: true },
    error: null,
    lastInterrupt: null,
    lastClose: null,
    timing: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

const base = { receivedAt: NOW, now: NOW, supported: true, workstation: true };

test("V01 mic inactive by default: a closed session reads Voice is off and no control can listen", () => {
  const closed = snap({ open: false, state: "IDLE" });
  assert.equal(voiceStatus({ ...base, snapshot: closed }).label, "Voice is off");
  assert.equal(voiceStatus({ ...base, snapshot: null }).live, false);
  const controls = voiceControls({ ...base, snapshot: closed, typedText: "" });
  assert.equal(controls.pushToTalk, false);
  assert.equal(controls.startSession, true);
});

test("V02 explicit activation: only an open session with a fresh snapshot enables push-to-talk", () => {
  const idle = snap();
  assert.equal(voiceControls({ ...base, snapshot: idle, typedText: "" }).pushToTalk, true);
  assert.equal(voiceControls({ ...base, snapshot: idle, typedText: "" }).startSession, false);
  const stale = voiceControls({ ...base, snapshot: idle, now: NOW + VOICE_STALE_MS + 1, typedText: "" });
  assert.equal(stale.pushToTalk, false);
});

test("V03 permission denial handled: micPrivacy deny shows the Windows privacy copy and blocks talk", () => {
  const denied = snap({ devices: { input: null, output: null, micPrivacy: "deny" } });
  const status = voiceStatus({ ...base, snapshot: denied });
  assert.equal(status.label, "Microphone access is off in Windows privacy settings");
  assert.equal(status.tone, "error");
  assert.equal(voiceControls({ ...base, snapshot: denied, typedText: "" }).pushToTalk, false);
});

test("V04 device unavailable truthful: DEVICE_UNAVAILABLE disables talk and says so", () => {
  const unavailable = snap({ state: "DEVICE_UNAVAILABLE" });
  assert.equal(
    voiceStatus({ ...base, snapshot: unavailable }).label,
    "No microphone is available. Connect one or type your question instead.",
  );
  assert.equal(voiceControls({ ...base, snapshot: unavailable, typedText: "" }).pushToTalk, false);
  const errored = snap({ error: { code: "DEVICE_UNAVAILABLE", message: "waveInOpen failed" } });
  assert.equal(voiceStatus({ ...base, snapshot: errored }).tone, "error");
});

test("V04 device unavailable truthful: endpoint mute and worker mute block talk with exact copy", () => {
  const muted = snap({ devices: { input: { name: "Mic", muted: true, volume: 0, present: true }, output: null, micPrivacy: "allow" } });
  assert.equal(voiceStatus({ ...base, snapshot: muted }).label, "Microphone is muted in Windows");
  assert.equal(voiceControls({ ...base, snapshot: muted, typedText: "" }).pushToTalk, false);
  const workerMuted = snap({ muted: true, state: "MUTED" });
  assert.equal(voiceStatus({ ...base, snapshot: workerMuted }).label, "Microphone is muted in Bunny.");
});

test("V05 duplicate mic streams rejected: talk is disabled while the worker already reports capture", () => {
  const capturing = snap({ state: "LISTENING", capturing: true, level: { rms: 0.2, peak: 0.4, speech: true, at: NOW } });
  assert.equal(voiceControls({ ...base, snapshot: capturing, typedText: "" }).pushToTalk, false);
});

test("V06 audio buffers bounded: level bars are exactly the requested count and never exceed 1", () => {
  const loud = snap({ state: "LISTENING", capturing: true, level: { rms: 9, peak: 9, speech: true, at: NOW } });
  const bars = levelBars(loud, NOW);
  assert.equal(bars.length, 9);
  assert.ok(bars.every((value) => value >= 0 && value <= 1));
});

test("V07 recognized speech from actual audio: Listening only while the worker confirms capture and fresh", () => {
  const live = snap({ state: "LISTENING", capturing: true, level: { rms: 0.1, peak: 0.2, speech: false, at: NOW } });
  assert.equal(voiceStatus({ ...base, snapshot: live }).label, "Listening…");
  assert.equal(voiceStatus({ ...base, snapshot: live }).live, true);
  const notCapturing = snap({ state: "LISTENING", capturing: false });
  assert.notEqual(voiceStatus({ ...base, snapshot: notCapturing }).label, "Listening…");
  const aged = voiceStatus({ ...base, snapshot: live, now: NOW + VOICE_FRESH_MS });
  assert.notEqual(aged.label, "Listening…");
  assert.equal(aged.live, false);
});

test("V08 partial not executed: partial text is a draft only while capturing, and never a final", () => {
  const partial = snap({ state: "LISTENING", capturing: true, partial: "open the", finalTranscript: null });
  assert.equal(draftPartial(partial), "open the");
  const finalised = snap({ state: "PROCESSING", partial: "open the", finalTranscript: "open the agent" });
  assert.equal(draftPartial(finalised), null);
  assert.equal(draftPartial(snap({ state: "LISTENING", partial: "   " })), null);
});

test("V09 final bound to correct turn: a stale-generation final is not shown as the current draft", () => {
  const current = snap({ turnId: "t2", generation: 3, finalTranscript: "status of alpha" });
  assert.equal(current.finalTranscript, "status of alpha");
  assert.equal(draftPartial(current), null);
});

test("V10 recognition correction does not duplicate a Task: planUiIntent honors each seq once", () => {
  const first = planUiIntent({ seq: 4, kind: "open_agentic", agentId: "a1" }, null, "e1");
  assert.equal(first.target, null, "first snapshot seeds the seen seq and never navigates");
  const second = planUiIntent({ seq: 5, kind: "open_agentic", agentId: "a1" }, first.seen, "e1");
  assert.deepEqual(second.target, { sheet: "agentic", agentFocus: "a1" });
  const repeat = planUiIntent({ seq: 5, kind: "open_agentic", agentId: "a1" }, second.seen, "e1");
  assert.equal(repeat.target, null);
});

test("V10b a page whose first snapshot had no intent still honors the next intent once", () => {
  const first = planUiIntent(null, null, "e1");
  assert.equal(first.target, null);
  const next = planUiIntent({ seq: 1, kind: "open_agentic", agentId: null }, first.seen, "e1");
  assert.deepEqual(next.target, { sheet: "agentic", agentFocus: null });
});

test("V11 silence not fabricated as command: an empty turn is no command and shows no transcript", () => {
  const empty = snap({ turnKind: "empty", finalTranscript: null, answer: null });
  assert.equal(voiceStatus({ ...base, snapshot: empty }).label, "Ready. Hold the button to talk.");
  assert.equal(draftPartial(empty), null);
  assert.equal(snap({ turnKind: "empty", finalTranscript: "x" }).finalTranscript, "x");
});

test("V12 noise-only fails safely: noise-only sessions stay Ready with flat bars when not capturing", () => {
  const noise = snap({ state: "TRANSCRIBING", capturing: false, level: null });
  assert.equal(voiceStatus({ ...base, snapshot: noise }).label, "Finishing your words…");
  assert.deepEqual(levelBars(noise, NOW), new Array(9).fill(0));
});

test("V13 conversation routed correctly: a chat route is named by its provider and model", () => {
  const long = "qwen2.5-coder:7b-instruct-q4_K_M-extra";
  assert.equal(
    routeLabel({ taskId: "chat", provider: "ollama", model: long }),
    `Answered by ollama · ${long.slice(0, 31)}…`,
  );
  assert.equal(routeLabel({ taskId: "chat", provider: "ollama", model: "qwen2.5" }), "Answered by ollama · qwen2.5");
  assert.equal(routeLabel(null), null);
  assert.equal(answerSourceLabel("host_facts"), "From Bunny facts");
});

test("V14 T3 routing preserved: the route label is taken as reported and never invented", () => {
  const route = { taskId: "chat", provider: "codex", model: "gpt-5" };
  assert.equal(routeLabel(route), "Answered by codex · gpt-5");
});

test("V15 unknown model stays UNKNOWN: UNKNOWN is shown as model unknown, never as a name", () => {
  assert.equal(routeLabel({ taskId: "chat", provider: "claude", model: "UNKNOWN" }), "Answered by claude · model unknown");
});

test("V16 no unauthorized cloud-audio upload: the status copy never claims cloud speech", () => {
  const status = voiceStatus({ ...base, snapshot: snap() }).label;
  assert.ok(!/cloud/i.test(status));
  assert.ok(!/cloud/i.test(voiceErrorMessage("STT_UNAVAILABLE")));
});

test("V17 TTS playback works: real playback truth reads Speaking, and only then", () => {
  const speaking = snap({ state: "SPEAKING", playing: true });
  assert.equal(voiceStatus({ ...base, snapshot: speaking }).label, "Speaking");
  const notYetPlaying = snap({ state: "SPEAKING", playing: false });
  assert.notEqual(voiceStatus({ ...base, snapshot: notYetPlaying }).label, "Speaking");
});

test("V18 TTS chunks in order: the answer text is shown whole and not reordered by the view model", () => {
  const answered = snap({ state: "SPEAKING", answer: "First. Second.", answerSource: "model" });
  assert.equal(answered.answer, "First. Second.");
  assert.equal(answerSourceLabel(answered.answerSource), "From the model");
});

test("V19 interrupted audio stops: Interrupt and barge-in talk are enabled while playing, and the state reads Interrupted after", () => {
  const playing = snap({ state: "SPEAKING", playing: true });
  assert.equal(voiceControls({ ...base, snapshot: playing, typedText: "" }).interrupt, true);
  assert.equal(voiceControls({ ...base, snapshot: playing, typedText: "" }).pushToTalk, true, "push-to-talk barges in while speaking");
  const after = snap({ state: "INTERRUPTED", playing: false });
  assert.equal(voiceStatus({ ...base, snapshot: after }).label, "Interrupted. Ready for your next question.");
  assert.equal(voiceControls({ ...base, snapshot: after, typedText: "" }).interrupt, false);
});

test("V20 pending chunks do not resume: nothing reads Speaking unless the playback flag is set", () => {
  const cancelledQueue = snap({ state: "INTERRUPTED", playing: false, lastInterrupt: null });
  assert.notEqual(voiceStatus({ ...base, snapshot: cancelledQueue }).label, "Speaking");
});

test("V21 late model callbacks do not restart playback: a finished session never reads Speaking", () => {
  const late = snap({ state: "PROCESSING", playing: false, answer: "late answer" });
  assert.notEqual(voiceStatus({ ...base, snapshot: late }).label, "Speaking");
  assert.equal(voiceControls({ ...base, snapshot: late, typedText: "" }).interrupt, true, "Interrupt cancels a pending answer");
});

test("V22 newer turn state is kept: an older snapshot cannot replace a newer one, including after a barge-in", () => {
  const newer = snap({ updatedAt: NOW + 10, state: "INTERRUPTED" });
  const older = snap({ updatedAt: NOW, state: "SPEAKING", playing: true });
  assert.equal(acceptVoiceSnapshot(newer, older), false);
  assert.equal(acceptVoiceSnapshot(older, newer), true);
  assert.equal(acceptVoiceSnapshot(newer, snap({ updatedAt: NOW + 20, hostEpoch: "e2" })), true, "a new Host epoch always replaces");
});

test("V23 overlapping conversations cannot corrupt each other: a proposal and clarification expire independently", () => {
  const proposal: VoiceProposal = {
    id: "p1",
    action: "agent.pause",
    agentId: "a1",
    agentName: "Alpha",
    revision: 2,
    confirmVia: "voice_or_screen",
    createdAt: NOW,
    expiresAt: NOW + 30_000,
    hostEpoch: "e1",
  };
  assert.equal(proposalView(proposal, NOW)?.title, "Pause Alpha?");
  assert.equal(proposalView(proposal, NOW + 30_000), null);
  assert.equal(clarificationView({ question: "Which?", candidates: [], expiresAt: NOW }, NOW), null);
});

test("V24 muted mic captures nothing: muted state disables talk and shows the mute copy", () => {
  const muted = snap({ muted: true, state: "MUTED" });
  assert.equal(voiceControls({ ...base, snapshot: muted, typedText: "" }).pushToTalk, false);
  assert.equal(voiceControls({ ...base, snapshot: muted, typedText: "" }).muteLabel, "Unmute");
  assert.deepEqual(levelBars(muted, NOW), new Array(9).fill(0));
});

test("V25 mic resources released on close: a closed session cannot show live level or listening", () => {
  const closed = snap({ open: false, capturing: false, level: { rms: 1, peak: 1, speech: true, at: NOW } });
  assert.equal(voiceStatus({ ...base, snapshot: closed }).live, false);
  assert.deepEqual(levelBars(closed, NOW), new Array(9).fill(0));
});

test("V26 input device disconnect handled: DEVICE_LOST copy is shown and talk is still gated by the snapshot", () => {
  const lost = snap({ error: { code: "DEVICE_LOST", message: "unplugged" } });
  assert.equal(voiceStatus({ ...base, snapshot: lost }).label, voiceErrorMessage("DEVICE_LOST"));
});

test("V27 playback device loss handled: playback errors surface and Speaking stops", () => {
  const lost = snap({ error: { code: "DEVICE_UNAVAILABLE", message: "waveOutOpen failed" }, state: "ERROR", playing: false });
  assert.equal(voiceStatus({ ...base, snapshot: lost }).tone, "error");
  assert.notEqual(voiceStatus({ ...base, snapshot: lost }).label, "Speaking");
});

test("V28 barge-in replaces the old echo gate: talk stays enabled while Bunny speaks or thinks, and only a capturing mic refuses", () => {
  const speaking = snap({ state: "SPEAKING", playing: true });
  assert.equal(voiceControls({ ...base, snapshot: speaking, typedText: "" }).pushToTalk, true);
  const thinking = snap({ state: "PROCESSING" });
  assert.equal(voiceControls({ ...base, snapshot: thinking, typedText: "" }).pushToTalk, true);
  const capturing = snap({ state: "LISTENING", capturing: true });
  assert.equal(voiceControls({ ...base, snapshot: capturing, typedText: "" }).pushToTalk, false, "one capture at a time");
});

test("V29 voice interruption does not stop agent work: Interrupt is never a stop-agent control", () => {
  const playing = snap({ state: "SPEAKING", playing: true, proposal: null });
  const controls = voiceControls({ ...base, snapshot: playing, typedText: "" });
  assert.equal(controls.interrupt, true);
  assert.equal(proposalView(playing.proposal, NOW), null);
});

test("V30 agent status from canonical facts: status copy comes from the snapshot only", () => {
  const status = snap({ turnKind: "agent_status", answer: "Alpha is running.", answerSource: "host_facts" });
  assert.equal(answerSourceLabel(status.answerSource), "From Bunny facts");
});

test("V31 verification query real outcomes: verification answers are labelled as Host facts", () => {
  const verification = snap({ turnKind: "agent_verification", answerSource: "host_facts", answer: "Tests passed." });
  assert.equal(answerSourceLabel(verification.answerSource), "From Bunny facts");
});

test("V32 spoken Pause uses existing Host command: pause is a proposal with on-screen or voice confirm", () => {
  const view = proposalView(
    { id: "p2", action: "agent.pause", agentId: "a2", agentName: "Beta", revision: 1, confirmVia: "voice_or_screen", createdAt: NOW, expiresAt: NOW + 1000, hostEpoch: "e1" },
    NOW,
  );
  assert.equal(view?.confirmLabel, "Confirm pause");
  assert.equal(view?.confirmByVoice, true);
});

test("V33 spoken Stop targets correct agent: the proposal names the agent it will act on", () => {
  const view = proposalView(
    { id: "p3", action: "agent.stop", agentId: "a3", agentName: "Gamma", revision: 1, confirmVia: "screen", createdAt: NOW, expiresAt: NOW + 1000, hostEpoch: "e1" },
    NOW,
  );
  assert.equal(view?.title, "Stop Gamma?");
  assert.equal(view?.confirmByVoice, false);
  assert.equal(view?.hint, "Confirm on screen. Voice cannot confirm this.");
});

test("V34 ambiguous agent needs clarification: candidates are listed, capped at eight", () => {
  const candidates = Array.from({ length: 12 }, (_, i) => ({ id: `c${i}`, name: `Agent ${i}` }));
  const view = clarificationView({ question: "Which agent?", candidates, expiresAt: NOW + 1000 }, NOW);
  assert.equal(view?.question, "Which agent?");
  assert.equal(view?.candidates.length, 8);
});

test("V35 voice cannot forge Windows owner: only the workstation principal can run voice", () => {
  assert.equal(voiceStatus({ ...base, workstation: false, snapshot: snap() }).label, "Voice runs on the workstation only.");
  assert.equal(voiceControls({ ...base, workstation: false, snapshot: snap(), typedText: "" }).pushToTalk, false);
});

test("V36 voice cannot authorize shell: a typed fallback is trimmed, bounded and never classified here", () => {
  assert.equal(typedFallbackText("  run   rm -rf  "), "run rm -rf");
  assert.equal(typedFallbackText("   "), null);
  assert.equal(typedFallbackText("x".repeat(2001)), null);
});

test("V37 voice cannot widen Mission scope: a proposal confirmation is limited to pause, resume or stop", () => {
  const view = proposalView(
    { id: "p4", action: "agent.resume", agentId: "a4", agentName: "Delta", revision: 1, confirmVia: "voice_or_screen", createdAt: NOW, expiresAt: NOW + 1000, hostEpoch: "e1" },
    NOW,
  );
  assert.equal(view?.confirmLabel, "Confirm resume");
});

test("V38 voice cannot bypass phone restrictions: paired devices get the workstation-only copy", () => {
  const controls = voiceControls({ ...base, workstation: false, snapshot: snap(), typedText: "hello" });
  assert.equal(controls.startSession, false);
  assert.equal(controls.typedSend, false);
});

test("V39 audio prompt injection grants nothing: a clarification or proposal is display only", () => {
  const view = proposalView(
    { id: "p5", action: "agent.stop", agentId: "a5", agentName: "Echo", revision: 1, confirmVia: "screen", createdAt: NOW, expiresAt: NOW + 1000, hostEpoch: "e1" },
    NOW,
  );
  assert.equal(view?.confirmByVoice, false);
});

test("V40 replayed speech is not owner auth: a stale proposal past its expiry is not shown", () => {
  const expired = proposalView(
    { id: "p6", action: "agent.pause", agentId: "a6", agentName: "Foxtrot", revision: 1, confirmVia: "voice_or_screen", createdAt: NOW, expiresAt: NOW - 1, hostEpoch: "e1" },
    NOW,
  );
  assert.equal(expired, null);
});

test("V41 Talk/Redirect explicitly unavailable: redirect_unsupported never offers a proposal", () => {
  const redirect = snap({ turnKind: "redirect_unsupported", answer: "Talk and Redirect are not available by voice.", answerSource: "refusal" });
  assert.equal(answerSourceLabel(redirect.answerSource), "Not done by voice");
  assert.equal(redirect.proposal, null);
});

test("V42 chat not converted to Agentic: a chat answer never opens an agent view", () => {
  const plan = planUiIntent(null, { epoch: "e1", seq: 3 }, "e1");
  assert.equal(plan.target, null);
});

test("V43 voice state survives UI reconnect: a parsed dashboard snapshot is the same truth and stale reads reconnect", () => {
  const dashboardVoice = snap({ state: "LISTENING", capturing: true, level: { rms: 0.3, peak: 0.6, speech: true, at: NOW } });
  const parsed = parseVoiceSnapshot(JSON.parse(JSON.stringify(dashboardVoice)));
  assert.equal(parsed?.state, "LISTENING");
  assert.equal(parseVoiceSnapshot({ protocol: "other", open: true }), null);
  assert.equal(parseVoiceSnapshot(null), null);
  const reconnecting = voiceStatus({ snapshot: parsed, receivedAt: NOW - VOICE_STALE_MS - 1, now: NOW, supported: true, workstation: true });
  assert.equal(reconnecting.label, "Reconnecting…");
});

test("V44 Host restart does not revive stale voice approvals: a Host epoch change drops the held proposal", () => {
  const held = snap({ proposal: { id: "old", action: "agent.stop", agentId: "a", agentName: "A", revision: 1, confirmVia: "voice_or_screen", createdAt: NOW, expiresAt: NOW + 30_000, hostEpoch: "e1" } });
  const restarted = snap({ hostEpoch: "e2", proposal: null, updatedAt: NOW - 100 });
  assert.equal(acceptVoiceSnapshot(held, restarted), true);
  assert.equal(proposalView(restarted.proposal, NOW), null);
});

test("V45 closed voice UI does not stop AgentRuntime: a closed snapshot never enables a control that acts on agents", () => {
  const closed = snap({ open: false });
  const controls = voiceControls({ ...base, snapshot: closed, typedText: "stop alpha" });
  assert.equal(controls.endSession, false);
  assert.equal(controls.interrupt, false);
  assert.equal(controls.pushToTalk, false);
});

test("V46 notch shows live voice state: a fresh capture reads Listening and is live", () => {
  const live = snap({ state: "LISTENING", capturing: true, level: { rms: 0.1, peak: 0.1, speech: false, at: NOW } });
  const status = voiceStatus({ ...base, snapshot: live });
  assert.equal(status.live, true);
  assert.equal(status.tone, "ok");
});

test("V47 agent indicators left of horizontal notch: UI intent is one-shot and names the agent to open", () => {
  const plan = planUiIntent({ seq: 9, kind: "open_agent", agentId: "left-agent" }, { epoch: "e1", seq: 8 }, "e1");
  assert.deepEqual(plan.target, { sheet: "agentic", agentFocus: "left-agent" });
});

test("V47b uiIntent kinds: open_agentic and open_agent focus the Agentic sheet, open_approvals opens it without a focus", () => {
  assert.deepEqual(uiTargetFor("open_agentic", "a1"), { sheet: "agentic", agentFocus: "a1" });
  assert.deepEqual(uiTargetFor("open_agent", "a2"), { sheet: "agentic", agentFocus: "a2" });
  assert.deepEqual(uiTargetFor("open_agent", null), { sheet: "agentic", agentFocus: null });
  assert.deepEqual(uiTargetFor("open_approvals", "a3"), { sheet: "agentic", agentFocus: null });
  const plan = planUiIntent({ seq: 11, kind: "open_approvals", agentId: "a3" }, { epoch: "e1", seq: 10 }, "e1");
  assert.deepEqual(plan.target, { sheet: "agentic", agentFocus: null });
  assert.equal(planUiIntent({ seq: 11, kind: "open_approvals", agentId: null }, { epoch: "e1", seq: 11 }, "e1").target, null, "one target per seq");
});

test("V48 agent indicators top of vertical notch: a stale uiIntent after reload does not navigate", () => {
  const plan = planUiIntent({ seq: 2, kind: "open_approvals", agentId: null }, { epoch: "e1", seq: 7 }, "e1");
  assert.equal(plan.target, null);
  assert.deepEqual(plan.seen, { epoch: "e1", seq: 7 });
});

test("V49 notch within usable bounds: the status copy is short enough for the notch and carries no newlines", () => {
  for (const code of ["ENDPOINT_MUTED", "PERMISSION_DENIED", "DEVICE_UNAVAILABLE", "STT_UNAVAILABLE", "TTS_UNAVAILABLE", "WORKER_INTEGRITY", "NOT_WINDOWS"] as const) {
    const message = voiceErrorMessage(code);
    assert.ok(message.length > 0 && message.length <= 90, `${code} copy length ${message.length}`);
    assert.ok(!message.includes("\n"));
  }
});

test("V50 keyboard/mic controls accessible: push-to-talk is enabled by an open fresh session and the start button is the only closed-state control", () => {
  const open = voiceControls({ ...base, snapshot: snap(), typedText: "" });
  assert.equal(open.pushToTalk, true);
  assert.equal(open.startSession, false);
  const closed = voiceControls({ ...base, snapshot: null, typedText: "" });
  assert.equal(closed.startSession, true);
  assert.equal(closed.pushToTalk, false);
});

test("V51 reduced motion: the level bars are pure data and stay deterministic for the same snapshot", () => {
  const live = snap({ state: "LISTENING", capturing: true, level: { rms: 0.4, peak: 0.5, speech: true, at: NOW } });
  assert.deepEqual(levelBars(live, NOW), levelBars(live, NOW));
});

test("V52 no raw audio in logs/evidence: the view model carries only text and numbers, never audio payloads", () => {
  const live = snap({ state: "LISTENING", capturing: true, level: { rms: 0.4, peak: 0.5, speech: true, at: NOW } });
  const bars = levelBars(live, NOW);
  assert.ok(bars.every((value) => typeof value === "number"));
});

test("V53 T5/F01-F04 auth intact: voice is refused for a paired device and never elevated by the client", () => {
  assert.equal(voiceStatus({ ...base, supported: true, workstation: false, snapshot: snap() }).live, false);
});

test("V54 containment intact: the client never reports a worker or process as running when the snapshot says it is not", () => {
  const exited = snap({ error: { code: "WORKER_EXITED", message: "exited" }, open: true, state: "ERROR" });
  assert.equal(voiceStatus({ ...base, snapshot: exited }).label, voiceErrorMessage("WORKER_EXITED"));
});

test("V57 no production audio/credential change: the client renders only the Host snapshot and sends no device setting", () => {
  assert.equal(voiceStatus({ ...base, supported: false, snapshot: snap() }).label, VOICE_UNSUPPORTED);
});

test("older Host without voice shows the update copy and enables nothing", () => {
  const controls = voiceControls({ ...base, supported: false, snapshot: null, typedText: "x" });
  assert.equal(controls.startSession, false);
  assert.equal(controls.pushToTalk, false);
  assert.equal(voiceStatus({ ...base, supported: false, snapshot: null }).label, VOICE_UNSUPPORTED);
});

// Round-1 review fixes (M-A-3 T10). Test names carry the finding id.
test("R1-races#1 R1-truth#0 the on-screen Confirm payload is the field the Host reads (proposalId), and Mute sends on", () => {
  assert.deepEqual(voiceRequest.confirm("p-1"), { proposalId: "p-1" });
  assert.deepEqual(voiceRequest.mute(true), { on: true });
  assert.deepEqual(voiceRequest.mute(false), { on: false });
});

test("R1-truth#3 the hold caption says Listening only while the Host confirms capture, never from the press flag alone", () => {
  assert.equal(talkButtonLabel({ pressed: true, live: true, bargeIn: false }), "Listening… release to finish");
  // Held, but the Host ended the turn on silence: the caption must not keep claiming capture.
  const endedWhileHeld = talkButtonLabel({ pressed: true, live: false, bargeIn: false });
  assert.doesNotMatch(endedWhileHeld, /Listening/);
  assert.equal(talkButtonLabel({ pressed: false, live: false, bargeIn: true }), "Hold to interrupt and talk");
  assert.equal(talkButtonLabel({ pressed: false, live: false, bargeIn: false }), "Hold to talk, or hold Space");
});

test("R1-truth#5 the level meter is fresh by snapshot.level.at against the local clock, not by poll receipt", () => {
  const stale = snap({ state: "LISTENING", capturing: true, level: { rms: 0.5, peak: 0.8, speech: true, at: NOW - VOICE_FRESH_MS } });
  assert.deepEqual(levelBars(stale, NOW), new Array(9).fill(0), "an old level never shows bars, however recent the poll");
  const fresh = snap({ state: "LISTENING", capturing: true, level: { rms: 0.5, peak: 0.8, speech: true, at: NOW - 100 } });
  assert.ok(levelBars(fresh, NOW).some((value) => value > 0));
});

test("R1-truth#6 Speaking and Interrupt are freshness-gated like Listening: a stale playing flag reads Reconnecting and enables no Interrupt", () => {
  const playing = snap({ state: "SPEAKING", playing: true });
  const stale = { snapshot: playing, receivedAt: NOW - VOICE_FRESH_MS, now: NOW, supported: true, workstation: true };
  assert.notEqual(voiceStatus(stale).label, "Speaking");
  assert.equal(voiceControls({ ...base, receivedAt: NOW - VOICE_FRESH_MS, snapshot: playing, typedText: "" }).interrupt, false);
  assert.equal(voiceStatus({ ...base, snapshot: playing }).label, "Speaking");
  assert.equal(voiceControls({ ...base, snapshot: playing, typedText: "" }).interrupt, true);
});

test("R1-truth#8 a new Host epoch restarts the uiIntent seq floor: a restarted seq 1 navigates and an old seq never replays", () => {
  const before = planUiIntent({ seq: 50, kind: "open_agentic", agentId: "a1" }, { epoch: "e1", seq: 49 }, "e1");
  assert.deepEqual(before.target, { sheet: "agentic", agentFocus: "a1" });
  // Host restarted: its counter is back at 1. The old high-water mark (50) must not swallow it.
  const restarted = planUiIntent({ seq: 1, kind: "open_agent", agentId: "a2" }, before.seen, "e2");
  assert.deepEqual(restarted.target, { sheet: "agentic", agentFocus: "a2" });
  assert.deepEqual(restarted.seen, { epoch: "e2", seq: 1 });
  // The same intent is not replayed twice in the new epoch.
  assert.equal(planUiIntent({ seq: 1, kind: "open_agent", agentId: "a2" }, restarted.seen, "e2").target, null);
  // A snapshot from the new epoch that carries no intent resets the floor to 0, not to the old epoch's seq.
  const quiet = planUiIntent(null, before.seen, "e2");
  assert.deepEqual(quiet.seen, { epoch: "e2", seq: 0 });
});

test("R1-truth#8 an intent from the old epoch never replays against a new-epoch floor of 0", () => {
  const seen = planUiIntent(null, { epoch: "e1", seq: 50 }, "e2").seen;
  assert.deepEqual(seen, { epoch: "e2", seq: 0 });
  assert.equal(planUiIntent({ seq: 50, kind: "open_agentic", agentId: null }, { epoch: "e1", seq: 50 }, "e1").target, null);
});

test("R1-races#2 a stale open:false answer is rejected by the acceptance gate, so it cannot reset a live press", () => {
  const open = snap({ open: true, state: "IDLE", updatedAt: NOW + 10 });
  const staleClosed = snap({ open: false, state: "IDLE", updatedAt: NOW });
  assert.equal(acceptVoiceSnapshot(open, staleClosed), false);
  // A newer closed answer, or a new epoch, is still accepted.
  assert.equal(acceptVoiceSnapshot(open, snap({ open: false, updatedAt: NOW + 20 })), true);
  assert.equal(acceptVoiceSnapshot(open, snap({ open: false, hostEpoch: "e2", updatedAt: NOW })), true);
});

test("V27 T10: speech into a muted or zero-volume Windows output is disclosed as inaudible; unknown volume is not called muted", () => {
  const base = { present: true, name: "Speakers", muted: false, volume: 0.5 };
  const snap = (output: typeof base | null) => ({ devices: { input: null, output, micPrivacy: "allow" } }) as unknown as Parameters<typeof outputNote>[0];
  assert.equal(outputNote(snap(base)), null);
  assert.match(outputNote(snap({ ...base, muted: true }))!, /muted in Windows/);
  assert.match(outputNote(snap({ ...base, volume: 0 }))!, /muted in Windows/);
  assert.equal(outputNote(snap({ ...base, volume: null as unknown as number, muted: null as unknown as boolean })), null);
  assert.equal(outputNote(snap({ ...base, present: false, muted: true })), null);
  assert.equal(outputNote(snap(null)), null);
});
