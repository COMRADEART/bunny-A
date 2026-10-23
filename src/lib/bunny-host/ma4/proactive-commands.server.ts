import { isTrustedLocalActor } from "../../bunny-missions/authorization.server.ts";
import { CommandRefusedError } from "../failure.server.ts";
import { WorkstationRequiredError } from "../device-authority.server.ts";
import type { ProactiveEngine } from "./proactive.server.ts";

/**
 * MA4-S2-T3 Host commands. A paired phone may read, pause, resume, cancel, disable a monitor and dismiss or snooze
 * notifications — each only reduces or re-checks authority. Creating, approving, changing and linking goals, schedules
 * and monitors, and the notification and resource settings, stay on the workstation.
 */
export const PROACTIVE_ACTIONS = new Set([
  "proactive.list", "proactive.notification.dismiss", "proactive.notification.snooze", "proactive.prefs", "proactive.policy", "proactive.away.ack",
  "goal.create", "goal.approve", "goal.pause", "goal.resume", "goal.cancel", "goal.link",
  "schedule.create", "schedule.approve", "schedule.update", "schedule.pause", "schedule.resume", "schedule.cancel",
  "monitor.create", "monitor.approve", "monitor.pause", "monitor.resume", "monitor.disable",
]);
const WORKSTATION_ONLY = new Set(["goal.create", "goal.approve", "goal.link", "schedule.create", "schedule.approve", "schedule.update", "monitor.create", "monitor.approve", "proactive.prefs", "proactive.policy"]);
/** Reading and stopping never wait on a healthy Host. */
export const PROACTIVE_SAFE_ACTIONS = ["proactive.list", "proactive.notification.dismiss", "proactive.notification.snooze", "proactive.away.ack", "goal.pause", "goal.cancel", "schedule.pause", "schedule.cancel", "monitor.pause", "monitor.disable"];

const id = (value: unknown) => { if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/.test(value)) throw new CommandRefusedError("Invalid id."); return value; };
const version = (value: unknown) => typeof value === "number" ? value : undefined;

export async function proactiveCommand(engine: ProactiveEngine, action: string, data: Record<string, unknown>, actor: string): Promise<unknown> {
  if (WORKSTATION_ONLY.has(action) && !isTrustedLocalActor(actor)) throw new WorkstationRequiredError("Goals, schedules and monitors are created and approved on the Windows workstation.");
  try {
    switch (action) {
      case "proactive.list": return engine.snapshot();
      case "proactive.notification.dismiss": return engine.dismiss(String(data.key ?? "").slice(0, 200));
      case "proactive.notification.snooze": return engine.snooze(String(data.key ?? "").slice(0, 200), typeof data.minutes === "number" ? data.minutes : 60);
      case "proactive.prefs": return engine.setPrefs(data.prefs, actor);
      case "proactive.policy": return engine.setPolicy(data.policy, actor);
      case "proactive.away.ack": return engine.awayAck();
      case "goal.create": return engine.goalCreate({ spec: data.spec, suggested: data.suggested === true }, actor);
      case "goal.approve": return engine.goalApprove(id(data.id), actor, { expectVersion: version(data.version) });
      case "goal.pause": case "goal.resume": case "goal.cancel": return engine.goalControl(id(data.id), action.slice(5) as "pause" | "resume" | "cancel", actor);
      case "goal.link": return engine.goalLink(id(data.id), id(data.criterionId), id(data.taskId), actor);
      case "schedule.create": return engine.scheduleCreate({ spec: data.spec }, actor);
      case "schedule.approve": return engine.scheduleApprove(id(data.id), actor, { expectVersion: version(data.version), ttlMs: typeof data.ttlMs === "number" ? data.ttlMs : undefined });
      case "schedule.update": return engine.scheduleUpdate(id(data.id), data.spec, actor, { expectVersion: version(data.version) });
      case "schedule.pause": case "schedule.resume": case "schedule.cancel": return engine.scheduleControl(id(data.id), action.slice(9) as "pause" | "resume" | "cancel", actor);
      case "monitor.create": return engine.monitorCreate({ spec: data.spec }, actor);
      case "monitor.approve": return engine.monitorApprove(id(data.id), actor, { expectVersion: version(data.version), ttlMs: typeof data.ttlMs === "number" ? data.ttlMs : undefined });
      case "monitor.pause": case "monitor.resume": case "monitor.disable": return engine.monitorControl(id(data.id), action.slice(8) as "pause" | "resume" | "disable", actor);
      default: throw new CommandRefusedError("Unknown proactive action.");
    }
  } catch (error) {
    if (error instanceof CommandRefusedError) throw error;
    // Validation, conflicts and authority refusals executed nothing: refusals, not Host failures.
    throw new CommandRefusedError(error instanceof Error ? error.message.slice(0, 600) : "The Host refused this change.");
  } finally { engine.wake(); }
}
