import { isTrustedLocalActor } from "../../bunny-missions/authorization.server.ts";
import { CommandRefusedError } from "../failure.server.ts";
import { WorkstationRequiredError } from "../device-authority.server.ts";
import type { PersistentTaskRuntime } from "./task-runtime.server.ts";
import type { ConnectedActions } from "./connected-actions.server.ts";
import { planConnectedTask } from "./connected-workflow.server.ts";
import { EnvelopeSchema, planReview } from "./task-runtime.ts";

/** MA4-S2-T1 Host commands. A paired phone may read, pause, resume, cancel and acknowledge; everything that grants or
 *  resolves authority (create, approve, reconcile, revoke, policy) and reading step outputs stay on the workstation.
 *  MA4-S2-T2 adds the Approval Center (approve/deny/inspect one action), receipts, folder registration and the Planner:
 *  all workstation-only. */
export const PTASK_ACTIONS = new Set(["ptask.list", "ptask.get", "ptask.create", "ptask.approve", "ptask.pause", "ptask.resume", "ptask.cancel", "ptask.reconcile", "ptask.revoke", "ptask.policy", "ptask.notification.ack", "ptask.output",
  "ptask.plan", "action.approve", "action.deny", "action.inspect", "action.receipts", "connector.roots.list", "connector.roots.set"]);
const WORKSTATION_ONLY = new Set(["ptask.create", "ptask.approve", "ptask.reconcile", "ptask.revoke", "ptask.policy", "ptask.output",
  "ptask.plan", "action.approve", "action.deny", "action.inspect", "action.receipts", "connector.roots.list", "connector.roots.set"]);
/** Safe to run while the Host is degraded: reading and stopping work never wait on a healthy Host. */
export const PTASK_SAFE_ACTIONS = ["ptask.list", "ptask.get", "ptask.pause", "ptask.cancel", "ptask.notification.ack", "action.deny", "action.inspect", "action.receipts"];

const id = (value: unknown) => { if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/.test(value)) throw new CommandRefusedError("Invalid task id."); return value; };
const hash = (value: unknown) => { if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) throw new CommandRefusedError("Name the exact payload hash you reviewed."); return value; };
/**
 * MA4-S2-T3R Approval Center context: who asks, for which task (and schedule or goal), what kind of effect, under which
 * exact grants, what should happen, and what recovery does if the Host stops mid-action. Host facts only; workstation-only.
 */
export function actionContext(rt: PersistentTaskRuntime, id: string, owners?: { taskContext(taskId: string): { schedule: string | null; goal: string | null } }) {
  const { record } = rt.store.get(id), p = record.pendingAction;
  if (!p) return null;
  const facts = rt.executorFacts().get(p.kind), category = facts?.category ?? "irreversible", index = record.spec.steps.findIndex(s => s.id === p.stepId);
  const g = record.envelope.grants;
  const scope = [
    ...(g?.files ?? []).map(f => `Folder ${f.root} (${f.access})`),
    ...(g?.origins ?? []).map(o => `Website ${o} (read)`),
    ...(g?.services ?? []).map(s => `${s.connector} account ${s.account} (${s.access}${s.recipients.length ? `; only to ${s.recipients.join(", ")}` : ""})`),
  ];
  const recovery = category === "irreversible"
    ? "If Bunny-A stops while this runs, it is never sent again on its own: you will be asked whether it happened."
    : category === "idempotent"
      ? "If Bunny-A stops while this runs, it first checks (by this action's key) whether it was already applied, and only then tries once more."
      : "Read-only: repeating it changes nothing.";
  return {
    task: record.spec.title, taskId: id, step: `${p.stepId} (step ${index + 1} of ${record.spec.steps.length})`, role: p.kind === "local.review" ? "Reviewer" : "Worker",
    operation: p.kind, sideEffect: `${category.replace("_", "-")}${facts?.consequential ? ", consequential" : ""}${p.reversible ? ", reversible" : ", cannot be undone"}`,
    scope, expected: p.effects.join(" "), recovery, approvalExpiresAt: p.expiresAt, taskExpiresAt: record.envelope.expiresAt, ...(owners?.taskContext(id) ?? { schedule: null, goal: null }),
  };
}
const actionId = (value: unknown) => { if (typeof value !== "string" || !/^act-[a-f0-9-]{36}$/.test(value)) throw new CommandRefusedError("Invalid action id."); return value; };

export async function ptaskCommand(rt: PersistentTaskRuntime, action: string, data: Record<string, unknown>, actor: string, connected?: ConnectedActions, owners?: Parameters<typeof actionContext>[2]): Promise<unknown> {
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
      case "action.approve": return rt.approveAction(id(data.id), actionId(data.actionId), hash(data.payloadSha256), actor, { ttlMs: typeof data.ttlMs === "number" ? data.ttlMs : undefined });
      case "action.deny": return rt.denyAction(id(data.id), actionId(data.actionId), actor);
      case "action.inspect": { const action = rt.pendingAction(id(data.id), actor); return { action, context: action ? actionContext(rt, id(data.id), owners) : null, receipts: connected?.ledger.list(id(data.id), 50) ?? [] }; }
      case "action.receipts": return { receipts: connected?.ledger.list(id(data.id)) ?? [], chain: connected?.ledger.verify() ?? null };
      case "connector.roots.list": return { roots: connected?.roots.list() ?? [] };
      case "connector.roots.set": { if (!connected) throw new CommandRefusedError("Connected actions are not available."); return { roots: connected.roots.set(data.roots) }; }
      case "ptask.plan": {
        if (!connected) throw new CommandRefusedError("Connected actions are not available.");
        if (typeof data.request !== "string" || !data.request.trim()) throw new CommandRefusedError("Describe what you want done.");
        if (typeof data.model !== "string") throw new CommandRefusedError("Choose the pinned local model for the Planner.");
        const envelope = EnvelopeSchema.parse(data.envelope);
        if (!envelope.models.includes(data.model)) throw new CommandRefusedError("The Planner's model must be pinned in the envelope.");
        // A proposal only: the owner reviews it and creates (and approves) the task themselves.
        const plan = await planConnectedTask({ request: data.request, projectId: id(data.projectId), envelope, model: data.model, call: rt.modelCall(), catalog: connected.catalog, facts: rt.executorFacts(), signal: AbortSignal.timeout(300_000), now: Date.now() });
        // MA5-S2: tells the reviewer whether Create starts work at once or waits for approval; create re-validates regardless.
        return plan.spec ? { ...plan, review: planReview(plan.spec, envelope, rt.executorFacts()) } : plan;
      }
      default: throw new CommandRefusedError("Unknown task action.");
    }
  } catch (error) {
    if (error instanceof CommandRefusedError) throw error;
    // Validation, conflicts and authority refusals executed nothing: they are refusals, not Host failures.
    throw new CommandRefusedError(error instanceof Error ? error.message.slice(0, 600) : "The Host refused this task change.");
  }
}
