import { FAILURE_TAXONOMY, type FailureTaxonomy, isRecoverableFailure } from "./outcome-measurement.ts";

export type RecoveryDecision = {
  taxonomy: FailureTaxonomy;
  recoverable: boolean;
  canRetry: boolean;
  backoffMs: number;
  reason: string;
};

export type RecoveryPolicy = {
  maxRetries: number;
  baseBackoffMs: number;
  maxBackoffMs: number;
  deadlineAt: number;
  isIrreversible: boolean;
};

export const DEFAULT_RECOVERY_POLICY: RecoveryPolicy = {
  maxRetries: 3,
  baseBackoffMs: 100,
  maxBackoffMs: 2000,
  deadlineAt: Infinity,
  isIrreversible: false,
};

/**
 * Deterministically classifies an execution error into the standard failure taxonomy.
 */
export function classifyErrorToTaxonomy(error: unknown): FailureTaxonomy {
  const msg = (error instanceof Error ? error.message : String(error)).toLowerCase();

  // Non-recoverable security & authorization boundary breaches
  if (msg.includes("security") || msg.includes("symlink") || msg.includes("junction") || msg.includes("reparse point")) {
    return "SECURITY_VIOLATION";
  }
  if (msg.includes("unsupported command") || msg.includes("prohibited flag") || msg.includes("node evaluation") || msg.includes("--eval")) {
    return "UNSUPPORTED_COMMAND";
  }
  if (msg.includes("permission") || msg.includes("not authorized") || msg.includes("unauthorized") || msg.includes("forbidden")) {
    return "PERMISSION_DENIED";
  }
  if (msg.includes("pin_violation") || msg.includes("pin mismatch") || msg.includes("hard pin")) {
    return "PIN_MISMATCH";
  }
  if (msg.includes("unregistered") || msg.includes("outside the catalog") || msg.includes("unknown tool")) {
    return "UNREGISTERED_TOOL";
  }
  if (msg.includes("stale approval") || msg.includes("approval expired") || msg.includes("action denied by owner")) {
    return "STALE_APPROVAL";
  }
  if (msg.includes("envelope expired") || msg.includes("outside envelope")) {
    return "ENVELOPE_EXPIRED";
  }
  if (msg.includes("uncertain") || msg.includes("reconciliation")) {
    return "UNCERTAIN_IRREVERSIBLE";
  }
  if (msg.includes("budget") || msg.includes("exhausted")) {
    return "BUDGET_EXHAUSTED";
  }
  if (msg.includes("cancelled") || msg.includes("stopped") || msg.includes("abort")) {
    return "CANCELLATION";
  }

  // Recoverable transient faults
  if (msg.includes("rate limit") || msg.includes("429") || msg.includes("overload") || msg.includes("busy") || msg.includes("device_busy")) {
    return "MODEL_OVERLOAD";
  }
  if (msg.includes("econnreset") || msg.includes("etimedout") || msg.includes("transient io") || msg.includes("network error")) {
    return "TRANSIENT_IO";
  }
  if (msg.includes("malformed json") || msg.includes("unparseable") || msg.includes("not valid json")) {
    return "MODEL_MALFORMED_OUTPUT";
  }
  if (msg.includes("memory") || msg.includes("vram") || msg.includes("resource pressure") || msg.includes("resources_unavailable")) {
    return "RESOURCE_PRESSURE";
  }
  if (msg.includes("stale_lease") || msg.includes("expired lease")) {
    return "EXPIRED_READ_LEASE";
  }
  if (msg.includes("test execution failed") || msg.includes("step_failed")) {
    return "STEP_FAILED";
  }
  if (msg.includes("validation")) {
    return "VALIDATION";
  }

  return "UNKNOWN";
}

/**
 * Computes deterministic exponential backoff with bounded cap.
 */
export function computeBackoffMs(attempt: number, baseMs = 100, maxMs = 2000): number {
  if (attempt <= 0) return 0;
  const exp = Math.min(maxMs, baseMs * 2 ** (attempt - 1));
  return exp;
}

