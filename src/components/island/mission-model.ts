import type { OrchTask } from "../../lib/orch/types.ts";
import type { MissionProgress, MissionSnapshot, MissionState, MissionStep, MissionView, StepState } from "../../lib/bunny-missions/types.ts";
import { batchButtonLabel, batchOfferLines, batchStatusLabel, targetLabelOf } from "../../lib/bunny-missions/batch-labels.ts";
import { finitePlan } from "./ui-model.ts";
import { publicEventLabel, UNCERTAIN_LABEL } from "../../lib/bunny-host/presentation.ts";

/** Missions the Bar treats as live: they get the expanded strip. */
export const LIVE_MISSION: MissionState[] = ["planning", "waiting_for_approval", "ready", "running", "waiting_for_user", "verifying"];
export const STEP_GLYPH: Record<StepState, string> = {
  completed: "✓", skipped: "–", running: "●", verifying: "●", ready: "○", pending: "○", waiting_for_approval: "!", failed: "✕", blocked: "⊘", stopped: "■",
};
export const MISSION_LABEL: Record<MissionState, string> = {
  draft: "Draft", planning: "Planning", waiting_for_approval: "Needs approval", ready: "Approved", running: "Running", waiting_for_user: "Needs you",
  verifying: "Verifying", completed: "Completed", failed: "Failed", stopped: "Stopped",
};

/** The mission the Bar should show: one that needs the user first, then a running one, then the newest live one. */
export function focusMission(snapshot: MissionSnapshot | null | undefined): MissionView | null {
  if (!snapshot?.enabled) return null;
  const live = snapshot.missions.filter((mission) => LIVE_MISSION.includes(mission.state));
  return live.find((mission) => mission.state === "waiting_for_user" || mission.state === "waiting_for_approval")
    ?? live.find((mission) => mission.state === "running" || mission.state === "verifying")
    ?? live[0] ?? null;
}
/** A mission that ended within `windowMs`, for the short completion state before the Bar collapses. */
export function justFinished(snapshot: MissionSnapshot | null | undefined, now: number, windowMs = 8000): MissionView | null {
  if (!snapshot?.enabled || !now) return null;
  return snapshot.missions.find((mission) => ["completed", "failed", "stopped"].includes(mission.state) && mission.finishedAt != null && now - mission.finishedAt >= 0 && now - mission.finishedAt < windowMs) ?? null;
}

/** "5 / 8 steps" — counts only; weighted only when the Host reported explicit weights. Never time-based. */
export function progressLabel(progress: MissionProgress): string {
  if (progress.kind === "weighted") return `${progress.completedWeight} / ${progress.totalWeight} weighted · ${progress.completed} / ${progress.total} steps`;
  return `${progress.completed} / ${progress.total} steps`;
}
export function progressFraction(progress: MissionProgress): number | null {
  const completed=progress.kind === "weighted" ? progress.completedWeight : progress.completed;
  const total=progress.kind === "weighted" ? progress.totalWeight : progress.total;
  return Number.isFinite(total) && Number.isFinite(completed) && total>0 && completed>=0 && completed<=total ? completed/total : null;
}

export type AgentRow = { stepId: string; role: string; state: StepState; glyph: string; activity: string; provider: string | null; deterministic: boolean };
/** Agent indicators for the Bar: running and attention-worthy steps first, at most `max` rows plus a "+N" count. */
export function agentRows(mission: MissionView, tasks: OrchTask[], max = 3): { rows: AgentRow[]; more: number } {
  const order: StepState[] = ["waiting_for_approval", "running", "verifying", "failed", "ready", "pending", "blocked", "completed", "skipped", "stopped"];
  const rows = mission.steps.map((step) => {
    const task = step.taskId ? tasks.find((item) => item.id === step.taskId) ?? null : null;
    return { stepId: step.id, role: step.role, state: step.state, glyph: STEP_GLYPH[step.state], activity: stepActivity(step, task), provider: task?.provider ?? step.accounting.provider ?? null, deterministic: step.executor.kind !== "model" };
  });
  // Keep plan order but surface what needs the user when the list is truncated.
  const visible = rows.length <= max ? rows : [...rows].sort((a, b) => order.indexOf(a.state) - order.indexOf(b.state)).slice(0, max).sort((a, b) => rows.indexOf(a) - rows.indexOf(b));
  return { rows: visible, more: Math.max(0, rows.length - visible.length) };
}

