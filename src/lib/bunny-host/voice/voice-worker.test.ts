import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LineFramer, launchVoiceWorker, parseWorkerEvent, VoiceWorkerError, VoiceWorkerProcess, verifyWorkerIntegrity, MAX_LINE_BYTES } from "./voice-worker.server.ts";
import type { OwnedProcessGroup } from "../owned-process-group.server.ts";

function fakeRoot(options: { recordHash?: string | null; manifestHash?: string | null; exe?: string; source?: string; recordSourceHash?: string | null } = {}) {
  const root = mkdtempSync(join(tmpdir(), "bunny-voice-worker-"));
  mkdirSync(join(root, "native", "voice"), { recursive: true });
  const exe = Buffer.from(options.exe ?? "not really an exe, only bytes for hashing");
  writeFileSync(join(root, "native", "voice", "bunny-voice-worker.exe"), exe);
  const source = Buffer.from(options.source ?? "// fake worker source");
  writeFileSync(join(root, "native", "voice", "BunnyVoiceWorker.cs"), source);
  const actual = createHash("sha256").update(exe).digest("hex");
  const recorded = options.recordHash === undefined ? actual : options.recordHash;
  const sourceRecorded = options.recordSourceHash === undefined ? createHash("sha256").update(source).digest("hex") : options.recordSourceHash;
  writeFileSync(join(root, "native", "voice", "bunny-voice-worker.json"), JSON.stringify({ schema: "bunny-voice-worker-build/1", binarySha256: recorded, sourceSha256: sourceRecorded }));
  if (options.manifestHash !== undefined) {
    writeFileSync(join(root, "release-manifest.json"), JSON.stringify({ files: [{ path: "native/voice/bunny-voice-worker.exe", sha256: options.manifestHash ?? "0".repeat(64) }] }));
  }
  return { root, actual };
}

