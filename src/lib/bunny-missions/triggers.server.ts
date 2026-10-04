import type { HostEvent } from "../bunny-host/contracts.ts";
import type { MissionStore } from "./store.server.ts";
import type { Trigger, TriggerAction, TriggerSource } from "./types.ts";
import { CommandRefusedError, HostContainment, safeError, supervisedLoop } from "../bunny-host/failure.server.ts";

/** Sources with a working event feed on this Host. The rest are part of the contract but have no watcher yet. */
export const LIVE_SOURCES: TriggerSource[] = ["schedule", "mission_event", "system_event", "capability_event"];
const MIN_INTERVAL = 60_000;

export function validateTrigger(input: Record<string, unknown>, createdBy: string): Trigger {
  const name = typeof input.name === "string" ? input.name.trim().slice(0, 80) : "";
  if (!name) throw new CommandRefusedError("Trigger name is required.");
  const source = input.source as TriggerSource;
  if (!["schedule", "capability_event", "filesystem", "github", "message", "email", "calendar", "mission_event", "system_event"].includes(source)) throw new CommandRefusedError("Unknown trigger source.");
  if (!LIVE_SOURCES.includes(source)) throw new CommandRefusedError(`Trigger source "${source}" has no event feed on this Host yet; it cannot be created.`);
  const condition = (input.condition ?? {}) as Record<string, unknown>;
  const out: Trigger["condition"] = {};
  if (source === "schedule") {
    const interval = Number(condition.intervalMs);
    if (!Number.isInteger(interval) || interval < MIN_INTERVAL || interval > 7 * 24 * 3_600_000) throw new CommandRefusedError("Schedule interval must be between 1 minute and 7 days.");
    out.intervalMs = interval;
  } else {
    if (typeof condition.eventType !== "string" || !/^[a-z_.*]{3,80}$/.test(condition.eventType)) throw new CommandRefusedError("eventType is required (e.g. mission.failed or capability.*).");
    out.eventType = condition.eventType;
    if (typeof condition.contains === "string") out.contains = condition.contains.slice(0, 200);
  }
  const action = input.action as Record<string, unknown> | undefined;
  let parsed: TriggerAction;
  if (action?.kind === "notify" && typeof action.title === "string" && action.title.trim()) parsed = { kind: "notify", title: action.title.slice(0, 120) };
  else if (action?.kind === "create_mission_draft" && typeof action.objective === "string" && action.objective.trim()) {
    if (!["fast", "balanced", "deep"].includes(String(action.mode))) throw new CommandRefusedError("Unknown mission mode.");
    parsed = { kind: "create_mission_draft", objective: action.objective.slice(0, 4000), mode: action.mode as "fast" | "balanced" | "deep", projectId: typeof action.projectId === "string" ? action.projectId : null };
  } else throw new CommandRefusedError("Trigger action must be notify or create_mission_draft.");
  const rate = (input.rateLimit ?? {}) as Record<string, unknown>;
  const minIntervalMs = Math.max(MIN_INTERVAL, Number(rate.minIntervalMs ?? 10 * 60_000) || 10 * 60_000);
  const maxPerHour = Math.max(1, Math.min(12, Number(rate.maxPerHour ?? 4) || 4));
  // Powerful automation is never on by default: a new trigger is created disabled.
  return { id: crypto.randomUUID(), name, source, condition: out, action: parsed, enabled: false, requiresApproval: true, rateLimit: { minIntervalMs, maxPerHour }, createdAt: Date.now(), createdBy, lastFiredAt: null, firings: [] };
}

export function eventMatches(trigger: Trigger, event: HostEvent): boolean {
  if (trigger.source === "schedule" || !trigger.condition.eventType) return false;
  const pattern = trigger.condition.eventType;
  const typeOk = pattern.endsWith("*") ? event.type.startsWith(pattern.slice(0, -1)) : event.type === pattern;
  const familyOk = trigger.source === "mission_event" ? event.type.startsWith("mission.") : trigger.source === "capability_event" ? event.type.startsWith("capability.") || event.type.startsWith("skill.") : !event.type.startsWith("mission.") && !event.type.startsWith("trigger.");
  return typeOk && familyOk && (!trigger.condition.contains || event.detail.includes(trigger.condition.contains));
}

