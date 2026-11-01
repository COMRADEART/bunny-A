/**
 * uof-adopt — Phase 1B adoption seam: the three UOF lane modules (route-ledger,
 * capability-surface, coordinator-fence) bridged onto the merged uof.v1 contract
 * vocabulary (`./contracts.ts`). Every produced record is contract-checkable, so
 * the integration gate can feed whole lane outputs through `validateBundle`.
 *
 * Pure module; additive; the lane modules themselves stay untouched (they are
 * freshly merged and CI-validated).
 */
import {
  ContractBundleSchema,
  validateBundle,
  type Capability,
  type ContractBundle,
  type BundleViolation,
  type CoordinatorEpoch,
  type ExecutionEvent,
  type Lease,
  type QuotaSignal as ContractQuotaSignal,
  type UsageEstimate,
} from "./contracts.ts";
import type { RouteDecision, RouteOutcome } from "./route-ledger.ts";
import type { CapabilityRecord } from "./capability-surface.ts";

/** uof.v1 ExecutionEvent for a recorded route decision (W1.5: reason + alternatives). */
export function decisionEvent(decision: RouteDecision, taskId: string, seq: number, atMs: number): ExecutionEvent {
  return {
    eventId: `ev-${decision.decisionId}`,
    taskId,
    seq,
    atMs,
    kind: "route_selected",
    note: decision.reason,
    attemptId: undefined,
  };
}

/** uof.v1 ExecutionEvent for an attempt outcome; the kind mapping is total. */
export function outcomeEvent(outcome: RouteOutcome, taskId: string, seq: number, atMs: number): ExecutionEvent {
  const kindMap: Record<RouteOutcome["outcome"], ExecutionEvent["kind"]> = {
    success: "completed",
    verify_failed: "failure",
    quota_exhausted: "quota_signal",
    provider_failed: "failure",
    cancelled: "cancelled",
  };
  return {
    eventId: `ev-${outcome.attemptId}`,
    taskId,
    seq,
    atMs,
    kind: kindMap[outcome.outcome],
    note: `outcome ${outcome.outcome} on attempt ${outcome.attemptId}`,
    attemptId: outcome.attemptId,
  };
}

/** uof.v1 UsageEstimate from a decision + the winning candidate's dollar figure. */
export function usageEstimate(
  decision: RouteDecision,
  amountUsd: number | null,
  estimateId: string,
): UsageEstimate {
  const basis = decision.chosenCostBasis;
  if (basis === null) throw new Error("decideRoute returned no choice; no estimate exists");
  if (basis === "unknown" && amountUsd !== null) throw new Error("basis=unknown forbids an amount");
  if (basis !== "unknown" && amountUsd === null) throw new Error("basis=known|estimated requires an amount");
  return { estimateId, subtaskId: null, cost: { amountUsd, basis }, latencyP50Ms: null };
}

/** uof.v1 Capability from a capability-surface record (tri-state + provenance notes carry over verbatim). */
export function capabilityToUof(record: CapabilityRecord): Capability {
  return {
    capabilityId: record.capabilityId,
    adapterId: null,
    connectorId: null,
    deviceId: null,
    modelId: null,
    modality: record.modality,
    status: record.status,
    toolUse: record.toolUse,
    evidenceNote: record.evidenceNote,
    lastProbeAtMs: record.lastProbeAtMs,
  };
}

/** uof.v1 QuotaSignal from a capability-surface signal; account/device refs are lane-side unknowns (null). */
export function quotaToUof(signal: { quotaSignalId: string; windowLabel: string; usedPercent: number | null; resetsAtMs: number | null; source: "provider_api" | "http_429" | "local_observed"; observedAtMs: number; note?: string }): ContractQuotaSignal {
  return {
    quotaSignalId: signal.quotaSignalId,
    accountRef: null,
    deviceId: null,
    windowLabel: signal.windowLabel,
    usedPercent: signal.usedPercent,
    resetsAtMs: signal.resetsAtMs,
    source: signal.source,
    observedAtMs: signal.observedAtMs,
    note: signal.note,
  };
}

/** uof.v1 Lease from a coordinator-fence lease (shape-coincident by design). */
export function leaseToUof(lease: { leaseId: string; resourceRef: string; holderDeviceId: string; epoch: number; expiresAtMs: number; heartbeatMs: number }): Lease {
  return {
    leaseId: lease.leaseId,
    resourceRef: lease.resourceRef,
    holderDeviceId: lease.holderDeviceId,
    epoch: lease.epoch,
    expiresAtMs: lease.expiresAtMs,
    heartbeatMs: lease.heartbeatMs,
  };
}

/** uof.v1 CoordinatorEpoch record from the fence's takeover arithmetic. */
export function epochToUof(epoch: number, coordinatorDeviceId: string, startedAtMs: number): CoordinatorEpoch {
  if (!Number.isInteger(epoch) || epoch < 1) throw new Error("epoch must be a positive integer");
  return { epoch, coordinatorDeviceId, startedAtMs, fenceToken: `f-${String(epoch).padStart(4, "0")}` };
}

/** Assemble a contract-checkable bundle from adopted lane records (sparse sections default empty). */
export function toBundle(input: {
  tasks: ContractBundle["tasks"];
  subtasks?: ContractBundle["subtasks"];
  dependencies?: ContractBundle["dependencies"];
  plans?: ContractBundle["plans"];
  events?: ExecutionEvent[];
  capabilities?: Capability[];
  quotaSignals?: ContractQuotaSignal[];
  usageEstimates?: UsageEstimate[];
  devices?: ContractBundle["devices"];
  resultArtifacts?: ContractBundle["resultArtifacts"];
  verificationEvidence?: ContractBundle["verificationEvidence"];
  leases?: Lease[];
  coordinatorEpochs?: CoordinatorEpoch[];
}): { bundle: ContractBundle; violations: BundleViolation[] } {
  const bundle = ContractBundleSchema.parse({
    contractsVersion: "uof.v1",
    tasks: input.tasks,
    subtasks: input.subtasks ?? [],
    dependencies: input.dependencies ?? [],
    plans: input.plans ?? [],
    events: input.events ?? [],
    adapters: [],
    connectors: [],
    entitlements: [],
    capabilities: input.capabilities ?? [],
    harnesses: [],
    devices: input.devices ?? [],
    modelArtifacts: [],
    quotaSignals: input.quotaSignals ?? [],
    usageEstimates: input.usageEstimates ?? [],
    policyDecisions: [],
    approvals: [],
    resultArtifacts: input.resultArtifacts ?? [],
    verificationEvidence: input.verificationEvidence ?? [],
    leases: input.leases ?? [],
    coordinatorEpochs: input.coordinatorEpochs ?? [],
  }) as ContractBundle;
  return { bundle, violations: validateBundle(bundle) };
}