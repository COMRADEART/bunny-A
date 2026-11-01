import { z } from "zod";
import type { Availability, ProviderId } from "./types.ts";

/**
 * Bunny A Unified Orchestration Framework (UOF) shared contracts, versioned uof.v1.
 *
 * These are the nouns the coordinator, provider adapters, execution harnesses,
 * device fabric, and the Windows/Android UI exchange. Rules baked into this file:
 *  - ids are opaque strings; never assume meaning from them.
 *  - times are epoch milliseconds (suffix `Ms`), `null` when not yet known.
 *  - unknown cost is NOT zero: `UsageEstimate.cost.basis` says known/estimated/unknown.
 *  - secrets are forbidden here: references only (`accountRef`, `credentialRef`...);
 *    `assertNoSecretKeys` is the mechanical guard.
 *  - events are append-only audit records: monotonic `seq` per task, never rewritten.
 *
 * Versioning: breaking changes to any entity below bump the version suffix
 * (uof.v2, ...) and ship a migration note in docs/roadmap/. Additive fields are
 * allowed within a version because zod defaults strip/ignore unknown keys here.
 */
export const CONTRACTS_VERSION = "uof.v1" as const;

const OpaqueId = z.string().min(1);
const EpochMs = z.number().int().nonnegative();
const EpochMsOrNull = z.number().int().nonnegative().nullable();

export const TaskStateSchema = z.enum(["open", "running", "blocked", "completed", "failed", "cancelled"]);
export const SubtaskStateSchema = z.enum(["pending", "ready", "running", "waiting_approval", "verifying", "done", "failed", "cancelled"]);
export const RiskSchema = z.enum(["low", "medium", "high"]);

export const TaskSchema = z.object({
  taskId: OpaqueId,
  /** One goal in the user's own words; the coordinator decomposes it. */
  goal: z.string().min(1),
  traceId: OpaqueId,
  createdAtMs: EpochMs,
  priority: z.enum(["low", "normal", "high"]).default("normal"),
  state: TaskStateSchema,
  /** Reference into the user's named policy set; when set, PolicyDecisions cite it. */
  policySetRef: OpaqueId.optional(),
});

export const SubtaskSchema = z.object({
  subtaskId: OpaqueId,
  taskId: OpaqueId,
  kind: z.enum(["coding", "debug", "research", "writing", "ops", "general"]),
  /** Subtasks this one waits for (finish_to_start); `Dependency` carries the edge. */
  dependsOn: z.array(OpaqueId),
  risk: RiskSchema,
  /** 0..1 — measurable quality floor a candidate route must meet to stay eligible. */
  qualityTarget: z.number().min(0).max(1),
  /** Task-specific acceptance criteria the verifier checks before `done` (UOF rule: verify before complete). */
  acceptanceCriteria: z.array(z.string().min(1)).min(1),
  state: SubtaskStateSchema,
  /** Optional user hard-pin; an empty object means "coordinator chooses". */
  assignHint: z
    .object({
      provider: z.string().min(1).optional(),
      deviceId: OpaqueId.optional(),
      modelId: OpaqueId.optional(),
    })
    .optional(),
});

export const DependencySchema = z.object({
  dependencyId: OpaqueId,
  fromSubtaskId: OpaqueId,
  toSubtaskId: OpaqueId,
  /** v1 carries exactly one edge kind; more kinds are a version bump. */
  kind: z.literal("finish_to_start"),
});

export const ExecutionPlanSchema = z.object({
  planId: OpaqueId,
  taskId: OpaqueId,
  revision: z.number().int().positive(),
  createdAtMs: EpochMs,
  /** Dry-run plans produce the same artifacts and events but launch nothing. */
  dryRun: z.boolean(),
  subtasks: z.array(SubtaskSchema),
  dependencies: z.array(DependencySchema),
});

