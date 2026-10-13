import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { selectSpeechEngine, whisperFallbackMessage, whisperThreads } from "./voice-worker.server.ts";

const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

/** A fake whisper layout: a pin, a runtime folder, a shim recorded in the build record, and a small fake model. */
function fakeWhisperRoot(options: { skipRuntime?: boolean } = {}) {
  const root = mkdtempSync(join(tmpdir(), "bunny-whisper-"));
  const voice = join(root, "native", "voice");
  const runtime = join(voice, "vendor", "runtime");
  mkdirSync(voice, { recursive: true });
  const files: Record<string, Buffer> = {
    "whisper.dll": Buffer.from("whisper dll bytes"),
    "ggml.dll": Buffer.from("ggml dll bytes"),
    "ggml-base.dll": Buffer.from("ggml base bytes"),
    "ggml-cpu-x64.dll": Buffer.from("cpu variant bytes"),
  };
  const shim = Buffer.from("bunny shim bytes");
  const model = Buffer.from("fake model weights, long enough to make the size check meaningful");
  if (!options.skipRuntime) {
    mkdirSync(join(runtime, "models"), { recursive: true });
    for (const [name, bytes] of Object.entries(files)) writeFileSync(join(runtime, name), bytes);
    writeFileSync(join(runtime, "bunny-whisper-shim.dll"), shim);
    writeFileSync(join(runtime, "models", "ggml-base.en.bin"), model);
  }
  const pin = {
    schema: "bunny-whisper-pin/1",
    version: "v1.9.4",
    commit: "927cfce34f31707e17f2bff35c349632fb9e2c3a",
    model: { name: "ggml-base.en.bin", sha256: sha(model), size: model.length },
    runtimeFiles: Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, sha(bytes)])),
  };
  writeFileSync(join(voice, "whisper-pin.json"), JSON.stringify(pin));
  writeFileSync(join(voice, "bunny-voice-worker.json"), JSON.stringify({ schema: "bunny-voice-worker-build/1", whisperShim: { binarySha256: sha(shim) } }));
  // The hashes every release manifest would have to list for this layout.
  const hashes: Record<string, string> = {
    "native/voice/whisper-pin.json": sha(readFileSync(join(voice, "whisper-pin.json"))),
    ...Object.fromEntries(Object.entries(files).map(([name, bytes]) => [`native/voice/vendor/runtime/${name}`, sha(bytes)])),
    "native/voice/vendor/runtime/bunny-whisper-shim.dll": sha(shim),
    "native/voice/vendor/runtime/models/ggml-base.en.bin": sha(model),
  };
  return { root, runtime, files, shim, model, pin, hashes };
}

function writeManifest(root: string, entries: Record<string, string>) {
  writeFileSync(join(root, "release-manifest.json"), JSON.stringify({ files: Object.entries(entries).map(([path, sha256]) => ({ path, sha256 })) }));
}

