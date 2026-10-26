import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { rig, envelope, spec } from "./ma4-s2t2-fixtures.ts";
import { localModelCall, localModelAvailable } from "./ma4/task-executors.server.ts";
import { type TaskSpec, type Envelope } from "./ma4/task-runtime.ts";
import { SimulatedCrash } from "./ma4/task-runtime.server.ts";

const REAL_MODEL = "qwen2.5-coder:7b";
const EXPECTED_DIGEST = "dae161e27b0e90dd1856c8bb3209201fd6736d8eb66298e75ed87571486f4364";
const EVIDENCE_DIR = join(process.cwd(), "test-results", "ma4-s3-t3r2");
mkdirSync(EVIDENCE_DIR, { recursive: true });

function recordEvidence(workflow: string, data: Record<string, unknown>) {
  const filePath = join(EVIDENCE_DIR, `${workflow}.json`);
  writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}

test("Live Ollama T3R2: Model identity and digest verification", async () => {
  const res = await fetch("http://127.0.0.1:11434/api/tags");
  assert.equal(res.status, 200);
  const data = (await res.json()) as { models: Array<{ name: string; digest: string }> };
  const found = data.models.find(m => m.name === REAL_MODEL);
  assert.ok(found, `Pinned model ${REAL_MODEL} must be installed in Ollama`);
  assert.ok(
    found.digest.startsWith(EXPECTED_DIGEST) || found.digest.includes(EXPECTED_DIGEST.slice(0, 12)),
    `Digest ${found.digest} must match pinned approved digest ${EXPECTED_DIGEST}`,
  );
});

test("Live Ollama Workflow A: Grounded read with evidence-backed summary", { timeout: 120_000 }, async () => {
  const isAvailable = await localModelAvailable(REAL_MODEL);
  if (!isAvailable) throw new Error(`Real model ${REAL_MODEL} is not available locally.`);

  const startTime = Date.now();
  const r = await rig({
    call: localModelCall,
    modelAvailable: async m => m === REAL_MODEL,
  });

  try {
    const textContent = "Project: Security Hardening\nComponent: Task Executor\nFinding: Eliminate arbitrary root authority\nStatus: In Progress";
    const rootPath = r.root("project-read", {
      "SECURITY_NOTE.txt": textContent,
    });

    const steps = [
      { id: "read-note", kind: "file.read", input: { root: "project-read", path: "SECURITY_NOTE.txt" }, model: null },
      { id: "summarize-worker", kind: "local.generate", input: { prompt: "Summarize the component and finding from the note in one sentence.", contextFrom: "read-note" }, model: REAL_MODEL },
    ];

    const taskSpec: TaskSpec = {
      title: "Workflow A Grounded Read",
      projectId: "p1",
      steps: [
        { id: "read-note", kind: "file.read", input: { root: "project-read", path: "SECURITY_NOTE.txt" }, model: null, maxAttempts: 1 },
        { id: "summarize-worker", kind: "local.generate", input: { prompt: "Summarize the component and finding from the note in one sentence.", contextFrom: "read-note" }, model: REAL_MODEL, maxAttempts: 1 },
      ],
      dependsOn: [],
      acceptance: { requiredSteps: ["read-note", "summarize-worker"], description: "Read and summarize" },
      deadlineAt: null,
    };

    const taskEnvelope: Envelope = {
      capabilities: ["file.read", "local.generate"],
      providers: ["ollama"],
      localOnly: true,
      models: [REAL_MODEL],
      projectScopes: ["p1"],
      sideEffects: false,
      background: false,
      budgets: { maxModelCalls: 10, maxWallMs: 60_000 },
      expiresAt: Date.now() + 60_000,
      grants: {
        files: [{ root: "project-read", access: "read" }],
        origins: [],
        services: [],
      },
    };

    const view = r.rt.create({ spec: taskSpec, envelope: taskEnvelope }, "workstation");
    assert.equal(view.state, "QUEUED");

    const completed = await r.run(view.id);
    assert.equal(completed.state, "COMPLETED");

    // File unchanged
    assert.equal(readFileSync(join(rootPath, "SECURITY_NOTE.txt"), "utf8"), textContent);

    const workerOutput = r.store.output(view.id, "summarize-worker")?.content ?? "";
    assert.ok(workerOutput.length > 0);
    assert.match(workerOutput, /root|executor|security/i);

    const readEvidence = completed.evidence.find(e => e.stepId === "read-note");
    assert.ok(readEvidence);

    recordEvidence("workflow-a-grounded-read", {
      workflow: "Workflow A — Grounded read",
      taskId: view.id,
      model: REAL_MODEL,
      status: completed.state,
      elapsedMs: Date.now() - startTime,
      workerOutputPreview: workerOutput.slice(0, 300),
      evidenceReceipt: readEvidence,
    });
  } finally {
    await r.close();
  }
});

