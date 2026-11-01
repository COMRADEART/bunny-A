import type { OrchTask, TruthState } from "../../lib/orch/types.ts";
import { taskStatus, UNCERTAIN_LABEL } from "../../lib/bunny-host/presentation.ts";

/**
 * Agent-pill truth model (M2 Sprint: agent-visual truthfulness lock).
 *
 * The notch's active row must only ever show words the Host itself knows:
 * - `truthState` (the observable Host truth state, MA4-S3-T3) verbatim; or
 * - the canonical `taskStatus()` label for the task's own state.
 *
 * No pill may ever fall back to an invented state word. "Working" is truthful
 * only when the Host truth state says so - not as a catch-all default.
 */

export const MAX_ACTIVE_PILLS = 3;

export type AgentPillTone = "neutral" | "testing" | "reviewing" | "approval" | "paused";

export type AgentPill = {
  id: string;
  /** State word: either the exact TruthState, or the canonical taskStatus label. */
  label: string;
  tone: AgentPillTone;
  detail: string;
};

export type AgentPillRow = {
  /** Every active task the Host reports, before the notch cap. */
  total: number;
  pills: AgentPill[];
  overflow: number;
};

/** Visual continuity: the two tones the notch shipped with, plus approval/paused. */
export const PILL_TONE_BACKGROUND: Record<AgentPillTone, string> = {
  neutral: "rgba(255, 255, 255, 0.1)",
  testing: "rgba(79, 140, 255, 0.2)",
  reviewing: "rgba(147, 83, 211, 0.2)",
  approval: "rgba(235, 178, 80, 0.22)",
  paused: "rgba(255, 255, 255, 0.16)",
};

export function taskPill(task: OrchTask): AgentPill {
  const truth: TruthState | null | undefined = task.truthState;
  const label = truth ?? taskStatus(task).label;
  return {
    id: task.id,
    label,
    tone: pillTone(task, label),
    detail: `${task.title}: ${label}`,
  };
}

function pillTone(task: Pick<OrchTask, "state" | "truthState">, label: string): AgentPillTone {
  const truth = task.truthState;
  if (truth === "Testing") return "testing";
  if (truth === "Reviewing") return "reviewing";
  if (truth === "Awaiting approval") return "approval";
  if (truth === "Paused") return "paused";
  if (label === "Approval required" || label === "Waiting for user") return "approval";
  if (label === "Paused") return "paused";
  return "neutral";
}

export function activeAgentPills(tasks: OrchTask[], max: number = MAX_ACTIVE_PILLS): AgentPillRow {
  const pills = tasks.map(taskPill);
  return {
    total: pills.length,
    pills: pills.slice(0, Math.max(0, max)),
    overflow: Math.max(0, pills.length - Math.max(0, max)),
  };
}

/**
 * Notch axis rule, mirroring install/Bunny-Island.Placement.ps1:
 * top (center) docks are horizontal; left/right docks are vertical and place
 * the agent row above the main status region.
 */
export type NativeDockPosition = "left" | "center" | "right";

export function agentRowLayout(position: NativeDockPosition): {
  direction: "row" | "column";
  vertical: boolean;
  axisClass: string;
} {
  const vertical = position === "left" || position === "right";
  return {
    direction: vertical ? "column" : "row",
    vertical,
    axisClass: vertical ? "notch-vertical-top" : "notch-horizontal-left",
  };
}

/** Only never-invented words may leave this module. */
const KNOWN_TASK_LABELS = [
  UNCERTAIN_LABEL,
  "Queued",
  "Routing",
  "Approval required",
  "Provider starting",
  "Provider turn finished",
  "Provider turn running",
  "Waiting for user",
  "Bunny verifying",
  "Paused",
  "Task completed",
  "Task failed",
  "Task stopped",
];

const KNOWN_TRUTH_STATES = [
  "Proposed",
  "Awaiting approval",
  "Queued",
  "Planning",
  "Working",
  "Testing",
  "Reviewing",
  "Paused",
  "Completed",
  "Failed",
  "Cancelled",
  "Uncertain",
] as const;

export function isKnownPillLabel(label: string): boolean {
  return (KNOWN_TASK_LABELS as readonly string[]).includes(label) || (KNOWN_TRUTH_STATES as readonly string[]).includes(label);
}
