import type { AgentFailure, ReplaySafety } from "./agent-types.ts";

/**
 * §9 replay-safety classification for one step after a Host restart. Input is canonical store truth
 * only — the mission row, the child task rows and the checkpoint reference — never agent memory.
 * The decision tells the recovery walk what to do; UNKNOWN always lands on the user, never on a guess.
 */
export const REPLAY_ACTIONS = ["none", "consume_result", "verify_then_consume", "requeue_once", "ask_user", "fail_closed"] as const;
export type ReplayAction = (typeof REPLAY_ACTIONS)[number];
export type ReplayDecision = { safety: ReplaySafety; action: ReplayAction; category: AgentFailure | null; reason: string };

export type ReplayFacts = {
  stepId: string;
  scope: "read" | "write";
  /** Canonical outcome of the step's latest attempt after the restart walk. */
  attempt: { taskId: string | null; outcome: "completed" | "failed" | "stopped" | "interrupted" | "running" | null };
  /** Canonical child-task facts for that attempt's task, when it exists. */
  task: { state: "queued" | "waiting_for_approval" | "running" | "verifying" | "completed" | "failed" | "stopped" | null; failureDetail: string | null } | null;
  verify: { hasSpec: boolean; recorded: boolean; passed: boolean | null };
  checkpoint: { boundary: string | null; valid: boolean };
  attemptsUsed: number;
  maxAttempts: number;
};

export function classifyReplay(facts: ReplayFacts): ReplayDecision {
  // Fail closed on unreadable or structurally invalid checkpoints (A19): recovery never guesses.
  if (!facts.checkpoint.valid) return { safety: "UNKNOWN", action: "ask_user", category: "CHECKPOINT_INVALID", reason: "Checkpoint material is corrupt or unreadable; nothing replays automatically." };
  // A still-admitted child means admission already happened; re-submitting would create a duplicate
  // logical task — the step must not be re-queued (A21). The user decides.
  if (facts.task && (["queued", "waiting_for_approval", "running", "verifying"] as readonly string[]).includes(facts.task.state as string)) return { safety: "NOT_REPLAYABLE", action: "ask_user", category: "RECOVERY_AMBIGUOUS", reason: "A child task is still admitted for this step; replay would duplicate it." };
  // Completed child tasks are canonical truth: consume the result, never re-execute (A22, A23).
  if (facts.task?.state === "completed") {
    if (facts.verify.hasSpec && !facts.verify.recorded) return { safety: "VERIFY_BEFORE_REPLAY", action: "verify_then_consume", category: null, reason: "Task completed with an approved verification not yet recorded; re-running the check, not the write." };
    if (facts.verify.recorded && facts.verify.passed === false) return { safety: "NOT_REPLAYABLE", action: "ask_user", category: "VERIFICATION_FAILED", reason: "Independent verification failed before the restart; the effect is not repeated." };
    return { safety: "NOT_REPLAYABLE", action: "consume_result", category: null, reason: "Task completed before the restart; its canonical result is consumed without re-execution." };
  }
  const ceilingReached = facts.attemptsUsed >= facts.maxAttempts;
  if (ceilingReached) return { safety: "NOT_REPLAYABLE", action: "ask_user", category: "RECOVERY_AMBIGUOUS", reason: "The step's attempt ceiling was reached; the user decides." };
  // The attempt ran and died with the Host. Read-only work replays bounded; everything else asks (A12+A14).
  if (facts.attempt.outcome === "running" || facts.attempt.outcome === "interrupted" || facts.task?.state === "failed") {
    const hostRestartFailure = /host process restarted|cannot reattach|not resumed/i.test(facts.task?.failureDetail ?? "");
    if (facts.task && !hostRestartFailure) return { safety: "NOT_REPLAYABLE", action: "ask_user", category: "TASK_FAILED", reason: "The attempt failed before the restart for its own reason; replay is a retry decision." };
    if (facts.scope === "write") return { safety: "NOT_REPLAYABLE", action: "ask_user", category: "RECOVERY_AMBIGUOUS", reason: "A write-scope attempt was interrupted by the restart; whether its effect already happened is unknown, so nothing replays." };
    return { safety: "SAFE_TO_REPLAY", action: "requeue_once", category: "HOST_INTERRUPTED", reason: "Read-only attempt was interrupted by the restart; it is re-admitted once within the attempt ceiling." };
  }
  // No attempt ran yet (A29): admission exactly once.
  if (facts.attempt.taskId === null) return { safety: "SAFE_TO_REPLAY", action: "requeue_once", category: "HOST_INTERRUPTED", reason: "No child was admitted; the step is admitted once after recovery." };
  return { safety: "UNKNOWN", action: "ask_user", category: "RECOVERY_AMBIGUOUS", reason: "Canonical facts do not describe this step; the user decides." };
}