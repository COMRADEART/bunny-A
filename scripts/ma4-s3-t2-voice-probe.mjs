/**
 * MA4-S3-T2 device probe. Enumerates endpoints, then optionally opens one short
 * echo-cancelled duplex session and speaks one sentence. Records counts, not audio.
 * Not a human conversation trial.
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { launchVoiceWorker } from "../src/lib/bunny-host/voice/voice-worker.server.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const acoustic = process.argv.includes("--acoustic");
const outDir = join(root, "docs", "ma4-s3-t2", "evidence");
const directory = mkdtempSync(join(tmpdir(), "bunny-t2-probe-"));
const events = [];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const worker = await launchVoiceWorker({ dataDirectory: directory });
worker.onEvent((event) => events.push(event));

const until = async (predicate, timeout = 12_000) => {
  const start = Date.now();
  for (;;) {
    const found = events.find(predicate);
    if (found) return found;
    if (Date.now() - start > timeout) return null;
    await sleep(20);
  }
};

const summary = {
  evidenceClass: acoustic ? "device-session" : "device-enumeration",
  acousticRequested: acoustic,
  at: new Date().toISOString(),
  ready: null,
  devices: null,
  duplex: null,
  playback: null,
  levelsDuringPlayback: null,
  error: null,
};

try {
  const ready = await until((event) => event.ev === "ready", 20_000);
  summary.ready = ready
    ? { stt: ready.stt?.engine ?? null, tts: ready.tts?.engine ?? null, duplex: ready.duplex ?? null }
    : { timedOut: true };
  worker.send({ op: "devices" });
  const devices = await until((event) => event.ev === "devices", 8_000);
  if (devices) {
    summary.devices = {
      inputCount: devices.inputs?.length ?? 0,
      outputCount: devices.outputs?.length ?? 0,
      micPrivacy: devices.micPrivacy,
      inputPresent: devices.defaultInput?.present ?? null,
      inputMuted: devices.defaultInput?.muted ?? null,
      outputPresent: devices.defaultOutput?.present ?? null,
      outputMuted: devices.defaultOutput?.muted ?? null,
      inputName: devices.defaultInput?.name ?? null,
      outputName: devices.defaultOutput?.name ?? null,
    };
  }
  const canTry = acoustic && summary.ready?.duplex?.supported === true && summary.devices?.micPrivacy === "allow" && summary.devices?.inputPresent && summary.devices?.outputPresent && !summary.devices?.inputMuted;
  if (acoustic && !canTry) {
    summary.duplex = { attempted: false, reason: "preconditions for an echo-cancelled open were not met" };
  }
  if (canTry) {
    worker.send({ op: "duplex.start", session: "t2-probe", maxMs: 8_000 });
    const started = await until((event) => event.ev === "duplex.started" || event.ev === "duplex.error", 12_000);
    if (!started) summary.duplex = { attempted: true, timedOut: true };
    else if (started.ev === "duplex.error") summary.duplex = { attempted: true, code: started.code, message: started.message };
    else {
      summary.duplex = {
        attempted: true,
        aec: started.aec,
        reference: started.reference,
        fixture: started.fixture,
        floor: started.floor ?? null,
      };
      if (started.fixture === true) summary.duplex.note = "fixture lane; not a physical duplex result";
      else {
        worker.send({ op: "speak", turn: "probe", gen: 1, seq: 0, text: "Duplex check.", device: -1, voice: null });
        const playback = await until((event) => event.ev === "playback.started" || event.ev === "speak.error", 10_000);
        summary.playback = playback ? { ev: playback.ev, code: playback.code ?? null } : { timedOut: true };
        await sleep(1200);
        const during = events.filter((event) => event.ev === "level" && event.outputActive === true);
        summary.levelsDuringPlayback = during.length;
      }
      worker.send({ op: "duplex.stop", session: "t2-probe" });
      await until((event) => event.ev === "duplex.stopped", 5_000);
    }
  }
} catch (error) {
  summary.error = error instanceof Error ? error.name : "probe_failed";
} finally {
  await worker.close();
  rmSync(directory, { recursive: true, force: true });
}

mkdirSync(outDir, { recursive: true });
const file = join(outDir, "windows-device-probe.json");
writeFileSync(file, `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify(summary, null, 2));