test("Live Ollama Workflow B: Failing tests truthfully reported without false pass", { timeout: 120_000 }, async () => {
  const startTime = Date.now();
  const r = await rig({
    call: localModelCall,
    modelAvailable: async m => m === REAL_MODEL,
  });

  try {
    r.root("project-failing", {
      "src/math.ts": "export function sum(a: number, b: number) { return a + b; }",
      "src/math.test.ts": `import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { sum } from './math.ts';\ntest('intentionally failing test', () => {\n  assert.equal(sum(2, 2), 5, 'Failure expected');\n});`,
    });

    const taskSpec: TaskSpec = {
      title: "Workflow B Failing Test Suite",
      projectId: "p1",
      steps: [
        { id: "read-code", kind: "file.read", input: { root: "project-failing", path: "src/math.ts" }, model: null, maxAttempts: 1 },
        { id: "read-test", kind: "file.read", input: { root: "project-failing", path: "src/math.test.ts" }, model: null, maxAttempts: 1 },
        { id: "worker-explain", kind: "local.generate", input: { prompt: "Explain the bug briefly.", contextFrom: "read-code,read-test" }, model: REAL_MODEL, maxAttempts: 1 },
        { id: "test-step", kind: "local.test", input: { root: "project-failing", testFile: "src/math.test.ts", criteria: "All tests pass" }, model: REAL_MODEL, maxAttempts: 1 },
      ],
      dependsOn: [],
      acceptance: { requiredSteps: ["test-step"], description: "Run tests" },
      deadlineAt: null,
    };

    const taskEnvelope: Envelope = {
      capabilities: ["file.read", "local.generate", "local.test"],
      providers: ["ollama"],
      localOnly: true,
      models: [REAL_MODEL],
      projectScopes: ["p1"],
      sideEffects: false,
      background: false,
      budgets: { maxModelCalls: 10, maxWallMs: 60_000 },
      expiresAt: Date.now() + 60_000,
      grants: {
        files: [{ root: "project-failing", access: "read" }],
        origins: [],
        services: [],
      },
    };

    const view = r.rt.create({ spec: taskSpec, envelope: taskEnvelope }, "workstation");
    const finalView = await r.run(view.id);

    // Failing test process must halt task in FAILED state
    assert.equal(finalView.state, "FAILED");
    assert.equal(finalView.failure?.code, "STEP_FAILED");
    assert.match(finalView.failure?.detail ?? "", /exited with non-zero code/i);

    // No receipt minted
    const testEvidence = finalView.evidence.find(e => e.stepId === "test-step");
    assert.equal(testEvidence, undefined);

    recordEvidence("workflow-b-failing-tests", {
      workflow: "Workflow B — Failing tests",
      taskId: view.id,
      model: REAL_MODEL,
      status: finalView.state,
      failure: finalView.failure,
      elapsedMs: Date.now() - startTime,
    });
  } finally {
    await r.close();
  }
});

