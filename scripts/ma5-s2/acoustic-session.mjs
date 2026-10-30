// MA5-S2 Phase 4 (P4-3/P4-4): the owner-attended physical acoustic qualification. It opens the real default microphone
// and speakers through a disposable real Host, so it refuses to start without a valid owner authorization file, and it
// never changes a mute, privacy, volume or driver setting. No audio is saved or uploaded: the worker processes audio in
// memory and this script stores only Host and worker receipts, scripted phrase ids, word-error counts and timings.
//
//   node --experimental-strip-types scripts/ma5-s2/acoustic-session.mjs --authorization <file> [--sections 1,2,...]
//   node scripts/ma5-s2/acoustic-session.mjs --print-template      (prints the authorization the owner fills in)
//   node scripts/ma5-s2/acoustic-session.mjs --authorization <file> --check   (validates it; opens nothing)
//   ... --fixture   (developer self-check of this script: synthesized input, null sink, prompts auto-answered; opens no
//                    device, needs no authorization, and its evidence is labelled simulated, never acoustic)
//
// Phase 4R1: an independent watchdog ends the session at the authorized time (monotonic clock, also bounded by the
// authorization's 12-hour validity) even while it waits for the keyboard, the Host or the model; on any stop it silences
// playback, ends capture, closes the Host and its worker within bounded steps and force-terminates a worker that remains.
// The Windows output endpoint must be the authorized one at or below the authorized volume before anything can play, and
// it is re-read every second; a change stops the session. Bunny reads the volume and never sets it.
//
// Every metric is labelled: "acoustic" (involves the real microphone, room or speaker), "software" (a receipt that would
// be the same with fixtures) or "simulated" (--fixture). A software cancel acknowledgment is never reported as speaker
// silence, and the "still thinking" status line is never reported as the model's answer.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

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
const AUTHORIZATION_VALID_MS = 12 * 3_600_000;
/** Each shutdown step (silence + close voice, close Host, force-terminate) gets this long before the next one runs. */
export const SHUTDOWN_STEP_MS = 5_000;

/** A designed stop of the session. `code` is the only part that reaches evidence unredacted. */
export class SessionStop extends Error {
  constructor(code, detail = "") {
    super(detail ? `${code}: ${detail}` : code);
    this.code = code;
  }
}