test("V54 V25 the worker is verified against its build record before any launch", () => {
  const { root, actual } = fakeRoot();
  try {
    assert.equal(verifyWorkerIntegrity(root).sha256, actual);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("V54 a binary that differs from its build record is refused with WORKER_INTEGRITY", () => {
  const { root } = fakeRoot({ recordHash: "f".repeat(64) });
  try {
    assert.throws(() => verifyWorkerIntegrity(root), (error: unknown) => error instanceof VoiceWorkerError && error.code === "WORKER_INTEGRITY");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("V54 a release manifest that lists a different hash refuses the worker", () => {
  const { root, actual } = fakeRoot({ manifestHash: "e".repeat(64) });
  try {
    assert.throws(() => verifyWorkerIntegrity(root), /release manifest/);
    assert.notEqual(actual, "e".repeat(64));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("V54 a matching release manifest is accepted", () => {
  const { root, actual } = fakeRoot({ manifestHash: undefined });
  try {
    writeFileSync(join(root, "release-manifest.json"), JSON.stringify({ files: [{ path: "native/voice/bunny-voice-worker.exe", sha256: actual }] }));
    assert.equal(verifyWorkerIntegrity(root).sha256, actual);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("V54 a missing worker or build record is refused", () => {
  const root = mkdtempSync(join(tmpdir(), "bunny-voice-missing-"));
  try {
    assert.throws(() => verifyWorkerIntegrity(root), (error: unknown) => error instanceof VoiceWorkerError && error.code === "WORKER_INTEGRITY");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("V25 V54 a refused launch starts nothing and creates no ownership record", async () => {
  const { root } = fakeRoot({ recordHash: "a".repeat(64) });
  const dataDirectory = mkdtempSync(join(tmpdir(), "bunny-voice-data-"));
  try {
    await assert.rejects(() => launchVoiceWorker({ dataDirectory, root }), (error: unknown) => error instanceof VoiceWorkerError && error.code === "WORKER_INTEGRITY");
    assert.equal(existsSync(join(dataDirectory, "runtime")), false, "no ownership record was written for a refused launch");
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(dataDirectory, { recursive: true, force: true });
  }
});

test("the stdout framer yields whole lines across chunk boundaries and accepts CRLF", () => {
  const lines: string[] = [];
  const framer = new LineFramer((line) => lines.push(line));
  framer.push(Buffer.from('{"ev":"ready"'));
  framer.push(Buffer.from(',"t":1,"mono":2}\r\n{"ev":"bye","t":3,"mono":4}\n'));
  assert.deepEqual(lines, ['{"ev":"ready","t":1,"mono":2}', '{"ev":"bye","t":3,"mono":4}']);
});

test("V06 an overlong line is dropped and counted, and the next line still parses", () => {
  const lines: string[] = [];
  const framer = new LineFramer((line) => lines.push(line), 64, 1024);
  framer.push(Buffer.from("x".repeat(100) + "\n" + '{"ev":"bye","t":1,"mono":1}\n'));
  assert.equal(framer.overflowed, 1);
  assert.deepEqual(lines, ['{"ev":"bye","t":1,"mono":1}']);
});

test("V06 an unterminated buffer beyond the bound is discarded, never grown without limit", () => {
  const framer = new LineFramer(() => undefined, MAX_LINE_BYTES, 4096);
  for (let i = 0; i < 10; i++) framer.push(Buffer.alloc(1024, 0x61));
  assert.ok(framer.overflowed >= 1);
});

test("parseWorkerEvent accepts a well-formed event and rejects everything else", () => {
  assert.deepEqual(parseWorkerEvent('{"ev":"bye","t":1,"mono":2}'), { ev: "bye", t: 1, mono: 2 });
  assert.equal(parseWorkerEvent("not json"), null);
  assert.equal(parseWorkerEvent("[1,2]"), null);
  assert.equal(parseWorkerEvent('{"t":1,"mono":2}'), null);
  assert.equal(parseWorkerEvent('{"ev":"bye","t":"1","mono":2}'), null);
});

// ---------------------------------------------------------------------------------------------------------------------
// M-A-3 T10 review round 1 regressions (voice-worker side)
// ---------------------------------------------------------------------------------------------------------------------

test("containment#3 the build record must name the worker source, and a source edited after the build is refused", () => {
  const good = fakeRoot();
  try {
    assert.equal(verifyWorkerIntegrity(good.root).sha256, good.actual);
  } finally {
    rmSync(good.root, { recursive: true, force: true });
  }
  const drifted = fakeRoot({ recordSourceHash: "0".repeat(64) });
  try {
    assert.throws(() => verifyWorkerIntegrity(drifted.root), (error: unknown) => error instanceof VoiceWorkerError && error.code === "WORKER_INTEGRITY" && /source differs/.test(error.message));
  } finally {
    rmSync(drifted.root, { recursive: true, force: true });
  }
  const unnamed = fakeRoot({ recordSourceHash: null });
  try {
    assert.throws(() => verifyWorkerIntegrity(unnamed.root), VoiceWorkerError);
  } finally {
    rmSync(unnamed.root, { recursive: true, force: true });
  }
});

test("native#1 once a release manifest exists it must list this worker with the same hash; a stale entry refuses", () => {
  const stale = fakeRoot({ manifestHash: "0".repeat(64) });
  try {
    assert.throws(() => verifyWorkerIntegrity(stale.root), (error: unknown) => error instanceof VoiceWorkerError && error.code === "WORKER_INTEGRITY");
  } finally {
    rmSync(stale.root, { recursive: true, force: true });
  }
});

test("containment#4 an overlong line is discarded to its newline even when its tail arrives in later chunks", () => {
  const lines: string[] = [];
  const framer = new LineFramer((line) => lines.push(line), 10, 1_000);
  framer.push(Buffer.from("aaaaaaaaaaaaaaaaaaaa"));
  framer.push(Buffer.from("bbbbbbbbbb"));
  framer.push(Buffer.from("cccc\n{\"ok\":1}\n"));
  assert.deepEqual(lines, ['{"ok":1}']);
  assert.equal(framer.overflowed, 1);
});

/** A group double: enough of OwnedProcessGroup for the worker process to poll, write and close. */
function fakeGroup(options: { inspect?: () => { exitCode: number | null; activeProcesses: number } } = {}) {
  const writes: Buffer[] = [];
  const calls: string[] = [];
  const group = {
    writeInput(buffer: Buffer) {
      writes.push(Buffer.from(buffer));
    },
    inspect() {
      return (options.inspect ?? (() => ({ exitCode: null, activeProcesses: 1 })))();
    },
    terminate() {
      calls.push("terminate");
      return 0;
    },
    close(state: string) {
      calls.push(`close:${state}`);
    },
    inspectHistory() {
      return { exitCode: null };
    },
  };
  return { group: group as unknown as OwnedProcessGroup, writes, calls };
}

test("containment#2 the stdin accounting for the shutdown line is its real byte length", async () => {
  const fake = fakeGroup();
  const worker = new VoiceWorkerProcess(fake.group, 1, () => {});
  await worker.close();
  const shutdown = fake.writes.at(-1)!;
  assert.equal(shutdown.toString("utf8"), '{"op":"shutdown"}\n');
  assert.equal(worker.stdinBytes, shutdown.length, "the counter matches the bytes written, not a fixed one byte");
});

test("containment#5 a malformed event that throws in a listener is reported and never thrown out of the stdout handler", () => {
  const reports: string[] = [];
  const fake = fakeGroup();
  const worker = new VoiceWorkerProcess(fake.group, 1, (detail) => reports.push(detail));
  let delivered = 0;
  worker.onEvent((event) => {
    delivered += 1;
    if (event.ev === "ready") (event as unknown as { stt: { engine: string } }).stt.engine.toString();
  });
  assert.doesNotThrow(() => worker.dispatchLine('{"ev":"ready","t":1,"mono":1}'));
  assert.equal(reports.length, 1, "the throw is reported as a rejected worker event");
  assert.doesNotThrow(() => worker.dispatchLine('{"ev":"stt.partial","t":1,"mono":1,"text":"hi"}'));
  assert.equal(delivered, 2, "later events still reach the listeners");
  void worker.close();
});

test("containment#0 a poll whose inspection fails is unknown state: the job is terminated and closed before the exit is reported", async () => {
  let inspectCalls = 0;
  const fake = fakeGroup({
    inspect: () => {
      inspectCalls += 1;
      if (inspectCalls > 1) throw new Error("native inspect failed");
      return { exitCode: null, activeProcesses: 1 };
    },
  });
  const worker = new VoiceWorkerProcess(fake.group, 1, () => {});
  const code = await worker.exited;
  assert.equal(code, null);
  assert.deepEqual(fake.calls, ["terminate", "close:failed"], "the job is settled before the exit is observed");
  assert.throws(() => worker.send({ op: "devices" }), VoiceWorkerError);
});
