import assert from "node:assert/strict";
import test from "node:test";
import {
  createOutcomeRecord,
  isVerifiedSuccess,
  redactOutcomeSecrets,
  summarizeOutcomeRecords,
  isRecoverableFailure,
  type ExecutionOutcomeRecord,
} from "./outcome-measurement.ts";

test("outcome measurement: structured outcome record enforces schema and validates hashes", () => {
  const record = createOutcomeRecord({
    taskId: "task-001",
    projectId: "proj-alpha",
    taskClass: "C2",
    taskText: "Refactor database query to avoid N+1",
    acceptanceContract: "All tests pass with exit code 0",
    approvedModel: { id: "qwen2.5-coder:7b", digest: "dae161e27b0e90dd1856c8bb3209201fd6736d8eb66298e75ed87571486f4364" },
    observedModel: { id: "qwen2.5-coder:7b", digest: "dae161e27b0e90dd1856c8bb3209201fd6736d8eb66298e75ed87571486f4364" },
    rolesInvoked: ["Planner", "Worker", "Tester"],
    modelCallCount: 3,
    toolCallCount: 1,
    queueTimeMs: 120,
    executionTimeMs: 2400,
    status: "success",
    hostVerified: {
      testReceipts: ["receipt-abc-123"],
      exitCodes: [0],
      fileModifications: ["src/db.ts"],
      stateTransitions: ["PENDING", "RUNNING", "COMPLETED"],
      completedContracts: true,
      permissionsGranted: ["files:read", "files:write"],
    },
    modelGenerated: {
      plans: ["Step 1: read db.ts", "Step 2: patch query"],
      summaries: ["Optimized query successfully"],
      confidenceSelfReported: 0.99,
    },
    userFeedback: {
      rating: 5,
      accepted: true,
    },
  });

  assert.equal(record.taskId, "task-001");
  assert.equal(record.taskClass, "C2");
  assert.equal(record.status, "success");
  assert.equal(isVerifiedSuccess(record), true);
  assert.equal(record.evidence.modelGenerated.confidenceSelfReported, 0.99);
});

test("outcome measurement: model-generated confidence or self-claim cannot fabricate verified success", () => {
  // A record where the model claims 1.0 confidence and says "I succeeded", but Host tests failed (exit code 1)
  const failedRun = createOutcomeRecord({
    taskId: "task-fail-002",
    projectId: "proj-alpha",
    taskClass: "C3",
    taskText: "Deploy critical auth update",
    acceptanceContract: "Security tests pass",
    approvedModel: { id: "qwen2.5-coder:7b", digest: "dae161e27b0e90dd1856c8bb3209201fd6736d8eb66298e75ed87571486f4364" },
    observedModel: { id: "qwen2.5-coder:7b", digest: "dae161e27b0e90dd1856c8bb3209201fd6736d8eb66298e75ed87571486f4364" },
    rolesInvoked: ["Planner", "Worker", "Tester", "Reviewer"],
    modelCallCount: 4,
    toolCallCount: 2,
    queueTimeMs: 50,
    executionTimeMs: 4200,
    status: "failure",
    failureTaxonomy: "STEP_FAILED",
    hostVerified: {
      testReceipts: [],
      exitCodes: [1], // Test exited 1!
      fileModifications: ["src/auth.ts"],
      stateTransitions: ["PENDING", "RUNNING", "FAILED"],
      completedContracts: false,
      permissionsGranted: ["files:write"],
    },
    modelGenerated: {
      plans: ["Step 1: write auth code"],
      summaries: ["The task is 100% complete and flawless!"],
      confidenceSelfReported: 1.0,
    },
  });

  assert.equal(isVerifiedSuccess(failedRun), false, "Failing test exit code must prevent verified success despite 1.0 model confidence");

  // Terminal state COMPLETED but contract not met is not a verified success
  const fakeCompleted = createOutcomeRecord({
    taskId: "task-fake-003",
    projectId: "proj-alpha",
    taskClass: "C1",
    taskText: "Inspect file",
    acceptanceContract: "File inspected",
    approvedModel: { id: "qwen2.5-coder:7b", digest: "dae161e27b0e90dd1856c8bb3209201fd6736d8eb66298e75ed87571486f4364" },
    observedModel: { id: "qwen2.5-coder:7b", digest: "dae161e27b0e90dd1856c8bb3209201fd6736d8eb66298e75ed87571486f4364" },
    rolesInvoked: ["Worker"],
    modelCallCount: 1,
    toolCallCount: 0,
    queueTimeMs: 10,
    executionTimeMs: 500,
    status: "success",
    hostVerified: {
      testReceipts: [],
      exitCodes: [],
      fileModifications: [],
      stateTransitions: ["COMPLETED"],
      completedContracts: false, // contract NOT met!
      permissionsGranted: [],
    },
  });

  assert.equal(isVerifiedSuccess(fakeCompleted), false, "Completed state without satisfied contract must not be verified success");
});

