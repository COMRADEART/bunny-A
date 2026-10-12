import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { launchVoiceWorker, type VoiceWorkerProcess } from "./voice-worker.server.ts";
import type { WorkerEvent } from "./voice-protocol.ts";

const windows = process.platform === "win32";
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function fixture(extraArgs = ["--output", "null", "--input-silence"]) {
  const directory = mkdtempSync(join(tmpdir(), "bunny-t12-duplex-"));
  const worker = await launchVoiceWorker({ dataDirectory: directory, extraArgs });
  const events: WorkerEvent[] = [];
  worker.onEvent(event => events.push(event));
  const until = async (predicate: (event: WorkerEvent) => boolean, timeout = 15_000) => {
    const start = performance.now();
    for (;;) {
      const event = events.find(predicate);
      if (event) return event;
      if (performance.now() - start > timeout) throw new Error(`Worker event timed out: ${events.slice(-6).map(e => e.ev).join(",")}`);
      await sleep(10);
    }
  };
  const close = async () => {
    await worker.close();
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()), "delete only this generated temporary test directory");
    rmSync(directory, { recursive: true, force: true });
  };
  return { worker, events, until, close };
}
async function start(h: Awaited<ReturnType<typeof fixture>>, session = "fixture-duplex") {
  await h.until(e => e.ev === "ready");
  h.worker.send({ op: "duplex.start", session, maxMs: 20_000 });
  const event = await h.until(e => e.ev === "duplex.started" && e.session === session) as Extract<WorkerEvent, { ev: "duplex.started" }>;
  assert.equal(event.fixture, true); assert.equal(event.aec, "fixture:no-aec");
}

test("T12 native fixture: continuous input and actual synthesis/null playback operate concurrently inside F04 Job", { skip: !windows }, async () => {
  const h = await fixture();
  try {
    await start(h);
    assert.ok((h.worker.inspectJob()?.activeProcesses ?? 0) > 0);
    h.worker.send({ op: "speak", turn: "output", gen: 4, seq: 0, text: "This fixture verifies that two independent audio lanes can run at the same time.", device: -1, voice: null });
    await h.until(e => e.ev === "playback.started");
    h.worker.send({ op: "capture.start", turn: "input", gen: 91, device: -1, endpointing: "manual", maxMs: 10_000, duplex: true, session: "fixture-duplex" });
    await h.until(e => e.ev === "capture.started" && e.turn === "input");
    await h.until(e => e.ev === "capture.first_audio" && e.turn === "input");
    assert.equal(h.events.some(e => e.ev === "capture.error" && e.code === "BUSY_PLAYBACK"), false);
    h.worker.send({ op: "speak.cancel", gen: 4 });
    await h.until(e => e.ev === "speak.cancelled" && e.gen === 4);
    const levels = h.events.filter(e => e.ev === "level").length;
    await sleep(250);
    assert.ok(h.events.filter(e => e.ev === "level").length > levels, "speech cancellation does not stop continuous input");
  } finally { await h.close(); }
});

test("T12 native fixture: pause/resume then generation cancellation never resurrects old chunks", { skip: !windows }, async () => {
  const h = await fixture();
  try {
    await start(h);
    h.worker.send({ op: "speak", turn: "spoken", gen: 2, seq: 0, text: "The synthetic voice keeps speaking until it is paused and resumed, and then cancelled.", device: -1, voice: null });
    await h.until(e => e.ev === "playback.started");
    h.worker.send({ op: "speak.pause", gen: 2, on: true });
    await h.until(e => e.ev === "playback.paused" && e.on);
    h.worker.send({ op: "speak.pause", gen: 2, on: false });
    await h.until(e => e.ev === "playback.paused" && !e.on);
    h.worker.send({ op: "speak.cancel", gen: 2 });
    await h.until(e => e.ev === "speak.cancelled" && e.gen === 2);
    const count = h.events.filter(e => e.ev === "playback.started").length;
    h.worker.send({ op: "speak", turn: "stale", gen: 2, seq: 1, text: "Must never play.", device: -1, voice: null });
    h.worker.send({ op: "speak.pause", gen: 2, on: false });
    await sleep(300);
    assert.equal(h.events.filter(e => e.ev === "playback.started").length, count);
  } finally { await h.close(); }
});

