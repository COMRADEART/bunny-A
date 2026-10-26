import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostDatabase } from "../persistence.server.ts";
import { TaskStore } from "./task-store.server.ts";
import { PersistentTaskRuntime, type Executor } from "./task-runtime.server.ts";
import { validateTask, approvalRequired, sha256, type Envelope, type ExecutorFacts, type TaskSpec } from "./task-runtime.ts";
import { localTest } from "./task-executors.server.ts";
import { VerifiedExperienceManager } from "./verified-experience.server.ts";
import { createOutcomeRecord, isVerifiedSuccess } from "./outcome-measurement.ts";

test("security regression: caller-provided rootPath and unregistered roots are strictly rejected", () => {
  const envelope: Envelope = {
    capabilities: ["local.test"],
    providers: ["ollama"],
    localOnly: true,
    models: [],
    projectScopes: ["p1"],
    sideEffects: false,
    background: false,
    budgets: { maxModelCalls: 0, maxWallMs: 60_000 },
    expiresAt: Date.now() + 60_000,
    grants: { files: [{ root: "safe-root", access: "read" }], origins: [], services: [] },
  };

  const facts = new Map<string, ExecutorFacts>([
    ["local.test", {
      kind: localTest.kind,
      category: localTest.category,
      gpu: localTest.gpu,
      sideEffect: localTest.sideEffect,
      preflight: localTest.preflight,
    }],
  ]);

  // Attempt 1: Caller-provided rootPath (strictly forbidden by MA4-S3-T3R2 preflight)
  const forbiddenRootPathSpec: TaskSpec = {
    title: "Forbidden RootPath Attack",
    projectId: "p1",
    steps: [
      { id: "s1", kind: "local.test", input: { rootPath: "C:\\Windows\\System32", testFile: "test.ts" }, model: null, maxAttempts: 2 },
    ],
    dependsOn: [],
    deadlineAt: null,
    acceptance: { requiredSteps: ["s1"], description: "Run test" },
  };
  const problems1 = validateTask(forbiddenRootPathSpec, envelope, facts, Date.now());
  assert.ok(problems1.some(p => p.includes("rootPath' is forbidden")), "Caller-provided rootPath must be rejected by preflight");

  // Attempt 2: Unregistered root ID not authorized in envelope
  const fakeRootSpec: TaskSpec = {
    title: "Unregistered Root Access",
    projectId: "p1",
    steps: [
      { id: "s1", kind: "local.test", input: { root: "unauthorized-root", testFile: "test.ts" }, model: null, maxAttempts: 2 },
    ],
    dependsOn: [],
    deadlineAt: null,
    acceptance: { requiredSteps: ["s1"], description: "Run test" },
  };
  const problems2 = validateTask(fakeRootSpec, envelope, facts, Date.now());
  assert.ok(problems2.some(p => p.includes("not authorized by the task envelope")), "Unregistered root must be denied");
});

