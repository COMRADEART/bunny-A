import type {
  HostPresence,
  HostSample,
  OrchTask,
  TaskProgress,
  TaskState,
} from "../../lib/orch/types.ts";

export const TERMINAL: TaskState[] = ["completed", "failed", "stopped"];
export const RUNNING: TaskState[] = [
  "launching",
  "running",
  "verifying",
  "waiting_for_input",
  "waiting_for_agent_approval",
  "paused",
];
export const isActive = (task: OrchTask) => !TERMINAL.includes(task.state);
export const finitePlan = (progress: TaskProgress | null | undefined) =>
  progress?.kind === "determinate" &&
  Number.isInteger(progress.total) &&
  progress.total > 0 &&
  Number.isInteger(progress.completed) &&
  progress.completed >= 0 &&
  progress.completed <= progress.total
    ? progress
    : null;
export function elapsed(task: OrchTask, now: number) {
  if (task.startedAt == null || !Number.isFinite(task.startedAt) || !now) return "—";
  const seconds = Math.max(0, Math.floor(((task.finishedAt ?? now) - task.startedAt) / 1000));
  const h = Math.floor(seconds / 3600);
  return `${h ? `${h}:` : ""}${String(Math.floor(seconds / 60) % 60).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}
export const bytes = (value: number | null | undefined) =>
  value == null || !Number.isFinite(value) || value < 0
    ? "Unavailable"
    : `${(value / 1024 ** 3).toFixed(1)} GB`;
export const percent = (value: number | null | undefined) =>
  value == null || !Number.isFinite(value) ? "Unavailable" : `${Math.round(value)}%`;
export function recentSamples(samples: HostSample[]) {
  const last = samples.at(-1);
  return last
    ? samples.filter((sample) => sample.at >= last.at - 120_000 && sample.at <= last.at)
    : [];
}
export function thermalReadingFor(
  samples: HostSample[],
  host: HostPresence,
  cpuWarn: number,
  gpuWarn: number,
  now: number,
) {
  const sample = samples.at(-1);
  if (host !== "online" || !sample || !now || now - sample.at > 15_000 || sample.at > now)
    return null;
  const gpu = sample.gpus.find(
    (g) => g.temperatureC != null && Number.isFinite(g.temperatureC) && g.temperatureC >= gpuWarn,
  );
  if (gpu) return { name: gpu.name, temperature: gpu.temperatureC!, key: `gpu:${gpu.name}` };
  return sample.cpu.temperatureC != null &&
    Number.isFinite(sample.cpu.temperatureC) &&
    sample.cpu.temperatureC >= cpuWarn
    ? { name: "CPU", temperature: sample.cpu.temperatureC, key: "cpu" }
    : null;
}
export const isLocalGeneration = (task: OrchTask) =>
  task.provider === "ollama" &&
  !!task.model &&
  !/:cloud$/i.test(task.model) &&
  RUNNING.includes(task.state);
export const usesCloudModel = (task: OrchTask) =>
  task.provider === "ollama" && /:cloud$/i.test(task.model);
export const conflictsWithLocalOnly = (task: OrchTask) =>
  usesCloudModel(task) && !!(task.constraints?.localOnly || task.constraints?.offlineOnly);
export function verifiedFile(task: OrchTask) {
  // A provider's prose is not a file manifest. Only independent file verification establishes an output here.
  return task.state === "completed" && task.verification?.passed && task.verify && task.cwd
    ? {
        name: task.verify.name,
        folder: task.cwd,
        path: `${task.cwd.replace(/[\\/]$/, "")}${task.cwd.includes("\\") ? "\\" : "/"}${task.verify.name}`,
      }
    : null;
}
export function todayCount(tasks: OrchTask[], now: number, provider?: string) {
  const date = new Date(now);
  date.setHours(0, 0, 0, 0);
  return tasks.filter(
    (task) =>
      (!provider || task.provider === provider) &&
      task.createdAt >= date.getTime() &&
      task.createdAt <= now,
  ).length;
}

/** M-A-3 T3 §19: an "auto" model pick means the provider's default — the exact model id stays Unknown. */
export const PROVIDER_DEFAULT_MODEL = "Provider default · exact model Unknown";
export type RoutingFacts = {
  /** T3 model routing produced this Task's selection (policy_version on the decision). */
  engaged: boolean;
  mode: "Auto" | "Manual" | null;
  model: string;
  /** The Task's native effort knob, or null = the provider's default effort. */
  effort: string | null;
  /** "N eligible of M considered" once the Host reports a routing decision. */
  candidates: string | null;
  rerouted: boolean | null;
};
/** The routing facts a Task/Activity detail may show; provider defaults and legacy tasks stay honest. */
export function routingFacts(task: OrchTask): RoutingFacts {
  const decision = task.decision;
  const engaged = !!decision?.policy_version;
  const mode = task.routingMode ?? decision?.routing_mode ?? (engaged ? "auto" : null);
  return {
    engaged,
    mode: mode === "manual" ? "Manual" : mode === "auto" ? "Auto" : null,
    model:
      task.model && task.model !== "auto"
        ? task.model
        : engaged
          ? PROVIDER_DEFAULT_MODEL
          : "Model unavailable",
    effort: task.effort ?? null,
    candidates:
      engaged && decision?.candidate_count != null
        ? `${decision.eligible_candidate_count ?? 0} eligible of ${decision.candidate_count} considered`
        : null,
    rerouted:
      task.routingRerouted === true || (decision?.reroutes ?? 0) > 0
        ? true
        : engaged
          ? false
          : null,
  };
}
