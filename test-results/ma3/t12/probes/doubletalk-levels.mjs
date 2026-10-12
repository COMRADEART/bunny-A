// M-A-3 T12 diagnostic: worker A runs the AEC lane AND speaks a long sentence; a HUMAN talks over it. Worker B records
// the raw microphone for comparison. Level numbers, VAD events and transcripts only; no audio retained.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { launchVoiceWorker } from "../../../../src/lib/bunny-host/voice/voice-worker.server.ts";
const mk = (p) => launchVoiceWorker({ dataDirectory: mkdtempSync(join(tmpdir(), p)) });
const A = await mk("bunny-t12-dt-a-"), B = await mk("bunny-t12-dt-b-");
const ev = [];
A.onEvent((e) => ev.push({ w: "A", ...e, at: Date.now() }));
B.onEvent((e) => ev.push({ w: "B", ...e, at: Date.now() }));
await sleep(700);
A.send({ op: "duplex.start", session: "dt", maxMs: 300000 });
for (let i = 0; i < 60 && !ev.some((e) => e.ev === "duplex.started" || e.ev === "duplex.error"); i++) await sleep(100);
A.send({ op: "capture.start", turn: "a1", gen: 1, device: -1, endpointing: "manual", maxMs: 30000, duplex: true, session: "dt" });
B.send({ op: "capture.start", turn: "b1", gen: 1, device: -1, endpointing: "manual", maxMs: 30000 });
await sleep(600);
A.send({ op: "speak", turn: "s1", gen: 1, seq: 0, text: process.argv[3] || "I am going to read a long sentence now so that you can talk over me. The quick brown fox jumps over the lazy dog, and then it runs across the field, past the old barn, over the little bridge, and all the way down to the river where it finally stops to rest in the shade of a tall willow tree.", device: -1, voice: null });
await sleep(Number(process.argv[2] ?? 18000));
A.send({ op: "capture.end", turn: "a1", gen: 1 }); B.send({ op: "capture.end", turn: "b1", gen: 1 });
await sleep(7000);
A.send({ op: "duplex.stop", session: "dt" });
await sleep(800);
await A.close(); await B.close();
const t0 = ev[0].at;
const a = ev.filter((e) => e.w === "A" && e.ev === "level"), b = ev.filter((e) => e.w === "B" && e.ev === "level");
const rows = [];
for (const e of ev) {
  if (e.w === "A" && e.ev === "level") { const r = b.reduce((best, x) => (Math.abs(x.at - e.at) < Math.abs((best?.at ?? 1e15) - e.at) ? x : best), null); rows.push(`${e.at - t0}\tAEC ${e.rms.toFixed(5)} pk=${e.peak.toFixed(4)} res=${e.residual == null ? "-" : e.residual.toFixed(4)} out=${e.outputActive ? 1 : 0} sp=${e.speech ? 1 : 0}\tRAW ${r ? r.rms.toFixed(5) : "-"}`); }
  else if (["vad", "stt.final", "stt.partial", "playback.started", "playback.idle", "duplex.error", "capture.error"].includes(e.ev)) rows.push(`${e.at - t0}\t${e.w} ${e.ev} ${e.state ?? ""} ${e.text ?? e.message ?? ""} ${e.confidence ?? ""}`);
}
writeFileSync(process.argv[4] ?? "doubletalk-levels.txt", rows.join("\n"));
console.log(rows.join("\n"));