export const ExecutionEventKindSchema = z.enum([
  "task_created",
  "subtask_created",
  "plan_revised",
  "route_selected",
  "launched",
  "usage_recorded",
  "quota_signal",
  "approval_requested",
  "approval_resolved",
  "failure",
  "retry",
  "verified",
  "cancelled",
  "completed",
  "epoch_changed",
  "other",
]);

export const ExecutionEventSchema = z.object({
  eventId: OpaqueId,
  taskId: OpaqueId,
  /** Monotonic per task; replays and re-delivery must not regress it. */
  seq: z.number().int().positive(),
  atMs: EpochMs,
  kind: ExecutionEventKindSchema,
  /** Human-auditable detail; references other entities instead of embedding payloads. */
  note: z.string(),
  correlationId: OpaqueId.optional(),
  /** The attempt that produced the event; enables idempotent re-delivery handling. */
  attemptId: OpaqueId.optional(),
});

/** An integration Bunny A can drive: a provider bound to one adapter implementation. */
export const AgentAdapterSchema = z.object({
  adapterId: OpaqueId,
  provider: z.string().min(1),
  /** `uof.v1` knows adapters are per-provider, per-account, per-tool/per-harness, per-device. */
  version: z.string().optional(),
  availability: z.enum(["ready", "busy", "offline", "not_installed", "authentication_required", "rate_limited", "unavailable", "unknown"]) satisfies z.ZodType<Availability>,
});

export const ConnectorSchema = z.object({
  connectorId: OpaqueId,
  provider: z.string().min(1),
  /** Reference into the secret store; the secret itself never appears in contracts. */
  accountRef: OpaqueId,
  authMethod: z.enum(["oauth_pkce", "api_key", "local", "delegated_session"]),
  scopes: z.array(z.string()),
  status: z.enum(["ready", "busy", "offline", "not_installed", "authentication_required", "rate_limited", "unavailable", "unknown"]) satisfies z.ZodType<Availability>,
  /** What the account actually allows; a plan in product A is not an API entitlement in product B. */
  entitlementNote: z.string().optional(),
});

export const AccountEntitlementSchema = z.object({
  entitlementId: OpaqueId,
  accountRef: OpaqueId,
  plan: z.string().min(1),
  source: z.enum(["provider_reported", "terms", "unknown"]),
  limitations: z.array(z.string()),
  /** true only when a probe or official documentation verified it at `verifiedAtMs`. */
  verified: z.boolean(),
  verifiedAtMs: EpochMsOrNull,
});

/**
 * What some candidate (adapter / connector / model / device) can actually do.
 * Status is tri-state: `verified` (probe or real run), `reported` (advertised only),
 * `unavailable`. Never infer from an advertised model list alone.
 */
export const CapabilitySchema = z.object({
  capabilityId: OpaqueId,
  adapterId: OpaqueId.nullable(),
  connectorId: OpaqueId.nullable(),
  deviceId: OpaqueId.nullable(),
  modelId: OpaqueId.nullable(),
  modality: z.enum(["text", "image", "audio", "video", "code"]),
  status: z.enum(["verified", "reported", "unavailable"]),
  toolUse: z.boolean(),
  /** Where the status came from (probe id, doc, run receipt); empty is a contract violation. */
  evidenceNote: z.string().min(1),
  lastProbeAtMs: EpochMsOrNull,
});

export const ExecutionHarnessSchema = z.object({
  harnessId: OpaqueId,
  kind: z.enum(["local_process", "sandbox", "device_process", "cli"]),
  deviceId: OpaqueId.nullable(),
  /** Reference to the containment policy guarding this harness (seccomp/job-object/UIA gate...). */
  containmentPolicyRef: OpaqueId,
  maxRuntimeMs: z.number().int().positive(),
  maxAttempts: z.number().int().positive(),
});