test("security regression: model pin mismatch immediately triggers PIN_VIOLATION", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bunny-pin-sec-"));
  const db = new HostDatabase(join(dir, "test.sqlite"));
  const store = new TaskStore(db);

  // Model call returns a substituted model
  const runtime = new PersistentTaskRuntime({
    store,
    executors: [{
      kind: "local.generate", category: "read_only", gpu: true, sideEffect: false, timeoutMs: 5000,
      async run(input, ctx) {
        const resp = await ctx.call({ role: "Worker", model: ctx.model!, prompt: "Hi", schema: null, signal: ctx.signal, attempt: 1 });
        if (resp.ok && resp.servedModel !== ctx.model) {
          return { ok: false, error: "served model differs from the pin", dispatched: true, definite: true, fatal: "PIN_VIOLATION" };
        }
        return { ok: true, output: "ok" };
      }
    }],
    call: async () => ({ ok: true, text: "substituted text", servedModel: "unapproved-cloud-model:70b", durationMs: 10 }),
    modelAvailable: async () => true,
    uiAttached: () => true,
  });
  await runtime.start();

  try {
    const spec: TaskSpec = {
      title: "Pin test",
      projectId: "p1",
      steps: [{ id: "s1", kind: "local.generate", input: {}, model: "qwen2.5-coder:7b", maxAttempts: 1 }],
      dependsOn: [],
      deadlineAt: null,
      acceptance: { requiredSteps: ["s1"], description: "Generated" },
    };
    const envelope: Envelope = {
      capabilities: ["local.generate"],
      providers: ["ollama"],
      localOnly: true,
      models: ["qwen2.5-coder:7b"],
      projectScopes: ["p1"],
      sideEffects: false,
      background: false,
      budgets: { maxModelCalls: 5, maxWallMs: 60_000 },
      expiresAt: Date.now() + 60_000,
    };

    const task = runtime.create({ spec, envelope }, "workstation");
    await runtime.tick();
    await runtime.idle();

    const finalRecord = store.get(task.id).record;
    assert.equal(finalRecord.state, "FAILED");
    assert.equal(finalRecord.failure?.code, "PIN_VIOLATION");
  } finally {
    await runtime.close();
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("security regression: strict project memory isolation prevents cross-project leakage", () => {
  const dir = mkdtempSync(join(tmpdir(), "bunny-mem-iso-"));
  const db = new HostDatabase(join(dir, "mem.sqlite"));
  const memoryMgr = new VerifiedExperienceManager(db);
  memoryMgr.setEnabled(true);

  try {
    // Project A stores an experience
    const outcomeA = createOutcomeRecord({
      taskId: "task-A",
      projectId: "project-alpha",
      taskClass: "C2",
      taskText: "Refactor secret auth module in alpha",
      acceptanceContract: "Exit 0",
      approvedModel: { id: "qwen", digest: null },
      observedModel: { id: "qwen", digest: null },
      rolesInvoked: ["Worker"],
      modelCallCount: 1,
      toolCallCount: 0,
      queueTimeMs: 10,
      executionTimeMs: 100,
      status: "success",
      hostVerified: { testReceipts: ["rcpt-a"], exitCodes: [0], fileModifications: [], stateTransitions: [], completedContracts: true, permissionsGranted: [] },
    });
    memoryMgr.observeAndPromote(outcomeA);

    // Query for Project A succeeds
    const sigA = memoryMgr.deriveProblemSignature(outcomeA);
    const resA = memoryMgr.retrieveProjectExperience("project-alpha", sigA);
    assert.equal(resA.records.length, 1);
    assert.ok(resA.advisoryContext?.includes("project-alpha") || resA.advisoryContext?.includes("C2"));

    // Query for Project B MUST NOT leak Project A's records
    const resB = memoryMgr.retrieveProjectExperience("project-beta", sigA);
    assert.equal(resB.records.length, 0, "Project Beta must never access Project Alpha memory");
    assert.equal(resB.advisoryContext, null);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("security regression: changing action payload hash invalidates approval", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bunny-appr-sec-"));
  const db = new HostDatabase(join(dir, "test.sqlite"));
  const store = new TaskStore(db);

  const sendExecutor: Executor = {
    kind: "service.send",
    category: "irreversible",
    gpu: false,
    sideEffect: true,
    consequential: true,
    timeoutMs: 5000,
    async run(input, ctx) {
      if (!ctx.approval) {
        return {
          ok: false,
          error: "Approval required",
          dispatched: false,
          proposal: {
            stepId: ctx.stepId,
            actionId: "act-1",
            summary: "Send email",
            payloadSha256: sha256(JSON.stringify(input)),
            expiresAt: ctx.now() + 60_000,
            payload: input,
          },
        };
      }
      return { ok: true, output: "sent", receipt: "rcpt-sent" };
    },
  };

  const runtime = new PersistentTaskRuntime({
    store,
    executors: [sendExecutor],
    call: async () => ({ ok: false, error: "no-gpu", durationMs: 0 }),
    modelAvailable: async () => true,
    uiAttached: () => true,
  });

  try {
    const spec: TaskSpec = {
      title: "Consequential Action",
      projectId: "p1",
      steps: [{ id: "step1", kind: "service.send", input: { connector: "email", account: "dev", payload: "Initial text" }, model: null, maxAttempts: 1 }],
      dependsOn: [],
      deadlineAt: null,
      acceptance: { requiredSteps: ["step1"], description: "Sent" },
    };
    const envelope: Envelope = {
      capabilities: ["service.send"],
      providers: ["ollama"],
      localOnly: true,
      models: [],
      projectScopes: ["p1"],
      sideEffects: true,
      background: false,
      budgets: { maxModelCalls: 0, maxWallMs: 60_000 },
      expiresAt: Date.now() + 60_000,
      grants: { files: [], origins: [], services: [{ connector: "email", account: "dev", access: "send", recipients: ["user@example.com"] }] },
    };

    const task = runtime.create({ spec, envelope }, "workstation");

    // Propose an action with original payload hash
    const origPayload = JSON.stringify({ connector: "email", account: "dev", payload: "Initial text" });
    const origSha = sha256(origPayload);
    const tamperedSha = sha256(JSON.stringify({ connector: "email", account: "dev", payload: "MALICIOUS OVERWRITE" }));

    // Manually set pending action
    store.update(task.id, {
      actor: "workstation", reason: "pending action", now: Date.now(),
      mutate: (r) => {
        r.state = "AWAITING_APPROVAL";
        r.pendingAction = {
          stepId: "step1",
          actionId: "act-1",
          kind: "email.send",
          connector: "email",
          target: "Email",
          summary: "Send email",
          effects: ["Sends email"],
          reversible: false,
          data: [],
          changes: [],
          preview: "Initial text",
          payloadSha256: origSha,
          proposedAt: Date.now(),
          expiresAt: Date.now() + 60_000,
        };
      }
    });

    // Approving with tampered hash MUST fail with TaskConflictError
    assert.throws(
      () => runtime.approveAction(task.id, "act-1", tamperedSha, "workstation"),
      /The action changed since you reviewed it/,
    );
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("security regression: unverified model confidence cannot fabricate Host test success", () => {
  const fakeRecord = createOutcomeRecord({
    taskId: "task-fake",
    projectId: "p1",
    taskClass: "C3",
    taskText: "Delete and recreate schema",
    acceptanceContract: "All tests pass",
    approvedModel: { id: "qwen", digest: null },
    observedModel: { id: "qwen", digest: null },
    rolesInvoked: ["Worker", "Tester"],
    modelCallCount: 2,
    toolCallCount: 1,
    queueTimeMs: 10,
    executionTimeMs: 200,
    status: "failure",
    failureTaxonomy: "SECURITY_VIOLATION",
    hostVerified: {
      testReceipts: [],
      exitCodes: [1], // Exit code 1
      fileModifications: [],
      stateTransitions: ["QUEUED", "RUNNING", "FAILED"],
      completedContracts: false,
      permissionsGranted: [],
    },
    modelGenerated: {
      plans: ["Step 1: delete all"],
      summaries: ["Everything succeeded perfectly with 100% certainty!"],
      confidenceSelfReported: 1.0, // Model claiming 100% confidence
    },
  });

  assert.equal(isVerifiedSuccess(fakeRecord), false, "Model self-confidence must NEVER override Host verification facts");
});
