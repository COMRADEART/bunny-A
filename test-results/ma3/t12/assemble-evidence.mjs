// M-A-3 T12 evidence assembly. Derives the named result files from the recorded live sessions (live/), the probes and the
// regression logs (regression/). Nothing is invented: every number below is computed from a recorded file, and a missing input
// is written as NOT TESTED with the reason. Usage: node --experimental-strip-types test-results/ma3/t12/assemble-evidence.mjs
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { summarize, stats } from "./live/lib.mjs";

const ev = resolve(import.meta.dirname);
const read = (rel) => (existsSync(join(ev, rel)) ? JSON.parse(readFileSync(join(ev, rel), "utf8")) : null);
const save = (name, value) => writeFileSync(join(ev, name), JSON.stringify(value, null, 2) + "\n");
const NOT = (reason) => ({ result: "NOT TESTED", reason });
const TARGET = { typicalOnsetToSilenceMs: 400, p95OnsetToSilenceMs: 750 };

const bargein = read("live/human-bargein-2.json"), backchannel = read("live/human-backchannel-1.json"), endurance = read("live/human-endurance-1.json");
const phone = read("live/phone-hostile-1.json"), selfSpeech = read("live/agent-speech-2.json"), selfSpeechRun1 = read("live/agent-speech-1.json");
const selfTrigger = read("self-trigger-prevention.json"), echo = read("acoustic-echo-results.json"), doubletalk = read("live/synthetic-doubletalk-1.json");
const sessions = { "human-bargein-2": bargein, "human-backchannel-1": backchannel, "human-endurance-1": endurance };
const summaryOf = (r) => summarize(r, (r.trials ?? []).filter((t) => !t.error), (r.trials ?? []).filter((t) => !t.error).map((t) => t.bargeIn).filter(Boolean), null);

// ── barge-in latency: one receipt per acoustic onset; only pauses applied while Bunny was audible are perceived latency ──
const receipts = [];
for (const [name, r] of Object.entries(sessions)) {
  if (!r) continue;
  const byOnset = new Map();
  for (const x of r.recording.bargeIns) byOnset.set(x.onsetMono ?? x.inputTurnId, x);
  for (const x of byOnset.values()) receipts.push({ session: name, ...x });
}
const audible = receipts.filter((x) => x.wasAudible === true);
const onset = stats(audible.map((x) => x.onsetToSilenceMs)), detect = stats(audible.map((x) => x.detectionToSilenceMs));
save("barge-in-latency.json", {
  classification: "LIVE human speech, real laptop microphone and speakers, Windows Voice Capture DSP AEC, disposable Host",
  definition: {
    onsetToSilenceMs: "worker-monotonic time from the first loud frame of the user's speech to the render meter reading silent",
    detectionToSilenceMs: "worker-monotonic time from the onset decision to the render meter reading silent",
    audibleOnly: "a receipt counts only when the render meter read Bunny audible when the pause was applied (wasAudible true); a pause applied before any sound played is a pre-audio hold and is reported separately",
    dedupe: "one receipt per acoustic onset (a pending receipt is superseded by its decision)",
  },
  target: TARGET,
  combined: { audibleBargeIns: audible.length, onsetToSilenceMs: onset, detectionToSilenceMs: detect,
    meetsTarget: onset.n > 0 && onset.p50 < TARGET.typicalOnsetToSilenceMs && onset.p95 <= TARGET.p95OnsetToSilenceMs },
  preAudioHolds: { n: receipts.filter((x) => x.wasAudible === false).length, pauseAppliedMs: stats(receipts.filter((x) => x.wasAudible === false).map((x) => x.detectionToSilenceMs)),
    note: "the user began speaking while Bunny was still preparing its reply; nothing was audible, so this is not a perceived stop latency" },
  unmeasured: receipts.filter((x) => x.wasAudible == null).length,
  perSession: Object.fromEntries(Object.entries(sessions).filter(([, r]) => r).map(([k, r]) => [k, summaryOf(r)])),
  receipts: receipts.map((x) => ({ session: x.session, outcome: x.outcome, reason: x.reason, wasAudible: x.wasAudible ?? null, onsetToSilenceMs: x.onsetToSilenceMs ?? null, detectionToSilenceMs: x.detectionToSilenceMs ?? null, echoRejected: x.echoRejected ?? 0 })),
});

