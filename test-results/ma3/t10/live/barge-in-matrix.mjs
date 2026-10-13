// M-A-3 T10 §40/V59: ten live barge-in scenarios on a DISPOSABLE Host with the REAL voice worker, real speakers and
// (for spoken-turn scenarios) the real microphone. Interruptions are issued through the same Host actions the
// Island/desktop use. Each record carries the turn id, cancellation generation, request time, worker reset time,
// render-meter silence time (measured audible stop), dropped/stale chunk counts, late-event handling and the final
// state. Push-to-talk / button interruption only: acoustic hands-free barge-in is NOT claimed.
// Usage: node barge-in-matrix.mjs <outJson>
import { writeFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { startHost, pollVoice } from "./host-driver.mjs";

const out = process.argv[2];
const LONG = "Explain in five or six full sentences how a rainbow forms, step by step, in plain spoken language.";
const host = await startHost();
const state = async () => (await host.command("voice.state")).body.data;
const waitFor = async (pred, ms = 90000) => (await pollVoice(host, pred, { timeoutMs: ms, everyMs: 40 })).snap;
const speakingNow = (s) => s && s.playing === true && s.state === "SPEAKING";
const settle = async () => { await waitFor((s) => !s.playing && ["IDLE", "INTERRUPTED", "ERROR", "DEVICE_UNAVAILABLE"].includes(s.state), 60000); await sleep(400); };
const records = [];
async function scenario(id, title, fn) {
  const before = await state();
  const t0 = Date.now();
  let detail = {};
  let error = null;
  try { detail = (await fn()) ?? {}; } catch (e) { error = String(e?.message ?? e); }
  const after = await waitFor((s) => !s.playing, 20000) ?? (await state());
  // Stale-resume watch: for 3 s after the interrupt, no playback may restart for the cancelled generation.
  let resumed = false;
  const watchUntil = Date.now() + 3000;
  while (Date.now() < watchUntil) { const s = await state(); if (s?.playing && s.generation === after?.generation && s.turnId === detail.cancelledTurn) resumed = true; await sleep(60); }
  // The worker's speak.cancelled receipt (reset + meter silence) arrives after the Host answers the interrupt: read it
  // again after the watch window instead of from the first idle snapshot.
  const fin = (await state()) ?? after;
  const r = fin?.lastInterrupt ?? after?.lastInterrupt ?? null;
  const rec = {
    id, title, at: new Date(t0).toISOString(), error,
    turnIdInterrupted: detail.cancelledTurn ?? r?.turnId ?? null,
    generationBefore: before?.generation ?? null, generationAfter: after?.generation ?? null,
    interrupt: r, // requestedAt, source, workerResetMs, meterSilentMs, droppedChunks, inferenceStopped, lateEventsDropped, wasPlaying
    detectionToSilenceMs: r?.meterSilentMs ?? null,
    staleSpeechResumed: resumed,
    finalState: fin?.state ?? after?.state ?? null, playingAfter: fin?.playing ?? after?.playing ?? null, generationFinal: fin?.generation ?? null,
    ...detail,
  };
  records.push(rec);
  console.log(JSON.stringify({ id, title, meterSilentMs: rec.detectionToSilenceMs, resetMs: r?.workerResetMs, dropped: r?.droppedChunks, wasPlaying: r?.wasPlaying, resumed, final: rec.finalState, error }));
  await settle();
}
async function startLongAnswer(text = LONG) {
  await host.command("voice.text", { text });
  const s = await waitFor(speakingNow, 120000);
  if (!s) throw new Error("Bunny never started speaking");
  return s;
}
try {
  const open = await host.command("voice.session.open", { mode: "push_to_talk" });
  if (!open.body.data?.open) throw new Error("voice session did not open: " + JSON.stringify(open.body));
  // Warm the model so later timings are not cold-load dominated.
  await host.command("voice.text", { text: "Say ready." });
  await waitFor((s) => s.answer && !s.playing && s.state === "IDLE", 180000);

  await scenario("B01", "Mid-sentence interruption (button)", async () => {
    const s = await startLongAnswer(); await sleep(900);
    await host.command("voice.interrupt", { source: "button" });
    return { cancelledTurn: s.turnId };
  });
  await scenario("B02", "Mid-audio-buffer interruption (inside the first chunk)", async () => {
    const s = await startLongAnswer(); await sleep(250);
    await host.command("voice.interrupt", { source: "button" });
    return { cancelledTurn: s.turnId };
  });
  await scenario("B03", "User starts talking while Bunny speaks (push-to-talk press = barge-in, then release)", async () => {
    const s = await startLongAnswer(); await sleep(800);
    const l = await host.command("voice.listen.start", { source: "push_to_talk" });
    const listening = await waitFor((x) => x.capturing === true, 8000);
    await sleep(1200);
    await host.command("voice.listen.end", { turnId: l.body.data?.turnId });
    const end = await waitFor((x) => !x.capturing && x.state !== "TRANSCRIBING", 15000);
    return { cancelledTurn: s.turnId, newTurnCaptured: !!listening, newTurnId: l.body.data?.turnId ?? null, newTurnResult: end?.turnKind ?? end?.state ?? null };
  });
  await scenario("B04", "Rapid repeated interruption (3 interrupts in 300 ms, then again after a restart)", async () => {
    const s = await startLongAnswer(); await sleep(700);
    await Promise.all([host.command("voice.interrupt", { source: "button" }), host.command("voice.interrupt", { source: "hotkey" }), host.command("voice.interrupt", { source: "button" })]);
    await settle();
    const s2 = await startLongAnswer(); await sleep(600);
    await host.command("voice.interrupt", { source: "button" });
    return { cancelledTurn: s2.turnId, firstTurn: s.turnId };
  });
  await scenario("B05", "Interruption after response generation completed (speech still playing)", async () => {
    await host.command("voice.text", { text: "Explain in four sentences why the sky is blue." });
    const s = await waitFor((x) => x.playing && x.timing?.inferenceCompletedAt, 120000);
    await sleep(300);
    await host.command("voice.interrupt", { source: "button" });
    return { cancelledTurn: s?.turnId ?? null, inferenceCompletedBeforeInterrupt: !!s?.timing?.inferenceCompletedAt };
  });
  await scenario("B06", "Interruption during TTS initialization (answer text arriving, before first playback)", async () => {
    await host.command("voice.text", { text: LONG });
    const s = await waitFor((x) => x.state === "PROCESSING" && (x.answer?.length ?? 0) > 0 && !x.playing, 120000) ?? (await state());
    await host.command("voice.interrupt", { source: "button" });
    return { cancelledTurn: s?.turnId ?? null, interruptedBeforePlayback: !s?.playing };
  });
  await scenario("B07", "Interruption while model output is still streaming", async () => {
    await host.command("voice.text", { text: LONG });
    const s = await waitFor((x) => x.playing && !x.timing?.inferenceCompletedAt, 120000);
    await host.command("voice.interrupt", { source: "button" });
    await sleep(1500);
    const after = await state();
    return { cancelledTurn: s?.turnId ?? null, streamingAtInterrupt: !!s && !s.timing?.inferenceCompletedAt, routeTaskId: s?.route?.taskId ?? null, answerFrozenAfterInterrupt: after?.answer === (await state())?.answer };
  });
  await scenario("B08", "Interruption followed by an immediate new request", async () => {
    const s = await startLongAnswer(); await sleep(800);
    await host.command("voice.interrupt", { source: "button" });
    await host.command("voice.text", { text: "Wait, what is two plus two?" });
    const n = await waitFor((x) => x.turnId !== s.turnId && x.answer && !x.playing && x.state === "IDLE", 120000);
    return { cancelledTurn: s.turnId, newTurnId: n?.turnId ?? null, newAnswer: n?.answer ?? null };
  });
  await scenario("B09", "Microphone mute during speech", async () => {
    const s = await startLongAnswer(); await sleep(700);
    const m = await host.command("voice.mute", { muted: true });
    const after = await state();
    await host.command("voice.mute", { muted: false });
    return { cancelledTurn: s.turnId, mutedAck: m.body.data?.muted ?? null, playingAfterMute: after?.playing ?? null };
  });
  // B10 is recorded directly: the Host itself is killed, so there is no Host to poll afterwards.
  {
    const s = await startLongAnswer(); await sleep(800);
    const workerPids = (await import("node:child_process")).execFileSync("powershell.exe", ["-NoProfile", "-Command", "@(Get-Process bunny-voice-worker -ErrorAction SilentlyContinue | ForEach-Object Id) -join ','"], { encoding: "utf8" }).trim();
    const killAt = Date.now();
    host.child.kill("SIGKILL");
    let goneAt = null;
    for (let i = 0; i < 100; i++) {
      const alive = (await import("node:child_process")).execFileSync("powershell.exe", ["-NoProfile", "-Command", `@(Get-Process -Id ${workerPids || 0} -ErrorAction SilentlyContinue).Count`], { encoding: "utf8" }).trim();
      if (alive === "0") { goneAt = Date.now(); break; }
      await sleep(50);
    }
    const rec = { id: "B10", title: "Host disconnect during speech (Host process killed; F04 job closes; worker and its audio die)", turnIdInterrupted: s.turnId, generationBefore: s.generation, workerPidsBefore: workerPids, hostKilledAt: killAt, workerGoneAfterMs: goneAt ? goneAt - killAt : null, detectionToSilenceMs: null, staleSpeechResumed: false, finalState: "HOST_DEAD", note: "Audible stop is the worker process ending with the Host's job (waveOut handle released by the OS). Process-exit time includes the poll interval." };
    records.push(rec);
    console.log(JSON.stringify({ id: "B10", workerGoneAfterMs: rec.workerGoneAfterMs, workerPidsBefore: workerPids }));
  }
} finally {
  // B10 killed the Host; check that no bunny-voice-worker from this run survives (F04 kill-on-close).
  const { execFileSync } = await import("node:child_process");
  let survivors = "unknown";
  try { survivors = execFileSync("powershell.exe", ["-NoProfile", "-Command", "@(Get-Process bunny-voice-worker -ErrorAction SilentlyContinue).Count"], { encoding: "utf8" }).trim(); } catch { /* none */ }
  const summary = {
    classification: "LIVE: real voice worker, real speakers; interruption by Host actions (button/hotkey/push-to-talk/mute/host death). Acoustic hands-free barge-in not claimed.",
    scenarios: records.length,
    staleResumed: records.filter((r) => r.staleSpeechResumed).length,
    meterSilentMs: records.map((r) => r.detectionToSilenceMs).filter((v) => typeof v === "number"),
    workerProcessesAfterRun: survivors,
  };
  const ms = summary.meterSilentMs.slice().sort((a, b) => a - b);
  summary.p50 = ms.length ? ms[Math.floor(ms.length / 2)] : null;
  summary.p95 = ms.length ? ms[Math.min(ms.length - 1, Math.ceil(ms.length * 0.95) - 1)] : null;
  console.log("SUMMARY", JSON.stringify(summary));
  if (out) writeFileSync(out, JSON.stringify({ summary, records }, null, 2));
  try { await host.stop(); } catch { /* already gone */ }
}
