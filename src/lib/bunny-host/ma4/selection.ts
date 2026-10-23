import { z } from "zod";
import type { ProviderId } from "../../orch/types.ts";
import type { Plan } from "../../bunny-missions/planner.server.ts";
import { CommandRefusedError } from "../failure.server.ts";

const pin = z.object({ provider: z.enum(["codex", "claude", "ollama", "openrouter"]), model: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.:/-]{0,179}$/).optional() }).strict();
export const SelectionSchema = z.object({
  task: pin.optional(), agents: z.record(z.string().min(1).max(100), pin).default({}),
}).strict();
export type ModelSelection = z.infer<typeof SelectionSchema>;
export class ModelApprovalRequired extends CommandRefusedError {
  readonly code = "MODEL_APPROVAL_REQUIRED";
  constructor(reason = "The explicitly selected model is unavailable or ineligible.") { super(`${reason} Approve a different model before continuing; no alternative was selected.`); }
}

/** Recognize only a leading owner directive; never scan quoted documents or model output for authority. */
export function ownerDirective(text: string): ModelSelection | null {
  const hybrid = /^(?:bunny[, ]+)?(?:please\s+)?use\s+(claude|codex|ollama|openrouter)(?:\s+model\s+([a-zA-Z0-9][a-zA-Z0-9_.:/-]{0,179}))?\s+for\s+(coding|testing|planning|review|debugging)\b/i.exec(text.trim());
  if (hybrid) {
    const role = hybrid[3][0].toUpperCase() + hybrid[3].slice(1).toLowerCase();
    return { agents: { [role]: { provider: hybrid[1].toLowerCase() as "claude" | "codex" | "ollama" | "openrouter", ...(hybrid[2] ? { model: hybrid[2] } : {}) } } };
  }
  const m = /^(?:bunny[, ]+)?(?:please\s+)?use\s+(claude|codex|ollama|openrouter)(?:\s+model\s+([a-zA-Z0-9][a-zA-Z0-9_.:/-]{0,179}))?(?:\s+for\s+(?:this\s+)?(?:entire\s+)?task)?(?:[.,:!]|\s*$)/i.exec(text.trim());
  return m ? { task: { provider: m[1].toLowerCase() as "claude" | "codex" | "ollama" | "openrouter", ...(m[2] ? { model: m[2] } : {}) }, agents: {} } : null;
}

/** Applied by the existing MA3 planner on every plan/replan, with no new runtime or tool authority. */
export function applySelection(plan: Plan, raw: unknown): Plan {
  if (raw === undefined) return plan;
  const selection = SelectionSchema.parse(raw);
  for (const role of Object.keys(selection.agents)) if (!plan.steps.some(s => s.executor.kind === "model" && (s.key === role || s.role === role))) throw new Error(`Pinned agent role ${role} is absent from the proposed plan; revise the plan before continuing.`);
  return { ...plan, steps: plan.steps.map(step => {
    if (step.executor.kind !== "model") return step;
    const agent = selection.agents[step.key] ?? selection.agents[step.role];
    if (selection.task && agent && (selection.task.provider !== agent.provider || selection.task.model !== agent.model)) throw new Error("Agent pin conflicts with the whole-task model constraint.");
    const chosen = selection.task ?? agent;
    if (!chosen) return step;
    const allow = step.providerConstraints.allow;
    if (allow && !allow.includes(chosen.provider)) throw new ModelApprovalRequired();
    if (step.modelConstraint && chosen.model && step.modelConstraint !== chosen.model) throw new ModelApprovalRequired();
    return { ...step, providerConstraints: { ...step.providerConstraints, allow: [chosen.provider as ProviderId] }, modelConstraint: chosen.model ?? step.modelConstraint };
  }) };
}
