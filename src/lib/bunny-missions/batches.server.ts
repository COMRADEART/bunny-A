import type { ActionManifest, ApprovalBatch, AuthorizationEnvelope, BatchView, PermissionBatchOffer, RiskClass } from "./types.ts";
import { APP_LABELS, BATCH_ACTION_LABELS, batchActionLabel, targetLabelOf } from "./batch-labels.ts";

export { APP_LABELS, BATCH_ACTION_LABELS, batchActionLabel, targetLabelOf };

/**
 * Gate T9 — Bounded Desktop Approval Batching. Everything batch-shaped lives here: eligibility,
 * the truthfully computed offer shown on the approval card, target binding, post-run drift review
 * and the labels the user sees. Consulted only after `decide()` has returned an ordinary "ask";
 * a batch never converts a "deny" and never applies outside its single mission.
 *
 * Boundaries preserved by this module's structure (not by string lists):
 * - Only the `computer` family participates. Shell, browser, git, filesystem and connector actions
 *   are structurally outside the batch.
 * - `sensitive` and `hardApproval` manifests are never covered (sensitive reads still ask).
 * - Escalation-aware risk above EXECUTE is never covered (risk ceiling).
 * - Target matching is strictest verified identity available: explicit pid first; title-filtered
 *   flows are admitted as a hypothesis verified post-run (observed pid vs pinned pid) and any
 *   mismatch ends the batch immediately.
 */

export const BATCH_FAMILY = "computer";
export const BATCH_TTL_MS = 120_000;
/** Never more than this many admitted mutating executions per batch. */
export const BATCH_HARD_MAX = 12;
/** One pass's worth of executions is doubled for restart/retry headroom, capped at the hard max. */
export const BATCH_HEADROOM = 2;
export const RISK_CEILING = "EXECUTE" as const;

const RANK: RiskClass[] = ["READ", "WRITE", "EXECUTE", "EXTERNAL_SIDE_EFFECT", "DESTRUCTIVE"];
const rankOf = (risk: RiskClass) => RANK.indexOf(risk);
export const riskAtMost = (risk: RiskClass, ceiling: RiskClass) => rankOf(risk) >= 0 && rankOf(risk) <= rankOf(ceiling);

/** The Host boot epoch. A batch never matches outside it, even if recovery was interrupted. */
let epoch = crypto.randomUUID();
export function currentBatchEpoch() { return epoch; }
/** Test hook: simulates a Host reboot so the epoch boundary can be exercised without a restart. */
export function rotateBatchEpochForTest() { epoch = crypto.randomUUID(); }

export type BatchPlanEntry = { action: string; params: Record<string, unknown> };

const SENSITIVE_TARGET = /(passw|\bpwd\b|secret|token|credential|\bpin\b|credit|card|\bcvv\b|\bssn\b|api[_-]?key)/i;

/**
 * Conservative refusal when the target control looks like a sensitive input. Reads only the control
 * identity metadata (automation id / name / title) — never the value being typed, which is never
 * stored anywhere (redaction is unchanged).
 */
export function sensitiveTarget(action: string, params: Record<string, unknown>): boolean {
  if (action !== "computer.type" && action !== "computer.invoke_control") return false;
  return [params.automationId, params.name, params.title].some((value) => typeof value === "string" && SENSITIVE_TARGET.test(value));
}

/** The identifiable desktop target of one request, else null when it carries none. */
export function targetOf(action: string, params: Record<string, unknown>): { app: string | null; processId: number | null; title: string | null } | null {
  if (action === "computer.open_app") {
    const app = typeof params.app === "string" ? params.app.toLowerCase() : null;
    return app ? { app, processId: null, title: null } : null;
  }
  const pid = params.pid === undefined ? null : Number(params.pid);
  const title = typeof params.title === "string" ? params.title : null;
  if (Number.isInteger(pid) && pid !== null && pid > 0) return { app: null, processId: pid, title };
  if (title) return { app: null, processId: null, title };
  return null;
}