// ── interruptions: false (Bunny stopped without a real interruption) and missed (a real interruption did not stop Bunny) ──
const trialRows = (bargein?.trials ?? []).map((t) => ({ i: t.i, outcome: t.bargeIn?.outcome ?? (t.finishedWithoutBargeIn ? "no_barge_in" : "none"), reason: t.bargeIn?.reason ?? null, heard: t.newTurn?.final ?? null, kind: t.newTurn?.kind ?? null, staleResumed: !!t.staleResumed }));
const count = (rows, o) => rows.filter((r) => r.outcome === o).length;
save("interruption-results.json", {
  classification: "LIVE human speech over Bunny's real speaker output (disposable Host)",
  bargeInTrials: { source: "live/human-bargein-2.json", trials: trialRows.length, interrupted: count(trialRows, "interrupted"), resumed: count(trialRows, "resumed"), noBargeIn: count(trialRows, "no_barge_in"), staleResumed: trialRows.filter((r) => r.staleResumed).length, rows: trialRows,
    missedInterruptions: { lowerBound: 0, upperBound: count(trialRows, "resumed") + count(trialRows, "no_barge_in"),
      note: "the user was asked to interrupt with a real question in every trial; whether the user actually spoke in the no_barge_in trials, and asked a real question in the resumed ones, was asked but not answered, so these are bounds, not a rate" } },
  backchannel: backchannel ? { source: "live/human-backchannel-1.json", pauses: summaryOf(backchannel).bargeIns, interrupted: summaryOf(backchannel).interrupted, resumed: summaryOf(backchannel).resumed,
    falseInterruptions: summaryOf(backchannel).interrupted, note: "the user said short backchannels (mm-hmm, okay, right) while Bunny spoke; every pause resumed the same reply" } : NOT("no backchannel session"),
  bunnyAlone: selfTrigger ? (() => {
    // Trial 0 recorded the user's own conversation in the room (six human finals); it is excluded as human-contaminated.
    const clean = selfTrigger.trials.filter((t) => t.i !== 0);
    return { source: "self-trigger-prevention.json", classification: selfTrigger.classification, cleanTrials: clean.length,
      speechSeconds: Math.round(clean.reduce((s, t) => s + (t.endedAt - t.startedAt), 0) / 1000),
      pauses: clean.reduce((s, t) => s + t.pauses, 0), interrupts: clean.reduce((s, t) => s + t.interrupts, 0), routedUserFinals: clean.reduce((s, t) => s + t.routedUserFinals.length, 0),
      excluded: { trial: 0, reason: "human speech present (the user's own conversation was transcribed)", finals: selfTrigger.trials.find((t) => t.i === 0)?.routedUserFinals?.length ?? null } };
  })() : NOT("no self-trigger run"),
  endurance: endurance ? { source: "live/human-endurance-1.json", ...summaryOf(endurance) } : NOT("no endurance session"),
});

// ── endurance ──
if (endurance) {
  const res = endurance.resources ?? [];
  const workers = res.flatMap((x) => x.workers.map((w) => ({ at: x.at, ws: w.ws, handles: w.handles, threads: w.threads })));
  const turns = endurance.recording.turns;
  save("voice-endurance-results.json", {
    classification: "LIVE supervised human conversation, hands-free on the real microphone and speakers, real Agent teams on a disposable Host",
    durationMin: summaryOf(endurance).durationMin,
    spokenTurns: turns.length, aim: "30+ turns (brief); 23 were recorded", turnKinds: turns.reduce((m, t) => ((m[t.turnKind ?? "none"] = (m[t.turnKind ?? "none"] ?? 0) + 1), m), {}),
    turns: turns.map((t) => ({ heard: t.final, kind: t.turnKind, answerSource: t.answerSource ?? null, answer: (t.answer ?? "").slice(0, 160) })),
    bargeIns: summaryOf(endurance),
    resources: { samples: res.length, voiceWorker: workers.length ? { first: workers[0], last: workers.at(-1), maxWs: Math.max(...workers.map((w) => w.ws)), maxHandles: Math.max(...workers.map((w) => w.handles)), maxThreads: Math.max(...workers.map((w) => w.threads)) } : null,
      hostWorkingSet: { first: res[0]?.hostWorkingSet ?? null, last: res.at(-1)?.hostWorkingSet ?? null, note: "the Host also ran up to nine real Agent teams in this session" } },
    afterClose: { voiceWorkerPids: endurance.workerPidsAfterVoiceClose, agentsAfterClose: endurance.agentsAfterClose?.agents?.length ?? null, agentStates: (endurance.agentsAfterClose?.agents ?? []).reduce((m, a) => ((m[a.state] = (m[a.state] ?? 0) + 1), m), {}), agenticReopen: endurance.agenticReopen, workerPidsAfterHostStop: endurance.workerPidsAfterHostStop },
    closedBy: "the user's spoken \"End voice now\" did not end voice at the time (gap fixed in 35dc893); the operator closed the session through the Host API at the user's request",
    defectsFoundAndFixed: [
      "duplex end-of-turn trusted whisper's trailing full stop: a hesitation split one request into two turns (35dc893)",
      "\"is any task running\" / \"whether the task is done\" reached chat instead of Host facts (35dc893)",
      "\"End voice now\" reached the chat model, which answered \"Done.\" (35dc893: spoken voice_close + action-claim guard)",
      "\"Open notes ... save it on desktop\" reached the tool-free chat model (35dc893: fixed computer-action answer)",
      "after an idle release the snapshot said LISTENING with capturing false; a restarted lane kept the old stop receipt (35dc893)",
      "spoken Agent-model answers read the whole long Mission objective (35dc893: opening words only)",
    ],
  });
}

