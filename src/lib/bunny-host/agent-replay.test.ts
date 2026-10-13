import test from "node:test";
import assert from "node:assert/strict";
import { classifyReplay, type ReplayFacts } from "./agent-replay.ts";

/** Facts for one interrupted step, adjustable per matrix row. Canonical store truth only. */
const facts = (patch: Partial<ReplayFacts> = {}): ReplayFacts => ({
  stepId: "s1",
  scope: "read",
  attempt: { taskId: null, outcome: null },
  task: null,
  verify: { hasSpec: false, recorded: false, passed: null },
  checkpoint: { boundary: "before_task_admission", valid: true },
  attemptsUsed: 0,
  maxAttempts: 6,
  ...patch,
});

// The replay decision table is the recovery walk's ONLY source of action: canonical facts in,
// one decision out. Every matrix row below is verbatim from the T4 brief (§33).
test("A11/A22/A23: a completed child task is canonical truth — result consumed, never re-submitted", () => {
  const decision = classifyReplay(facts({ attempt: { taskId: "t1", outcome: "interrupted" }, task: { state: "completed", failureDetail: null }, verify: { hasSpec: false, recorded: false, passed: null }, attemptsUsed: 2 }));
  assert.equal(decision.safety, "NOT_REPLAYABLE");
  assert.equal(decision.action, "consume_result");
  assert.equal(decision.category, null);
  assert.match(decision.reason, /consumed without re-execution/);
});

test("A13: a VERIFIED completed task is consumed with its recorded verification — the write is not duplicated", () => {
  const decision = classifyReplay(facts({ attempt: { taskId: "t1", outcome: "interrupted" }, task: { state: "completed", failureDetail: null }, verify: { hasSpec: false, recorded: true, passed: true } }));
  assert.equal(decision.action, "consume_result", "with no spec the recorded verification is only the task's own");
  assert.equal(decision.safety, "NOT_REPLAYABLE");
  const withSpec = classifyReplay(facts({ attempt: { taskId: "t1", outcome: "interrupted" }, task: { state: "completed", failureDetail: null }, verify: { hasSpec: true, recorded: true, passed: true } }));
  assert.equal(withSpec.action, "consume_result");
  assert.equal(withSpec.category, null);
});

test("A19: an invalid or unreadable checkpoint fails closed before anything else — UNKNOWN, ask_user, CHECKPOINT_INVALID", () => {
  const decision = classifyReplay(facts({ checkpoint: { boundary: "after_task_completion", valid: false } }));
  assert.equal(decision.safety, "UNKNOWN");
  assert.equal(decision.action, "ask_user");
  assert.equal(decision.category, "CHECKPOINT_INVALID");
  // The refusal outranks a completed child task: nothing replays on corrupt checkpoint material.
  assert.equal(classifyReplay(facts({ checkpoint: { boundary: null, valid: false }, task: { state: "completed", failureDetail: null }, attempt: { taskId: "t", outcome: "completed" } })).category, "CHECKPOINT_INVALID");
});

test("A21: a still-admitted child task means replay would duplicate it — ask_user, RECOVERY_AMBIGUOUS", () => {
  for (const state of ["queued", "waiting_for_approval", "running", "verifying"] as const) {
    const decision = classifyReplay(facts({ attempt: { taskId: "t1", outcome: "running" }, task: { state, failureDetail: null } }));
    assert.equal(decision.safety, "NOT_REPLAYABLE", state);
    assert.equal(decision.action, "ask_user");
    assert.equal(decision.category, "RECOVERY_AMBIGUOUS");
    assert.match(decision.reason, /duplicate/);
  }
});

test("A28: crash between task completion and checkpoint still inspects the canonical task result", () => {
  // completed task + recorded passed verification → consumed (the canonical result is the truth, not agent memory)
  const decision = classifyReplay(facts({ attempt: { taskId: "t1", outcome: "completed" }, task: { state: "completed", failureDetail: null }, verify: { hasSpec: true, recorded: true, passed: true } }));
  assert.equal(decision.action, "consume_result");
  assert.equal(decision.category, null);
});

test("A30: crash during verification re-runs the check, never the underlying effect", () => {
  const decision = classifyReplay(facts({ scope: "write", attempt: { taskId: "t1", outcome: "interrupted" }, task: { state: "completed", failureDetail: null }, verify: { hasSpec: true, recorded: false, passed: null } }));
  assert.equal(decision.safety, "VERIFY_BEFORE_REPLAY");
  assert.equal(decision.action, "verify_then_consume");
  assert.equal(decision.category, null);
  assert.match(decision.reason, /re-running the check, not the write/);
});

