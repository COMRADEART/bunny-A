import test from "node:test";
import assert from "node:assert/strict";
import { evaluateRepairEligibility, validateRevisedPlan } from "./replan.server.ts";
import type { TaskSpec, Envelope, ExecutorFacts } from "./task-runtime.ts";

test("safe replan: strictly enforces MAX_REPAIR_ITERATIONS = 1", () => {
  const res1 = evaluateRepairEligibility({
    currentRepairs: 0,
    evidence: {
      failedStepId: "step1",
      kind: "local.generate",
      exitCode: 1,
      error: "SyntaxError: Unexpected token",
      previousAttempts: 1,
    },
    remainingModelCalls: 3,
    uncertainOutcome: false,
    insideEnvelope: true,
  });
  assert.equal(res1.eligibleForRepair, true);

  // Second repair attempt MUST be denied
  const res2 = evaluateRepairEligibility({
    currentRepairs: 1,
    evidence: {
      failedStepId: "step1",
      kind: "local.generate",
      exitCode: 1,
      error: "SyntaxError: Unexpected token",
      previousAttempts: 2,
    },
    remainingModelCalls: 2,
    uncertainOutcome: false,
    insideEnvelope: true,
  });
  assert.equal(res2.eligibleForRepair, false);
  assert.ok(res2.reason.includes("Repair loop budget exhausted"));
});

test("safe replan: uncertain or envelope-exceeding outcomes deny automated replan", () => {
  // Uncertain outcome
  const resUncertain = evaluateRepairEligibility({
    currentRepairs: 0,
    evidence: {
      failedStepId: "step-write",
      kind: "service.send",
      exitCode: null,
      error: "Connection dropped during external send",
      previousAttempts: 1,
    },
    remainingModelCalls: 3,
    uncertainOutcome: true,
    insideEnvelope: true,
  });
  assert.equal(resUncertain.eligibleForRepair, false);
  assert.ok(resUncertain.reason.includes("owner reconciliation required"));

  // Outside envelope
  const resOutside = evaluateRepairEligibility({
    currentRepairs: 0,
    evidence: {
      failedStepId: "step-tool",
      kind: "file.write",
      exitCode: 1,
      error: "Permission denied",
      previousAttempts: 1,
    },
    remainingModelCalls: 3,
    uncertainOutcome: false,
    insideEnvelope: false,
  });
  assert.equal(resOutside.eligibleForRepair, false);
  assert.ok(resOutside.reason.includes("exceed the authorized task envelope"));
});

test("safe replan: model cannot weaken or modify acceptance criteria", () => {
  const now = Date.now();
  const envelope: Envelope = {
    capabilities: ["file.read", "local.generate", "local.test"],
    providers: ["ollama"],
    localOnly: true,
    models: ["qwen"],
    projectScopes: ["p1"],
    sideEffects: false,
    background: false,
    budgets: { maxModelCalls: 5, maxWallMs: 60_000 },
    expiresAt: now + 60_000,
    grants: { files: [{ root: "src", access: "read" }], origins: [], services: [] },
  };

  const facts = new Map<string, ExecutorFacts>([
    ["file.read", { kind: "file.read", category: "read_only", gpu: false, sideEffect: false }],
    ["local.generate", { kind: "local.generate", category: "read_only", gpu: true, sideEffect: false }],
    ["local.test", { kind: "local.test", category: "read_only", gpu: false, sideEffect: false }],
  ]);

  const originalSpec: TaskSpec = {
    title: "Original Spec",
    projectId: "p1",
    steps: [
      { id: "s1", kind: "file.read", input: { root: "src", path: "test.ts" }, model: null, maxAttempts: 2 },
      { id: "s2", kind: "local.generate", input: { prompt: "fix", contextFrom: "s1" }, model: "qwen", maxAttempts: 2 },
      { id: "s3", kind: "local.test", input: { root: "src", testFile: "test.ts" }, model: null, maxAttempts: 2 },
    ],
    dependsOn: [],
    deadlineAt: null,
    acceptance: { requiredSteps: ["s1", "s2", "s3"], description: "All 3 steps must succeed" },
  };

  // Malicious or lazy revised plan: model changed acceptance description to "Pass without test" and dropped s3!
  const maliciousSpec: TaskSpec = {
    title: "Revised Spec",
    projectId: "p1",
    steps: [
      { id: "s1", kind: "file.read", input: { root: "src", path: "test.ts" }, model: null, maxAttempts: 2 },
      { id: "s2", kind: "local.generate", input: { prompt: "fix", contextFrom: "s1" }, model: "qwen", maxAttempts: 2 },
    ],
    dependsOn: [],
    deadlineAt: null,
    acceptance: { requiredSteps: ["s1", "s2"], description: "Pass without test" },
  };

  const completed = new Set<string>(["s1"]);
  const res = validateRevisedPlan({ originalSpec, revisedSpec: maliciousSpec, envelope, facts, completedStepIds: completed, now });

  assert.equal(res.ok, false);
  assert.ok(res.problems.some(p => p.includes("cannot change the immutable acceptance criteria description")));
  assert.ok(res.problems.some(p => p.includes("dropped required acceptance step \"s3\"")));
});

test("safe replan: consequential step modification requires fresh owner approval", () => {
  const now = Date.now();
  const envelope: Envelope = {
    capabilities: ["file.read", "service.send"],
    providers: ["ollama"],
    localOnly: true,
    models: ["qwen"],
    projectScopes: ["p1"],
    sideEffects: true,
    background: false,
    budgets: { maxModelCalls: 5, maxWallMs: 60_000 },
    expiresAt: now + 60_000,
    grants: { files: [{ root: "src", access: "read" }], origins: [], services: [{ connector: "email", account: "dev", access: "write", recipients: ["alerts@example.com"] }] },
  };

  const facts = new Map<string, ExecutorFacts>([
    ["file.read", { kind: "file.read", category: "read_only", gpu: false, sideEffect: false }],
    ["service.send", { kind: "service.send", category: "irreversible", gpu: false, sideEffect: true }],
  ]);

  const originalSpec: TaskSpec = {
    title: "Send Notification",
    projectId: "p1",
    steps: [
      { id: "s1", kind: "file.read", input: { root: "src", path: "msg.txt" }, model: null, maxAttempts: 2 },
      { id: "s2", kind: "service.send", input: { connector: "email", account: "dev", payload: "Old alert" }, model: null, maxAttempts: 2 },
    ],
    dependsOn: [],
    deadlineAt: null,
    acceptance: { requiredSteps: ["s1", "s2"], description: "Notification sent" },
  };

  const revisedSpec: TaskSpec = {
    title: "Send Notification",
    projectId: "p1",
    steps: [
      { id: "s1", kind: "file.read", input: { root: "src", path: "msg.txt" }, model: null, maxAttempts: 2 },
      { id: "s2", kind: "service.send", input: { connector: "email", account: "dev", payload: "Corrected critical alert" }, model: null, maxAttempts: 2 },
    ],
    dependsOn: [],
    deadlineAt: null,
    acceptance: { requiredSteps: ["s1", "s2"], description: "Notification sent" },
  };

  const completed = new Set<string>(["s1"]);
  const res = validateRevisedPlan({ originalSpec, revisedSpec, envelope, facts, completedStepIds: completed, now });

  assert.equal(res.ok, true);
  assert.equal(res.requiresOwnerApproval, true, "Modifying consequential payload MUST require fresh owner approval");
});
