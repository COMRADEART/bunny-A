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
export function selectedTaskModel(task: OrchTask | undefined) {
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
