import type { CapabilityRun, FailureCategory, MissionLimits, MissionProgress, MissionState, MissionStep, StepState } from "./types.ts";

const MISSION_NEXT: Record<MissionState, MissionState[]> = {
  draft: ["planning", "stopped"],
  planning: ["waiting_for_approval", "failed", "stopped"],
  waiting_for_approval: ["ready", "planning", "stopped"],
  ready: ["running", "stopped"],
  running: ["waiting_for_user", "verifying", "completed", "failed", "stopped"],
  waiting_for_user: ["running", "planning", "failed", "stopped"],
  verifying: ["running", "completed", "failed", "stopped"],
  // A failed mission can be explicitly retried (re-armed under its still-valid authorization) or replanned.
  failed: ["ready", "planning", "stopped"],
  completed: [],
  stopped: [],
};
const STEP_NEXT: Record<StepState, StepState[]> = {
  pending: ["ready", "blocked", "skipped", "stopped"],
  ready: ["running", "waiting_for_approval", "blocked", "stopped"],
  waiting_for_approval: ["ready", "running", "failed", "stopped"],
  running: ["verifying", "completed", "failed", "stopped", "waiting_for_approval"],
  verifying: ["completed", "failed", "stopped"],
  failed: ["ready"],
  blocked: ["pending", "stopped"],
  completed: [],
  skipped: [],
  stopped: [],
};

export const MISSION_TERMINAL: MissionState[] = ["completed", "stopped"];
export const MISSION_ACTIVE: MissionState[] = ["ready", "running", "waiting_for_user", "verifying"];
export const STEP_DONE: StepState[] = ["completed", "skipped"];
export const STEP_TERMINAL: StepState[] = ["completed", "failed", "skipped", "stopped", "blocked"];

export function canMissionTransition(from: MissionState, to: MissionState) { return MISSION_NEXT[from].includes(to); }
export function canStepTransition(from: StepState, to: StepState) { return STEP_NEXT[from].includes(to); }
export function assertMissionTransition(from: MissionState, to: MissionState) {
  if (from !== to && !canMissionTransition(from, to)) throw new Error(`Invalid mission transition ${from} → ${to}`);
}
export function assertStepTransition(from: StepState, to: StepState) {
  if (from !== to && !canStepTransition(from, to)) throw new Error(`Invalid step transition ${from} → ${to}`);
}

/** Rejects cycles, unknown dependencies, duplicate ids and graphs beyond the configured bounds. */
export function validateGraph(steps: Pick<MissionStep, "id" | "dependsOn">[], limits: Pick<MissionLimits, "maxSteps">): string | null {
  if (!steps.length) return "A mission needs at least one step.";
  if (steps.length > limits.maxSteps) return `Plan has ${steps.length} steps; the limit is ${limits.maxSteps}.`;
  const ids = new Set<string>();
  for (const step of steps) { if (ids.has(step.id)) return `Duplicate step id ${step.id}.`; ids.add(step.id); }
  for (const step of steps) for (const dep of step.dependsOn) {
    if (!ids.has(dep)) return `Step ${step.id} depends on unknown step ${dep}.`;
    if (dep === step.id) return `Step ${step.id} depends on itself.`;
  }
  // Kahn's algorithm: anything left over sits on a cycle.
  const indegree = new Map(steps.map((step) => [step.id, step.dependsOn.length]));
  const queue = steps.filter((step) => !step.dependsOn.length).map((step) => step.id);
  let seen = 0;
  while (queue.length) {
    const id = queue.shift()!; seen++;
    for (const step of steps) if (step.dependsOn.includes(id)) { const left = indegree.get(step.id)! - 1; indegree.set(step.id, left); if (!left) queue.push(step.id); }
  }
  return seen === steps.length ? null : "Plan contains a dependency cycle.";
}

/** Pending steps whose dependencies all completed; these may run now (subject to concurrency and locks). */
export function readySteps(steps: MissionStep[]): MissionStep[] {
  const done = new Set(steps.filter((step) => STEP_DONE.includes(step.state)).map((step) => step.id));
  return steps.filter((step) => (step.state === "pending" || step.state === "ready") && step.dependsOn.every((dep) => done.has(dep)));
}

/** Every step that transitively depends on a failed or stopped step; they can never run as planned. */
export function blockedBy(steps: MissionStep[], failedId: string): string[] {
  const blocked = new Set<string>(); const queue = [failedId];
  while (queue.length) {
    const id = queue.shift()!;
    for (const step of steps) if (step.dependsOn.includes(id) && !blocked.has(step.id)) { blocked.add(step.id); queue.push(step.id); }
  }
  return [...blocked];
}

/**
 * Progress comes only from graph state. Weighted progress is used only when every step carries an
 * explicit weight; otherwise it is completed/total step counts. Elapsed time never contributes.
 */
