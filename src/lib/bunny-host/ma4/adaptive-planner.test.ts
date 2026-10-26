import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  classifyAdaptiveTask,
  validateAndOptimizePlanGraph,
} from "./adaptive-planner.ts";
import type { TaskSpec, Envelope, ExecutorFacts } from "./task-runtime.ts";

test("adaptive planner: optimizes C0-C3 classification and avoids unnecessary Reviewer calls", () => {
  // C0: pure direct answer without tools or planning overhead
  const c0 = classifyAdaptiveTask("What is the capital of France?");
  assert.equal(c0.taskClass, "C0");
  assert.deepEqual(c0.roles, ["direct"]);
  assert.equal(c0.roles.includes("Reviewer"), false);

  // C1: single tool lookup
  const c1 = classifyAdaptiveTask("Read the content of README.md");
  assert.equal(c1.taskClass, "C1");
  assert.deepEqual(c1.roles, ["tool"]);
  assert.equal(c1.roles.includes("Reviewer"), false);

  // C2: multi-step planning and code generation, but no explicit review ask
  const c2 = classifyAdaptiveTask("Refactor the parser function into three helpers across files and then build");
  assert.equal(c2.taskClass, "C2");
  assert.ok(c2.roles.includes("Planner"));
  assert.ok(c2.roles.includes("Worker"));
  // Invariant: Reviewer should NOT be called merely for stylistic confirmation
  assert.equal(c2.roles.includes("Reviewer"), false);

  // C3: consequential operation or explicit review requested
  const c3 = classifyAdaptiveTask("Deploy database migration to production and review all changes", { consequential: true });
  assert.equal(c3.taskClass, "C3");
  assert.ok(c3.roles.includes("Reviewer"), "Consequential task must include Reviewer");
});

test("adaptive planner: detects missing dependencies and invalid forward references in task graph", () => {
  const envelope: Envelope = {
    capabilities: ["file.read", "local.generate"],
    providers: ["ollama"],
    localOnly: true,
    models: ["qwen"],
    projectScopes: ["p1"],
    sideEffects: false,
    background: false,
    budgets: { maxModelCalls: 5, maxWallMs: 60_000 },
    expiresAt: Date.now() + 60_000,
    grants: { files: [{ root: "src", access: "read" }], origins: [], services: [] },
  };

  const facts = new Map<string, ExecutorFacts>([
    ["file.read", { kind: "file.read", category: "read_only", gpu: false, sideEffect: false }],
    ["local.generate", { kind: "local.generate", category: "read_only", gpu: true, sideEffect: false }],
  ]);

  // Invalid spec: step2 depends on step3 (forward reference) and non-existent step99
  const invalidSpec: TaskSpec = {
    title: "Test Plan",
    projectId: "p1",
    steps: [
      { id: "step1", kind: "file.read", input: { root: "src", path: "a.ts" }, model: null, maxAttempts: 2 },
      { id: "step2", kind: "local.generate", input: { prompt: "Analyze", contextFrom: "step3,step99" }, model: "qwen", maxAttempts: 2 },
      { id: "step3", kind: "file.read", input: { root: "src", path: "b.ts" }, model: null, maxAttempts: 2 },
    ],
    dependsOn: [],
    deadlineAt: null,
    acceptance: { requiredSteps: ["step1", "step2", "step3"], description: "All steps pass" },
  };

  const result = validateAndOptimizePlanGraph({ spec: invalidSpec, envelope, facts });
  assert.equal(result.ok, false);
  assert.ok(result.problems.some(p => p.includes("step99")), "Must detect missing parent step");
  assert.ok(result.problems.some(p => p.includes("forward or self reference")), "Must detect forward reference");
});

