import type { JsonValue, MissionState, StepState } from "../bunny-missions/types.ts";

/**
 * M-A-3 T4 — durable Agent runtime vocabulary. Agents own continuity: durable identity, checkpoints,
 * pause/resume/stop, recovery. Every execution choice stays with MissionManager (workflow), TaskManager
 * (task lifecycle) and BunnyRouter (model selection); this module only classifies and validates.
 */

export const AGENT_STATES = ["CREATED", "PLANNING", "RUNNING", "WAITING_FOR_USER", "WAITING_FOR_DEPENDENCY", "PAUSED", "VERIFYING", "COMPLETED", "FAILED", "STOPPED", "INTERRUPTED"] as const;
export type AgentState = (typeof AGENT_STATES)[number];
/** COMPLETED, FAILED and STOPPED never exit: no host restart, recovery walk or resume revives them (§12, A09/A22). */
export const AGENT_NEXT: Record<AgentState, AgentState[]> = {
  // M-A-3 T11: a team member can wait on other Agents straight from creation or plan review.
  CREATED: ["PLANNING", "RUNNING", "WAITING_FOR_USER", "WAITING_FOR_DEPENDENCY", "PAUSED", "FAILED", "STOPPED", "INTERRUPTED"],
  PLANNING: ["RUNNING", "WAITING_FOR_USER", "WAITING_FOR_DEPENDENCY", "VERIFYING", "PAUSED", "FAILED", "STOPPED", "INTERRUPTED"],
  RUNNING: ["VERIFYING", "WAITING_FOR_DEPENDENCY", "WAITING_FOR_USER", "PAUSED", "COMPLETED", "FAILED", "STOPPED", "INTERRUPTED"],
  WAITING_FOR_DEPENDENCY: ["RUNNING", "VERIFYING", "WAITING_FOR_USER", "PAUSED", "COMPLETED", "FAILED", "STOPPED", "INTERRUPTED"],
  VERIFYING: ["RUNNING", "WAITING_FOR_DEPENDENCY", "WAITING_FOR_USER", "PAUSED", "COMPLETED", "FAILED", "STOPPED", "INTERRUPTED"],
  WAITING_FOR_USER: ["PLANNING", "RUNNING", "VERIFYING", "WAITING_FOR_DEPENDENCY", "PAUSED", "COMPLETED", "FAILED", "STOPPED", "INTERRUPTED"],
  PAUSED: ["PLANNING", "RUNNING", "VERIFYING", "WAITING_FOR_DEPENDENCY", "WAITING_FOR_USER", "COMPLETED", "FAILED", "STOPPED", "INTERRUPTED"],
  INTERRUPTED: ["PLANNING", "RUNNING", "VERIFYING", "WAITING_FOR_DEPENDENCY", "WAITING_FOR_USER", "COMPLETED", "FAILED", "STOPPED"],
  COMPLETED: [], FAILED: [], STOPPED: [],
};
export function agentCanTransition(from: AgentState, to: AgentState): boolean { return AGENT_NEXT[from]?.includes(to) ?? false; }

/** §10 failure taxonomy — the Agent's own categories, mapped from canonical mission/task facts. */
export const AGENT_FAILURES = ["TASK_FAILED", "ROUTING_EXHAUSTED", "AUTHORITY_LOST", "CHECKPOINT_INVALID", "RECOVERY_AMBIGUOUS", "DEPENDENCY_FAILED", "VERIFICATION_FAILED", "HOST_INTERRUPTED", "STOP_REQUESTED"] as const;
export type AgentFailure = (typeof AGENT_FAILURES)[number];

/** §9 replay-safety classification. UNKNOWN is always treated as NOT_REPLAYABLE downstream. */
export const REPLAY_SAFETY = ["SAFE_TO_REPLAY", "VERIFY_BEFORE_REPLAY", "NOT_REPLAYABLE", "UNKNOWN"] as const;
export type ReplaySafety = (typeof REPLAY_SAFETY)[number];

/** §8 checkpoint boundaries, in the order they can occur along one step attempt. */
export const CHECKPOINT_BOUNDARIES = ["before_task_admission", "after_task_completion", "after_verification", "before_waiting_for_user", "after_approval_decision", "before_provider_reroute", "after_artifact_commit", "before_terminal_state", "before_capability_admission", "after_capability_completion", "before_application_handoff"] as const;
export type CheckpointBoundary = (typeof CHECKPOINT_BOUNDARIES)[number];

/**
 * §25 event vocabulary. Structural collision note: `bunny-host/events.ts` already exports a provider
 * ACTIVITY vocabulary under the name AGENT_EVENTS (agent.started/… typed to a task stream); those rows
 * always carry a taskId. Lifecycle rows always carry taskId=null plus a missionId and a
 * kind:"agent-lifecycle" detail marker, so the two surfaces stay distinct at projection time.
 */