export function missionProgress(steps: Pick<MissionStep, "state" | "weight">[]): MissionProgress {
  const completed = steps.filter((step) => STEP_DONE.includes(step.state)).length;
  const failed = steps.filter((step) => step.state === "failed" || step.state === "blocked").length;
  const running = steps.filter((step) => step.state === "running" || step.state === "verifying").length;
  if (steps.length && steps.every((step) => typeof step.weight === "number" && step.weight > 0)) {
    const totalWeight = steps.reduce((sum, step) => sum + step.weight!, 0);
    const completedWeight = steps.filter((step) => STEP_DONE.includes(step.state)).reduce((sum, step) => sum + step.weight!, 0);
    return { kind: "weighted", completedWeight, totalWeight, completed, total: steps.length, failed, running };
  }
  return { kind: "steps", completed, total: steps.length, failed, running };
}

export type RetryVerdict = { retry: boolean; reroute: boolean; waitForUser: boolean; reason: string };
/**
 * Category-specific retry policy. Retries are bounded per step and per mission; a user stop or a
 * denied permission is never retried automatically.
 */
export function retryVerdict(category: FailureCategory, attempts: number, maxRetries: number, missionRetries: number, missionMaxRetries: number, access?: "read" | "write"): RetryVerdict {
  const budgetLeft = attempts <= maxRetries && missionRetries < missionMaxRetries;
  const no = (reason: string, waitForUser = false): RetryVerdict => ({ retry: false, reroute: false, waitForUser, reason });
  // M-A-3 T13.3 Gate F (§18): a write step whose provider ran out of quota may have left side effects; never reroute it blindly.
  if (category === "provider_rate_limited" && access === "write") return no("The provider's quota ran out during write work. Paused at the last completed step; review the workspace before retrying or choosing another account.", true);
  switch (category) {
    case "provider_write_paused": return no("The connection kept failing during write work, so the Host paused instead of switching providers. Review the workspace before retrying or choosing another account.", true);
    case "user_stopped": return no("Stopped by the user; never retried automatically.");
    case "permission_required": return no("Waiting for the user to allow or deny the action.", true);
    case "permission_denied": return no("The user denied the action.");
    case "budget_exceeded": return no("Mission budget exhausted.", true);
    case "dependency_failed": return no("A dependency failed; this step is blocked.");
    case "invalid_plan": return no("The plan is invalid; replan instead.");
    case "host_restart": return no("The Host restarted; the old provider stream cannot be resumed. A fresh retry needs the user.", true);
    case "host_failure": return no("An unexpected Host boundary failed; automatic retry is refused.", true);
    case "workspace_conflict": return budgetLeft ? { retry: true, reroute: false, waitForUser: false, reason: "Workspace busy; retry after the lock clears." } : no("Workspace stayed locked.", true);
    case "provider_rate_limited":
    case "provider_unavailable": return budgetLeft ? { retry: true, reroute: true, waitForUser: false, reason: "Reroute to another eligible provider." } : no("No retry budget left for rerouting.", true);
    case "verification_failed": return budgetLeft ? { retry: true, reroute: false, waitForUser: false, reason: "Verification failed; repair attempt." } : no("Verification kept failing.", true);
    case "timeout":
    case "provider_failed":
    case "capability_failed": return budgetLeft ? { retry: true, reroute: category === "provider_failed", waitForUser: false, reason: "Bounded retry." } : no("Retry limit reached.");
    case "capability_unavailable": return no("Capability unavailable on this Host.");
  }
}

/**
 * M-A-3 T13.3 N-C: duplicate protection the Host itself enforces. Only these may replay after an uncertain outcome; a
 * plan's, step's or caller's claim of idempotency never counts. Today: filesystem.write under a pre-image guard (a
 * landed write is detected and reported as applied, a changed file is refused).
 */
export function enforcedIdempotent(action: string, params: Record<string, unknown>): boolean {
  return action === "filesystem.write" && typeof params.expectBeforeSha256 === "string";
}

/** Why a failed capability run's outcome is unknown: it started, it was not read-only, and nothing enforces dedup. */
export function uncertainRun(run: Pick<CapabilityRun, "uncertain" | "risk" | "action" | "params" | "status" | "summary"> | null): string | null {
  if (!run?.uncertain || run.risk === "READ" || enforcedIdempotent(run.action, run.params)) return null;
  return `OUTCOME_UNCERTAIN: ${run.action} started and then ${run.status === "timeout" ? "timed out" : "failed"} (${run.summary.slice(0, 200)}), so it may already have taken effect.`;
}

/** Classifies a finished child task's error text into a mission failure category. */
export function classifyTaskFailure(error: string | null | undefined, state: string): FailureCategory {
  const text = (error ?? "").toLowerCase();
  if (state === "stopped") return /runtime limit/.test(text) ? "timeout" : "user_stopped";
  if (/host process restarted|cannot reattach/.test(text)) return "host_restart";
  if (/verification failed/.test(text)) return "verification_failed";
  // T13.3 N-B: the Host's own write pause wins over the transport error text it wraps.
  if (/\bwrite_pause\b/.test(text)) return "provider_write_paused";
  if (/rate.?limit|usage limit|quota|\b429\b/.test(text)) return "provider_rate_limited";
  if (/no ready executor|not eligible|not installed|needs sign-in|not signed in|unavailable/.test(text)) return "provider_unavailable";
  return "provider_failed";
}
