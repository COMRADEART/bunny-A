/**
 * M-A-3 T10 H9 test fixture: a child "Host" that launches one contained voice worker and waits. The containment test
 * kills this process and checks that the worker dies with it (kill-on-close). Test-only; never started by production code.
 */
import { launchVoiceWorker } from "./voice-worker.server.ts";

const dataDirectory = process.argv[2];
if (!dataDirectory) throw new Error("usage: voice-worker-host.fixture.ts <dataDirectory>");
const worker = await launchVoiceWorker({ dataDirectory, extraArgs: ["--output", "null", "--input-synth", "What is the capital of France?"] });
worker.onEvent((event) => {
  if (event.ev === "ready") process.stdout.write(`READY ${event.pid}\n`);
});
setInterval(() => {}, 1_000);
