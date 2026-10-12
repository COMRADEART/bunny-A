import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

// Unit-level tests for the native voice worker. Fixture inputs and outputs only: no microphone is opened,
// no sound is audible (null sink), and the Windows endpoint state is only read.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const exe = join(root, "native/voice/bunny-voice-worker.exe");
const recordPath = join(root, "native/voice/bunny-voice-worker.json");
const sourcePath = join(root, "native/voice/BunnyVoiceWorker.cs");
const skip = process.platform === "win32" ? false : "the voice worker is Windows-only";
const SPEECH = "did the tests pass in my last mission";
const sha = p => createHash("sha256").update(readFileSync(p)).digest("hex");
const sleep = ms => new Promise(r => setTimeout(r, ms));

function session(args = []) {
  const child = spawn(exe, args, { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  const events = [];
  const lines = [];
  const waiters = new Set();
  let buffer = "";
  let stderr = "";
  let exitCode = null;
  let exitedAt = null;
  const exited = new Promise(resolveExit => child.on("exit", code => { exitCode = code; exitedAt = Date.now(); resolveExit(code); }));
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", chunk => {
    buffer += chunk;
    let at;
    while ((at = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, at);
      buffer = buffer.slice(at + 1);
      lines.push(line);
      events.push(JSON.parse(line));
      for (const wake of [...waiters]) wake();
    }
  });
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", d => { stderr = (stderr + d).slice(-4000); });
  const send = cmd => child.stdin.write(JSON.stringify(cmd) + "\n");
  const find = pred => events.find(pred);
  // Resolves with the first event (existing or future) matching pred; rejects with a bounded summary on timeout.
  const until = (pred, ms = 15000, label = "event") => new Promise((resolveUntil, rejectUntil) => {
    const hit = events.find(pred);
    if (hit) return resolveUntil(hit);
    const timer = setTimeout(() => {
      waiters.delete(wake);
      rejectUntil(new Error(`timed out waiting for ${label}; last events: ${events.slice(-6).map(e => e.ev).join(",")}; stderr: ${stderr.slice(-300)}`));
    }, ms);
    const wake = () => {
      const found = events.find(pred);
      if (found) { clearTimeout(timer); waiters.delete(wake); resolveUntil(found); }
    };
    waiters.add(wake);
  });
  const close = async () => {
    if (exitCode === null) send({ op: "shutdown" });
    await Promise.race([exited, sleep(5000)]);
    if (exitCode === null) child.kill();
  };
  return { child, events, lines, send, find, until, close, exited, stderr: () => stderr, exitCode: () => exitCode, exitedAt: () => exitedAt };
}

const ofTurn = (events, turn) => events.filter(e => e.turn === turn);
const terminalOf = (events, turn) => events.find(e => e.turn === turn && (e.ev === "stt.final" || e.ev === "stt.none"));

