import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { writeFileSync, mkdirSync } from "node:fs";
import { rig, fakeModel, MODEL, envelope, spec } from "./ma4-s2t2-fixtures.ts";
import { executeDeterministicTest, verifyTestReceipt, sha256 } from "./ma4/test-runner.server.ts";
import { localTest } from "./ma4/task-executors.server.ts";
import { SimulatedCrash } from "./ma4/task-runtime.server.ts";

test("Case 1: Model returning JSON pass counts without a process launch cannot produce a verified test-execution receipt", async () => {
  const r = await rig({
    model: fakeModel({
      Tester: JSON.stringify({ passed: 100, failed: 0, detail: "Model claims 100 tests passed without execution." }),
    }),
  });
  try {
    // Attempt to invoke localTest with model only (no test file, no command, no project root)
    const ctx = {
      taskId: "task-case-1",
      stepId: "test-step",
      attempt: 1,
      idempotencyKey: "key-1",
      model: MODEL,
      signal: new AbortController().signal,
      call: r.model.call,
      track: () => {},
      envelope: envelope([], {}) as any,
      approval: null,
      outputOf: () => null,
      now: () => Date.now(),
    };

    // Mode: semantic analysis only
    const resAnalysis = await localTest.run({ mode: "analysis" }, ctx);
    assert.equal(resAnalysis.ok, true);
    assert.equal((resAnalysis as any).receipt, undefined, "Semantic analysis cannot issue an execution receipt");
    const parsed = JSON.parse((resAnalysis as any).output);
    assert.equal(parsed.verified, false, "Must be explicitly marked unverified");
    assert.equal(parsed.exitCode, null, "Exit code must be null when no process was run");

    // Standard run without process targets
    const resStandard = await localTest.run({}, ctx);
    assert.equal(resStandard.ok, false, "Must fail closed when test verification is requested without a process launch");
    assert.equal((resStandard as any).fatal, "VALIDATION");
    assert.match((resStandard as any).error, /requires an authorized test command or test file/);
    assert.equal((resStandard as any).receipt, undefined);
  } finally {
    await r.close();
  }
});

test("Case 2: Test process exiting nonzero cannot produce a verified successful receipt", async () => {
  const r = await rig();
  try {
    const rootPath = r.root("case2", {
      "failing.test.js": "process.exit(1);",
    });

    const result = await executeDeterministicTest({
      rootPath,
      testFile: "failing.test.js",
    });

    assert.equal(result.launched, true);
    assert.equal(result.terminalState, "exited");
    assert.equal(result.exitCode, 1);
    assert.equal(result.pass, false);
    assert.equal(result.receipt, null, "Failed test must have null receipt");
    assert.match(result.reason, /exited with non-zero code 1/);
  } finally {
    await r.close();
  }
});

test("Case 3: Process crashing before reporting results cannot produce a verified receipt", async () => {
  const r = await rig();
  try {
    const rootPath = r.root("case3", {
      "crash.test.js": "process.abort();",
    });

    const result = await executeDeterministicTest({
      rootPath,
      testFile: "crash.test.js",
    });

    assert.equal(result.launched, true);
    assert.equal(result.pass, false);
    assert.equal(result.receipt, null);
    assert.ok(result.exitCode !== 0, "Crash code must not be 0");
  } finally {
    await r.close();
  }
});

test("Case 4: Process timeout cannot produce a verified receipt", async () => {
  const r = await rig();
  try {
    const rootPath = r.root("case4", {
      "hang.test.js": "setInterval(() => {}, 1000);",
    });

    const result = await executeDeterministicTest({
      rootPath,
      testFile: "hang.test.js",
      timeoutMs: 150,
    });

    assert.equal(result.launched, true);
    assert.equal(result.terminalState, "timedOut");
    assert.equal(result.pass, false);
    assert.equal(result.receipt, null);
    assert.match(result.reason, /timed out/);
  } finally {
    await r.close();
  }
});

test("Case 5: Process cancellation cannot produce a verified receipt", async () => {
  const r = await rig();
  try {
    const rootPath = r.root("case5", {
      "cancel.test.js": "setInterval(() => {}, 1000);",
    });

    const controller = new AbortController();
    setTimeout(() => controller.abort(), 80);

    const result = await executeDeterministicTest({
      rootPath,
      testFile: "cancel.test.js",
      timeoutMs: 5000,
      signal: controller.signal,
    });

    assert.equal(result.terminalState, "aborted");
    assert.equal(result.pass, false);
    assert.equal(result.receipt, null);
  } finally {
    await r.close();
  }
});

test("Case 6: Test output containing 'All tests passed' with nonzero exit code fails closed", async () => {
  const r = await rig();
  try {
    const rootPath = r.root("case6", {
      "spoof.test.js": "console.log('All tests passed'); console.log('Passed: 100, Failed: 0'); process.exit(42);",
    });

    const result = await executeDeterministicTest({
      rootPath,
      testFile: "spoof.test.js",
    });

    assert.equal(result.launched, true);
    assert.notEqual(result.exitCode, 0, "Non-zero exit code observed");
    assert.ok(result.stdout.includes("All tests passed"));
    assert.equal(result.pass, false, "Non-zero exit code overrides prose claims in stdout");
    assert.equal(result.receipt, null);
  } finally {
    await r.close();
  }
});

