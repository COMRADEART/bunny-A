import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync as fsWriteFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  runLiveBenchmark,
  sampleGpuTelemetry,
  getOllamaModelDigest,
  lookupOllamaModelDigest,
  BENCHMARK_MODEL,
  BENCHMARK_MODEL_DIGEST,
  type BenchmarkTask,
} from "./live-benchmark.server.ts";
import {
  executeDeterministicTest,
  verifyTestReceipt,
} from "./test-runner.server.ts";
import {
  createOutcomeRecord,
  isVerifiedSuccess,
} from "./outcome-measurement.ts";

test("benchmark integrity: tool calls and model calls are counted strictly from executed operations", async () => {
  const tasks: BenchmarkTask[] = [
    {
      id: "INT-01",
      name: "Direct question without tools",
      category: "direct",
      taskClass: "C0",
      split: "dev",
      prompt: "Reply with pong",
      expectedPattern: /^pong$/,
    },
    {
      id: "INT-02",
      name: "Single resource reading 1 file",
      category: "single-resource",
      taskClass: "C1",
      split: "dev",
      prompt: "Find secret in config",
      referenceFiles: {
        "alpha.json": JSON.stringify({ key: "alpha-val" }),
        "beta.json": JSON.stringify({ key: "beta-val" }),
        "gamma.json": JSON.stringify({ key: "gamma-val" }),
      }, // 3 reference files provided, but workflow only executes file.read for the required file!
      expectedOutputSubstring: "alpha-val",
    },
  ];

  const mockCall = async (req: { prompt: string }) => {
    if (req.prompt.includes("pong")) return { ok: true as const, text: "pong", servedModel: "mock:7b", durationMs: 4 };
    return { ok: true as const, text: "Found key: alpha-val", servedModel: "mock:7b", durationMs: 6 };
  };

  const report = await runLiveBenchmark({
    tasks,
    model: "mock:7b",
    call: mockCall,
  });

  // Task INT-01 (C0 direct): toolCalls must be 0, NOT estimated or reference-file count
  const c0Run = report.runs.find(r => r.taskId === "INT-01" && r.system === "candidate")!;
  assert.equal(c0Run.toolCalls, 0, "C0 direct task must execute 0 tool calls");
  assert.equal(c0Run.modelCalls, 1, "C0 task executes exactly 1 model call");

  // Task INT-02 (C1 single-resource): exactly 1 tool call executed, NOT 3 (number of reference files)
  const c1Run = report.runs.find(r => r.taskId === "INT-02" && r.system === "candidate")!;
  assert.equal(c1Run.toolCalls, 1, "Must count observed Host tool executions, not referenceFiles count (3)");
  assert.equal(c1Run.modelCalls, 1, "C1 task executes exactly 1 model call");
});

test("receipt integrity: eliminates synthetic receipts for text oracle tasks and classifies evidence categories truthfully", async () => {
  const tasks: BenchmarkTask[] = [
    {
      id: "RCPT-01",
      name: "Direct text question without process execution",
      category: "direct",
      taskClass: "C0",
      split: "dev",
      prompt: "Say hello",
      expectedOutputSubstring: "hello",
    },
    {
      id: "RCPT-02",
      name: "Text verification evaluated by oracle without process execution",
      category: "repair-verification",
      taskClass: "C3",
      split: "dev",
      prompt: "Verify mathematical identity 2+2=4",
      validator: (out) => out.includes("4"),
    },
  ];

  const mockCall = async () => ({
    ok: true as const,
    text: "hello 4",
    servedModel: "mock:7b",
    durationMs: 5,
  });

  const report = await runLiveBenchmark({
    tasks,
    model: "mock:7b",
    call: mockCall,
  });

  const rcpt01 = report.runs.find(r => r.taskId === "RCPT-01" && r.system === "candidate")!;
  assert.equal(rcpt01.evidenceCategory, "oracle_validation", "Text tasks must be categorized as oracle_validation");
  assert.equal(rcpt01.outcomeRecord.evidence.hostVerified.testReceipts.length, 0, "Oracle validation must produce 0 process receipts");
  assert.ok(isVerifiedSuccess(rcpt01.outcomeRecord), "Oracle-validated task passes without process receipts");

  const rcpt02 = report.runs.find(r => r.taskId === "RCPT-02" && r.system === "candidate")!;
  assert.equal(rcpt02.evidenceCategory, "oracle_validation", "Text validator tasks without process launch are oracle_validation");
  assert.equal(rcpt02.outcomeRecord.evidence.hostVerified.testReceipts.length, 0, "No synthetic test execution receipts are generated");
});

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 1: MANDATORY NEGATIVE TESTS FOR PROCESS RECEIPT PROVENANCE (12 REQUIRED)
// ─────────────────────────────────────────────────────────────────────────────

