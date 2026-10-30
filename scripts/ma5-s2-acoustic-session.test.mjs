import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { PassThrough } from "node:stream";
import { createInterface } from "node:readline/promises";
import {
  answerSettled, assertPrivateEvidence, authorizationTemplate, checkEndpoints, latencyRow, latencyStats, createSessionGuard, createShutdown, redact, safeFailure, scoreTurn,
  sessionBudgetMs, sessionPrimitives, SessionStop, validateAuthorization, watchEndpoints, wer, PHRASES, TRIALS,
  A18, a18Verdict, createOwnedTempDir, planSections, recoverInterruptedSessions, wireOwnerStop, TEMP_PREFIX,
} from "./ma5-s2/acoustic-session.mjs";

// MA5-S2 P4-4: the attended acoustic harness opens nothing without a complete, current owner authorization.
const now = Date.parse("2026-10-29T12:00:00Z");
const MIC = "Microphone (Realtek(R) Audio)", SPK = "Speakers (Realtek(R) Audio)";
const valid = () => ({ ...authorizationTemplate(), microphone: MIC, speakers: SPK, maxPlaybackVolumePercent: 30, authorizedAt: "2026-10-29T11:30:00Z" });

test("P4-4 a filled-in, current authorization is accepted; the template itself is not", () => {
  assert.deepEqual(validateAuthorization(valid(), now), []);
  const template = validateAuthorization(authorizationTemplate(), now);
  assert.ok(template.includes("microphone not filled in") && template.includes("speakers not filled in") && template.includes("authorizedAt is not a time"));
  assert.ok(template.includes("maxPlaybackVolumePercent must be an integer 1..100"));
});

test("P4-4 every privacy attestation is required, and stale or future authorizations are refused", () => {
  for (const k of ["transientInMemoryProcessing", "noRawAudioSavedOrUploaded", "ownerUnmutesMicrophoneManually", "ownerPresentForWholeSession"]) {
    assert.ok(validateAuthorization({ ...valid(), [k]: false }, now).includes(`${k} must be true`), k);
  }
  assert.match(validateAuthorization({ ...valid(), authorizedAt: "2026-10-28T11:00:00Z" }, now).join(), /older than 12 hours/);
  assert.match(validateAuthorization({ ...valid(), authorizedAt: "2026-10-29T13:00:00Z" }, now).join(), /future/);
  assert.match(validateAuthorization({ ...valid(), maxMinutes: 600 }, now).join(), /maxMinutes/);
  assert.match(validateAuthorization({ ...valid(), script: "other" }, now).join(), /script/);
});

test("P4R1-2 the playback volume limit is a validated integer; the old free-form field is refused", () => {
  for (const bad of ["30%", 0, 101, 30.5, null]) assert.match(validateAuthorization({ ...valid(), maxPlaybackVolumePercent: bad }, now).join(), /maxPlaybackVolumePercent/, String(bad));
  assert.match(validateAuthorization({ ...valid(), playbackVolume: "30%" }, now).join(), /playbackVolume is replaced/);
  assert.match(validateAuthorization({ ...valid(), schema: "bunny-acoustic-authorization/1" }, now).join(), /schema/);
});

