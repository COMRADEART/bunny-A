import assert from "node:assert/strict";
import test from "node:test";
import {
  canRunInParallel,
  reportNpuStatus,
  ResourceAwareModelScheduler,
  REFERENCE_RTX_4050_VRAM_BYTES,
} from "./resource-scheduler.ts";

test("resource scheduler: two large models on 6 GiB GPU refuse parallel execution to prevent thrashing", () => {
  // Two distinct 7B models on RTX 4050 (6.1 GiB)
  const decision = canRunInParallel(
    "qwen2.5-coder:7b",
    "huihui_ai/qwen2.5-abliterate:7b",
    REFERENCE_RTX_4050_VRAM_BYTES,
  );

  assert.equal(decision.allowed, false, "Two 7B models cannot safely coexist in 6 GiB VRAM");
  assert.equal(decision.fallbackMode, "grouped");
  assert.ok(decision.reason.includes("exceeds dedicated VRAM"));
});

test("resource scheduler: same model shared between roles reuses single resident footprint", () => {
  const decision = canRunInParallel(
    "qwen2.5-coder:7b",
    "qwen2.5-coder:7b",
    REFERENCE_RTX_4050_VRAM_BYTES,
  );

  assert.equal(decision.allowed, true, "Same model shared between Worker and Tester fits in VRAM once");
  assert.ok(decision.reason.includes("resident once"));
});

test("resource scheduler: unknown model footprints fail closed to sequential execution", () => {
  const decision = canRunInParallel(
    "qwen2.5-coder:7b",
    "custom-unmeasured-model:latest",
    REFERENCE_RTX_4050_VRAM_BYTES,
  );

  assert.equal(decision.allowed, false);
  assert.equal(decision.fallbackMode, "sequential");
  assert.ok(decision.reason.includes("Unknown model sizes"));
});

test("resource scheduler: NPU status reports hardware presence without fabricating inference support", () => {
  const npu = reportNpuStatus("Intel(R) AI Boost");
  assert.equal(npu.detected, true);
  assert.equal(npu.name, "Intel(R) AI Boost");
  assert.equal(npu.supportedByOllama, false, "Must not claim Ollama supports Intel NPU when unsupported");
  assert.equal(npu.qualifiedForT4, false);
  assert.ok(npu.detail.includes("Safe fallback retains CUDA GPU/CPU"));
});

test("resource scheduler: tracks cold vs warm latency and decides residency retention", () => {
  const scheduler = new ResourceAwareModelScheduler();
  const model = "qwen2.5-coder:7b";

  // Cold call: duration 7500ms, load duration 7000ms
  scheduler.recordCallDuration(model, 7500, 7000);
  assert.equal(scheduler.getResidentModel(), model);
  let metrics = scheduler.getLatencyMetrics(model)!;
  assert.equal(metrics.coldMs, 7500);

  // Warm call: duration 320ms, load duration 5ms
  scheduler.recordCallDuration(model, 320, 5);
  metrics = scheduler.getLatencyMetrics(model)!;
  assert.equal(metrics.callCount, 2);
  assert.ok(metrics.warmMs !== null && metrics.warmMs < 1000);

  // Active residency retention
  assert.equal(scheduler.shouldRetainResident(model, Date.now()), true);
  // After 3 minutes of idle time, model should be evicted
  assert.equal(scheduler.shouldRetainResident(model, Date.now() + 180_000), false);
});
