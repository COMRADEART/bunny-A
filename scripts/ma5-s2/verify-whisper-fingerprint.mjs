// MA5-S2 Phase 4R1 (Task 4): independent verification of the reproducible whisper shim candidate. Build-only: no worker,
// no device. It checks every build input against its pin (source, the full header closure gcc actually reads against the
// pinned source tarball, the linked DLLs, the compiler, the flags), then builds the shim twice by two different paths
// (the build script's own function, and a literal gcc command written here) in two unrelated folders with different
// temp directories, and inspects the PE headers. It never writes native/voice/bunny-voice-worker.json: it writes the
// evidence and a re-pin proposal that stays PENDING until the owner approves it.
// Usage: node scripts/ma5-s2/verify-whisper-fingerprint.mjs [--expect <sha256>]
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { buildWhisperShim, SHIM_FLAGS } from "../build-voice-worker.mjs";
import { writeEvidence } from "../evidence-guard.mjs";

const root = process.cwd();
const argv = process.argv.slice(2);
const EXPECTED = argv.includes("--expect") ? argv[argv.indexOf("--expect") + 1] : "45f64172a5b41144f6057399f5a92776cf394c4991dce2d5b50346d3be8867e3";
const RUNTIME = "native/voice/vendor/runtime";
const SRC = "native/voice/vendor/whisper-src-v1.9.4";
const HEADERS = `${SRC}/whisper.cpp-1.9.4`;
const RECORD = "native/voice/bunny-voice-worker.json";
const sha = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");
const shaBuf = (b) => createHash("sha256").update(b).digest("hex");
const shaSource = (p) => createHash("sha256").update(readFileSync(p, "utf8").replace(/\r\n/g, "\n")).digest("hex");
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"], ...opts });
// Written out here, not imported: the second build must not depend on the build script's own flag list.
const LITERAL_FLAGS = ["-std=c11", "-O2", "-Wall", "-Wextra", "-Werror", "-shared", "-static-libgcc", "-Wl,--no-insert-timestamp", "-Wl,--disable-auto-image-base"];

const pin = JSON.parse(readFileSync(join(root, "native/voice/whisper-pin.json"), "utf8"));
const recordBefore = sha(join(root, RECORD));
const record = JSON.parse(readFileSync(join(root, RECORD), "utf8"));
const compiler = process.env.BUNNY_NATIVE_CC || "C:\\msys64\\ucrt64\\bin\\gcc.exe";
const out = { schema: "ma5-s2-p4r1-whisper-fingerprint/1", evidenceClass: "software only: builds and hashes, no worker, no device", expected: EXPECTED, checks: {} };
const check = (name, pass, detail = {}) => { out.checks[name] = { pass: !!pass, ...detail }; };

// 1. Inputs.
const source = join(root, "native/voice/whisper-shim.c");
const sourceSha = shaSource(source);
let sourceUnchangedVsMain = null;
try { run("git", ["diff", "--quiet", "origin/main", "--", "native/voice/whisper-shim.c"]); sourceUnchangedVsMain = true; } catch { sourceUnchangedVsMain = false; }
check("source", sourceSha === record.whisperShim?.sourceSha256 && sourceUnchangedVsMain, { sha256: sourceSha, matchesRecord: sourceSha === record.whisperShim?.sourceSha256, unchangedVsOriginMain: sourceUnchangedVsMain, lastCommit: run("git", ["log", "-1", "--format=%H", "--", "native/voice/whisper-shim.c"]).trim() });

const tarball = join(root, SRC, pin.source.file);
// The system tar, as stage-whisper.mjs uses (an MSYS tar reads "C:" as a remote host).
const sysTar = process.env.SystemRoot ? join(process.env.SystemRoot, "System32", "tar.exe") : null;
const TAR = sysTar && existsSync(sysTar) ? sysTar : "tar";
check("sourceTarball", sha(tarball) === pin.source.sha256, { sha256: sha(tarball), pinned: pin.source.sha256, release: pin.version, commit: pin.commit });