/** One request's batch eligibility: implemented, not sensitive, not hard-approval, at/below the ceiling, identifiable, not a sensitive target. */
export function requestBatchable(manifest: ActionManifest, action: string, params: Record<string, unknown>, risk: RiskClass): boolean {
  if (action.split(".")[0] !== BATCH_FAMILY) return false;
  if (!manifest.implemented || manifest.sensitive || manifest.hardApproval) return false;
  if (!riskAtMost(risk, RISK_CEILING)) return false;
  if (sensitiveTarget(action, params)) return false;
  return targetOf(action, params) !== null || action === "computer.list_windows";
}

/** The single observed window owner in a structured Computer Runtime output, when there is one. */
export function extractObservedPid(output: unknown): number | null {
  if (!output || typeof output !== "object") return null;
  const out = output as Record<string, unknown>;
  // `windowPid` is the Runtime's declaration of the matched top-level window's owning process —
  // the identity a batch binds to. On UWP hosts the controls live in a separate content process
  // whose pid differs from the window owner, so the declared windowPid outranks the element
  // pids; the remaining fields are fallbacks for outputs that carry no windowPid (focus, list_windows).
  const direct = (value: unknown): number | null => typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
  const from = direct(out.windowPid) ?? direct(out.pid)
    ?? direct((out.target as Record<string, unknown> | null)?.processId)
    ?? direct((out.control as Record<string, unknown> | null)?.processId) ?? direct((out.window as Record<string, unknown> | null)?.processId)
    ?? direct(out.processId);
  return from;
}

/**
 * The offer the Host attaches to a permission request: the exact covered actions with their
 * per-pass execution counts, read-only entries excluded from the budget. Null unless at least two
 * mutating executions are coverable — single-action flows keep today's plain "Allow once" UI.
 */
export function batchOffer(opts: {
  askAction: string; askParams: Record<string, unknown>;
  plan: BatchPlanEntry[];
  find: (action: string) => ActionManifest | null;
  riskOf: (action: string, params: Record<string, unknown>) => RiskClass | null;
}): PermissionBatchOffer | null {
  const { askAction, askParams, plan, find, riskOf } = opts;
  const family = askAction.split(".")[0];
  const eligible = (entry: BatchPlanEntry): number | null => {
    const manifest = find(entry.action);
    if (!manifest) return null;
    const risk = riskOf(entry.action, entry.params) ?? manifest.risk;
    if (!requestBatchable(manifest, entry.action, entry.params, risk)) return null;
    if (sensitiveTarget(entry.action, entry.params)) return null;
    return risk === "READ" ? 0 : 1;
  };
  if (family !== BATCH_FAMILY) return null;
  const askManifest = find(askAction);
  if (!askManifest) return null;
  const askRisk = riskOf(askAction, askParams) ?? askManifest.risk;
  if (!requestBatchable(askManifest, askAction, askParams, askRisk)) return null;
  if (sensitiveTarget(askAction, askParams)) return null;
  if (targetOf(askAction, askParams) === null) return null;

  const inPlan = plan.filter((entry) => entry.action.split(".")[0] === family);
  const counts: Record<string, number> = {}; const readOnly = new Set<string>();
  let mutating = 0;
  const cover = (entry: BatchPlanEntry) => {
    const weight = eligible(entry);
    if (weight == null) return;
    counts[entry.action] = (counts[entry.action] ?? 0) + weight;
    if (weight === 0) readOnly.add(entry.action);
    else mutating += 1;
  };
  cover({ action: askAction, params: askParams });
  for (const entry of inPlan) cover(entry);
  if (mutating < 2) return null;
  const actions = Object.keys(counts).sort();
  const target = targetOf(askAction, askParams)!;
  return {
    actions, counts,
    maxActions: Math.min(BATCH_HEADROOM * mutating, BATCH_HARD_MAX),
    ttlMs: BATCH_TTL_MS,
    riskCeiling: RISK_CEILING,
    targetLabel: targetLabelOf(target),
    target,
    targetTier: target.processId != null ? "process" : "app",
    family: BATCH_FAMILY,
    readOnly: [...readOnly].sort(),
  };
}

