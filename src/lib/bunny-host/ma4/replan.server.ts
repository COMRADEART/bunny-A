import { type Envelope, type ExecutorFacts, type TaskSpec, validateTask } from "./task-runtime.ts";
import { redactOutcomeSecrets } from "./outcome-measurement.ts";

export const MAX_REPAIR_ITERATIONS = 1;

export type FailureEvidence = {
  failedStepId: string;
  kind: string;
  exitCode: number | null;
  error: string;
  stdout?: string | null;
  stderr?: string | null;
  previousAttempts: number;
};

export type ReplanEvaluation = {
  eligibleForRepair: boolean;
  reason: string;
  boundedSummary: string | null;
};

/**
 * Evaluates whether a failed workflow qualifies for the single permitted repair iteration.
 * Invariants:
 * 1. Strictly bounded to MAX_REPAIR_ITERATIONS (1).
 * 2. Consequential operations with uncertain outcomes CANNOT be repaired automatically.
 * 3. Budget exhaustion or security violations CANNOT be repaired.
 */
export function evaluateRepairEligibility(input: {
  currentRepairs: number;
  evidence: FailureEvidence;
  remainingModelCalls: number;
  uncertainOutcome: boolean;
  insideEnvelope: boolean;
}): ReplanEvaluation {
  if (input.currentRepairs >= MAX_REPAIR_ITERATIONS) {
    return {
      eligibleForRepair: false,
      reason: `Repair loop budget exhausted (${input.currentRepairs}/${MAX_REPAIR_ITERATIONS}). Endless self-correction loops are strictly forbidden.`,
      boundedSummary: null,
    };
  }

  if (input.uncertainOutcome) {
    return {
      eligibleForRepair: false,
      reason: "An external write or consequential action outcome is uncertain. Automated replanning denied; owner reconciliation required.",
      boundedSummary: null,
    };
  }

  if (!input.insideEnvelope) {
    return {
      eligibleForRepair: false,
      reason: "Repair would exceed the authorized task envelope. Replanning denied.",
      boundedSummary: null,
    };
  }

  if (input.remainingModelCalls < 2) {
    return {
      eligibleForRepair: false,
      reason: "Insufficient remaining model call budget for replanning and worker repair.",
      boundedSummary: null,
    };
  }

  // Extract bounded, factual failure evidence without prompt injection vulnerabilities
  let details = `Step ${input.evidence.failedStepId} (${input.evidence.kind}) failed (attempt ${input.evidence.previousAttempts}):\nError: ${input.evidence.error.slice(0, 500)}`;
  if (input.evidence.exitCode !== null) {
    details += `\nExit code: ${input.evidence.exitCode}`;
  }
  if (input.evidence.stdout) {
    details += `\nStdout: ${input.evidence.stdout.slice(0, 600)}`;
  }
  if (input.evidence.stderr) {
    details += `\nStderr: ${input.evidence.stderr.slice(0, 600)}`;
  }

  const boundedSummary = redactOutcomeSecrets(details.slice(0, 2000));

  return {
    eligibleForRepair: true,
    reason: "Bounded repair permitted. Proceeding with single authorized replan iteration.",
    boundedSummary,
  };
}

/**
 * Validates a revised plan proposed during repair.
 * Invariants:
 * 1. Acceptance criteria MUST NOT be altered, weakened, or removed by the replanning model.
 * 2. Already completed successful steps MUST NOT be re-executed.
 * 3. Any changes to consequential step payloads require fresh owner approval.
 */
export function validateRevisedPlan(input: {
  originalSpec: TaskSpec;
  revisedSpec: TaskSpec;
  envelope: Envelope;
  facts: ReadonlyMap<string, ExecutorFacts>;
  completedStepIds: ReadonlySet<string>;
  now?: number;
}): {
  ok: boolean;
  problems: string[];
  requiresOwnerApproval: boolean;
  optimizedSteps: TaskSpec["steps"];
} {
  const problems: string[] = [];
  let requiresOwnerApproval = false;

  // 1. Acceptance criteria invariant: model cannot change acceptance description or drop required steps
  if (input.revisedSpec.acceptance.description !== input.originalSpec.acceptance.description) {
    problems.push("A replanned task cannot change the immutable acceptance criteria description.");
  }
  for (const required of input.originalSpec.acceptance.requiredSteps) {
    if (!input.revisedSpec.acceptance.requiredSteps.includes(required) && !input.completedStepIds.has(required)) {
      problems.push(`Replanned task dropped required acceptance step "${required}".`);
    }
  }

  // 2. Validate using standard TaskSpec and envelope rules
  const baseProblems = validateTask(input.revisedSpec, input.envelope, input.facts, input.now ?? Date.now());
  problems.push(...baseProblems);

  // 3. Ensure already completed steps are not repeated if consequential
  const originalStepMap = new Map(input.originalSpec.steps.map(s => [s.id, s]));
  const optimizedSteps: TaskSpec["steps"] = [];

  for (const step of input.revisedSpec.steps) {
    const isCompleted = input.completedStepIds.has(step.id);
    const fact = input.facts.get(step.kind);

    if (isCompleted && fact?.sideEffect) {
      problems.push(`Step "${step.id}" was already completed successfully and cannot be re-executed.`);
    }

    // Check if consequential payload changed
    if (fact?.sideEffect && !isCompleted) {
      const orig = originalStepMap.get(step.id);
      if (!orig || JSON.stringify(orig.input) !== JSON.stringify(step.input)) {
        requiresOwnerApproval = true;
      }
    }

    optimizedSteps.push(step);
  }

  return {
    ok: problems.length === 0,
    problems,
    requiresOwnerApproval,
    optimizedSteps,
  };
}
