/**
 * M-A-3 T10 H9 test fixture: a child "Host" that launches one contained voice worker and waits. The containment test
 * kills this process and checks that the worker dies with it (kill-on-close). Test-only; never started by production code.
 * With a second argument `capture`, it also opens a 30 s capture (synthesized input, null output) and reports CAPTURING
 * once the worker confirms it, so the kill lands while audio capture is live (S3R1).
 */
import { launchVoiceWorker } from "./voice-worker.server.ts";

const dataDirectory = process.argv[2];
if (!dataDirectory) throw new Error("usage: voice-worker-host.fixture.ts <dataDirectory> [capture]");
const capture = process.argv[3] === "capture";
const worker = await launchVoiceWorker({ dataDirectory, extraArgs: ["--output", "null", "--input-synth", "What is the capital of France?"] });
let pid = 0;
worker.onEvent((event) => {
  if (event.ev === "ready") {
    pid = event.pid;
    if (capture) worker.send({ op: "capture.start", turn: "hostkill-1", gen: 0, device: -1, endpointing: "manual", maxMs: 30_000 });
    else process.stdout.write(`READY ${pid}\n`);
  }
  if (event.ev === "capture.started") process.stdout.write(`CAPTURING ${pid}\n`);
});
setInterval(() => {}, 1_000);