export function authorizationTemplate() {
  return {
    schema: "bunny-acoustic-authorization/2",
    script: SCRIPT_ID,
    microphone: "<exact Windows name of the default recording device>",
    speakers: "<exact Windows name of the default playback device>",
    maxMinutes: 45,
    maxPlaybackVolumePercent: "<integer 1-100: the highest Windows output volume you allow; set it yourself, Bunny never changes it>",
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
  if (a.schema !== "bunny-acoustic-authorization/2") problems.push("schema must be bunny-acoustic-authorization/2");
  if (a.script !== SCRIPT_ID) problems.push(`script must be ${SCRIPT_ID}`);
  for (const k of ["microphone", "speakers"]) if (typeof a[k] !== "string" || !a[k].trim() || a[k].includes("<")) problems.push(`${k} not filled in`);
  if ("playbackVolume" in a) problems.push("playbackVolume is replaced by maxPlaybackVolumePercent");
  if (!Number.isInteger(a.maxPlaybackVolumePercent) || a.maxPlaybackVolumePercent < 1 || a.maxPlaybackVolumePercent > 100) problems.push("maxPlaybackVolumePercent must be an integer 1..100");
  if (!Number.isInteger(a.maxMinutes) || a.maxMinutes < 1 || a.maxMinutes > 120) problems.push("maxMinutes must be 1..120");
  for (const k of ["transientInMemoryProcessing", "noRawAudioSavedOrUploaded", "ownerUnmutesMicrophoneManually", "ownerPresentForWholeSession"]) if (a[k] !== true) problems.push(`${k} must be true`);
  const at = Date.parse(a.authorizedAt);
  if (!Number.isFinite(at)) problems.push("authorizedAt is not a time");
  else if (at > now + 60_000) problems.push("authorizedAt is in the future");
  else if (now - at > AUTHORIZATION_VALID_MS) problems.push("authorization is older than 12 hours; sign a new one for this session");
  return problems;
}

/** The session budget: the authorized minutes, cut short by the end of the authorization's validity. Wall clock read once. */
export function sessionBudgetMs(a, now = Date.now()) {
  return Math.max(0, Math.min(a.maxMinutes * 60_000, Date.parse(a.authorizedAt) + AUTHORIZATION_VALID_MS - now));
}

/**
 * The watchdog. Elapsed time is monotonic (`now`, default performance.now), so a wall-clock change cannot extend the
 * session. The timer aborts `signal` at the budget even if nothing else is running; `check()` also catches a late timer.
 * `onStop` runs once, synchronously, on the first stop of any kind (expiry, owner, unauthorized endpoint, failure).
 */
export function createSessionGuard({ budgetMs, now = () => performance.now(), onStop = () => {} }) {
  const controller = new AbortController();
  const started = now();
  const stop = (code, detail) => {
    if (controller.signal.aborted) return;
    controller.abort(new SessionStop(code, detail));
    onStop(controller.signal.reason);
  };
  const timer = setTimeout(() => stop("SESSION_EXPIRED", "the authorized session time is over"), budgetMs);
  return {
    signal: controller.signal,
    elapsedMs: () => now() - started,
    stop,
    check() {
      if (now() - started >= budgetMs) stop("SESSION_EXPIRED", "the authorized session time is over");
      if (controller.signal.aborted) throw controller.signal.reason;
    },
    /** Settles with `promise`, or rejects with the stop reason the moment the session stops. */
    race(promise) {
      const { signal } = controller;
      if (signal.aborted) { promise.catch?.(() => {}); return Promise.reject(signal.reason); }
      return new Promise((done, fail) => {
        const onAbort = () => fail(signal.reason);
        signal.addEventListener("abort", onAbort, { once: true });
        promise.then((v) => { signal.removeEventListener("abort", onAbort); done(v); }, (e) => { signal.removeEventListener("abort", onAbort); fail(signal.aborted ? signal.reason : e); });
      });
    },
    dispose: () => clearTimeout(timer),
  };
}

/**
 * The session's waiting primitives, all bounded by the guard. `send(action, data, signal)` performs one Host command;
 * `ask(text, signal)` reads one keyboard answer (null for fixture runs).
 */
export function sessionPrimitives({ guard, send, ask }) {
  const sleep = (ms) => guard.race(delay(ms, undefined, { signal: guard.signal }));
  const cmd = async (action, data = {}) => { guard.check(); return guard.race(send(action, data, guard.signal)); };
  const voice = async () => { const b = await cmd("voice.state"); return b.voice ?? b.data; };
  const until = async (fn, ms = 30_000) => { const t = performance.now(); for (;;) { const v = await fn(); if (v) return v; if (performance.now() - t > ms) return null; await sleep(25); } };
  const prompt = async (text) => { guard.check(); return ask ? String(await guard.race(ask(text, guard.signal))).trim().toLowerCase() : ""; };
  return { sleep, cmd, voice, until, prompt };
}

/** Read-only check of the default endpoints against the authorization. Volume is the Core Audio master scalar 0..1. */
export function checkEndpoints(devices, a) {
  const problems = [];
  const input = devices?.input ?? null, output = devices?.output ?? null;
  if (!input?.present || input.name !== a.microphone) problems.push("UNAUTHORIZED_INPUT");
  if (!output?.present || output.name !== a.speakers) problems.push("UNAUTHORIZED_OUTPUT");
  const v = output?.volume;
  // ceil with a float32 tolerance: 0.3 reads as 30, 0.305 as 31 (over a 30 limit).
  const volumePercent = typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1 ? Math.ceil(v * 100 - 1e-4) : null;
  if (volumePercent == null) problems.push("OUTPUT_VOLUME_UNVERIFIED");
  else if (volumePercent > a.maxPlaybackVolumePercent) problems.push("OUTPUT_VOLUME_ABOVE_LIMIT");
  return { ok: problems.length === 0, problems, volumePercent, outputMuted: output?.muted ?? null };
}

/** Re-reads the endpoints every `intervalMs` until the session stops; any problem stops it. Never changes a setting. */
/** `tolerated()` names problems accepted right now (the attended device-recovery step unplugs the microphone). */
export async function watchEndpoints({ ops, guard, auth, intervalMs = 1_000, onRead = () => {}, tolerated = () => [] }) {
  try {
    for (;;) {
      await ops.cmd("voice.devices");
      await ops.sleep(intervalMs);
      const state = await ops.voice();
      // No open session means no worker, so nothing can play; the Host clears its endpoint report on close.
      if (!state?.open) continue;
      const result = checkEndpoints(state.devices, auth);
      onRead(result);
      const blocking = result.problems.filter((p) => !tolerated().includes(p));
      if (blocking.length) { guard.stop("ENDPOINT_NOT_AUTHORIZED", blocking.join(",")); return; }
    }
  } catch {
    // The session stopped (or the Host is gone); the stop path owns cleanup.
  }
}

/**
 * Idempotent bounded shutdown: every call returns the same receipt promise. Each step gets `stepMs`; a step that fails or
 * hangs does not block the next. Workers still present after the Host closed are force-terminated by pid.
 */
export function createShutdown({ stopAudio, closeHost, ownedWorkers, forceKill, stepMs = SHUTDOWN_STEP_MS }) {
  let receipt = null;
  const bounded = async (step, fn, steps) => {
    const t = performance.now();
    let timer;
    const outcome = await Promise.race([
      Promise.resolve().then(fn).then(() => "ok", () => "error"),
      new Promise((r) => { timer = setTimeout(() => r("timeout"), stepMs); }),
    ]);
    clearTimeout(timer);
    steps.push({ step, outcome, ms: Math.round(performance.now() - t) });
  };
  return () => (receipt ??= (async () => {
    const steps = [];
    await bounded("silence-and-close-voice", stopAudio, steps);
    await bounded("close-host", closeHost, steps);
    let left = [];
    try { left = await ownedWorkers(); } catch { left = []; }
    const forced = left.length;
    if (forced) {
      await bounded("force-terminate-workers", () => forceKill(left), steps);
      try { left = await ownedWorkers(); } catch { /* reported as before */ }
    }
    return { steps, forcedWorkers: forced, workersAfterShutdown: left.length, clean: left.length === 0 && steps.every((s) => s.outcome === "ok") };
  })());
}

const words = (s) => String(s ?? "").toLowerCase().replace(/[^a-z' ]/g, " ").split(/\s+/).filter(Boolean);
/** Word edit distance of `hyp` against the scripted `ref` (pause bars ignored). */
export function wordErrors(ref, hyp) {
  const r = words(ref.replace(/\|/g, " ")), h = words(hyp);
  const d = Array.from({ length: r.length + 1 }, (_, i) => [i, ...Array(h.length).fill(0)]);
  for (let j = 1; j <= h.length; j++) d[0][j] = j;
  for (let i = 1; i <= r.length; i++) for (let j = 1; j <= h.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (r[i - 1] === h[j - 1] ? 0 : 1));
  return d[r.length][h.length];
}
/** Word error rate of `hyp` against the scripted `ref`. */
export const wer = (ref, hyp) => wordErrors(ref, hyp) / Math.max(1, words(ref.replace(/\|/g, " ")).length);
/** Phase 4R1: a recognition is recorded as counts only. The recognized text itself is never stored. */
export function scoreTurn(phraseId, ref, hyp) {
  const refWords = words(ref.replace(/\|/g, " ")).length;
  if (hyp == null) return { phraseId, refWords, wordErrors: null, outcome: "no-result" };
  const errors = wordErrors(ref, hyp);
  return { phraseId, refWords, wordErrors: errors, outcome: errors === 0 ? "exact" : "errors" };
}

/** Strips paths, addresses, credentials, long identifiers and the given names (device names) from a message. */
export function redact(text, names = [], max = 200) {
  let s = String(text ?? "");
  for (const n of names) if (n) s = s.split(n).join("[device]");
  return s
    .replace(/\b[A-Za-z]:[\\/][^\s"'`)]*/g, "[path]")
    .replace(/\\\\[^\s"'`)]+/g, "[path]")
    .replace(/(^|[\s"'`(=])\/(?:home|Users|tmp|var|private|mnt|root)\/[^\s"'`)]*/g, "$1[path]")
    .replace(/file:\/\/[^\s"'`)]+/g, "[path]")
    .replace(/\bBearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]")
    .replace(/\b(?=[A-Za-z_-]*\d)[A-Za-z0-9_-]{24,}\b/g, "[id]")
    .slice(0, max);
}

/** Evidence form of a failure: a code, plus a redacted detail. */
export function safeFailure(e, names = []) {
  return { code: e instanceof SessionStop ? e.code : "ERROR", detail: redact(e instanceof SessionStop ? String(e.message).slice(e.code.length + 2) : e?.message ?? e, names) };
}

/** Throws when the evidence carries recognized text, a device name, a path, an address or a credential. */
export function assertPrivateEvidence(value, names = [], path = "$") {
  if (typeof value === "string") {
    if (names.some((n) => n && value.includes(n))) throw new Error(`private evidence: ${path} names a device`);
    if (redact(value) !== value.slice(0, 200) || value.length > 200) throw new Error(`private evidence: ${path} carries a path, address, credential or free text`);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [k, v] of Object.entries(value)) {
    if (/^(text|transcript|finalTranscript|partial|recognized|utterance)$/i.test(k) && v != null) throw new Error(`private evidence: ${path}.${k} is recognized text`);
    assertPrivateEvidence(v, names, `${path}.${k}`);
  }
}

const rate = (num, den) => (den ? Math.round((num / den) * 1000) / 1000 : null);
function stats(values) {
  const v = values.filter((x) => typeof x === "number" && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return { n: 0, p50: null, p95: null, max: null };
  const at = (p) => v[Math.min(v.length - 1, Math.ceil((p / 100) * v.length) - 1)];
  return { n: v.length, p50: at(50), p95: at(95), max: v.at(-1) };
}
const since = (t, field) => (t?.[field] && t?.speechEndAt ? t[field] - t.speechEndAt : null);
/** Every response stage from the end of speech, separately (P4-2): the status line is never counted as the answer. */
export function latencyRow(t) {
  return { transcriptMs: since(t, "finalAt"), firstModelTokenMs: since(t, "firstTokenAt"), statusAckAudibleMs: since(t, "delayAckPlaybackAt"), firstAudibleAnswerMs: since(t, "firstPlaybackAt"), completedMs: since(t, "completedAt"), delayAck: !!t?.delayAckAt };
}
export const latencyStats = (rows) => Object.fromEntries(["transcriptMs", "firstModelTokenMs", "statusAckAudibleMs", "firstAudibleAnswerMs", "completedMs"].map((k) => [k, stats(rows.map((r) => r[k]))]));
/**
 * A push-to-talk turn is over once its answer completed, or it ended with no recognition. The transcript alone is not
 * enough: it arrives before any playback (attended S1, 2026-10-30: 24/24 answer-audio timings were empty when read then).
 */
export const answerSettled = (v, beforeTurnId) => v.turnId !== beforeTurnId && !v.capturing && (v.timing?.completedAt != null || (v.state === "IDLE" && v.finalTranscript == null));

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--print-template")) { console.log(JSON.stringify(authorizationTemplate(), null, 2)); return; }
  const FIXTURE = argv.includes("--fixture");
  const authPath = argv[argv.indexOf("--authorization") + 1];
  if (!FIXTURE && (!argv.includes("--authorization") || !authPath)) throw new Error("Refused: --authorization <file> is required. Nothing was opened.");
  const auth = FIXTURE ? { ...authorizationTemplate(), maxMinutes: 30, maxPlaybackVolumePercent: 100, authorizedAt: new Date().toISOString() } : JSON.parse(readFileSync(authPath, "utf8"));
  const problems = FIXTURE ? [] : validateAuthorization(auth);
  if (problems.length) throw new Error(`Refused: the authorization is not valid (${problems.join("; ")}). Nothing was opened.`);
  const sections = argv.includes("--sections") ? argv[argv.indexOf("--sections") + 1].split(",").map(Number) : Object.keys(SECTIONS).map(Number);
  if (argv.includes("--check")) { console.log(JSON.stringify({ valid: true, budgetMinutes: Math.floor(sessionBudgetMs(auth) / 60_000), sections: sections.map((s) => `${s}: ${SECTIONS[s]}`), trials: TRIALS, phrases: PHRASES }, null, 2)); return; }

  // Imported only here: --check and --print-template load no Host code.
  const { spawnSync } = await import("node:child_process");
  const { mkdtempSync, rmSync, mkdirSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const readline = await import("node:readline/promises");
  const { startHost } = await import("../../src/lib/bunny-host/http.server.ts");
  const { defaultAdapters } = await import("../../src/lib/bunny-host/adapters.server.ts");
  const { writeEvidence } = await import("../evidence-guard.mjs");
  const rl = FIXTURE ? null : readline.createInterface({ input: process.stdin, output: process.stdout });
  const PORT = Number(process.env.BUNNY_E2E_PORT ?? 43216);
  const dataDirectory = mkdtempSync(join(tmpdir(), "bunny-p4-acoustic-"));
  const deviceNames = FIXTURE ? [] : [auth.microphone, auth.speakers];
  const cls = (c) => (FIXTURE ? "simulated" : c);
  const out = { evidenceClass: FIXTURE ? "simulated: synthesized input and null sink; nothing here is acoustic evidence" : "attended session: acoustic and software receipts, labelled per section", schema: "ma5-s2-p4r1.acoustic/1", script: SCRIPT_ID, at: new Date().toISOString(), authorization: { maxMinutes: auth.maxMinutes, maxPlaybackVolumePercent: auth.maxPlaybackVolumePercent }, privacy: "no audio saved or uploaded; recognitions stored as phrase id + word-error count; no device names", sections: {} };
  let host = null;
  let hostStarting = null;
  let recovering = false;
  // A session starts only with zero voice workers running, so every worker seen afterwards is this session's.
  const workerPids = () => [...spawnSync("tasklist", ["/FI", "IMAGENAME eq bunny-voice-worker.exe", "/FO", "CSV", "/NH"], { encoding: "utf8", windowsHide: true }).stdout.matchAll(/"bunny-voice-worker\.exe","(\d+)"/gi)].map((m) => Number(m[1]));
  const post = (action, data, signal) => fetch(`http://127.0.0.1:${PORT}/command`, { method: "POST", signal, headers: { authorization: `Bearer ${host.token}`, "content-type": "application/json" }, body: JSON.stringify({ action, data, operationId: crypto.randomUUID() }) })
    .then(async (res) => { const body = await res.json().catch(() => ({})); if (!res.ok) throw new Error(`${action}: ${body.error ?? res.status}`); return body; });
  const shutdown = createShutdown({
    // Playback first (cancel the reply), then the session close ends capture and shuts the worker down.
    stopAudio: async () => { if (!host) return; await post("voice.interrupt", { source: "session_close" }, AbortSignal.timeout(SHUTDOWN_STEP_MS)).catch(() => {}); await post("voice.session.close", { source: "e2e" }, AbortSignal.timeout(SHUTDOWN_STEP_MS)); },
    // A Host still starting when the session stops is awaited (within the step bound) and closed too.
    closeHost: async () => { host ??= (await hostStarting?.catch(() => null)) ?? null; if (host) await host.close(); },
    ownedWorkers: async () => workerPids(),
    forceKill: async (pids) => { for (const pid of pids) spawnSync("taskkill", ["/F", "/T", "/PID", String(pid)], { windowsHide: true }); },
  });
  // --fixture-budget-ms: self-check of a real expiry against the real Host and worker (simulated runs only).
  const budgetMs = FIXTURE && argv.includes("--fixture-budget-ms") ? Number(argv[argv.indexOf("--fixture-budget-ms") + 1]) : sessionBudgetMs(auth);
  const guard = createSessionGuard({ budgetMs, onStop: (reason) => { if (reason.code !== "COMPLETED") console.error(`\nStopping: ${reason.code}`); void shutdown(); } });
  const ops = sessionPrimitives({ guard, send: post, ask: rl ? (text, signal) => rl.question(`\n${text}\n  [Enter] go  ·  s + Enter skip  ·  q + Enter end the session > `, { signal }) : null });
  const { sleep, cmd, voice, until, prompt } = ops;
  if (FIXTURE) console.log("[fixture] prompts are auto-answered");
  const say = async (text) => { const a = await prompt(`Say clearly: "${text.replace(/\|/g, "… (pause one second) …")}"`); if (a === "q") guard.stop("ENDED_BY_OWNER"); guard.check(); return a !== "s"; };
  const endpointReads = { count: 0, maxVolumePercent: null };
  let watcher = null;
  try {
    if (workerPids().length !== 0) throw new SessionStop("WORKER_ALREADY_RUNNING", "close every running bunny-voice-worker.exe first");
    hostStarting = startHost({ port: PORT, dataDirectory, adapters: defaultAdapters().filter((a) => a.id === "ollama"), ...(FIXTURE ? { voice: { workerExtraArgs: ["--input-synth", "what failed", "--output", "null"] } } : {}) });
    host = await guard.race(hostStarting);
    await guard.race(host.manager.discover());

    // Device gate: push-to-talk open captures nothing and plays nothing; the worker reports the default endpoints. Read only.
    await cmd("voice.session.open", { mode: "push_to_talk" });
    await cmd("voice.devices");
    const opened = await until(async () => { const s = await voice(); return s.open && s.devices?.input && s.devices?.output ? s : null; });
    const dev = opened?.devices;
    if (FIXTURE && dev) Object.assign(auth, { microphone: dev.input?.name, speakers: dev.output?.name }); // simulated run: the observed endpoints stand in
    const gate = checkEndpoints(dev, auth);
    out.devices = { inputAuthorized: !gate.problems.includes("UNAUTHORIZED_INPUT"), outputAuthorized: !gate.problems.includes("UNAUTHORIZED_OUTPUT"), outputVolumePercent: gate.volumePercent, outputMuted: gate.outputMuted, inputMuted: dev?.input?.muted ?? null, micPrivacy: dev?.micPrivacy ?? null, stt: opened?.engines?.stt ?? null };
    if (!gate.ok) throw new SessionStop("ENDPOINT_NOT_AUTHORIZED", gate.problems.join(","));
    if (dev.micPrivacy === "deny") throw new SessionStop("MIC_PRIVACY_DENIED", "Windows microphone privacy denies access; Bunny does not change it");
    watcher = watchEndpoints({ ops, guard, auth, onRead: (r) => { endpointReads.count++; endpointReads.maxVolumePercent = Math.max(endpointReads.maxVolumePercent ?? 0, r.volumePercent ?? 0); }, tolerated: () => (recovering ? ["UNAUTHORIZED_INPUT"] : []) });
    while (!FIXTURE && (await voice()).devices?.input?.muted) {
      if ((await prompt("The microphone is muted. Unmute it yourself in Windows (Bunny never will), then continue.")) === "q") guard.stop("ENDED_BY_OWNER");
    }

    const lastTurn = async (before, ms = 30_000) => until(async () => { const s = await voice(); return s.turnId !== before && (s.finalTranscript != null || s.state === "IDLE") && !s.capturing ? s : null; }, ms);
    // `waitAnswer`: also wait for the spoken answer to complete, so the turn's timing holds every stage.
    const pushToTalk = async (phraseId, phrase, waitAnswer = false) => {
      const before = (await voice()).turnId;
      await cmd("voice.listen.start", { source: "button" });
      if (!(await say(phrase))) { await cmd("voice.listen.end", {}); return null; }
      const s = waitAnswer ? await until(async () => { const v = await voice(); return answerSettled(v, before) ? v : null; }, 60_000) : await lastTurn(before, 20_000);
      return { ...scoreTurn(phraseId, phrase, s?.finalTranscript ?? null), ...(waitAnswer ? latencyRow(s?.timing) : {}) };
    };
    const want = (n) => sections.includes(n);

    if (want(1) || want(8)) {
      const rows = [];
      for (const [i, p] of PHRASES.stt.entries()) for (let k = 0; k < TRIALS.stt; k++) { const r = await pushToTalk(`stt-${i}`, p); if (r) rows.push(r); await sleep(1_500); }
      const scored = rows.filter((r) => r.wordErrors != null);
      out.sections.stt = { class: cls("acoustic"), engine: out.devices.stt, trials: rows, exactRate: rate(rows.filter((r) => r.outcome === "exact").length, rows.length), wordErrors: scored.reduce((s, r) => s + r.wordErrors, 0), refWords: scored.reduce((s, r) => s + r.refWords, 0) };
    }
    if (want(7)) {
      const rows = [];
      for (let i = 0; i < TRIALS.latency; i++) { const r = await pushToTalk(`stt-${i % 2}`, PHRASES.stt[i % 2], true); if (r) rows.push(r); await sleep(3_000); }
      out.sections.latency = { class: cls("software receipt with real capture"), boundary: "Host speechEndAt (VAD speech_end after 900 ms endpoint silence) to each stage; audible = the worker's playback.started, speaker output latency not included", trials: rows, ...latencyStats(rows) };
    }

    // Hands-free: Bunny speaks a long answer; each trial is one reply.
    const speakLong = async () => { await cmd("voice.text", { text: "Tell me a six sentence story about a careful rabbit who plans a garden." }); return until(async () => { const s = await voice(); return s.playing ? s : null; }, 120_000); };
    const settle = () => until(async () => { const s = await voice(); return !s.playing && ["IDLE", "INTERRUPTED", "LISTENING"].includes(s.state) ? s : null; }, 120_000);
    // T12-PRIV-01: opening hands-free mode never opens the microphone; only an explicit Start hands-free does (attended
    // S3, 2026-10-30, ran without it: 0/12 interruptions and an empty echo result).
    const startDuplex = async () => { await cmd("voice.listen.start", { source: "hands_free" }); return until(async () => (await voice()).duplex?.active, 15_000); };
    // Without a live duplex lane the microphone is closed while Bunny speaks, so echo and barge-in trials would be vacuous.
    // The lane can end mid-section (fixture check, 2026-10-30: DEVICE_BUSY "capture already active" after an interrupted
    // reply). Each loss is evidence; the start is repeated, and a lane that does not come back stops the session.
    const duplexLosses = (out.duplexLosses = []);
    const requireDuplex = async () => {
      const v = await voice();
      if (v.duplex?.active) return;
      duplexLosses.push({ reason: v.duplex?.stopped?.reason ?? null, errorCode: v.error?.code ?? null, state: v.state ?? null });
      if (!(await startDuplex())) throw new SessionStop("DUPLEX_NOT_ACTIVE", "the hands-free microphone is not listening during playback");
    };
    const bargeTrial = async (phraseId, phrase) => {
      await requireDuplex();
      const before = (await voice()).lastBargeIn?.inputTurnId ?? null;
      const playing = await speakLong();
      if (!playing) return null;
      // Replies end on their own, never by the stop button: with the hands-free microphone live, interrupt() aborts and
      // re-arms the capture before the worker released it, and the lane ends with DEVICE_BUSY (fixture check 2026-10-30, 4/4).
      // A silent trial so listens through the whole reply.
      if (phrase && !(await say(phrase))) { await settle(); return null; }
      if (!phrase) await settle();
      const s = await until(async () => { const v = await voice(); return v.lastBargeIn && v.lastBargeIn.inputTurnId !== before && v.lastBargeIn.outcome !== "pending" ? v : null; }, phrase ? 15_000 : 1_000);
      const r = s?.lastBargeIn ?? null;
      await settle();
      return { phraseId, outcome: r?.outcome ?? "none", onsetToSilenceMs: r?.onsetToSilenceMs ?? null, detectionToSilenceMs: r?.detectionToSilenceMs ?? null, wasAudible: r?.wasAudible ?? null, echoRejected: r?.echoRejected ?? 0, reason: r?.reason ?? null };
    };
    if ([2, 3, 4, 5, 6, 9].some(want)) {
      await cmd("voice.session.open", { mode: "hands_free" });
      if (!(await startDuplex())) throw new SessionStop("DUPLEX_NOT_ACTIVE", "the hands-free microphone did not start");
      if (want(2) || want(3)) {
        await prompt(`Stay silent while Bunny speaks (${TRIALS.echo} replies). Normal room noise is fine.`);
        const r = [];
        out.sections.echo = { class: cls("acoustic"), trials: r };
        for (let i = 0; i < TRIALS.echo; i++) { const x = await bargeTrial("silent", null); if (x) r.push(x); }
        Object.assign(out.sections.echo, { falseInterruptRate: rate(r.filter((x) => x.outcome === "interrupted").length, r.length), echoTranscriptsRejected: r.reduce((s, x) => s + x.echoRejected, 0) });
      }
      if (want(4)) {
        const rows = [];
        out.sections.interrupt = { class: cls("acoustic"), trials: rows };
        for (const [i, p] of PHRASES.interrupt.entries()) for (let k = 0; k < Math.ceil(TRIALS.interrupt / 2); k++) { const r = await bargeTrial(`interrupt-${i}`, p); if (r) rows.push(r); }
        const ok = rows.filter((x) => x.outcome === "interrupted");
        Object.assign(out.sections.interrupt, { boundary: "worker-monotonic speech onset to render-meter silence (onsetToSilenceMs); capture delay before the worker sees a frame is not included", target: `P95 <= ${BARGE_IN_TARGET_MS} ms where applicable`, trials: rows, interruptRate: rate(ok.length, rows.length), onsetToSilenceMs: stats(ok.map((x) => x.onsetToSilenceMs)), detectionToSilenceMs: stats(ok.map((x) => x.detectionToSilenceMs)) });
      }
      if (want(5)) {
        const rows = [];
        out.sections.backchannel = { class: cls("acoustic"), trials: rows };
        for (const [i, p] of PHRASES.backchannel.entries()) for (let k = 0; k < Math.ceil(TRIALS.backchannel / 2); k++) { const r = await bargeTrial(`backchannel-${i}`, p); if (r) rows.push(r); }
        Object.assign(out.sections.backchannel, { resumedRate: rate(rows.filter((x) => x.outcome === "resumed" || x.outcome === "none").length, rows.length), falseInterruptRate: rate(rows.filter((x) => x.outcome === "interrupted").length, rows.length) });
      }
      if (want(6)) {
        const rows = [];
        out.sections.pauses = { class: cls("acoustic"), trials: rows };
        for (const [i, p] of PHRASES.pause.entries()) for (let k = 0; k < TRIALS.pause; k++) {
          const before = (await voice()).turnId;
          await requireDuplex();
          if (!(await say(p))) continue;
          const s = await until(async () => { const v = await voice(); return v.turnId !== before && v.finalTranscript ? v : null; }, 20_000);
          const score = scoreTurn(`pause-${i}`, p, s?.finalTranscript ?? null);
          rows.push({ ...score, splitIntoTwoTurns: score.wordErrors == null ? null : score.wordErrors / score.refWords > 0.4 });
          await settle();
        }
        out.sections.pauses.wholeUtteranceRate = rate(rows.filter((r) => r.splitIntoTwoTurns === false).length, rows.length);
      }
      if (want(9)) {
        let stop = false; let done = 0; let failed = 0;
        const t0 = performance.now();
        const lane = async () => {
          try {
            while (!stop && !guard.signal.aborted) {
              const t = host.manager.submit({ prompt: "Write a 150-word explanation of how tides work.", mode: "fast", override: "auto", constraints: { localOnly: true, offlineOnly: true, outputTokens: 250 } });
              const st = await guard.race(new Promise((r) => { host.manager.onTaskOutput(t.id, (e) => { if ("done" in e) r(e.state); }); if (t.state === "waiting_for_approval") host.manager.approve(t.id); }));
              if (st === "completed") done++; else failed++;
            }
          } catch { /* the session stopped; the Host close stops the task */ }
        };
        const lanes = [lane(), lane()];
        const rows = [];
        try {
          for (let i = 0; i < TRIALS.load; i++) {
            const before = (await voice()).turnId;
            await requireDuplex();
            if (!(await say("in one short sentence what does a rabbit eat"))) continue;
            const s = await until(async () => { const v = await voice(); return v.turnId !== before && v.timing?.completedAt ? v : null; }, 120_000);
            rows.push(latencyRow(s?.timing));
          }
        } finally { stop = true; }
        await guard.race(Promise.all(lanes));
        const minutes = (performance.now() - t0) / 60_000;
        out.sections.concurrency = { class: cls("acoustic capture + software receipts"), trials: rows, ...latencyStats(rows), background: { completed: done, notCompleted: failed, completedPerMinute: minutes ? Math.round((done / minutes) * 100) / 100 : null } };
      }
    }
    if (want(10)) {
      const rows = {};
      await cmd("voice.mute", { muted: true });
      const m = await voice();
      rows.mute = { capturing: m.capturing, duplexActive: m.duplex?.active ?? false, state: m.state };
      await cmd("voice.mute", { muted: false });
      await cmd("voice.session.close", { source: "e2e" });
      await until(async () => workerPids().length === 0, 15_000);
      rows.close = { open: (await voice()).open, workers: workerPids().length };
      if ((await prompt("Optional device recovery: open a voice session, then unplug or switch the default microphone, and plug it back. Enter to run it, s to skip.")) !== "s") {
        recovering = true; // push-to-talk open only: nothing captures while the microphone is switched
        await cmd("voice.session.open", { mode: "push_to_talk" });
        await prompt("Unplug or switch the default microphone now; Enter when done.");
        const lost = await voice();
        await prompt("Restore the microphone now; Enter when done.");
        const back = await until(async () => { const s = await voice(); return s.devices?.input?.present ? s : null; }, 30_000);
        recovering = false;
        rows.recovery = { duringLoss: { state: lost.state, inputPresent: lost.devices?.input?.present ?? null }, after: back ? { state: back.state, inputPresent: true, inputAuthorized: back.devices.input.name === auth.microphone } : null };
      }
      out.sections.controls = { class: cls("acoustic device + software receipts"), ...rows };
    }
    guard.stop("COMPLETED");
  } catch (e) {
    const reason = guard.signal.aborted ? guard.signal.reason : e;
    if (!guard.signal.aborted) guard.stop(e instanceof SessionStop ? e.code : "FAILED", e?.message);
    out.failure = safeFailure(reason, deviceNames);
    console.error(`Session ended: ${out.failure.code}${out.failure.detail ? ` (${out.failure.detail})` : ""}`);
  } finally {
    guard.stop("COMPLETED");
    guard.dispose();
    out.stop = { code: guard.signal.reason.code, elapsedMs: Math.round(guard.elapsedMs()) };
    out.shutdown = await shutdown();
    await watcher;
    out.endpointMonitor = { reads: endpointReads.count, maxVolumePercent: endpointReads.maxVolumePercent, intervalMs: 1_000 };
    rl?.close();
    const file = `docs/ma5-s2/evidence/voice/${FIXTURE ? "acoustic-harness-selfcheck" : "acoustic-session"}.json`;
    mkdirSync("docs/ma5-s2/evidence/voice", { recursive: true });
    let evidence = out;
    try { assertPrivateEvidence(out, deviceNames); } catch (e) { evidence = { schema: out.schema, evidenceClass: out.evidenceClass, at: out.at, refused: "EVIDENCE_PRIVACY_REFUSED", check: redact(e.message, deviceNames), stop: out.stop, shutdown: out.shutdown }; }
    writeEvidence(file, evidence, host ? [host.token] : []);
    rmSync(dataDirectory, { recursive: true, force: true });
    console.log(`Evidence: ${file} (no audio; phrase ids and counts only).`);
    // Last resort: a worker that survived the forced step dies with this process (its job is kill-on-close).
    if (out.stop.code !== "COMPLETED") process.exitCode = 2;
    if (!out.shutdown.clean) { process.exitCode = 3; setTimeout(() => process.exit(3), 100).unref(); }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(redact(e.message, [], Infinity)); process.exitCode = 1; });
}