test("A13/verification-failed: a recorded FAILED verification never repeats the effect — ask_user", () => {
  const decision = classifyReplay(facts({ attempt: { taskId: "t1", outcome: "interrupted" }, task: { state: "completed", failureDetail: null }, verify: { hasSpec: true, recorded: true, passed: false } }));
  assert.equal(decision.safety, "NOT_REPLAYABLE");
  assert.equal(decision.action, "ask_user");
  assert.equal(decision.category, "VERIFICATION_FAILED");
});

test("A18/task-failed-before-restart: a task that died for its own reason asks, never replays blindly", () => {
  const decision = classifyReplay(facts({ attempt: { taskId: "t1", outcome: "failed" }, task: { state: "failed", failureDetail: "HTTP 429 rate limit" } }));
  assert.equal(decision.safety, "NOT_REPLAYABLE");
  assert.equal(decision.action, "ask_user");
  assert.equal(decision.category, "TASK_FAILED");
  assert.match(decision.reason, /for its own reason/);
});

test("A14: an ambiguous interrupted WRITE attempt asks the user — the agent pauses instead of replaying", () => {
  const withTask = classifyReplay(facts({ scope: "write", attempt: { taskId: "t1", outcome: "interrupted" }, task: { state: "failed", failureDetail: "Host process restarted; this adapter cannot reattach" } }));
  assert.equal(withTask.safety, "NOT_REPLAYABLE");
  assert.equal(withTask.action, "ask_user");
  assert.equal(withTask.category, "RECOVERY_AMBIGUOUS");
  assert.match(withTask.reason, /whether its effect already happened is unknown/);
  const withoutTask = classifyReplay(facts({ scope: "write", attempt: { taskId: "t", outcome: "running" }, task: null }));
  assert.equal(withoutTask.action, "ask_user");
  assert.equal(withoutTask.category, "RECOVERY_AMBIGUOUS");
});

test("A12: an interrupted READ-only step is SAFE_TO_REPLAY — re-admitted once, within the attempt ceiling", () => {
  const decision = classifyReplay(facts({ scope: "read", attempt: { taskId: "t1", outcome: "interrupted" }, task: { state: "failed", failureDetail: "Host process restarted; this adapter cannot reattach its old pipes" } }));
  assert.equal(decision.safety, "SAFE_TO_REPLAY");
  assert.equal(decision.action, "requeue_once");
  assert.equal(decision.category, "HOST_INTERRUPTED");
  assert.match(decision.reason, /re-admitted once/);
  const bare = classifyReplay(facts({ scope: "read", attempt: { taskId: "t1", outcome: "running" }, task: null }));
  assert.equal(bare.action, "requeue_once");
});

test("A14 boundary: a write-scope attempt that DID complete is still consumed, not re-executed", () => {
  const decision = classifyReplay(facts({ scope: "write", attempt: { taskId: "t1", outcome: "interrupted" }, task: { state: "completed", failureDetail: null } }));
  assert.equal(decision.action, "consume_result", "canonical completion outranks the interrupted step row");
});

test("A29: a step that never admitted a child is admitted exactly once after recovery", () => {
  const decision = classifyReplay(facts({ attempt: { taskId: null, outcome: null } }));
  assert.equal(decision.safety, "SAFE_TO_REPLAY");
  assert.equal(decision.action, "requeue_once");
  assert.equal(decision.category, "HOST_INTERRUPTED");
  assert.match(decision.reason, /admitted once/);
});

test("attempt ceiling: a step at its ceiling asks the user even when the failure was the Host restart", () => {
  const decision = classifyReplay(facts({ attempt: { taskId: null, outcome: null }, attemptsUsed: 6, maxAttempts: 6 }));
  assert.equal(decision.safety, "NOT_REPLAYABLE");
  assert.equal(decision.action, "ask_user");
  assert.equal(decision.category, "RECOVERY_AMBIGUOUS");
  assert.match(decision.reason, /ceiling/);
});

test("UNKNOWN tail: canonical facts that describe nothing replayable land on the user, never on a guess", () => {
  const decision = classifyReplay(facts({ attempt: { taskId: "t1", outcome: "stopped" }, task: null }));
  assert.equal(decision.safety, "UNKNOWN");
  assert.equal(decision.action, "ask_user");
  assert.equal(decision.category, "RECOVERY_AMBIGUOUS");
});

test("checkpoint validity is only consulted through the decision — a valid checkpoint never blocks a consume", () => {
  const decision = classifyReplay(facts({ attempt: { taskId: "t1", outcome: "interrupted" }, task: { state: "completed", failureDetail: null }, checkpoint: { boundary: "after_task_completion", valid: true } }));
  assert.equal(decision.action, "consume_result");
});