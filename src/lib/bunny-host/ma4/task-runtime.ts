/**
 * MA4-S2-T1 persistent task vocabulary: the durable task state machine, the immutable task specification, the owner's
 * authorization envelope and the user-facing display states. Pure: the store persists, the runtime executes. Nothing
 * here grants authority — an envelope only narrows what the Host already allows (local models, registered executors).
 */
import { createHash } from "node:crypto";
import { z } from "zod";

export const TASK_SCHEMA_VERSION = 1;
export const TASK_STATES = ["CREATED", "VALIDATED", "AWAITING_APPROVAL", "QUEUED", "RUNNING", "PAUSED", "RESUMING", "COMPLETED", "FAILED", "CANCELLED", "UNCERTAIN"] as const;
export type TaskState = (typeof TASK_STATES)[number];
/** Explicit transition table. Terminal states never exit; UNCERTAIN leaves only through the owner's reconciliation. */
export const TASK_NEXT: Readonly<Record<TaskState, readonly TaskState[]>> = {
  CREATED: ["VALIDATED", "FAILED"],
  VALIDATED: ["AWAITING_APPROVAL", "QUEUED", "FAILED", "CANCELLED"],
  // QUEUED → AWAITING_APPROVAL: the approval expired before a worker claimed the task.
  AWAITING_APPROVAL: ["QUEUED", "FAILED", "CANCELLED"],
  QUEUED: ["RUNNING", "PAUSED", "AWAITING_APPROVAL", "FAILED", "CANCELLED"],
  // RUNNING → RESUMING: the worker's lease was lost (Host crash, sleep, kill) and recovery took the task over.
  RUNNING: ["PAUSED", "RESUMING", "COMPLETED", "FAILED", "CANCELLED", "UNCERTAIN", "AWAITING_APPROVAL"],
  PAUSED: ["RESUMING", "FAILED", "CANCELLED"],
  RESUMING: ["RUNNING", "PAUSED", "AWAITING_APPROVAL", "FAILED", "CANCELLED", "UNCERTAIN"],
  UNCERTAIN: ["QUEUED", "FAILED", "CANCELLED"],
  COMPLETED: [], FAILED: [], CANCELLED: [],
};
export const TERMINAL_TASK_STATES: readonly TaskState[] = ["COMPLETED", "FAILED", "CANCELLED"];
export function taskCanTransition(from: TaskState, to: TaskState): boolean { return TASK_NEXT[from]?.includes(to) ?? false; }

/** Read-only work may be retried; idempotent work is retried under one stable key after a lookup; irreversible work is never replayed. */
export const OPERATION_CATEGORIES = ["read_only", "idempotent", "irreversible"] as const;
export type OperationCategory = (typeof OPERATION_CATEGORIES)[number];

const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/);
const scalar = z.union([z.string().max(8_000), z.number().finite(), z.boolean(), z.null()]);
export const StepSpecSchema = z.object({
  id,
  kind: z.string().regex(/^[a-z][a-z0-9.-]{1,47}$/),
  /** Flat scalars only, bounded: a step input never carries nested provider state or binary material. */
  input: z.record(z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/), scalar).refine(o => Object.keys(o).length <= 16, "At most 16 input fields."),
  /** Hard model pin for GPU steps. Never substituted: an unavailable pin blocks the task. */
  model: z.string().min(1).max(180).nullable().default(null),
  maxAttempts: z.number().int().min(1).max(3).default(2),
}).strict();
export const TaskSpecSchema = z.object({
  title: z.string().trim().min(1).max(120),
  projectId: id,
  steps: z.array(StepSpecSchema).min(1).max(32),
  /** Tasks that must COMPLETE first; same project only, and they must already exist (so no cycle can form). */
  dependsOn: z.array(id).max(16).default([]),
  /** Immutable acceptance contract: these steps must succeed with a receipt for the task to complete. */
  acceptance: z.object({ requiredSteps: z.array(id).min(1).max(32), description: z.string().max(400).default("") }).strict(),
  deadlineAt: z.number().int().positive().nullable().default(null),
}).strict();
export type StepSpec = z.infer<typeof StepSpecSchema>;
export type TaskSpec = z.infer<typeof TaskSpecSchema>;