test("build record matches the source and the compiled worker", { skip }, () => {
  assert.ok(existsSync(exe), "run node scripts/build-voice-worker.mjs first");
  const record = JSON.parse(readFileSync(recordPath, "utf8"));
  assert.equal(record.schema, "bunny-voice-worker-build/1");
  assert.equal(record.protocol, "bunny-voice/1");
  assert.equal(record.architecture, "windows-x64");
  assert.equal(record.sourceSha256, sha(sourcePath));
  assert.equal(record.binarySha256, sha(exe));
  assert.match(record.systemSpeech.path, /System\.Speech\.dll$/);
  assert.match(record.compiler.version, /Visual C# Compiler/);
});

test("ready event reports local SAPI engines and the worker protocol", { skip }, async () => {
  const w = session();
  try {
    const ready = await w.until(e => e.ev === "ready", 10000, "ready");
    assert.equal(ready.protocol, "bunny-voice/1");
    assert.equal(typeof ready.pid, "number");
    assert.equal(ready.stt.local, true);
    assert.equal(typeof ready.stt.engine, "string");
    assert.equal(ready.tts.local, true);
    assert.ok(Array.isArray(ready.tts.voices));
    assert.equal(typeof ready.t, "number");
    assert.equal(typeof ready.mono, "number");
  } finally {
    await w.close();
  }
});

test("devices event is a read-only real enumeration with structure only", { skip }, async () => {
  const w = session();
  try {
    await w.until(e => e.ev === "ready", 10000, "ready");
    w.send({ op: "devices" });
    const d = await w.until(e => e.ev === "devices", 10000, "devices");
    for (const dev of [...d.inputs, ...d.outputs]) {
      assert.equal(typeof dev.index, "number");
      assert.equal(typeof dev.name, "string");
      assert.equal(typeof dev.channels, "number");
    }
    for (const ep of [d.defaultInput, d.defaultOutput]) {
      assert.equal(typeof ep.present, "boolean");
      assert.ok(ep.muted === null || typeof ep.muted === "boolean");
    }
    assert.ok(["allow", "deny", "unknown"].includes(d.micPrivacy));
  } finally {
    await w.close();
  }
});

test("V07 V08 V09 synthesized speech yields partials then a final bound to its turn, endpointed by VAD", { skip }, async () => {
  const w = session(["--input-synth", SPEECH, "--fixture-pace", "2"]);
  try {
    await w.until(e => e.ev === "ready", 15000, "ready");
    w.send({ op: "capture.start", turn: "turn-a", gen: 3, device: -1, endpointing: "vad", maxMs: 20000 });
    const started = await w.until(e => e.ev === "capture.started" && e.turn === "turn-a", 8000, "capture.started");
    assert.equal(started.gen, 3);
    assert.equal(started.device.index, -2);
    assert.ok(started.device.name.startsWith("fixture:"), "fixture input must be labelled as a fixture");
    const stopped = await w.until(e => e.ev === "capture.stopped" && e.turn === "turn-a", 20000, "capture.stopped");
    assert.equal(stopped.reason, "vad");
    const terminal = await w.until(e => (e.ev === "stt.final" || e.ev === "stt.none") && e.turn === "turn-a", 10000, "stt terminal");
    assert.equal(terminal.ev, "stt.final", `expected a final transcript, got ${terminal.reason}`);
    assert.equal(terminal.gen, 3);
    const words = terminal.text.toLowerCase();
    const hits = ["tests", "pass", "last", "mission"].filter(k => words.includes(k)).length;
    assert.ok(hits >= 3, `final "${terminal.text}" should contain the spoken key words`);
    assert.ok(terminal.confidence >= 0 && terminal.confidence <= 1);
    const turn = ofTurn(w.events, "turn-a");
    const partials = turn.filter(e => e.ev === "stt.partial");
    assert.ok(partials.length >= 1, "streaming recognition must emit at least one partial");
    assert.ok(partials.every(e => e.gen === 3));
    // V08: no partial after the final; V09: every turn event carries the turn and gen it was started with.
    const finalIndex = w.events.indexOf(terminal);
    assert.ok(w.events.slice(finalIndex + 1).every(e => !(e.ev === "stt.partial" && e.turn === "turn-a")), "partial emitted after final");
    assert.ok(turn.every(e => e.gen === 3));
  } finally {
    await w.close();
  }
});

test("manual endpointing finalizes only on capture.end", { skip }, async () => {
  const w = session(["--input-synth", SPEECH, "--fixture-pace", "2"]);
  try {
    await w.until(e => e.ev === "ready", 15000, "ready");
    w.send({ op: "capture.start", turn: "turn-m", gen: 4, device: -1, endpointing: "manual", maxMs: 20000 });
    await w.until(e => e.ev === "capture.started" && e.turn === "turn-m", 8000, "capture.started");
    await w.until(e => e.ev === "vad" && e.turn === "turn-m" && e.state === "speech_end", 15000, "speech_end");
    assert.equal(terminalOf(w.events, "turn-m"), undefined, "manual endpointing must not finalize on VAD");
    w.send({ op: "capture.end", turn: "turn-m", gen: 4 });
    const terminal = await w.until(e => (e.ev === "stt.final" || e.ev === "stt.none") && e.turn === "turn-m", 12000, "stt terminal");
    assert.equal(terminal.ev, "stt.final", `expected a final transcript, got ${terminal.reason}`);
    assert.equal(terminal.gen, 4);
    const stopped = w.find(e => e.ev === "capture.stopped" && e.turn === "turn-m");
    assert.equal(stopped.reason, "end");
  } finally {
    await w.close();
  }
});

test("V11 silence never becomes a command: stt.none no_speech, no final", { skip }, async () => {
  const w = session(["--input-silence", "--fixture-pace", "2"]);
  try {
    await w.until(e => e.ev === "ready", 15000, "ready");
    w.send({ op: "capture.start", turn: "turn-s", gen: 1, device: -1, endpointing: "manual", maxMs: 20000 });
    await w.until(e => e.ev === "capture.started", 8000, "capture.started");
    await sleep(1500);
    w.send({ op: "capture.end", turn: "turn-s", gen: 1 });
    const terminal = await w.until(e => (e.ev === "stt.final" || e.ev === "stt.none") && e.turn === "turn-s", 10000, "stt terminal");
    assert.equal(terminal.ev, "stt.none");
    assert.equal(terminal.reason, "no_speech");
    assert.equal(w.find(e => e.ev === "stt.partial"), undefined);
  } finally {
    await w.close();
  }
});

test("V12 noise-only input fails safely: vad noise_only and no final", { skip }, async () => {
  const w = session(["--input-noise", "--fixture-pace", "2"]);
  try {
    await w.until(e => e.ev === "ready", 15000, "ready");
    w.send({ op: "capture.start", turn: "turn-n", gen: 1, device: -1, endpointing: "manual", maxMs: 20000 });
    await w.until(e => e.ev === "vad" && e.state === "noise_only", 10000, "noise_only");
    w.send({ op: "capture.end", turn: "turn-n", gen: 1 });
    const terminal = await w.until(e => (e.ev === "stt.final" || e.ev === "stt.none") && e.turn === "turn-n", 10000, "stt terminal");
    assert.equal(terminal.ev, "stt.none");
    assert.equal(terminal.reason, "noise_only");
  } finally {
    await w.close();
  }
});

test("V06 total capture is bounded by maxMs and reports the buffered peak", { skip }, async () => {
  const w = session(["--input-silence", "--fixture-pace", "4"]);
  try {
    await w.until(e => e.ev === "ready", 15000, "ready");
    w.send({ op: "capture.start", turn: "turn-b", gen: 1, device: -1, endpointing: "manual", maxMs: 1000 });
    const stopped = await w.until(e => e.ev === "capture.stopped" && e.turn === "turn-b", 8000, "capture.stopped");
    assert.equal(stopped.reason, "max");
    assert.ok(stopped.bufferedPeakBytes >= 0 && stopped.bufferedPeakBytes <= 1000 * 32, "buffered audio must stay within maxMs");
    const terminal = await w.until(e => (e.ev === "stt.final" || e.ev === "stt.none") && e.turn === "turn-b", 8000, "stt terminal");
    assert.equal(terminal.ev, "stt.none");
  } finally {
    await w.close();
  }
});

test("V05 a second capture.start while capturing is refused with DEVICE_BUSY", { skip }, async () => {
  const w = session(["--input-silence", "--fixture-pace", "2"]);
  try {
    await w.until(e => e.ev === "ready", 15000, "ready");
    w.send({ op: "capture.start", turn: "turn-1", gen: 1, device: -1, endpointing: "manual", maxMs: 20000 });
    await w.until(e => e.ev === "capture.started" && e.turn === "turn-1", 8000, "capture.started");
    w.send({ op: "capture.start", turn: "turn-2", gen: 2, device: -1, endpointing: "manual", maxMs: 20000 });
    const busy = await w.until(e => e.ev === "capture.error" && e.turn === "turn-2", 5000, "capture.error");
    assert.equal(busy.code, "DEVICE_BUSY");
    assert.equal(w.find(e => e.ev === "capture.started" && e.turn === "turn-2"), undefined);
    w.send({ op: "capture.abort", gen: 2 });
    await w.until(e => e.ev === "stt.none" && e.turn === "turn-1", 8000, "aborted terminal");
  } finally {
    await w.close();
  }
});

test("V28 capture during playback is refused with BUSY_PLAYBACK (half duplex)", { skip }, async () => {
  const w = session(["--input-silence", "--output", "null", "--fixture-pace", "2"]);
  try {
    await w.until(e => e.ev === "ready", 15000, "ready");
    w.send({ op: "speak", turn: "say-1", gen: 1, seq: 0, text: "Bunny is checking every agent now and will report the status back to you in a moment.", device: -1, voice: null });
    await w.until(e => e.ev === "playback.started" && e.turn === "say-1", 15000, "playback.started");
    w.send({ op: "capture.start", turn: "listen-1", gen: 2, device: -1, endpointing: "manual", maxMs: 20000 });
    const refused = await w.until(e => e.ev === "capture.error" && e.turn === "listen-1", 5000, "capture.error");
    assert.equal(refused.code, "BUSY_PLAYBACK");
    assert.equal(w.find(e => e.ev === "capture.started" && e.turn === "listen-1"), undefined);
    w.send({ op: "speak.cancel", gen: 1 });
    await w.until(e => e.ev === "speak.cancelled" && e.gen === 1, 8000, "speak.cancelled");
  } finally {
    await w.close();
  }
});

test("V19 V22 LIVE-B03 push-to-talk barge-in: speak.cancel immediately followed by capture.start opens the capture (no BUSY_PLAYBACK)", { skip }, async () => {
  const w = session(["--input-silence", "--output", "null", "--fixture-pace", "2"]);
  try {
    await w.until(e => e.ev === "ready", 15000, "ready");
    w.send({ op: "speak", turn: "say-1", gen: 1, seq: 0, text: "Bunny is checking every agent now and will report the status back to you in a moment.", device: -1, voice: null });
    w.send({ op: "speak", turn: "say-1", gen: 1, seq: 1, text: "The second sentence is still queued behind the first one.", device: -1, voice: null });
    await w.until(e => e.ev === "playback.started" && e.turn === "say-1", 15000, "playback.started");
    // Exactly what the Host sends on a push-to-talk press during speech: cancel, then capture, back to back.
    w.send({ op: "speak.cancel", gen: 1 });
    w.send({ op: "capture.start", turn: "listen-2", gen: 2, device: -1, endpointing: "manual", maxMs: 20000 });
    const started = await w.until(e => (e.ev === "capture.started" || e.ev === "capture.error") && e.turn === "listen-2", 8000, "capture outcome");
    assert.equal(started.ev, "capture.started", JSON.stringify(started));
    assert.equal(w.find(e => e.ev === "playback.started" && e.gen === 1 && e.seq === 1), undefined, "the queued chunk of the cancelled gen never plays");
    w.send({ op: "capture.abort", gen: 2 });
  } finally {
    await w.close();
  }
});

test("V24 mute aborts an active capture and refuses capture.start until unmuted", { skip }, async () => {
  const w = session(["--input-silence", "--fixture-pace", "2"]);
  try {
    await w.until(e => e.ev === "ready", 15000, "ready");
    w.send({ op: "capture.start", turn: "m-1", gen: 1, device: -1, endpointing: "manual", maxMs: 20000 });
    await w.until(e => e.ev === "capture.started" && e.turn === "m-1", 8000, "capture.started");
    w.send({ op: "mute", on: true });
    const muted = await w.until(e => e.ev === "mute", 5000, "mute");
    assert.equal(muted.on, true);
    const stopped = await w.until(e => e.ev === "capture.stopped" && e.turn === "m-1", 5000, "capture.stopped");
    assert.equal(stopped.reason, "mute");
    const term = await w.until(e => e.ev === "stt.none" && e.turn === "m-1", 5000, "stt.none");
    assert.equal(term.reason, "aborted");
    w.send({ op: "capture.start", turn: "m-2", gen: 2, device: -1, endpointing: "manual", maxMs: 20000 });
    const refused = await w.until(e => e.ev === "capture.error" && e.turn === "m-2", 5000, "capture.error");
    assert.equal(refused.code, "MUTED");
    assert.equal(w.find(e => e.ev === "capture.started" && e.turn === "m-2"), undefined);
    w.send({ op: "mute", on: false });
    await w.until(e => e.ev === "mute" && e.on === false, 5000, "unmute");
  } finally {
    await w.close();
  }
});

test("V18 speech chunks play strictly in seq order on the null sink", { skip }, async () => {
  const w = session(["--input-silence", "--output", "null", "--fixture-pace", "4"]);
  try {
    await w.until(e => e.ev === "ready", 15000, "ready");
    const texts = ["First part of the answer.", "Second part follows here.", "And the final part."];
    texts.forEach((text, seq) => w.send({ op: "speak", turn: "ord", gen: 1, seq, text, device: -1, voice: null }));
    await w.until(e => e.ev === "playback.idle" && e.turn === "ord", 20000, "playback.idle");
    const started = w.events.filter(e => e.ev === "playback.started" && e.turn === "ord").map(e => e.seq);
    const done = w.events.filter(e => e.ev === "playback.chunk_done" && e.turn === "ord").map(e => e.seq);
    assert.deepEqual(started, [0, 1, 2]);
    assert.deepEqual(done, [0, 1, 2]);
    const ready = w.events.filter(e => e.ev === "tts.ready" && e.turn === "ord").map(e => e.seq);
    assert.deepEqual(ready, [0, 1, 2]);
  } finally {
    await w.close();
  }
});

test("V19 V20 speak.cancel stops audible playback and nothing from that gen starts afterwards", { skip }, async () => {
  const w = session(["--input-silence", "--output", "null", "--fixture-pace", "2"]);
  try {
    await w.until(e => e.ev === "ready", 15000, "ready");
    const long = "This is a deliberately long sentence so that the barge in arrives while the audio is still playing out loud.";
    [0, 1, 2].forEach(seq => w.send({ op: "speak", turn: "bi", gen: 7, seq, text: long, device: -1, voice: null }));
    await w.until(e => e.ev === "playback.started" && e.turn === "bi" && e.seq === 0, 15000, "playback.started");
    w.send({ op: "speak.cancel", gen: 7 });
    const cancelled = await w.until(e => e.ev === "speak.cancelled" && e.gen === 7, 8000, "speak.cancelled");
    assert.equal(cancelled.wasPlaying, true);
    assert.ok(cancelled.droppedChunks >= 1);
    assert.ok(cancelled.resetMs >= 0);
    assert.equal(cancelled.meterSilentMs, null, "the null sink has no endpoint meter");
    await sleep(800);
    const at = w.events.indexOf(cancelled);
    const after = w.events.slice(at + 1);
    assert.equal(after.filter(e => e.ev === "playback.started" && e.gen === 7).length, 0, "no playback may start for a cancelled gen");
    assert.equal(w.events.filter(e => e.ev === "playback.started" && e.gen === 7).every(e => w.events.indexOf(e) < at), true);
  } finally {
    await w.close();
  }
});

test("V21 a late speak with an old gen after cancel never plays", { skip }, async () => {
  const w = session(["--input-silence", "--output", "null", "--fixture-pace", "4"]);
  try {
    await w.until(e => e.ev === "ready", 15000, "ready");
    w.send({ op: "speak.cancel", gen: 9 });
    await w.until(e => e.ev === "speak.cancelled" && e.gen === 9, 5000, "speak.cancelled");
    w.send({ op: "speak", turn: "late", gen: 8, seq: 0, text: "Too late to matter.", device: -1, voice: null });
    await sleep(800);
    assert.equal(w.find(e => e.ev === "playback.started" && e.gen === 8), undefined);
    assert.equal(w.find(e => e.ev === "tts.ready" && e.gen === 8), undefined);
  } finally {
    await w.close();
  }
});

test("V22 rapid cancel and speak cycles keep turn state and gen monotonic", { skip }, async () => {
  const w = session(["--input-silence", "--output", "null", "--fixture-pace", "4"]);
  try {
    await w.until(e => e.ev === "ready", 15000, "ready");
    for (let i = 1; i <= 5; i++) {
      const gen = 10 + i;
      w.send({ op: "speak", turn: `cycle-${i}`, gen, seq: 0, text: `Cycle number ${i} is speaking now.`, device: -1, voice: null });
      await w.until(e => e.ev === "tts.ready" && e.gen === gen, 15000, "tts.ready");
      w.send({ op: "speak.cancel", gen });
      await w.until(e => e.ev === "speak.cancelled" && e.gen === gen, 8000, "speak.cancelled");
    }
    const cancels = w.events.filter(e => e.ev === "speak.cancelled").map(e => e.gen);
    assert.deepEqual(cancels, [11, 12, 13, 14, 15]);
    for (const e of w.events.filter(x => x.ev === "playback.started")) {
      const cancelAt = w.events.findIndex(x => x.ev === "speak.cancelled" && x.gen === e.gen);
      if (cancelAt >= 0) assert.ok(w.events.indexOf(e) < cancelAt, "no playback after its cancel");
    }
  } finally {
    await w.close();
  }
});

test("V25 shutdown with an active capture releases everything and exits 0 within 2 s", { skip }, async () => {
  const w = session(["--input-silence", "--fixture-pace", "2"]);
  try {
    await w.until(e => e.ev === "ready", 15000, "ready");
    w.send({ op: "capture.start", turn: "sd", gen: 1, device: -1, endpointing: "manual", maxMs: 20000 });
    await w.until(e => e.ev === "capture.started", 8000, "capture.started");
    const sentAt = Date.now();
    w.send({ op: "shutdown" });
    await w.until(e => e.ev === "bye", 2000, "bye");
    const code = await Promise.race([w.exited, sleep(2000).then(() => "timeout")]);
    assert.equal(code, 0);
    assert.ok(w.exitedAt() - sentAt < 2000, "worker must exit within 2 s of shutdown");
    const stopped = w.find(e => e.ev === "capture.stopped" && e.turn === "sd");
    assert.equal(stopped.reason, "shutdown");
  } finally {
    await w.close();
  }
});

test("unknown op is answered with UNKNOWN_OP and malformed JSON keeps the process alive", { skip }, async () => {
  const w = session();
  try {
    await w.until(e => e.ev === "ready", 10000, "ready");
    w.send({ op: "no.such.op" });
    const unknown = await w.until(e => e.ev === "error" && e.code === "UNKNOWN_OP", 5000, "UNKNOWN_OP");
    assert.equal(typeof unknown.message, "string");
    w.child.stdin.write("{not json\n");
    await w.until(e => e.ev === "error" && e.code === "INTERNAL", 5000, "INTERNAL");
    w.send({ op: "devices" });
    await w.until(e => e.ev === "devices", 10000, "devices after malformed input");
  } finally {
    await w.close();
  }
});

test("BUFFER_LIMIT rejects oversized speech text", { skip }, async () => {
  const w = session(["--input-silence", "--output", "null"]);
  try {
    await w.until(e => e.ev === "ready", 15000, "ready");
    w.send({ op: "speak", turn: "big", gen: 1, seq: 0, text: "x".repeat(401), device: -1, voice: null });
    const err = await w.until(e => e.ev === "playback.error" && e.turn === "big", 5000, "playback.error");
    assert.equal(err.code, "BUFFER_LIMIT");
  } finally {
    await w.close();
  }
});

test("V52 stdout carries only bounded JSON events with no audio-looking payload", { skip }, async () => {
  const w = session(["--input-synth", SPEECH, "--output", "null", "--fixture-pace", "3"]);
  try {
    await w.until(e => e.ev === "ready", 15000, "ready");
    w.send({ op: "capture.start", turn: "raw", gen: 1, device: -1, endpointing: "vad", maxMs: 20000 });
    await w.until(e => e.ev === "capture.stopped" && e.turn === "raw", 20000, "capture.stopped");
    await w.until(e => (e.ev === "stt.final" || e.ev === "stt.none") && e.turn === "raw", 10000, "stt terminal");
    w.send({ op: "speak", turn: "raw", gen: 1, seq: 0, text: "A short spoken line.", device: -1, voice: null });
    await w.until(e => e.ev === "playback.idle" && e.turn === "raw", 15000, "playback.idle");
    for (const line of w.lines) {
      assert.ok(line.length < 65536, "every stdout line must stay under 64 KiB");
      assert.doesNotMatch(line, /[A-Za-z0-9+/]{200,}/, "no base64-like payload");
      const ev = JSON.parse(line);
      for (const key of ["pcm", "audio", "samples", "base64", "wav"]) assert.equal(key in ev, false, `forbidden key ${key}`);
    }
  } finally {
    await w.close();
  }
});

test("a command line over 64 KiB is rejected and the worker stays alive", { skip }, async () => {
  const w = session();
  try {
    await w.until(e => e.ev === "ready", 10000, "ready");
    w.child.stdin.write("{\"op\":\"devices\",\"pad\":\"" + "a".repeat(70000) + "\"}\n");
    const err = await w.until(e => e.ev === "error" && e.code === "INTERNAL" && /64 KiB/.test(e.message), 5000, "oversize error");
    assert.equal(err.code, "INTERNAL");
    assert.equal(w.find(e => e.ev === "devices"), undefined, "the oversized command must not run");
    w.send({ op: "devices" });
    await w.until(e => e.ev === "devices", 10000, "devices after oversize line");
  } finally {
    await w.close();
  }
});

// ---------------------------------------------------------------------------------------------------------------
// M-A-3 T10 additions: endpointing, recognizer evidence, rejected text, AGC, stale-drop counting.
// Deterministic. The selftest runs the VAD, decision and gain rules with no devices. The WAV test runs the real
// capture pipeline on a fixture file, so no microphone is opened.
// ---------------------------------------------------------------------------------------------------------------
function runSelfTest() {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(exe, ["--selftest"], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    const timer = setTimeout(() => { child.kill(); rejectRun(new Error("selftest timed out")); }, 30000);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", d => { out += d; });
    child.on("exit", code => {
      clearTimeout(timer);
      if (code !== 0) return rejectRun(new Error(`selftest exited ${code}`));
      const line = out.split("\n").find(l => l.includes("\"ev\":\"selftest\""));
      if (!line) return rejectRun(new Error("no selftest event"));
      resolveRun(JSON.parse(line).results);
    });
  });
}