test("P4-4 the CLI refuses before loading any Host code when the authorization is missing or invalid", () => {
  const dir = mkdtempSync(join(tmpdir(), "bunny-p4-auth-test-"));
  try {
    const run = (...args) => spawnSync(process.execPath, ["scripts/ma5-s2/acoustic-session.mjs", ...args], { encoding: "utf8" });
    assert.match(run().stderr, /Refused: --authorization <file> is required\. Nothing was opened\./);
    const bad = join(dir, "auth.json");
    writeFileSync(bad, JSON.stringify(authorizationTemplate()));
    const refused = run("--authorization", bad);
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /Refused: the authorization is not valid/);
    writeFileSync(bad, JSON.stringify({ ...valid(), authorizedAt: new Date().toISOString() }));
    // S3R1: recognition sections never run with action sections; the default (every section) is refused as mixed.
    assert.match(run("--authorization", bad, "--check").stderr, /Refused: run the recognition sections \(1,8\) separately/);
    const check = run("--authorization", bad, "--sections", "1,8", "--check");
    assert.equal(check.status, 0, check.stderr);
    assert.equal(JSON.parse(check.stdout).valid, true);
    assert.equal(JSON.parse(check.stdout).recognitionOnly, true);
    assert.equal(JSON.parse(run("--authorization", bad, "--sections", "2,3,4", "--check").stdout).recognitionOnly, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("P4R1-3 scoring stores phrase ids and word-error counts, never the recognized text", () => {
  assert.equal(wer("what are my agents | working on", "What are my agents working on?"), 0);
  assert.equal(wer("what failed", "what fail"), 0.5);
  assert.deepEqual(scoreTurn("stt-1", "what failed", "What failed?"), { phraseId: "stt-1", refWords: 2, wordErrors: 0, outcome: "exact" });
  const off = scoreTurn("stt-1", "what failed", "call my sister about dinner");
  assert.deepEqual(off, { phraseId: "stt-1", refWords: 2, wordErrors: 5, outcome: "errors" });
  assert.ok(!JSON.stringify(off).includes("sister"));
  assert.deepEqual(scoreTurn("stt-1", "what failed", null), { phraseId: "stt-1", refWords: 2, wordErrors: null, outcome: "no-result" });
  // Enough trials for rates: every scripted category has at least 12 attempts.
  assert.ok(PHRASES.stt.length * TRIALS.stt >= 15 && PHRASES.interrupt.length * Math.ceil(TRIALS.interrupt / 2) >= 12 && PHRASES.backchannel.length * Math.ceil(TRIALS.backchannel / 2) >= 12);
});

test("P4R1-3 failures, logs and evidence cannot carry paths, addresses, credentials, device names or speech", () => {
  const raw = new Error(`open C:\\Users\\owner\\AppData\\Local\\bunny\\x.json failed for owner@example.com with Bearer abcDEF1234567890xyz on ${MIC} /home/owner/a`);
  const f = safeFailure(raw, [MIC]);
  assert.equal(f.code, "ERROR");
  for (const leak of ["Users", "owner", "example.com", "abcDEF", "Realtek", "/home"]) assert.ok(!f.detail.includes(leak), leak);
  assert.deepEqual(safeFailure(new SessionStop("SESSION_EXPIRED", "the authorized session time is over")), { code: "SESSION_EXPIRED", detail: "the authorized session time is over" });
  assert.ok(redact("x".repeat(500)).length <= 200);
  assert.equal(redact("UNAUTHORIZED_OUTPUT,OUTPUT_VOLUME_UNVERIFIED"), "UNAUTHORIZED_OUTPUT,OUTPUT_VOLUME_UNVERIFIED", "stop codes survive");
  assert.equal(redact("worker b96e9235-39cd-41e3-b59c-1bed1dad992f"), "worker [id]");
  assert.doesNotThrow(() => assertPrivateEvidence({ at: "2026-10-29T12:00:00.000Z", stt: { trials: [scoreTurn("stt-0", "what failed", "what")] }, failure: f }, [MIC]));
  assert.throws(() => assertPrivateEvidence({ stt: { trials: [{ text: "call my sister" }] } }), /recognized text/);
  assert.throws(() => assertPrivateEvidence({ devices: { input: MIC } }, [MIC]), /names a device/);
  assert.throws(() => assertPrivateEvidence({ note: "saved to C:\\Users\\owner\\x" }), /path/);
});

// P4R1-2: endpoint measurements are fixtures here; the real ones come from the worker's read-only Core Audio query.
const endpoints = (over = {}) => ({ input: { name: MIC, present: true, muted: false, volume: 0.8 }, output: { name: SPK, present: true, muted: false, volume: 0.3 }, micPrivacy: "allow", ...over });

test("P4R1-2 playback is allowed only on the authorized output at or below the authorized volume; unknown fails closed", () => {
  assert.deepEqual(checkEndpoints(endpoints(), valid()), { ok: true, problems: [], volumePercent: 30, outputMuted: false });
  assert.equal(checkEndpoints(endpoints({ output: { name: SPK, present: true, volume: Math.fround(0.3) } }), valid()).ok, true, "float32 0.3 reads as 30");
  assert.deepEqual(checkEndpoints(endpoints({ output: { name: SPK, present: true, volume: 0.305 } }), valid()).problems, ["OUTPUT_VOLUME_ABOVE_LIMIT"]);
  for (const volume of [null, undefined, NaN, -0.1, 1.5]) assert.deepEqual(checkEndpoints(endpoints({ output: { name: SPK, present: true, volume } }), valid()).problems, ["OUTPUT_VOLUME_UNVERIFIED"], String(volume));
  assert.deepEqual(checkEndpoints(endpoints({ output: { name: "Headphones (Bluetooth)", present: true, volume: 0.1 } }), valid()).problems, ["UNAUTHORIZED_OUTPUT"]);
  assert.deepEqual(checkEndpoints(endpoints({ output: { name: SPK, present: false, volume: null } }), valid()).problems, ["UNAUTHORIZED_OUTPUT", "OUTPUT_VOLUME_UNVERIFIED"]);
  assert.deepEqual(checkEndpoints(endpoints({ input: { name: "Other mic", present: true } }), valid()).problems, ["UNAUTHORIZED_INPUT"]);
  assert.equal(checkEndpoints(null, valid()).ok, false);
});

/** A fake Host voice surface: capture/playback state machine, command log, optional hanging commands. No devices. */
function fakeHost(state = {}) {
  const s = { open: true, capturing: false, playing: false, state: "IDLE", turnId: "t0", devices: endpoints(), ...state };
  const log = [];
  const hang = new Set();
  const send = (action) => {
    log.push(action);
    if (hang.has(action)) return new Promise(() => {}); // a model call or Host that never answers
    if (action === "voice.interrupt") Object.assign(s, { playing: false, state: s.capturing ? "LISTENING" : "INTERRUPTED" });
    if (action === "voice.session.close") Object.assign(s, { open: false, capturing: false, playing: false, state: "IDLE" });
    return Promise.resolve({ voice: structuredClone(s) });
  };
  return { s, log, hang, send };
}
/** The production shutdown order, wired to the fake: silence + close voice, close Host, force-terminate leftovers. */
function wiredShutdown(host, { closeHost = async () => {}, workers = [], stepMs = 200 } = {}) {
  const killed = [];
  let pids = [...workers];
  const shutdown = createShutdown({
    stopAudio: async () => { await host.send("voice.interrupt", { source: "session_close" }); await host.send("voice.session.close", { source: "e2e" }); },
    closeHost,
    ownedWorkers: async () => pids,
    forceKill: async (list) => { killed.push(...list); pids = pids.filter((p) => !list.includes(p)); },
    stepMs,
  });
  return { shutdown, killed };
}
const startGuarded = (host, budgetMs, opts = {}) => {
  const { shutdown, killed } = wiredShutdown(host, opts);
  const stops = [];
  const guard = createSessionGuard({ budgetMs, onStop: (r) => { stops.push(r.code); void shutdown(); } });
  return { guard, shutdown, killed, stops, ops: sessionPrimitives({ guard, send: host.send, ask: opts.ask }) };
};

test("P4R1-1 expiry while waiting for keyboard input cancels the prompt and closes voice", async () => {
  const input = new PassThrough(); // nobody ever types
  const rl = createInterface({ input, output: new PassThrough() });
  const host = fakeHost();
  const { guard, shutdown, stops, ops } = startGuarded(host, 40, { ask: (text, signal) => rl.question(text, { signal }) });
  const t = performance.now();
  await assert.rejects(ops.prompt("Say clearly: what failed"), (e) => e instanceof SessionStop && e.code === "SESSION_EXPIRED");
  assert.ok(performance.now() - t < 1_000, "the prompt was cancelled at the deadline, not left waiting");
  const receipt = await shutdown();
  assert.deepEqual(stops, ["SESSION_EXPIRED"]);
  assert.equal(receipt.clean, true);
  assert.equal(host.s.open, false);
  rl.close(); guard.dispose();
});

test("P4R1-1 expiry during active capture stops capture through the session close", async () => {
  const host = fakeHost({ capturing: true, state: "LISTENING" });
  const { guard, shutdown, ops } = startGuarded(host, 40);
  // Waiting for a turn that never ends while the microphone is capturing.
  await assert.rejects(ops.until(async () => { const v = await ops.voice(); return v.capturing ? null : v; }, 60_000), { code: "SESSION_EXPIRED" });
  await shutdown();
  assert.equal(host.s.capturing, false);
  assert.ok(host.log.lastIndexOf("voice.session.close") > host.log.lastIndexOf("voice.state"));
  guard.dispose();
});

test("P4R1-1 expiry during playback silences the reply before the session closes", async () => {
  const host = fakeHost({ playing: true, state: "SPEAKING" });
  const { guard, shutdown, ops } = startGuarded(host, 40);
  await assert.rejects(ops.until(async () => ((await ops.voice()).playing ? null : true), 60_000), { code: "SESSION_EXPIRED" });
  await shutdown();
  assert.equal(host.s.playing, false);
  const tail = host.log.slice(host.log.indexOf("voice.interrupt"));
  assert.deepEqual(tail, ["voice.interrupt", "voice.session.close"], "interrupt first, then close");
  guard.dispose();
});

test("P4R1-1 expiry during model inference abandons the pending call", async () => {
  const host = fakeHost();
  host.hang.add("voice.text");
  const { guard, shutdown, ops } = startGuarded(host, 40);
  const t = performance.now();
  await assert.rejects(ops.cmd("voice.text", { text: "Tell me a six sentence story" }), { code: "SESSION_EXPIRED" });
  assert.ok(performance.now() - t < 1_000);
  assert.equal((await shutdown()).clean, true);
  // After the stop, no further Host command is sent by the session.
  await assert.rejects(ops.cmd("voice.state"), { code: "SESSION_EXPIRED" });
  guard.dispose();
});

test("P4R1-1 a hanging shutdown is bounded; leftover workers are force-terminated; cleanup is idempotent", async () => {
  const host = fakeHost({ capturing: true });
  host.hang.add("voice.session.close"); // the session close itself never answers
  let closes = 0;
  const { shutdown, killed } = wiredShutdown(host, { closeHost: () => { closes++; return new Promise(() => {}); }, workers: [4242], stepMs: 50 });
  const t = performance.now();
  const [a, b] = await Promise.all([shutdown(), shutdown()]);
  assert.equal(a, b, "one receipt for every caller");
  assert.ok(performance.now() - t < 1_000, "bounded");
  assert.deepEqual(a.steps.map((s) => [s.step, s.outcome]), [["silence-and-close-voice", "timeout"], ["close-host", "timeout"], ["force-terminate-workers", "ok"]]);
  assert.deepEqual(killed, [4242]);
  assert.equal(a.forcedWorkers, 1);
  assert.equal(a.workersAfterShutdown, 0);
  assert.equal(a.clean, false, "a forced shutdown is never reported clean");
  await shutdown();
  assert.equal(closes, 1);
  assert.deepEqual(killed, [4242]);
});

test("P4R1-1 a failing step does not stop the rest of the cleanup", async () => {
  const host = fakeHost();
  let closed = false;
  const shutdown = createShutdown({ stopAudio: async () => { throw new Error("Host gone"); }, closeHost: async () => { closed = true; }, ownedWorkers: async () => [], forceKill: async () => {}, stepMs: 50 });
  const r = await shutdown();
  assert.equal(closed, true);
  assert.deepEqual(r.steps.map((s) => s.outcome), ["error", "ok"]);
  void host;
});

test("P4R1-1 elapsed time is monotonic: a late timer or a wall-clock change cannot extend the session", () => {
  let mono = 0;
  const guard = createSessionGuard({ budgetMs: 60_000, now: () => mono });
  guard.check();
  mono = 60_001; // the event loop was blocked past the deadline; the timer has not fired yet
  assert.throws(() => guard.check(), { code: "SESSION_EXPIRED" });
  guard.dispose();
  // The budget is also cut by the authorization's own validity, read once from the wall clock.
  assert.equal(sessionBudgetMs({ maxMinutes: 45, authorizedAt: "2026-10-29T00:00:00Z" }, Date.parse("2026-10-29T11:50:00Z")), 10 * 60_000);
  assert.equal(sessionBudgetMs({ maxMinutes: 45, authorizedAt: "2026-10-29T11:30:00Z" }, now), 45 * 60_000);
  assert.equal(sessionBudgetMs({ maxMinutes: 45, authorizedAt: "2026-10-28T00:00:00Z" }, now), 0);
});

test("P4R1-2 the endpoint monitor stops the session on an output switch or a volume raised above the limit", async () => {
  for (const [label, change, problem] of [
    ["output switch", (s) => { s.devices.output = { name: "Headphones (Bluetooth)", present: true, volume: 0.2 }; }, "UNAUTHORIZED_OUTPUT"],
    ["volume raised", (s) => { s.devices.output.volume = 0.8; }, "OUTPUT_VOLUME_ABOVE_LIMIT"],
    ["volume unreadable", (s) => { s.devices.output.volume = null; }, "OUTPUT_VOLUME_UNVERIFIED"],
  ]) {
    const host = fakeHost();
    const { guard, shutdown, ops } = startGuarded(host, 60_000);
    let reads = 0;
    const watching = watchEndpoints({ ops, guard, auth: valid(), intervalMs: 5, onRead: () => { if (++reads === 2) change(host.s); } });
    await watching;
    assert.equal(guard.signal.reason.code, "ENDPOINT_NOT_AUTHORIZED", label);
    assert.match(guard.signal.reason.message, new RegExp(problem), label);
    assert.equal((await shutdown()).clean, true);
    assert.ok(!host.log.some((a) => /volume|mute/i.test(a) && a !== "voice.mute"), "the monitor never sets a volume");
    guard.dispose();
  }
});

test("P4R1-2 the monitor tolerates only the named problem during attended device recovery", async () => {
  const host = fakeHost();
  const { guard, ops } = startGuarded(host, 60_000);
  let reads = 0;
  const watching = watchEndpoints({ ops, guard, auth: valid(), intervalMs: 5, tolerated: () => ["UNAUTHORIZED_INPUT"], onRead: () => {
    reads++;
    if (reads === 1) host.s.devices.input = { name: "Other mic", present: true };
    if (reads === 4) host.s.devices.output.volume = 0.9;
  } });
  await watching;
  assert.ok(reads >= 4);
  assert.match(guard.signal.reason.message, /OUTPUT_VOLUME_ABOVE_LIMIT/);
  assert.doesNotMatch(guard.signal.reason.message, /UNAUTHORIZED_INPUT/);
  guard.dispose();
});

test("P4R1-2 the monitor checks only while a voice session is open (a closed session cannot play)", async () => {
  const host = fakeHost({ open: false, devices: { input: null, output: null, micPrivacy: "unknown" } });
  let polls = 0;
  const send = (a, d) => { if (a === "voice.state" && ++polls === 3) Object.assign(host.s, { open: true, devices: endpoints({ output: { name: SPK, present: true, volume: 0.9 } }) }); return host.send(a, d); };
  const guard = createSessionGuard({ budgetMs: 60_000 });
  let reads = 0;
  await watchEndpoints({ ops: sessionPrimitives({ guard, send }), guard, auth: valid(), intervalMs: 5, onRead: () => reads++ });
  assert.equal(reads, 1, "closed polls were skipped; the first open poll was checked");
  assert.match(guard.signal.reason.message, /OUTPUT_VOLUME_ABOVE_LIMIT/);
  guard.dispose();
});

test("P4 attended: a push-to-talk latency turn waits for the answer, not just the transcript", () => {
  const t = { speechEndAt: 1_000, finalAt: 1_400, firstTokenAt: 2_000, delayAckAt: 1_500, delayAckPlaybackAt: 1_600, firstPlaybackAt: 3_000, completedAt: 5_000 };
  const base = { turnId: "t2", capturing: false, state: "PROCESSING", finalTranscript: "what failed" };
  assert.equal(answerSettled({ ...base, timing: { ...t, firstPlaybackAt: null, completedAt: null } }, "t1"), false, "a transcript alone is not a settled turn");
  assert.equal(answerSettled({ ...base, timing: t }, "t1"), true);
  assert.equal(answerSettled({ ...base, timing: t }, "t2"), false, "the previous turn never counts");
  assert.equal(answerSettled({ ...base, state: "IDLE", finalTranscript: null, timing: { ...t, completedAt: null } }, "t1"), true, "no recognition ends the turn");
  assert.equal(answerSettled({ ...base, capturing: true, timing: t }, "t1"), false);
  // Each stage is reported separately; the status line is never the answer.
  assert.deepEqual(latencyRow(t), { transcriptMs: 400, firstModelTokenMs: 1_000, statusAckAudibleMs: 600, firstAudibleAnswerMs: 2_000, completedMs: 4_000, delayAck: true });
  assert.deepEqual(latencyRow(null), { transcriptMs: null, firstModelTokenMs: null, statusAckAudibleMs: null, firstAudibleAnswerMs: null, completedMs: null, delayAck: false });
  const s = latencyStats([latencyRow(t), latencyRow({ ...t, firstPlaybackAt: 2_500 }), latencyRow(null)]);
  assert.deepEqual(s.firstAudibleAnswerMs, { n: 2, p50: 1_500, p95: 2_000, max: 2_000 });
  assert.equal(s.statusAckAudibleMs.n, 2);
});

// -----------------------------------------------------------------------------------------------------------------
// S3R1: recognition separated from actions, A18 criteria, abnormal-exit cleanup and an always-available owner stop
// -----------------------------------------------------------------------------------------------------------------

test("S3R1 recognition sections run alone, on a Host that routes nothing; mixing them with action sections is refused", () => {
  assert.deepEqual(planSections([1, 8]), { sections: [1, 8], recognitionOnly: true });
  assert.deepEqual(planSections([1]), { sections: [1], recognitionOnly: true });
  assert.deepEqual(planSections([2, 3, 4]), { sections: [2, 3, 4], recognitionOnly: false });
  assert.throws(() => planSections([1, 7]), /separately/);
  assert.throws(() => planSections([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]), /separately/);
  // "goodbye bunny" is a scripted recognition phrase: it is safe only because recognition runs never route.
  assert.ok(PHRASES.stt.includes("goodbye bunny"));
});

test("S3R1 A18: WER <= 15% counting missing transcripts as deletions, no-result <= 5%, zero actions, 48 utterances / 200 words", () => {
  assert.deepEqual(A18, { maxWer: 0.15, maxNoResultRate: 0.05, maxUnauthorizedActions: 0, minUtterances: 48, minRefWords: 200 });
  const refWords = PHRASES.stt.reduce((s, p) => s + p.split(" ").length, 0) * TRIALS.stt;
  assert.ok(PHRASES.stt.length * TRIALS.stt >= A18.minUtterances && refWords >= A18.minRefWords, "a full recognition run meets the sample minimum");
  const exact = Array.from({ length: 48 }, (_, i) => ({ phraseId: `stt-${i % 8}`, refWords: 5, wordErrors: 0, outcome: "exact" }));
  assert.equal(a18Verdict(exact, 0).pass, true);
  // Two missing transcripts: 10 deleted words of 240 (4.2%) and a no-result rate of 4.2%, still within A18.
  const missing = exact.map((t, i) => (i < 2 ? { ...t, wordErrors: null, outcome: "no-result" } : t));
  const v = a18Verdict(missing, 0);
  assert.equal(v.wordErrorsWithDeletions, 10);
  assert.equal(v.noResultRate, 0.042);
  assert.equal(v.pass, true);
  // A third missing transcript crosses the no-result limit, though WER (6.3%) does not.
  const three = a18Verdict(exact.map((t, i) => (i < 3 ? { ...t, wordErrors: null, outcome: "no-result" } : t)), 0);
  assert.equal(three.checks.noResultRate, false);
  assert.equal(three.checks.wer, true);
  assert.equal(a18Verdict(exact, 1).checks.unauthorizedActions, false, "one speech-triggered Task fails A18");
  assert.equal(a18Verdict(exact.slice(0, 24), 0).checks.sample, false, "24 utterances (the S1 size) is below the qualification sample");
  const errors = exact.map((t) => ({ ...t, wordErrors: 1, outcome: "errors" }));
  assert.equal(a18Verdict(errors, 0).checks.wer, false, "20% WER fails");
});

test("S3R1 recovery removes only positively identified directories whose owner process is gone", () => {
  const root = mkdtempSync(join(tmpdir(), "bunny-s3r1-recovery-"));
  try {
    const first = createOwnedTempDir(root);
    const second = createOwnedTempDir(root);
    const deadName = first.split(/[\\/]/).at(-1), otherName = second.split(/[\\/]/).at(-1);
    const unmarked = join(root, `${TEMP_PREFIX}abc123`);
    mkdirSync(unmarked);
    writeFileSync(join(unmarked, "host.sqlite"), "unknown");
    const foreign = join(root, `${TEMP_PREFIX}xyz789`);
    mkdirSync(foreign);
    writeFileSync(join(foreign, ".bunny-acoustic-owner.json"), JSON.stringify({ schema: "bunny-acoustic-temp/1", name: deadName, pid: 1 }));
    const oddName = join(root, `${TEMP_PREFIX}not-a-mkdtemp-name`);
    mkdirSync(oddName);
    writeFileSync(join(oddName, ".bunny-acoustic-owner.json"), JSON.stringify({ schema: "bunny-acoustic-temp/1", name: `${TEMP_PREFIX}not-a-mkdtemp-name`, pid: 1 }));
    const unrelated = join(root, "something-else");
    mkdirSync(unrelated);
    // A link that carries the prefix and points at an identified directory is never followed or removed.
    const target = createOwnedTempDir(mkdtempSync(join(tmpdir(), "bunny-s3r1-target-")));
    const link = join(root, `${TEMP_PREFIX}lnk456`);
    symlinkSync(target, link, "junction");
    // Every owner is reported gone: only the name, the directory type and the self-naming marker decide what is removed.
    const result = recoverInterruptedSessions({ root, alive: () => false });
    assert.deepEqual(result.removed.sort(), [deadName, otherName].sort());
    for (const kept of [unmarked, foreign, oddName, unrelated, link]) assert.ok(existsSync(kept), `${kept} must remain`);
    assert.ok(existsSync(join(target, ".bunny-acoustic-owner.json")), "the link target is untouched");
    assert.equal(result.kept.filter((k) => k.reason === "unidentified").length, 4);
    // A running owner keeps its directory.
    const running = createOwnedTempDir(root);
    const again = recoverInterruptedSessions({ root, alive: () => true });
    assert.ok(existsSync(running));
    assert.ok(again.kept.some((k) => k.reason === "owner-running"));
    rmSync(link, { force: true, recursive: false });
    rmSync(join(target, ".."), { recursive: true, force: true });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("S3R1 a normal exit removes the session directory; a forced termination leaves it for recovery, which then removes it", async () => {
  const root = mkdtempSync(join(tmpdir(), "bunny-s3r1-exit-"));
  const child = (exit) => spawn(process.execPath, ["--input-type=module", "-e", `
    import { createOwnedTempDir, installExitCleanup } from ${JSON.stringify(pathToFileURL(join(process.cwd(), "scripts/ma5-s2/acoustic-session.mjs")).href)};
    const dir = createOwnedTempDir(${JSON.stringify(root)});
    installExitCleanup(dir, () => process.exit(2));
    console.log(dir);
    ${exit ? "process.exit(0);" : "setInterval(() => {}, 1000);"}
  `], { stdio: ["ignore", "pipe", "inherit"] });
  const firstLine = (proc) => new Promise((done) => proc.stdout.once("data", (b) => done(String(b).trim())));
  try {
    const normal = child(true);
    const normalDir = await firstLine(normal);
    await new Promise((done) => normal.once("exit", done));
    assert.equal(existsSync(normalDir), false, "the exit handler removed it");

    const forced = child(false);
    const forcedDir = await firstLine(forced);
    forced.kill("SIGKILL"); // TerminateProcess on Windows: no handler runs
    await new Promise((done) => forced.once("exit", done));
    assert.equal(existsSync(forcedDir), true, "a forced termination bypasses every handler");
    const recovered = recoverInterruptedSessions({ root });
    assert.deepEqual(recovered.removed, [forcedDir.split(/[\\/]/).at(-1)]);
    assert.equal(existsSync(forcedDir), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("S3R1 the owner can stop the session between prompts (q + Enter) or with Ctrl+C, and waiting work ends at once", async () => {
  for (const how of ["q", "ctrl-c"]) {
    const input = new PassThrough();
    const rl = createInterface({ input, output: new PassThrough(), terminal: false });
    const guard = createSessionGuard({ budgetMs: 60_000 });
    wireOwnerStop(rl, guard);
    const ops = sessionPrimitives({ guard, send: async () => ({}), ask: null });
    const waiting = ops.sleep(60_000);
    const t = performance.now();
    if (how === "q") input.write("q\n");
    else rl.emit("SIGINT");
    await assert.rejects(waiting, (e) => e instanceof SessionStop && e.code === "ENDED_BY_OWNER");
    assert.ok(performance.now() - t < 1_000, "the stop takes effect without waiting for a prompt");
    guard.dispose();
    rl.close();
  }
  // Any other line between prompts is ignored.
  const input = new PassThrough();
  const rl = createInterface({ input, output: new PassThrough(), terminal: false });
  const guard = createSessionGuard({ budgetMs: 60_000 });
  wireOwnerStop(rl, guard);
  input.write("hello\n");
  await new Promise((r) => setImmediate(r));
  assert.equal(guard.signal.aborted, false);
  guard.dispose();
  rl.close();
});