test("Case 7: Truncated stdout/stderr output fails closed and cannot produce a receipt", async () => {
  const r = await rig();
  try {
    const rootPath = r.root("case7", {
      "flood.test.js": "process.stdout.write('A'.repeat(5000)); process.exit(0);",
    });

    const result = await executeDeterministicTest({
      rootPath,
      testFile: "flood.test.js",
      maxOutput: 500, // force truncation
    });

    assert.equal(result.launched, true);
    assert.equal(result.exitCode, 0);
    assert.equal(result.truncated, true);
    assert.equal(result.pass, false, "Truncated output invalidates integrity even if exit code is 0");
    assert.equal(result.receipt, null);
    assert.match(result.reason, /truncated/);
  } finally {
    await r.close();
  }
});

test("Case 8: Missing required test report file fails closed", async () => {
  const r = await rig();
  try {
    const rootPath = r.root("case8", {
      "report.test.js": "console.log('Test ran without creating report file'); process.exit(0);",
    });

    const result = await executeDeterministicTest({
      rootPath,
      testFile: "report.test.js",
      reportFile: "nonexistent-report.json",
    });

    assert.equal(result.launched, true);
    assert.equal(result.exitCode, 0);
    assert.equal(result.reportMissing, true);
    assert.equal(result.pass, false, "Missing required report must fail");
    assert.equal(result.receipt, null);
  } finally {
    await r.close();
  }
});

test("Case 9: Untrusted file / shell injection attempts in test command fail closed", async () => {
  const r = await rig();
  try {
    const rootPath = r.root("case9", {
      "sample.test.js": "process.exit(0);",
    });

    const result = await executeDeterministicTest({
      rootPath,
      command: "node -e 'process.exit(0);' && rm -rf /",
    });

    assert.equal(result.launched, false);
    assert.equal(result.terminalState, "refused");
    assert.equal(result.pass, false);
    assert.equal(result.receipt, null);
    assert.match(result.reason, /prohibited shell characters/);
  } finally {
    await r.close();
  }
});

test("Case 10: Unauthorized executable request fails closed", async () => {
  const r = await rig();
  try {
    const rootPath = r.root("case10", {
      "sample.test.js": "process.exit(0);",
    });

    const result = await executeDeterministicTest({
      rootPath,
      command: "powershell.exe -Command Write-Host 'malicious'",
    });

    assert.equal(result.launched, false);
    assert.equal(result.terminalState, "refused");
    assert.equal(result.pass, false);
    assert.equal(result.receipt, null);
    assert.match(result.reason, /not an authorized test runner/);
  } finally {
    await r.close();
  }
});

test("Case 11: Stale test receipt referencing an older artifact version is rejected", () => {
  const v1Bytes = "function compute() { return 1; }";
  const v2Bytes = "function compute() { return 2; }";
  const hashV1 = sha256(v1Bytes);
  const hashV2 = sha256(v2Bytes);

  const receipt = `receipt:test-exec:test-12345:${hashV1}`;

  // Matching version passes
  const checkFresh = verifyTestReceipt({
    receipt,
    recordedArtifactHash: hashV1,
    currentArtifactHash: hashV1,
  });
  assert.equal(checkFresh.verified, true);

  // Modified file causes stale rejection
  const checkStale = verifyTestReceipt({
    receipt,
    recordedArtifactHash: hashV1,
    currentArtifactHash: hashV2,
  });
  assert.equal(checkStale.verified, false);
  assert.match(checkStale.reason, /Receipt artifact version is stale/);
});

test("Case 12: Irreversible operation interrupted after start is not automatically replayed and stays UNCERTAIN", async () => {
  let faultTriggered = false;
  const irreversibleExecutor = {
    kind: "deploy.release",
    category: "irreversible" as const,
    gpu: false,
    sideEffect: true,
    timeoutMs: 10_000,
    async run() {
      return { ok: true, output: "deployed", receipt: "receipt-deploy-1" };
    },
  };

  const r = await rig({
    faults: (point) => {
      if (point === "after-operation-start" && !faultTriggered) {
        faultTriggered = true;
        throw new SimulatedCrash(point);
      }
    },
  });
  try {
    (r.rt as any).executors.set("deploy.release", irreversibleExecutor);

    const steps = [
      { id: "deploy-step", kind: "deploy.release", input: { target: "prod" } },
    ];
    const taskSpec = spec(steps, "Adversarial Irreversible Replay Test");
    const taskEnvelope = envelope(steps, {}, {
      capabilities: ["deploy.release"],
      sideEffects: true,
    });

    const view = r.rt.create({ spec: taskSpec, envelope: taskEnvelope }, "workstation");
    r.rt.approve(view.id, "workstation");

    r.rt.wake();
    await r.rt.idle();

    // Host crashes and restarts
    await r.restart();

    // Verify task recovered to UNCERTAIN
    const recovered = r.rt.view(view.id) as any;
    assert.equal(recovered.state, "UNCERTAIN");

    // Multiple scheduler ticks MUST NOT automatically replay the uncertain step
    r.rt.wake();
    await r.rt.idle();
    r.rt.wake();
    await r.rt.idle();

    const afterTicks = r.rt.view(view.id) as any;
    assert.equal(afterTicks.state, "UNCERTAIN", "Task remains UNCERTAIN; cannot auto-replay");

    // Only owner reconciliation can transition it
    r.rt.reconcile(view.id, "not_happened", "workstation");
    const reconciled = r.rt.view(view.id) as any;
    assert.equal(reconciled.state, "QUEUED");
  } finally {
    await r.close();
  }
});
