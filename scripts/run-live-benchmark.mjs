import fs from "node:fs";
import path from "node:path";
import { runLiveBenchmark, FROZEN_BENCHMARK_TASKS, BENCHMARK_MODEL } from "../src/lib/bunny-host/ma4/live-benchmark.server.ts";

async function main() {
  console.log(`Starting live benchmark on local Ollama model: ${BENCHMARK_MODEL}...`);
  console.log(`Dataset size: ${FROZEN_BENCHMARK_TASKS.length} tasks (30 dev, 30 held-out).`);

  const start = performance.now();
  const report = await runLiveBenchmark({
    endpoint: "http://127.0.0.1:11434",
    model: BENCHMARK_MODEL,
    onProgress: (i, total, task) => {
      process.stdout.write(`[${i}/${total}] (${task.category}/${task.taskClass}) ${task.id}: ${task.name}... `);
    },
  });

  const totalTime = ((performance.now() - start) / 1000).toFixed(1);
  console.log(`\n\n=== LIVE BENCHMARK COMPLETE in ${totalTime}s ===`);
  console.log(`Model: ${report.model}`);
  console.log(`Baseline Pass Rate: ${(report.baseline.passRate * 100).toFixed(1)}% (${report.baseline.passedCount}/${report.totalTasks})`);
  console.log(`Candidate Pass Rate: ${(report.candidate.passRate * 100).toFixed(1)}% (${report.candidate.passedCount}/${report.totalTasks})`);
  console.log(`Model Efficiency Gain: ${report.delta.modelCallEfficiencyImprovement} fewer model calls`);
  console.log(`Baseline Calls/Success: ${report.baseline.modelCallsPerSuccess.toFixed(2)} vs Candidate: ${report.candidate.modelCallsPerSuccess.toFixed(2)}`);
  console.log(`Reused Artifacts: ${report.candidate.reusedArtifactCount}`);
  console.log(`Redundant Steps Eliminated: ${report.candidate.redundantStepsEliminated}`);
  console.log(`\nMemory A/B Test:`);
  console.log(`  Condition A (Disabled): ${(report.memoryAbTest.conditionADisabled.passRate * 100).toFixed(1)}%`);
  console.log(`  Condition B (Verified Promoted): ${(report.memoryAbTest.conditionBVerified.passRate * 100).toFixed(1)}%`);
  console.log(`  Condition C (Unfiltered Noise): ${(report.memoryAbTest.conditionCUnfiltered.passRate * 100).toFixed(1)}%`);

  const outputPath = path.resolve("test-results/ma4-s3-t4/benchmark-report.json");
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2), "utf8");
  console.log(`Report successfully written to ${outputPath}`);
}

main().catch((err) => {
  console.error("Benchmark failed with error:", err);
  process.exit(1);
});
