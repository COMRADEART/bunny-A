import test from "node:test";
import assert from "node:assert/strict";
import {
  FROZEN_BENCHMARK_TASKS,
  FROZEN_BENCHMARK_VERSION,
  runLiveBenchmark,
  type BenchmarkTask,
} from "./live-benchmark.server.ts";

test("frozen benchmark: enforces exact 60-task dataset with 30 dev and 30 held-out split", () => {
  assert.equal(FROZEN_BENCHMARK_TASKS.length, 60, "Dataset must contain exactly 60 tasks");

  const devTasks = FROZEN_BENCHMARK_TASKS.filter(t => t.split === "dev");
  const heldOutTasks = FROZEN_BENCHMARK_TASKS.filter(t => t.split === "held-out");

  assert.equal(devTasks.length, 30, "Must have exactly 30 dev tasks");
  assert.equal(heldOutTasks.length, 30, "Must have exactly 30 held-out tasks");

  const categories = ["direct", "single-resource", "multi-step", "repair-verification"] as const;
  for (const cat of categories) {
    const inCat = FROZEN_BENCHMARK_TASKS.filter(t => t.category === cat);
    assert.equal(inCat.length, 15, `Category ${cat} must contain exactly 15 tasks`);
    const devInCat = inCat.filter(t => t.split === "dev").length;
    const heldInCat = inCat.filter(t => t.split === "held-out").length;
    assert.ok(devInCat === 7 || devInCat === 8, "Each category must have balanced 7 or 8 split");
    assert.equal(devInCat + heldInCat, 15);
  }

  // All task IDs must be unique
  const ids = new Set(FROZEN_BENCHMARK_TASKS.map(t => t.id));
  assert.equal(ids.size, 60, "All task IDs must be unique");
});

test("frozen benchmark: runs deterministic verification without untrusted LLM self-confidence", async () => {
  const sampleTasks: BenchmarkTask[] = [
    {
      id: "TEST-01",
      name: "Mock Direct",
      category: "direct",
      taskClass: "C0",
      split: "dev",
      prompt: "Reply with 42",
      expectedPattern: /^42$/,
    },
    {
      id: "TEST-02",
      name: "Mock Grounded",
      category: "single-resource",
      taskClass: "C1",
      split: "dev",
      prompt: "Find port in config",
      referenceFiles: { "config.json": '{"port": 9000}' },
      expectedOutputSubstring: "9000",
    },
  ];

  // Mock model call returning correct answers
  const mockCall = async (req: { prompt: string }) => {
    if (req.prompt.includes("Reply with 42")) {
      return { ok: true as const, text: "42", servedModel: "mock:7b", durationMs: 5 };
    }
    return { ok: true as const, text: "The port is 9000", servedModel: "mock:7b", durationMs: 8 };
  };

  const report = await runLiveBenchmark({
    tasks: sampleTasks,
    model: "mock:7b",
    call: mockCall,
  });

  assert.equal(report.totalTasks, 2);
  assert.equal(report.candidate.passedCount, 2);
  assert.equal(report.candidate.passRate, 1.0);
  assert.equal(report.baseline.passedCount, 2);
  assert.ok(report.candidate.totalModelCalls <= report.baseline.totalModelCalls);
});
