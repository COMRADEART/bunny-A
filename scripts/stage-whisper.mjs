// Stages the pinned whisper.cpp runtime for the native voice worker.
//
// This script NEVER downloads. It verifies artifacts that the operator has already fetched (pinned in
// native/voice/whisper-pin.json) and copies the verified runtime into native/voice/vendor/runtime/:
//   whisper.dll, ggml.dll, ggml-base.dll, every ggml-cpu-*.dll from the release, models/<model>.
// The shim (bunny-whisper-shim.dll) is built afterwards by scripts/build-voice-worker.mjs.
//
// Every verification step fails closed. Downloaded archives are untrusted data: they are extracted into a fresh
// scratch directory with the system tar (no interpreter ever runs from inside vendor/).
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const defaultRoot = resolve(here, "..");

export class StageError extends Error {}

const sha256 = p => createHash("sha256").update(readFileSync(p)).digest("hex");

function tarExe() {
  const sys = process.env.SystemRoot ? join(process.env.SystemRoot, "System32", "tar.exe") : null;
  return sys && existsSync(sys) ? sys : "tar";
}

function extract(archive, dest) {
  mkdirSync(dest, { recursive: true });
  execFileSync(tarExe(), ["-xf", archive, "-C", dest], { windowsHide: true, stdio: "pipe" });
}

function requireFile(path, what, url) {
  if (!existsSync(path)) {
    throw new StageError(
      `${what} is missing: ${path}\n` +
      `This script never downloads. Fetch it yourself from ${url}, place it at that path, then re-run ` +
      "node scripts/stage-whisper.mjs.",
    );
  }
}

function checkSha(path, expected, what) {
  const actual = sha256(path);
  if (actual !== expected) throw new StageError(`${what} sha256 mismatch: expected ${expected}, got ${actual}`);
  return actual;
}

export function stageWhisper(root = defaultRoot) {
  if (process.platform !== "win32") {
    console.log("stage-whisper skipped: the whisper runtime is Windows-only (non-win32 platform).");
    return { applicable: false };
  }
  const pinPath = join(root, "native/voice/whisper-pin.json");
  const pin = JSON.parse(readFileSync(pinPath, "utf8"));
  if (pin.schema !== "bunny-whisper-pin/1") throw new StageError(`unexpected pin schema: ${pin.schema}`);

  const vendor = join(root, "native/voice/vendor");
  const zipPath = join(vendor, "whisper-bin-b5130", pin.release.asset);
  const srcPath = join(vendor, "whisper-src-v1.9.4", pin.source.file);
  const modelPath = join(vendor, "models", pin.model.name);
  requireFile(zipPath, "whisper.cpp release archive", pin.release.url);
  requireFile(srcPath, "whisper.cpp source tarball", pin.source.url);
  requireFile(modelPath, "whisper model", pin.model.url);

  checkSha(zipPath, pin.release.sha256, "release archive");
  checkSha(srcPath, pin.source.sha256, "source tarball");
  const modelSize = readFileSync(modelPath).length;
  if (modelSize !== pin.model.size) throw new StageError(`model size mismatch: expected ${pin.model.size}, got ${modelSize}`);
  checkSha(modelPath, pin.model.sha256, "model");

  const work = mkdtempSync(join(vendor, ".stage-"));
  try {
    // Release runtime: extracted from the verified zip, every pinned DLL checked against its pin.
    const zipDir = join(work, "zip");
    extract(zipPath, zipDir);
    const runtimeFiles = [];
    for (const [name, expected] of Object.entries(pin.runtimeFiles)) {
      const from = join(zipDir, "Release", name);
      if (!existsSync(from)) throw new StageError(`release archive has no ${name} (pinned runtime file)`);
      runtimeFiles.push({ name, from, sha256: checkSha(from, expected, `runtime ${name}`) });
    }

    // Headers used by the shim: each vendored header must equal the one in the verified source tarball.
    const srcDir = join(work, "src");
    extract(srcPath, srcDir);
    for (const rel of pin.source.headers) {
      const fromTar = join(srcDir, rel);
      const vendored = join(vendor, "whisper-src-v1.9.4", rel);
      requireFile(vendored, "vendored whisper header", pin.source.url);
      if (!existsSync(fromTar)) throw new StageError(`source tarball has no ${rel}`);
      if (sha256(fromTar) !== sha256(vendored)) throw new StageError(`vendored header differs from the pinned source: ${rel}`);
    }

    // Stage: a fresh runtime directory holding exactly the pinned files plus the model.
    const runtime = join(vendor, "runtime");
    rmSync(runtime, { recursive: true, force: true });
    mkdirSync(join(runtime, "models"), { recursive: true });
    for (const f of runtimeFiles) copyFileSync(f.from, join(runtime, f.name));
    const stagedModel = join(runtime, "models", pin.model.name);
    copyFileSync(modelPath, stagedModel);
    checkSha(stagedModel, pin.model.sha256, "staged model");

    return {
      applicable: true,
      runtime,
      model: { path: stagedModel, name: pin.model.name, sha256: pin.model.sha256, size: modelSize },
      release: { asset: pin.release.asset, tag: pin.release.tag, sha256: pin.release.sha256 },
      source: { file: pin.source.file, sha256: pin.source.sha256 },
      runtimeFiles: runtimeFiles.map(f => ({ name: f.name, sha256: f.sha256 })),
      shimStaged: existsSync(join(runtime, "bunny-whisper-shim.dll")),
    };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    console.log(JSON.stringify(stageWhisper()));
  } catch (e) {
    console.error(`stage-whisper: ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
  }
}
