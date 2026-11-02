/**
 * E2b: the cross-surface state vocabulary contract. Every Bunny A surface draws agent state from one of these pinned
 * vocabularies; per-platform renderers own their pixels, never their names. The parity test parses the C# sources
 * (native/windows/BunnyA/Services/NotchModel.cs, NotchVoice.cs) and compares both directions, so a rename on one
 * surface cannot silently desynchronize the others. Additive by design — no runtime enum is rewritten.
 */
import { PRESENTATION_STATES, type PresentationState } from "../../lib/bunny-host/personal-agents.ts";
import { COMPANION_STATES } from "../../lib/bunny-host/voice/voice-companion.ts";

/** The Windows notch's 17 agent states (NotchModel.cs, enum NotchState) in enum order. */
export const NOTCH_STATES = [
  "Idle", "Thinking", "Planning", "Executing", "Delegating", "WaitingForTool", "WaitingForApproval", "WaitingForUser",
  "Queued", "Paused", "Recovering", "NeedsCheck", "Completed", "Failed", "Canceled", "Unknown", "Disconnected",
] as const;
export type NotchStateName = (typeof NOTCH_STATES)[number];

/** The notch's voice pill states (NotchVoice.cs) in enum order; the disconnected overlay is the C# Disconnected constant. */
export const NOTCH_VOICE_STATES = [
  "OFF", "ON", "ARMING", "LISTENING", "RECOGNIZING", "THINKING", "SPEAKING", "INTERRUPTING", "INTERRUPTED", "MUTED",
  "DEVICE_UNAVAILABLE", "ERROR",
] as const;

/** The character pose slots the web engine derives (character-model.ts STATE_POSE values). */
export const POSE_SLOTS = ["idle", "research", "coding", "testing", "complete"] as const;
export type PoseSlotName = (typeof POSE_SLOTS)[number];

/** The basis facts the bridge may consult (the presentation projection's { kind, role, team } fields, as read by the notch). */
export type PresentationBasisFacts = { kind: string | null; role: string | null; team: boolean; pendingApprovals: number; taskClass?: string | null };

/**
 * The verified bridge: which notch state a web presentation state renders as on the Windows notch (NotchModel.cs
 * FromPresentation), and the pose slot it drives in the character engine (character-model.ts STATE_POSE).
 */
export const PRESENTATION_BRIDGE: Record<PresentationState, { notch: NotchStateName; pose: PoseSlotName }> = {
  UNASSIGNED: { notch: "Idle", pose: "idle" },
  IDLE: { notch: "Idle", pose: "idle" },
  PLANNING: { notch: "Planning", pose: "idle" },
  RESEARCHING: { notch: "Executing", pose: "research" },
  CODING: { notch: "Executing", pose: "coding" },
  TESTING: { notch: "Executing", pose: "testing" },
  FILE_WORK: { notch: "Executing", pose: "coding" },
  ACTIVE: { notch: "Executing", pose: "idle" },
  VERIFYING: { notch: "Executing", pose: "testing" },
  WAITING: { notch: "Queued", pose: "idle" },
  WAITING_FOR_USER: { notch: "WaitingForUser", pose: "idle" },
  PAUSED: { notch: "Paused", pose: "idle" },
  COMPLETED: { notch: "Completed", pose: "complete" },
  VERIFIED: { notch: "Completed", pose: "complete" },
  FAILED: { notch: "Failed", pose: "idle" },
  STOPPED: { notch: "Canceled", pose: "idle" },
  RECOVERING: { notch: "Recovering", pose: "idle" },
  UNKNOWN: { notch: "Unknown", pose: "idle" },
  OFFLINE: { notch: "Disconnected", pose: "idle" },
};

/** Pending approval outranks everything, exactly as the notch computes it. */
export function presentationNotchState(state: PresentationState, basis: PresentationBasisFacts): NotchStateName {
  if (basis.pendingApprovals > 0) return "WaitingForApproval";
  const bridged = PRESENTATION_BRIDGE[state];
  // A coordinator whose current fact is a member's team step delegates; it is not doing the work itself.
  if (basis.team && basis.kind === "team-step" && basis.role !== null && basis.role !== "coordinator" && bridged.notch === "Executing") return "Delegating";
  if (state === "UNKNOWN" && !bridged) return "Unknown";
  return bridged.notch;
}

/** The verified ptask bridge (NotchModel.cs FromPtask), with its two context rules carried as data. */
export type PtaskFacts = { state: string; blockedCode: string | null; hasPendingAction: boolean; activity: string | null };

export function ptaskNotchState(task: PtaskFacts): NotchStateName {
  switch (task.state) {
    case "QUEUED":
    case "VALIDATED":
    case "CREATED":
      return task.blockedCode === "MODEL_UNAVAILABLE" || task.blockedCode === "RESOURCES_UNAVAILABLE" ? "WaitingForTool" : "Queued";
    case "AWAITING_APPROVAL":
      return "WaitingForApproval";
    case "RUNNING":
    case "RESUMING":
      return task.hasPendingAction || task.activity === "Waiting for permission" ? "WaitingForApproval" : "Executing";
    case "PAUSED":
      return "Paused";
    case "UNCERTAIN":
      return "NeedsCheck";
    case "COMPLETED":
      return "Completed";
    case "FAILED":
      return "Failed";
    case "CANCELLED":
      return "Canceled";
    default:
      return "Unknown";
  }
}

/**
 * The persistent visual activity gate, shared by every surface: only these notch states animate (NotchModel.IsActive);
 * a chip that is idle, waiting, finished or offline is still.
 */
export const NOTCH_ACTIVE_STATES = ["Thinking", "Planning", "Executing", "Delegating"] as const;
export function notchStateIsActive(state: NotchStateName): boolean {
  return (NOTCH_ACTIVE_STATES as readonly unknown[]).includes(state);
}
/** The attention gate: these states demand a real human decision. */
export const NOTCH_ATTENTION_STATES = ["WaitingForApproval", "WaitingForUser", "NeedsCheck"] as const;
export function notchStateNeedsAttention(state: NotchStateName): boolean {
  return (NOTCH_ATTENTION_STATES as readonly unknown[]).includes(state);
}

/** Re-exported so one import site covers the whole contract; the parity test locks each pinned list to its source. */
export { PRESENTATION_STATES, COMPANION_STATES };