export const AGENT_LIFECYCLE_EVENTS = ["agent.created", "agent.started", "agent.state_changed", "agent.task_started", "agent.task_completed", "agent.task_failed", "agent.checkpointed", "agent.waiting_for_user", "agent.paused", "agent.resumed", "agent.interrupted", "agent.recovered", "agent.completed", "agent.failed", "agent.stopped"] as const;
export type AgentLifecycleEvent = (typeof AGENT_LIFECYCLE_EVENTS)[number];

const LIFECYCLE_LABELS: Record<AgentLifecycleEvent, string> = {
  "agent.created": "Agent created",
  "agent.started": "Agent started",
  "agent.state_changed": "Agent state changed",
  "agent.task_started": "Agent task started",
  "agent.task_completed": "Agent task completed",
  "agent.task_failed": "Agent task failed",
  "agent.checkpointed": "Agent checkpointed",
  "agent.waiting_for_user": "Agent waiting for user",
  "agent.paused": "Agent paused",
  "agent.resumed": "Agent resumed",
  "agent.interrupted": "Agent interrupted",
  "agent.recovered": "Agent recovered",
  "agent.completed": "Agent completed",
  "agent.failed": "Agent failed",
  "agent.stopped": "Agent stopped",
};
/** Honest label for an agent-lifecycle event (kind:"agent-lifecycle" rows only). */
export function agentLifecycleLabel(type: string): string | null { return (AGENT_LIFECYCLE_EVENTS as readonly string[]).includes(type) ? LIFECYCLE_LABELS[type as AgentLifecycleEvent] : null; }

export type AgentProfile = {
  id: string;
  name: string;
  missionId: string | null;
  createdAt: number;
  createdBy: string;
  /** Durable flags; state derivation consults them, never infers them (§7 pause, §12 stop). */
  pausedAt: number | null;
  stoppedAt: number | null;
  failure: { category: AgentFailure; detail: string } | null;
  completedAt: number | null;
  updatedAt: number;
  /** M-A-3 T11: membership of a Team Mission. The Coordinator has role "coordinator" and coordinatorId null. */
  team?: { missionId: string; role: import("../bunny-missions/team.ts").TeamRole; coordinatorId: string | null };
};

export type AgentRun = {
  id: string;
  agentId: string;
  generation: number;
  state: AgentState;
  startedAt: number | null;
  endedAt: number | null;
  endReason: string | null;
  /** Set when this run continues work from an interrupted predecessor. */
  resumedFromRunId: string | null;
  resumedFromCheckpointId: string | null;
};

export type AgentCheckpoint = {
  id: string;
  agentId: string;
  runId: string;
  boundary: CheckpointBoundary;
  at: number;
  /** Monotonic checkpoint ordinal within a run. */
  revision: number;
  replaySafety: ReplaySafety;
  /** Short fixed-phrase summary; no free provider text. */
  summary: string;
  /** Canonical references only — ids and states already persisted by their owners. */
  refs: Record<string, string | number | boolean | null>;
  /** Whitelisted numeric/boolean/enum facts captured at the boundary (counts, attempt ordinals). */
  facts: Record<string, JsonValue>;
};

/** Canonical row view the store returns; `record` round-trips through JSON (parse fails closed on corruption). */
export type AgentRecordRow = { id: string; missionId: string | null; state: AgentState; createdAt: number; updatedAt: number; record: AgentProfile };
export type AgentSnapshot = {
  agents: {
    activity?: { application: string | null; action: string | null; step: string | null; completed: number; total: number; verification: string; artifacts: { id: string; title: string; verified: boolean }[]; history: { step: string; action: string; state: string }[] };
    authorization?: import("../bunny-missions/agentic-types.ts").AgenticProjection | null;
    authorizationError?: string;
    id: string; name: string; state: AgentState; missionId: string | null; createdAt: number; updatedAt: number;
    failure: AgentFailure | null;
    run: { id: string; generation: number; state: AgentState; startedAt: number | null; endedAt: number | null } | null;
    checkpoints: number;
    lastCheckpoint: { boundary: CheckpointBoundary; at: number; replaySafety: ReplaySafety } | null;
    pausedAt: number | null; stoppedAt: number | null;
    note: string | null;
    /** M-A-3 T11: team role, owning Coordinator, and the Agent's own current Task (never the whole Mission's). */
    team?: { role: string; coordinatorId: string | null; missionId: string };
    current?: { stepId: string; role: string; kind: string; state: string; provider: string | null; model: string | null; taskId: string | null } | null;
    owned?: { total: number; completed: number; running: number; failed: number; verified: number };
  }[];
  cursor: number;
};

