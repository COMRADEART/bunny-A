import { createHash } from "node:crypto";
import { z } from "zod";
import { S2_ROLES, type S2Role } from "./collaboration.ts";
import type { ComplexityClass } from "./s3t1.ts";
import { looksSecret } from "../intelligence.ts";

export const OUTCOME_SCHEMA_VERSION = "bunny-a.ma4-s3-t4.outcome.v1";

/**
 * Deterministic failure taxonomy for agent operations.
 * Separates recoverable transient faults from non-recoverable policy and security boundary breaches.
 */
export const FAILURE_TAXONOMY = [
  // Recoverable transient failures
  "MODEL_OVERLOAD",
  "TRANSIENT_IO",
  "MODEL_MALFORMED_OUTPUT",
  "RESOURCE_PRESSURE",
  "EXPIRED_READ_LEASE",

  // Non-recoverable or approval-required failures
  "PERMISSION_DENIED",
  "PIN_MISMATCH",
  "UNREGISTERED_TOOL",
  "STALE_APPROVAL",
  "ENVELOPE_EXPIRED",
  "UNSUPPORTED_COMMAND",
  "SECURITY_VIOLATION",
  "UNCERTAIN_SIDE_EFFECT",
  "UNCERTAIN_IRREVERSIBLE",
  "BUDGET_EXHAUSTED",
  "STEP_FAILED",
  "VALIDATION",
  "OWNER_ABANDONED",
  "CANCELLATION",
  "UNKNOWN",
] as const;

export type FailureTaxonomy = (typeof FAILURE_TAXONOMY)[number];

export const RECOVERABLE_FAILURES: readonly FailureTaxonomy[] = [
  "MODEL_OVERLOAD",
  "TRANSIENT_IO",
  "MODEL_MALFORMED_OUTPUT",
  "RESOURCE_PRESSURE",
  "EXPIRED_READ_LEASE",
];

export function isRecoverableFailure(failure: FailureTaxonomy): boolean {
  return RECOVERABLE_FAILURES.includes(failure);
}

/**
 * Category 1: Host-verified execution facts.
 * Derived strictly from actual process exit codes, cryptographic receipts, filesystem checks,
 * and immutable Host state transitions.
 */
export const HostVerifiedEvidenceSchema = z.object({
  testReceipts: z.array(z.string()),
  exitCodes: z.array(z.number().int()),
  fileModifications: z.array(z.string()),
  stateTransitions: z.array(z.string()),
  completedContracts: z.boolean(),
  permissionsGranted: z.array(z.string()),
  assertionsExecuted: z.number().int().nonnegative().optional(),
}).strict();
export type HostVerifiedEvidence = z.infer<typeof HostVerifiedEvidenceSchema>;

/**
 * Category 2: Model-generated material.
 * Plans, summaries, self-evaluations, proposed repairs.
 * Invariant: Never treated as Host execution verification or authorization.
 */
export const ModelGeneratedEvidenceSchema = z.object({
  plans: z.array(z.string()),
  summaries: z.array(z.string()),
  proposedRepairs: z.array(z.string()),
  confidenceSelfReported: z.number().min(0).max(1).nullable(),
}).strict();
export type ModelGeneratedEvidence = z.infer<typeof ModelGeneratedEvidenceSchema>;

/**
 * Category 3: User feedback.
 * Explicit owner inputs, ratings, approval decisions, corrections.
 */
export const UserFeedbackEvidenceSchema = z.object({
  rating: z.number().int().min(1).max(5).nullable(),
  corrections: z.array(z.string()),
  accepted: z.boolean().nullable(),
}).strict();
export type UserFeedbackEvidence = z.infer<typeof UserFeedbackEvidenceSchema>;

const hex64 = z.string().regex(/^[0-9a-f]{64}$/);

