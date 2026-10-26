import fs from "node:fs";
import path from "node:path";
import { runMultiAgentReliabilitySuite } from "../src/lib/bunny-host/ma4/multi-agent-reliability.server.ts";
import { createOllamaModelCall } from "../src/lib/bunny-host/ma4/live-benchmark.server.ts";

async function main() {
  const model = "qwen2.5-coder:7b";
  const endpoint = "http://127.0.0.1:11434";
  console.log(`Starting Live Multi-Agent Qualification on local Ollama model: ${model}...`);

  const realCall = createOllamaModelCall(endpoint);

  const start = performance.now();
  const report = await runMultiAgentReliabilitySuite({
    endpoint,
    model,
    call: realCall,
  });

  const totalTime = ((performance.now() - start) / 1000).toFixed(1);
  console.log(`\n=== LIVE MULTI-AGENT QUALIFICATION COMPLETE in ${totalTime}s ===`);
  console.log(`All Passed: ${report.allPassed}`);
  console.log(`Total Scenarios: ${report.scenarios.length}`);
  for (const s of report.scenarios) {
    console.log(`  [Scenario ${s.id}] ${s.name}: ${s.passed ? "PASS" : "FAIL"} (Roles: ${s.rolesInvoked.join(", ")}; Receipts: ${s.handoffReceipts.length}; Duration: ${s.durationMs.toFixed(0)}ms)`);
  }

  const outputPath = path.resolve("test-results/ma4-s3-t4r1/multi-agent-qualification.json");
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2), "utf8");
  console.log(`Report successfully written to ${outputPath}`);
}

main().catch((err) => {
  console.error("Multi-Agent qualification failed:", err);
  process.exit(1);
});