/**
 * Trigger engine. Fires only when triggers are globally enabled AND the trigger itself is enabled,
 * within its rate limits; every firing and suppression is journaled. Its actions are limited to an
 * Inbox notification or a mission *draft* that still needs explicit approval.
 */
export class TriggerEngine {
  store: MissionStore;
  emit: (type: string, detail: string) => void;
  act: (trigger: Trigger, cause: string) => Promise<void>;
  timer: ReturnType<typeof setInterval> | null = null;
  loop: {stop:()=>void}|null=null;
  containment:HostContainment;
  constructor(store: MissionStore, emit: (type: string, detail: string) => void, act: (trigger: Trigger, cause: string) => Promise<void>,containment=new HostContainment()) { this.store = store; this.emit = emit; this.act = act; this.containment=containment; }
  create(input: Record<string, unknown>, by: string) { const trigger = validateTrigger(input, by); this.store.saveTrigger(trigger); this.emit("trigger.created", `${trigger.name} (${trigger.source}) created disabled by ${by}.`); return trigger; }
  setEnabled(id: string, enabled: boolean, by: string) { const trigger = { ...this.store.trigger(id), enabled }; this.store.saveTrigger(trigger); this.emit(enabled ? "trigger.enabled" : "trigger.disabled", `${trigger.name} ${enabled ? "enabled" : "disabled"} by ${by}.`); return trigger; }
  remove(id: string, by: string) { const trigger = this.store.trigger(id); this.store.deleteTrigger(id); this.emit("trigger.deleted", `${trigger.name} deleted by ${by}.`); }
  allowed(trigger: Trigger, now: number): string | null {
    if (trigger.lastFiredAt && now - trigger.lastFiredAt < trigger.rateLimit.minIntervalMs) return "debounced";
    if (trigger.firings.filter((at) => now - at < 3_600_000).length >= trigger.rateLimit.maxPerHour) return "hourly limit reached";
    return null;
  }
  async fire(trigger: Trigger, cause: string, now = Date.now()) {
    const blocked = this.allowed(trigger, now);
    if (blocked) { this.emit("trigger.suppressed", `${trigger.name}: ${blocked}.`); return false; }
    this.store.saveTrigger({ ...trigger, lastFiredAt: now, firings: [...trigger.firings.filter((at) => now - at < 3_600_000), now] });
    this.emit("trigger.fired", `${trigger.name}: ${cause}`);
    try {await this.act(trigger,cause);} catch(error) {this.emit("trigger.failed",`${trigger.name}: ${safeError(error).message}`);}
    return true;
  }
  async onEvent(event: HostEvent, globallyEnabled: boolean) {
    if (!globallyEnabled || event.type.startsWith("trigger.")) return;
    for (const trigger of this.store.triggers()) if (trigger.enabled && eventMatches(trigger, event)) await this.fire(trigger, `${event.type} (#${event.sequence})`);
  }
  async tick(globallyEnabled: boolean, now = Date.now()) {
    if (!globallyEnabled) return;
    for (const trigger of this.store.triggers()) {
      if (!trigger.enabled || trigger.source !== "schedule" || !trigger.condition.intervalMs) continue;
      if (!trigger.lastFiredAt || now - trigger.lastFiredAt >= trigger.condition.intervalMs) await this.fire(trigger, "schedule", now);
    }
  }
  start(globallyEnabled: () => boolean) { this.stop(); this.loop=supervisedLoop(this.containment,{subsystem:"triggers"},()=>this.tick(globallyEnabled() && this.containment.allows("triggers")),30_000,undefined,"SUBSYSTEM_FAILURE"); }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; this.loop?.stop(); this.loop=null; }
}