// ── hostile and agent-generated speech ──
save("hostile-audio-results.json", {
  recordedSpeech: phone ? { source: "live/phone-hostile-1.json", classification: phone.classification, phone: phone.phone, clips: phone.steps.length, heard: phone.invariants.heardClips, unexpectedKinds: phone.invariants.unexpectedKinds, violations: phone.invariants.violations, rows: phone.steps.map((s) => ({ clip: s.clip, heard: s.heard, kind: s.kind, answer: s.answer, proposal: s.proposal, violations: s.violations })), workerPidsAfterClose: phone.workerPidsAfterClose } : NOT("no phone run"),
  agentGeneratedSpeech: selfSpeech ? { source: "live/agent-speech-2.json", classification: selfSpeech.classification, summary: selfSpeech.summary, trials: selfSpeech.trials.map((t) => ({ bunnySaid: t.bunnySaid, proposal: t.proposal ? { action: t.proposal.action, confirmVia: t.proposal.confirmVia } : null, spokenTurnsHeard: t.spokenTurnsHeard, agentBefore: t.agentBefore, agentAfter: t.agentAfter, executed: t.executed })) } : NOT("no agent-speech run"),
  agentGeneratedSpeechRun1: selfSpeechRun1 ? { source: "live/agent-speech-1.json", status: "EXCLUDED (contaminated): no proposal was created (role names do not resolve), and room speech (\"Don't worry about it\") was heard during the run; it is kept for transparency, not as evidence either way", summary: selfSpeechRun1.summary } : null,
  syntheticPhoneTalker: "SAPI clips played from the phone speaker are synthetic; they stand in for recorded and agent-generated speech, not for a human attacker",
});

// ── live human re-checks of the post-endurance fixes ──
const recheck1 = read("live/live-recheck-1.json"), recheck2 = read("live/live-recheck-2.json"), recheckJournal = read("live/live-recheck-2-journal.json");
save("live-recheck-results.json", {
  classification: "LIVE human speech, hands-free on the real microphone and speakers, disposable Host",
  runs: [recheck1, recheck2].filter(Boolean).map((r, i) => ({ source: `live/live-recheck-${i + 1}.json`, turns: r.turns.map((t) => ({ heard: t.heard, kind: t.kind, answer: (t.answer ?? "").slice(0, 160) })), closedBy: r.closedBy?.source ?? null, voiceMissions: r.voiceMissions, workerPidsAfterClose: r.workerPidsAfterClose })),
  fragmentJoinExercisedLive: recheckJournal ? recheckJournal.events.some((e) => /unfinished spoken sentence/.test(e.detail)) : null,
  findings: [
    "spoken 'End voice, please.' closed voice in both runs (voice_command), no worker left",
    "computer action got the fixed answer; status question answered from Host facts",
    "run 1 still split 'Prepare to' / 'plan for dashboard project.' (no whisper partial at the pause) -> Host-side join in 6aa99ba",
    "run 2: both hesitant sentences arrived as single turns; the join was not exercised live (journal)",
    "'Is any task running?' misheard 4 times by whisper base.en (recognition limit)",
  ],
});

