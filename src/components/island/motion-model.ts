import type { HostEvent } from "../../lib/bunny-host/contracts.ts";
import type { HostPresence, OrchTask, ProviderId, ProviderLive, RouteDecision, TaskState } from "../../lib/orch/types.ts";
import { TERMINAL } from "./ui-model.ts";
import { publicEventDetail, publicEventLabel, taskStatus } from "../../lib/bunny-host/presentation.ts";

/** Partial Host snapshots must not fabricate provider facts or hand undefined to a provider mark. */
export function routingGraphIds(providers: Pick<ProviderLive, "id">[], decision?: RouteDecision | null): ProviderId[] {
  const primary: ProviderId[] = ["codex", "claude", "ollama"];
  return [...new Set([...primary, ...routeStrengths(decision).map(s => s.provider)])]
    .filter(id => providers.some(p => p.id === id)).slice(0, 6);
}

export type OrbState =
  "idle" | "listening" | "routing" | "working" | "waiting" | "completed" | "failed" | "offline";
export function orbState(host: HostPresence, task?: OrchTask | null, routing = false): OrbState {
  if (host !== "online") return "offline";
  if (routing || task?.state === "routing") return "routing";
  if (!task || task.state === "stopped") return "idle";
  if (task.state === "completed" || task.state === "failed") return task.state;
  if (
    [
      "queued",
      "waiting_for_approval",
      "waiting_for_input",
      "waiting_for_agent_approval",
      "paused",
    ].includes(task.state)
  )
    return "waiting";
  return "working";
}

export type JourneyStep = {
  label: string;
  status: "done" | "current" | "next" | "unavailable" | "failed";
};
export function taskJourney(
  task: Pick<OrchTask, "startedAt" | "state" | "verification"> & {
    decision?: RouteDecision | null;
  },
): JourneyStep[] {
  const started = task.startedAt != null;
  const approved = started || task.state === "launching";
  const terminal = TERMINAL.includes(task.state);
  const routed = !!task.decision?.recommended_provider;
  return [
    { label: "Prompt", status: "done" },
    { label: "Route", status: routed ? "done" : task.state === "routing" ? "current" : "next" },
    {
      label: "Approve",
      status: approved ? "done" : task.state === "waiting_for_approval" ? "current" : "next",
    },
    {
      label: "Work",
      status: started ? (terminal || task.state === "verifying" ? "done" : "current") : "next",
    },
    {
      label: "Verify",
      status: task.verification
        ? task.verification.passed
          ? "done"
          : "failed"
        : task.state === "verifying"
          ? "current"
          : terminal
            ? "unavailable"
            : "next",
    },
    {
      label: task.state === "failed" ? "Failed" : task.state === "stopped" ? "Stopped" : "Complete",
      status:
        task.state === "completed"
          ? "done"
          : task.state === "failed"
            ? "failed"
            : task.state === "stopped"
              ? "unavailable"
              : "next",
    },
  ];
}

// The backend can normalize a provider's reasoning event. Its private text is never UI activity.
export const isPrivateEvent = (type: string) => /thinking|reasoning/i.test(type);
export function activityLabel(type: string) {
  return publicEventLabel(type);
}
export function activityDetail(type: string, detail: string, task?: OrchTask) {
  return publicEventDetail(type,detail,task);
}
export function routeStrengths(decision?: RouteDecision | null) {
  const scores = (decision?.scores ?? []).filter((s) => Number.isFinite(s.score));
  if (!scores.length) return [];
  const min = Math.min(...scores.map((s) => s.score));
  const max = Math.max(...scores.map((s) => s.score));
  return scores.map((s) => ({ ...s, strength: max === min ? 1 : (s.score - min) / (max - min) }));
}

