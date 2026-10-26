import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyErrorToTaxonomy,
  evaluateRecovery,
  executeWithSafeRecovery,
  type RecoveryPolicy,
} from "./failure-recovery.ts";

test("failure recovery: classifies errors into taxonomy accurately", () => {
  assert.equal(classifyErrorToTaxonomy(new Error("Rate limit exceeded 429")), "MODEL_OVERLOAD");
  assert.equal(classifyErrorToTaxonomy(new Error("ECONNRESET: transient IO failed")), "TRANSIENT_IO");
  assert.equal(classifyErrorToTaxonomy(new Error("Response was not valid JSON")), "MODEL_MALFORMED_OUTPUT");
  assert.equal(classifyErrorToTaxonomy(new Error("Folder 'secret' is not authorized by the task envelope")), "PERMISSION_DENIED");
  assert.equal(classifyErrorToTaxonomy(new Error("PIN_VIOLATION: model mismatch")), "PIN_MISMATCH");
  assert.equal(classifyErrorToTaxonomy(new Error("Security violation: symlink or junction forbidden")), "SECURITY_VIOLATION");
  assert.equal(classifyErrorToTaxonomy(new Error("UNCERTAIN: external action outcome is unknown")), "UNCERTAIN_IRREVERSIBLE");
});

test("failure recovery: non-recoverable and security errors fail immediately without retry", () => {
  const policy: RecoveryPolicy = {
    maxRetries: 3,
    baseBackoffMs: 10,
    maxBackoffMs: 50,
    deadlineAt: Date.now() + 10_000,
    isIrreversible: false,
  };

  const decisionPerm = evaluateRecovery(new Error("Permission denied by envelope"), 1, policy);
  assert.equal(decisionPerm.recoverable, false);
  assert.equal(decisionPerm.canRetry, false);
  assert.equal(decisionPerm.taxonomy, "PERMISSION_DENIED");

  const decisionPin = evaluateRecovery(new Error("PIN_VIOLATION: served model mismatch"), 1, policy);
  assert.equal(decisionPin.canRetry, false);
  assert.equal(decisionPin.taxonomy, "PIN_MISMATCH");

  const decisionSec = evaluateRecovery(new Error("Security policy violation: prohibited flag --eval"), 1, policy);
  assert.equal(decisionSec.canRetry, false);
  assert.equal(decisionSec.taxonomy, "SECURITY_VIOLATION");
});

test("failure recovery: irreversible operations never retry automatically", () => {
  const policy: RecoveryPolicy = {
    maxRetries: 3,
    baseBackoffMs: 10,
    maxBackoffMs: 50,
    deadlineAt: Date.now() + 10_000,
    isIrreversible: true, // Marked irreversible!
  };

  const decision = evaluateRecovery(new Error("Network timed out during write"), 1, policy);
  assert.equal(decision.canRetry, false, "Irreversible operations must not be retried automatically");
  assert.equal(decision.taxonomy, "UNCERTAIN_SIDE_EFFECT");
});

test("failure recovery: recoverable errors retry within finite budget and backoff", async () => {
  const policy: RecoveryPolicy = {
    maxRetries: 3,
    baseBackoffMs: 5,
    maxBackoffMs: 20,
    deadlineAt: Date.now() + 10_000,
    isIrreversible: false,
  };

  let attemptsRun = 0;
  const op = async (attempt: number) => {
    attemptsRun = attempt;
    if (attempt < 3) {
      throw new Error("Temporary model overload 429");
    }
    return "SUCCESS_RESULT";
  };

  const signal = new AbortController().signal;
  const res = await executeWithSafeRecovery(op, policy, signal);
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.equal(res.value, "SUCCESS_RESULT");
    assert.equal(res.attempts, 3);
  }
});

test("failure recovery: cancellation during backoff wait stops immediately", async () => {
  const policy: RecoveryPolicy = {
    maxRetries: 5,
    baseBackoffMs: 2000, // 2 second backoff
    maxBackoffMs: 5000,
    deadlineAt: Date.now() + 10_000,
    isIrreversible: false,
  };

  const ac = new AbortController();
  const op = async () => {
    throw new Error("Temporary model overload 429");
  };

  // Abort after 50ms (during the 2000ms backoff sleep)
  setTimeout(() => ac.abort(), 50);

  const start = Date.now();
  const res = await executeWithSafeRecovery(op, policy, ac.signal);
  const elapsed = Date.now() - start;

  assert.equal(res.ok, false);
  assert.equal(res.taxonomy, "CANCELLATION");
  assert.ok(elapsed < 500, `Must cancel promptly during backoff sleep; took ${elapsed}ms`);
});