// The header closure gcc actually reads (gcc -MM), each compared byte-for-byte with the copy in the pinned tarball.
const includeFlags = ["include", "ggml/include"].flatMap((d) => ["-I", join(root, HEADERS, d)]);
const deps = run(compiler, ["-std=c11", "-MM", ...includeFlags, source]).replace(/\\\r?\n/g, " ").split(":").slice(1).join(":").trim().split(/\s+/).filter(Boolean).map((p) => resolve(p));
const headerRoot = resolve(root, HEADERS);
const headers = deps.filter((p) => p.startsWith(headerRoot)).map((p) => {
  const rel = relative(resolve(root, SRC), p).replace(/\\/g, "/");
  const fromTar = execFileSync(TAR, ["-xOzf", tarball, rel], { windowsHide: true, maxBuffer: 64 << 20 });
  return { header: rel, matchesTarball: shaBuf(fromTar) === sha(p) };
});
const outside = deps.filter((p) => p !== resolve(source) && !p.startsWith(headerRoot));
check("headerClosure", headers.length > 0 && headers.every((h) => h.matchesTarball) && outside.length === 0, { headers, nonPinnedProjectHeaders: outside.length, note: "gcc -MM lists project headers only; system headers come from the pinned compiler" });

const linked = Object.fromEntries(["whisper.dll", "ggml.dll", "ggml-base.dll"].map((n) => [n, sha(join(root, RUNTIME, n))]));
check("linkedDlls", Object.entries(linked).every(([n, h]) => pin.runtimeFiles[n] === h), { linked });

const compilerSha = sha(compiler);
check("compiler", compilerSha === record.whisperShim?.compiler?.sha256, { sha256: compilerSha, recorded: record.whisperShim?.compiler?.sha256 ?? null, version: run(compiler, ["--version"]).split(/\r?\n/)[0].trim() });
check("flags", JSON.stringify(SHIM_FLAGS) === JSON.stringify(LITERAL_FLAGS), { flags: SHIM_FLAGS, deterministicLink: ["-Wl,--no-insert-timestamp", "-Wl,--disable-auto-image-base"].every((f) => SHIM_FLAGS.includes(f)) });

/** COFF TimeDateStamp, ImageBase and DllCharacteristics of a PE32+ image, plus whether the build folder is embedded. */
function pe(file, buildDir) {
  const b = readFileSync(file);
  const lfanew = b.readUInt32LE(0x3c);
  const opt = lfanew + 24;
  const dirs = [buildDir, buildDir.replace(/\\/g, "/")].flatMap((d) => [Buffer.from(d, "latin1"), Buffer.from(d, "utf16le")]);
  return { timeDateStamp: b.readUInt32LE(lfanew + 8), magic: `0x${b.readUInt16LE(opt).toString(16)}`, imageBase: `0x${b.readBigUInt64LE(opt + 24).toString(16)}`, dllCharacteristics: `0x${b.readUInt16LE(opt + 70).toString(16)}`, embedsBuildPath: dirs.some((d) => b.includes(d)) };
}

