import { projectLocalPerformance, type ModelRouteMode } from "@/lib/bunny-host/ma4/s3t1";
import { taskStatus } from "@/lib/bunny-host/presentation";
import { activeTasks, useIsland } from "@/store/use-island";

/** Compact local performance. Missing measurements stay unavailable. */
export function LocalPerformance() {
  const samples = useIsland((state) => state.samples);
  const tasks = useIsland((state) => state.tasks);
  const sample = samples.at(-1);
  const seen = samples.length > 0 || tasks.length > 0;
  const task = activeTasks(tasks)[0];
  const gpu = sample?.gpus.find((row) => row.memoryUsedBytes != null);
  const mode: ModelRouteMode | null = task?.constraints?.modelExact
    ? "HARD_PIN"
    : task?.constraints?.preferredLocalModel
      ? "PREFERRED"
      : task?.constraints?.localOnly || task?.constraints?.offlineOnly
        ? "AUTO_LOCAL"
        : null;
  const queued = tasks.filter((row) => row.state === "queued" || row.state === "waiting_for_approval").length;
  const view = projectLocalPerformance({
    model: task?.provider === "ollama" ? task.model : null,
    digest: task?.servedModel?.digest ?? null,
    mode,
    agents: null,
    taskState: !seen ? null : task ? taskStatus(task).label : "idle",
    queue: seen ? queued : null,
    cpuPercent: sample?.cpu.utilization ?? null,
    ramBytes: sample ? sample.memory.usedBytes : null,
    vramBytes: gpu?.memoryUsedBytes ?? null,
    verification: task ? taskStatus(task).verification : null,
  });
  return (
    <div className="setting-row" aria-label="Local performance">
      <div>
        <strong>Local performance</strong>
        <p>Measured on this Host. Unavailable means the sensor or the task fact was not observed. A preference is used only while it is eligible. Alternate local models stay a choice, and a hard pin stays on its id and digest.</p>
        <ul className="caption">
          {view.rows.map((row) => (
            <li key={row.label}>
              {row.label}: {row.value}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
