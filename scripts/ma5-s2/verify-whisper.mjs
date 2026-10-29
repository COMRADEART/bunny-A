// MA5-S2 Phase 4 (P4-1): whisper runtime verification. Read-only against this checkout: the repo's runtime, pin and
// build record are hashed, never written. The reproducible shim candidate is built in two disposable roots, and real
// engine selection plus real recognition run there on SAPI-synthesized fixture speech (--input-synth, --output null).
// No microphone or speaker is opened. The candidate is NOT adopted: re-pinning is an owner decision.
// Usage: node --experimental-strip-types scripts/ma5-s2/verify-whisper.mjs
import { createHash } from "node:crypto";
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildWhisperShim, SHIM_FLAGS } from "../build-voice-worker.mjs";
import { launchVoiceWorker, selectSpeechEngine } from "../../src/lib/bunny-host/voice/voice-worker.server.ts";
import { writeEvidence } from "../evidence-guard.mjs";

const root = process.cwd();
const RUNTIME = "native/voice/vendor/runtime";
const HEADERS = "native/voice/vendor/whisper-src-v1.9.4/whisper.cpp-1.9.4";
const sha = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Scripted, nonpersonal phrases (the same family the Phase 4 attended script uses).
const PHRASES = ["what are my agents working on", "what failed", "pause the current mission", "tell me when this task is completed", "goodbye bunny"];
const words = (s) => s.toLowerCase().replace(/[^a-z' ]/g, " ").split(/\s+/).filter(Boolean);
/** Word error rate by edit distance (reference = scripted phrase). */
function wer(ref, hyp) {
  const r = words(ref), h = words(hyp ?? "");
  const d = Array.from({ length: r.length + 1 }, (_, i) => [i, ...Array(h.length).fill(0)]);
  for (let j = 1; j <= h.length; j++) d[0][j] = j;
  for (let i = 1; i <= r.length; i++) for (let j = 1; j <= h.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (r[i - 1] === h[j - 1] ? 0 : 1));
  return d[r.length][h.length] / r.length;
}

const pin = JSON.parse(readFileSync(join(root, "native/voice/whisper-pin.json"), "utf8"));
const record = JSON.parse(readFileSync(join(root, "native/voice/bunny-voice-worker.json"), "utf8"));
const out = { schema: "ma5-s2-p4-whisper/1", evidenceClass: "software only: synthesized fixture speech, no microphone, no speaker", pin: { version: pin.version, commit: pin.commit } };

// 1. The repo as it stands, read-only.
const runtimeFiles = Object.entries(pin.runtimeFiles).map(([name, expected]) => ({ name, matchesPin: sha(join(root, RUNTIME, name)) === expected }));
const installedShim = existsSync(join(root, RUNTIME, "bunny-whisper-shim.dll")) ? sha(join(root, RUNTIME, "bunny-whisper-shim.dll")) : null;
out.checkout = {
  runtimeFiles,
  allRuntimeFilesMatchPin: runtimeFiles.every((f) => f.matchesPin),
  modelMatchesPin: sha(join(root, RUNTIME, "models", pin.model.name)) === pin.model.sha256,
  recordedShim: record.whisperShim?.binarySha256 ?? null,
  installedShim,
  selection: selectSpeechEngine(root),
};

// 2. Two disposable roots, each a fresh build of the shim from the pinned inputs.
const roots = [];
function makeRoot(label) {
  const r = mkdtempSync(join(tmpdir(), `bunny-p4-whisper-${label}-`));
  roots.push(r);
  mkdirSync(join(r, RUNTIME, "models"), { recursive: true });
  for (const name of Object.keys(pin.runtimeFiles)) copyFileSync(join(root, RUNTIME, name), join(r, RUNTIME, name));
  copyFileSync(join(root, RUNTIME, "models", pin.model.name), join(r, RUNTIME, "models", pin.model.name));
  for (const sub of ["include", "ggml/include"]) cpSync(join(root, HEADERS, sub), join(r, HEADERS, sub), { recursive: true });
  for (const f of ["native/voice/whisper-shim.c", "native/voice/whisper-pin.json", "native/voice/BunnyVoiceWorker.cs", "native/voice/bunny-voice-worker.exe"]) copyFileSync(join(root, f), join(r, f));
  const built = buildWhisperShim(r, null);
  if (built.status !== "built") throw new Error(`shim build ${built.status}: ${built.reason}`);
  // The vendored headers are build inputs only; selection allows nothing unlisted in the runtime folder.
  rmSync(join(r, "native/voice/vendor/whisper-src-v1.9.4"), { recursive: true, force: true });
  return { root: r, shim: built.record };
}

const sessions = [];
try {
  const a = makeRoot("a");
  const b = makeRoot("b");
  out.candidate = {
    binarySha256: a.shim.binarySha256,
    reproducible: a.shim.binarySha256 === b.shim.binarySha256,
    builds: [a.shim.binarySha256, b.shim.binarySha256],
    flags: SHIM_FLAGS,
    sourceSha256: a.shim.sourceSha256,
    linkedAgainst: a.shim.linkedAgainst,
    linkedAgainstMatchesPin: Object.entries(a.shim.linkedAgainst).every(([n, h]) => pin.runtimeFiles[n] === h),
    compiler: { sha256: a.shim.compiler.sha256, version: a.shim.compiler.version, matchesRecordedCompiler: a.shim.compiler.sha256 === record.whisperShim?.compiler?.sha256 },
    adopted: false,
  };

  // 3. Selection in the disposable root: refused against the committed pin, selected against the candidate record.
  const write = (r, shim) => writeFileSync(join(r, "native/voice/bunny-voice-worker.json"), JSON.stringify({ ...record, whisperShim: shim }, null, 2));
  write(a.root, record.whisperShim);
  out.selectionWithCommittedPin = selectSpeechEngine(a.root);
  write(a.root, a.shim);
  const selected = selectSpeechEngine(a.root);
  out.selectionWithCandidate = { engine: selected.engine, reason: selected.reason ?? null };
  if (selected.engine !== "whisper") throw new Error(`candidate not selected: ${selected.reason}`);

  // 4. Real worker launched by the real launcher (it re-runs selection and the exe integrity check itself).
  const runs = [];
  for (const phrase of PHRASES) {
    const dataDirectory = mkdtempSync(join(tmpdir(), "bunny-p4-whisper-data-"));
    roots.push(dataDirectory);
    const worker = await launchVoiceWorker({ root: a.root, dataDirectory, extraArgs: ["--input-synth", phrase, "--output", "null"] });
    sessions.push(worker);
    const events = [];
    worker.onEvent((e) => events.push(e));
    const wait = async (p, ms = 30_000) => { const t = Date.now(); for (;;) { const e = events.find(p); if (e) return e; if (Date.now() - t > ms) throw new Error("worker event timeout"); await sleep(10); } };
    const ready = await wait((e) => e.ev === "ready");
    worker.send({ op: "capture.start", turn: "p4-stt", gen: 1, device: -1, endpointing: "vad", maxMs: 15_000 });
    const end = await wait((e) => e.ev === "vad" && e.state === "speech_end");
    const fin = await wait((e) => e.ev === "stt.final" || e.ev === "stt.none");
    runs.push({ phrase, engine: ready.stt.engine, recognizer: ready.stt.recognizer, local: ready.stt.local, result: fin.ev, text: fin.text ?? null, confidence: fin.confidence ?? null, wer: wer(phrase, fin.text), speechEndToResultMs: Math.round(fin.mono - end.mono) });
    await worker.close();
  }
  out.recognition = { fixture: "SAPI-synthesized phrases via --input-synth; not human speech", runs, meanWer: runs.reduce((s, r) => s + r.wer, 0) / runs.length };
} finally {
  for (const s of sessions) await s.close().catch(() => {});
  for (const r of roots) rmSync(r, { recursive: true, force: true });
  out.disposableRootsLeft = roots.filter(existsSync).length;
  out.repoRuntimeUnchanged = installedShim === (existsSync(join(root, RUNTIME, "bunny-whisper-shim.dll")) ? sha(join(root, RUNTIME, "bunny-whisper-shim.dll")) : null)
    && readdirSync(join(root, RUNTIME)).every((n) => !n.startsWith(".shim-build-"));
  writeEvidence("docs/ma5-s2/evidence/voice/whisper-verification.json", out, []);
  console.log(JSON.stringify({ candidate: out.candidate?.binarySha256, reproducible: out.candidate?.reproducible, checkout: out.checkout.selection, candidateSelection: out.selectionWithCandidate, meanWer: out.recognition?.meanWer }));
}