// 2. Two builds by different paths.
const made = [];
try {
  // Build A: the build script's function, in a disposable root laid out like the repo.
  const a = mkdtempSync(join(tmpdir(), "bwa-"));
  made.push(a);
  mkdirSync(join(a, RUNTIME, "models"), { recursive: true });
  for (const n of Object.keys(pin.runtimeFiles)) copyFileSync(join(root, RUNTIME, n), join(a, RUNTIME, n));
  copyFileSync(join(root, RUNTIME, "models", pin.model.name), join(a, RUNTIME, "models", pin.model.name));
  for (const sub of ["include", "ggml/include"]) cpSync(join(root, HEADERS, sub), join(a, HEADERS, sub), { recursive: true });
  copyFileSync(source, join(a, "native/voice/whisper-shim.c"));
  const built = buildWhisperShim(a, null);
  if (built.status !== "built") throw new Error(`build A ${built.status}: ${built.reason}`);
  const fileA = join(a, RUNTIME, "bunny-whisper-shim.dll");

  // Build B: a literal gcc command, a deeper unrelated folder, a different working directory and temp directory.
  const b = mkdtempSync(join(tmpdir(), "bunny-p4r1-independent-shim-build-with-a-much-longer-path-"));
  made.push(b);
  const inB = join(b, "in", "nested", "inputs");
  const tmpB = join(b, "gcc-temp");
  mkdirSync(inB, { recursive: true });
  mkdirSync(tmpB);
  for (const n of Object.keys(linked)) copyFileSync(join(root, RUNTIME, n), join(inB, n));
  cpSync(join(root, HEADERS, "include"), join(inB, "h1"), { recursive: true });
  cpSync(join(root, HEADERS, "ggml/include"), join(inB, "h2"), { recursive: true });
  copyFileSync(source, join(inB, "whisper-shim.c"));
  const fileB = join(b, "bunny-whisper-shim.dll"); // the export directory records the file name, so it must match
  run(compiler, [...LITERAL_FLAGS, "-I", join(inB, "h1"), "-I", join(inB, "h2"), "-o", fileB, join(inB, "whisper-shim.c"), ...Object.keys(linked).map((n) => join(inB, n))], { cwd: inB, env: { ...process.env, TEMP: tmpB, TMP: tmpB } });

  const builds = [{ path: "build-script function, short temp root", sha256: sha(fileA), pe: pe(fileA, a) }, { path: "literal gcc, long nested root, separate cwd and TEMP", sha256: sha(fileB), pe: pe(fileB, b) }];
  out.builds = builds;
  check("reproducible", builds[0].sha256 === builds[1].sha256, { hashes: builds.map((x) => x.sha256) });
  check("matchesExpectedCandidate", builds.every((x) => x.sha256 === EXPECTED), { expected: EXPECTED });
  check("peDeterminism", builds.every((x) => x.pe.timeDateStamp === 0 && !x.pe.embedsBuildPath && x.pe.magic === "0x20b") && builds[0].pe.imageBase === builds[1].pe.imageBase && (Number.parseInt(builds[0].pe.dllCharacteristics, 16) & 0x40) !== 0,
    { note: "TimeDateStamp 0, identical image base, no build folder embedded, DYNAMIC_BASE (ASLR) kept" });
  check("buildRecordSchema", built.record.binarySha256 === builds[0].sha256 && JSON.stringify(built.record.linkedAgainst) === JSON.stringify(linked), {});
  out.proposedWhisperShim = { ...built.record, compiler: { ...built.record.compiler, path: record.whisperShim?.compiler?.path ?? built.record.compiler.path } };
} finally {
  for (const d of made) rmSync(d, { recursive: true, force: true });
}

// 3. The approved record is untouched; the proposal stays pending.
const recordAfter = sha(join(root, RECORD));
check("approvedRecordUntouched", recordBefore === recordAfter, { sha256: recordAfter });
out.allPass = Object.values(out.checks).every((c) => c.pass);
out.currentPin = record.whisperShim?.binarySha256 ?? null;
out.proposal = {
  status: "PENDING_OWNER_APPROVAL",
  change: `whisperShim.binarySha256 ${out.currentPin} -> ${out.proposedWhisperShim?.binarySha256 ?? "(not built)"}; every other whisperShim field unchanged`,
  adoptWith: "node scripts/build-voice-worker.mjs --repin-whisper-shim  (must print build:whisper-shim built; then check the record holds the proposed hash, commit native/voice/bunny-voice-worker.json alone, and rerun the whisper selection and integrity tests)",
};
writeEvidence("docs/ma5-s2/evidence/voice/whisper-fingerprint-verification.json", out, []);
console.log(JSON.stringify({ allPass: out.allPass, failed: Object.entries(out.checks).filter(([, c]) => !c.pass).map(([k]) => k), candidate: out.proposedWhisperShim?.binarySha256, proposal: out.proposal.status }));
if (!out.allPass) process.exitCode = 1;