test("T12 native fixture: mute stops continuous source; close leaves zero active Job processes", { skip: !windows }, async () => {
  const h = await fixture();
  try {
    await start(h);
    h.worker.send({ op: "mute", on: true });
    await h.until(e => e.ev === "duplex.stopped");
    h.worker.send({ op: "capture.start", turn: "muted", gen: 1, device: -1, endpointing: "manual", maxMs: 1000, duplex: true, session: "fixture-duplex" });
    await h.until(e => e.ev === "capture.error" && e.code === "MUTED");
    await h.worker.close();
    assert.equal(h.worker.closeAccounting?.activeProcesses, 0);
  } finally { await h.close(); }
});

test("T12 native fixture: a wrong session cannot attach recognition to another continuous source", { skip: !windows }, async () => {
  const h = await fixture();
  try {
    await start(h);
    h.worker.send({ op: "capture.start", turn: "foreign", gen: 1, device: -1, endpointing: "manual", maxMs: 1000, duplex: true, session: "other-session" });
    await h.until(e => e.ev === "capture.error" && e.code === "AEC_UNAVAILABLE");
    assert.equal(h.events.some(e => e.ev === "capture.started"), false);
  } finally { await h.close(); }
});

test("T12 native fault: blocked protocol writer exits within watchdog bound and cannot retain the Job", { skip: !windows }, async () => {
  const h = await fixture(["--selftest-output-stall"]);
  const worker: VoiceWorkerProcess = h.worker;
  try {
    // The stall watchdog exits at 10 s (StallExitMs); the bound here must outlast it.
    const code = await Promise.race([worker.exited, sleep(20000).then(() => "timeout")]);
    assert.equal(code, 3);
    await worker.close();
    assert.equal(worker.closeAccounting?.activeProcesses, 0);
  } finally { await h.close(); }
});

test("T12 native fixture: duplex stopped acknowledges recognition detachment before push-to-talk fallback", { skip: !windows }, async () => {
  const h = await fixture();
  try {
    await start(h);
    h.worker.send({ op: "capture.start", turn: "duplex-input", gen: 1, device: -1, endpointing: "manual", maxMs: 10_000, duplex: true, session: "fixture-duplex" });
    await h.until(e => e.ev === "capture.first_audio");
    h.worker.send({ op: "duplex.stop", session: "fixture-duplex" });
    await h.until(e => e.ev === "duplex.stopped");
    h.worker.send({ op: "capture.start", turn: "fallback", gen: 2, device: -1, endpointing: "manual", maxMs: 1000 });
    await h.until(e => e.ev === "capture.started" && e.turn === "fallback");
    assert.equal(h.events.some(e => e.ev === "capture.error" && e.code === "DEVICE_BUSY"), false);
  } finally { await h.close(); }
});

test("T12 native fault: stalled fixture read is bounded by contained worker shutdown", { skip: !windows }, async () => {
  const h = await fixture(["--output", "null", "--input-stall"]);
  try {
    await h.until(e => e.ev === "ready");
    h.worker.send({ op: "duplex.start", session: "stalled-fixture", maxMs: 20_000 });
    await sleep(100);
    const start = performance.now();
    await h.worker.close();
    assert.ok(performance.now() - start < 5000);
    assert.equal(h.worker.closeAccounting?.activeProcesses, 0);
  } finally { await h.close(); }
});

test("T12 native identity: changing enumeration cannot reuse a cached render index for another endpoint", { skip: !windows }, async () => {
  const h = await fixture(["--selftest"]);
  try {
    const event = await h.until(e => String(e.ev) === "selftest") as unknown as { results: Record<string, unknown> };
    // Render-identity guard checks only; these keys claim no echo cancellation.
    assert.equal(event.results.renderIdentityInitiallyMatches, true);
    assert.equal(event.results.renderIdentityReorderRefused, true);
  } finally { await h.close(); }
});

