import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync, readdirSync, rmSync, copyFileSync } from "node:fs";
import { dirname, resolve, join, basename } from "node:path";
import { fileURLToPath } from "node:url";

const frameworkRoot = "C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319";
const speechRoot = "C:\\Windows\\Microsoft.NET\\assembly\\GAC_MSIL\\System.Speech";

const sha = p => createHash("sha256").update(readFileSync(p)).digest("hex");
const shaSource = p => createHash("sha256").update(readFileSync(p, "utf8").replace(/\r\n/g, "\n")).digest("hex");

function resolveSpeech() {
  if (!existsSync(speechRoot)) throw new Error("System.Speech is not installed (GAC_MSIL\\System.Speech missing). The voice worker needs the Windows Speech platform.");
  const dir = readdirSync(speechRoot).filter(d => d.startsWith("v4.0_")).sort()[0];
  if (!dir) throw new Error("System.Speech v4.0 assembly directory not found under GAC_MSIL.");
  const dll = join(speechRoot, dir, "System.Speech.dll");
  if (!existsSync(dll)) throw new Error(`System.Speech.dll not found at ${dll}.`);
  return dll;
}

// MA5-S2 P4-1: ld otherwise stamps the link time and derives the image base from the full output path (a random temp
// folder), so no two builds matched. With these flags the shim is byte-identical for the same compiler and inputs.
// ASLR is kept (DYNAMIC_BASE and HIGH_ENTROPY_VA stay set); only the preferred base is fixed.
export const SHIM_FLAGS = ["-std=c11", "-O2", "-Wall", "-Wextra", "-Werror", "-shared", "-static-libgcc", "-Wl,--no-insert-timestamp", "-Wl,--disable-auto-image-base"];

