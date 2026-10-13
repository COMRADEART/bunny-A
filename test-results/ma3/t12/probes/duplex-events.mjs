// M-A-3 T12 diagnostic: prints every worker event for a short real-device duplex session (no audio retained).
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { launchVoiceWorker } from "../../../../src/lib/bunny-host/voice/voice-worker.server.ts";
const w = await launchVoiceWorker({ dataDirectory: mkdtempSync(join(tmpdir(), "bunny-t12-dbg-")) });
w.onEvent((e) => { if (e.ev !== "level") console.log(JSON.stringify(e).slice(0, 400)); else if (Math.random() < 0.05) console.log("level", e.rms, e.floor, e.residual); });
await sleep(800);
w.send({ op: "duplex.start", session: "dbg", maxMs: 60000 });
await sleep(1500);
w.send({ op: "capture.start", turn: "a1", gen: 1, device: -1, endpointing: "manual", maxMs: 30000, duplex: true, session: "dbg" });
await sleep(Number(process.argv[2] ?? 4000));
w.send({ op: "duplex.stop", session: "dbg" });
await sleep(1500);
await w.close();
