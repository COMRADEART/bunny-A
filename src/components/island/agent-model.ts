import type { AgentSnapshot } from "../../lib/bunny-host/agent-types.ts";

/**
 * M-A-3 T4 — island projection of the durable Agent runtime. Honest control states only: a button is
 * enabled when the Host state it targets actually permits it, and disabled with a truth otherwise.
 */
export const AGENT_STATE_LABEL: Record<AgentSnapshot["agents"][number]["state"], string> = {
  CREATED: "Created", PLANNING: "Planning", RUNNING: "Running", WAITING_FOR_USER: "Needs you",
  WAITING_FOR_DEPENDENCY: "Waiting on a step", PAUSED: "Paused", VERIFYING: "Verifying",
  COMPLETED: "Completed", FAILED: "Failed", STOPPED: "Stopped", INTERRUPTED: "Interrupted",
};

export type AgentPanelRow = {
  activity?: AgentSnapshot["agents"][number]["activity"];
  authorization?: AgentSnapshot["agents"][number]["authorization"];
  authorizationError?: string;
  id: string;
  missionId?: string | null;
  name: string;
  state: AgentSnapshot["agents"][number]["state"];
  label: string;
  generation: number | null;
  checkpoints: number;
  lastCheckpoint: { boundary: string; at: number; replaySafety: string } | null;
  paused: boolean;
  controllable: boolean;
  note: string | null;
};

export const AGENT_NON_TERMINAL = ["CREATED", "PLANNING", "RUNNING", "WAITING_FOR_USER", "WAITING_FOR_DEPENDENCY", "PAUSED", "VERIFYING", "INTERRUPTED"];

/** Agents for the panel: active first (needs-you first, then running), then finished, capped. */
export function agentPanelRows(snapshot: AgentSnapshot | null | undefined, max = 6): { rows: AgentPanelRow[]; more: number } {
  if (!snapshot) return { rows: [], more: 0 };
  const rank = (state: AgentSnapshot["agents"][number]["state"]) =>
    state === "WAITING_FOR_USER" || state === "INTERRUPTED" ? 0 : AGENT_NON_TERMINAL.includes(state) ? 1 : 2;
  const ordered = [...snapshot.agents].sort((a, b) => rank(a.state) - rank(b.state) || b.updatedAt - a.updatedAt);
  const rows = ordered.map((agent) => ({
    id: agent.id,
    missionId: agent.missionId,
    name: agent.name,
    state: agent.state,
    label: AGENT_STATE_LABEL[agent.state],
    generation: agent.run?.generation ?? null,
    checkpoints: agent.checkpoints,
    lastCheckpoint: agent.lastCheckpoint,
    paused: agent.state === "PAUSED",
    controllable: AGENT_NON_TERMINAL.includes(agent.state),
    note: agent.note,
    authorization: agent.authorization,
    authorizationError: agent.authorizationError,
    activity: agent.activity,
  }));
  return { rows: rows.slice(0, max), more: Math.max(0, rows.length - max) };
}

export const CHECKPOINT_LABEL: Record<string, string> = {
  before_capability_admission: "Before a capability was admitted",
  after_capability_completion: "After capability output was saved",
  before_application_handoff: "Before changing applications",
  before_task_admission: "Before a step was admitted",
  after_task_completion: "After a task finished",
  after_verification: "After Bunny verified",
  before_waiting_for_user: "Before waiting on you",
  after_approval_decision: "After an approval decision",
  before_provider_reroute: "Before a provider reroute",
  after_artifact_commit: "After an artifact was committed",
  before_terminal_state: "Before an end state",
};