test("outcome measurement: model pin mismatch fails verified success", () => {
  const mismatchRun = createOutcomeRecord({
    taskId: "task-pin-004",
    projectId: "proj-alpha",
    taskClass: "C2",
    taskText: "Build module",
    acceptanceContract: "Contract met",
    approvedModel: { id: "qwen2.5-coder:7b", digest: "dae161e27b0e90dd1856c8bb3209201fd6736d8eb66298e75ed87571486f4364" },
    observedModel: { id: "unapproved-cloud-model", digest: "1111111111111111111111111111111111111111111111111111111111111111" },
    rolesInvoked: ["Worker"],
    modelCallCount: 1,
    toolCallCount: 0,
    queueTimeMs: 10,
    executionTimeMs: 500,
    status: "success",
    hostVerified: {
      testReceipts: [],
      exitCodes: [0],
      fileModifications: [],
      stateTransitions: ["COMPLETED"],
      completedContracts: true,
      permissionsGranted: [],
    },
  });

  assert.equal(isVerifiedSuccess(mismatchRun), false, "Digest mismatch must invalidate verified success");
});

test("outcome measurement: secret redaction removes sensitive credentials from records", () => {
  const textWithSecrets = "Connected with Bearer sk-ant-api-key-123456789 and password='SuperSecretPassword123!'";
  const redacted = redactOutcomeSecrets(textWithSecrets);
  assert.ok(!redacted.includes("sk-ant-api-key"), "API key must be redacted");
  assert.ok(!redacted.includes("SuperSecretPassword123"), "Password must be redacted");
  assert.ok(redacted.includes("[REDACTED]"), "Must insert [REDACTED]");
});

test("outcome measurement: deterministic failure classification separates recoverable from non-recoverable", () => {
  assert.equal(isRecoverableFailure("MODEL_OVERLOAD"), true);
  assert.equal(isRecoverableFailure("TRANSIENT_IO"), true);
  assert.equal(isRecoverableFailure("RESOURCE_PRESSURE"), true);
  assert.equal(isRecoverableFailure("EXPIRED_READ_LEASE"), true);

  assert.equal(isRecoverableFailure("PERMISSION_DENIED"), false);
  assert.equal(isRecoverableFailure("PIN_MISMATCH"), false);
  assert.equal(isRecoverableFailure("SECURITY_VIOLATION"), false);
  assert.equal(isRecoverableFailure("UNCERTAIN_IRREVERSIBLE"), false);
});

