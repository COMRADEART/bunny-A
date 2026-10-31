import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { rig, envelope, spec } from "./ma4-s2t2-fixtures.ts";
import { localModelCall, localModelAvailable } from "./ma4/task-executors.server.ts";

const REAL_MODEL = "qwen2.5-coder:7b";
const EVIDENCE_DIR = join(process.cwd(), "test-results", "ma4-s3-t3r1");
mkdirSync(EVIDENCE_DIR, { recursive: true });

function recordEvidence(scenario: string, data: Record<string, unknown>) {
  const filePath = join(EVIDENCE_DIR, `${scenario}.json`);
  writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}

test("Live Ollama Scenario A: Grounded file analysis with real Worker model execution and receipts", { timeout: 120_000 }, async () => {
  const isAvailable = await localModelAvailable(REAL_MODEL);
  if (!isAvailable) {
    throw new Error(`Real model ${REAL_MODEL} is not available locally on Ollama.`);
  }

  const startTime = Date.now();
  const r = await rig({
    call: localModelCall,
    modelAvailable: async m => m === REAL_MODEL,
  });

  try {
    const originalFileText = "Task 1: Fix authentication bug in login endpoint\nTask 2: Ship Bunny release v1.0\nTask 3: Document API endpoints and schemas";
    const rootPath = r.root("project-a", {
      "TASKS.md": originalFileText,
    });

    const steps = [
      { id: "read-tasks", kind: "file.read", input: { root: "project-a", path: "TASKS.md" }, model: null },
      { id: "summarize-worker", kind: "local.generate", input: { prompt: "List the 3 pending tasks mentioned in the file briefly.", contextFrom: "read-tasks" }, model: REAL_MODEL },
    ];

    const taskSpec = spec(steps, "Scenario A Grounded File Analysis");
    const taskEnvelope = envelope(steps, { files: [{ root: "project-a", access: "read" }] }, {
      models: [REAL_MODEL],
      capabilities: ["file.read", "local.generate"],
    });

    const view = r.rt.create({ spec: taskSpec, envelope: taskEnvelope }, "workstation");
    assert.equal(view.state, "QUEUED");

    const completed = await r.run(view.id);
    assert.equal(completed.state, "COMPLETED");

    // Verify file on disk was not modified
    assert.equal(readFileSync(join(rootPath, "TASKS.md"), "utf8"), originalFileText);

    // Verify worker output is grounded in real file
    const workerOutput = r.store.output(view.id, "summarize-worker")?.content ?? "";
    assert.ok(workerOutput.length > 0, "Worker produced live output");
    assert.match(workerOutput, /authentication|login|release|document|api/i);

    // Verify evidence receipt exists for file.read
    const readEvidence = completed.evidence.find(e => e.stepId === "read-tasks");
    assert.ok(readEvidence, "Evidence receipt exists for read-tasks");

    const elapsedMs = Date.now() - startTime;
    recordEvidence("scenario-a-grounded-file-analysis", {
      scenario: "Scenario A — Grounded file analysis",
      taskId: view.id,
      model: REAL_MODEL,
      status: completed.state,
      elapsedMs,
      evidenceReceipt: readEvidence,
      workerOutputPreview: workerOutput.slice(0, 300),
      verified: true,
    });
  } finally {
    await r.close();
  }
});

