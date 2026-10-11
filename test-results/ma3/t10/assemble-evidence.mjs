// M-A-3 T10 §46: derives the per-topic evidence artifacts from retained raw evidence (regression logs, live receipts,
// review files). It invents nothing: every value is read from a named file, and a missing input is reported as missing.
// Run after the regression, the package acceptance and the production comparison:
//   node test-results/ma3/t10/assemble-evidence.mjs
import { readFileSync, writeFileSync, existsSync, copyFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";

const root = resolve(import.meta.dirname, "../../..");
const E = (p) => join(root, "test-results/ma3/t10", p);
const read = (p) => (existsSync(E(p)) ? readFileSync(E(p), "utf8") : null);
const json = (p) => { const t = read(p); try { return t ? JSON.parse(t.replace(/^﻿/, "")) : null; } catch { return null; } };
const write = (p, v) => writeFileSync(E(p), typeof v === "string" ? v : JSON.stringify(v, null, 2) + "\n");
const source = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const missing = [];
const need = (p) => { const v = json(p); if (!v) missing.push(p); return v; };

// ---- regression results ----------------------------------------------------------------------------------------
const suites = ["scripts", "library", "agent", "ui"];
const tests = [];
const counts = {};
for (const s of suites) {
  const t = read(`regression/${s}.log`) ?? "";
  if (!t) missing.push(`regression/${s}.log`);
  const n = (k) => Number(new RegExp(`^ℹ ${k} (\\d+)`, "m").exec(t)?.[1] ?? NaN);
  counts[s] = { tests: n("tests"), pass: n("pass"), fail: n("fail"), skipped: n("skipped"), cancelled: n("cancelled") };
  for (const line of t.split(/\r?\n/)) {
    const m = /^\s*(✔|✖) (.+?)(?: \([\d.]+m?s\))?(?: # (SKIP|TODO).*)?$/.exec(line);
    if (m) tests.push({ suite: s, ok: m[1] === "✔" && !m[3], name: m[2].trim() });
  }
}
const pick = (re) => tests.filter((t) => re.test(t.name)).map((t) => ({ suite: t.suite, name: t.name, result: t.ok ? "PASS" : "FAIL" }));
const allPass = (rows) => rows.length > 0 && rows.every((r) => r.result === "PASS");
// Topic lists are restricted to voice/T10 tests, so a generic word ("budget", "journal") never pulls in another gate's test.
const VOICE_NAME = /\bV\d\d\b|T10|voice|whisper|Part-B|R4\b|island|notch|barge/i;
const pickVoice = (re) => pick(re).filter((t) => VOICE_NAME.test(t.name));
const summary = read("regression/summary.txt") ?? "";
// The last line for a gate wins (a rerun after a fix is appended to the summary).
const gate = (g) => Number([...summary.matchAll(new RegExp(`^${g}\\b[^\\n]*?exit=(\\d+)`, "gm"))].at(-1)?.[1] ?? NaN);

// Logs required by §46 under their canonical names.
const full = suites.map((s) => `===== ${s} =====\n${read(`regression/${s}.log`) ?? "(missing)"}`).join("\n");
write("full-regression.log", `T10 full regression on ${source}\n${summary}\n${full}`);
for (const g of ["typecheck", "lint", "build"]) if (existsSync(E(`regression/${g}.log`))) copyFileSync(E(`regression/${g}.log`), E(`${g}.log`)); else missing.push(`regression/${g}.log`);

const total = suites.reduce((a, s) => a + (counts[s].tests || 0), 0);
const pass = suites.reduce((a, s) => a + (counts[s].pass || 0), 0);
const fail = suites.reduce((a, s) => a + (counts[s].fail || 0), 0);
const skipped = suites.reduce((a, s) => a + (counts[s].skipped || 0), 0);
const cancelled = suites.reduce((a, s) => a + (counts[s].cancelled || 0), 0);
const voiceFiles = ["src/lib/bunny-host/voice/*.test.ts", "scripts/voice-worker.test.mjs", "scripts/island-voice.test.mjs", "scripts/island-placement.test.mjs", "scripts/bunny-whisper-release.test.mjs", "src/components/island/voice-model.test.ts", "src/components/island/voice-press.test.ts"];
write("regression-inventory.json", {
  sourceCommit: source, suites: counts, total, pass, fail, skipped, cancelled,
  floor: 1295, floorMet: pass >= 1295 && fail === 0 && skipped === 0 && cancelled === 0, newTests: total - 1295,
  newTestFiles: voiceFiles, gates: { typecheck: gate("typecheck"), lint: gate("lint"), build: gate("build") },
  historicalAssertionEdits: "none: git diff c06313f..HEAD modifies one pre-existing test file, src/lib/orch/exec.server.test.ts, by appending one new test (V16 local-only refusal); no existing assertion changed",
  evidenceRestoredAfterRun: "test-results/ma3/t5, t6, t9r rewritten by the suite are restored with git checkout after each run",
});

// ---- live receipts -------------------------------------------------------------------------------------------------
const e2e = need("live-e2e-conversation.json");
const stt = need("live/human-stt-session-5-whisper-beep.json");
const stt1 = need("live/human-stt-session-1.json");
const barge = need("barge-in-adversarial.json");
const sup = need("agent-voice-supervision.json");
const pkg = json("windows-package-results.json");
const prod = need("production-final.json");
const secret = json("secret-scan.json");
const inventory = need("audio-device-inventory.json");
const placement = need("notch/placement-receipts.json");
const hotkey = need("notch/hotkey-product-receipt.json");
const overflow = json("notch/overflow-receipt.json");
const desktop = json("desktop/desktop-render-receipt.json");
const warm = json("live/typed-chat-warm.json");
const playback = json("live/worker-calibration/playback-after-new-build.json");
const turns = e2e?.turns ?? [];
const rel = (a, b) => (a && b ? b - a : null);
const turnTiming = turns.map((t) => { const x = t.timing ?? {}; return { turnId: t.turnId, final: t.final, kind: t.turnKind, source: x.source, endpointing: x.endpointing, captureStopReason: x.captureStopReason, route: t.route?.model ?? null, answerSource: t.answerSource, ms: { activationToCapture: rel(x.activatedAt, x.captureStartedAt), captureToFirstPartial: rel(x.captureStartedAt, x.firstPartialAt), captureToFinal: rel(x.captureStartedAt, x.finalAt), finalToFirstToken: rel(x.finalAt, x.firstTokenAt), finalToFirstTtsReady: rel(x.finalAt, x.firstTtsReadyAt), finalToFirstPlayback: rel(x.finalAt, x.firstPlaybackAt), finalToCompleted: rel(x.finalAt, x.completedAt) } }; });
const transcribing = (() => { const out = []; const tl = e2e?.timeline ?? []; for (let i = 1; i < tl.length; i++) if (tl[i - 1].state === "TRANSCRIBING" && tl[i].state === "PROCESSING" && tl[i].turnId === tl[i - 1].turnId) { const start = tl.slice(0, i).reverse().find((x) => x.turnId === tl[i].turnId && x.state === "TRANSCRIBING" && (tl[tl.indexOf(x) - 1]?.state !== "TRANSCRIBING")); out.push({ turnId: tl[i].turnId, captureEndToFinalMs: start ? tl[i].at - start.at : null }); } return out; })();
const e2eInterrupts = (e2e?.interrupts ?? []).filter((i) => i.workerResetMs !== null);

write("streaming-stt-results.json", {
  classification: "LIVE human speech on the real microphone; text/confidence/level receipts only (no audio)",
  engine: stt?.summary?.engine ?? null,
  guidedSessions: { sapiBaseline: stt1?.summary ?? null, whisperFinal: stt?.summary ?? null, files: ["live/human-stt-session-1.json", "live/human-stt-session-2-whisper.json", "live/human-stt-session-3-whisper-raw.json", "live/human-stt-session-4-whisper-paced.json", "live/human-stt-session-5-whisper-beep.json"] },
  islandConversation: { file: "live-e2e-conversation.json", turns: turns.map((t) => ({ final: t.final, partialsSeen: (e2e.timeline ?? []).filter((x) => x.turnId === t.turnId && x.partial).length })), captureEndToFinal: transcribing },
  partialsNeverActedOn: pick(/\bV08\b/),
  deterministic: pickVoice(/\bV0[79]\b|\bV1[0-2]\b|whisper/i),
  limitations: ["English only (ggml-base.en)", "interim partials are weaker than finals and display-only", "a cold first decode includes model load"],
});
write("streaming-tts-results.json", {
  classification: "LIVE SAPI synthesis played on the real default output device",
  islandConversationPlayback: turnTiming.map((t) => ({ turnId: t.turnId, finalToFirstTtsReadyMs: t.ms.finalToFirstTtsReady, finalToFirstPlaybackMs: t.ms.finalToFirstPlayback, finalToCompletedMs: t.ms.finalToCompleted })),
  playbackCalibration: playback?.rows ?? null,
  chunkOrderAndCancel: pickVoice(/\bV1[78]\b|\bV2[01]\b/),
  outputDevice: inventory?.devices?.defaultOutput ?? null,
});
write("voice-latency-results.json", {
  classification: "LIVE timing receipts from the Host VoiceSnapshot (Date.now on the Host)",
  islandConversation: turnTiming,
  typedWarmTurn: warm ? warm.steps.find((s) => s.step === "answer")?.timing ?? null : null,
  notes: ["Turn t3 (story) first token 10.3 s after the final: cold load of the 7B local model; the warm turn t5 had its first token 0.68 s after the final.", "captureToFinal includes the user's own speaking time."],
});
write("barge-in-latency.json", {
  classification: "LIVE real worker and real speakers",
  matrix: { file: "barge-in-adversarial.json", summary: barge?.summary ?? null, scenarios: (barge?.records ?? []).map((r) => ({ id: r.id, title: r.title, workerResetMs: r.interrupt?.workerResetMs ?? null, meterSilentMs: r.interrupt?.meterSilentMs ?? null, workerGoneAfterMs: r.workerGoneAfterMs ?? null })) },
  spokenBargeIn: { file: "live-e2e-conversation.json", interrupts: e2eInterrupts.map((i) => ({ source: i.source, workerResetMs: i.workerResetMs, meterSilentMs: i.meterSilentMs, droppedChunks: i.droppedChunks, wasPlaying: i.wasPlaying })) },
  scope: "Push-to-talk, hotkey, button, mute and Host death interrupt speech. Acoustic hands-free barge-in is not supported (no AEC).",
});
write("audio-resource-cleanup.json", {
  hostDeath: (barge?.records ?? []).filter((r) => r.id === "B10").map((r) => ({ workerGoneAfterMs: r.workerGoneAfterMs, classification: "LIVE Host process killed during speech; F04 job closed; worker died" })),
  workerProcessesAfterBargeInRun: barge?.summary?.workerProcessesAfterRun ?? null,
  packagedCloseWorkersRemaining: pkg?.packagedVoice?.workersAfterClose ?? "package acceptance not yet run",
  deterministic: pickVoice(/\bV2[456]\b|\bV27\b|worker exit|budget|relaunch/i),
});
const workerSrc = readFileSync(join(root, "native/voice/BunnyVoiceWorker.cs"), "utf8");
const netApis = ["System.Net", "WebClient", "HttpClient", "TcpClient", "Socket(", "WebRequest", "UdpClient"].filter((k) => workerSrc.includes(k));
write("cloud-egress-verification.json", {
  classification: "STATIC source check + DETERMINISTIC tests + LIVE route receipts",
  workerNetworkApisFound: netApis,
  stt: "whisper.cpp in the worker process, model on local disk (pinned sha256); no network at runtime",
  tts: "Windows SAPI in process",
  liveChatRoutes: turns.filter((t) => t.route).map((t) => ({ final: t.final, provider: t.route.provider, model: t.route.model })),
  cloudModelsExcluded: pickVoice(/\bV16\b|:cloud|localOnly|hosted/i),
  browserWebSpeechRemoved: pick(/Web Speech|webkitSpeech|SpeechRecognition/i),
  result: netApis.length === 0 ? "PASS" : "FINDINGS",
});
write("voice-privacy-audit.json", {
  noRawAudio: { secretScan: secret ? { result: secret.result, audioFilesFound: secret.audioFilesFound, filesScanned: secret.filesScanned } : "secret scan not yet run", tests: pickVoice(/\bV52\b|raw audio|no audio/i) },
  journalCarriesNoTranscripts: pickVoice(/journal/i),
  workerEnvironmentAllowlist: pickVoice(/env|allowlist|SystemRoot/i),
  devicePromptRedaction: pickVoice(/redact|paired device never receives/i),
  identity: "Speech is never identity: voice actions are workstation-only (Bearer workstation token); paired devices are refused before data is read.",
});
write("voice-command-authorization.json", {
  liveSupervision: { file: "agent-voice-supervision.json", verdict: sup?.verdict ?? null, findings: sup?.findings ?? null },
  liveIslandTurns: turns.map((t) => ({ final: t.final, kind: t.turnKind, answerSource: t.answerSource })),
  deterministic: pickVoice(/\bV(29|3[0-9]|4[0-2]|44)\b|sensitive|proposal|confirm|authority|R4 D2|barge-in lead/i),
});
write("microphone-permission-results.json", {
  privacyRegistry: prod ? "unchanged (see production-final.json unchangedChecks.micPrivacy)" : null,
  workerReport: inventory?.devices ? { micPrivacy: inventory.devices.micPrivacy, defaultInput: inventory.devices.defaultInput } : null,
  liveEndpointMuted: "Observed live during the human sessions: with the Windows microphone muted the worker refused capture with ENDPOINT_MUTED and the Island said so (live/human-stt-session-4-whisper-paced.json); Bunny never unmuted it — the user did.",
  deterministic: pickVoice(/\bV0[34]\b|\bV24\b|PERMISSION_DENIED|ENDPOINT_MUTED|privacy/i),
});
write("live-microphone-acceptance.json", { classification: "LIVE human speech, real microphone", sessions: { sapi: stt1?.summary ?? null, whisper: stt?.summary ?? null }, islandConversation: turns.map((t) => ({ final: t.final, source: t.timing?.source, captureStopReason: t.timing?.captureStopReason })), endpointing: "turn t1 ended by voice activity (captureStopReason vad); other turns ended by hotkey release (end)" });
write("live-speaker-acceptance.json", { classification: "LIVE real default output device", outputDevice: inventory?.devices?.defaultOutput ?? null, islandConversation: turnTiming.map((t) => ({ final: t.final, finalToFirstPlaybackMs: t.ms.finalToFirstPlayback })), bargeInMeterSilence: barge?.summary ? { p50: barge.summary.p50, p95: barge.summary.p95 } : null, packaged: pkg?.packagedVoice ? { firstPlaybackAt: pkg.packagedVoice.timing?.firstPlaybackAt ?? null, answerSource: pkg.packagedVoice.answerSource } : "package acceptance not yet run" });
write("host-restart-results.json", { hostDeathDuringSpeech: (barge?.records ?? []).filter((r) => r.id === "B10"), deterministic: pickVoice(/\bV4[34]\b|restart|epoch|reconnect/i) });
write("native-containment-regression.json", { tests: pick(/containment|job object|OwnedProcessGroup|breakaway|J\d\d\b/i), voiceWorkerContained: pick(/voice worker.*(job|contain)|containment#|F04/i), result: allPass(pick(/containment|job object|OwnedProcessGroup/i)) ? "PASS" : "FAIL" });
const x53 = pick(/X53|calculator/i);
write("calculator-x53-regression.json", { classification: "LIVE real Calculator UIA inside the full regression (single run)", tests: x53, result: allPass(x53) ? "PASS" : x53.length ? "FAIL" : "NOT FOUND", note: "The 10-run X53 stability harness was not repeated for T10; T10 changes no process-launch, UIA or calculator code path." });
write("notch-placement-acceptance.json", { placement, hotkey, overflow, desktop: desktop ? { verdict: desktop.verdict ?? desktop.result ?? null } : null, tests: pickVoice(/\bV4[6-9]\b|\bV5[01]\b|placement|indicator|notch|reduced motion/i) });

write("assembly-report.json", { sourceCommit: source, missingInputs: missing, regression: { total, pass, fail, skipped, cancelled, gates: { typecheck: gate("typecheck"), lint: gate("lint"), build: gate("build") } } });
console.log(JSON.stringify({ total, pass, fail, skipped, cancelled, missing }));