test("outcome measurement: summarizeOutcomeRecords aggregates truth with explicit denominators", () => {
  const records: ExecutionOutcomeRecord[] = [
    createOutcomeRecord({
      taskId: "t1", projectId: "p", taskClass: "C0", taskText: "what is node?", acceptanceContract: "answer",
      approvedModel: { id: "qwen", digest: null }, rolesInvoked: ["Worker"],
      modelCallCount: 1, toolCallCount: 0, queueTimeMs: 20, executionTimeMs: 200, status: "success",
      hostVerified: { testReceipts: [], exitCodes: [], fileModifications: [], stateTransitions: [], completedContracts: true, permissionsGranted: [] },
    }),
    createOutcomeRecord({
      taskId: "t2", projectId: "p", taskClass: "C1", taskText: "read file", acceptanceContract: "content",
      approvedModel: { id: "qwen", digest: null }, rolesInvoked: ["Worker"],
      modelCallCount: 0, toolCallCount: 1, queueTimeMs: 10, executionTimeMs: 100, status: "success",
      hostVerified: { testReceipts: [], exitCodes: [], fileModifications: [], stateTransitions: [], completedContracts: true, permissionsGranted: [] },
    }),
    createOutcomeRecord({
      taskId: "t3", projectId: "p", taskClass: "C2", taskText: "fix bug", acceptanceContract: "tests pass",
      approvedModel: { id: "qwen", digest: null }, rolesInvoked: ["Worker", "Tester"],
      modelCallCount: 2, toolCallCount: 1, queueTimeMs: 40, executionTimeMs: 800, status: "failure", failureTaxonomy: "STEP_FAILED",
      hostVerified: { testReceipts: [], exitCodes: [1], fileModifications: [], stateTransitions: [], completedContracts: false, permissionsGranted: [] },
    }),
  ];

  const summary = summarizeOutcomeRecords(records);
  assert.equal(summary.sampleSize, 3);
  assert.equal(summary.verifiedSuccessCount, 2);
  assert.equal(summary.failureCount, 1);
  assert.equal(summary.verifiedSuccessRate, 2 / 3);
  assert.equal(summary.totalModelCalls, 3);
  assert.equal(summary.modelCallsPerSuccess, 0.5); // 1 model call in success divided by 2 successes = 0.5
  assert.equal(summary.classBreakdown.C0.verifiedSuccess, 1);
  assert.equal(summary.classBreakdown.C1.verifiedSuccess, 1);
  assert.equal(summary.classBreakdown.C2.verifiedSuccess, 0);
});

test("outcome measurement: PersistentTaskRuntime records verifiable outcome on task completion", async () => {
  const { PersistentTaskRuntime } = await import("./task-runtime.server.ts");
  const { TaskStore } = await import("./task-store.server.ts");
  const { HostDatabase } = await import("../persistence.server.ts");
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");

  const dir = mkdtempSync(join(tmpdir(), "bunny-outcome-test-"));
  const db = new HostDatabase(join(dir, "test.sqlite"));
  const store = new TaskStore(db);
  const echoExecutor = {
    kind: "local.echo", category: "read_only" as const, gpu: false, sideEffect: false, timeoutMs: 5000,
    async run(input: Record<string, unknown>) { return { ok: true as const, output: String(input.text ?? "ok"), receipt: "rcpt-echo" }; }
  };
  const runtime = new PersistentTaskRuntime({
    store,
    executors: [echoExecutor as any],
    call: async () => ({ ok: false, error: "no-gpu", durationMs: 0 }),
    modelAvailable: async () => true,
    uiAttached: () => true,
  });
  await runtime.start();

  try {
    const spec = {
      title: "Echo task",
      projectId: "proj-1",
      steps: [{ id: "s1", kind: "local.echo", input: { text: "hello" }, model: null, maxAttempts: 2 }],
      acceptance: { requiredSteps: ["s1"], description: "Echo succeeds" },
      dependsOn: [],
      deadlineAt: null,
    };
    const envelope = {
      capabilities: ["local.echo"],
      providers: ["ollama" as const],
      localOnly: true as const,
      models: [],
      projectScopes: ["proj-1"],
      sideEffects: false,
      background: true,
      budgets: { maxModelCalls: 1, maxWallMs: 60_000 },
      expiresAt: Date.now() + 60_000,
      grants: { files: [], origins: [], services: [] },
    };

    const task = runtime.create({ spec, envelope }, "workstation");
    if (store.get(task.id).record.state === "AWAITING_APPROVAL") {
      runtime.approve(task.id, "workstation");
    }
    await runtime.tick();
    await runtime.idle();

    const outcome = store.getOutcome(task.id);
    assert.ok(outcome, "Outcome record must exist in store");
    assert.equal(outcome.taskId, task.id);
    assert.equal(outcome.projectId, "proj-1");
    assert.equal(outcome.status, "success");
    assert.equal(outcome.evidence.hostVerified.completedContracts, true);
    assert.ok(outcome.testProcessReceipts.includes("rcpt-echo"));
    assert.equal(isVerifiedSuccess(outcome), true);
  } finally {
    await runtime.close();
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