const TERMINAL_MISSION: Partial<Record<MissionState, AgentState>> = { completed: "COMPLETED", failed: "FAILED", stopped: "STOPPED" };

export type AgentFlags = { paused: boolean; stopped: boolean };
export type AgentStepFacts = {
  state: StepState;
  attempts: { taskId: string | null; outcome: "completed" | "failed" | "stopped" | "interrupted" | "running" }[];
};

/**
 * Derivation only — a projection of canonical mission facts, never a substitute for them.
 * Order of precedence matters: terminal, pause, ask, verify, blocked dependency, waiting, planning.
 */
export function deriveAgentState(mission: { state: MissionState } | null, steps: AgentStepFacts[], flags: AgentFlags): AgentState {
  if (!mission) return "CREATED";
  const terminal = TERMINAL_MISSION[mission.state];
  if (terminal) return terminal;
  if (flags.stopped) return "STOPPED";
  if (flags.paused) return "PAUSED";
  if (mission.state === "waiting_for_user") {
    // A mission asked the user something of its own; without recovery in motion this is a user ask.
    return "WAITING_FOR_USER";
  }
  if (steps.length > 0 && steps.every((step) => step.state === "verifying" || step.state === "completed")) return "VERIFYING";
  if (steps.some((step) => step.state === "waiting_for_approval")) return "WAITING_FOR_USER";
  if (mission.state === "verifying") return "VERIFYING";
  if (["draft", "planning", "waiting_for_approval"].includes(mission.state)) return "PLANNING";
  if (mission.state === "running") {
    const admitted = steps.some((step) => step.state === "running" || step.state === "verifying" || step.attempts.some((attempt) => attempt.outcome === "running"));
    const blocked = steps.some((step) => step.state === "blocked");
    if (!admitted && blocked) return "WAITING_FOR_DEPENDENCY";
    return "RUNNING";
  }
  if (mission.state === "ready") return "WAITING_FOR_USER";
  return "WAITING_FOR_USER";
}

/**
 * M-A-3 T11: a team member's state from the Mission's state and ONLY the steps it owns. A member becomes COMPLETED only
 * with its Mission and never FAILED while its Mission may still be retried or replanned (terminal states have no exit).
 */
export function deriveMemberState(mission: { state: MissionState } | null, owned: (AgentStepFacts & { dormant?: boolean; superseded?: boolean })[], flags: AgentFlags): AgentState {
  if (!mission) return "CREATED";
  const live = owned.filter((step) => !step.dormant && !step.superseded);
  if (flags.stopped) return "STOPPED";
  if (mission.state === "completed") return "COMPLETED";
  if (mission.state === "stopped") return "STOPPED";
  if (flags.paused) return "PAUSED";
  if (["draft", "planning", "waiting_for_approval", "ready"].includes(mission.state)) return "PLANNING";
  if (live.some((step) => step.state === "waiting_for_approval")) return "WAITING_FOR_USER";
  if (live.some((step) => step.state === "verifying")) return "VERIFYING";
  if (live.some((step) => step.state === "running")) return "RUNNING";
  if (mission.state === "failed" || live.some((step) => step.state === "failed")) return "WAITING_FOR_USER";
  // Ready, pending, blocked or finished owned work: the member waits on other Agents or on the Mission.
  return "WAITING_FOR_DEPENDENCY";
}

const MISSION_TO_AGENT: Partial<Record<string, AgentFailure>> = {
  host_restart: "HOST_INTERRUPTED", host_failure: "HOST_INTERRUPTED", user_stopped: "STOP_REQUESTED",
  permission_denied: "AUTHORITY_LOST", dependency_failed: "DEPENDENCY_FAILED", workspace_conflict: "DEPENDENCY_FAILED",
  capability_unavailable: "DEPENDENCY_FAILED", verification_failed: "VERIFICATION_FAILED",
  budget_exceeded: "ROUTING_EXHAUSTED", timeout: "TASK_FAILED", invalid_plan: "TASK_FAILED",
};
/** Maps canonical mission step failure facts to the Agent's §10 taxonomy; detail strings are never forwarded. */
export function mapFailure(category: string, _detail: string): { category: AgentFailure; detail: string } {
  const mapped = MISSION_TO_AGENT[category] ?? "TASK_FAILED";
  const notes: Partial<Record<AgentFailure, string>> = { HOST_INTERRUPTED: "Host was restarted or failed; the previous execution was not resumed." };
  return { category: mapped, detail: notes[mapped] ?? "The mission recorded this failure category; full diagnostics stay on the Host." };
}
/** Routing exhaustion is detected from the routed decision trail, not from free text alone. */
export function routingExhausted(detail: string): boolean { return /no eligible (provider|model)|routing exhausted|routing attempts exhausted/i.test(detail); }