// M-A-3 T12 fixtures. Synthetic input and null output only; no microphone or speaker is opened.
function writeWav16k(path: string, samples: Int16Array) {
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((v, i) => data.writeInt16LE(v, i * 2));
  const h = Buffer.alloc(44);
  h.write("RIFF", 0, "ascii"); h.writeUInt32LE(36 + data.length, 4); h.write("WAVE", 8, "ascii");
  h.write("fmt ", 12, "ascii"); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(16000, 24); h.writeUInt32LE(32000, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write("data", 36, "ascii"); h.writeUInt32LE(data.length, 40);
  writeFileSync(path, Buffer.concat([h, data]));
}

test("T12 native: duplex.started reports a bounded measured floor; duplex levels carry floor, residual and outputActive", { skip: !windows }, async () => {
  const h = await fixture();
  try {
    await start(h);
    const started = h.events.find(e => e.ev === "duplex.started") as unknown as { floor?: number };
    assert.equal(typeof started.floor, "number");
    assert.ok((started.floor ?? 0) >= 0.0002 && (started.floor ?? 0) <= 0.005, "the floor is clamped to its bounds");
    h.worker.send({ op: "capture.start", turn: "levels", gen: 1, device: -1, endpointing: "manual", maxMs: 5000, duplex: true, session: "fixture-duplex" });
    const level = await h.until(e => e.ev === "level" && e.turn === "levels") as unknown as { floor?: number; residual?: number | null; outputActive?: boolean };
    assert.equal(typeof level.floor, "number");
    assert.equal(level.residual, null, "no residual while nothing of ours is audible");
    assert.equal(level.outputActive, false);
  } finally { await h.close(); }
});

test("T12 native: a 180 ms burst in a duplex turn ends as speech_end short and stt.none too_short, with no decode", { skip: !windows }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "bunny-t12-short-"));
  try {
    // 500 ms silence, a 180 ms tone at 0.3 amplitude, then silence (FixtureSource pads silence past the end).
    const samples = new Int16Array(8000 + 2880 + 32000);
    for (let i = 0; i < 2880; i++) samples[8000 + i] = Math.round(9830 * Math.sin((2 * Math.PI * 440 * i) / 16000));
    const wav = join(dir, "short-burst.wav");
    writeWav16k(wav, samples);
    const h = await fixture(["--output", "null", "--input-wav", wav]);
    try {
      await h.until(e => e.ev === "ready");
      h.worker.send({ op: "duplex.start", session: "fixture-duplex", maxMs: 20_000 });
      await h.until(e => e.ev === "duplex.started");
      h.worker.send({ op: "capture.start", turn: "short", gen: 1, device: -1, endpointing: "vad", maxMs: 10_000, duplex: true, session: "fixture-duplex" });
      const end = await h.until(e => e.ev === "vad" && e.turn === "short" && e.state === "speech_end", 20_000) as unknown as { short?: boolean; speechMs?: number };
      assert.equal(end.short, true, "the burst is below the recognition minimum");
      assert.ok((end.speechMs ?? 0) < 250, "the burst length is reported");
      const terminal = await h.until(e => (e.ev === "stt.none" || e.ev === "stt.final") && e.turn === "short", 20_000) as unknown as { ev: string; reason?: string };
      assert.equal(terminal.ev, "stt.none");
      assert.equal(terminal.reason, "too_short");
      assert.equal(h.events.some(e => e.ev === "stt.partial" && e.turn === "short"), false, "a short burst never produces a partial decode");
      await h.until(e => e.ev === "capture.stopped" && e.turn === "short", 5_000);
    } finally { await h.close(); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("T12 native: the null-sink pause receipt carries requestMono and null measurements, and resume is a real transition", { skip: !windows }, async () => {
  const h = await fixture();
  try {
    await start(h);
    h.worker.send({ op: "speak", turn: "receipt", gen: 6, seq: 0, text: "The synthetic voice keeps talking long enough for a pause to land in the middle of it.", device: -1, voice: null });
    await h.until(e => e.ev === "playback.started" && e.turn === "receipt");
    h.worker.send({ op: "speak.pause", gen: 6, on: true });
    const paused = await h.until(e => e.ev === "playback.paused" && e.turn === "receipt" && e.on === true) as unknown as {
      requestMono?: number; silentMono?: number | null; meterSilentMs?: number | null; wasAudible?: boolean; mono: number;
    };
    assert.equal(typeof paused.requestMono, "number", "the request time is reported");
    assert.ok((paused.requestMono ?? 0) <= paused.mono, "the request precedes the receipt");
    assert.equal(paused.silentMono, null, "the null sink has no render meter to measure");
    assert.equal(paused.meterSilentMs, null);
    assert.equal(paused.wasAudible, true, "the null sink is audible while its chunk is submitted");
    h.worker.send({ op: "speak.pause", gen: 6, on: false });
    await h.until(e => e.ev === "playback.paused" && e.turn === "receipt" && e.on === false);
    h.worker.send({ op: "speak.cancel", gen: 6 });
    await h.until(e => e.ev === "speak.cancelled" && e.gen === 6);
  } finally { await h.close(); }
});

test("T12 native AUD-04: capture.abort with a turn id aborts only the capture whose turn and gen match", { skip: !windows }, async () => {
  const h = await fixture();
  try {
    await start(h);
    h.worker.send({ op: "capture.start", turn: "abortme", gen: 5, device: -1, endpointing: "manual", maxMs: 10_000, duplex: true, session: "fixture-duplex" });
    await h.until(e => e.ev === "capture.started" && e.turn === "abortme");
    h.worker.send({ op: "capture.abort", turn: "abortme", gen: 4 });
    h.worker.send({ op: "capture.abort", turn: "someone-else", gen: 5 });
    h.worker.send({ op: "capture.abort", gen: 4 });
    await sleep(300);
    assert.equal(h.events.some(e => e.ev === "capture.stopped" && e.turn === "abortme"), false, "no mismatched abort reaches the capture");
    h.worker.send({ op: "capture.abort", turn: "abortme", gen: 5 });
    const stopped = await h.until(e => e.ev === "capture.stopped" && e.turn === "abortme") as unknown as { reason: string };
    assert.equal(stopped.reason, "abort");
    const terminal = await h.until(e => e.ev === "stt.none" && e.turn === "abortme") as unknown as { reason: string };
    assert.equal(terminal.reason, "aborted", "an aborted turn never emits a final");
  } finally { await h.close(); }
});

test("T12 native VT-09: the next duplex input turn attaches as soon as the previous capture stops, and the finalizing turn keeps its own terminal", { skip: !windows }, async () => {
  const h = await fixture();
  try {
    await start(h);
    h.worker.send({ op: "capture.start", turn: "first", gen: 1, device: -1, endpointing: "manual", maxMs: 10_000, duplex: true, session: "fixture-duplex" });
    await h.until(e => e.ev === "capture.first_audio" && e.turn === "first");
    h.worker.send({ op: "capture.end", turn: "first", gen: 1 });
    await h.until(e => e.ev === "capture.stopped" && e.turn === "first");
    h.worker.send({ op: "capture.start", turn: "second", gen: 2, device: -1, endpointing: "manual", maxMs: 10_000, duplex: true, session: "fixture-duplex" });
    await h.until(e => e.ev === "capture.started" && e.turn === "second");
    assert.equal(h.events.some(e => e.ev === "capture.error" && e.turn === "second"), false);
    const terminal = await h.until(e => (e.ev === "stt.final" || e.ev === "stt.none") && e.turn === "first") as unknown as { gen: number };
    assert.equal(terminal.gen, 1, "the finalizing turn reports its own generation");
    h.worker.send({ op: "capture.end", turn: "second", gen: 2 });
    await h.until(e => e.ev === "capture.stopped" && e.turn === "second");
  } finally { await h.close(); }
});

test("T12 native: duplex.stop during an active capture is a clean abort, never a lost-device error", { skip: !windows }, async () => {
  const h = await fixture();
  try {
    await start(h);
    h.worker.send({ op: "capture.start", turn: "stop-active", gen: 1, device: -1, endpointing: "manual", maxMs: 10_000, duplex: true, session: "fixture-duplex" });
    await h.until(e => e.ev === "capture.first_audio" && e.turn === "stop-active");
    h.worker.send({ op: "duplex.stop", session: "fixture-duplex" });
    await h.until(e => e.ev === "duplex.stopped");
    const stopped = await h.until(e => e.ev === "capture.stopped" && e.turn === "stop-active") as unknown as { reason: string };
    assert.notEqual(stopped.reason, "error", "closing the continuous source under an active capture is not a device fault");
    assert.equal(h.events.some(e => e.ev === "capture.error" && e.turn === "stop-active"), false, "no DEVICE_LOST for a stop");
  } finally { await h.close(); }
});

test("T12 native: stationary loud ambient in a duplex vad turn ends as speech_end (it is never speech for ever)", { skip: !windows }, async () => {
  const h = await fixture(["--output", "null", "--input-noise"]);
  try {
    await start(h);
    h.worker.send({ op: "capture.start", turn: "noise", gen: 1, device: -1, endpointing: "vad", maxMs: 15_000, duplex: true, session: "fixture-duplex" });
    const began = await h.until(e => e.ev === "vad" && e.turn === "noise" && e.state === "speech_start", 10_000);
    const ended = await h.until(e => e.ev === "vad" && e.turn === "noise" && e.state === "speech_end", 10_000) as unknown as { speechMs?: number };
    assert.ok(began, "the steady noise is seen as an onset (the test input is loud)");
    // Onset plus the 900 ms silence clock, with slack for the paced fixture. A turn that runs to the 15 s cap fails here.
    assert.ok((ended.speechMs ?? 0) < 4000, `the turn ends within 4 s of its onset (speechMs ${ended.speechMs})`);
    await h.until(e => e.ev === "capture.stopped" && e.turn === "noise", 10_000);
  } finally { await h.close(); }
});