export const DeviceNodeSchema = z.object({
  deviceId: OpaqueId,
  platform: z.enum(["windows", "android", "linux", "server"]),
  roles: z.array(z.enum(["coordinator", "worker"])).min(1),
  health: z.enum(["healthy", "degraded", "offline"]),
  /** Battery/thermal posture for workers; Android nodes are battery_aware unless overridden. */
  powerPolicy: z.enum(["unrestricted", "battery_aware", "plugged_in_only"]),
  lastSeenAtMs: EpochMsOrNull,
});

/** A downloadable model artifact for on-device runtimes (e.g. LiteRT-LM `.litertlm`). */
export const ModelArtifactSchema = z.object({
  modelId: OpaqueId,
  publisher: z.string().min(1),
  displayName: z.string().min(1),
  bytes: z.number().int().positive(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  source: z.enum(["official_publisher", "user_file"]),
  licenseId: z.string().nullable(),
  /** Filled when the user accepted download + license flows; null before install. */
  downloadedAtMs: EpochMsOrNull,
});

/** A quota/usage window as seen by Bunny A; never fabricated on a provider's behalf. */
export const QuotaSignalSchema = z.object({
  quotaSignalId: OpaqueId,
  accountRef: OpaqueId.nullable(),
  deviceId: OpaqueId.nullable(),
  windowLabel: z.string().min(1),
  /** Nullable: a 429 without a provider-reported window has honestly no fill number. */
  usedPercent: z.number().min(0).max(100).nullable(),
  resetsAtMs: EpochMsOrNull,
  source: z.enum(["provider_api", "http_429", "local_observed"]),
  observedAtMs: EpochMs,
  note: z.string().optional(),
});

/** Expected spend/latency of a candidate route. Unknown cost is unknown, not free. */
export const UsageEstimateSchema = z
  .object({
    estimateId: OpaqueId,
    subtaskId: OpaqueId.nullable(),
    cost: z.object({
      amountUsd: z.number().nonnegative().nullable(),
      basis: z.enum(["known", "estimated", "unknown"]),
    }),
    latencyP50Ms: z.number().int().nonnegative().nullable(),
    note: z.string().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.cost.basis === "known" && v.cost.amountUsd === null) {
      ctx.addIssue({ code: "custom", message: "cost.basis=known requires amountUsd" });
    }
    if (v.cost.basis === "unknown" && v.cost.amountUsd !== null) {
      ctx.addIssue({ code: "custom", message: "cost cannot carry an amount while basis=unknown" });
    }
  });

export const PolicyDecisionSchema = z.object({
  policyDecisionId: OpaqueId,
  /** What the decision governs: a task, subtask, tool call, or device action (opaque ref). */
  subjectRef: OpaqueId,
  decision: z.enum(["allow", "deny", "approval_required"]),
  reason: z.string().min(1),
  policySetRef: OpaqueId,
  atMs: EpochMs,
});

export const ApprovalRequestSchema = z.object({
  approvalId: OpaqueId,
  taskId: OpaqueId,
  subtaskId: OpaqueId.nullable(),
  /** What is being asked, in words the requester will see; no secrets. */
  request: z.string().min(1),
  riskLevel: RiskSchema,
  state: z.enum(["pending", "approved", "denied", "expired"]),
  /** Invariant (test-locked at runtime elsewhere): spoken phrases never resolve approvals. */
  spokenPhraseNeverCounts: z.literal(true),
  requestedAtMs: EpochMs,
  resolvedAtMs: EpochMsOrNull,
});

/** Something a subtask produced, with provenance; digests make artifacts checkable. */
export const ResultArtifactSchema = z.object({
  artifactId: OpaqueId,
  subtaskId: OpaqueId,
  kind: z.enum(["text", "file", "patch", "report", "image"]),
  /** Reference to the artifact file in Bunny A's own storage, not a raw secret or content blob. */
  path: z.string().nullable(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/).nullable(),
  /** Adapter + device that produced it (provenance chain head). */
  producedBy: z.string().min(1),
  createdAtMs: EpochMs,
});