// ── STT accuracy: word error rate where the spoken text is known ──
const words = (s) => s.toLowerCase().replace(/[’`]/g, "'").replace(/[^a-z0-9' ]+/g, " ").split(/\s+/).filter(Boolean);
const wer = (ref, hyp) => {
  const r = words(ref), h = words(hyp);
  const d = Array.from({ length: r.length + 1 }, (_, i) => [i, ...Array(h.length).fill(0)]);
  for (let j = 1; j <= h.length; j++) d[0][j] = j;
  for (let i = 1; i <= r.length; i++) for (let j = 1; j <= h.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (r[i - 1] === h[j - 1] ? 0 : 1));
  return { refWords: r.length, edits: d[r.length][h.length] };
};
const corpus = (pairs) => { const t = pairs.reduce((a, p) => ({ ref: a.ref + p.refWords, edits: a.edits + p.edits }), { ref: 0, edits: 0 }); return { utterances: pairs.length, refWords: t.ref, edits: t.edits, wer: t.ref ? Math.round((t.edits / t.ref) * 1000) / 1000 : null }; };
const clipText = JSON.parse(readFileSync(join(ev, "phone/clips.json"), "utf8").replace(/^﻿/, ""));
const phonePairs = (phone?.steps ?? []).filter((s) => s.heard).map((s) => ({ clip: s.clip, ref: clipText.find((c) => c.clip === s.clip)?.text ?? "", hyp: s.heard }));
// Live re-check 2: the human read three scripted lines (hesitations are not words).
const scripted2 = ["Prepare a plan for the dashboard project.", "Tell me about the weather on Mars.", "End voice, please."];
const humanPairs = (recheck2?.turns ?? []).map((t, i) => ({ ref: scripted2[i] ?? "", hyp: t.heard })).filter((p) => p.ref);
save("stt-accuracy.json", {
  engine: "whisper.cpp v1.9.4 base.en (local)",
  syntheticPhoneClips: { classification: "SAPI speech from the phone speaker into the laptop microphone, hands-free (echo-cancelled lane)", ...corpus(phonePairs.map((p) => wer(p.ref, p.hyp))), pairs: phonePairs },
  humanScripted: { classification: "LIVE human reading scripted lines, hands-free (live re-check 2)", ...corpus(humanPairs.map((p) => wer(p.ref, p.hyp))), pairs: humanPairs },
  humanUnscriptedNote: "Unscripted human turns (endurance, re-check 1) have no reference text; recorded misrecognitions include 'Is Anita scrunning?' for 'Is any task running?' (4 times), 'plant' for 'plan', 'call of Tt', 'QTP', '8K47' during double-talk.",
});

// ── response latency: end of the user's speech to Bunny's first audible playback (warm Host, loaded local model) ──
const latencyRows = (endurance?.recording?.turns ?? []).map((t) => t.timing).filter((x) => x && x.speechEndAt && x.firstPlaybackAt)
  .map((x, i) => ({ i, source: x.source ?? null, speechEndToFinalMs: x.finalAt - x.speechEndAt, finalToFirstTokenMs: x.firstTokenAt && x.admittedAt ? x.firstTokenAt - x.finalAt : null, speechEndToFirstAudioMs: x.firstPlaybackAt - x.speechEndAt, model: x.admittedAt != null }));
save("response-latency.json", {
  classification: "LIVE endurance session timings (Host clock), warm: the local model was loaded by earlier turns",
  hostFactsAnswers: { speechEndToFirstAudioMs: stats(latencyRows.filter((r) => !r.model).map((r) => r.speechEndToFirstAudioMs)), speechEndToFinalMs: stats(latencyRows.filter((r) => !r.model).map((r) => r.speechEndToFinalMs)) },
  modelAnswers: { speechEndToFirstAudioMs: stats(latencyRows.filter((r) => r.model).map((r) => r.speechEndToFirstAudioMs)), finalToFirstTokenMs: stats(latencyRows.filter((r) => r.model && r.finalToFirstTokenMs != null).map((r) => r.finalToFirstTokenMs)) },
  cold: NOT("cold model start (first load after Host start) was not measured separately in T12; T10 voice-latency-results.json remains the cold/warm record"),
  rows: latencyRows,
});

// ── AEC ──
save("aec-summary.json", {
  engine: "Windows Voice Capture DSP (CLSID_CWMAudioAEC) source mode, SINGLE_CHANNEL_AEC",
  echoOnly: echo?.summary ?? echo ?? NOT("no echo run"),
  syntheticDoubleTalk: doubletalk ? { source: "live/synthetic-doubletalk-1.json", result: "INCONCLUSIVE", reason: "the monitor speaker was too quiet at the laptop microphone to act as a second talker" } : NOT("no synthetic double-talk"),
  humanDoubleTalk: "probes/human-doubletalk-levels-2.txt and -3.txt: the user's speech over Bunny reached the echo-cancelled lane at 0.003-0.016 RMS",
});
console.log("assembled:", ["barge-in-latency.json", "interruption-results.json", "voice-endurance-results.json", "hostile-audio-results.json", "live-recheck-results.json", "stt-accuracy.json", "response-latency.json", "aec-summary.json"].join(", "));