/** The owner-issued authorization envelope. Cloud inference is not expressible: provider and locality are literals. */
export const EnvelopeSchema = z.object({
  capabilities: z.array(z.string().regex(/^[a-z][a-z0-9.-]{1,47}$/)).min(1).max(16),
  providers: z.tuple([z.literal("ollama")]),
  localOnly: z.literal(true),
  models: z.array(z.string().min(1).max(180)).max(8),
  projectScopes: z.array(id).min(1).max(4),
  sideEffects: z.boolean(),
  background: z.boolean(),
  budgets: z.object({ maxModelCalls: z.number().int().min(0).max(500), maxWallMs: z.number().int().min(1_000).max(7 * 24 * 3_600_000) }).strict(),
  expiresAt: z.number().int().positive(),
}).strict();
export type Envelope = z.infer<typeof EnvelopeSchema>;

export type StepState = "pending" | "running" | "succeeded" | "failed" | "uncertain";
export type TaskFailureCode = "VALIDATION" | "AUTHORITY_REVOKED" | "ENVELOPE_EXPIRED" | "DEADLINE_MISSED" | "DEPENDENCY_FAILED" | "STEP_FAILED" | "BUDGET_EXHAUSTED" | "PIN_VIOLATION" | "ACCEPTANCE_UNMET" | "OWNER_ABANDONED";
export type BlockCode = "MODEL_UNAVAILABLE" | "RESOURCES_UNAVAILABLE" | "BACKGROUND_DISABLED" | "HOST_RESTARTED" | "OWNER_PAUSED";
export type TaskRecord = {
  schema: "ma4.task.v1";
  id: string;
  owner: "workstation";
  projectId: string;
  spec: TaskSpec;
  specSha256: string;
  envelope: Envelope;
  envelopeSha256: string;
  state: TaskState;
  createdAt: number;
  updatedAt: number;
  /** The approval binds the exact spec and envelope hashes and always expires; history never becomes standing authority. */
  approval: { by: "workstation"; at: number; expiresAt: number; specSha256: string; envelopeSha256: string; round: number } | null;
  approvalRequired: boolean;
  revokedAt: number | null;
  steps: { id: string; state: StepState; attempts: number; outputSha256: string | null; error: string | null }[];
  usage: { modelCalls: number; workMs: number };
  controls: { pauseRequested: boolean; cancelRequested: boolean };
  blocked: { code: BlockCode; detail: string; at: number } | null;
  failure: { code: TaskFailureCode; detail: string } | null;
  /** Owner reconciliation is pending for this operation key. */
  uncertainOperation: string | null;
  /** Wall-clock gaps the Host observed while it could not run (sleep, suspend); no progress is ever claimed for them. */
  suspendedMs: number;
};

export const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
/** Canonical JSON (sorted keys) so a hash does not depend on property order. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`).join(",")}}`;
  return JSON.stringify(value);
}

export type ExecutorFacts = { kind: string; category: OperationCategory; gpu: boolean; sideEffect: boolean };
/**
 * Validation against the envelope and the Host's registered executors. The executor — never the spec — decides an
 * operation's category, so a spec cannot relabel an irreversible action as read-only. Returns problems, not a verdict.
 */
