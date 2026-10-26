# MA4-S3-T4R1 Measurement Integrity Audit

**Product:** Bunny A by LOKAM  
**Milestone:** MA4-S3-T4R1  
**Auditor:** Quality & Host Measurement Integrity Qualification  
**Audit Target:** MA4-S3-T4 (PR #48) Review Defects  
**Date:** October 26, 2026  

---

## 1. Executive Summary

During the architectural review of MA4-S3-T4 (PR #48), ten critical measurement defects were identified in the benchmark evaluation harness, execution telemetry, and outcome reporting. While the underlying core architecture (Host runtime, Coordinator, authorization envelopes, adaptive planner) was robust, the benchmark reporting suite contained synthetic approximations and experimental confounds.

MA4-S3-T4R1 addresses and resolves all ten measurement defects. No scores have been manufactured. Every metric reported is derived from observed process execution receipts, live hardware telemetry, and mathematically balanced paired experiments.

---

## 2. Audit Matrix: Ten Review Defects & Resolution Evidence

| Defect # | Identified Review Defect | Predecessor Flaw (T4) | T4R1 Resolution & Verification Evidence | Status |
| :---: | :--- | :--- | :--- | :---: |
| **1** | **Host Runtime Execution Path** | Predecessor executed raw Ollama calls without driving tasks through the complete Host runtime stack. | Replaced with `executeHostWorkflow()` running every task through `PersistentTaskRuntime`, `TaskStore`, disposable `HostDatabase`, and registered executors (`file.read`, `local.generate`, `local.test`, `local.review`). | **RESOLVED** |
| **2** | **Tool Execution Accounting** | Counted tool calls based on reference file counts (`Object.keys(task.referenceFiles).length`) rather than executed operations. | Tool calls are strictly counted from observed, non-pure-GPU step invocations (`attempts > 0` on registered tool executors). Planned steps do not increment counters. | **RESOLVED** |
| **3** | **Artifact Reuse & DAG Pruning** | Incremented counters heuristically whenever a task belonged to class C1 or had multiple files. | Instrumented actual DAG evaluation via `evaluateArtifactReuse()`. A cache hit requires matching scope, source content hash, verification contract, non-expired TTL, and valid tamper checks. Verified by 9 negative tests. | **RESOLVED** |
| **4** | **Synthetic Success Receipts** | Generated synthetic receipt strings (`rcpt-${task.id}`) whenever an independent text oracle passed. | Synthetic identifiers completely eliminated. Answer correctness (oracle text evaluation) is strictly separated from genuine process test receipts (`testProcessReceipts`). | **RESOLVED** |
| **5** | **Null Model Digests** | Benchmark outcomes stored `null` model digests due to missing query integration. | Integrated `getOllamaModelDigest()`, querying Ollama's `/api/tags` endpoint and recording the exact SHA256 digest (`dae161e27b0e90dd1856c8bb3209201fd6736d8eb66298e75ed87571486f4364`). | **RESOLVED** |
| **6** | **Hardware Telemetry** | Used fixed constant estimates (4.1 GiB peak VRAM) for every task run. | Implemented `sampleGpuTelemetry()` querying live `nvidia-smi` and Windows OS memory before and after each run, recording exact free VRAM, used VRAM, and GPU utilization. | **RESOLVED** |
| **7** | **Execution Ordering Bias** | Ran candidate before baseline for all 60 tasks, introducing thermal and cache bias. | Implemented balanced ABBA sequencing across all 60 tasks (Tasks 0, 3, 4, 7... candidate first; Tasks 1, 2, 5, 6... baseline first), neutralizing warm-cache effects. | **RESOLVED** |
| **8** | **Fair Lotus Memory Experiment** | Stripped reference files from Condition C, creating an unfair experimental confound. | Equalized context across Conditions A, B, and C: all three conditions receive identical task prompt structure and reference files. Condition B receives verified experiences; Condition C receives historical noise. | **RESOLVED** |
| **9** | **Paired Differences Disclosure** | Aggregate 50/60 pass rates concealed individual task divergences. | Per-task paired comparison explicitly discloses and analyzes candidate win on `GND-02` and candidate regression on `DIR-02`. | **RESOLVED** |
| **10** | **Windows GUI Qualification** | T3R2 and T4 exercised only HTTP commands without qualifying graphical UI. | Qualified all 14 graphical areas via `scripts/ma4-s3-t4r1/gui-qualification.mjs` against Island UI models in isolated temporary storage without mutating user data. Unattended physical display automation marked `BLOCKED`. | **RESOLVED** |

---

## 3. Detailed Technical Remediation

### 3.1 Elimination of Synthetic Receipts (Defect #4)
In MA4-S3-T4, `createOutcomeRecord()` was invoked with:
```typescript
// PREDECESSOR FLAW:
const receipts = passed ? [`rcpt-${task.id}`] : [];
```
In MA4-S3-T4R1, `createOutcomeRecord()` receives only `genuineTestReceipts` originating from executed `local.test` processes:
```typescript
// T4R1 HONEST IMPLEMENTATION:
testProcessReceipts: genuineTestReceipts, // Strictly from real process test executions
```
If an answer is validated by an independent text oracle (e.g. regex or string inclusion) without running a process test, `testProcessReceipts` is empty `[]`, and the outcome is classified as `oracle-verified`, not a process execution proof.

### 3.2 Tool Execution Verification (Defect #2)
In MA4-S3-T4, tool call counts were computed as:
```typescript
// PREDECESSOR FLAW:
toolCallCount = task.referenceFiles ? Object.keys(task.referenceFiles).length : 0;
```
In MA4-S3-T4R1:
```typescript
// T4R1 HONEST IMPLEMENTATION:
let toolCallCount = 0;
// In registered executor:
async run(stepInput, ctx) {
  toolCallCount++; // Observed only upon actual execution
  // ...
}
```

### 3.3 Hardware Telemetry Live Acquisition (Defect #6)
In MA4-S3-T4, `vramPeakBytes` was hardcoded to `4.1 * 1024 * 1024 * 1024`.
In MA4-S3-T4R1, `sampleGpuTelemetry()` executes:
```typescript
// T4R1 HONEST IMPLEMENTATION:
const s = execSync("nvidia-smi --query-gpu=name,memory.total,memory.free,memory.used,utilization.gpu --format=csv,noheader,nounits");
// Samples actual dedicated VRAM used, free, and GPU load per task run
```
