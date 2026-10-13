/**
 * M-A-3 T13 right context panel, client side. Every number here is a real Host sample or a real Host record. When the
 * Host has sent no sample, the panel says "Sensor unavailable" and shows no figure at all. The board's illustrative numbers
 * (CPU 24 %, GPU 18 %, RAM 62 %) are never data.
 */
import type { HostSample, OrchTask } from "../../lib/orch/types.ts";
import type { PersonalAgentsSnapshot, WeaponId } from "../../lib/bunny-host/personal-agents.ts";
import { selectedTaskModel } from "./workspace-model.ts";

/** A sample older than this describes the past, so it is shown with its time, not as the present. */
export const TELEMETRY_FRESH_MS = 60_000;

export type TelemetryView =
  | { available: false; label: "Sensor unavailable" }
  | {
      available: true;
      fresh: boolean;
      at: number;
      cpuPercent: number | null;
      memoryUsedPercent: number | null;
      gpuPercent: number | null;
    };

const percent = (part: number, whole: number): number | null =>
  Number.isFinite(part) && Number.isFinite(whole) && whole > 0 ? Math.round((part / whole) * 100) : null;

/** The newest real Host sample, reduced to the figures the Host measured. Absent or malformed samples mean no telemetry. */
export function telemetryView(samples: readonly HostSample[], now: number, live = true): TelemetryView {
  const latest = samples.reduce<HostSample | null>((best, sample) => (!best || sample.at > best.at ? sample : best), null);
  if (!latest || !Number.isFinite(latest.at)) return { available: false, label: "Sensor unavailable" };
  const utilization = latest.cpu?.utilization;
  const gpuUtilizations = (latest.gpus ?? []).map((gpu) => gpu.utilization).filter((value): value is number => Number.isFinite(value));
  return {
    available: true,
    // Not live means the Host is not answering: the sample is shown with its time, never as the present.
    fresh: live && Math.abs(now - latest.at) <= TELEMETRY_FRESH_MS,
    at: latest.at,
    cpuPercent: typeof utilization === "number" && Number.isFinite(utilization) ? Math.round(utilization) : null,
    memoryUsedPercent: percent(latest.memory?.usedBytes ?? Number.NaN, latest.memory?.totalBytes ?? Number.NaN),
    gpuPercent: gpuUtilizations.length ? Math.round(Math.max(...gpuUtilizations)) : null,
  };
}

export type ModelActivityRow = { taskId: string; title: string; provider: string; model: string; state: OrchTask["state"] };

/** The Tasks the Host is running now, with the provider and the model it reports. Retained, finished work is not listed. */
export function modelActivity(tasks: readonly Pick<OrchTask, "id" | "title" | "provider" | "model" | "state">[], live = true): ModelActivityRow[] {
  // Retained tasks from before a connection drop are not running now: an offline Host shows no running list.
  if (!live) return [];
  return tasks
    .filter((task) => task.state === "running" || task.state === "verifying" || task.state === "waiting_for_approval")
    .map((task) => ({ taskId: task.id, title: task.title, provider: task.provider, model: selectedTaskModel(task), state: task.state }));
}

export type PersonalAgentRow = {
  slot: number;
  weapon: WeaponId;
  name: string;
  bound: boolean;
  stateLabel: string;
  /** Slot-level link target: the Studio. */
  bindable: boolean;
};

/** The four slots as the panel lists them. An unassigned slot is dim and points at the Studio; it is never a weapon in use. */
export function personalAgentRows(snapshot: PersonalAgentsSnapshot | null, live = true): PersonalAgentRow[] {
  return (snapshot?.slots ?? []).map((slot) => ({
    slot: slot.slot,
    weapon: slot.weapon,
    name: slot.agent ? slot.displayName || slot.agent.name : slot.displayName,
    bound: slot.agentId !== null,
    stateLabel: slot.agentId === null ? "Set up in Studio" : live ? slot.presentation.label : `Last known: ${slot.presentation.label}`,
    bindable: true,
  }));
}

/** Pending reviews: the Approvals count, as a sentence the panel can show without inventing a number. */
export function reviewsLabel(count: number, live = true): string {
  const text = !Number.isFinite(count) || count <= 0 ? "Nothing waiting for you" : count === 1 ? "1 review waiting for you" : `${count} reviews waiting for you`;
  return live ? text : `Last known: ${text.charAt(0).toLowerCase()}${text.slice(1)}`;
}