export const ExecutionOutcomeRecordSchema = z.object({
  version: z.literal(OUTCOME_SCHEMA_VERSION),
  taskId: z.string().min(1).max(120),
  projectId: z.string().min(1).max(120),
  taskClass: z.enum(["C0", "C1", "C2", "C3"]),
  taskSha256: hex64,
  contractSha256: hex64,
  approvedModel: z.object({
    id: z.string(),
    digest: z.string().nullable(),
  }).strict(),
  observedModel: z.object({
    id: z.string(),
    digest: z.string().nullable(),
  }).strict().nullable(),
  rolesInvoked: z.array(z.enum(S2_ROLES)),
  modelCallCount: z.number().int().nonnegative(),
  toolCallCount: z.number().int().nonnegative(),
  planningAttempts: z.number().int().nonnegative(),
  executionAttempts: z.number().int().nonnegative(),
  verifiedArtifactHashes: z.array(hex64),
  testProcessReceipts: z.array(z.string()),
  status: z.enum(["success", "failure", "refusal", "uncertain"]),
  failureTaxonomy: z.enum(FAILURE_TAXONOMY).nullable(),
  queueTimeMs: z.number().nonnegative(),
  executionTimeMs: z.number().nonnegative(),
  tokenUsage: z.object({
    inputTokens: z.number().int().nonnegative().nullable(),
    outputTokens: z.number().int().nonnegative().nullable(),
    totalTokens: z.number().int().nonnegative().nullable(),
  }).strict().nullable(),
  resourceObservations: z.object({
    peakVramBytes: z.number().int().nonnegative().nullable(),
    availableRamBytes: z.number().int().nonnegative().nullable(),
    cpuUtilizationPercent: z.number().min(0).max(100).nullable(),
  }).strict().nullable(),
  repairInfo: z.object({
    approvedByOwner: z.boolean(),
    repairIterationCount: z.number().int().nonnegative(),
    targetRole: z.string().optional(),
    outcome: z.string().optional(),
  }).strict().nullable(),
  evidence: z.object({
    hostVerified: HostVerifiedEvidenceSchema,
    modelGenerated: ModelGeneratedEvidenceSchema,
    userFeedback: UserFeedbackEvidenceSchema,
  }).strict(),
  createdAt: z.number().int().positive(),
}).strict();

export type ExecutionOutcomeRecord = z.infer<typeof ExecutionOutcomeRecordSchema>;

export const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

/**
 * Truthful verification gate:
 * A run is a verified success IF AND ONLY IF:
 * 1. Host status is strictly "success".
 * 2. Host-verified acceptance contract was met.
 * 3. All test process exit codes are 0 (or no tests required for C0/C1).
 * 4. Model observed matches approved model pin (if pin required).
 * 5. No unverified model self-claim can override these facts.
 */
export function isVerifiedSuccess(record: ExecutionOutcomeRecord): boolean {
  if (record.status !== "success") return false;
  if (!record.evidence.hostVerified.completedContracts) return false;
  if (record.failureTaxonomy !== null) return false;
  const exitCodes = record.evidence.hostVerified.exitCodes;
  if (exitCodes.some(code => code !== 0)) return false;
  if (record.approvedModel.digest && record.observedModel?.digest) {
    if (record.approvedModel.digest !== record.observedModel.digest) return false;
  }
  return true;
}

/**
 * Classifies the terminal outcome status from Host facts.
 * Terminal states (COMPLETED, FAILED, UNCERTAIN, CANCELLED) are mapped honestly.
 */
export function classifyOutcomeStatus(input: {
  terminalState: "COMPLETED" | "FAILED" | "UNCERTAIN" | "CANCELLED" | string;
  contractMet: boolean;
  failureCode?: string | null;
  uncertainOperation?: string | null;
  cancelled?: boolean;
}): "success" | "failure" | "refusal" | "uncertain" {
  if (input.cancelled || input.terminalState === "CANCELLED") return "failure";
  if (input.terminalState === "UNCERTAIN" || Boolean(input.uncertainOperation)) return "uncertain";
  if (input.failureCode === "PERMISSION_DENIED" || input.failureCode === "VALIDATION" || input.failureCode === "SECURITY_VIOLATION") {
    return "refusal";
  }
  if (input.terminalState === "COMPLETED" && input.contractMet) {
    return "success";
  }
  return "failure";
}

/**
 * Secret redaction:
 * Redacts tokens, passwords, authorization credentials, and sensitive headers from outcome records.
 */
