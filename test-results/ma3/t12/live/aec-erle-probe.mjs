// M-A-3 T12 AEC effectiveness probe on the REAL laptop microphone and speakers, with nobody talking (quiet room).
// Worker A opens the hands-free (Windows Voice Capture DSP, source mode) lane and speaks long sentences on the default
// speakers. Worker B, a separate test-owned worker, captures the SAME microphone without echo cancellation at the same
// time. Both report 100 ms RMS level windows (numbers only, no audio). Comparing B (raw echo) with A (AEC output) while
// A's speech is audible gives the measured echo suppression; A's VAD onsets during its own speech are self-trigger
// candidates. This is acoustic evidence for one device configuration, not a universal AEC claim.
// Usage: node --experimental-strip-types aec-erle-probe.mjs <outJson> [sentences=6]
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { launchVoiceWorker } from "../../../../src/lib/bunny-host/voice/voice-worker.server.ts";
import { stats, voiceWorkerPids, waitFor } from "./lib.mjs";

const out = process.argv[2];
const sentences = Number(process.argv[3] ?? 6);
const TEXT = [
  "This is a measurement of echo cancellation on this laptop. Bunny is speaking at a normal volume while nobody talks.",
  "The microphone stays open while the speakers play, and the echo canceller removes the playback from the input.",
  "If the canceller works, the processed signal stays close to the room noise even though the raw microphone hears this voice.",
  "A rainbow forms when sunlight enters raindrops, bends, reflects inside each drop, and leaves again split into colors.",
  "Bread rises because yeast produces carbon dioxide, and the gluten network traps the gas as the dough warms up.",
  "Tides are caused mainly by the moon's gravity pulling on the oceans, with the sun adding a smaller effect.",
];
const dir = (p) => mkdtempSync(join(tmpdir(), p));
const pidsBefore = voiceWorkerPids();
const A = await launchVoiceWorker({ dataDirectory: dir("bunny-t12-erle-a-") });
const B = await launchVoiceWorker({ dataDirectory: dir("bunny-t12-erle-b-") });
const ev = { A: [], B: [] };
A.onEvent((e) => ev.A.push({ ...e, hostAt: Date.now() }));
B.onEvent((e) => ev.B.push({ ...e, hostAt: Date.now() }));
const result = { classification: "LIVE device, NO human speech: raw microphone (worker B, no AEC) vs Windows Voice Capture DSP output (worker A) during A's own playback", startedAt: new Date().toISOString() };
try {
  await sleep(1000);
  A.send({ op: "devices" });
  await waitFor(() => ev.A.find((e) => e.ev === "devices"), 5000);
  result.devices = ev.A.find((e) => e.ev === "devices") ?? null;
  if (result.devices?.defaultInput?.muted) throw new Error("ENDPOINT_MUTED: unmute the Windows microphone (never changed by this probe)");
  A.send({ op: "duplex.start", session: "erle", maxMs: 600_000 });
  const started = await waitFor(() => ev.A.find((e) => e.ev === "duplex.started" || e.ev === "duplex.error"), 10_000);
  result.duplexStarted = started ?? null;
  if (!started || started.ev !== "duplex.started") throw new Error("duplex did not start: " + JSON.stringify(started));
  // Recognition lanes: A on the AEC output (continuous), B on the raw microphone (manual end, re-armed on its 30 s cap).
  A.send({ op: "capture.start", turn: "a1", gen: 1, device: -1, endpointing: "manual", maxMs: 30_000, duplex: true, session: "erle" });
  let bTurn = 0;
  const armB = () => { bTurn += 1; B.send({ op: "capture.start", turn: `b${bTurn}`, gen: bTurn, device: -1, endpointing: "manual", maxMs: 30_000 }); };
  armB();
  await sleep(3000); // ambient baseline (both lanes, nobody talking, nothing playing)
  const baselineEnd = Date.now();
  let aTurn = 1;
  for (let i = 0; i < sentences; i++) {
    const seen = ev.A.length;
    A.send({ op: "speak", turn: `s${i}`, gen: 1, seq: i, text: TEXT[i % TEXT.length], device: -1, voice: null });
    await waitFor(() => ev.A.slice(seen).find((e) => e.ev === "playback.idle" || e.ev === "playback.error"), 60_000, 40);
    await sleep(600);
    // Keep both recognition lanes alive across their 30 s caps (levels are what is measured).
    if (ev.B.some((e) => e.ev === "capture.stopped" && e.turn === `b${bTurn}`)) armB();
    if (ev.A.some((e) => e.ev === "capture.stopped" && e.turn === `a${aTurn}`)) { aTurn += 1; A.send({ op: "capture.start", turn: `a${aTurn}`, gen: aTurn, device: -1, endpointing: "manual", maxMs: 30_000, duplex: true, session: "erle" }); }
  }
  await sleep(2000);
  // Windows of A's audible playback, by A's own playback events (wall clock of the Host receipt).
  const windows = [];
  let open = null;
  for (const e of ev.A) {
    if (e.ev === "playback.started" && !open) open = e.hostAt;
    if ((e.ev === "playback.idle" || e.ev === "playback.error") && open) { windows.push([open, e.hostAt]); open = null; }
  }
  const inPlay = (at) => windows.some(([a, b]) => at >= a + 300 && at <= b);
  const levels = (list) => list.filter((e) => e.ev === "level").map((e) => ({ at: e.hostAt, rms: e.rms, speech: e.speech, residual: e.residual ?? null, floor: e.floor ?? null }));
  const la = levels(ev.A), lb = levels(ev.B);
  const base = (l) => stats(l.filter((x) => x.at < baselineEnd).map((x) => x.rms));
  const play = (l) => stats(l.filter((x) => inPlay(x.at)).map((x) => x.rms));
  const db = (x, y) => (x && y ? Math.round(20 * Math.log10(x / y) * 10) / 10 : null);
  const rawPlay = play(lb), aecPlay = play(la), rawBase = base(lb), aecBase = base(la);
  result.windows = windows.map(([a, b]) => ({ startAt: a, endAt: b, ms: b - a }));
  result.levels = { rawAmbient: rawBase, aecAmbient: aecBase, rawDuringPlayback: rawPlay, aecDuringPlayback: aecPlay };
  result.echoSuppression = {
    note: "Median raw-microphone RMS over median AEC-output RMS while Bunny's speech is audible (first 300 ms of each window excluded for convergence). Includes the DSP's noise suppression, so it is an upper bound on pure echo cancellation.",
    erleMedianDb: db(rawPlay.p50, aecPlay.p50),
    rawEchoAboveAmbientDb: db(rawPlay.p50, rawBase.p50),
    aecResidualAboveAmbientDb: db(aecPlay.p50, aecBase.p50),
  };
  const onsets = ev.A.filter((e) => e.ev === "vad" && e.state === "speech_start");
  result.selfTrigger = {
    aecOnsetsDuringPlayback: onsets.filter((e) => inPlay(e.hostAt)).length,
    aecOnsetsTotal: onsets.length,
    aecPartials: ev.A.filter((e) => e.ev === "stt.partial").map((e) => e.text),
    aecFinals: ev.A.filter((e) => e.ev === "stt.final").map((e) => ({ text: e.text, confidence: e.confidence })),
    rawFinals: ev.B.filter((e) => e.ev === "stt.final").map((e) => ({ text: e.text, confidence: e.confidence })),
  };
  result.series = { aec: la.map((x) => [x.at, Number(x.rms.toFixed(5)), x.speech ? 1 : 0, x.residual]), raw: lb.map((x) => [x.at, Number(x.rms.toFixed(5))]) };
  A.send({ op: "capture.end", turn: `a${aTurn}`, gen: aTurn });
  B.send({ op: "capture.end", turn: `b${bTurn}`, gen: bTurn });
  // Final recognition on both lanes, for the record: B should transcribe Bunny's sentences; A should not.
  await sleep(6000);
  result.selfTrigger.aecFinals = ev.A.filter((e) => e.ev === "stt.final").map((e) => ({ text: e.text, confidence: e.confidence }));
  result.selfTrigger.rawFinals = ev.B.filter((e) => e.ev === "stt.final").map((e) => ({ text: e.text, confidence: e.confidence }));
  A.send({ op: "duplex.stop", session: "erle" });
  result.duplexStopped = await waitFor(() => ev.A.find((e) => e.ev === "duplex.stopped"), 5000);
} catch (error) {
  result.error = String(error?.message ?? error).slice(0, 1000);
} finally {
  await A.close().catch(() => {});
  await B.close().catch(() => {});
  result.cleanup = { A: A.closeAccounting ?? null, B: B.closeAccounting ?? null, workerPidsBefore: pidsBefore, workerPidsAfter: voiceWorkerPids() };
  writeFileSync(out, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ error: result.error ?? null, echoSuppression: result.echoSuppression ?? null, levels: result.levels ?? null, selfTrigger: result.selfTrigger ? { ...result.selfTrigger, aecPartials: result.selfTrigger.aecPartials.length } : null }, null, 1));
}
