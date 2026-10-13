import type { TaskState } from "./types";

const NEXT: Record<TaskState, TaskState[]> = {
  queued: ["routing", "stopped"],
  routing: ["waiting_for_approval", "failed", "stopped"],
  waiting_for_approval: ["launching", "stopped"],
  launching: ["running", "failed", "stopped"],
  running: ["completed", "failed", "stopped", "paused", "waiting_for_input", "waiting_for_agent_approval", "verifying"],
  verifying: ["completed", "failed", "stopped", "running"], // M-A-3 T3 §24: an escalated verification re-executes at higher effort or on an alternate model; the machine gains this one additive transition.
  waiting_for_agent_approval: ["running", "failed", "stopped"],
  waiting_for_input: ["running", "stopped", "failed"],
  paused: ["running", "stopped"],
  completed: [],
  failed: [],
  stopped: [],
};

export function canTransition(from: TaskState, to: TaskState) {
  return NEXT[from].includes(to);
}