/** Latest normalized activity: the child task's own event for model steps, the capability/skill for deterministic ones. */
export function stepActivity(step: MissionStep, task: OrchTask | null): string {
  if (step.state === "waiting_for_approval") return "Needs your permission";
  if (step.state === "failed" && step.reconciliation?.required) return UNCERTAIN_LABEL;
  if (step.state === "failed") return ["host_restart","host_failure"].includes(step.failure?.category ?? "") ? "Interrupted · retry available" : step.failure ? `Failed: ${step.failure.category.replaceAll("_", " ")}` : "Failed";
  if (step.state === "blocked") return "Blocked by a failed dependency";
  if (step.state === "stopped") return "Stopped";
  if (step.state === "skipped") return "Skipped";
  if (step.state === "completed") return step.result?.verified ? "Step completed · verified by Bunny" : "Step completed · not independently verified";
  if (step.state === "pending" || step.state === "ready") return step.evidence.some((line) => line.startsWith("waiting for workspace")) ? "Waiting for the workspace" : "Waiting";
  if (step.state === "verifying") return "Bunny is checking the result";
  if (step.executor.kind === "capability") return `Running ${step.executor.action}`;
  if (step.executor.kind === "skill") return `Running skill ${step.executor.skillId}`;
  return task?.latestEvent ? publicEventLabel(task.latestEvent.type) : "Provider turn running";
}

export type AgentDetail = {
  role: string; objective: string; state: StepState; provider: string | null; model: string | null; capability: string | null; activity: string;
  /** Determinate only when the provider published a finite plan. */
  progress: { completed: number; total: number } | null; startedAt: number | null; finishedAt: number | null; artifacts: number; dependencies: string[];
  verification: string[]; failure: string | null; attempts: number; taskId: string | null; requestId: string | null;
};
export function agentDetail(mission: MissionView, stepId: string, tasks: OrchTask[]): AgentDetail | null {
  const step = mission.steps.find((item) => item.id === stepId);
  if (!step) return null;
  const task = step.taskId ? tasks.find((item) => item.id === step.taskId) ?? null : null;
  const plan = step.executor.kind === "model" ? finitePlan(task?.progress) : null;
  return {
    role: step.role, objective: step.objective, state: step.state,
    provider: task?.provider ?? step.accounting.provider ?? null, model: task?.model ?? step.accounting.model ?? null,
    capability: step.executor.kind === "capability" ? step.executor.action : step.executor.kind === "skill" ? `skill ${step.executor.skillId}` : null,
    activity: stepActivity(step, task),
    progress: plan ? { completed: plan.completed, total: plan.total } : null,
    startedAt: step.startedAt, finishedAt: step.finishedAt,
    artifacts: mission.artifacts.filter((artifact) => artifact.stepId === step.id).length,
    dependencies: step.dependsOn.map((dep) => mission.steps.find((item) => item.id === dep)?.role ?? "unknown"),
    verification: step.result?.verification ?? [], failure: step.failure ? `${step.failure.category.replaceAll("_", " ")}: ${step.failure.detail}` : null,
    attempts: step.attempts.length, taskId: step.taskId, requestId: step.pendingRequestId,
  };
}
export function duration(from: number | null, to: number | null, now: number): string {
  if (from == null || !now) return "—";
  const seconds = Math.max(0, Math.floor(((to ?? now) - from) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
/** One-line scope for the approval card, from what the Host says the mission will request. */
export function scopeSummary(mission: MissionView): string[] {
  const scope = mission.requestedScope;
  if (!scope) return [];
  return [
    `Folder: ${scope.projectRoots.join(", ")}${scope.filesystem.write.length ? " (read & write)" : " (read only)"}`,
    scope.providers.execution ? `AI agents: up to ${scope.budget.maxExternalModelCalls} cloud call${scope.budget.maxExternalModelCalls === 1 ? "" : "s"}${scope.providers.localOnly ? " · local only" : ""}` : "No AI model calls",
    scope.providers.execution ? `Agent steps: ${mission.steps.filter((step) => step.executor.kind === "model" && step.state !== "completed").map((step) => `${step.role} (${step.scope.access === "read" ? "read only" : "write & shell capable"})`).join(", ")}` : null,
    scope.providers.sessions ? `Provider sessions: up to ${scope.providers.sessions.maxSessions}, including retries` : null,
    scope.providers.execution ? "Agent file and command actions use provider permissions. Read steps cannot write; write steps can edit files and run shell commands. External effects inside an agent session are governed by the provider; Bunny capability actions ask separately." : null,
    scope.terminal.enabled ? `Commands: ${scope.terminal.commands.join(", ")}` : null,
    scope.git.actions.length ? `Git: ${scope.git.actions.join(", ")}` : null,
    scope.browser.enabled ? "Bunny browser (isolated profile)" : null,
    scope.computer.enabled ? "Desktop control (UI Automation)" : null,
    `Time limit: ${Math.round(scope.budget.maxRuntimeMs / 60_000)} min · always asks for ${scope.alwaysAsk.map((risk) => risk.toLowerCase().replaceAll("_", " ")).join(" and ")}`,
  ].filter((line): line is string => !!line);
}

export function permissionLabel(mission: MissionView, stepId: string): string {
  return mission.steps.find((step) => step.id === stepId)?.executor.kind === "skill" ? "Allow this skill run" : "Allow once";
}

/** Re-exports so the components keep one import surface for batch display truth. */
export { batchButtonLabel, batchOfferLines, batchStatusLabel, targetLabelOf };
