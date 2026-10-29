// MA5-S2 Phase 4 (P4-3/P4-4): the owner-attended physical acoustic qualification. It opens the real default microphone
// and speakers through a disposable real Host, so it refuses to start without a valid owner authorization file, and it
// never changes a mute, privacy or driver setting. No audio is saved or uploaded: the worker processes audio in memory and
// this script stores only Host and worker receipts, scripted phrase ids, scores and on-script recognized text.
//
//   node --experimental-strip-types scripts/ma5-s2/acoustic-session.mjs --authorization <file> [--sections 1,2,...]
//   node scripts/ma5-s2/acoustic-session.mjs --print-template      (prints the authorization the owner fills in)
//   node scripts/ma5-s2/acoustic-session.mjs --authorization <file> --check   (validates it; opens nothing)
//   ... --fixture   (developer self-check of this script: synthesized input, null sink, prompts auto-answered; opens no
//                    device, needs no authorization, and its evidence is labelled fixture, never acoustic)
//
// Every metric is labelled: "acoustic" (involves the real microphone, room or speaker) or "software" (a receipt that
// would be the same with fixtures). A software cancel acknowledgment is never reported as speaker silence.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const SCRIPT_ID = "p4-v1";
/** Scripted, nonpersonal phrases. `trials` per phrase gives the counts the rates are computed from. */
export const PHRASES = {
  stt: ["what are my agents working on", "what failed", "pause the current mission", "tell me when this task is completed", "how many agents are working", "open the approvals", "what is the status of my last mission", "goodbye bunny"],
  interrupt: ["stop", "wait bunny", "hold on", "bunny stop"],
  backchannel: ["uh huh", "okay", "right", "mm hmm"],
  /** Said with a deliberate one-second pause at the bar. */
  pause: ["what are my agents | working on", "tell me when this task | is completed"],
};
export const TRIALS = { stt: 3, interrupt: 5, backchannel: 5, pause: 3, echo: 10, latency: 10, load: 5 };
export const SECTIONS = {
  1: "real microphone capture and recognition (push-to-talk, scripted phrases)",
  2: "simultaneous capture and playback (hands-free; Bunny speaks, owner silent)",
  3: "echo cancellation under playback (false onsets and echo transcripts while owner silent)",
  4: "real spoken interruption during Bunny's reply (onset to render-meter silence)",
  5: "backchannels versus genuine interruptions",
  6: "natural pauses and end-of-turn detection",
  7: "speech end to first audible response",
  8: "human speech recognition accuracy (word error rate over section 1 and 4-6 phrases)",
  9: "background agent concurrency during conversation",
  10: "microphone mute, session closure and device recovery",
};
export const BARGE_IN_TARGET_MS = 200;

export function authorizationTemplate() {
  return {
    schema: "bunny-acoustic-authorization/1",
    script: SCRIPT_ID,
    microphone: "<exact Windows name of the default recording device>",
    speakers: "<exact Windows name of the default playback device>",
    maxMinutes: 45,
    playbackVolume: "<the system volume the owner set, e.g. 30%>",
    transientInMemoryProcessing: true,
    noRawAudioSavedOrUploaded: true,
    ownerUnmutesMicrophoneManually: true,
    ownerPresentForWholeSession: true,
    authorizedAt: "<ISO time the owner signed this>",
  };
}

/** Returns a list of problems; empty means the authorization is valid now. `now` is epoch ms. */
export function validateAuthorization(a, now = Date.now()) {
  const problems = [];
  if (!a || typeof a !== "object") return ["not an object"];
  if (a.schema !== "bunny-acoustic-authorization/1") problems.push("schema");
  if (a.script !== SCRIPT_ID) problems.push(`script must be ${SCRIPT_ID}`);
  for (const k of ["microphone", "speakers", "playbackVolume"]) if (typeof a[k] !== "string" || !a[k].trim() || a[k].includes("<")) problems.push(`${k} not filled in`);
  if (!Number.isInteger(a.maxMinutes) || a.maxMinutes < 1 || a.maxMinutes > 120) problems.push("maxMinutes must be 1..120");
  for (const k of ["transientInMemoryProcessing", "noRawAudioSavedOrUploaded", "ownerUnmutesMicrophoneManually", "ownerPresentForWholeSession"]) if (a[k] !== true) problems.push(`${k} must be true`);
  const at = Date.parse(a.authorizedAt);
  if (!Number.isFinite(at)) problems.push("authorizedAt is not a time");
  else if (at > now + 60_000) problems.push("authorizedAt is in the future");
  else if (now - at > 12 * 3_600_000) problems.push("authorization is older than 12 hours; sign a new one for this session");
  return problems;
}