test("adaptive planner: eliminates redundant file.read steps and remaps dependent references", () => {
  const envelope: Envelope = {
    capabilities: ["file.read", "local.generate"],
    providers: ["ollama"],
    localOnly: true,
    models: ["qwen"],
    projectScopes: ["p1"],
    sideEffects: false,
    background: false,
    budgets: { maxModelCalls: 5, maxWallMs: 60_000 },
    expiresAt: Date.now() + 60_000,
    grants: { files: [{ root: "src", access: "read" }], origins: [], services: [] },
  };

  const facts = new Map<string, ExecutorFacts>([
    ["file.read", { kind: "file.read", category: "read_only", gpu: false, sideEffect: false }],
    ["local.generate", { kind: "local.generate", category: "read_only", gpu: true, sideEffect: false }],
  ]);

  // Spec with redundant read: step1 reads a.ts, step2 reads a.ts identically!
  const redundantSpec: TaskSpec = {
    title: "Redundant Plan",
    projectId: "p1",
    steps: [
      { id: "step1", kind: "file.read", input: { root: "src", path: "a.ts" }, model: null, maxAttempts: 2 },
      { id: "step2", kind: "file.read", input: { root: "src", path: "a.ts" }, model: null, maxAttempts: 2 },
      { id: "step3", kind: "local.generate", input: { prompt: "Summarize", contextFrom: "step1,step2" }, model: "qwen", maxAttempts: 2 },
    ],
    dependsOn: [],
    deadlineAt: null,
    acceptance: { requiredSteps: ["step1", "step2", "step3"], description: "All steps pass" },
  };

  const result = validateAndOptimizePlanGraph({ spec: redundantSpec, envelope, facts });
  assert.equal(result.ok, true);
  assert.equal(result.redundantStepsRemoved.length, 1);
  assert.equal(result.redundantStepsRemoved[0], "step2");

  // step2 should be removed, and step3's contextFrom should now only reference step1
  assert.equal(result.optimizedSpec.steps.length, 2);
  const step3 = result.optimizedSpec.steps.find(s => s.id === "step3")!;
  assert.equal(step3.input.contextFrom, "step1");
  assert.deepEqual(result.optimizedSpec.acceptance.requiredSteps, ["step1", "step3"]);
});

test("adaptive planner: identifies reusable verified artifacts from matching hashes", () => {
  const envelope: Envelope = {
    capabilities: ["file.read", "local.generate"],
    providers: ["ollama"],
    localOnly: true,
    models: ["qwen"],
    projectScopes: ["p1"],
    sideEffects: false,
    background: false,
    budgets: { maxModelCalls: 5, maxWallMs: 60_000 },
    expiresAt: Date.now() + 60_000,
    grants: { files: [{ root: "src", access: "read" }], origins: [], services: [] },
  };

  const facts = new Map<string, ExecutorFacts>([
    ["file.read", { kind: "file.read", category: "read_only", gpu: false, sideEffect: false }],
    ["local.generate", { kind: "local.generate", category: "read_only", gpu: true, sideEffect: false }],
  ]);

  const knownArtifacts = new Map<string, { sha256: string; valid: boolean }>();
  // Pre-seed an artifact matching step1's exact input signature
  const step1Sig = createHash("sha256").update(JSON.stringify({ kind: "file.read", input: { root: "src", path: "cached.ts" } })).digest("hex");
  knownArtifacts.set(step1Sig, { sha256: "cached-artifact-sha256-hash", valid: true });

  const spec: TaskSpec = {
    title: "Cache Plan",
    projectId: "p1",
    steps: [
      { id: "step1", kind: "file.read", input: { root: "src", path: "cached.ts" }, model: null, maxAttempts: 2 },
      { id: "step2", kind: "local.generate", input: { prompt: "Explain", contextFrom: "step1" }, model: "qwen", maxAttempts: 2 },
    ],
    dependsOn: [],
    deadlineAt: null,
    acceptance: { requiredSteps: ["step1", "step2"], description: "All steps pass" },
  };

  const result = validateAndOptimizePlanGraph({ spec, envelope, facts, knownArtifacts });
  assert.equal(result.ok, true);
  assert.equal(result.reusedArtifacts.length, 1);
  assert.equal(result.reusedArtifacts[0].stepId, "step1");
  assert.equal(result.reusedArtifacts[0].artifactHash, "cached-artifact-sha256-hash");
});
