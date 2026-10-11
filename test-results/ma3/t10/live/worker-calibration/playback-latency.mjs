// T10 F2 live probe (owner: voice worker). Drives the REAL default output device with two short synthetic sentences
// (SAPI, labelled synthetic). Measures tts.ready -> playback.started per turn from worker monotonic timestamps.
// Turn 2 starts ~1 s after turn 1 finished; turn 3 starts after a 6 s pause (beyond the idle keep-open window).
// Usage: node playback-latency.mjs <label> <outJson>
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
const root = resolve(import.meta.dirname, "../../../../..");
const label = process.argv[2] ?? "run";
const worker = spawn(resolve(root, "native/voice/bunny-voice-worker.exe"), [], { stdio: ["pipe", "pipe", "pipe"] });
const events = [];
let buf = "";
worker.stdout.on("data", (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (line) events.push(JSON.parse(line));
  }
});
const send = (o) => worker.stdin.write(JSON.stringify(o) + "\n");
async function waitFor(pred, ms = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (events.some(pred)) return;
    await sleep(50);
  }
  throw new Error("timed out");
}
await waitFor((e) => e.ev === "ready");
const sentences = ["Bunny is checking the agent now.", "Still checking, one moment.", "Done, the agent is idle."];
const gaps = [0, 1000, 6000];
for (let i = 0; i < sentences.length; i++) {
  await sleep(gaps[i]);
  const turn = `pb-${i + 1}`;
  send({ op: "speak", turn, gen: i + 1, seq: 0, text: sentences[i], device: -1, voice: null });
  await waitFor((e) => e.ev === "playback.idle" && e.turn === turn);
}
await sleep(500);
send({ op: "shutdown" });
await sleep(1000);
const rows = [];
for (let i = 1; i <= sentences.length; i++) {
  const turn = `pb-${i}`;
  const ready = events.find((e) => e.ev === "tts.ready" && e.turn === turn);
  const started = events.find((e) => e.ev === "playback.started" && e.turn === turn);
  rows.push({ turn, gapBeforeMs: gaps[i - 1], readyToStartedMs: ready && started ? started.mono - ready.mono : null, audioMs: ready?.audioMs ?? null, errors: events.filter((e) => e.ev === "playback.error" && e.turn === turn).map((e) => e.code) });
}
console.log(label, JSON.stringify(rows));
writeFileSync(process.argv[3] ?? "playback.json", JSON.stringify({ classification: "LIVE real default output device; synthetic SAPI sentences (not a human voice)", label, rows, events }, null, 2));