export type BatchConsult = { match: boolean; reason: string | null; consume: boolean } | null;

/** Does this active batch cover one concrete request? `stepIds` is the mission's own planned step set (delegated provider steps never match). */
export function consultBatch(batch: ApprovalBatch, opts: {
  action: string; params: Record<string, unknown>;
  manifest: ActionManifest; risk: RiskClass;
  envelope: AuthorizationEnvelope | null; now: number;
  stepIds: Set<string>; stepId: string | null; epoch: string;
}): BatchConsult {
  const { action, params, manifest, risk, envelope, now, stepIds, stepId, epoch } = opts;
  if (batch.status !== "active" || batch.batchEpoch !== epoch || batch.expiresAt <= now) return null;
  if (action.split(".")[0] !== batch.family || !batch.actions.includes(action)) return { match: false, reason: null, consume: false };
  if (!stepIds.has(stepId ?? "")) return { match: false, reason: null, consume: false };
  if (!envelope || envelope.id !== batch.authorizationId) return { match: false, reason: null, consume: false };
  if (envelope.revokedAt || envelope.expiresAt <= now) return { match: false, reason: null, consume: false };
  if (!envelope.computer.enabled || !envelope.capabilities.includes(action)) return { match: false, reason: null, consume: false };
  if (!requestBatchable(manifest, action, params, risk)) return { match: false, reason: null, consume: false };
  const target = targetOf(action, params);
  const pidBound = batch.observedPid ?? batch.target.processId;
  const pidVerified = batch.observedPidFrom != null || batch.target.processId != null;
  if (target === null) {
    // Identity-less covered reads (window listing) are allowed while the batch lives.
    if (risk !== "READ") return { match: false, reason: null, consume: false };
    return { match: true, reason: `read-only step inside approval batch ${batch.id} (${batch.usedCount + 1} of ${batch.maxActions} mutating actions used).`, consume: false };
  }
  if (target.processId != null && pidBound != null && pidVerified) {
    if (target.processId !== pidBound) return { match: false, reason: null, consume: false };
    return { match: true, reason: `inside approval batch ${batch.id} for this window (${batch.usedCount + 1} of ${batch.maxActions} mutating actions used).`, consume: risk !== "READ" };
  }
  if (target.processId != null && pidVerified && pidBound == null) return { match: false, reason: null, consume: false };
  if (target.app != null && batch.target.app === target.app) return { match: true, reason: `inside approval batch ${batch.id} for ${targetLabelOf(batch.target)} (${batch.usedCount + 1} of ${batch.maxActions} mutating actions used).`, consume: risk !== "READ" };
  if (target.title != null && batch.target.title != null && batch.target.title === target.title) return { match: true, reason: `inside approval batch ${batch.id} for this window (${batch.usedCount + 1} of ${batch.maxActions} mutating actions used).`, consume: risk !== "READ" };
  if (target.title != null && batch.target.app != null && target.title.toLowerCase().includes(batch.target.app)) return { match: true, reason: `inside approval batch ${batch.id} for ${targetLabelOf(batch.target)} (${batch.usedCount + 1} of ${batch.maxActions} mutating actions used).`, consume: risk !== "READ" };
  if (pidBound == null || !pidVerified) return { match: false, reason: null, consume: false };
  return { match: false, reason: null, consume: false };
}

/** Display summary for the mission snapshot's active batch (canonical counts only). */
export function batchView(batch: ApprovalBatch, now: number): BatchView {
  const expired = batch.expiresAt <= now;
  return {
    id: batch.id,
    maxActions: batch.maxActions,
    usedCount: batch.usedCount,
    targetLabel: targetLabelOf(batch.target),
    createdAt: batch.createdAt,
    expiresAt: batch.expiresAt,
    status: batch.status === "ended" || expired ? "ended" : "active",
    endReason: batch.endReason ?? (batch.status === "ended" ? null : expired ? "expired" : null),
  };
}