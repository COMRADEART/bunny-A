// M-A-3 T10 live diagnostic: per-100 ms RMS envelope of the REAL microphone from capture.started, for a few prompted
// human phrases, to tell "speech began before the device opened" from "the device fades in after opening".
// Retains only level numbers (no audio). Usage: node mic-onset-diagnostic.mjs <outJson> [delayMs=1200]
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const root = resolve(import.meta.dirname, "../../../..");
const out = process.argv[2];
const PHRASES = ["Did the tests pass?", "What is my agent doing?", "Pause the agent."];
const w = spawn(resolve(root, "native/voice/bunny-voice-worker.exe"), [], { stdio: ["pipe", "pipe", "pipe"] });
const ls = new Set();
let buf = "";
w.stdout.on("data", (d) => { buf += d; let i; while ((i = buf.indexOf("\n")) >= 0) { const l = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (l) { const e = JSON.parse(l); for (const f of ls) f(e); } } });
const send = (o) => w.stdin.write(JSON.stringify(o) + "\n");
const waitFor = (p, ms) => new Promise((r) => { const t = setTimeout(() => { ls.delete(f); r(null); }, ms); const f = (e) => { if (p(e)) { clearTimeout(t); ls.delete(f); r(e); } }; ls.add(f); });
await waitFor((e) => e.ev === "ready", 10000);
const results = [];
let gen = 0;
for (const phrase of PHRASES) {
  gen++;
  const turn = `diag-${gen}`;
  send({ op: "speak", turn, gen, seq: 0, text: `After a short pause, say: ${phrase}`, device: -1, voice: null });
  await waitFor((e) => e.ev === "playback.idle" && e.gen === gen, 20000);
  const levels = [];
  let startedMono = null;
  const lf = (e) => { if (e.gen !== gen) return; if (e.ev === "capture.started") startedMono = e.mono; if (e.ev === "level") levels.push({ ms: startedMono == null ? null : Math.round(e.mono - startedMono), rms: Number(e.rms.toFixed(5)), speech: e.speech }); };
  ls.add(lf);
  const promptEnd = Date.now();
  send({ op: "capture.start", turn, gen, device: -1, endpointing: "manual", maxMs: 6000 });
  await sleep(5000);
  send({ op: "capture.end", turn, gen });
  const fin = await waitFor((e) => (e.ev === "stt.final" || e.ev === "stt.none") && e.gen === gen, 10000);
  ls.delete(lf);
  const firstSpeech = levels.find((l) => l.speech);
  const env = levels.map((l) => `${l.ms}:${l.rms}`).join(" ");
  results.push({ phrase, promptEndToCaptureStartedMs: null, firstSpeechMs: firstSpeech?.ms ?? null, maxRms: Math.max(...levels.map((l) => l.rms)), envelope: levels, sapiText: fin?.text ?? null });
  console.log(`${phrase} | first speech at ${firstSpeech?.ms ?? "none"} ms | env ${env}`);
  void promptEnd;
}
send({ op: "shutdown" });
await sleep(800);
if (out) writeFileSync(out, JSON.stringify({ classification: "LIVE level envelope only (no audio), real microphone", results }, null, 2));