/** Evidence that a result meets the subtask's acceptance criteria (Track C: result verification). */
export const VerificationEvidenceSchema = z.object({
  verificationId: OpaqueId,
  artifactId: OpaqueId,
  method: z.enum(["automated_check", "reviewer", "benchmark"]),
  criteria: z.array(z.string().min(1)).min(1),
  passed: z.boolean().nullable(),
  verifierRef: z.string().min(1),
  atMs: EpochMs,
  notes: z.string().optional(),
});

/** A fencing lease on a serialized resource (task ownership, destructive side effect...). */
export const LeaseSchema = z.object({
  leaseId: OpaqueId,
  resourceRef: OpaqueId,
  holderDeviceId: OpaqueId,
  /** Fence token; grows with each takeover. Actions carry (epoch, fenceToken) to be valid. */
  epoch: z.number().int().positive(),
  expiresAtMs: EpochMs,
  heartbeatMs: z.number().int().positive(),
});

/** Monotonic coordinator era; a new epoch fences out every action from older epochs. */
export const CoordinatorEpochSchema = z.object({
  epoch: z.number().int().positive(),
  coordinatorDeviceId: OpaqueId,
  startedAtMs: EpochMs,
  fenceToken: z.string().min(1),
});

/**
 * A snapshot of the shared noun-space. Validation adds cross-entity invariants:
 * unique ids, event seq monotonic per task, dependency refs resolve, plan DAG acyclic.
 */
export const ContractBundleSchema = z.object({
  contractsVersion: z.literal(CONTRACTS_VERSION),
  tasks: z.array(TaskSchema),
  subtasks: z.array(SubtaskSchema),
  dependencies: z.array(DependencySchema),
  plans: z.array(ExecutionPlanSchema),
  events: z.array(ExecutionEventSchema),
  adapters: z.array(AgentAdapterSchema),
  connectors: z.array(ConnectorSchema),
  entitlements: z.array(AccountEntitlementSchema),
  capabilities: z.array(CapabilitySchema),
  harnesses: z.array(ExecutionHarnessSchema),
  devices: z.array(DeviceNodeSchema),
  modelArtifacts: z.array(ModelArtifactSchema),
  quotaSignals: z.array(QuotaSignalSchema),
  usageEstimates: z.array(UsageEstimateSchema),
  policyDecisions: z.array(PolicyDecisionSchema),
  approvals: z.array(ApprovalRequestSchema),
  resultArtifacts: z.array(ResultArtifactSchema),
  verificationEvidence: z.array(VerificationEvidenceSchema),
  leases: z.array(LeaseSchema),
  coordinatorEpochs: z.array(CoordinatorEpochSchema),
});

export type ContractBundle = z.infer<typeof ContractBundleSchema>;
export type Task = z.infer<typeof TaskSchema>;
export type Subtask = z.infer<typeof SubtaskSchema>;
export type Dependency = z.infer<typeof DependencySchema>;
export type ExecutionPlan = z.infer<typeof ExecutionPlanSchema>;
export type ExecutionEvent = z.infer<typeof ExecutionEventSchema>;
export type AgentAdapter = z.infer<typeof AgentAdapterSchema>;
export type Connector = z.infer<typeof ConnectorSchema>;
export type AccountEntitlement = z.infer<typeof AccountEntitlementSchema>;
export type Capability = z.infer<typeof CapabilitySchema>;
export type ExecutionHarness = z.infer<typeof ExecutionHarnessSchema>;
export type DeviceNode = z.infer<typeof DeviceNodeSchema>;
export type ModelArtifact = z.infer<typeof ModelArtifactSchema>;
export type QuotaSignal = z.infer<typeof QuotaSignalSchema>;
export type UsageEstimate = z.infer<typeof UsageEstimateSchema>;
export type PolicyDecision = z.infer<typeof PolicyDecisionSchema>;
export type ApprovalRequest = z.infer<typeof ApprovalRequestSchema>;
export type ResultArtifact = z.infer<typeof ResultArtifactSchema>;
export type VerificationEvidence = z.infer<typeof VerificationEvidenceSchema>;
export type Lease = z.infer<typeof LeaseSchema>;
export type CoordinatorEpoch = z.infer<typeof CoordinatorEpochSchema>;

