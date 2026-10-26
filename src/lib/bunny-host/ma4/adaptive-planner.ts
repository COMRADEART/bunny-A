import { createHash } from "node:crypto";
import { z } from "zod";
import type { ComplexityClass, ExecutionRole, TaskClassification } from "./s3t1.ts";
import { classifyTask as baselineClassifyTask, hostExecutionPlan as baselineHostExecutionPlan } from "./s3t1.ts";
import { type Envelope, type ExecutorFacts, type TaskSpec } from "./task-runtime.ts";
import { reviewRequested, testRequested } from "./connected-workflow.server.ts";

export type DependencyGraph = {
  nodes: { id: string; kind: string; model: string | null }[];
  edges: { from: string; to: string }[];
  levels: string[][];
};

export type ResourceEstimate = {
  estimatedModelCalls: number;
  estimatedToolCalls: number;
  estimatedWallMs: number;
  estimatedTokens: number;
  confidence: number;
};

export type AdaptiveExecutionRole = ExecutionRole | "Tester";

export type AdaptivePlanResult = {
  taskClass: ComplexityClass;
  roles: AdaptiveExecutionRole[];
  modelCalls: number;
  toolCalls: number;
  verification: "none" | "deterministic" | "deterministic-and-semantic";
  graph: DependencyGraph | null;
  estimate: ResourceEstimate;
  reusedArtifacts: { stepId: string; artifactHash: string }[];
  advisories: string[];
  rejections: string[];
  source: "adaptive-host-planner";
};

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

/**
 * Enhanced C0-C3 adaptive classifier.
 * Preserves Host authority and safety baselines while minimizing unnecessary model and agent calls.
 */
export function classifyAdaptiveTask(
  text: string,
  options: {
    consequential?: boolean;
    availableTools?: readonly string[];
    historicalAverages?: Partial<ResourceEstimate>;
  } = {},
): AdaptivePlanResult {
  const clean = text.trim();
  const baseline = baselineClassifyTask(clean, { consequential: options.consequential });
  const wantReview = reviewRequested(clean);
  const wantTest = testRequested(clean);

  let taskClass: ComplexityClass = baseline.complexity;
  let roles: AdaptiveExecutionRole[] = [...baseline.roles];
  let verification = baseline.verification;
  let modelCalls = baseline.resource.modelCalls;
  let toolCalls = baseline.resource.toolCalls;
  const advisories: string[] = [];

  // Optimization: C0 if pure informational/explanation query without needed tools
  if (taskClass === "C1" && !clean.match(/\b(read|open|list|fetch|cat|run)\b/i) && clean.length < 100) {
    taskClass = "C0";
    roles = ["direct"];
    modelCalls = 1;
    toolCalls = 0;
    verification = "none";
    advisories.push("Classified as direct conversation; tools add no justified benefit.");
  }

  // Optimization: Do not add Reviewer unless explicitly requested or consequential C3
  if (roles.includes("Reviewer") && !wantReview && !options.consequential && taskClass !== "C3") {
    roles = roles.filter(r => r !== "Reviewer");
    modelCalls = Math.max(1, modelCalls - 1);
    advisories.push("Stylistic Reviewer omitted: not requested by owner and task is deterministic.");
  }

  // C3 requires independent verification and plan
  if (options.consequential || taskClass === "C3") {
    taskClass = "C3";
    roles = ["Planner", "Worker", ...(wantTest ? (["Tester"] as const) : []), "Reviewer"];
    verification = "deterministic-and-semantic";
    modelCalls = roles.length;
    toolCalls = Math.max(1, toolCalls);
  }

  const estimate: ResourceEstimate = {
    estimatedModelCalls: modelCalls,
    estimatedToolCalls: toolCalls,
    estimatedWallMs: modelCalls * 800 + toolCalls * 200 + (options.historicalAverages?.estimatedWallMs ? options.historicalAverages.estimatedWallMs * 0.2 : 0),
    estimatedTokens: modelCalls * 450,
    confidence: options.historicalAverages?.confidence ?? 0.85,
  };

  return {
    taskClass,
    roles,
    modelCalls,
    toolCalls,
    verification,
    graph: null,
    estimate,
    reusedArtifacts: [],
    advisories,
    rejections: [],
    source: "adaptive-host-planner",
  };
}

/**
 * Validates and optimizes a proposed TaskSpec dependency graph.
 * Enforces:
 * 1. Topological order (no cycles, no forward dependencies).
 * 2. Missing dependency detection.
 * 3. Redundant step elimination.
 * 4. Catalog and envelope scope adherence.
 * 5. Reusable verified artifact identification.
 */
