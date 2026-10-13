// M-A-3 T10 whisper: a release that carries the whisper pin must carry the pinned runtime, the shim and the model.
import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importClosure } from "./bunny-release.mjs";

function fakeRelease(options) {
  const root = mkdtempSync(join(tmpdir(), "bunny-whisper-release-"));
  for (const entry of ["Bunny-Host.mjs", "scripts/bunny-tunnel.mjs"]) {
    mkdirSync(join(root, entry, ".."), { recursive: true });
    writeFileSync(join(root, entry), "export {};\n");
  }
  const pin = {
    schema: "bunny-whisper-pin/1",
    runtimeFiles: { "whisper.dll": "a".repeat(64), "ggml.dll": "b".repeat(64) },
    model: { name: "ggml-base.en.bin", sha256: "c".repeat(64), size: 3 },
  };
  mkdirSync(join(root, "native/voice/vendor/runtime/models"), { recursive: true });
  writeFileSync(join(root, "native/voice/whisper-pin.json"), JSON.stringify(pin));
  if (options.runtime) {
    for (const name of ["whisper.dll", "ggml.dll", "bunny-whisper-shim.dll"]) writeFileSync(join(root, "native/voice/vendor/runtime", name), "x");
    writeFileSync(join(root, "native/voice/vendor/runtime/models/ggml-base.en.bin"), "abc");
  }
  return root;
}

test("T10-whisper a release with the pin is closed only when every pinned runtime file, the shim and the model are present", () => {
  const incomplete = fakeRelease({ runtime: false });
  try {
    const result = importClosure(incomplete);
    assert.equal(result.ok, false);
    for (const path of [
      "native/voice/vendor/runtime/whisper.dll",
      "native/voice/vendor/runtime/ggml.dll",
      "native/voice/vendor/runtime/bunny-whisper-shim.dll",
      "native/voice/vendor/runtime/models/ggml-base.en.bin",
    ]) {
      assert.ok(result.missing.includes(path), `missing list names ${path}`);
    }
  } finally {
    rmSync(incomplete, { recursive: true, force: true });
  }
  const complete = fakeRelease({ runtime: true });
  try {
    const result = importClosure(complete);
    assert.equal(
      result.missing.filter((path) => path.startsWith("native/voice/vendor/")).length,
      0,
      "no whisper file is missing from a complete release",
    );
    assert.ok(result.files.includes("native/voice/vendor/runtime/models/ggml-base.en.bin"));
  } finally {
    rmSync(complete, { recursive: true, force: true });
  }
});
