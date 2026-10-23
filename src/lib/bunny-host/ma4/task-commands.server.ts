import { isTrustedLocalActor } from "../../bunny-missions/authorization.server.ts";
import { CommandRefusedError } from "../failure.server.ts";
import { WorkstationRequiredError } from "../device-authority.server.ts";
import type { PersistentTaskRuntime } from "./task-runtime.server.ts";

/** MA4-S2-T1 Host commands. A paired phone may read, pause, resume, cancel and acknowledge; everything that grants or
 *  resolves authority (create, approve, reconcile, revoke, policy) and reading step outputs stay on the workstation. */
export const PTASK_ACTIONS = new Set(["ptask.list", "ptask.get", "ptask.create", "ptask.approve", "ptask.pause", "ptask.resume", "ptask.cancel", "ptask.reconcile", "ptask.revoke", "ptask.policy", "ptask.notification.ack", "ptask.output"]);
const WORKSTATION_ONLY = new Set(["ptask.create", "ptask.approve", "ptask.reconcile", "ptask.revoke", "ptask.policy", "ptask.output"]);
/** Safe to run while the Host is degraded: reading and stopping work never wait on a healthy Host. */
export const PTASK_SAFE_ACTIONS = ["ptask.list", "ptask.get", "ptask.pause", "ptask.cancel", "ptask.notification.ack"];

const id = (value: unknown) => { if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/.test(value)) throw new CommandRefusedError("Invalid task id."); return value; };

export function ptaskCommand(rt: PersistentTaskRuntime, action: string, data: Record<string, unknown>, actor: string): unknown {
  if (WORKSTATION_ONLY.has(action) && !isTrustedLocalActor(actor)) throw new WorkstationRequiredError("Creating, approving and resolving persistent tasks happens on the Windows workstation.");
  try {
    switch (action) {
      case "ptask.list": return rt.snapshot();
      case "ptask.get": return rt.view(id(data.id));
      case "ptask.create": return rt.create({ spec: data.spec, envelope: data.envelope }, actor);
      case "ptask.approve": return rt.approve(id(data.id), actor, { expectVersion: typeof data.version === "number" ? data.version : undefined, ttlMs: typeof data.ttlMs === "number" ? data.ttlMs : undefined });
      case "ptask.pause": return rt.pause(id(data.id), actor);
      case "ptask.resume": return rt.resume(id(data.id), actor);
      case "ptask.cancel": return rt.cancel(id(data.id), actor);
      case "ptask.revoke": return rt.revoke(id(data.id), actor);
      case "ptask.reconcile": {
        if (data.decision !== "happened" && data.decision !== "not_happened" && data.decision !== "abandon") throw new CommandRefusedError("Choose happened, not_happened or abandon.");
        return rt.reconcile(id(data.id), data.decision, actor);
      }
      case "ptask.policy": return rt.setPolicy(data.policy, actor);
      case "ptask.notification.ack": return { acknowledged: rt.acknowledge(String(data.key ?? "").slice(0, 200)) };
      case "ptask.output": return rt.store.output(id(data.id), id(data.stepId));
      default: throw new CommandRefusedError("Unknown task action.");
    }
  } catch (error) {
    if (error instanceof CommandRefusedError) throw error;
    // Validation, conflicts and authority refusals executed nothing: they are refusals, not Host failures.
    throw new CommandRefusedError(error instanceof Error ? error.message.slice(0, 600) : "The Host refused this task change.");
  }
}
