// M-A-3 T10 live: guided HUMAN speech-recognition session on REAL devices. Bunny speaks each prompt through the
// speakers ("Please say: ..."), waits for playback to finish (half duplex), then captures the user's reply from the
// real microphone with VAD endpointing. Retains ONLY text, confidence, timing and level receipts — never audio.
// Usage: node human-stt-session.mjs <outJson> [maxPhrases]
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const root = resolve(import.meta.dirname, "../../../..");
const PHRASES = [
  "What is my agent doing?",
  "Did the tests pass?",
  "Which model is working?",
  "What needs my approval?",
  "Pause the agent.",
  "What is the capital of France?",
  "Tell me a short joke.",
  "Stop the current mission.",
  "Open the agentic workspace.",
  "What happened in my last mission?",
];
const out = process.argv[2];
const max = Number(/^d+$/.test(process.argv[3] ?? "") ? process.argv[3] : PHRASES.length);
// Engine: "--engine whisper" uses the staged, pin-verified whisper.cpp runtime (same flags the Host passes); default SAPI.
const engineArg = process.argv.indexOf("--engine");
const engine = engineArg > 0 ? process.argv[engineArg + 1] : "sapi";
const runtime = resolve(root, "native/voice/vendor/runtime");
const workerArgs = engine === "whisper" ? ["--stt", "whisper", "--whisper-dir", runtime, "--whisper-model", resolve(runtime, "models/ggml-base.en.bin"), "--whisper-threads", "4"] : [];
const worker = spawn(resolve(root, "native/voice/bunny-voice-worker.exe"), workerArgs, { stdio: ["pipe", "pipe", "pipe"] });
const listeners = new Set();
let buf = "";
worker.stdout.on("data", (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (line) { const e = JSON.parse(line); for (const l of listeners) l(e); }
  }
});
const send = (o) => worker.stdin.write(JSON.stringify(o) + "\n");
const waitFor = (pred, ms) => new Promise((res) => {
  const t = setTimeout(() => { listeners.delete(f); res(null); }, ms);
  const f = (e) => { if (pred(e)) { clearTimeout(t); listeners.delete(f); res(e); } };
  listeners.add(f);
});
const readyEv = await waitFor((e) => e.ev === "ready", 15000);
console.log("engine:", JSON.stringify(readyEv?.stt));
const words = (s) => (s ?? "").toLowerCase().replace(/[^a-z0-9' ]/g, " ").split(/\s+/).filter(Boolean);
const wer = (ref, hyp) => {
  const r = words(ref), h = words(hyp);
  const d = Array.from({ length: r.length + 1 }, (_, i) => [i, ...Array(h.length).fill(0)]);
  for (let j = 1; j <= h.length; j++) d[0][j] = j;
  for (let i = 1; i <= r.length; i++) for (let j = 1; j <= h.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (r[i - 1] === h[j - 1] ? 0 : 1));
  return r.length ? d[r.length][h.length] / r.length : 0;
};
const results = [];
let gen = 0;
for (const phrase of PHRASES.slice(0, max)) {
  gen++;
  const turn = `human-${gen}`;
  send({ op: "speak", turn, gen, seq: 0, text: `Please say: ${phrase}`, device: -1, voice: null });
  await waitFor((e) => e.ev === "playback.idle" && e.gen === gen, 20000);
  await sleep(250);
  const levels = { n: 0, maxRms: 0, speechFrames: 0 };
  const partials = [];
  const env = [];
  const lf = (e) => { if (e.gen !== gen) return; if (e.ev === "level") { levels.n++; levels.maxRms = Math.max(levels.maxRms, e.rms); if (e.speech) levels.speechFrames++; env.push([Math.round(e.mono), Number(e.rms.toFixed(4)), e.speech ? 1 : 0]); } if (e.ev === "stt.partial") partials.push(e.text); };
  listeners.add(lf);
  const t0 = Date.now();
  send({ op: "capture.start", turn, gen, device: -1, endpointing: "vad", maxMs: 9000 });
  const started = await waitFor((e) => (e.ev === "capture.started" || e.ev === "capture.error") && e.gen === gen, 4000);
  // Cue: a short beep from a SEPARATE process the moment the device is confirmed open, so the speaker starts after it
  // (the beep itself precedes speech and is not a word). Envelope timing below tells clipped onsets from misrecognition.
  let openMono = started?.ev === "capture.started" ? started.mono : null;
  if (openMono !== null) spawn("powershell.exe", ["-NoProfile", "-Command", "[console]::Beep(880,150)"], { stdio: "ignore" });
  const end = await waitFor((e) => (e.ev === "stt.final" || e.ev === "stt.none") && e.gen === gen, 15000);
  listeners.delete(lf);
  const firstLoud = env.find((x) => x[1] >= 0.004 && openMono !== null && x[0] - openMono > 350);
  const r = { firstLoudMsAfterOpen: firstLoud && openMono !== null ? firstLoud[0] - openMono : null, envelope: env.map((x) => [openMono !== null ? x[0] - openMono : x[0], x[1], x[2]]), phrase, capture: started?.ev ?? "timeout", captureError: started?.code ?? null, result: end?.ev ?? "timeout", text: end?.text ?? null, reason: end?.reason ?? null, confidence: end?.confidence ?? null, wer: end?.text ? Number(wer(phrase, end.text).toFixed(3)) : 1, partialCount: partials.length, firstPartial: partials[0] ?? null, msToTerminal: Date.now() - t0, levels };
  results.push(r);
  console.log(JSON.stringify(r));
}
send({ op: "shutdown" });
await sleep(1000);
const finals = results.filter((r) => r.result === "stt.final");
const summary = {
  classification: "LIVE human speech, real microphone + real speakers (prompts spoken by Bunny); text/level receipts only, no audio retained",
  engine: readyEv?.stt ?? null,
  phrases: results.length,
  finals: finals.length,
  exactOrNear: results.filter((r) => r.wer <= 0.25).length,
  meanWer: Number((results.reduce((a, r) => a + r.wer, 0) / Math.max(1, results.length)).toFixed(3)),
  meanConfidence: finals.length ? Number((finals.reduce((a, r) => a + r.confidence, 0) / finals.length).toFixed(3)) : null,
};
console.log("SUMMARY", JSON.stringify(summary));
if (out) writeFileSync(out, JSON.stringify({ summary, results, at: new Date().toISOString() }, null, 2));