/** Violations found by `validateBundle`; message names every failing invariant. */
export type BundleViolation = { code: string; detail: string };

function collect(ids: string[]): Set<string> {
  return new Set(ids);
}

function firstDuplicate<T>(items: T[]): T | null {
  const seen = new Set<T>();
  for (const item of items) {
    if (seen.has(item)) return item;
    seen.add(item);
  }
  return null;
}

/** Cross-entity invariant checker; schema-parse first, then this. Throws on violation. */
export function validateBundle(bundle: ContractBundle): BundleViolation[] {
  const violations: BundleViolation[] = [];
  const push = (code: string, detail: string) => violations.push({ code, detail });

  const groups: [string, string[], string][] = [
    ["taskId", bundle.tasks.map((t) => t.taskId), "tasks"],
    ["subtaskId", bundle.subtasks.map((s) => s.subtaskId), "subtasks"],
    ["plans", bundle.plans.map((p) => p.planId), "plans"],
    ["eventId", bundle.events.map((e) => e.eventId), "events"],
    ["deviceId", bundle.devices.map((d) => d.deviceId), "devices"],
    ["capabilityId", bundle.capabilities.map((c) => c.capabilityId), "capabilities"],
  ];
  for (const [kind, ids, label] of groups) {
    const dup = firstDuplicate(ids);
    if (dup) push("duplicate_id", `${label}: ${kind} ${dup} appears twice`);
  }

  const taskIds = collect(bundle.tasks.map((t) => t.taskId));
  const subtaskIds = collect(bundle.subtasks.map((s) => s.subtaskId));
  for (const s of bundle.subtasks) {
    if (!taskIds.has(s.taskId)) push("dangling_ref", `subtask ${s.subtaskId} references unknown task ${s.taskId}`);
  }
  for (const dep of bundle.dependencies) {
    if (!subtaskIds.has(dep.fromSubtaskId)) push("dangling_ref", `dependency ${dep.dependencyId} from ${dep.fromSubtaskId} is unknown`);
    if (!subtaskIds.has(dep.toSubtaskId)) push("dangling_ref", `dependency ${dep.dependencyId} to ${dep.toSubtaskId} is unknown`);
    if (dep.fromSubtaskId === dep.toSubtaskId) push("self_edge", `dependency ${dep.dependencyId} is a self-edge`);
  }

  // Plan DAG: dependencies must resolve inside the plan and the graph must be acyclic.
  for (const plan of bundle.plans) {
    const planSubs = collect(plan.subtasks.map((s) => s.subtaskId));
    const edges = new Map<string, Set<string>>();
    for (const dep of plan.dependencies) {
      if (!planSubs.has(dep.fromSubtaskId) || !planSubs.has(dep.toSubtaskId)) {
        push("plan_dangling_dependency", `plan ${plan.planId} has an edge outside its subtask set (${dep.dependencyId})`);
        continue;
      }
      let out = edges.get(dep.fromSubtaskId);
      if (!out) {
        out = new Set();
        edges.set(dep.fromSubtaskId, out);
      }
      if (out.has(dep.toSubtaskId)) push("plan_duplicate_edge", `plan ${plan.planId} repeats edge ${dep.dependencyId}`);
      out.add(dep.toSubtaskId);
    }
    const color = new Map<string, number>();
    const dfs = (id: string): boolean => {
      color.set(id, 1);
      for (const next of edges.get(id) ?? []) {
        if (color.get(next) === 1) return false;
        if (!color.get(next) && !dfs(next)) return false;
      }
      color.set(id, 2);
      return true;
    };
    for (const sub of plan.subtasks) {
      if (!color.get(sub.subtaskId) && !dfs(sub.subtaskId)) {
        push("plan_cycle", `plan ${plan.planId} dependency graph has a cycle through ${sub.subtaskId}`);
        break;
      }
    }
  }

  // Audit events: monotonic seq per task, no gaps silently allowed below but no regressions.
  const lastSeq = new Map<string, number>();
  for (const ev of bundle.events) {
    const prev = lastSeq.get(ev.taskId);
    if (prev !== undefined && ev.seq <= prev) {
      push("event_seq_regression", `task ${ev.taskId}: event ${ev.seq} after ${prev}`);
    }
    lastSeq.set(ev.taskId, ev.seq);
    if (!taskIds.has(ev.taskId)) push("dangling_ref", `event ${ev.eventId} references unknown task ${ev.taskId}`);
  }

  // ApprovalRequests are born pending; a resolution time without resolution state is a bug.
  for (const ap of bundle.approvals) {
    if (ap.state === "pending" && ap.resolvedAtMs !== null) {
      push("approval_inconsistent", `approval ${ap.approvalId} pending but carries resolvedAtMs`);
    }
    if (ap.state !== "pending" && ap.resolvedAtMs === null) {
      push("approval_inconsistent", `approval ${ap.approvalId} ${ap.state} without resolvedAtMs`);
    }
  }

  // Leases and epochs: leases must live in a current epoch; fences grow monotonically.
  const epochNumbers = bundle.coordinatorEpochs.map((e) => e.epoch).sort((a, b) => a - b);
  const dup = firstDuplicate(epochNumbers);
  if (dup) push("duplicate_id", `coordinatorEpochs: epoch ${dup} appears twice`);
  const maxEpoch = epochNumbers.length ? epochNumbers[epochNumbers.length - 1]! : 0;
  for (const lease of bundle.leases) {
    if (lease.epoch > maxEpoch) push("lease_future_epoch", `lease ${lease.leaseId} at epoch ${lease.epoch} exceeds known max ${maxEpoch}`);
    const coord = bundle.coordinatorEpochs.find((e) => e.epoch === lease.epoch);
    if (coord && lease.holderDeviceId !== coord.coordinatorDeviceId) {
      push("lease_rogue_holder", `lease ${lease.leaseId} held by ${lease.holderDeviceId} outside epoch coordinator ${coord.coordinatorDeviceId}`);
    }
  }
  // DeviceNodes acting as coordinator must appear in the current epoch record.
  for (const d of bundle.devices) {
    if (!d.roles.includes("coordinator")) continue;
    const current = bundle.coordinatorEpochs.find((e) => e.epoch === maxEpoch);
    if (current && maxEpoch > 0 && d.deviceId !== current.coordinatorDeviceId) {
      push("coordinator_epoch_mismatch", `device ${d.deviceId} claims coordinator role but epoch ${maxEpoch} is owned by ${current.coordinatorDeviceId}`);
    }
  }

  return violations;
}

const SECRET_KEY_PATTERN = /(token|secret|password|passwd|credential|api[-_]?key|authorization|bearer|cookie|session)/i;

/**
 * Mechanical guard: no key anywhere in a contracts payload may look like a secret.
 * Secrets live in OS-backed stores and surface only as opaque `accountRef`/`credentialRef`.
 */
export function assertNoSecretKeys(value: unknown, trail = "$"): void {
  if (value === null || typeof value !== "object") return;
  for (const [key, inner] of Object.entries(value)) {
    // fenceToken is a split-brain fence marker, not a credential.
    if (/^fence/i.test(key)) continue;
    if (SECRET_KEY_PATTERN.test(key)) {
      throw new Error(`secret-shaped key "${key}" at ${trail}.${key} — move it behind an opaque ref`);
    }
    if (typeof inner === "object") assertNoSecretKeys(inner, `${trail}.${key}`);
  }
}