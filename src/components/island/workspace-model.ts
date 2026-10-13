import type { AgentSnapshot } from "../../lib/bunny-host/agent-types.ts";
import { agentCanTransition } from "../../lib/bunny-host/agent-types.ts";
import type { MissionView } from "../../lib/bunny-missions/types.ts";
import type { OrchTask } from "../../lib/orch/types.ts";
import type { PublicActivity } from "../../lib/bunny-host/presentation.ts";

export type AgentView = AgentSnapshot["agents"][number];
export const attentionRequired = (agent: AgentView) =>
  ["WAITING_FOR_USER", "INTERRUPTED", "FAILED"].includes(agent.state) ||
  agent.authorization?.state === "WAITING_FOR_USER" ||
  (agent.authorization?.pending.length ?? 0) > 0;
export function agentControls(agent: AgentView, online: boolean) {
  return {
    pause:
      online &&
      (!agent.authorization || agent.authorization.state === "ACTIVE") &&
      agentCanTransition(agent.state, "PAUSED"),
    resume: online && agent.state === "PAUSED",
    stop: online && agentCanTransition(agent.state, "STOPPED"),
  };
}
export function currentAgentTask(
  agent: AgentView,
  mission: MissionView | undefined,
  tasks: OrchTask[],
) {
  const step = mission?.steps.find((row) =>
    ["running", "verifying", "waiting_for_approval"].includes(row.state),
  );
  // A retained completed Task must never be advertised as the current operation.
  return tasks.find(
    (task) => task.id === step?.taskId && !["completed", "failed", "stopped"].includes(task.state),
  );
}
/**
 * The Agent row's present-tense claim about its current Task. "Working on a step now" is only ever said for a live Host's
 * running or verifying step. A waiting step says so, and a Host that is not live shows the last known step, never "now".
 */
export function currentStepLabel(task: Pick<OrchTask, "state">, live: boolean): string {
  if (!live) return "Last known step";
  if (task.state === "waiting_for_approval") return "Waiting for approval";
  if (task.state === "running" || task.state === "verifying") return "Working on a step now";
  return "Step admitted";
}
/**
 * Radix returns focus to its trigger when a dialog closes, and a dialog opened from a plain button has none, so focus would
 * fall to the page. The element that opened the dialog gets focus back instead.
 */
export function returnFocusTo(opener: { current: HTMLElement | null }) {
  return (event: Event) => {
    event.preventDefault();
    opener.current?.focus();
  };
}
export function selectedTaskModel(task: Pick<OrchTask, "model"> | undefined) {
  if (!task) return "No model Task admitted";
  return !task.model ||
    ["auto", "default", "unknown", "provider-default"].includes(task.model.toLowerCase())
    ? "Provider Default — Exact model unknown"
    : task.model;
}
export type ActivityFilters = {
  project: string;
  agent: string;
  mission: string;
  task: string;
  status: string;
  provider: string;
  date: string;
};
export function filteredActivities(
  items: PublicActivity[],
  filters: ActivityFilters,
  tasks: OrchTask[],
  missions: MissionView[],
  agents: AgentView[],
) {
  return items
    .filter((item) => {
      const task = tasks.find((row) => row.id === item.taskId);
      const mission = missions.find(
        (row) => row.id === (item.missionId ?? task?.mission?.missionId),
      );
      return (
        (!filters.project || (mission?.projectId ?? task?.projectId) === filters.project) &&
        (!filters.agent ||
          agents.some((row) => row.id === filters.agent && row.missionId === item.missionId)) &&
        (!filters.mission || item.missionId === filters.mission) &&
        (!filters.task || item.taskId === filters.task) &&
        (!filters.status || item.state === filters.status) &&
        (!filters.provider || task?.provider === filters.provider) &&
        (!filters.date || new Date(item.at).toLocaleDateString("en-CA") === filters.date)
      );
    })
    .sort((a, b) => b.at - a.at || a.id.localeCompare(b.id));
}
