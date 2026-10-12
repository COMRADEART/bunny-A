// M-A-3 T12 automated acoustic trials on a DISPOSABLE Host, real voice worker, real laptop microphone and speakers.
// No human speech is involved, so nothing here is human acceptance evidence:
//   self-trigger : Bunny speaks long answers in hands-free mode with nobody talking. Counts input turns, controller
//                  decisions, held/interrupted output and routed finals that its own (echo-cancelled) voice causes.
//   doubletalk   : SYNTHETIC second talker. A separate test-owned voice worker speaks a "user" phrase through the
//                  monitor speakers (a render endpoint that is NOT the AEC reference) while Bunny speaks on the default
//                  speakers. Measures the acoustic barge-in receipts. Labelled synthetic: it is a loudspeaker, not a person.
// Usage: node --experimental-strip-types auto-acoustic.mjs <self-trigger|doubletalk> <outJson> [trials]
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { startHost, voiceRecorder, waitFor, stats, voiceWorkerPids, endpointState } from "./lib.mjs";
import { launchVoiceWorker } from "../../../../src/lib/bunny-host/voice/voice-worker.server.ts";

const mode = process.argv[2];
const out = process.argv[3];
const trials = Number(process.argv[4] ?? (mode === "doubletalk" ? 30 : 10));
if (!["self-trigger", "doubletalk"].includes(mode) || !out) throw new Error("usage: auto-acoustic.mjs <self-trigger|doubletalk> <outJson> [trials]");

const LONG = [
  "Explain in six full spoken sentences how a rainbow forms, step by step.",
  "Describe in six full sentences how bread rises when it is baked.",
  "In six spoken sentences, explain why the sky looks blue during the day.",
  "Tell me in six sentences how a bicycle stays upright while it moves.",
  "Explain in six full sentences how tides are caused by the moon.",
];
const USER = [
  "Wait, what is two plus two?",
  "Stop. What time zone is London in?",
  "Actually, can you tell me the capital of Japan?",
  "Hold on, how many legs does a spider have?",
  "Wait, did the tests pass?",
];