/**
 * Evaluates whether an operation can be safely retried.
 * Invariants:
 * 1. Irreversible operations CANNOT be retried automatically if their outcome is ambiguous.
 * 2. Non-recoverable failures (permissions, pins, catalog violations, envelope expiry) fail immediately.
 * 3. Expired deadlines or exhausted retry budgets forbid retries.
 */
export function evaluateRecovery(
  error: unknown,
  attempt: number,
  policy: RecoveryPolicy = DEFAULT_RECOVERY_POLICY,
  now = Date.now(),
): RecoveryDecision {
  const taxonomy = classifyErrorToTaxonomy(error);
  const recoverable = isRecoverableFailure(taxonomy);

  // If irreversible and failed after dispatch, never retry automatically
  if (policy.isIrreversible) {
    return {
      taxonomy: taxonomy === "UNCERTAIN_IRREVERSIBLE" ? taxonomy : "UNCERTAIN_SIDE_EFFECT",
      recoverable: false,
      canRetry: false,
      backoffMs: 0,
      reason: "Irreversible action cannot be automatically retried; owner reconciliation required.",
    };
  }

  // Non-recoverable policy or security errors
  if (!recoverable) {
    return {
      taxonomy,
      recoverable: false,
      canRetry: false,
      backoffMs: 0,
      reason: `Non-recoverable failure (${taxonomy}). Automatic retry denied to preserve security invariants.`,
    };
  }

  // Check attempt budget
  if (attempt >= policy.maxRetries) {
    return {
      taxonomy,
      recoverable: true,
      canRetry: false,
      backoffMs: 0,
      reason: `Retry budget exhausted (${attempt}/${policy.maxRetries} attempts).`,
    };
  }

  // Check deadline
  const backoff = computeBackoffMs(attempt, policy.baseBackoffMs, policy.maxBackoffMs);
  if (now + backoff >= policy.deadlineAt) {
    return {
      taxonomy,
      recoverable: true,
      canRetry: false,
      backoffMs: 0,
      reason: "Task deadline would expire before backoff concludes.",
    };
  }

  return {
    taxonomy,
    recoverable: true,
    canRetry: true,
    backoffMs: backoff,
    reason: `Transient fault (${taxonomy}) is recoverable; scheduled retry ${attempt + 1}/${policy.maxRetries} after ${backoff}ms.`,
  };
}

/**
 * Executes a transient operation with deterministic safe recovery and abort-checked backoff.
 */
export async function executeWithSafeRecovery<T>(
  operation: (attempt: number) => Promise<T>,
  policy: RecoveryPolicy,
  signal: AbortSignal,
  onAttempt?: (attempt: number, error: unknown, decision: RecoveryDecision) => void,
): Promise<{ ok: true; value: T; attempts: number } | { ok: false; error: string; taxonomy: FailureTaxonomy; attempts: number }> {
  let attempt = 0;

  while (true) {
    attempt++;
    if (signal.aborted) {
      return { ok: false, error: "Stopped.", taxonomy: "CANCELLATION", attempts: attempt };
    }

    try {
      const value = await operation(attempt);
      return { ok: true, value, attempts: attempt };
    } catch (err) {
      if (signal.aborted) {
        return { ok: false, error: "Stopped.", taxonomy: "CANCELLATION", attempts: attempt };
      }

      const decision = evaluateRecovery(err, attempt, policy);
      onAttempt?.(attempt, err, decision);

      if (!decision.canRetry) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        return { ok: false, error: `${errorMsg} (${decision.reason})`, taxonomy: decision.taxonomy, attempts: attempt };
      }

      // Safe sleep with cancellation wakeup
      if (decision.backoffMs > 0) {
        try {
          await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => {
              signal.removeEventListener("abort", onAbort);
              resolve();
            }, decision.backoffMs);

            const onAbort = () => {
              clearTimeout(timer);
              reject(new Error("Stopped."));
            };

            signal.addEventListener("abort", onAbort, { once: true });
          });
        } catch {
          return { ok: false, error: "Stopped during backoff wait.", taxonomy: "CANCELLATION", attempts: attempt };
        }
      }
    }
  }
}
