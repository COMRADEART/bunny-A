// M-A-3 T10 live diagnostic: drives the built voice worker directly on REAL devices (no fixture flags) and prints
// every event except per-buffer levels (summarized). Optional acoustic loopback phrase (synthetic speaker, labelled).
// Usage: node worker-probe.mjs [phrase] [endpointing=vad|manual] [outJson]
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const root = resolve(import.meta.dirname, "../../../..");
const phrase = process.argv[2] ?? "";
const endpointing = process.argv[3] ?? "vad";
const worker = spawn(resolve(root, "native/voice/bunny-voice-worker.exe"), [], { stdio: ["pipe", "pipe", "pipe"] });
const events = [];
let buf = "";
let levels = { n: 0, maxRms: 0, maxPeak: 0, speechFrames: 0 };
worker.stdout.on("data", (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    const e = JSON.parse(line);
    if (e.ev === "level") { levels.n++; levels.maxRms = Math.max(levels.maxRms, e.rms); levels.maxPeak = Math.max(levels.maxPeak, e.peak); if (e.speech) levels.speechFrames++; continue; }
    events.push(e);
    console.log(JSON.stringify(e));
  }
});
worker.stderr.on("data", (d) => process.stderr.write("[stderr] " + d));
const send = (o) => worker.stdin.write(JSON.stringify(o) + "\n");
await sleep(1500);
send({ op: "capture.start", turn: "probe-1", gen: 1, device: -1, endpointing, maxMs: 20000 });
if (phrase) {
  await sleep(1200);
  spawn("powershell.exe", ["-NoProfile", "-Command", `Add-Type -AssemblyName System.Speech; $s=New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.SelectVoice('Microsoft Zira Desktop'); $s.Speak('${phrase.replaceAll("'", "''")}')`], { stdio: "ignore" });
}
const t0 = Date.now();
while (Date.now() - t0 < 25000 && !events.some((e) => e.ev === "stt.final" || e.ev === "stt.none")) await sleep(100);
if (endpointing === "manual" && !events.some((e) => e.ev === "stt.final" || e.ev === "stt.none")) send({ op: "capture.end", turn: "probe-1", gen: 1 });
await sleep(3000);
send({ op: "shutdown" });
await sleep(1500);
console.log("LEVELS", JSON.stringify(levels));
if (process.argv[4]) writeFileSync(process.argv[4], JSON.stringify({ phrase, endpointing, classification: phrase ? "LIVE acoustic loopback (synthetic Zira voice through real speakers into the real microphone)" : "LIVE real microphone, ambient only", levels, events }, null, 2));
