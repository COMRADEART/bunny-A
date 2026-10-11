import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync, readdirSync, rmSync } from "node:fs";
import { dirname, resolve, join, basename } from "node:path";
import { fileURLToPath } from "node:url";

const frameworkRoot = "C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319";
const speechRoot = "C:\\Windows\\Microsoft.NET\\assembly\\GAC_MSIL\\System.Speech";

const sha = p => createHash("sha256").update(readFileSync(p)).digest("hex");

function resolveSpeech() {
  if (!existsSync(speechRoot)) throw new Error("System.Speech is not installed (GAC_MSIL\\System.Speech missing). The voice worker needs the Windows Speech platform.");
  const dir = readdirSync(speechRoot).filter(d => d.startsWith("v4.0_")).sort()[0];
  if (!dir) throw new Error("System.Speech v4.0 assembly directory not found under GAC_MSIL.");
  const dll = join(speechRoot, dir, "System.Speech.dll");
  if (!existsSync(dll)) throw new Error(`System.Speech.dll not found at ${dll}.`);
  return dll;
}

export function buildVoiceWorker(root = resolve(dirname(fileURLToPath(import.meta.url)), ".."), output = resolve(root, "native/voice/bunny-voice-worker.exe")) {
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
  const sourceSha256 = sha(source);
  const recordPath = output.replace(/\.exe$/, ".json");

  // Skip recompiling when the recorded source and the existing binary still match.
  if (existsSync(recordPath) && existsSync(output)) {
    try {
      const prior = JSON.parse(readFileSync(recordPath, "utf8"));
      if (prior.sourceSha256 === sourceSha256 && prior.binarySha256 === sha(output)) {
        console.log("build:voice up to date");
        return prior;
      }
    } catch { /* rebuild */ }
  }

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

  const record = {
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
  writeFileSync(recordPath, JSON.stringify(record, null, 2) + "\n");
  return record;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(buildVoiceWorker(process.argv[2], process.argv[3])));
}