export function validateTask(spec: TaskSpec, envelope: Envelope, executors: ReadonlyMap<string, ExecutorFacts>, now: number): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  for (const step of spec.steps) {
    if (ids.has(step.id)) problems.push(`Duplicate step id ${step.id}.`);
    ids.add(step.id);
    const executor = executors.get(step.kind);
    if (!executor) { problems.push(`No registered executor for ${step.kind}.`); continue; }
    if (!envelope.capabilities.includes(step.kind)) problems.push(`Step ${step.id} needs capability ${step.kind}, which the envelope does not grant.`);
    if (executor.sideEffect && !envelope.sideEffects) problems.push(`Step ${step.id} has side effects; the envelope does not permit them.`);
    if (executor.gpu && !step.model) problems.push(`Step ${step.id} needs a pinned local model.`);
    if (step.model && !envelope.models.includes(step.model)) problems.push(`Model ${step.model} is not in the envelope.`);
  }
  for (const required of spec.acceptance.requiredSteps) if (!ids.has(required)) problems.push(`Acceptance names unknown step ${required}.`);
  if (!envelope.projectScopes.includes(spec.projectId)) problems.push("The task's project is outside the envelope's scope.");
  if (envelope.expiresAt <= now) problems.push("The authorization envelope has already expired.");
  if (spec.deadlineAt !== null && spec.deadlineAt <= now) problems.push("The deadline is already past.");
  if (spec.deadlineAt !== null && spec.deadlineAt > envelope.expiresAt) problems.push("The deadline lies beyond the envelope's expiry.");
  return problems;
}
/** Approval is required whenever impact demands it: side effects, or work that may continue without the user present. */
export function approvalRequired(spec: TaskSpec, envelope: Envelope, executors: ReadonlyMap<string, ExecutorFacts>): boolean {
  return envelope.background || envelope.sideEffects || spec.steps.some(s => executors.get(s.kind)?.category !== "read_only");
}

export const DISPLAY_STATES = ["Queued", "Working", "Waiting for approval", "Paused", "Recovering", "Needs attention", "Completed", "Failed", "Cancelled"] as const;
export type DisplayState = (typeof DISPLAY_STATES)[number];
/** What the notch, dashboard and phone show. Derived from the trusted record only, never from a remembered animation. */
export function displayState(task: Pick<TaskRecord, "state" | "blocked">): DisplayState {
  switch (task.state) {
    case "CREATED": case "VALIDATED": case "QUEUED": return "Queued";
    case "RUNNING": return "Working";
    case "AWAITING_APPROVAL": return "Waiting for approval";
    case "PAUSED": return task.blocked && task.blocked.code !== "OWNER_PAUSED" && task.blocked.code !== "BACKGROUND_DISABLED" && task.blocked.code !== "HOST_RESTARTED" ? "Needs attention" : "Paused";
    case "RESUMING": return "Recovering";
    case "UNCERTAIN": return "Needs attention";
    case "COMPLETED": return "Completed";
    case "FAILED": return "Failed";
    case "CANCELLED": return "Cancelled";
  }
}

/** The privacy-safe view for every surface. Step inputs (prompts) and outputs never leave the store through it. */
export type TaskView = {
  id: string; title: string; projectId: string; state: TaskState; display: DisplayState; version: number;
  createdAt: number; updatedAt: number; deadlineAt: number | null;
  progress: { done: number; total: number; current: string | null };
  approval: { required: boolean; approvedUntil: number | null };
  background: boolean; blocked: { code: BlockCode; detail: string } | null; failure: { code: TaskFailureCode; detail: string } | null;
  uncertainOperation: string | null; models: string[]; dependsOn: string[];
  evidence: { stepId: string; outputSha256: string }[];
  corrupt?: false;
};
export type CorruptTaskView = { id: string; corrupt: true; display: "Needs attention"; detail: string };
export function taskView(task: TaskRecord, version: number): TaskView {
  const done = task.steps.filter(s => s.state === "succeeded").length;
  const current = task.steps.find(s => s.state !== "succeeded")?.id ?? null;
  return {
    id: task.id, title: task.spec.title, projectId: task.projectId, state: task.state, display: displayState(task), version,
    createdAt: task.createdAt, updatedAt: task.updatedAt, deadlineAt: task.spec.deadlineAt,
    progress: { done, total: task.steps.length, current: TERMINAL_TASK_STATES.includes(task.state) ? null : current },
    approval: { required: task.approvalRequired, approvedUntil: task.approval?.expiresAt ?? null },
    background: task.envelope.background, blocked: task.blocked ? { code: task.blocked.code, detail: task.blocked.detail } : null,
    failure: task.failure, uncertainOperation: task.uncertainOperation,
    models: [...new Set(task.spec.steps.flatMap(s => s.model ? [s.model] : []))], dependsOn: task.spec.dependsOn,
    evidence: task.steps.flatMap(s => s.outputSha256 ? [{ stepId: s.id, outputSha256: s.outputSha256 }] : []),
  };
}