export type ReplayRecord = {
  key: string;
  at: number;
  type: string;
  detail: string;
  source: "event" | "log" | "task";
};
export function publicTaskLogs(task: OrchTask, events: HostEvent[]) {
  const typed = events.filter((event) => event.taskId === task.id);
  return (task.logs ?? []).map((log) => {
    const matching = typed.find(
      (event) => Math.abs(event.at - log.at) < 1000 && event.detail === log.line,
    );
    const knownHostRecord =
      /^(Task created|Selected |Routed |Awaiting |User approved|Execution active\.|Provider session |Provider reported model |Bunny-A is independently |Completed and verified by Bunny-A:|Provider process |User stopped|Stop requested|Stopped |Raw session transcript:|Host restarted|Independent verification|Verification |User feedback:)/i.test(
        log.line,
      );
    return {
      ...log,
      line: matching
        ? activityDetail(matching.type, log.line, task)
        : knownHostRecord
          ? /^Execution active\./.test(log.line) ? "Execution active. Progress indeterminate until the provider publishes a plan." : "Host activity recorded. Details omitted from public activity."
          : "Activity detail unavailable (untyped Host log).",
    };
  });
}
export function replayRecords(task: OrchTask, events: HostEvent[]): ReplayRecord[] {
  const records: ReplayRecord[] = events
    .filter((e) => e.taskId === task.id && !e.type.startsWith("audit.") && !isPrivateEvent(e.type))
    .map((e) => ({
      key: `event-${e.sequence}`,
      at: e.at,
      type: e.type,
      detail: activityDetail(e.type, e.detail, task),
      source: "event",
    }));
  const retained = publicTaskLogs(task, events);
  for (const [index, log] of retained.entries()) {
    // Logs are already timestamped Host records, not inferred provider commands.
    if (
      !records.some((e) => Math.abs(e.at - log.at) < 1000 && e.detail === log.line) &&
      !/reasoning|thinking step/i.test(log.line)
    )
      records.push({
        key: `log-${index}`,
        at: log.at,
        type: "host.log",
        detail: log.line,
        source: "log",
      });
  }
  if (!records.some((e) => e.type === "task.created"))
    records.push({
      key: "submitted",
      at: task.createdAt,
      type: "task.created",
      detail: "Task submitted.",
      source: "task",
    });
  if (task.startedAt != null && !records.some((e) => e.type === "agent.started"))
    records.push({
      key: "started",
      at: task.startedAt,
      type: "agent.started",
      detail: `${task.provider} session started`,
      source: "task",
    });
  if (task.finishedAt != null && !records.some((e) => e.type === `task.${task.state}`))
    records.push({
      key: "finished",
      at: task.finishedAt,
      type: `task.${task.state}`,
      detail: taskStatus(task).label + ". " + taskStatus(task).verification,
      source: "task",
    });
  return records
    .filter((e) => Number.isFinite(e.at))
    .sort((a, b) => a.at - b.at || a.key.localeCompare(b.key));
}
export function replayFrame(task: OrchTask, records: ReplayRecord[], at: number) {
  const seen = records.filter((e) => e.at <= at);
  const finished = task.finishedAt != null && at >= task.finishedAt;
  const started = task.startedAt != null && at >= task.startedAt;
  const verification = [...seen].reverse().find((e) => e.type === "verification.completed");
  const verifying = seen.some((e) => e.type === "agent.verifying");
  const approved =
    started ||
    seen.some(
      (e) =>
        ["approval.accepted", "task.approved"].includes(e.type) || /^User approved/i.test(e.detail),
    );
  const routed =
    approved ||
    seen.some(
      (e) =>
        ["approval.required", "task.routed"].includes(e.type) ||
        /^(Selected |Routed )/i.test(e.detail),
    );
  const routing = seen.some((e) => e.type === "routing.started");
  const state: TaskState = finished
    ? task.state
    : started
      ? verifying
        ? "verifying"
        : "running"
      : approved
        ? "launching"
        : routed
          ? "waiting_for_approval"
          : routing
            ? "routing"
            : "queued";
  const output = finished
    ? task.output
    : seen
        .filter((e) => e.type === "agent.output")
        .map((e) => e.detail)
        .join("\n");
  const latestCommand = [...seen]
    .reverse()
    .find((e) =>
      ["agent.command", "agent.testing", "agent.building", "agent.rendering"].includes(e.type),
    );
  return {
    task: {
      ...task,
      state,
      decision: routed ? task.decision : null,
      startedAt: started ? task.startedAt : null,
      finishedAt: finished ? task.finishedAt : null,
      verification: verification || finished ? task.verification : null,
      progress: null,
      output,
      latestEvent: null,
    },
    routeAvailable: routed,
    agentStarted: started,
    event: seen.at(-1) ?? null,
    command: latestCommand?.detail ?? null,
    // Artifact existence is established only by the completed independent verification.
    artifactAvailable: finished && task.state === "completed" && !!task.verification?.passed,
  };
}