export function validateAndOptimizePlanGraph(input: {
  spec: TaskSpec;
  envelope: Envelope;
  facts: ReadonlyMap<string, ExecutorFacts>;
  knownArtifacts?: ReadonlyMap<string, { sha256: string; valid: boolean }>;
}): {
  ok: boolean;
  optimizedSpec: TaskSpec;
  graph: DependencyGraph;
  redundantStepsRemoved: string[];
  reusedArtifacts: { stepId: string; artifactHash: string }[];
  problems: string[];
} {
  const problems: string[] = [];
  const redundantStepsRemoved: string[] = [];
  const reusedArtifacts: { stepId: string; artifactHash: string }[] = [];

  const steps = [...input.spec.steps];
  const stepMap = new Map<string, TaskSpec["steps"][number]>();
  const seenStepIds = new Set<string>();

  // 1. Detect duplicates and validate step ids
  for (const step of steps) {
    if (seenStepIds.has(step.id)) {
      problems.push(`Duplicate step id "${step.id}".`);
    }
    seenStepIds.add(step.id);
    stepMap.set(step.id, step);
  }

  // 2. Build dependency edges and check for missing dependencies
  const edges: { from: string; to: string }[] = [];
  const stepIndex = new Map(steps.map((s, i) => [s.id, i]));

  for (const step of steps) {
    // Check capability authorized by envelope
    if (!input.envelope.capabilities.includes(step.kind)) {
      problems.push(`Action "${step.kind}" in step "${step.id}" is not granted by task envelope.`);
    }

    // Inspect inputs ending in "From"
    for (const [key, val] of Object.entries(step.input)) {
      if (typeof val === "string" && (key.endsWith("From") || key === "subjectFrom" || key === "contextFrom")) {
        const parents = val.split(",").map(s => s.trim()).filter(Boolean);
        for (const parent of parents) {
          if (!stepMap.has(parent)) {
            problems.push(`Step "${step.id}" depends on non-existent step "${parent}".`);
          } else {
            const pIdx = stepIndex.get(parent)!;
            const cIdx = stepIndex.get(step.id)!;
            if (pIdx >= cIdx) {
              problems.push(`Step "${step.id}" depends on step "${parent}" which does not precede it (forward or self reference).`);
            } else {
              edges.push({ from: parent, to: step.id });
            }
          }
        }
      }
    }
  }

  // 3. Detect redundant read steps (e.g. multiple steps reading the exact same root + path)
  const readSignatures = new Map<string, string>(); // signature -> first stepId
  const redundantStepIds = new Set<string>();
  const stepIdSubstitutions = new Map<string, string>();

  for (const step of steps) {
    if (step.kind === "file.read") {
      const root = String(step.input.root ?? "");
      const path = String(step.input.path ?? "");
      const sig = `file.read:${root}:${path}`;
      if (readSignatures.has(sig)) {
        const canonicalId = readSignatures.get(sig)!;
        redundantStepIds.add(step.id);
        stepIdSubstitutions.set(step.id, canonicalId);
        redundantStepsRemoved.push(step.id);
      } else {
        readSignatures.set(sig, step.id);
      }
    }
  }

  // 4. Prune redundant steps and remap references
  const prunedSteps = steps.filter(s => !redundantStepIds.has(s.id)).map(step => {
    const updatedInput: Record<string, string | number | boolean | null> = { ...step.input };
    for (const [key, val] of Object.entries(updatedInput)) {
      if (typeof val === "string" && (key.endsWith("From") || key === "subjectFrom" || key === "contextFrom")) {
        const parents = val.split(",").map(s => s.trim()).filter(Boolean);
        const mapped = parents.map(p => stepIdSubstitutions.get(p) ?? p);
        updatedInput[key] = [...new Set(mapped)].join(",");
      }
    }
    return { ...step, input: updatedInput };
  });

  // 5. Check reusable verified artifacts
  if (input.knownArtifacts) {
    for (const step of prunedSteps) {
      const stepSig = sha256(JSON.stringify({ kind: step.kind, input: step.input }));
      const known = input.knownArtifacts.get(stepSig);
      if (known?.valid) {
        reusedArtifacts.push({ stepId: step.id, artifactHash: known.sha256 });
      }
    }
  }

  // 6. Build topological levels
  const levels = computeTopologicalLevels(prunedSteps.map(s => s.id), edges.filter(e => !redundantStepIds.has(e.from) && !redundantStepIds.has(e.to)));

  const nodes = prunedSteps.map(s => ({ id: s.id, kind: s.kind, model: s.model ?? null }));
  const graph: DependencyGraph = {
    nodes,
    edges: edges.filter(e => !redundantStepIds.has(e.from) && !redundantStepIds.has(e.to)),
    levels,
  };

  const optimizedSpec: TaskSpec = {
    ...input.spec,
    steps: prunedSteps,
    acceptance: {
      ...input.spec.acceptance,
      requiredSteps: input.spec.acceptance.requiredSteps.filter(id => !redundantStepIds.has(id)),
    },
  };

  return {
    ok: problems.length === 0,
    optimizedSpec,
    graph,
    redundantStepsRemoved,
    reusedArtifacts,
    problems,
  };
}

function computeTopologicalLevels(stepIds: string[], edges: { from: string; to: string }[]): string[][] {
  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();

  for (const id of stepIds) {
    inDegree.set(id, 0);
    adj.set(id, []);
  }

  for (const e of edges) {
    if (inDegree.has(e.to) && adj.has(e.from)) {
      inDegree.set(e.to, (inDegree.get(e.to) ?? 0) + 1);
      adj.get(e.from)!.push(e.to);
    }
  }

  const levels: string[][] = [];
  let queue = stepIds.filter(id => (inDegree.get(id) ?? 0) === 0);

  while (queue.length > 0) {
    levels.push([...queue]);
    const nextQueue: string[] = [];
    for (const node of queue) {
      for (const neighbor of (adj.get(node) ?? [])) {
        const deg = (inDegree.get(neighbor) ?? 1) - 1;
        inDegree.set(neighbor, deg);
        if (deg === 0) nextQueue.push(neighbor);
      }
    }
    queue = nextQueue;
  }

  return levels;
}