// 16 kHz mono 16-bit PCM WAV, built in memory.
function wav16k(samples) {
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((s, i) => data.writeInt16LE(s, i * 2));
  const h = Buffer.alloc(44);
  h.write("RIFF", 0, "ascii"); h.writeUInt32LE(36 + data.length, 4); h.write("WAVE", 8, "ascii");
  h.write("fmt ", 12, "ascii"); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(16000, 24); h.writeUInt32LE(32000, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write("data", 36, "ascii"); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

test("T10 endpointing: recognizer evidence keeps no_speech from firing and bounds the turn end", { skip }, async () => {
  const r = await runSelfTest();
  // Evidence every 500 ms through 9 s of quiet: no no_speech.
  assert.equal(r.noSpeechWithEvidence, false, "no_speech must not fire while the recognizer has hypothesized");
  // Evidence stops at frame 100 (2 s): no_speech fires after 8 s of quiet since then (frame 499 at 20 ms per frame).
  assert.equal(r.noSpeechFrame, 499);
  // Onset needs 120 ms above threshold (frame 35 for a burst starting at frame 30). The end needs silence >= 900 ms
  // AND evidence >= 700 ms old: silence starts at frame 60, so 900 ms is frame 105, but evidence is fresh until frame 135.
  assert.equal(r.speechStartFrame, 35);
  assert.equal(r.speechEndFrame, 135);
});

test("T10 Part-B endpointing: room noise above the calibrated floor still ends the turn; one loud click does not", { skip }, async () => {
  const r = await runSelfTest();
  // Onset at frame 35, speech through frame 104, noise at 0.0012 from frame 105: below 8% of the 0.02 speech peak
  // (0.0016), so 900 ms of "silence" completes at frame 149. Before the fix this never ended (-1, the 30 s cap live).
  assert.equal(r.noisyTailEndFrame, 149);
  assert.equal(r.clickEndFrame, -1, "a single transient must not raise the end threshold above soft speech");
  // R4 T10-VAD-1: soft speech after a loud section is not silence; the end is ~900 ms into the true silence (frame 225+).
  assert.ok(r.softAfterLoudEndFrame >= 269 && r.softAfterLoudEndFrame <= 272, `soft speech ended the turn at frame ${r.softAfterLoudEndFrame}`);
});

test("T10 stop decision: rejected-only recognizer text is stt.none rejected, never a final", { skip }, async () => {
  const r = await runSelfTest();
  assert.equal(r.rejectedOnly, "rejected");
  assert.equal(r.rejectedWithoutOnset, "no_speech", "text without a VAD onset is never trusted");
  assert.equal(r.recognizedWithOnset, "final");
  assert.equal(r.recognizedWithoutOnset, "noise_only");
  assert.equal(r.abortedWins, "aborted");
});

test("T10 AGC: the gained audio never changes the reported levels, and gain stays in 1x..24x", { skip }, async () => {
  const r = await runSelfTest();
  assert.equal(r.agcSourceUntouched, true, "AGC must not write into the raw frame");
  assert.equal(r.rawRmsUnchanged, true);
  assert.ok(r.agcSpeechGain > 20 && r.agcSpeechGain <= 24, `speech gain should approach the 24x clamp, got ${r.agcSpeechGain}`);
  assert.equal(r.agcQuietGain, 1, "no amplification outside speech (the noise floor is never amplified)");
});

test("T10 levels: reported rms and peak equal the raw fixture samples window by window (AGC cannot change them)", { skip }, async () => {
  // A quiet 16 kHz tone, about -50 dBFS, with slow amplitude drift: the level the real mic would report.
  const samples = [];
  for (let i = 0; i < 25600; i++) {
    samples.push(Math.round(90 * Math.sin(2 * Math.PI * 180 * i / 16000) * (0.5 + 0.5 * Math.sin(i / 3000))));
  }
  const dir = mkdtempSync(join(tmpdir(), "bunny-t10-wav-"));
  const path = join(dir, "quiet.wav");
  writeFileSync(path, wav16k(samples));
  const w = session(["--input-wav", path, "--output", "null", "--fixture-pace", "8"]);
  try {
    await w.until(e => e.ev === "ready", 15000, "ready");
    w.send({ op: "capture.start", turn: "lvl", gen: 1, device: -1, endpointing: "manual", maxMs: 3000 });
    await w.until(e => e.ev === "capture.stopped" && e.turn === "lvl", 15000, "capture.stopped");
    const levels = w.events.filter(e => e.ev === "level" && e.turn === "lvl");
    const windows = 25600 / 1600; // 5 frames of 320 samples per level event
    assert.ok(levels.length >= windows, `expected at least ${windows} level events, got ${levels.length}`);
    for (let k = 0; k < windows; k++) {
      const slice = samples.slice(k * 1600, (k + 1) * 1600);
      let sq = 0;
      let peak = 0;
      for (const s of slice) {
        const v = s / 32768;
        sq += v * v;
        if (Math.abs(v) > peak) peak = Math.abs(v);
      }
      const rms = Math.sqrt(sq / slice.length);
      assert.ok(Math.abs(levels[k].rms - rms) < 1e-9, `window ${k} rms ${levels[k].rms} != raw ${rms}`);
      assert.ok(Math.abs(levels[k].peak - peak) < 1e-12, `window ${k} peak ${levels[k].peak} != raw ${peak}`);
    }
  } finally {
    await w.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("T10 staleDropped: speak commands at or below the highest cancelled gen are counted per cancel receipt", { skip }, async () => {
  const w = session(["--input-silence", "--output", "null", "--fixture-pace", "4"]);
  try {
    await w.until(e => e.ev === "ready", 15000, "ready");
    w.send({ op: "speak.cancel", gen: 5 });
    const first = await w.until(e => e.ev === "speak.cancelled" && e.gen === 5, 5000, "speak.cancelled");
    assert.equal(first.staleDropped, 0);
    w.send({ op: "speak", turn: "old-3", gen: 3, seq: 0, text: "Stale one.", device: -1, voice: null });
    w.send({ op: "speak", turn: "old-4", gen: 4, seq: 0, text: "Stale two.", device: -1, voice: null });
    w.send({ op: "speak.cancel", gen: 6 });
    const second = await w.until(e => e.ev === "speak.cancelled" && e.gen === 6, 5000, "speak.cancelled");
    assert.equal(second.staleDropped, 2, "two stale speak commands since the previous cancel receipt");
    w.send({ op: "speak.cancel", gen: 7 });
    const third = await w.until(e => e.ev === "speak.cancelled" && e.gen === 7, 5000, "speak.cancelled");
    assert.equal(third.staleDropped, 0, "the count resets at each cancel receipt");
    assert.equal(w.find(e => e.ev === "playback.started" && e.gen <= 5 && e.gen >= 3), undefined, "stale gens never play");
  } finally {
    await w.close();
  }
});

// ---------------------------------------------------------------------------------------------------------------
// Review round 1 (native lens) regression checks. The in-process checks run once in the selftest, which uses fakes:
// no device is opened, no recognizer runs, and nothing is audible. The live checks use the null sink and fixtures.
// ---------------------------------------------------------------------------------------------------------------
let sharedSelfTestPromise = null;
const sharedSelfTest = () => {
  if (!sharedSelfTestPromise) sharedSelfTestPromise = runSelfTest();
  return sharedSelfTestPromise;
};

test("native#0 a stalled playback driver never holds the command loop: cancel, enqueue and shutdown stay bounded", { skip }, async () => {
  const r = await sharedSelfTest();
  assert.equal(r.stallOpened, true, "the playback thread reached the stalled driver Open");
  assert.equal(r.stallCommandsNotBlocked, true, "queue state stays readable while the driver is stalled");
  assert.equal(r.stallCancelBounded, true, "speak.cancel returns within its bounded wait, not the driver stall");
  assert.equal(r.stallCancelPending, true, "the receipt reports the reset as resetPending while the driver is stuck");
  assert.equal(r.stallCancelRecovers, true, "a later cancel is acknowledged once the driver returns");
  assert.equal(r.stallShutdownBounded, true, "shutdown does not wait on the driver");
});

test("native#0 live: a healthy speak.cancel applies the reset within the bounded wait and reports no resetPending", { skip }, async () => {
  const w = session(["--input-silence", "--output", "null", "--fixture-pace", "2"]);
  try {
    await w.until(e => e.ev === "ready", 15000, "ready");
    const long = "This sentence is long enough that the barge in arrives while the null sink is still playing it.";
    [0, 1].forEach(seq => w.send({ op: "speak", turn: "nb", gen: 3, seq, text: long, device: -1, voice: null }));
    await w.until(e => e.ev === "playback.started" && e.turn === "nb" && e.seq === 0, 15000, "playback.started");
    w.send({ op: "speak.cancel", gen: 3 });
    const cancelled = await w.until(e => e.ev === "speak.cancelled" && e.gen === 3, 8000, "speak.cancelled");
    assert.equal(cancelled.resetPending, undefined, "no resetPending when the reset was applied");
    assert.ok(cancelled.resetMs < 250, `reset acknowledged within the bounded wait, got ${cancelled.resetMs} ms`);
  } finally {
    await w.close();
  }
});

test("native#2 abandoned recognizers: raw audio is zeroed and released, and the ledger refuses past its bound", { skip }, async () => {
  const r = await sharedSelfTest();
  assert.equal(r.pipeWipeReadBytes, 0, "a wiped pipe ends the stream: reads see EOF");
  assert.equal(r.pipeWipeUnread, 0, "a wiped pipe holds no raw audio");
  assert.equal(r.abandonRefusedAtMax, true, "two unfinished abandoned recognizers fill the ledger");
  assert.equal(r.abandonReleasedWhenFinished, true, "a finished abandoned recognizer is released and frees a slot");
  assert.equal(r.abandonRefusedAgain, true, "the ledger refuses again at its bound and releases nothing still running");
});

test("native#3 speak.cancel receipts share one meter worker, and a full queue starts no thread", { skip }, async () => {
  const r = await sharedSelfTest();
  assert.equal(r.meterThreads, 1, "one background worker serves every receipt");
  assert.equal(r.meterAccepted, 5, "the worker queue holds one in progress plus MaxPending");
  assert.equal(r.meterRefusedWhenFull, true, "a request beyond the bound is refused, not given its own thread");
  assert.equal(r.meterDelivered, r.meterAccepted, "every accepted request is delivered exactly once");
});

test("native#4 device index is range-checked: out of range is DEVICE_UNAVAILABLE and never wraps to another device", { skip }, async () => {
  const r = await sharedSelfTest();
  assert.equal(r.deviceArgs, "F,T:-1,T:0,F,T:-1,F,F,T:-1,F,T:2147483647", "only absent/null and [-1, int.MaxValue] integers are accepted");
  const w = session(["--input-silence", "--output", "null"]);
  try {
    await w.until(e => e.ev === "ready", 15000, "ready");
    w.send({ op: "capture.start", turn: "dev-wrap", gen: 1, device: 4294967296, endpointing: "manual", maxMs: 1000 });
    const err = await w.until(e => e.ev === "capture.error" && e.turn === "dev-wrap", 8000, "capture.error");
    assert.equal(err.code, "DEVICE_UNAVAILABLE");
    assert.equal(w.find(e => e.ev === "capture.started" && e.turn === "dev-wrap"), undefined);
    w.send({ op: "speak", turn: "dev-wrap-tts", gen: 1, seq: 0, text: "Not wrapped to device zero.", device: 4294967296, voice: null });
    const perr = await w.until(e => e.ev === "playback.error" && e.turn === "dev-wrap-tts", 8000, "playback.error");
    assert.equal(perr.code, "DEVICE_UNAVAILABLE");
    await sleep(300);
    assert.equal(w.find(e => e.ev === "playback.started" && e.turn === "dev-wrap-tts"), undefined);
    // The default device is still accepted on the same process.
    w.send({ op: "capture.start", turn: "dev-ok", gen: 2, device: -1, endpointing: "manual", maxMs: 1000 });
    await w.until(e => e.ev === "capture.started" && e.turn === "dev-ok", 8000, "capture.started");
    w.send({ op: "capture.abort", gen: 2 });
    await w.until(e => e.ev === "stt.none" && e.turn === "dev-ok", 8000, "aborted terminal");
  } finally {
    await w.close();
  }
});

test("native#5 a worker thread fault is contained: the guard runs its handler and the body never escapes", { skip }, async () => {
  const r = await sharedSelfTest();
  assert.equal(r.guardCaught, true, "the thrown fault reached the handler");
  assert.equal(r.guardReturned, true, "the guard returned normally to its caller");
});

test("native#6 the finalize decision reads the onset state published during capture, not a value set at thread exit", { skip }, async () => {
  const r = await sharedSelfTest();
  assert.equal(r.onsetPublished, true, "the onset state is visible while frames are processed");
  assert.equal(r.onsetDecision, "final", "recognized text with a published onset is not dropped as no speech");
});

// ---------------------------------------------------------------------------------------------------------------
// Review round 2 (native lens). The containment checks run in the selftest against fakes and a broken stream: no
// device is opened, no recognizer hears audio, and nothing is audible. The source checks pin the ownership order
// that the in-process checks cannot reach without a driver.
// ---------------------------------------------------------------------------------------------------------------
const sourceText = () => readFileSync(sourcePath, "utf8");

test("R2-native#0 a recognizer whose start throws is disposed before the error propagates, so the turn holds no engine", { skip }, async () => {
  const r = await sharedSelfTest();
  assert.equal(r.recognizerFaultThrew, true, "the start failure reaches the caller");
  assert.equal(r.recognizerFaultReleased, true, "the failed turn no longer holds its recognizer engine");
  assert.match(sourceText(), /catch \(Exception\)\s*\{\s*ReleaseEngine\(\);\s*throw;\s*\}/, "StartRecognizer disposes the engine on every failure path");
});

test("R2-native#1 the capture thread body is guarded: a protocol write that fails on a closed pipe ends the turn, not the process", { skip }, async () => {
  const r = await sharedSelfTest();
  assert.equal(r.captureBodyContained, true, "the capture thread ends normally when every protocol write fails");
  assert.match(sourceText(), /new Thread\(\(\) => Guard\.Run\(\(\) => CaptureLoop\(source\), FaultCapture\)\)/, "the capture thread body runs under Guard.Run");
  assert.match(sourceText(), /void EmitCaptureError[\s\S]*?Guard\.Emit\(/, "capture error emits on fault paths cannot throw");
});

test("R2-native#2 a playback chunk whose header never completes is released after the reset, and its device handle is closed", { skip }, async () => {
  const r = await sharedSelfTest();
  assert.equal(r.timedOutChunkReleased, true, "the timed-out chunk is released once, after the reset returns it");
  assert.equal(r.timedOutHandleClosed, true, "the device handle is closed after a timeout");
  const src = sourceText();
  assert.match(src, /if \(h != null\) h\.Release\(c\);\s*CloseDevice\(\);/, "the timeout path releases the chunk before closing the device");
  assert.match(src, /uint closed = Native\.waveOutClose\(handle\);\s*if \(closed != 0\)\s*\{\s*Native\.waveOutReset\(handle\);\s*Native\.waveOutClose\(handle\);/, "a failed waveOutClose is retried once after a reset");
  assert.match(src, /if \(c\.Header != IntPtr\.Zero && Native\.waveOutUnprepareHeader\(handle, c\.Header, \(uint\)Native\.HdrSize\) == Native\.WAVERR_STILLPLAYING\) continue;/, "a header the driver still owns is never freed");
});

test("R2-native#3 raw microphone buffers are zeroed before they are freed, and capture frames are cleared when the turn ends", { skip }, async () => {
  const r = await sharedSelfTest();
  assert.equal(r.nativeWipeZero, true, "unmanaged audio reads back as zeros after the wipe");
  const src = sourceText();
  assert.match(src, /Native\.WipeNative\(data\[i\], Consts\.FrameBytes\);\s*Marshal\.FreeHGlobal\(data\[i\]\);/, "WaveInSource.Close wipes each capture buffer before freeing it");
  assert.match(src, /Array\.Clear\(frame, 0, frame\.Length\);\s*Array\.Clear\(fed, 0, fed\.Length\);/, "CaptureLoop clears its frame and feed buffers on exit");
});

// ---------------------------------------------------------------------------------------------------------------------
// M-A-3 T12 native checks. The duplex endpointing cases run in the selftest against explicit floors (no device, no
// recognizer). Frames are 20 ms. "AEC effectiveness" is NOT asserted anywhere: the render-identity checks only prove the
// endpoint-id guard, and echo cancellation needs device evidence.
// ---------------------------------------------------------------------------------------------------------------------
test("T12-native VT-01 a short duplex burst (200 ms) ends its speech turn: onset, then speech_end within 1.2 s, flagged short", { skip }, async () => {
  const r = await sharedSelfTest();
  assert.ok(r.duplexBurstStart >= 0, "the 200 ms burst is an onset (not dropped as too short to start)");
  assert.ok(r.duplexBurstEnd >= 30, "speech_end follows the burst, it is not withheld for being under 250 ms");
  assert.ok(r.duplexBurstEnd - 30 <= 60, `speech_end within 1.2 s of the burst end (frames ${r.duplexBurstEnd - 30})`);
  assert.equal(r.duplexBurstShort, true, "the burst is reported as short so the turn ends without a decode");
});

test("T12-native VT-02 stationary ambient never counts as speech: no onset in 10 s and the floor learns the level", { skip }, async () => {
  const r = await sharedSelfTest();
  assert.equal(r.duplexStationarySpeechStarts, 0, "0.0008 stationary noise from a 0.0002 start is never an onset");
  assert.ok(r.duplexStationaryFloor > 0.0005, `the floor rose toward the ambient level (${r.duplexStationaryFloor})`);
});

test("T12-native VT-03 speech over a calibrated noise floor starts and ends about 900 ms after it stops", { skip }, async () => {
  const r = await sharedSelfTest();
  assert.ok(r.duplexNoisySpeechStart >= 20 && r.duplexNoisySpeechStart <= 26, "onset at the speech start (frame 20 plus the 120 ms window)");
  assert.ok(r.duplexNoisySpeechEnd >= 70, "the turn does not end inside the speech");
  assert.ok(r.duplexNoisySpeechEnd - 70 <= 60, `speech_end within 1.2 s of the speech stop (${r.duplexNoisySpeechEnd - 70} frames)`);
});

test("T12-native VT-G3 a loud click does not permanently suppress soft speech that follows it", { skip }, async () => {
  const r = await sharedSelfTest();
  assert.ok(r.duplexClickThenSoftStart >= 25 && r.duplexClickThenSoftStart <= 35, `soft speech after a 0.5 click is detected (onset frame ${r.duplexClickThenSoftStart})`);
});

test("T12-native VT-05 output-aware onset: our own residual at 0.003 never starts a turn, but user speech over it does", { skip }, async () => {
  const r = await sharedSelfTest();
  // T12 live calibration: a learned residual (seeded from the first output frames) never starts a turn; user speech does.
  assert.equal(r.aecSteadyEcho0045Onsets, 0, "a steady residual seeded from the first output frames is not an onset");
  assert.ok(r.aecUserOverEchoOnset >= 0 && r.aecUserOverEchoOnset <= 10, `user speech over our output is an onset (frame ${r.aecUserOverEchoOnset})`);
});

// T12 AEC repairs (AEC-01, AEC-02, AEC-05, AEC-06, PRIV-03, RC-02). Each assertion here fails on the code before its repair:
// the selftest cases are constructed to hit the failing path (quiet first frames, a pause, a gap, a replay after output).
test("T12-native AEC-01/06 echo after quiet first frames, a pause and a gap is never an onset (the residual is floored and held)", { skip }, async () => {
  const r = await sharedSelfTest();
  // T12 live calibration: the measured residual is ~0, so the floor is low and a loud echo after a quiet start may cause one
  // onset (a brief pause; the Host's echo gate drops its transcript). It must never repeat.
  assert.ok(r.duplexOutputEchoOnsets <= 1, `output starts on 5 quiet frames, then 200 frames of echo at 0.003: at most one onset (${r.duplexOutputEchoOnsets})`);
  assert.equal(r.aecPausedEchoOnsets, 0, "a chunk in flight but paused for 1200 ms (output flag on, device silent), then echo at 0.003: no onset");
  assert.equal(r.aecGapEchoOnsets, 0, "echo lingering 400 ms past the output flag, then quiet restart frames and echo at 0.003: no onset");
});

test("T12-native AEC-01 the learned residual is not decayed by a paused (silent) window", { skip }, async () => {
  const r = await sharedSelfTest();
  assert.ok(r.aecResidualBeforePause > 0.0027, `the residual learned the 0.0028 echo (${r.aecResidualBeforePause})`);
  assert.ok(Math.abs(r.aecResidualAfterPause - r.aecResidualBeforePause) < 1e-9, `1200 ms of silence leaves the residual unchanged (${r.aecResidualAfterPause})`);
});

test("T12-native AEC-05 user speech at 0.008 over 0.003 echo starts a turn, and never lifts the residual above the echo cap", { skip }, async () => {
  const r = await sharedSelfTest();
  assert.ok(r.aecUserOverEchoOnset >= 0 && r.aecUserOverEchoOnset <= 10, `user speech over our output is an onset (frame ${r.aecUserOverEchoOnset})`);
  assert.ok(r.aecResidualAfterUserSpeech <= 0.0031, `200 frames of user speech do not raise the residual (${r.aecResidualAfterUserSpeech})`);
  assert.ok(r.aecThresholdAfterUserSpeech < 0.008, `the onset threshold stays below user speech at 0.008 (${r.aecThresholdAfterUserSpeech})`);
});

// T12 AEC round 2 (verifier HIGH on AEC-05): the adapt band reaches the cap's echo level, and the multi-frame seed learns a loud
// steady echo after a quiet start. Before this fix, echo at 0.0045 and 0.005 re-triggered speech_start on every cycle.
test("T12-native round-2 AEC-01/05 a steady echo at 0.0045 or 0.005, or a loud echo after a quiet start, is no onset while output is audible", { skip }, async () => {
  const r = await sharedSelfTest();
  assert.equal(r.aecSteadyEcho0045Onsets, 0, "steady echo at 0.0045 with output on from the first frame: no onset (was 6 before the fix)");
  assert.equal(r.aecSteadyEcho005Onsets, 0, "steady echo at 0.005 with output on from the first frame: no onset");
  assert.ok(r.aecQuietStartEcho005Onsets <= 1, `five quiet frames, then echo at 0.005: at most one onset, never a repeat (${r.aecQuietStartEcho005Onsets})`);
  assert.ok(r.aecUserOver0045EchoOnset >= 0 && r.aecUserOver0045EchoOnset <= 10, `user speech at 0.008 over a 0.0045 echo is an onset (frame ${r.aecUserOver0045EchoOnset})`);
  assert.ok(Math.abs(r.aecOutputThresholdCeiling - 0.006) < 1e-9, `with output audible the onset threshold is capped at 0.006 (${r.aecOutputThresholdCeiling})`);
});

test("T12-native live calibration: the measured device residual never starts a turn and 0.003 speech over it does within 120 ms", { skip }, async () => {
  const r = await sharedSelfTest();
  assert.equal(r.aecLiveResidualOnsets, 0, "200 frames of the measured own-speech residual (2e-5..8e-5) while output plays: no onset");
  assert.ok(r.aecLiveOutputThreshold < 0.003, `the output-time threshold stays below measured double-talk speech (${r.aecLiveOutputThreshold})`);
  assert.ok(r.aecLiveUserOnset >= 0 && r.aecLiveUserOnset <= 6, `0.003 user speech over the live residual is an onset within 120 ms (frame ${r.aecLiveUserOnset})`);
});

test("T12-native AEC-02 a pre-roll replay never carries frames captured while our output was audible or in its reverb tail", { skip }, async () => {
  const r = await sharedSelfTest();
  assert.equal(r.prerollEchoFrames, 0, "no replayed frame was captured while our 0.003 echo was audible or in its 260 ms tail");
  assert.ok(r.prerollReplayedFrames > 0, `the quiet frames around the echo are still replayed (${r.prerollReplayedFrames})`);
  assert.equal(r.turnFramesKeepCaptureMono, true, "a replayed frame keeps its capture time");
  assert.equal(r.onsetMonoFromCapture, 700, "the onset is timed from the capture time of its first loud frame, not the replay time");
});

test("T12-native PRIV-03 a capture loop that ends because the microphone is muted reports 'mute', and the lifetime bound reports 'lifetime'", { skip }, async () => {
  const r = await sharedSelfTest();
  assert.equal(r.duplexStopReasonOnMute, "mute", "the mute exit is not labelled lifetime");
  assert.equal(r.duplexStopReasonLifetime, "lifetime", "the maxMs bound still reports lifetime");
  assert.equal(r.duplexStopReasonMuteAndBound, "lifetime", "a mute that lands in the same read as an expired lifetime bound is reported as the lifetime (round 2)");
});

// T12 AEC-02 round 2 (verifier LOW): user speech over our output is kept in the pre-roll, while our echo is dropped.
test("T12-native AEC-02 round-2 user speech at 0.03 captured during our output is kept in the pre-roll for the next turn", { skip }, async () => {
  const r = await sharedSelfTest();
  assert.equal(r.prerollUserFramesKept, 30, "all 30 frames of user speech over our output are replayed, not dropped as echo");
});

test("T12-native RC-02 a playback.error for a generation releases its pause: the next chunk of that gen is not paused", { skip }, async () => {
  const r = await sharedSelfTest();
  assert.equal(r.ttsFailurePauseReleased, true, "after a TTS_UNAVAILABLE for gen 21, the next gen-21 chunk is not paused and completes");
  assert.equal(r.pauseRefusalReleased, true, "after a refused pause for gen 22, the next gen-22 chunk is not asked to pause and completes");
});

test("T12-native VT-01 stationary loud ambient in a duplex turn ends after the silence clock, not at the cap", { skip }, async () => {
  const r = await sharedSelfTest();
  assert.ok(r.duplexLoudNoiseStart >= 5 && r.duplexLoudNoiseStart <= 7, `onset after the 120 ms window (frame ${r.duplexLoudNoiseStart})`);
  assert.ok(r.duplexLoudNoiseEnd >= 0, "the steady 0.05 ambient ends its turn");
  assert.ok(r.duplexLoudNoiseEnd - r.duplexLoudNoiseStart <= 60, `speech_end within 1.2 s of the onset (${r.duplexLoudNoiseEnd - r.duplexLoudNoiseStart} frames)`);
});

test("T12-native N-02 behaviour: on the playback thread a pause precedes the reset, and no restart happens before it", { skip }, async () => {
  const r = await sharedSelfTest();
  assert.equal(r.playbackPausedBeforeReset, true, "the device is paused for the chunk before the barge-in");
  assert.equal(r.playbackNoRestartBeforeReset, true, "no pause(false) is issued before the reset of the cancelled chunk");
  assert.equal(r.playbackNoPauseAfterCancel, true, "a cancelled chunk is never paused again");
  assert.equal(r.playbackCancelAcknowledged, true, "the cancel receipt is not pending");
});

test("T12-native VT-09 soft speech with no frame above the onset threshold for 4 s ends the turn, even with evidence held fresh", { skip }, async () => {
  const r = await sharedSelfTest();
  assert.ok(r.duplexSoftWaitEnd >= 0, "the held soft turn ends");
  assert.ok(r.duplexSoftWaitEnd - 35 >= 195 && r.duplexSoftWaitEnd - 35 <= 205, `ends at the 4 s soft bound (${r.duplexSoftWaitEnd - 35} frames after the tail starts)`);
  assert.equal(r.duplexSoftWaitShort, false, "a 300 ms speech turn is not a short burst");
});

test("T12-native N-07 the render-identity checks are labelled as guards, and claim no echo cancellation", { skip }, async () => {
  const r = await sharedSelfTest();
  assert.equal(r.renderIdentityInitiallyMatches, true);
  assert.equal(r.renderIdentityReorderRefused, true);
  assert.equal("aecMappingInitiallyMatches" in r, false, "the old, misleading key is gone");
  assert.match(sourceText(), /They prove nothing about echo cancellation/, "the source states the limit");
});

test("T12-native N-03 the stdout queue is 2048 lines / 1 MiB and the stall watchdog is 10 s, both bounded", { skip }, () => {
  const src = sourceText();
  assert.match(src, /MaxPendingLines = 2048, MaxPendingBytes = 1024 \* 1024, StallExitMs = 10000;/);
  assert.match(src, /pending\.Count >= MaxPendingLines \|\| queuedBytes \+ bytes\.Length > MaxPendingBytes\) \{ Environment\.Exit\(3\); return; \}/, "overflow still exits contained");
  assert.match(src, /Thread\.Sleep\(30000\);\s*return 9;/, "the stalled-pipe selftest outlasts the watchdog");
});

test("T12-native N-01 duplex open honors stop and mute before, during and after the device open", { skip }, () => {
  const src = sourceText();
  assert.match(src, /if \(Cancelled\) throw new DuplexCancelled\(\);\s*timeBeginPeriod\(1\);/, "a cancelled session never reaches the device");
  assert.match(src, /source = open\(\(\) => Cancelled\);\s*if \(Cancelled\) throw new DuplexCancelled\(\);/, "a cancel during open closes the source without looping");
  assert.match(src, /catch \(DuplexCancelled\)\s*\{\s*reason = "stop";/, "a cancel is a stop, not a duplex.error");
  assert.ok((src.match(/Checkpoint\(cancelled\);/g) || []).length >= 7, "AecSource construction has checkpoints between each expensive step");
  assert.match(src, /static bool Muted|public static volatile bool Muted;/, "the mute flag is visible across threads");
});

test("T12-native N-02 a pending reset is applied before any pause decision, and a cancelled chunk never restarts the device", { skip }, () => {
  const src = sourceText();
  assert.match(src, /ApplyPendingReset\(\);\s*long tick = sw\.ElapsedMilliseconds;\s*if \(ApplyPause\(c\)\)/, "the reset comes first in the playback tick");
  assert.match(src, /if \(c\.Cancelled\) return devicePaused;\s*if \(want == devicePaused\) return want;/, "ApplyPause returns before any device call for a cancelled chunk");
  assert.match(src, /if \(devicePaused\)\s*\{\s*try \{ if \(waveOut != null\) waveOut\.Pause\(false\); \}\s*catch \(VoiceFault\) \{ CloseDevice\(\); \}\s*if \(devicePaused\) ReleasePaused\(devicePausedTurn, devicePausedGen\);/, "the reset restarts a paused device and announces the release once");
  assert.match(src, /void PauseDeviceFailed\(Chunk c, VoiceFault f\)/, "a refused pause fails the chunk with the device code");
});

test("T12-native N-06 speak.pause emits a measured receipt off the playback thread, bounded to 1.5 s", { skip }, () => {
  const src = sourceText();
  assert.match(src, /static readonly CancelMeter pauseMeter = new CancelMeter\(since => Endpoints\.PollRender\(since, 1500\)\);/, "the pause meter is bounded at 1500 ms");
  assert.match(src, /bool queued = PauseMeter\.TrySubmit\(clock, reading =>/, "the receipt is finished on the meter worker");
  assert.match(src, /long appliedMono = Out\.Clock\.ElapsedMilliseconds;\s*Stopwatch clock = Stopwatch\.StartNew\(\);/, "the meter clock starts when the device is paused, not when the request arrived");
  assert.match(src, /\(object\)\(appliedMono \+ \(long\)Math\.Round\(silent\.Value\)\)/, "silentMono is measured from the applied pause");
  assert.match(src, /"requestMono", requestMono/, "the receipt carries the request time");
  assert.match(src, /meter\.TrySubmit\(since, done\)/, "cancel receipts keep their own meter");
});

test("T12-native N-04 AEC output is drained while INCOMPLETE is set, into a bounded one-second pending buffer", { skip }, () => {
  const src = sourceText();
  assert.match(src, /const uint DmoOutputIncomplete = 0x01000000;/);
  assert.match(src, /PendingBytes = 32000;/);
  assert.match(src, /for \(int call = 0; ; call\+\+\)[\s\S]*?ProcessOutput\(0, 1, output, out status\)[\s\S]*?if \(\(output\[0\]\.status & DmoOutputIncomplete\) == 0 \|\| call \+ 1 >= MaxDrainCalls\) break;/, "the drain loop continues while INCOMPLETE");
  assert.match(src, /BUFFER_LIMIT", "AEC output exceeded the one second pending bound"/, "overflow is an explicit BUFFER_LIMIT");
});

test("T12-native N-05 three rotating silence buffers keep the render endpoint fed", { skip }, () => {
  const src = sourceText();
  assert.match(src, /const int SilenceBuffers = 3;/);
  assert.match(src, /for \(int i = 0; i < SilenceBuffers; i\+\+\)\s*\{\s*if \(keepalive\.IsDone\(silences\[i\]\)\)/, "every silence buffer is refilled as the driver returns it");
});

test("T12-native N-10 timeBeginPeriod(1) is paired with timeEndPeriod(1) on every path of a duplex session", { skip }, () => {
  const src = sourceText();
  assert.match(src, /timeBeginPeriod\(1\);\s*periodBegun = true;/);
  assert.match(src, /if \(periodBegun\) timeEndPeriod\(1\);/, "ended in the finally, so error and cancel paths are covered");
  assert.equal((src.match(/timeBeginPeriod\(1\);/g) || []).length, 1, "one begin per session");
});

test("T12-native VT-09 the finalizing turns stay abortable through a bounded list, so a new capture can attach", { skip }, () => {
  const src = sourceText();
  assert.match(src, /Program\.Finalizing\.Add\(this\);/, "a turn that stops capturing stays reachable until its terminal event");
  assert.match(src, /lock \(Program\.Gate\) \{ finalizeDone = true; Program\.Finalizing\.Remove\(this\); \}/, "the entry is removed once the terminal event is out");
  assert.match(src, /if \(!finalizeDone\) Program\.Finalizing\.Add\(this\);/, "a finalizer that finished first leaves no entry behind");
  assert.match(src, /if \(Finalizing\.Count >= MaxFinalizing\)/, "the finalizing backlog is bounded");
  assert.match(src, /Active != null\) \{ CaptureError\(turn, gen, "DEVICE_BUSY"/, "only the active capture blocks a new one");
});

test("T12-native AUD-04 capture.abort with a turn id matches turn AND gen exactly", { skip }, () => {
  const src = sourceText();
  assert.match(src, /CaptureTurn exact = FindCapture\(abortTurn, abortGen\);/);
  assert.match(src, /if \(Active != null && Active\.Turn == turn && Active\.Gen == gen\) return Active;/);
  assert.match(src, /foreach \(CaptureTurn f in Finalizing\) if \(f\.Turn == turn && f\.Gen == gen\) return f;/);
});

test("T12-native VT-01 duplex speech_end always reports speechMs and short, and short bursts skip the decode", { skip }, () => {
  const src = sourceText();
  assert.match(src, /"speechMs", vad\.SpeechMs, "short", vad\.EndedShort/);
  assert.match(src, /if \(!aborted && !quick\)/, "the SAPI flush is skipped for short bursts");
  assert.match(src, /if \(!stopped && onset && !quick && n > 0/, "the whisper decode is skipped for short bursts");
  assert.match(src, /"too_short"/);
});

// ---------------------------------------------------------------------------------------------------------------------
// whisper.cpp engine (--stt whisper). These tests need the staged runtime. If it is absent they FAIL with the command
// to run; they are never skipped silently. Stage with: node scripts/stage-whisper.mjs, then node scripts/build-voice-worker.mjs
// ---------------------------------------------------------------------------------------------------------------------
const runtimeDir = join(root, "native/voice/vendor/runtime");
const modelPath = join(runtimeDir, "models/ggml-base.en.bin");
const shimPath = join(runtimeDir, "bunny-whisper-shim.dll");
const whisperArgs = ["--stt", "whisper", "--whisper-dir", runtimeDir, "--whisper-model", modelPath];
const STAGE_HINT = "whisper runtime is not staged: run node scripts/stage-whisper.mjs, then node scripts/build-voice-worker.mjs";

function requireWhisperRuntime() {
  const missing = [join(runtimeDir, "whisper.dll"), join(runtimeDir, "ggml.dll"), join(runtimeDir, "ggml-base.dll"), shimPath, modelPath]
    .filter(p => !existsSync(p))
    .map(p => p.slice(root.length + 1));
  assert.equal(missing.length, 0, `${STAGE_HINT}. Missing: ${missing.join(", ")}`);
}

test("whisper: the staged runtime and model match native/voice/whisper-pin.json and the build record", { skip }, () => {
  requireWhisperRuntime();
  const pin = JSON.parse(readFileSync(join(root, "native/voice/whisper-pin.json"), "utf8"));
  assert.equal(pin.schema, "bunny-whisper-pin/1");
  assert.equal(pin.commit, "927cfce34f31707e17f2bff35c349632fb9e2c3a");
  for (const [name, expected] of Object.entries(pin.runtimeFiles)) {
    assert.equal(sha(join(runtimeDir, name)), expected, `runtime ${name} differs from the pin`);
  }
  assert.equal(sha(modelPath), pin.model.sha256, "model differs from the pin");
  const record = JSON.parse(readFileSync(recordPath, "utf8"));
  assert.ok(record.whisperShim, `build record has no whisperShim: ${STAGE_HINT}`);
  assert.equal(record.whisperShim.binarySha256, sha(shimPath), "shim binary differs from the build record");
  assert.equal(record.whisperShim.sourceSha256, sha(join(root, "native/voice/whisper-shim.c")), "shim source differs from the build record");
  assert.equal(record.whisperShim.linkedAgainst["whisper.dll"], pin.runtimeFiles["whisper.dll"]);
});

test("whisper: ready reports whisper.cpp v1.9.4 running locally on ggml-base.en with no fallback error", { skip }, async () => {
  requireWhisperRuntime();
  const w = session([...whisperArgs, "--input-silence", "--output", "null"]);
  try {
    const ready = await w.until(e => e.ev === "ready", 10000, "ready");
    assert.deepEqual(ready.stt, { engine: "whisper.cpp v1.9.4", recognizer: "ggml-base.en", culture: "en", local: true });
    await sleep(300);
    assert.equal(w.events.find(e => e.ev === "error"), undefined, "no STT_UNAVAILABLE expected when the model loads");
    const load = /whisper model loaded in (\d+) ms/.exec(w.stderr());
    assert.ok(load, "the model load time is reported on stderr");
    assert.ok(Number(load[1]) < 10000, `model load took ${load[1]} ms`);
    console.log(`[whisper] model load ${load[1]} ms`);
  } finally {
    await w.close();
  }
});

const PHRASES = [
  { text: "did the tests pass in my last mission", keys: [/tests? pass/i, /mission/i] },
  { text: "what is my agent doing", keys: [/agent/i, /doing/i] },
];

test("whisper: synthesized phrases give a final with the key words and confidence above 0.5, and no partial follows the final", { skip }, async () => {
  requireWhisperRuntime();
  const latencies = [];
  for (const p of PHRASES) {
    const w = session([...whisperArgs, "--input-synth", p.text, "--fixture-pace", "2", "--output", "null"]);
    try {
      await w.until(e => e.ev === "ready", 10000, "ready");
      w.send({ op: "capture.start", turn: "wt", gen: 1, endpointing: "vad", maxMs: 15000 });
      const term = await w.until(e => e.turn === "wt" && (e.ev === "stt.final" || e.ev === "stt.none"), 30000, "terminal event");
      assert.equal(term.ev, "stt.final", `expected a final for "${p.text}", got ${term.ev} ${term.reason || ""}`);
      for (const key of p.keys) assert.match(term.text, key, `final "${term.text}" lacks ${key}`);
      assert.ok(term.confidence > 0.5, `confidence ${term.confidence} for "${term.text}" is not above 0.5`);
      const termIndex = w.events.indexOf(term);
      const speechEnd = w.events.find(e => e.turn === "wt" && e.ev === "vad" && e.state === "speech_end");
      assert.ok(speechEnd, "VAD endpointed the utterance");
      latencies.push(term.mono - speechEnd.mono);
      const lateEvent = w.events.slice(termIndex + 1).find(e => e.turn === "wt" && e.ev === "stt.partial");
      assert.equal(lateEvent, undefined, "no stt.partial may follow the final");
      assert.equal(w.events.filter(e => e.turn === "wt" && (e.ev === "stt.final" || e.ev === "stt.none")).length, 1, "exactly one terminal event");
      console.log(`[whisper] "${term.text}" confidence ${term.confidence.toFixed(3)} decode after speech_end ${term.mono - speechEnd.mono} ms`);
    } finally {
      await w.close();
    }
  }
  assert.ok(latencies.every(ms => ms >= 0 && ms < 15000), `decode latencies ${latencies.join(",")} ms`);
});

test("whisper: silence never becomes a final (no VAD onset, so stt.none no_speech)", { skip }, async () => {
  requireWhisperRuntime();
  const w = session([...whisperArgs, "--input-silence", "--output", "null", "--fixture-pace", "2"]);
  try {
    await w.until(e => e.ev === "ready", 10000, "ready");
    w.send({ op: "capture.start", turn: "ws", gen: 1, endpointing: "manual", maxMs: 5000 });
    await w.until(e => e.turn === "ws" && e.ev === "capture.started", 5000, "capture.started");
    await sleep(1500);
    w.send({ op: "capture.end", turn: "ws", gen: 1 });
    const term = await w.until(e => e.turn === "ws" && (e.ev === "stt.final" || e.ev === "stt.none"), 15000, "terminal event");
    assert.equal(term.ev, "stt.none");
    assert.equal(term.reason, "no_speech");
    assert.equal(w.events.filter(e => e.turn === "ws" && e.ev === "stt.final").length, 0);
  } finally {
    await w.close();
  }
});

test("whisper: noise-only input never becomes a final with words", { skip }, async () => {
  requireWhisperRuntime();
  const w = session([...whisperArgs, "--input-noise", "--output", "null", "--fixture-pace", "2"]);
  try {
    await w.until(e => e.ev === "ready", 10000, "ready");
    w.send({ op: "capture.start", turn: "wn", gen: 1, endpointing: "vad", maxMs: 15000 });
    const term = await w.until(e => e.turn === "wn" && (e.ev === "stt.final" || e.ev === "stt.none"), 20000, "terminal event");
    assert.equal(term.ev, "stt.none", `noise produced a final: "${term.text}"`);
    assert.ok(["no_speech", "noise_only", "rejected"].includes(term.reason), `reason ${term.reason}`);
  } finally {
    await w.close();
  }
});

test("whisper: capture.abort that lands during the final decode never emits a final", { skip }, async () => {
  requireWhisperRuntime();
  const w = session([...whisperArgs, "--input-synth", PHRASES[0].text, "--fixture-pace", "2", "--output", "null"]);
  try {
    await w.until(e => e.ev === "ready", 10000, "ready");
    w.send({ op: "capture.start", turn: "wa", gen: 1, endpointing: "vad", maxMs: 15000 });
    await w.until(e => e.turn === "wa" && e.ev === "vad" && e.state === "speech_end", 20000, "speech_end");
    w.send({ op: "capture.abort", turn: "wa", gen: 1 });
    const term = await w.until(e => e.turn === "wa" && (e.ev === "stt.final" || e.ev === "stt.none"), 20000, "terminal event");
    assert.equal(term.ev, "stt.none", "an aborted decode must not produce a final");
    assert.equal(term.reason, "aborted");
    await sleep(2000);
    assert.equal(w.events.filter(e => e.turn === "wa" && e.ev === "stt.final").length, 0, "no final after the abort");
    assert.equal(w.events.filter(e => e.turn === "wa" && (e.ev === "stt.final" || e.ev === "stt.none")).length, 1, "exactly one terminal event");
  } finally {
    await w.close();
  }
});

test("whisper: a missing model falls back to Windows SAPI with an STT_UNAVAILABLE error, never silently", { skip }, async () => {
  requireWhisperRuntime();
  const w = session(["--stt", "whisper", "--whisper-dir", runtimeDir, "--whisper-model", join(runtimeDir, "models", "missing-model.bin"), "--input-silence", "--output", "null"]);
  try {
    const ready = await w.until(e => e.ev === "ready", 10000, "ready");
    assert.equal(ready.stt.engine, "Windows SAPI 5.4 System.Speech", "ready must report the SAPI fallback");
    const err = await w.until(e => e.ev === "error" && e.code === "STT_UNAVAILABLE", 5000, "STT_UNAVAILABLE");
    assert.match(err.message, /^whisper unavailable: model file is missing; using Windows SAPI$/);
    assert.ok(w.events.indexOf(err) > w.events.indexOf(ready), "the fallback error follows ready");
  } finally {
    await w.close();
  }
});