// The whisper shim is built only when the pinned runtime is staged (scripts/stage-whisper.mjs). It is linked against
// the staged whisper.dll, ggml.dll and ggml-base.dll, so the build record pins those hashes too.
// A recorded shim pin is never replaced silently: a build that differs from it is not installed and the record keeps the
// old pin (the Host then refuses whisper and says why) unless the caller passes { repin: true } after owner approval.
export function buildWhisperShim(root, prior, { repin = false } = {}) {
  const runtime = join(root, "native/voice/vendor/runtime");
  const whisperDll = join(runtime, "whisper.dll");
  const ggmlDll = join(runtime, "ggml.dll");
  const ggmlBaseDll = join(runtime, "ggml-base.dll");
  const model = join(runtime, "models", "ggml-base.en.bin");
  const missing = [whisperDll, ggmlDll, ggmlBaseDll, model].filter(p => !existsSync(p));
  if (missing.length > 0) {
    return { status: "skipped", reason: `whisper runtime not staged (missing ${missing.map(p => basename(p)).join(", ")}); run node scripts/stage-whisper.mjs` };
  }
  const headerRoot = join(root, "native/voice/vendor/whisper-src-v1.9.4/whisper.cpp-1.9.4");
  const includes = [join(headerRoot, "include"), join(headerRoot, "ggml/include")];
  if (!includes.every(existsSync)) return { status: "skipped", reason: "pinned whisper.cpp headers are not vendored; run node scripts/stage-whisper.mjs" };
  const compiler = process.env.BUNNY_NATIVE_CC || "C:\\msys64\\ucrt64\\bin\\gcc.exe";
  if (!existsSync(compiler)) return { status: "skipped", reason: `gcc not found at ${compiler} (set BUNNY_NATIVE_CC)` };

  const source = resolve(root, "native/voice/whisper-shim.c");
  const sourceSha256 = shaSource(source);
  const output = join(runtime, "bunny-whisper-shim.dll");
  const linkedAgainst = { "whisper.dll": sha(whisperDll), "ggml.dll": sha(ggmlDll), "ggml-base.dll": sha(ggmlBaseDll) };
  if (prior && prior.sourceSha256 === sourceSha256 && existsSync(output) && prior.binarySha256 === sha(output) &&
      JSON.stringify(prior.linkedAgainst) === JSON.stringify(linkedAgainst)) {
    return { status: "up-to-date", record: prior };
  }

  const temporary = mkdtempSync(join(runtime, ".shim-build-"));
  try {
    const compiled = join(temporary, "bunny-whisper-shim.dll");
    const includeFlags = includes.flatMap(d => ["-I", d]);
    execFileSync(compiler, [...SHIM_FLAGS, ...includeFlags, "-o", compiled, source, whisperDll, ggmlDll, ggmlBaseDll], { windowsHide: true, stdio: "pipe" });
    const binarySha256 = sha(compiled);
    if (prior?.binarySha256 && prior.binarySha256 !== binarySha256 && !repin) {
      return { status: "refused", built: binarySha256, reason: `built shim ${binarySha256} differs from the recorded pin ${prior.binarySha256}; not installed. After owner approval: node scripts/build-voice-worker.mjs --repin-whisper-shim` };
    }
    if (!existsSync(output) || sha(output) !== binarySha256) copyFileSync(compiled, output);
    const version = execFileSync(compiler, ["--version"], { encoding: "utf8", windowsHide: true }).split(/\r?\n/)[0].trim();
    return {
      status: "built",
      record: {
        source: "native/voice/whisper-shim.c",
        sourceSha256,
        binarySha256,
        linkedAgainst,
        flags: SHIM_FLAGS,
        compiler: { path: compiler, sha256: sha(compiler), version },
        whisperVersion: "whisper.cpp v1.9.4 (927cfce)",
      },
    };
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

export function buildVoiceWorker(root = resolve(dirname(fileURLToPath(import.meta.url)), ".."), output = resolve(root, "native/voice/bunny-voice-worker.exe"), { repinWhisperShim = false } = {}) {
  if (process.platform !== "win32") {
    console.log("build:voice skipped: the voice worker is Windows-only (non-win32 platform).");
    return { applicable: false };
  }
  if (process.arch !== "x64") throw new Error("The voice worker build targets windows-x64 only; other architectures fail closed.");
  const compiler = join(frameworkRoot, "csc.exe");
  if (!existsSync(compiler)) throw new Error(`csc.exe (.NET Framework 4.x compiler) not found at ${compiler}. Install the .NET Framework developer components.`);
  const speechDll = resolveSpeech();
  const source = resolve(root, "native/voice/BunnyVoiceWorker.cs");
  if (!existsSync(source)) throw new Error(`Voice worker source missing: ${source}`);
  const sourceSha256 = shaSource(source);
  const recordPath = output.replace(/\.exe$/, ".json");

  let prior = null;
  if (existsSync(recordPath)) {
    try { prior = JSON.parse(readFileSync(recordPath, "utf8")); } catch { prior = null; }
  }

  // Skip recompiling when the recorded source and the existing binary still match.
  const exeCurrent = Boolean(prior && existsSync(output) && prior.sourceSha256 === sourceSha256 && prior.binarySha256 === sha(output));
  let record;
  if (exeCurrent) {
    console.log("build:voice up to date");
    record = { ...prior };
  } else {
    mkdirSync(dirname(output), { recursive: true });
    const flags = ["-nologo", "-platform:x64", "-optimize+", "-warn:4", "-target:exe", `-reference:${speechDll}`];
    const temporary = mkdtempSync(join(dirname(output), ".bunny-voice-build-"));
    let binarySha256;
    let version;
    try {
      const compiled = join(temporary, basename(output));
      version = execFileSync(compiler, ["-?"], { encoding: "utf8", windowsHide: true }).split(/\r?\n/).find(line => line.includes("version")) ?? "unknown";
      execFileSync(compiler, [...flags, `-out:${compiled}`, source], { windowsHide: true, stdio: "pipe" });
      binarySha256 = sha(compiled);
      // A loaded worker exe cannot be overwritten. Identical builds need no write.
      if (!existsSync(output) || sha(output) !== binarySha256) writeFileSync(output, readFileSync(compiled));
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
    record = {
      schema: "bunny-voice-worker-build/1",
      protocol: "bunny-voice/1",
      source: "native/voice/BunnyVoiceWorker.cs",
      sourceSha256,
      binary: "native/voice/bunny-voice-worker.exe",
      binarySha256,
      compiler: { path: compiler, sha256: sha(compiler), version: version.trim() },
      systemSpeech: { path: speechDll, sha256: sha(speechDll) },
      architecture: "windows-x64",
      builtAt: new Date().toISOString(),
    };
  }

  // Whisper shim: built when the runtime is staged, otherwise the record carries no whisperShim and the reason is printed.
  const shim = buildWhisperShim(resolve(root), prior && prior.whisperShim, { repin: repinWhisperShim });
  if (shim.status === "skipped" || shim.status === "refused") {
    console.log(`build:whisper-shim ${shim.status}: ${shim.reason}`);
    if (prior?.whisperShim) record.whisperShim = prior.whisperShim;
  } else if (shim.status === "up-to-date") {
    console.log("build:whisper-shim up to date");
    record.whisperShim = shim.record;
  } else {
    console.log("build:whisper-shim built");
    record.whisperShim = shim.record;
  }

  const recordText = JSON.stringify(record, null, 2) + "\n";
  if (!prior || JSON.stringify(prior) !== JSON.stringify(record)) writeFileSync(recordPath, recordText);
  return record;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const positional = args.filter(a => a !== "--repin-whisper-shim");
  console.log(JSON.stringify(buildVoiceWorker(positional[0], positional[1], { repinWhisperShim: args.includes("--repin-whisper-shim") })));
}