test("Live Ollama Scenario B: Multi-file investigation honestly reports failing test suite", { timeout: 120_000 }, async () => {
  const startTime = Date.now();
  const r = await rig({
    call: localModelCall,
    modelAvailable: async m => m === REAL_MODEL,
  });

  try {
    r.root("project-b", {
      "src/math.ts": "export function sum(a: number, b: number) { return a + b; }",
      "src/math.test.ts": `import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { sum } from './math.ts';\ntest('sum intentionally fails', () => {\n  assert.equal(sum(2, 2), 5, 'Intentional failure: expected 5 got 4');\n});`,
    });

    const steps = [
      { id: "read-src", kind: "file.read", input: { root: "project-b", path: "src/math.ts" }, model: null },
      { id: "read-test", kind: "file.read", input: { root: "project-b", path: "src/math.test.ts" }, model: null },
      { id: "analyze-worker", kind: "local.generate", input: { prompt: "Explain what is failing in the test.", contextFrom: "read-src,read-test" }, model: REAL_MODEL },
      { id: "run-test", kind: "local.test", input: { root: "project-b", testFile: "src/math.test.ts", criteria: "All tests pass" }, model: REAL_MODEL },
    ];

    const taskSpec = spec(steps, "Scenario B Multi-file Investigation");
    const taskEnvelope = envelope(steps, { files: [{ root: "project-b", access: "read" }] }, {
      models: [REAL_MODEL],
      capabilities: ["file.read", "local.generate", "local.test"],
    });

    const view = r.rt.create({ spec: taskSpec, envelope: taskEnvelope }, "workstation");
    const finished = await r.run(view.id);

    // Must report failing test honestly (FAILED, not false COMPLETED!)
    assert.equal(finished.state, "FAILED", "Workflow must honestly report failing test");
    assert.equal(finished.failure?.code, "STEP_FAILED");
    assert.match(finished.failure?.detail ?? "", /Test execution failed/);

    const elapsedMs = Date.now() - startTime;
    recordEvidence("scenario-b-multi-file-investigation", {
      scenario: "Scenario B — Multi-file investigation",
      taskId: view.id,
      model: REAL_MODEL,
      status: finished.state,
      failureCode: finished.failure?.code,
      failureDetail: finished.failure?.detail,
      elapsedMs,
      verified: true,
      honestFailureReported: true,
    });
  } finally {
    await r.close();
  }
});

test("Live Ollama Scenario C: Approved fix followed by measured successful test execution", { timeout: 120_000 }, async () => {
  const startTime = Date.now();
  const r = await rig({
    call: localModelCall,
    modelAvailable: async m => m === REAL_MODEL,
  });

  try {
    const rootPath = r.root("project-c", {
      "src/math.ts": "export function sum(a: number, b: number) { return a + b; }",
      "src/math.test.ts": `import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { sum } from './math.ts';\ntest('sum test', () => {\n  assert.equal(sum(2, 2), 5);\n});`,
    });

    // Valid fix for the test
    const fixedTestContent = `import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { sum } from './math.ts';\ntest('sum test', () => {\n  assert.equal(sum(2, 2), 4);\n});`;

    const steps = [
      { id: "prepare-fix", kind: "file.prepare", input: { root: "project-c", path: "src/math.test.ts", content: fixedTestContent }, model: null },
      { id: "apply-fix", kind: "file.apply", input: { root: "project-c", path: "src/math.test.ts", content: fixedTestContent }, model: null },
      { id: "run-post-fix-test", kind: "local.test", input: { root: "project-c", testFile: "src/math.test.ts", criteria: "All tests pass" }, model: null },
    ];

    const taskSpec = spec(steps, "Scenario C Approved Fix and Test Verification");
    const taskEnvelope = envelope(steps, { files: [{ root: "project-c", access: "write" }] }, {
      capabilities: ["file.prepare", "file.apply", "local.test"],
      sideEffects: true,
    });

    // Creation halts at approval because sideEffects: true
    const view = r.rt.create({ spec: taskSpec, envelope: taskEnvelope }, "workstation");
    assert.equal(view.state, "AWAITING_APPROVAL");

    r.rt.approve(view.id, "workstation");
    r.rt.wake();

    // Consequential file.apply pauses for payload-bound approval
    let pendingAction: any = null;
    for (let i = 0; i < 50; i++) {
      await r.rt.idle();
      const v = r.rt.view(view.id) as any;
      if (v.state === "AWAITING_APPROVAL" && v.pendingAction) {
        pendingAction = v.pendingAction;
        break;
      }
      await new Promise(res => setTimeout(res, 20));
    }
    assert.ok(pendingAction, "Pauses for payload-bound approval");
    assert.equal(pendingAction.kind, "file.apply");

    // Owner approves the exact payload hash
    r.rt.approveAction(view.id, pendingAction.actionId, pendingAction.payloadSha256, "workstation");
    const completed = await r.run(view.id);
    assert.equal(completed.state, "COMPLETED");

    // Test file was actually updated on disk
    assert.equal(readFileSync(join(rootPath, "src/math.test.ts"), "utf8"), fixedTestContent);

    // Post-fix test execution produced verified receipt
    const testOutput = JSON.parse(r.store.output(view.id, "run-post-fix-test")?.content ?? "{}");
    assert.equal(testOutput.exitCode, 0);
    assert.equal(testOutput.passed, 1);
    assert.ok(testOutput.receipt?.startsWith("receipt:test-exec:"), "Verified deterministic test receipt produced");

    const elapsedMs = Date.now() - startTime;
    recordEvidence("scenario-c-approved-fix-and-verification", {
      scenario: "Scenario C — Approved fix",
      taskId: view.id,
      status: completed.state,
      approvedActionId: pendingAction.actionId,
      approvedPayloadSha256: pendingAction.payloadSha256,
      postFixTestExitCode: testOutput.exitCode,
      postFixReceipt: testOutput.receipt,
      elapsedMs,
      verified: true,
    });
  } finally {
    await r.close();
  }
});

