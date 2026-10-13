// T10 F3 live probe (owner: voice worker). Real default output device, synthetic SAPI long sentence (labelled synthetic),
// speak.cancel sent ~800 ms after playback.started. Reports speak.cancelled meterSilentMs / resetMs / staleDropped.
// Usage: node barge-in-probe.mjs <label> <outJson>
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
    const hit = events.find(pred);
    if (hit) return hit;
    await sleep(20);
  }
  throw new Error("timed out");
}
await waitFor((e) => e.ev === "ready");
const long = "Bunny is reading out a long status report about every agent in the workspace, including the tests that are still running and the builds that finished earlier today.";
send({ op: "speak", turn: "bi-1", gen: 1, seq: 0, text: long, device: -1, voice: null });
const started = await waitFor((e) => e.ev === "playback.started" && e.turn === "bi-1");
await sleep(800);
send({ op: "speak.cancel", gen: 1 });
const cancelled = await waitFor((e) => e.ev === "speak.cancelled" && e.gen === 1, 8000);
await sleep(500);
send({ op: "shutdown" });
await sleep(800);
const row = { label, cancelledAfterStartedMs: cancelled.mono - started.mono, wasPlaying: cancelled.wasPlaying, resetMs: cancelled.resetMs, meterSilentMs: cancelled.meterSilentMs, droppedChunks: cancelled.droppedChunks, staleDropped: cancelled.staleDropped ?? "absent" };
console.log(JSON.stringify(row));
writeFileSync(process.argv[3] ?? "barge-in.json", JSON.stringify({ classification: "LIVE real default output device; synthetic SAPI sentence (not a human voice)", row, events }, null, 2));
