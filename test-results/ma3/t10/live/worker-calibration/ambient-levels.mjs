// T10 calibration (owner: voice worker). Live, ambient-only: captures the REAL default microphone for N seconds
// with no speech played, and prints the per-window level series (rms/peak) so the noise floor can be measured.
// Usage: node ambient-levels.mjs <seconds> <outJson>
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
const root = resolve(import.meta.dirname, "../../../../..");
const seconds = Number(process.argv[2] ?? 6);
const worker = spawn(resolve(root, "native/voice/bunny-voice-worker.exe"), [], { stdio: ["pipe", "pipe", "pipe"] });
const levels = [];
const events = [];
let buf = "";
worker.stdout.on("data", (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    const e = JSON.parse(line);
    if (e.ev === "level") levels.push({ rms: e.rms, peak: e.peak, speech: e.speech });
    else events.push(e);
  }
});
const send = (o) => worker.stdin.write(JSON.stringify(o) + "\n");
await sleep(1500);
send({ op: "capture.start", turn: "ambient-1", gen: 1, device: -1, endpointing: "manual", maxMs: seconds * 1000 + 2000 });
await sleep(seconds * 1000);
send({ op: "capture.end", turn: "ambient-1", gen: 1 });
await sleep(3000);
send({ op: "shutdown" });
await sleep(1000);
const rms = levels.map((l) => l.rms).sort((a, b) => a - b);
const pct = (p) => rms[Math.min(rms.length - 1, Math.floor(rms.length * p))];
const summary = { windows: levels.length, rmsP10: pct(0.1), rmsP50: pct(0.5), rmsP90: pct(0.9), rmsP99: pct(0.99), rmsMax: rms[rms.length - 1], peakMax: Math.max(...levels.map((l) => l.peak)) };
console.log("SUMMARY", JSON.stringify(summary));
console.log("EVENTS", JSON.stringify(events.filter((e) => e.ev !== "devices")));
writeFileSync(process.argv[3] ?? "ambient.json", JSON.stringify({ classification: "LIVE real microphone, ambient only, no phrase played", seconds, summary, levels, events }, null, 2));