test("Live Ollama Scenario D: Unsafe destructive request refused without capability or execution", async () => {
  const r = await rig({
    call: localModelCall,
    modelAvailable: async m => m === REAL_MODEL,
  });

  try {
    const steps = [
      { id: "destroy-db", kind: "database.drop", input: { target: "prod" } },
    ];
    const taskSpec = spec(steps as any, "Delete Database Request");
    const taskEnvelope = envelope([], {}, { capabilities: ["database.drop"] });

    // Host refuses unregistered executor without launching any process or spending spend
    assert.throws(
      () => r.rt.create({ spec: taskSpec, envelope: taskEnvelope as any }, "workstation"),
      /Task refused: No registered executor for database\.drop/
    );

    recordEvidence("scenario-d-unsafe-operation-refused", {
      scenario: "Scenario D — Unsafe operation",
      dispatched: false,
      refusedReason: "Task refused: No registered executor for database.drop",
      verified: true,
    });
  } finally {
    await r.close();
  }
});

test("Live Ollama Scenario E: Unavailable hard model pin blocks task and forbids silent substitution", async () => {
  const UNAVAILABLE_MODEL = "uninstalled-llama-999b:latest";
  const r = await rig({
    call: localModelCall,
    modelAvailable: async m => m === REAL_MODEL, // unavailable model returns false
  });

  try {
    const steps = [
      { id: "gen-step", kind: "local.generate", input: { prompt: "Generate response" }, model: UNAVAILABLE_MODEL },
    ];
    const taskSpec = spec(steps, "Unavailable Pin Test");
    const taskEnvelope = envelope(steps, {}, {
      models: [UNAVAILABLE_MODEL],
      capabilities: ["local.generate"],
    });

    const view = r.rt.create({ spec: taskSpec, envelope: taskEnvelope }, "workstation");
    assert.equal(view.state, "QUEUED");

    const finished = await r.run(view.id);
    assert.equal(finished.state, "PAUSED", "Task is paused/blocked because pinned model is unavailable");
    assert.equal((finished as any).blocked?.code, "MODEL_UNAVAILABLE");
    assert.match((finished as any).blocked?.detail ?? "", /is not available on this PC; no other model is used/);

    recordEvidence("scenario-e-model-unavailable-blocked", {
      scenario: "Scenario E — Model unavailable",
      taskId: view.id,
      pinnedModel: UNAVAILABLE_MODEL,
      blockedCode: (finished as any).blocked?.code,
      blockedDetail: (finished as any).blocked?.detail,
      silentSubstitutionOccurred: false,
      verified: true,
    });
  } finally {
    await r.close();
  }
});