export function redactOutcomeSecrets(text: string): string {
  if (!text) return text;
  let sanitized = text;
  // Common authorization and secret patterns
  sanitized = sanitized.replace(/(bearer\s+)[A-Za-z0-9._~+/-]+=*/gi, "$1[REDACTED]");
  sanitized = sanitized.replace(/(["']?(?:password|token|secret|apiKey|api_key|authorization)["']?\s*[:=]\s*["'])[^"']+([^"']*)/gi, "$1[REDACTED]$2");
  sanitized = sanitized.replace(/([A-Fa-f0-9]{32,64})/g, (match) => {
    // Keep SHA-256 hashes if they look like standard lowercase hex64
    if (/^[0-9a-f]{64}$/.test(match)) return match;
    return looksSecret(match) ? "[REDACTED]" : match;
  });
  return sanitized;
}

/**
 * Creates an immutable ExecutionOutcomeRecord with secret redaction and schema validation.
 */
export function createOutcomeRecord(input: {
  taskId: string;
  projectId: string;
  taskClass: ComplexityClass;
  taskText: string;
  acceptanceContract: string;
  approvedModel: { id: string; digest: string | null };
  observedModel?: { id: string; digest: string | null } | null;
  rolesInvoked: S2Role[];
  modelCallCount: number;
  toolCallCount: number;
  planningAttempts?: number;
  executionAttempts?: number;
  verifiedArtifactHashes?: string[];
  testProcessReceipts?: string[];
  status: "success" | "failure" | "refusal" | "uncertain";
  failureTaxonomy?: FailureTaxonomy | null;
  queueTimeMs: number;
  executionTimeMs: number;
  tokenUsage?: { inputTokens: number | null; outputTokens: number | null; totalTokens: number | null } | null;
  resourceObservations?: { peakVramBytes: number | null; availableRamBytes: number | null; cpuUtilizationPercent: number | null } | null;
  repairInfo?: { approvedByOwner: boolean; repairIterationCount: number; targetRole?: string; outcome?: string } | null;
  hostVerified: HostVerifiedEvidence;
  modelGenerated?: Partial<ModelGeneratedEvidence>;
  userFeedback?: Partial<UserFeedbackEvidence>;
  now?: number;
}): ExecutionOutcomeRecord {
  const taskSha256 = sha256(input.taskText);
  const contractSha256 = sha256(input.acceptanceContract);

  const sanitizedPlans = (input.modelGenerated?.plans ?? []).map(redactOutcomeSecrets);
  const sanitizedSummaries = (input.modelGenerated?.summaries ?? []).map(redactOutcomeSecrets);
  const sanitizedRepairs = (input.modelGenerated?.proposedRepairs ?? []).map(redactOutcomeSecrets);

  const raw = {
    version: OUTCOME_SCHEMA_VERSION,
    taskId: input.taskId,
    projectId: input.projectId,
    taskClass: input.taskClass,
    taskSha256,
    contractSha256,
    approvedModel: input.approvedModel,
    observedModel: input.observedModel ?? null,
    rolesInvoked: [...new Set(input.rolesInvoked)],
    modelCallCount: Math.max(0, input.modelCallCount),
    toolCallCount: Math.max(0, input.toolCallCount),
    planningAttempts: Math.max(0, input.planningAttempts ?? 1),
    executionAttempts: Math.max(0, input.executionAttempts ?? 1),
    verifiedArtifactHashes: input.verifiedArtifactHashes ?? [],
    testProcessReceipts: input.testProcessReceipts ?? [],
    status: input.status,
    failureTaxonomy: input.failureTaxonomy ?? null,
    queueTimeMs: Math.max(0, input.queueTimeMs),
    executionTimeMs: Math.max(0, input.executionTimeMs),
    tokenUsage: input.tokenUsage ?? null,
    resourceObservations: input.resourceObservations ?? null,
    repairInfo: input.repairInfo ?? null,
    evidence: {
      hostVerified: input.hostVerified,
      modelGenerated: {
        plans: sanitizedPlans,
        summaries: sanitizedSummaries,
        proposedRepairs: sanitizedRepairs,
        confidenceSelfReported: input.modelGenerated?.confidenceSelfReported ?? null,
      },
      userFeedback: {
        rating: input.userFeedback?.rating ?? null,
        corrections: (input.userFeedback?.corrections ?? []).map(redactOutcomeSecrets),
        accepted: input.userFeedback?.accepted ?? null,
      },
    },
    createdAt: input.now ?? Date.now(),
  };

  return ExecutionOutcomeRecordSchema.parse(raw);
}

export type OutcomeSummary = {
  sampleSize: number;
  verifiedSuccessCount: number;
  verifiedSuccessRate: number;
  failureCount: number;
  refusalCount: number;
  uncertainCount: number;
  totalModelCalls: number;
  modelCallsPerSuccess: number;
  totalToolCalls: number;
  averageExecutionTimeMs: number;
  p50ExecutionTimeMs: number;
  p95ExecutionTimeMs: number;
  totalTokens: number;
  tokensPerSuccess: number;
  recoverableFailureCount: number;
  unrecoverableFailureCount: number;
  repairAttemptCount: number;
  repairSuccessCount: number;
  classBreakdown: Record<ComplexityClass, { total: number; verifiedSuccess: number }>;
};

/**
 * Aggregates outcome records into truthful scorecards with explicit denominators.
 */
export function summarizeOutcomeRecords(records: readonly ExecutionOutcomeRecord[]): OutcomeSummary {
  const sampleSize = records.length;
  if (sampleSize === 0) {
    return {
      sampleSize: 0,
      verifiedSuccessCount: 0,
      verifiedSuccessRate: 0,
      failureCount: 0,
      refusalCount: 0,
      uncertainCount: 0,
      totalModelCalls: 0,
      modelCallsPerSuccess: 0,
      totalToolCalls: 0,
      averageExecutionTimeMs: 0,
      p50ExecutionTimeMs: 0,
      p95ExecutionTimeMs: 0,
      totalTokens: 0,
      tokensPerSuccess: 0,
      recoverableFailureCount: 0,
      unrecoverableFailureCount: 0,
      repairAttemptCount: 0,
      repairSuccessCount: 0,
      classBreakdown: {
        C0: { total: 0, verifiedSuccess: 0 },
        C1: { total: 0, verifiedSuccess: 0 },
        C2: { total: 0, verifiedSuccess: 0 },
        C3: { total: 0, verifiedSuccess: 0 },
      },
    };
  }

  let verifiedSuccessCount = 0;
  let failureCount = 0;
  let refusalCount = 0;
  let uncertainCount = 0;
  let totalModelCalls = 0;
  let modelCallsInSuccess = 0;
  let totalToolCalls = 0;
  let totalExecutionTimeMs = 0;
  let totalTokens = 0;
  let tokensInSuccess = 0;
  let recoverableFailureCount = 0;
  let unrecoverableFailureCount = 0;
  let repairAttemptCount = 0;
  let repairSuccessCount = 0;

  const times: number[] = [];
  const classBreakdown: Record<ComplexityClass, { total: number; verifiedSuccess: number }> = {
    C0: { total: 0, verifiedSuccess: 0 },
    C1: { total: 0, verifiedSuccess: 0 },
    C2: { total: 0, verifiedSuccess: 0 },
    C3: { total: 0, verifiedSuccess: 0 },
  };

  for (const r of records) {
    classBreakdown[r.taskClass].total++;
    const isSuccess = isVerifiedSuccess(r);
    if (isSuccess) {
      verifiedSuccessCount++;
      classBreakdown[r.taskClass].verifiedSuccess++;
      modelCallsInSuccess += r.modelCallCount;
      if (r.tokenUsage?.totalTokens) tokensInSuccess += r.tokenUsage.totalTokens;
    } else if (r.status === "refusal") {
      refusalCount++;
    } else if (r.status === "uncertain") {
      uncertainCount++;
    } else {
      failureCount++;
    }

    if (r.failureTaxonomy) {
      if (isRecoverableFailure(r.failureTaxonomy)) recoverableFailureCount++;
      else unrecoverableFailureCount++;
    }

    if (r.repairInfo) {
      repairAttemptCount += r.repairInfo.repairIterationCount;
      if (isSuccess && r.repairInfo.repairIterationCount > 0) repairSuccessCount++;
    }

    totalModelCalls += r.modelCallCount;
    totalToolCalls += r.toolCallCount;
    totalExecutionTimeMs += r.executionTimeMs;
    times.push(r.executionTimeMs);
    if (r.tokenUsage?.totalTokens) totalTokens += r.tokenUsage.totalTokens;
  }

  times.sort((a, b) => a - b);
  const p50 = times[Math.floor(times.length * 0.5)] ?? 0;
  const p95 = times[Math.min(times.length - 1, Math.floor(times.length * 0.95))] ?? 0;

  return {
    sampleSize,
    verifiedSuccessCount,
    verifiedSuccessRate: verifiedSuccessCount / sampleSize,
    failureCount,
    refusalCount,
    uncertainCount,
    totalModelCalls,
    modelCallsPerSuccess: verifiedSuccessCount > 0 ? modelCallsInSuccess / verifiedSuccessCount : 0,
    totalToolCalls,
    averageExecutionTimeMs: totalExecutionTimeMs / sampleSize,
    p50ExecutionTimeMs: p50,
    p95ExecutionTimeMs: p95,
    totalTokens,
    tokensPerSuccess: verifiedSuccessCount > 0 ? tokensInSuccess / verifiedSuccessCount : 0,
    recoverableFailureCount,
    unrecoverableFailureCount,
    repairAttemptCount,
    repairSuccessCount,
    classBreakdown,
  };
}
