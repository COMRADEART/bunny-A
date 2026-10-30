import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { launchVoiceWorker, selectSpeechEngine, verifyWorkerIntegrity, type VoiceWorkerProcess } from "./voice-worker.server.ts";
import type { WorkerEvent } from "./voice-protocol.ts";

/**
 * Real worker through the F04 boundary (OwnedProcessGroup, Windows job object). Test-only fixture flags: null output,
 * synthesized input. The microphone and the speakers are never touched.
 */
const windows = process.platform === "win32";
const FIXTURE = ["--output", "null", "--input-synth", "What is the capital of France?"];

function waitFor<T extends WorkerEvent["ev"]>(worker: VoiceWorkerProcess, ev: T, timeoutMs = 15_000) {
  return new Promise<Extract<WorkerEvent, { ev: T }>>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for ${ev}`)), timeoutMs);
    worker.onEvent((event) => {
      if (event.ev === ev) {
        clearTimeout(timer);
        resolve(event as Extract<WorkerEvent, { ev: T }>);
      }
    });
  });
}

function findOwnershipRecords(dataDirectory: string, action: string): Record<string, unknown>[] {
  const folder = join(dataDirectory, "runtime", "git-operations");
  try {
    return readdirSync(folder)
      .filter((name) => statSync(join(folder, name)).isFile())
      .map((name) => JSON.parse(readFileSync(join(folder, name), "utf8")) as Record<string, unknown>)
      .filter((record) => record.action === action);
  } catch {
    return [];
  }
}

async function until(check: () => boolean, timeoutMs = 10_000) {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > timeoutMs) return false;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return true;
}

test("V54 the real worker exe matches its build record before it is launched", { skip: !windows && "Windows only" }, () => {
  const { sha256 } = verifyWorkerIntegrity();
  assert.match(sha256, /^[0-9a-f]{64}$/);
});

test("V54 V25 the worker is admitted into a Bunny-owned job and the job is observable with kernel accounting", { skip: !windows && "Windows only" }, async () => {
  const dataDirectory = mkdtempSync(join(tmpdir(), "bunny-voice-contain-"));
  let worker: VoiceWorkerProcess | null = null;
  try {
    worker = await launchVoiceWorker({ dataDirectory, extraArgs: FIXTURE });
    await waitFor(worker, "ready");
    const job = worker.inspectJob();
    assert.ok(job, "the job can be inspected");
    assert.ok(job.activeProcesses >= 1, "the worker runs as a job member");
    assert.equal(job.limitFlags & 0x2000, 0x2000, "kill-on-close is set on the job");
    assert.equal(job.exitCode, null, "the worker is still running");
  } finally {
    if (worker) await worker.close();
    rmSync(dataDirectory, { recursive: true, force: true });
  }
});

test("V54 a real synthesized fixture turn ends in stt.final through the worker protocol", { skip: !windows && "Windows only" }, async () => {
  const dataDirectory = mkdtempSync(join(tmpdir(), "bunny-voice-turn-"));
  let worker: VoiceWorkerProcess | null = null;
  try {
    worker = await launchVoiceWorker({ dataDirectory, extraArgs: FIXTURE });
    await waitFor(worker, "ready");
    const final = waitFor(worker, "stt.final", 30_000);
    worker.send({ op: "devices" });
    worker.send({ op: "capture.start", turn: "fixture-1", gen: 0, device: -1, endpointing: "vad", maxMs: 30_000 });
    const result = await final;
    assert.equal(result.turn, "fixture-1");
    assert.match(result.text.toLowerCase(), /capital/);
  } finally {
    if (worker) await worker.close();
    rmSync(dataDirectory, { recursive: true, force: true });
  }
});

test("V25 close shuts the worker down: its process is gone and its ownership record is closed", { skip: !windows && "Windows only" }, async () => {
  const dataDirectory = mkdtempSync(join(tmpdir(), "bunny-voice-close-"));
  try {
    const worker = await launchVoiceWorker({ dataDirectory, extraArgs: FIXTURE });
    const pid = (await waitFor(worker, "ready")).pid;
    await worker.close();
    // H9: kernel accounting of the job at close: a graceful close must leave zero ActiveProcesses in the job.
    assert.ok(worker.closeAccounting, "close recorded its job accounting");
    assert.equal(worker.closeAccounting.activeProcesses, 0, "the job reports zero live processes after close");
    // The voice.worker owner records no provider containment accounting, so the pid is the observable proof.
    const gone = await until(() => !processAlive(pid));
    assert.equal(gone, true, "the worker process is gone after close");
    const records = findOwnershipRecords(dataDirectory, "voice.worker");
    assert.equal(records.length, 1, "exactly one ownership record for the worker");
    assert.equal(records[0].closed, true);
  } finally {
    rmSync(dataDirectory, { recursive: true, force: true });
  }
});

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

test("V25 V54 an abrupt termination of the job kills the worker and the process exits", { skip: !windows && "Windows only" }, async () => {
  const dataDirectory = mkdtempSync(join(tmpdir(), "bunny-voice-kill-"));
  try {
    const worker = await launchVoiceWorker({ dataDirectory, extraArgs: FIXTURE });
    await waitFor(worker, "ready");
    const active = worker.terminateJob();
    assert.equal(typeof active, "number");
    const exitCode = await Promise.race([worker.exited, new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 10_000))]);
    assert.notEqual(exitCode, "timeout", "the worker process exited after its job was terminated");
    await until(() => worker.inspectJob() === null || (worker.inspectJob()?.activeProcesses ?? 0) === 0);
    await worker.close();
  } finally {
    rmSync(dataDirectory, { recursive: true, force: true });
  }
});

test("V25 a speak with an immediate speak.cancel produces a cancel receipt for that generation", { skip: !windows && "Windows only" }, async () => {
  const dataDirectory = mkdtempSync(join(tmpdir(), "bunny-voice-cancel-"));
  let worker: VoiceWorkerProcess | null = null;
  try {
    worker = await launchVoiceWorker({ dataDirectory, extraArgs: FIXTURE });
    await waitFor(worker, "ready");
    const receipt = waitFor(worker, "speak.cancelled", 15_000);
    worker.send({ op: "speak", turn: "speak-1", gen: 0, seq: 0, text: "Paris is the capital of France and it is a large city.", device: -1, voice: null });
    worker.send({ op: "speak.cancel", gen: 0 });
    const result = await receipt;
    assert.equal(result.gen, 0);
    assert.equal(typeof result.resetMs, "number");
  } finally {
    if (worker) await worker.close();
    rmSync(dataDirectory, { recursive: true, force: true });
  }
});

test("T10 H9 killing the Host process ends the contained worker (kill-on-close, no orphan)", { skip: !windows && "Windows only" }, async () => {
  const dataDirectory = mkdtempSync(join(tmpdir(), "bunny-voice-hostkill-"));
  const childPath = fileURLToPath(new URL("./voice-worker-host.fixture.ts", import.meta.url));
  const child = spawn(process.execPath, ["--experimental-strip-types", childPath, dataDirectory], { stdio: ["ignore", "pipe", "pipe"] });
  try {
    const workerPid = await new Promise<number>((resolve, reject) => {
      let buffer = "";
      const timer = setTimeout(() => reject(new Error("the child Host did not report a ready worker")), 20_000);
      child.stdout.on("data", (chunk: Buffer) => {
        buffer += chunk.toString("utf8");
        const match = /READY (\d+)/.exec(buffer);
        if (match) {
          clearTimeout(timer);
          resolve(Number(match[1]));
        }
      });
      child.once("exit", () => reject(new Error("the child Host exited before its worker was ready")));
    });
    assert.equal(processAlive(workerPid), true, "the worker runs while its Host is alive");
    child.kill("SIGKILL");
    await once(child, "exit");
    const gone = await until(() => !processAlive(workerPid), 15_000);
    assert.equal(gone, true, "the worker died with its Host: the job's kill-on-close reaped it");
  } finally {
    if (child.exitCode === null) child.kill("SIGKILL");
    rmSync(dataDirectory, { recursive: true, force: true });
  }
});

test("S3R1 killing the controlling process mid-capture ends the capture: the capturing worker dies with it", { skip: !windows && "Windows only" }, async () => {
  const dataDirectory = mkdtempSync(join(tmpdir(), "bunny-voice-capturekill-"));
  const childPath = fileURLToPath(new URL("./voice-worker-host.fixture.ts", import.meta.url));
  const child = spawn(process.execPath, ["--experimental-strip-types", childPath, dataDirectory, "capture"], { stdio: ["ignore", "pipe", "pipe"] });
  try {
    const workerPid = await new Promise<number>((resolve, reject) => {
      let buffer = "";
      const timer = setTimeout(() => reject(new Error("the child Host did not report a live capture")), 30_000);
      child.stdout.on("data", (chunk: Buffer) => {
        buffer += chunk.toString("utf8");
        const match = /CAPTURING (\d+)/.exec(buffer);
        if (match) {
          clearTimeout(timer);
          resolve(Number(match[1]));
        }
      });
      child.once("exit", () => reject(new Error("the child Host exited before its capture started")));
    });
    assert.equal(processAlive(workerPid), true, "the worker is capturing while its controlling process is alive");
    // TerminateProcess: no handler in the controlling process runs, as when its console window is closed or it is killed.
    child.kill("SIGKILL");
    await once(child, "exit");
    const gone = await until(() => !processAlive(workerPid), 15_000);
    assert.equal(gone, true, "the capture ended: kill-on-close reaped the capturing worker");
  } finally {
    if (child.exitCode === null) child.kill("SIGKILL");
    rmSync(dataDirectory, { recursive: true, force: true });
  }
});

// M-A-3 T10 whisper: the same contained fixture turn, recognized by whisper.cpp from the staged, verified runtime.
const whisperSelection = windows ? selectSpeechEngine() : { engine: "sapi" as const, reason: "not Windows" };
const whisperSkip = whisperSelection.engine === "whisper" ? false : `whisper not selected: ${whisperSelection.reason ?? "no whisper pin"}`;

test("T10-whisper a real contained whisper fixture turn ends in stt.final from whisper.cpp", { skip: whisperSkip || (!windows && "Windows only") }, async () => {
  const dataDirectory = mkdtempSync(join(tmpdir(), "bunny-voice-whisper-"));
  let worker: VoiceWorkerProcess | null = null;
  try {
    worker = await launchVoiceWorker({ dataDirectory, extraArgs: FIXTURE });
    const ready = await waitFor(worker, "ready");
    assert.equal(ready.stt.engine, "whisper.cpp v1.9.4", "the worker runs whisper, not SAPI");
    const final = waitFor(worker, "stt.final", 60_000);
    worker.send({ op: "capture.start", turn: "whisper-1", gen: 0, device: -1, endpointing: "vad", maxMs: 30_000 });
    const result = await final;
    assert.equal(result.turn, "whisper-1");
    assert.match(result.text.toLowerCase(), /capital/);
    assert.match(result.text.toLowerCase(), /france/);
    assert.ok(result.confidence >= 0 && result.confidence <= 1, "confidence is a probability");
  } finally {
    if (worker) await worker.close();
    rmSync(dataDirectory, { recursive: true, force: true });
  }
});
