import test from "node:test";
import assert from "node:assert/strict";
import {
  runLiveBenchmark,
  sampleGpuTelemetry,
  getOllamaModelDigest,
  BENCHMARK_MODEL_DIGEST,
  type BenchmarkTask,
} from "./live-benchmark.server.ts";

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

test("receipt integrity: eliminates synthetic rcpt-* identifiers and enforces genuine process provenance", async () => {
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
      name: "Test verification requiring real test process",
      category: "repair-verification",
      taskClass: "C3",
      split: "dev",
      prompt: "Verify mathematical identity 2+2=4",
      validator: (out) => out.includes("4"),
    },
  ];

  const mockCall = async (req: { prompt: string }) => ({
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
  // Synthetic rcpt-RCPT-01 must be completely eliminated!
  assert.ok(!rcpt01.outcomeRecord.evidence.hostVerified.testReceipts.includes("rcpt-RCPT-01"), "Synthetic rcpt-* identifier must not be generated");
  assert.equal(rcpt01.outcomeRecord.evidence.hostVerified.testReceipts.length, 0, "Task without test process has 0 test receipts");

  const rcpt02 = report.runs.find(r => r.taskId === "RCPT-02" && r.system === "candidate")!;
  assert.ok(rcpt02.outcomeRecord.evidence.hostVerified.testReceipts.length > 0, "Real test process produces genuine receipt");
  // The receipt must be a 64-char hex SHA256 receipt from actual test execution
  const rHash = rcpt02.outcomeRecord.evidence.hostVerified.testReceipts[0];
  assert.match(rHash, /^[0-9a-f]{64}$/, "Genuine receipt must be a cryptographic SHA-256 process hash");
});

test("model digest integrity: reports non-null verified SHA256 digest in outcomes", async () => {
  const tasks: BenchmarkTask[] = [
    {
      id: "DIG-01",
      name: "Digest check",
      category: "direct",
      taskClass: "C0",
      split: "dev",
      prompt: "Test",
      expectedOutputSubstring: "Test",
    },
  ];

  const mockCall = async () => ({ ok: true as const, text: "Test", servedModel: "mock:7b", durationMs: 5 });

  const report = await runLiveBenchmark({
    tasks,
    model: "qwen2.5-coder:7b",
    call: mockCall,
  });

  assert.equal(report.modelDigest, BENCHMARK_MODEL_DIGEST);
  assert.equal(typeof report.modelDigest, "string");
  assert.match(report.modelDigest, /^[0-9a-f]{64}$/);

  for (const r of report.runs) {
    assert.equal(r.outcomeRecord.approvedModel.digest, BENCHMARK_MODEL_DIGEST, "approvedModel.digest must not be null");
    assert.equal(r.outcomeRecord.observedModel?.digest, BENCHMARK_MODEL_DIGEST, "observedModel.digest must not be null");
  }
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
});

test("hardware telemetry: collects physical VRAM and RAM measurements without hardcoded mocks", async () => {
  const telem = await sampleGpuTelemetry();
  assert.ok(telem.totalVramBytes > 0, "Total VRAM must be positive");
  assert.ok(telem.freeVramBytes >= 0, "Free VRAM must be non-negative");
  assert.ok(telem.usedVramBytes >= 0, "Used VRAM must be non-negative");
  assert.equal(typeof telem.name, "string");
  assert.ok(telem.name.length > 0);
});