test("negative test 1: model prints PASS does not produce a verified process receipt", () => {
  const outcome = createOutcomeRecord({
    taskId: "NEG-01",
    projectId: "bench-neg",
    taskClass: "C0",
    taskText: "Check condition",
    acceptanceContract: "Must run deterministic test process",
    approvedModel: { id: "mock:7b", digest: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef" },
    rolesInvoked: ["Worker"],
    modelCallCount: 1,
    toolCallCount: 0,
    status: "success",
    queueTimeMs: 1,
    executionTimeMs: 10,
    modelGenerated: { summaries: ["PASS"] },
    hostVerified: {
      evidenceCategory: "process_test",
      testReceipts: [], // Model printing PASS produces no process receipts
      exitCodes: [0],
      fileModifications: [],
      stateTransitions: ["QUEUED", "RUNNING", "COMPLETED"],
      completedContracts: true,
      permissionsGranted: [],
    },
  });

  assert.equal(isVerifiedSuccess(outcome), false, "Model text PASS cannot verify process_test without genuine receipts");
});

test("negative test 2: model emits fake exit code zero does not create a process receipt", () => {
  const outcome = createOutcomeRecord({
    taskId: "NEG-02",
    projectId: "bench-neg",
    taskClass: "C0",
    taskText: "Check code",
    acceptanceContract: "Must execute deterministic test",
    approvedModel: { id: "mock:7b", digest: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef" },
    rolesInvoked: ["Worker"],
    modelCallCount: 1,
    toolCallCount: 0,
    status: "success",
    queueTimeMs: 1,
    executionTimeMs: 10,
    modelGenerated: { summaries: ["[process exited with code 0]"] },
    hostVerified: {
      evidenceCategory: "process_test",
      testReceipts: [], // Fake exit code 0 does not produce receipts
      exitCodes: [],
      fileModifications: [],
      stateTransitions: ["QUEUED", "RUNNING", "COMPLETED"],
      completedContracts: true,
      permissionsGranted: [],
    },
  });

  assert.equal(isVerifiedSuccess(outcome), false, "Model emitted fake exit code 0 fails process_test verification");
});

test("negative test 3: model emits a 64-character hexadecimal string fails receipt verification", () => {
  const fakeHash = "dae161e27b0e90dd1856c8bb3209201fd6736d8eb66298e75ed87571486f4364";
  const verified = verifyTestReceipt({
    receipt: fakeHash, // Missing receipt:test-exec: prefix and host execution binding
  });
  assert.equal(verified.verified, false, "Raw 64-char hex string is not a verified test execution receipt");
  assert.match(verified.reason, /receipt format/i);
});

test("negative test 4: oracle accepts text without any process launch (zero test receipts)", () => {
  const outcome = createOutcomeRecord({
    taskId: "NEG-04",
    projectId: "bench-neg",
    taskClass: "C0",
    taskText: "Compute 2 + 2",
    acceptanceContract: "Deterministic text oracle check",
    approvedModel: { id: "mock:7b", digest: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef" },
    rolesInvoked: ["Worker"],
    modelCallCount: 1,
    toolCallCount: 0,
    status: "success",
    queueTimeMs: 1,
    executionTimeMs: 5,
    hostVerified: {
      evidenceCategory: "oracle_validation",
      testReceipts: [], // Strictly 0 test receipts
      exitCodes: [],
      fileModifications: [],
      stateTransitions: ["QUEUED", "RUNNING", "COMPLETED"],
      completedContracts: true,
      permissionsGranted: [],
    },
  });

  assert.equal(isVerifiedSuccess(outcome), true, "Oracle validation succeeds without process receipts");
  assert.equal(outcome.evidence.hostVerified.testReceipts.length, 0, "Must contain 0 test receipts");
});

test("negative test 5: real test process fails (exit code 1) produces no verified receipt", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "bunny-test-runner-fail-"));
  const testFile = join(tempDir, "failing.test.js");
  fsWriteFileSync(testFile, 'import test from "node:test"; test("fail", () => { throw new Error("Deliberate failure"); });', "utf8");

  try {
    const res = await executeDeterministicTest({
      rootPath: tempDir,
      testFile: "failing.test.js",
    });

    assert.equal(res.launched, true);
    assert.equal(res.exitCode, 1);
    assert.equal(res.pass, false, "Failing test process must not pass");
    assert.equal(res.receipt, null, "Failing test process must produce null receipt");
    assert.match(res.reason, /non-zero code 1/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("negative test 6: real test process times out produces no verified receipt", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "bunny-test-runner-timeout-"));
  const testFile = join(tempDir, "hang.test.js");
  fsWriteFileSync(testFile, 'import test from "node:test"; test("hang", async () => { await new Promise(r => setTimeout(r, 10000)); });', "utf8");

  try {
    const res = await executeDeterministicTest({
      rootPath: tempDir,
      testFile: "hang.test.js",
      timeoutMs: 150, // Short timeout
    });

    assert.equal(res.launched, true);
    assert.equal(res.terminalState, "timedOut");
    assert.equal(res.pass, false);
    assert.equal(res.receipt, null, "Timed out process must produce null receipt");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("negative test 7: real test process is cancelled produces no verified receipt", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "bunny-test-runner-cancel-"));
  const testFile = join(tempDir, "slow.test.js");
  fsWriteFileSync(testFile, 'import test from "node:test"; test("slow", async () => { await new Promise(r => setTimeout(r, 10000)); });', "utf8");

  const controller = new AbortController();
  setTimeout(() => controller.abort(), 100);

  try {
    const res = await executeDeterministicTest({
      rootPath: tempDir,
      testFile: "slow.test.js",
      signal: controller.signal,
    });

    assert.equal(res.terminalState, "aborted");
    assert.equal(res.pass, false);
    assert.equal(res.receipt, null, "Cancelled process must produce null receipt");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("negative test 8: test report predates the run is rejected as stale", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "bunny-test-runner-stale-"));
  const testFile = join(tempDir, "dummy.test.js");
  const reportFile = join(tempDir, "report.json");

  // Pre-create report before test runs
  fsWriteFileSync(reportFile, JSON.stringify({ passed: 1, failed: 0 }), "utf8");
  // Test does NOT write or update report
  fsWriteFileSync(testFile, 'import test from "node:test"; test("dummy", () => {});', "utf8");

  try {
    const res = await executeDeterministicTest({
      rootPath: tempDir,
      testFile: "dummy.test.js",
      reportFile: "report.json",
    });

    assert.equal(res.pass, false, "Stale report file must be rejected");
    assert.equal(res.reportMissing, true);
    assert.equal(res.receipt, null, "Stale report must produce null receipt");
    assert.match(res.reason, /stale evidence/i);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("negative test 9: test report references another artifact (hash mismatch)", () => {
  const validReceipt = "receipt:test-exec:exec-1:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  const verified = verifyTestReceipt({
    receipt: validReceipt,
    recordedArtifactHash: "0000000000000000000000000000000000000000000000000000000000000001",
    currentArtifactHash: "0000000000000000000000000000000000000000000000000000000000000002", // Mismatched!
  });

  assert.equal(verified.verified, false, "Receipt with modified artifact must fail verification");
  assert.match(verified.reason, /stale; target file was modified/i);
});

test("negative test 10: required assertions are absent (0 passed assertions in report)", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "bunny-test-runner-zero-"));
  const testFile = join(tempDir, "zero.test.js");
  const reportFile = join(tempDir, "report.json");
  // Test writes report with 0 passed assertions
  fsWriteFileSync(testFile, `import fs from "node:fs"; import test from "node:test"; test("write empty report", () => { fs.writeFileSync("report.json", JSON.stringify({ passed: 0, failed: 0 })); });`, "utf8");

  try {
    const res = await executeDeterministicTest({
      rootPath: tempDir,
      testFile: "zero.test.js",
      reportFile: "report.json",
      requireAssertions: true,
    });

    assert.equal(res.pass, false, "Zero assertions must fail when assertions are required");
    assert.equal(res.receipt, null);
    assert.match(res.reason, /0 passed assertions/i);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("negative test 11: Host journal has no matching operation", () => {
  const fakeReceipt = "receipt:test-exec:unrecorded-exec-id:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  const mockJournal = [
    { operationId: "op-1", kind: "file.read", receipt: "receipt:file:abc" },
  ];

  const matched = mockJournal.find(op => op.receipt === fakeReceipt);
  assert.equal(matched, undefined, "Unrecorded receipt has no matching Host journal operation");
});

test("negative test 12: process identity or authorization changes is refused", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "bunny-test-runner-unauth-"));

  try {
    // Attempting to run unapproved executable (e.g. powershell or cmd)
    const res = await executeDeterministicTest({
      rootPath: tempDir,
      command: "powershell.exe",
      args: ["-Command", "Get-Process"],
    });

    assert.equal(res.launched, false, "Unapproved executable must not launch");
    assert.equal(res.terminalState, "refused");
    assert.equal(res.pass, false);
    assert.equal(res.receipt, null);
    assert.match(res.reason, /not an authorized test runner/i);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 3: MODEL IDENTITY FAIL-CLOSED VERIFICATION
// ─────────────────────────────────────────────────────────────────────────────

test("model identity: fail-closed Ollama verification rejects unapproved, malformed, or remote cloud models", async () => {
  // 1. Unapproved model
  const unapproved = await lookupOllamaModelDigest("nonexistent-model:99b", "http://127.0.0.1:11434", {
    inventoryFixture: [{ name: "other-model:7b", digest: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef" }],
  });
  assert.equal(unapproved.verified, false);
  assert.equal(unapproved.status, "unapproved_model");
  assert.equal(unapproved.observedDigest, null);

  // 1b. Offline/unreachable daemon fails closed
  const offline = await lookupOllamaModelDigest("any-model:7b", "http://127.0.0.1:19999");
  assert.equal(offline.verified, false);
  assert.equal(offline.status, "unavailable");
  assert.equal(offline.observedDigest, null);

  // 2. Remote cloud model rejected for local-only benchmark
  const cloudFixture = [
    {
      name: "deepseek-v4.1-flash:cloud",
      digest: "e04da138d31e0c9468e982e1ae9503d06cb7e170caa16a90c17d931c4aa140f8",
      remote_host: "https://ollama.com",
    },
  ];
  const remoteRes = await lookupOllamaModelDigest("deepseek-v4.1-flash:cloud", "http://127.0.0.1:11434", {
    inventoryFixture: cloudFixture,
  });
  assert.equal(remoteRes.verified, false);
  assert.equal(remoteRes.status, "remote_model_rejected");
  assert.match(remoteRes.error ?? "", /remote cloud model/i);

  // 3. Simulated model fixture is visibly labeled simulated
  const simRes = await lookupOllamaModelDigest("test-sim:7b", "http://127.0.0.1:11434", {
    inventoryFixture: [{ name: "test-sim:7b", digest: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef" }],
  });
  assert.equal(simRes.verified, true);
  assert.equal(simRes.status, "simulated");
  assert.equal(simRes.isSimulated, true);

  // 4. Physical daemon check (verifies exact digest if Ollama is running, or fails closed if offline in CI)
  const realRes = await lookupOllamaModelDigest(BENCHMARK_MODEL, "http://127.0.0.1:11434");
  if (realRes.status === "verified") {
    assert.equal(realRes.verified, true);
    assert.equal(realRes.isSimulated, false);
    assert.equal(realRes.observedDigest, BENCHMARK_MODEL_DIGEST);
  } else {
    assert.equal(realRes.verified, false);
    assert.equal(realRes.isSimulated, false);
    assert.equal(realRes.status, "unavailable");
    assert.equal(realRes.observedDigest, null);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 4: HARDWARE TELEMETRY TRUTHFULNESS & FAIL-CLOSED SAFETY
// ─────────────────────────────────────────────────────────────────────────────

test("hardware telemetry: collects physical VRAM and RAM measurements without hardcoded mocks", async () => {
  const telem = await sampleGpuTelemetry();
  if (telem.available) {
    assert.ok(telem.totalVramBytes! > 0, "Total VRAM must be positive");
    assert.ok(telem.freeVramBytes! >= 0, "Free VRAM must be non-negative");
    assert.ok(telem.usedVramBytes! >= 0, "Used VRAM must be non-negative");
    assert.equal(typeof telem.gpuName, "string");
    assert.equal(typeof telem.name, "string");
    assert.ok(telem.gpuName!.length > 0);
  } else {
    assert.equal(telem.totalVramBytes, null);
    assert.equal(telem.usedVramBytes, null);
    assert.equal(telem.freeVramBytes, null);
    assert.equal(telem.gpuName, null);
    assert.equal(telem.name, null);
  }
});

test("hardware telemetry: returns unavailable with nulls when observation fails, never fabricating RTX 4050", async () => {
  const unavailableTelem = await sampleGpuTelemetry({
    fixture: {
      available: false,
      unavailableReason: "NVIDIA SMI executable not found",
      gpuName: null,
      totalVramBytes: null,
      usedVramBytes: null,
      freeVramBytes: null,
      gpuUtilPercent: null,
      valid: false,
    },
  });

  assert.equal(unavailableTelem.available, false);
  assert.equal(unavailableTelem.source, "fixture");
  assert.equal(unavailableTelem.totalVramBytes, null);
  assert.equal(unavailableTelem.usedVramBytes, null);
  assert.equal(unavailableTelem.freeVramBytes, null);
  assert.equal(unavailableTelem.gpuName, null);
  assert.equal(unavailableTelem.name, null);
  assert.equal(unavailableTelem.gpuUtilPercent, null);
});

test("balanced paired experiment: alternates execution order using ABBA sequence", async () => {
  const tasks: BenchmarkTask[] = [
    { id: "T-0", name: "0", category: "direct", taskClass: "C0", split: "dev", prompt: "0", expectedOutputSubstring: "0" },
    { id: "T-1", name: "1", category: "direct", taskClass: "C0", split: "dev", prompt: "1", expectedOutputSubstring: "1" },
    { id: "T-2", name: "2", category: "direct", taskClass: "C0", split: "dev", prompt: "2", expectedOutputSubstring: "2" },
    { id: "T-3", name: "3", category: "direct", taskClass: "C0", split: "dev", prompt: "3", expectedOutputSubstring: "3" },
  ];

  const call = async (req: { prompt: string }) => ({ ok: true as const, text: req.prompt, servedModel: "m", durationMs: 2 });

  const report = await runLiveBenchmark({
    tasks,
    model: "mock",
    call,
  });

  assert.equal(report.executionOrder, "ABBA-balanced");

  // In runs array:
  // Task 0 (i=0): Candidate first (runs[0]=cand, runs[1]=base)
  // Task 1 (i=1): Baseline first (runs[2]=base, runs[3]=cand)
  // Task 2 (i=2): Baseline first (runs[4]=base, runs[5]=cand)
  // Task 3 (i=3): Candidate first (runs[6]=cand, runs[7]=base)
  assert.equal(report.runs[0].system, "candidate");
  assert.equal(report.runs[1].system, "baseline");

  assert.equal(report.runs[2].system, "baseline");
  assert.equal(report.runs[3].system, "candidate");

  assert.equal(report.runs[4].system, "baseline");
  assert.equal(report.runs[5].system, "candidate");

  assert.equal(report.runs[6].system, "candidate");
  assert.equal(report.runs[7].system, "baseline");

  // Verify policy ablation comparison is present and clearly labeled
  assert.ok(report.comparisonA_policyAblation);
  assert.match(report.comparisonA_policyAblation.reviewerOverheadNotice, /reviewer/i);

  // Verify historical production comparison is present and marked BLOCKED_NOT_COMPARABLE
  assert.equal(report.comparisonB_historicalProduction.status, "BLOCKED_NOT_COMPARABLE");
});
