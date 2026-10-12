import { launchVoiceWorker } from "../../../../src/lib/bunny-host/voice/voice-worker.server.ts";
import { mkdtempSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";

const root = resolve("test-results/ma3/t12");
const state = mkdtempSync(resolve(tmpdir(), "bunny-t12-aec-"));
const records = [];
const worker = await launchVoiceWorker({ dataDirectory: state });
worker.onEvent(event => {
  if (["ready", "devices", "duplex.started", "duplex.error", "duplex.stopped", "bye"].includes(event.ev)) records.push(event);
});
await new Promise(resolve => setTimeout(resolve, 1000));
worker.send({ op: "devices" });
worker.send({ op: "duplex.start", session: "t12-aec-probe", maxMs: 5000 });
await new Promise(resolve => setTimeout(resolve, 6500));
await worker.close();
const result = { classification: "REAL DEVICE backend probe; no human double-talk or AEC effectiveness claim", at: new Date().toISOString(), records, jobCleanup: worker.closeAccounting };
writeFileSync(resolve(root, "audio-reference-validation.json"), JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify(result));