const words = (s) => String(s ?? "").toLowerCase().replace(/[^a-z' ]/g, " ").split(/\s+/).filter(Boolean);
/** Word error rate of `hyp` against the scripted `ref` (pause bars ignored). */
export function wer(ref, hyp) {
  const r = words(ref.replace(/\|/g, " ")), h = words(hyp);
  const d = Array.from({ length: r.length + 1 }, (_, i) => [i, ...Array(h.length).fill(0)]);
  for (let j = 1; j <= h.length; j++) d[0][j] = j;
  for (let i = 1; i <= r.length; i++) for (let j = 1; j <= h.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (r[i - 1] === h[j - 1] ? 0 : 1));
  return d[r.length][h.length] / Math.max(1, r.length);
}
/** Recognized text is stored only when it is plainly the scripted phrase; anything else may be personal speech. */
export function onScript(ref, hyp) {
  return hyp != null && wer(ref, hyp) <= 0.5 ? hyp : hyp == null ? null : "[off-script: not stored]";
}
const rate = (num, den) => (den ? Math.round((num / den) * 1000) / 1000 : null);
function stats(values) {
  const v = values.filter((x) => typeof x === "number" && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return { n: 0, p50: null, p95: null, max: null };
  const at = (p) => v[Math.min(v.length - 1, Math.ceil((p / 100) * v.length) - 1)];
  return { n: v.length, p50: at(50), p95: at(95), max: v.at(-1) };
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--print-template")) { console.log(JSON.stringify(authorizationTemplate(), null, 2)); return; }
  const FIXTURE = argv.includes("--fixture");
  const authPath = argv[argv.indexOf("--authorization") + 1];
  if (!FIXTURE && (!argv.includes("--authorization") || !authPath)) throw new Error("Refused: --authorization <file> is required. Nothing was opened.");
  const auth = FIXTURE ? { ...authorizationTemplate(), maxMinutes: 30 } : JSON.parse(readFileSync(authPath, "utf8"));
  const problems = FIXTURE ? [] : validateAuthorization(auth);
  if (problems.length) throw new Error(`Refused: the authorization is not valid (${problems.join("; ")}). Nothing was opened.`);
  const sections = argv.includes("--sections") ? argv[argv.indexOf("--sections") + 1].split(",").map(Number) : Object.keys(SECTIONS).map(Number);
  if (argv.includes("--check")) { console.log(JSON.stringify({ valid: true, sections: sections.map((s) => `${s}: ${SECTIONS[s]}`), trials: TRIALS, phrases: PHRASES }, null, 2)); return; }

  // Imported only here: --check and --print-template load no Host code.
  const { spawnSync } = await import("node:child_process");
  const { mkdtempSync, rmSync, mkdirSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const readline = await import("node:readline/promises");
  const { startHost } = await import("../../src/lib/bunny-host/http.server.ts");
  const { defaultAdapters } = await import("../../src/lib/bunny-host/adapters.server.ts");
  const { writeEvidence } = await import("../evidence-guard.mjs");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const deadline = Date.now() + auth.maxMinutes * 60_000;
  const PORT = Number(process.env.BUNNY_E2E_PORT ?? 43216);
  const dataDirectory = mkdtempSync(join(tmpdir(), "bunny-p4-acoustic-"));
  const out = { fixture: FIXTURE ? "SELF-CHECK ONLY: synthesized input and null sink; nothing here is acoustic evidence" : false, schema: "ma5-s2-p4.acoustic/1", script: SCRIPT_ID, at: new Date().toISOString(), authorization: { microphone: auth.microphone, speakers: auth.speakers, playbackVolume: auth.playbackVolume, maxMinutes: auth.maxMinutes }, privacy: "no audio saved or uploaded; recognized text stored only when on-script", sections: {} };
  let host = null;
  const workers = () => (spawnSync("tasklist", ["/FI", "IMAGENAME eq bunny-voice-worker.exe", "/FO", "CSV", "/NH"], { encoding: "utf8" }).stdout.match(/bunny-voice-worker\.exe/gi) ?? []).length;
  try {
    if (workers() !== 0) throw new Error("Close every running bunny-voice-worker.exe first.");
    host = await startHost({ port: PORT, dataDirectory, adapters: defaultAdapters().filter((a) => a.id === "ollama"), ...(FIXTURE ? { voice: { workerExtraArgs: ["--input-synth", "what failed", "--output", "null"] } } : {}) });
    await host.manager.discover();
    const cmd = async (action, data = {}) => {
      if (Date.now() > deadline) throw new Error("The authorized session time is over.");
      const res = await fetch(`http://127.0.0.1:${PORT}/command`, { method: "POST", headers: { authorization: `Bearer ${host.token}`, "content-type": "application/json" }, body: JSON.stringify({ action, data, operationId: crypto.randomUUID() }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(`${action}: ${body.error ?? res.status}`);
      return body;
    };
    const voice = async () => { const b = await cmd("voice.state"); return b.voice ?? b.data; };
    const until = async (what, fn, ms = 30_000) => { const t = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t > ms) return null; await sleep(25); } };
    const prompt = async (text) => FIXTURE ? (console.log(`[fixture] ${text}`), "") : (await rl.question(`\n${text}\n  [Enter] go  ·  s + Enter skip  ·  q + Enter end the session > `)).trim().toLowerCase();
    const say = async (text) => { const a = await prompt(`Say clearly: "${text.replace(/\|/g, "… (pause one second) …")}"`); if (a === "q") throw new Error("Ended by the owner."); return a !== "s"; };

    // Device gate: the session opens push-to-talk (no capture) so the worker reports the default endpoints. Read only.
    await cmd("voice.session.open", { mode: "push_to_talk" });
    const opened = await until("session open", async () => { const s = await voice(); return s.open && s.devices?.input ? s : null; });
    const dev = opened?.devices;
    out.devices = { input: dev?.input?.name ?? null, output: dev?.output?.name ?? null, inputMuted: dev?.input?.muted ?? null, micPrivacy: dev?.micPrivacy ?? null, stt: opened?.engines?.stt ?? null };
    if (!FIXTURE && dev?.input?.name !== auth.microphone || dev?.output?.name !== auth.speakers) throw new Error(`Refused: the default devices (${dev?.input?.name} / ${dev?.output?.name}) are not the authorized ones.`);
    if (dev.micPrivacy === "deny") throw new Error("Refused: Windows microphone privacy denies access. Bunny does not change it.");
    while (!FIXTURE && (await voice()).devices?.input?.muted) {
      if ((await prompt("The microphone is muted. Unmute it yourself in Windows (Bunny never will), then continue.")) === "q") throw new Error("Ended by the owner.");
    }

    const lastTurn = async (before, ms = 30_000) => until("turn", async () => { const s = await voice(); return s.turnId !== before && (s.finalTranscript != null || s.state === "IDLE") && !s.capturing ? s : null; }, ms);
    const pushToTalk = async (phrase) => {
      const before = (await voice()).turnId;
      await cmd("voice.listen.start", { source: "button" });
      if (!(await say(phrase))) { await cmd("voice.listen.end", {}); return null; }
      const s = await lastTurn(before, 20_000);
      return { phrase, recognized: onScript(phrase, s?.finalTranscript), wer: wer(phrase, s?.finalTranscript ?? ""), confidence: s?.finalConfidence ?? null, speechEndToFirstAudioMs: s?.timing?.speechEndAt && s?.timing?.firstPlaybackAt ? s.timing.firstPlaybackAt - s.timing.speechEndAt : null };
    };
    const want = (n) => sections.includes(n);

    if (want(1) || want(8)) {
      const rows = [];
      for (const p of PHRASES.stt) for (let i = 0; i < TRIALS.stt; i++) { const r = await pushToTalk(p); if (r) rows.push(r); await sleep(1_500); }
      out.sections.stt = { class: "acoustic", engine: out.devices.stt, trials: rows, exactRate: rate(rows.filter((r) => r.wer === 0).length, rows.length), meanWer: rows.length ? rows.reduce((s, r) => s + r.wer, 0) / rows.length : null };
    }
    if (want(7)) {
      const rows = [];
      for (let i = 0; i < TRIALS.latency; i++) { const r = await pushToTalk(PHRASES.stt[i % 2]); if (r) rows.push(r.speechEndToFirstAudioMs); await sleep(3_000); }
      out.sections.latency = { class: "software receipt with real capture", boundary: "Host speechEndAt (VAD speech_end after 900 ms endpoint silence) to the worker's playback.started; speaker output latency not included", speechEndToFirstAudioMs: stats(rows) };
    }

    // Hands-free: Bunny speaks a long answer; each trial is one reply.
    const speakLong = async () => { await cmd("voice.text", { text: "Tell me a six sentence story about a careful rabbit who plans a garden." }); return until("playing", async () => { const s = await voice(); return s.playing ? s : null; }, 120_000); };
    const settle = () => until("settled", async () => { const s = await voice(); return !s.playing && ["IDLE", "INTERRUPTED", "LISTENING"].includes(s.state) ? s : null; }, 120_000);
    const bargeTrial = async (phrase) => {
      const before = (await voice()).lastBargeIn?.inputTurnId ?? null;
      const playing = await speakLong();
      if (!playing) return null;
      if (phrase && !(await say(phrase))) { await cmd("voice.interrupt", { source: "button" }); await settle(); return null; }
      if (!phrase) await sleep(8_000);
      const s = await until("barge-in receipt", async () => { const v = await voice(); return v.lastBargeIn && v.lastBargeIn.inputTurnId !== before && v.lastBargeIn.outcome !== "pending" ? v : null; }, phrase ? 15_000 : 1_000);
      const r = s?.lastBargeIn ?? null;
      if ((await voice()).playing) await cmd("voice.interrupt", { source: "button" });
      await settle();
      return { phrase, outcome: r?.outcome ?? "none", onsetToSilenceMs: r?.onsetToSilenceMs ?? null, detectionToSilenceMs: r?.detectionToSilenceMs ?? null, wasAudible: r?.wasAudible ?? null, echoRejected: r?.echoRejected ?? 0, reason: r?.reason ?? null };
    };
    if ([2, 3, 4, 5, 6, 9].some(want)) {
      await cmd("voice.session.open", { mode: "hands_free" });
      await until("hands-free active", async () => (await voice()).duplex?.active, 15_000);
      if (want(2) || want(3)) {
        await prompt(`Stay silent while Bunny speaks (${TRIALS.echo} replies). Normal room noise is fine.`);
        const rows = [];
        for (let i = 0; i < TRIALS.echo; i++) rows.push(await bargeTrial(null));
        const r = rows.filter(Boolean);
        out.sections.echo = { class: "acoustic", trials: r, falseInterruptRate: rate(r.filter((x) => x.outcome === "interrupted").length, r.length), echoTranscriptsRejected: r.reduce((s, x) => s + x.echoRejected, 0) };
      }
      if (want(4)) {
        const rows = [];
        for (const p of PHRASES.interrupt) for (let i = 0; i < Math.ceil(TRIALS.interrupt / 2); i++) { const r = await bargeTrial(p); if (r) rows.push(r); }
        const ok = rows.filter((x) => x.outcome === "interrupted");
        out.sections.interrupt = { class: "acoustic", boundary: "worker-monotonic speech onset to render-meter silence (onsetToSilenceMs); capture delay before the worker sees a frame is not included", target: `P95 <= ${BARGE_IN_TARGET_MS} ms where applicable`, trials: rows, interruptRate: rate(ok.length, rows.length), onsetToSilenceMs: stats(ok.map((x) => x.onsetToSilenceMs)), detectionToSilenceMs: stats(ok.map((x) => x.detectionToSilenceMs)) };
      }
      if (want(5)) {
        const rows = [];
        for (const p of PHRASES.backchannel) for (let i = 0; i < Math.ceil(TRIALS.backchannel / 2); i++) { const r = await bargeTrial(p); if (r) rows.push(r); }
        out.sections.backchannel = { class: "acoustic", trials: rows, resumedRate: rate(rows.filter((x) => x.outcome === "resumed" || x.outcome === "none").length, rows.length), falseInterruptRate: rate(rows.filter((x) => x.outcome === "interrupted").length, rows.length) };
      }
      if (want(6)) {
        const rows = [];
        for (const p of PHRASES.pause) for (let i = 0; i < TRIALS.pause; i++) {
          const before = (await voice()).turnId;
          if (!(await say(p))) continue;
          const s = await until("answered", async () => { const v = await voice(); return v.turnId !== before && v.finalTranscript ? v : null; }, 20_000);
          rows.push({ phrase: p, recognized: onScript(p, s?.finalTranscript), wer: wer(p, s?.finalTranscript ?? ""), splitIntoTwoTurns: s ? wer(p, s.finalTranscript) > 0.4 : null });
          await settle();
        }
        out.sections.pauses = { class: "acoustic", trials: rows, wholeUtteranceRate: rate(rows.filter((r) => r.splitIntoTwoTurns === false).length, rows.length) };
      }
      if (want(9)) {
        let stop = false; let done = 0; let failed = 0;
        const lane = async () => { while (!stop) { const t = host.manager.submit({ prompt: "Write a 150-word explanation of how tides work.", mode: "fast", override: "auto", constraints: { localOnly: true, offlineOnly: true, outputTokens: 250 } }); const st = await new Promise((r) => { host.manager.onTaskOutput(t.id, (e) => { if ("done" in e) r(e.state); }); if (t.state === "waiting_for_approval") host.manager.approve(t.id); }); if (st === "completed") done++; else failed++; } };
        const lanes = [lane(), lane()];
        const rows = [];
        for (let i = 0; i < TRIALS.load; i++) {
          const before = (await voice()).turnId;
          if (!(await say("in one short sentence what does a rabbit eat"))) continue;
          const s = await until("answered", async () => { const v = await voice(); return v.turnId !== before && v.timing?.completedAt ? v : null; }, 120_000);
          const t = s?.timing ?? {};
          rows.push({ firstAudibleMs: [t.firstPlaybackAt, t.delayAckPlaybackAt].filter(Boolean).length && t.speechEndAt ? Math.min(...[t.firstPlaybackAt, t.delayAckPlaybackAt].filter(Boolean)) - t.speechEndAt : null, answerAudioMs: t.firstPlaybackAt && t.speechEndAt ? t.firstPlaybackAt - t.speechEndAt : null, delayAck: !!t.delayAckAt });
        }
        stop = true; await Promise.all(lanes);
        out.sections.concurrency = { class: "acoustic capture + software receipts", trials: rows, firstAudibleMs: stats(rows.map((r) => r.firstAudibleMs)), answerAudioMs: stats(rows.map((r) => r.answerAudioMs)), background: { completed: done, notCompleted: failed } };
      }
    }
    if (want(10)) {
      const rows = {};
      await cmd("voice.mute", { muted: true });
      const m = await voice();
      rows.mute = { capturing: m.capturing, duplexActive: m.duplex?.active ?? false, state: m.state };
      await cmd("voice.mute", { muted: false });
      await cmd("voice.session.close", { source: "e2e" });
      await until("worker gone", async () => workers() === 0, 15_000);
      rows.close = { open: (await voice()).open, workers: workers() };
      if ((await prompt("Optional device recovery: open a voice session, then unplug or switch the default microphone, and plug it back. Enter to run it, s to skip.")) !== "s") {
        await cmd("voice.session.open", { mode: "push_to_talk" });
        await prompt("Unplug or switch the default microphone now; Enter when done.");
        const lost = await voice();
        await prompt("Restore the microphone now; Enter when done.");
        const back = await until("device back", async () => { const s = await voice(); return s.devices?.input?.present ? s : null; }, 30_000);
        rows.recovery = { duringLoss: { state: lost.state, inputPresent: lost.devices?.input?.present ?? null }, after: back ? { state: back.state, inputPresent: true, input: back.devices.input.name } : null };
      }
      out.sections.controls = { class: "acoustic device + software receipts", ...rows };
    }
  } catch (e) {
    out.failure = String(e?.message ?? e).slice(0, 500);
    console.error(out.failure);
  } finally {
    try { if (host) { await fetch(`http://127.0.0.1:${PORT}/command`, { method: "POST", headers: { authorization: `Bearer ${host.token}`, "content-type": "application/json" }, body: JSON.stringify({ action: "voice.session.close", data: { source: "e2e" }, operationId: crypto.randomUUID() }) }).catch(() => {}); await host.close(); } } catch { /* closed */ }
    await sleep(1_000);
    out.workersAfterShutdown = workers();
    mkdirSync("docs/ma5-s2/evidence/voice", { recursive: true });
    writeEvidence(`docs/ma5-s2/evidence/voice/${FIXTURE ? "acoustic-harness-selfcheck" : "acoustic-session"}.json`, out, host ? [host.token] : []);
    rmSync(dataDirectory, { recursive: true, force: true });
    rl.close();
    console.log(`Evidence: docs/ma5-s2/evidence/voice/${FIXTURE ? "acoustic-harness-selfcheck" : "acoustic-session"}.json (no audio; scripted text only).`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e.message); process.exitCode = 1; });
}
