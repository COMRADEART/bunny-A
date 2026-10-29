import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { authorizationTemplate, onScript, validateAuthorization, wer, PHRASES, TRIALS } from "./ma5-s2/acoustic-session.mjs";

// MA5-S2 P4-4: the attended acoustic harness opens nothing without a complete, current owner authorization.
const now = Date.parse("2026-10-29T12:00:00Z");
const valid = () => ({ ...authorizationTemplate(), microphone: "Microphone (Realtek(R) Audio)", speakers: "Speakers (Realtek(R) Audio)", playbackVolume: "30%", authorizedAt: "2026-10-29T11:30:00Z" });

test("P4-4 a filled-in, current authorization is accepted; the template itself is not", () => {
  assert.deepEqual(validateAuthorization(valid(), now), []);
  const template = validateAuthorization(authorizationTemplate(), now);
  assert.ok(template.includes("microphone not filled in") && template.includes("speakers not filled in") && template.includes("authorizedAt is not a time"));
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
    const check = run("--authorization", bad, "--check");
    assert.equal(check.status, 0, check.stderr);
    assert.equal(JSON.parse(check.stdout).valid, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("P4-3 scoring: WER ignores pause bars and punctuation; off-script recognition is never stored", () => {
  assert.equal(wer("what are my agents | working on", "What are my agents working on?"), 0);
  assert.equal(wer("what failed", "what fail"), 0.5);
  assert.equal(onScript("what failed", "What failed?"), "What failed?");
  assert.equal(onScript("what failed", "call my sister about dinner"), "[off-script: not stored]");
  assert.equal(onScript("what failed", null), null);
  // Enough trials for rates: every scripted category has at least 15 attempts.
  assert.ok(PHRASES.stt.length * TRIALS.stt >= 15 && PHRASES.interrupt.length * Math.ceil(TRIALS.interrupt / 2) >= 12 && PHRASES.backchannel.length * Math.ceil(TRIALS.backchannel / 2) >= 12);
});
