# Post-T4R1 Verification Defects & Remediation Analysis

**Product:** Bunny A by LOKAM  
**Milestone:** MA4-S3-T4R2  
**Document:** Analysis of Identified Measurement & Qualification Defects  
**Classification:** P0 Corrective Architecture Audit  

---

## Executive Summary

Following the integration of milestone `MA4-S3-T4R1` (PR #49), four critical verification and measurement defects were identified during post-merge audit. While T4R1 successfully replaced in-memory mocks with the Host SQLite runtime and frozen task execution, subtle measurement illusions persisted in the benchmark harness and reporting claims.

Milestone `MA4-S3-T4R2` addresses and completely resolves all four defects with zero architectural regressions and complete scientific honesty.

---

## Defect 1: Synthetic Process-Execution Receipts

### 1.1 Defect Description
In `src/lib/bunny-host/ma4/live-benchmark.server.ts`, the benchmark-specific `local.test` tool executor did not launch a genuine test runner process. Instead, it evaluated the model's textual output against an in-process regex or test function and computed a SHA-256 hash formatted as:
```text
sha256(test-execution-receipt:<runId>:<taskId>:<timestamp>)
```
This hash resembled a legitimate deterministic test process receipt. The task outcome measurement subsequently treated this hash as evidence of a successful deterministic test run.

### 1.2 Root Cause Analysis
- **Location:** `src/lib/bunny-host/ma4/live-benchmark.server.ts` (`localTestExecutor`)
- **Mechanism:** The harness conflated independent text oracle validation with operating system process execution. Because the task specification requested testing, the harness simulated test execution rather than invoking the authorized `executeDeterministicTest` runner.

### 1.3 Measurement & Safety Impact
- Text-only tasks (e.g. answering a question or suggesting a regex fix) were falsely credited with "process-verified deterministic test passes."
- Appearance of a 64-character hexadecimal receipt string gave a false sense of cryptographic provenance without any physical process execution occurring.

### 1.4 Corrective Action in T4R2
1. **Separated Evidence Categories:** In `src/lib/bunny-host/ma4/outcome-measurement.ts`, formal evidence categories were introduced:
   - `oracle_validation`: Text, pattern, or mathematical validation by an oracle. Zero process receipts permitted.
   - `tool_execution`: Execution of an authorized Host tool with journal linkage.
   - `process_test`: Deterministic test execution by an approved process runner.
2. **Removed Hash Manufacturing:** `localTestExecutor` now returns `{ ok, output: "ORACLE_VALIDATED" }` without manufacturing any receipt strings.
3. **Fail-Closed Verification Contract:** `isVerifiedSuccess()` strictly validates that `process_test` requires `receipt:test-exec:` receipts, verified exit code 0, and journal correlation. If an oracle validation carries a process receipt, it is immediately rejected as invalid.

---

## Defect 2: Conflated Baseline Comparison Methodology

### 2.1 Defect Description
In T4R1, the benchmark comparison reported a reduction in model calls from 89 (baseline) to 60 (candidate) — an apparent 32.6% efficiency improvement. However, the baseline runtime explicitly and intentionally injected Reviewer role invocations for C2 and C3 complexity tasks, whereas the candidate omitted them. This comparison did not isolate production improvements from discretionary design choices.

### 2.2 Root Cause Analysis
- **Location:** `src/lib/bunny-host/ma4/live-benchmark.server.ts` (`runPairedBenchmarkMatrix`)
- **Mechanism:** The comparison conflated an artificial reviewer ablation experiment with an architectural production-revision benchmark. The baseline was not a historical production commit, but a synthetic ablation baseline.

### 2.3 Scientific Impact
- Claims that candidate optimizations reduced model calls by 32.6% were misleading, as the omitted calls were stylistic reviewer passes deliberately injected into the baseline harness.
- Omitting a reviewer does not constitute equivalent work unless the reviewer had zero verification responsibility.

### 2.4 Corrective Action in T4R2
1. **Explicit Comparison A (Controlled Policy Ablation):** The comparison is now strictly labeled `comparisonA_policyAblation`. The documentation explicitly discloses that model call reductions reflect the marginal effect of omitting discretionary stylistic reviewer calls on C2/C3 tasks under identical inputs and task datasets.
2. **Explicit Comparison B (Historical Production Revision):** Re-evaluated against actual pre-T4 production commits. Because the pre-T4 architecture lacked the SQLite task store, job-contained test runner, and DAG cache invariants, it cannot execute the frozen 60-task benchmark without major invasive modifications. Comparison B is truthfully reported as `BLOCKED_NOT_COMPARABLE`.

---

## Defect 3: Silent Fallbacks in Model Digest & GPU Telemetry

### 3.1 Defect Description
1. **Model Digest Fallback:** In `live-benchmark.server.ts`, `getOllamaModelDigest()` returned `BENCHMARK_MODEL_DIGEST` (`"sha256:d5b8e9..."`) whenever Ollama was offline or failed to respond.
2. **GPU Telemetry Fallback:** In `sampleGpuTelemetry()`, when `nvidia-smi` failed or returned unparseable output, the function substituted static values for an NVIDIA GeForce RTX 4050 Laptop GPU (6,141 MiB total VRAM, 1,024 MiB used VRAM).

### 3.2 Root Cause Analysis
- Defensive programming defaults were used where strict fail-closed observation was mandatory.
- Fallbacks concealed environmental failures, allowing runs without Ollama or NVIDIA GPUs to report plausible but completely unobserved metrics.

### 3.3 Safety & Integrity Impact
- Model identity could not be guaranteed; a test could report passing with an unverified model.
- Resource scheduling could dangerously attempt dual-7B parallel execution on systems without sufficient physical VRAM if telemetry was assumed available.

### 3.4 Corrective Action in T4R2
1. **Fail-Closed Model Identity:** `lookupOllamaModelDigest()` queries `http://127.0.0.1:11434/api/tags` directly. If Ollama is unreachable, the model is unlisted, the digest is malformed, or the model is an unapproved remote cloud host (e.g., `deepseek-v4.1-flash:cloud`), it returns `verified: false` and `digest: null`. Test fixtures must explicitly declare `isSimulated: true`.
2. **Truthful Telemetry Absence:** When `nvidia-smi` is unavailable, `sampleGpuTelemetry()` returns `available: false`, with `totalVramBytes: null`, `usedVramBytes: null`, `freeVramBytes: null`, and `gpuUtilizationPercent: null`.
3. **Snapshot vs Continuous Peak:** Because metrics are sampled at task boundaries rather than continuously, the metric is truthfully designated `samplingMode: "pre_post_snapshots"` and `continuousPeakVramUsedBytes: null`.

---

## Defect 4: Premature Windows GUI Acceptance PASS

### 4.1 Defect Description
`scripts/ma4-s3-t4r1/gui-qualification.mjs` was reported as `PASS` for "Windows GUI Acceptance" in T4R1. In reality, the script evaluated in-memory React/Zustand state machines and mock task rows. It did not interact with the rendered Windows desktop, the Windows Desktop Window Manager (DWM), or physical display surfaces.

### 4.2 Root Cause Analysis
- Unit and integration tests for GUI state models were mislabeled as full physical GUI acceptance.
- The distinction between a UI model contract and an operating system graphical interaction session was blurred.

### 4.3 Integrity Impact
- Users and auditors were given the impression that end-to-end desktop automation (clicks, window positioning, system tray integration, screen-reader interactions) had been verified on a physical Windows display.

### 4.4 Corrective Action in T4R2
1. **Scope Separation:** The test suite is renamed and scoped strictly as `gui-contract-qualification.mjs`, verifying the **GUI Model Contract** (14 model areas: model selection, accessibility attributes, island notch states, approval rows, cancellation dispatch).
2. **Truthful BLOCKED Status:** Actual Windows GUI interaction is formally marked:
   ```text
   Status: BLOCKED
   Reason: Physical graphical display interaction requires an unattended interactive desktop session with DWM and input automation.
   Gate: T5-PREFLIGHT
   ```
3. **Zero Fabrication:** No simulated screenshots, false click traces, or fabricated accessibility tree dumps were created.

---

## 5. Verification Matrix Summary

| Defect # | Component | Pre-T4R2 Status | T4R2 Remediation | Verification Gate |
| :---: | :--- | :--- | :--- | :---: |
| **DEF-01** | `local.test` receipts | Synthetic SHA-256 strings | Split into `oracle_validation` (0 receipts) and `process_test` | **T4R2-G2, T4R2-G3** |
| **DEF-02** | Baseline comparison | Conflated reviewer ablation | Labeled Policy Ablation (Comp A); Historical marked BLOCKED (Comp B) | **T4R2-G8, T4R2-G9** |
| **DEF-03A** | Model digest lookup | Fallback default digest | Fail-closed against `/api/tags`; remote cloud models rejected | **T4R2-G5** |
| **DEF-03B** | GPU telemetry sampling | Fallback RTX 4050 6,141 MiB | Fail-closed nulls on unavailable; snapshot mode disclosed | **T4R2-G6, T4R2-G7** |
| **DEF-04** | Windows GUI qualification | Mislabeled PASS | Model contract PASS; Physical GUI interaction marked BLOCKED | **T4R2-G11, T4R2-G12** |
