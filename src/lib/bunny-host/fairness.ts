/**
 * M-A-3 T13.3 Gate F: fair admission of Personal Agent Mission steps against shared, system-wide limits.
 * Pure: the Host supplies live counts and waiting Agents; this decides whether one more step may start now.
 * Holding never fails a step; it stays ready and is retried when capacity frees.
 */
import type { SlotId } from "./personal-agents.ts";

export const FAIRNESS_SETTING = "personal_agent_fairness";
/** The owner's routing priority. It reorders eligible candidates only; it never widens eligibility or authority. */
export const ROUTING_PRIORITIES = ["minimize_cost", "balanced", "prioritize_quality", "local_only", "fastest"] as const;
export type RoutingPriority = (typeof ROUTING_PRIORITIES)[number];
export type AgentPriority = "low" | "normal" | "high";
export type AgentFairness = { maxConcurrent: number; priority: AgentPriority };
export type FairnessSettings = {
  /** Live Personal Agent steps across all four Agents. */
  sharedCeiling: number;
  /** System memory use (percent) above which no further Personal Agent step starts while another is live. */
  memoryCeilingPercent: number;
  agents: Record<SlotId, AgentFairness>;
};
export type SchedulerView = {
  priority: RoutingPriority;
  fairness: FairnessSettings;
  live: Partial<Record<SlotId, number>>;
  held: { missionId: string; slot: SlotId | null; reason: string; since: number | null }[];
  memoryUsedPercent: number;
};
export type HoldCode = "AGENT_CAP" | "SHARED_CEILING" | "FAIR_TURN" | "MEMORY_PRESSURE";
export type Admission = { admit: true } | { admit: false; code: HoldCode; reason: string };
export type WaitingAgent = { slot: SlotId; since: number };
export type AdmissionInput = {
  slot: SlotId;
  settings: FairnessSettings;
  /** Live Personal Agent steps per slot. */
  live: Partial<Record<SlotId, number>>;
  /** Other Agents with a ready step currently held. */
  waiting: WaitingAgent[];
  /** When this Agent's own step was first held, if it was. */
  since: number;
  /** The Host clock, for aging. */
  now: number;
  memoryUsedPercent: number;
};

const SLOTS: SlotId[] = [1, 2, 3, 4];
const RANK: Record<AgentPriority, number> = { low: 0, normal: 1, high: 2 };
/** A held step rises one priority rank per this much waiting (up to high), so no Agent waits forever behind higher priorities. */
export const FAIRNESS_AGING_MS = 60_000;

export const DEFAULT_FAIRNESS: FairnessSettings = {
  sharedCeiling: 4,
  memoryCeilingPercent: 95,
  agents: { 1: { maxConcurrent: 2, priority: "normal" }, 2: { maxConcurrent: 2, priority: "normal" }, 3: { maxConcurrent: 2, priority: "normal" }, 4: { maxConcurrent: 2, priority: "normal" } },
};

const int = (value: unknown, min: number, max: number, label: string): number => {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) throw new Error(`${label} must be a whole number from ${min} to ${max}.`);
  return value;
};

/** Validates a full or partial settings update on top of the current settings. Throws a plain message on bad input. */
export function validateFairness(input: unknown, current: FairnessSettings = DEFAULT_FAIRNESS): FairnessSettings {
  if (!input || typeof input !== "object") throw new Error("Fairness settings must be an object.");
  const raw = input as { sharedCeiling?: unknown; memoryCeilingPercent?: unknown; agents?: unknown };
  const next: FairnessSettings = structuredClone(current);
  if (raw.sharedCeiling !== undefined) next.sharedCeiling = int(raw.sharedCeiling, 1, 16, "Shared ceiling");
  if (raw.memoryCeilingPercent !== undefined) next.memoryCeilingPercent = int(raw.memoryCeilingPercent, 50, 100, "Memory ceiling");
  if (raw.agents !== undefined) {
    if (!raw.agents || typeof raw.agents !== "object") throw new Error("Agent fairness must be an object keyed by slot.");
    for (const [key, value] of Object.entries(raw.agents as Record<string, unknown>)) {
      const slot = Number(key) as SlotId;
      if (!SLOTS.includes(slot)) throw new Error(`Unknown Personal Agent slot ${key}.`);
      const agent = (value ?? {}) as { maxConcurrent?: unknown; priority?: unknown };
      if (agent.maxConcurrent !== undefined) next.agents[slot].maxConcurrent = int(agent.maxConcurrent, 1, 8, "Per-Agent limit");
      if (agent.priority !== undefined) {
        if (agent.priority !== "low" && agent.priority !== "normal" && agent.priority !== "high") throw new Error("Priority must be low, normal or high.");
        next.agents[slot].priority = agent.priority;
      }
    }
  }
  return next;
}

export function readFairness(stored: string | null | undefined): FairnessSettings {
  if (!stored) return structuredClone(DEFAULT_FAIRNESS);
  try { return validateFairness(JSON.parse(stored)); } catch { return structuredClone(DEFAULT_FAIRNESS); }
}

/**
 * Decides whether `slot` may start one more step now. Order: its own cap, the shared ceiling, a fair turn for
 * Agents waiting ahead of it (higher aged priority, then fewer live steps, then longest wait), then memory pressure.
 */
export function admitStep(input: AdmissionInput): Admission {
  const { slot, settings } = input;
  const live = (s: SlotId) => input.live[s] ?? 0;
  const mine = live(slot);
  const total = SLOTS.reduce((sum, s) => sum + live(s), 0);
  if (mine >= settings.agents[slot].maxConcurrent)
    return { admit: false, code: "AGENT_CAP", reason: `This Agent already runs ${mine} of its ${settings.agents[slot].maxConcurrent} allowed steps.` };
  if (total >= settings.sharedCeiling)
    return { admit: false, code: "SHARED_CEILING", reason: `All ${settings.sharedCeiling} shared Agent step slots are in use.` };
  const aged = (s: SlotId, since: number) => Math.min(RANK.high, RANK[settings.agents[s].priority] + Math.floor(Math.max(0, input.now - since) / FAIRNESS_AGING_MS));
  const key = (s: SlotId, since: number) => [-aged(s, since), live(s), since] as const;
  const before = (a: readonly number[], b: readonly number[]) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
  const own = key(slot, input.since);
  const ahead = new Set(input.waiting
    .filter((w) => w.slot !== slot && live(w.slot) < settings.agents[w.slot].maxConcurrent && before(key(w.slot, w.since), own) < 0)
    .map((w) => w.slot));
  if (ahead.size >= settings.sharedCeiling - total)
    return { admit: false, code: "FAIR_TURN", reason: `Waiting for a fair turn behind ${ahead.size} other Agent${ahead.size === 1 ? "" : "s"}.` };
  if (total > 0 && input.memoryUsedPercent >= settings.memoryCeilingPercent)
    return { admit: false, code: "MEMORY_PRESSURE", reason: `System memory is ${Math.round(input.memoryUsedPercent)}% used (limit ${settings.memoryCeilingPercent}%).` };
  return { admit: true };
}