test("Live Ollama Workflow C: Authorized repair with exact payload approval and test verification", { timeout: 120_000 }, async () => {
  const startTime = Date.now();
  const r = await rig({
    call: localModelCall,
    modelAvailable: async m => m === REAL_MODEL,
  });

  try {
    const rootPath = r.root("project-repair", {
      "src/calc.ts": "export function multiply(a: number, b: number) { return a * b; }",
      "src/calc.test.ts": `import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { multiply } from './calc.ts';\ntest('multiply', () => { assert.equal(multiply(3, 4), 12); });`,
    });

    const fixedCode = "export function multiply(a: number, b: number) { return a * b; }\n// verified fix";

    const taskSpec: TaskSpec = {
      title: "Workflow C Authorized Repair",
      projectId: "p1",
      steps: [
        { id: "apply-fix", kind: "file.apply", input: { root: "project-repair", path: "src/calc.ts", content: fixedCode }, model: null, maxAttempts: 1 },
        { id: "verify-test", kind: "local.test", input: { root: "project-repair", testFile: "src/calc.test.ts", criteria: "All tests pass" }, model: REAL_MODEL, maxAttempts: 1 },
      ],
      dependsOn: [],
      acceptance: { requiredSteps: ["apply-fix", "verify-test"], description: "Apply and test" },
      deadlineAt: null,
    };

    const taskEnvelope: Envelope = {
      capabilities: ["file.apply", "local.test"],
      providers: ["ollama"],
      localOnly: true,
      models: [REAL_MODEL],
      projectScopes: ["p1"],
      sideEffects: true,
      background: false,
      budgets: { maxModelCalls: 10, maxWallMs: 60_000 },
      expiresAt: Date.now() + 60_000,
      grants: {
        files: [{ root: "project-repair", access: "write" }],
        origins: [],
        services: [],
      },
    };

    const view = r.rt.create({ spec: taskSpec, envelope: taskEnvelope }, "workstation");
    assert.equal(view.approval.required, true);
    assert.equal(view.state, "AWAITING_APPROVAL");

    // Owner approves initial task proposal
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
    assert.equal(pendingAction.stepId, "apply-fix");

    // Approve exact payload hash
    r.rt.approveAction(view.id, pendingAction.actionId, pendingAction.payloadSha256, "workstation");

    // Resume execution
    const completed = await r.run(view.id);
    assert.equal(completed.state, "COMPLETED");

    // Verify modified file on disk
    assert.equal(readFileSync(join(rootPath, "src/calc.ts"), "utf8"), fixedCode);

    // Verify test passed and issued receipt
    const testEvidence = completed.evidence.find(e => e.stepId === "verify-test");
    assert.ok(testEvidence, "Test step must produce verified evidence receipt");

    recordEvidence("workflow-c-authorized-repair", {
      workflow: "Workflow C — Authorized repair",
      taskId: view.id,
      model: REAL_MODEL,
      status: completed.state,
      approvedActionId: pendingAction.actionId,
      payloadSha256: pendingAction.payloadSha256,
      elapsedMs: Date.now() - startTime,
    });
  } finally {
    await r.close();
  }
});

test("Live Ollama Workflow D: Malicious test code prevented by enforcement boundary", { timeout: 120_000 }, async () => {
  const startTime = Date.now();
  const r = await rig({
    call: localModelCall,
    modelAvailable: async m => m === REAL_MODEL,
  });

  try {
    r.root("project-malicious", {
      "benign.txt": "normal file",
    });

    const taskSpec: TaskSpec = {
      title: "Workflow D Malicious Test",
      projectId: "p1",
      steps: [
        {
          id: "escape-step",
          kind: "local.test",
          input: {
            root: "project-malicious",
            testFile: "../../../etc/passwd",
            criteria: "Check security boundary",
          },
          model: REAL_MODEL,
          maxAttempts: 1,
        },
      ],
      dependsOn: [],
      acceptance: { requiredSteps: ["escape-step"], description: "Malicious test" },
      deadlineAt: null,
    };

    const taskEnvelope: Envelope = {
      capabilities: ["local.test"],
      providers: ["ollama"],
      localOnly: true,
      models: [REAL_MODEL],
      projectScopes: ["p1"],
      sideEffects: false,
      background: false,
      budgets: { maxModelCalls: 10, maxWallMs: 60_000 },
      expiresAt: Date.now() + 60_000,
      grants: {
        files: [{ root: "project-malicious", access: "read" }],
        origins: [],
        services: [],
      },
    };

    const view = r.rt.create({ spec: taskSpec, envelope: taskEnvelope }, "workstation");
    const result = await r.run(view.id);

    // Traversal attack strictly refused by Host enforcement boundary
    assert.equal(result.state, "FAILED");
    assert.equal(result.failure?.code, "VALIDATION");
    assert.match(result.failure?.detail ?? "", /traversal|escapes/i);

    recordEvidence("workflow-d-malicious-escape", {
      workflow: "Workflow D — Malicious test code",
      taskId: view.id,
      status: result.state,
      failure: result.failure,
      elapsedMs: Date.now() - startTime,
    });
  } finally {
    await r.close();
  }
});