test("T10-whisper a fully verified pinned runtime selects whisper with absolute paths and a bounded thread count", () => {
  const fixture = fakeWhisperRoot();
  try {
    const selection = selectSpeechEngine(fixture.root, { cpuCount: 8 });
    assert.equal(selection.engine, "whisper");
    assert.deepEqual(selection.engine === "whisper" ? selection.args : [], [
      "--stt",
      "whisper",
      "--whisper-dir",
      resolve(fixture.runtime),
      "--whisper-model",
      resolve(join(fixture.runtime, "models", "ggml-base.en.bin")),
      "--whisper-threads",
      "4",
    ]);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("T10-whisper one changed byte in a runtime DLL selects SAPI with a reason and no whisper flags", () => {
  const fixture = fakeWhisperRoot();
  try {
    const dll = join(fixture.runtime, "whisper.dll");
    const bytes = readFileSync(dll);
    bytes[0] ^= 0x01;
    writeFileSync(dll, bytes);
    const selection = selectSpeechEngine(fixture.root);
    assert.deepEqual(selection, { engine: "sapi", reason: "whisper.dll differs from the pin" });
    assert.equal(whisperFallbackMessage("whisper.dll differs from the pin"), "whisper unavailable: whisper.dll differs from the pin; using Windows SAPI");
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("T10-whisper a changed shim is refused against the build record", () => {
  const fixture = fakeWhisperRoot();
  try {
    writeFileSync(join(fixture.runtime, "bunny-whisper-shim.dll"), Buffer.from("tampered shim"));
    assert.deepEqual(selectSpeechEngine(fixture.root), { engine: "sapi", reason: "bunny-whisper-shim.dll differs from the pin" });
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("T10-whisper a same-size model change is refused against the pin even after a cached pass", () => {
  const fixture = fakeWhisperRoot();
  try {
    assert.equal(selectSpeechEngine(fixture.root).engine, "whisper", "the first pass caches the model hash");
    const model = join(fixture.runtime, "models", "ggml-base.en.bin");
    const bytes = readFileSync(model);
    bytes[bytes.length - 1] ^= 0x20;
    writeFileSync(model, bytes);
    // A new mtime is what makes the Host re-hash the cached model.
    const later = new Date(Date.now() + 60_000);
    utimesSync(model, later, later);
    assert.deepEqual(selectSpeechEngine(fixture.root), { engine: "sapi", reason: "model differs from the pin" });
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("T10-whisper a release layout refuses whisper when the manifest omits a whisper file", () => {
  const fixture = fakeWhisperRoot();
  try {
    const listed = { ...fixture.hashes };
    delete listed["native/voice/vendor/runtime/whisper.dll"];
    writeManifest(fixture.root, listed);
    assert.deepEqual(selectSpeechEngine(fixture.root), { engine: "sapi", reason: "release manifest does not list whisper.dll with this hash" });
    writeManifest(fixture.root, fixture.hashes);
    assert.equal(selectSpeechEngine(fixture.root).engine, "whisper", "every whisper file listed at its hash is accepted");
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("T10-whisper a release manifest that lists a whisper file with a different hash is refused", () => {
  const fixture = fakeWhisperRoot();
  try {
    writeManifest(fixture.root, { ...fixture.hashes, "native/voice/vendor/runtime/ggml.dll": "0".repeat(64) });
    assert.equal(selectSpeechEngine(fixture.root).engine, "sapi");
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("T10-whisper an unlisted file in the runtime folder is refused: nothing loads a DLL by name", () => {
  const fixture = fakeWhisperRoot();
  try {
    writeFileSync(join(fixture.runtime, "SDL2.dll"), Buffer.from("extra"));
    assert.deepEqual(selectSpeechEngine(fixture.root), { engine: "sapi", reason: "unlisted runtime file SDL2.dll" });
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("T10-whisper a pinned source with no staged runtime selects SAPI with a reason; a source without a pin selects SAPI silently", () => {
  const fixture = fakeWhisperRoot({ skipRuntime: true });
  try {
    assert.deepEqual(selectSpeechEngine(fixture.root), { engine: "sapi", reason: "runtime not staged" });
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
  const bare = mkdtempSync(join(tmpdir(), "bunny-whisper-none-"));
  try {
    assert.deepEqual(selectSpeechEngine(bare), { engine: "sapi", reason: null });
  } finally {
    rmSync(bare, { recursive: true, force: true });
  }
});

test("T10-whisper a missing pinned file is named in the reason", () => {
  const fixture = fakeWhisperRoot();
  try {
    rmSync(join(fixture.runtime, "ggml-base.dll"));
    assert.deepEqual(selectSpeechEngine(fixture.root), { engine: "sapi", reason: "ggml-base.dll missing" });
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("T10-whisper the thread count is half the processors, clamped to 2..4", () => {
  assert.equal(whisperThreads(1), 2);
  assert.equal(whisperThreads(4), 2);
  assert.equal(whisperThreads(8), 4);
  assert.equal(whisperThreads(64), 4);
});