const endpoints = await endpointState();
if (endpoints?.defaultInput?.muted) {
  console.log("BLOCKED: the Windows microphone is muted. Unmute it (this harness never changes audio settings).");
  writeFileSync(out, JSON.stringify({ mode, blocked: "ENDPOINT_MUTED", endpoints }, null, 2));
  process.exit(2);
}
const pidsBefore = voiceWorkerPids();
const host = await startHost({ label: `t12-${mode}` });
const rec = voiceRecorder(host);
const result = { mode, classification: mode === "self-trigger" ? "LIVE device, NO human: Bunny's own speech on real speakers with the real echo-cancelled microphone" : "SYNTHETIC acoustic double-talk: a test-owned loudspeaker (monitor, outside the AEC reference) plays the 'user'; real microphone; NOT human evidence", startedAt: new Date().toISOString(), endpoints: { input: endpoints?.defaultInput ?? null, output: endpoints?.defaultOutput ?? null, outputs: endpoints?.outputs ?? null }, hostPid: host.pid, trials: [] };
let talker = null;
try {
  const open = await host.command("voice.session.open", { mode: "hands_free" });
  if (!open.body.data?.open) throw new Error("voice did not open: " + JSON.stringify(open.body).slice(0, 400));
  await host.command("voice.listen.start", { source: "hands_free" });
  const live = await waitFor(async () => (await host.voice())?.duplex?.active, 15_000);
  result.duplexStart = (await host.voice())?.duplex ?? null;
  if (!live) throw new Error("hands-free (echo-cancelled) capture did not start: " + JSON.stringify(result.duplexStart));
  // Warm the local model first so trial timings are not dominated by a cold load.
  await host.command("voice.text", { text: "Say ready." });
  await waitFor(async () => { const s = await host.voice(); return s?.answer && !s.playing && !s.outputHeld && s.state === "IDLE"; }, 180_000);
  if (mode === "doubletalk") {
    const monitor = (endpoints?.outputs ?? []).find((o) => /SD4780P/i.test(o.name));
    if (!monitor) throw new Error("the monitor speaker (second talker) is not present");
    talker = await launchVoiceWorker({ dataDirectory: mkdtempSync(join(tmpdir(), "bunny-t12-talker-")) });
    talker.events = [];
    talker.onEvent((e) => talker.events.push({ ...e, hostAt: Date.now() }));
    await sleep(800);
    talker.device = monitor.index;
    result.talker = { device: monitor, voice: "Microsoft Zira Desktop" };
  }
  for (let i = 0; i < trials; i++) {
    const before = rec.result();
    const prompt = LONG[i % LONG.length];
    const t = { i, prompt, startedAt: Date.now() };
    await host.command("voice.text", { text: prompt });
    const speaking = await waitFor(async () => { const s = await host.voice(); return s?.playing ? s : null; }, 120_000, 40);
    if (!speaking) { t.error = "Bunny never started speaking"; result.trials.push(t); continue; }
    t.outputTurnId = speaking.turnId;
    t.gen = speaking.generation;
    if (mode === "doubletalk") {
      const delay = 700 + ((i * 397) % 1800);
      await sleep(delay);
      const phrase = USER[i % USER.length];
      const before = talker.events.length;
      talker.send({ op: "speak", turn: `talker-${i}`, gen: i + 1, seq: 0, text: phrase, device: talker.device, voice: "Microsoft Zira Desktop" });
      const started = await waitFor(() => talker.events.slice(before).find((e) => e.ev === "playback.started"), 5000, 10);
      Object.assign(t, { phrase, delayMs: delay, talkerPlaybackWall: started?.t ?? null });
      // Outcome: the old answer is interrupted and the phrase is answered, or it resumes (missed), within 20 s.
      const done = await waitFor(async () => {
        const s = await host.voice();
        const b = s?.lastBargeIn;
        return b && b.outputTurnId === t.outputTurnId && b.outcome !== "pending" ? { s, b } : null;
      }, 20_000, 40);
      t.bargeIn = done?.b ?? null;
      t.missed = !done || done.b.outcome !== "interrupted";
      // Stale-resume watch: for 4 s after the decision, the cancelled output never plays again.
      let resumed = false;
      const until = Date.now() + 4000;
      while (Date.now() < until) { const s = await host.voice(); if (t.bargeIn?.outcome === "interrupted" && s?.playing && s.turnId === t.outputTurnId && s.generation === t.gen) resumed = true; await sleep(50); }
      t.staleResumed = resumed;
      const answered = await waitFor(async () => { const s = await host.voice(); return s?.finalTranscript && s.turnId !== t.outputTurnId && s.answer && !s.playing && s.state === "IDLE" ? s : null; }, 60_000);
      t.newTurn = answered ? { final: answered.finalTranscript, kind: answered.turnKind, answer: answered.answer, source: answered.answerSource } : null;
    } else {
      // Self-trigger: let Bunny finish (no one speaks), then count what its own voice caused.
      await waitFor(async () => { const s = await host.voice(); return !s?.playing && !s?.outputHeld && s?.state === "IDLE" && s.turnId === t.outputTurnId ? s : null; }, 120_000, 60);
    }
    const after = rec.result();
    const decisions = after.decisions.slice(before.decisions.length);
    t.decisions = decisions;
    t.pauses = decisions.filter((d) => d.action === "pause").length;
    t.interrupts = decisions.filter((d) => d.action === "interrupt").length;
    t.drops = decisions.filter((d) => d.action === "drop").length;
    t.routedUserFinals = after.turns.filter((x) => !before.turns.some((y) => y.turnId === x.turnId) && x.timing?.source !== "typed" && x.turnId !== t.outputTurnId).map((x) => ({ final: x.final, kind: x.turnKind }));
    t.endedAt = Date.now();
    result.trials.push(t);
    console.log(JSON.stringify({ i, pauses: t.pauses, interrupts: t.interrupts, drops: t.drops, routed: t.routedUserFinals.length, missed: t.missed ?? null, silenceMs: t.bargeIn?.detectionToSilenceMs ?? null, onsetToSilenceMs: t.bargeIn?.onsetToSilenceMs ?? null, stale: t.staleResumed ?? null }));
    await sleep(1500);
  }
} catch (error) {
  result.error = String(error?.stack ?? error).slice(0, 2000);
} finally {
  await rec.stop();
  result.recording = rec.result();
  if (talker) await talker.close().catch(() => {});
  await host.stop();
  await sleep(1000);
  result.workerPidsBefore = pidsBefore;
  result.workerPidsAfter = voiceWorkerPids();
  const tr = result.trials.filter((t) => !t.error);
  result.summary = mode === "doubletalk"
    ? {
        trials: tr.length,
        interrupted: tr.filter((t) => t.bargeIn?.outcome === "interrupted").length,
        missed: tr.filter((t) => t.missed).length,
        staleResumed: tr.filter((t) => t.staleResumed).length,
        detectionToSilenceMs: stats(tr.map((t) => t.bargeIn?.detectionToSilenceMs)),
        onsetToSilenceMs: stats(tr.map((t) => t.bargeIn?.onsetToSilenceMs)),
        newTurnsAnswered: tr.filter((t) => t.newTurn).length,
      }
    : {
        trials: tr.length,
        speechSeconds: Math.round(tr.reduce((sum, t) => sum + (t.endedAt - t.startedAt), 0) / 1000),
        pauses: tr.reduce((s, t) => s + t.pauses, 0),
        interrupts: tr.reduce((s, t) => s + t.interrupts, 0),
        drops: tr.reduce((s, t) => s + t.drops, 0),
        routedUserFinals: tr.reduce((s, t) => s + t.routedUserFinals.length, 0),
        inputTurnsOpened: result.recording.inputTurns,
      };
  writeFileSync(out, JSON.stringify(result, null, 2));
  console.log("SUMMARY", JSON.stringify(result.summary), result.error ? "ERROR " + result.error.slice(0, 300) : "");
}