test("Live Ollama Workflow E: Active process cancellation and settlement", { timeout: 120_000 }, async () => {
  const startTime = Date.now();
  const r = await rig({
    call: localModelCall,
    modelAvailable: async m => m === REAL_MODEL,
  });

  try {
    r.root("project-cancel", {
      "loop.test.js": `import test from 'node:test';
        test('infinite loop', async () => {
          await new Promise(r => setTimeout(r, 60_000));
        });`,
    });

    const taskSpec: TaskSpec = {
      title: "Workflow E Cancellation",
      projectId: "p1",
      steps: [
        { id: "cancel-step", kind: "local.test", input: { root: "project-cancel", testFile: "loop.test.js" }, model: null, maxAttempts: 1 },
      ],
      dependsOn: [],
      acceptance: { requiredSteps: ["cancel-step"], description: "Cancel active test" },
      deadlineAt: null,
    };

    const taskEnvelope: Envelope = {
      capabilities: ["local.test"],
      providers: ["ollama"],
      localOnly: true,
      models: [REAL_MODEL],
      projectScopes: ["p1"],
      sideEffects: false,
      background: false,
      budgets: { maxModelCalls: 10, maxWallMs: 60_000 },
      expiresAt: Date.now() + 60_000,
      grants: {
        files: [{ root: "project-cancel", access: "read" }],
        origins: [],
        services: [],
      },
    };

    const view = r.rt.create({ spec: taskSpec, envelope: taskEnvelope }, "workstation");

    // Start execution in background
    const runPromise = r.run(view.id);

    // Wait 300 ms for process to start
    await new Promise(res => setTimeout(res, 300));

    // Cancel active task
    const cancelledView = r.rt.cancel(view.id, "workstation");
    assert.ok(cancelledView.state === "CANCELLED" || cancelledView.state === "RUNNING");

    const finalView = await runPromise;
    assert.equal(finalView.state, "CANCELLED");

    recordEvidence("workflow-e-cancellation", {
      workflow: "Workflow E — Cancellation",
      taskId: view.id,
      status: finalView.state,
      elapsedMs: Date.now() - startTime,
    });
  } finally {
    await r.close();
  }
});

test("Live Ollama Workflow F: Restart and UNCERTAIN state recovery without automatic replay", { timeout: 120_000 }, async () => {
  const startTime = Date.now();
  let crashTriggered = false;
  const irreversibleExecutor = {
    kind: "notify.critical",
    category: "irreversible" as const,
    gpu: false,
    sideEffect: true,
    timeoutMs: 10_000,
    async run() { return { ok: true, output: "sent", receipt: "receipt-notify-f1" }; },
  };

  const r = await rig({
    call: localModelCall,
    modelAvailable: async m => m === REAL_MODEL,
    faults: (point) => {
      if (point === "after-operation-start" && !crashTriggered) {
        crashTriggered = true;
        throw new SimulatedCrash(point);
      }
    },
  });

  try {
    (r.rt as any).executors.set("notify.critical", irreversibleExecutor);

    const taskSpec: TaskSpec = {
      title: "Workflow F Restart and UNCERTAIN",
      projectId: "p1",
      steps: [
        { id: "notify-step", kind: "notify.critical" as any, input: { message: "Critical deploy notification" }, model: null, maxAttempts: 1 },
      ],
      dependsOn: [],
      acceptance: { requiredSteps: ["notify-step"], description: "Send critical notification" },
      deadlineAt: null,
    };

    const taskEnvelope: Envelope = {
      capabilities: ["notify.critical"],
      providers: ["ollama"],
      localOnly: true,
      models: [REAL_MODEL],
      projectScopes: ["p1"],
      sideEffects: true,
      background: false,
      budgets: { maxModelCalls: 10, maxWallMs: 60_000 },
      expiresAt: Date.now() + 60_000,
      grants: {
        files: [],
        origins: [],
        services: [],
      },
    };

    const view = r.rt.create({ spec: taskSpec, envelope: taskEnvelope }, "workstation");
    assert.equal(view.state, "AWAITING_APPROVAL");
    r.rt.approve(view.id, "workstation");
    r.rt.wake();
    await r.rt.idle();

    // Restart Host after simulated crash
    await r.restart();
    (r.rt as any).executors.set("notify.critical", irreversibleExecutor);

    const recovered = r.rt.view(view.id) as any;
    // Irreversible operation interrupted after start MUST recover to UNCERTAIN
    assert.equal(recovered.state, "UNCERTAIN");
    assert.ok(recovered.uncertainOperation !== null);

    // Must not automatically replay without owner reconciliation
    r.rt.wake();
    await r.rt.idle();
    const checkUncertain = r.rt.view(view.id) as any;
    assert.equal(checkUncertain.state, "UNCERTAIN", "Irreversible operation remains UNCERTAIN without automatic replay");

    // Remote actor cannot blindly settle or cancel
    assert.throws(
      () => r.rt.cancel(view.id, "phone"),
      /An uncertain action must be reconciled on the Windows workstation/
    );

    // Owner reconciles: confirms "happened"
    const reconciled = r.rt.reconcile(view.id, "happened", "workstation");
    assert.equal(reconciled.state, "QUEUED");

    const finalView = await r.run(view.id);
    assert.equal(finalView.state, "COMPLETED");

    recordEvidence("workflow-f-restart-uncertain", {
      workflow: "Workflow F — Restart and UNCERTAIN",
      taskId: view.id,
      recoveredState: recovered.state,
      uncertainOperation: recovered.uncertainOperation,
      reconciledState: reconciled.state,
      finalState: finalView.state,
      elapsedMs: Date.now() - startTime,
      verified: true,
    });
  } finally {
    await r.close();
  }
});
