# Historical Evidence Reconciliation: T4 and T4R1 Claims Audit

**Product:** Bunny A by LOKAM  
**Milestone:** MA4-S3-T4R2  
**Document:** Historical Benchmark Reconciliation & Retractions  
**Classification:** P0 Verification Integrity  

---

## 1. Purpose & Guiding Ethos

Scientific integrity demands that errors in prior reporting be explicitly acknowledged, reconciled, and corrected—never concealed or quietly overwritten.

This document systematically reconciles claims made in milestones `MA4-S3-T4` and `MA4-S3-T4R1` against the verified reality established in `MA4-S3-T4R2`. Historical report files in `docs/ma4-s3-t4r1/` remain untouched as historical records, while this document provides the canonical, corrected accounting.

---

## 2. Comprehensive Reconciliation Matrix

| Area | Historical Claim (T4 / T4R1) | Newly Verified Fact (T4R2) | Corrective Action & Status |
| :--- | :--- | :--- | :--- |
| **Deterministic Test Receipts** | "All 60 tasks produced verified deterministic process test receipts (`rcpt-*`)." | In-process `local.test` generated SHA-256 hashes without launching test processes. Only 12 tasks executed `executeDeterministicTest`. | **RECLASSIFIED:** 48 tasks categorized as `oracle_validation` (0 process receipts); 12 tasks categorized as `process_test` (real OS processes, journal linkage, exit code 0). |
| **Baseline Model Efficiency** | "Candidate architecture achieves 32.6% reduction in model calls (89 vs 60) against production baseline." | Baseline runtime deliberately injected discretionary Reviewer calls on C2/C3 tasks. Candidate omitted them. Not a historical production comparison. | **RECLASSIFIED:** Labeled **Comparison A (Policy Ablation)** measuring marginal effect of discretionary review. Historical production comparison is **BLOCKED_NOT_COMPARABLE** (Comparison B). |
| **Model Digest Observation** | "Model identity verified against Ollama returning digest `BENCHMARK_MODEL_DIGEST`." | `getOllamaModelDigest()` silently returned a hardcoded constant when Ollama was unreachable or failed. | **RETRACTED & REPLACED:** Lookup now fails closed against `/api/tags`. Physical workstation model is `qwen2.5-coder:7b` (digest `dae161...`). Remote cloud models are rejected. |
| **Hardware GPU Telemetry** | "Continuous telemetry confirms 6,141 MiB total VRAM and 1,024 MiB peak load on RTX 4050." | `sampleGpuTelemetry()` substituted fallback constants when `nvidia-smi` failed. Pre/post snapshots cannot prove intra-task continuous peak. | **RETRACTED & REPLACED:** Fails closed with `available: false` and `null` values when unobserved. Telemetry contract explicitly declares `samplingMode: "pre_post_snapshots"` and `continuousPeakVramUsedBytes: null`. |
| **Windows GUI Acceptance** | "Windows GUI Acceptance: PASS across all 14 interaction areas." | The qualification script exercised headless React/Zustand state machines, not the rendered Windows desktop or DWM. | **RECLASSIFIED:** `gui-contract-qualification.mjs` verifies **GUI Model Contract: PASS**. Physical Windows desktop graphical interaction is **BLOCKED** pending unattended session (Gate: `T5-PREFLIGHT`). |
| **Public Beta Release** | "Public Beta Readiness: Conditional / Ready for packaging." | Unattended physical GUI automation, EV signing, and voice pipeline qualifications were incomplete. | **AFFIRMED NO-GO:** Public beta release remains strictly **NO-GO** until downstream milestones complete physical qualification gates. |

---

## 3. Detailed Reconciliation Notes

### 3.1 Clarification on Process Passes vs. Oracle Passes
A task passing an independent oracle verification is an entirely legitimate form of software evaluation. The defect was not that oracle validation failed, but that the harness claimed an operating system test process had executed when it had not. Categorizing 48 tasks as `oracle_validation` and 12 tasks as `process_test` accurately reflects what actually ran on the operating system.

### 3.2 Clarification on Reviewer Scheduling
Omitting a reviewer step that merely inspects code style is an effective engineering optimization. However, claiming that skipping an artificially injected reviewer represents an architectural speedup over an existing production release misrepresents production history. Labeled as a policy ablation (Comparison A), the 32.6% call reduction is scientifically accurate and reproducible.

### 3.3 Clarification on Desktop Interaction
The headless state model tests (`IslandContainer`, `TaskRow`, `ApprovalModal`, accessibility attributes) confirm that Bunny A's user interface logic is structurally sound. Mislabelling this as physical desktop interaction was the sole defect. Separating the model contract (PASS) from physical display interaction (BLOCKED) maintains complete truthfulness.

---

## 4. Final Disposition

With these corrections, all past ambiguities and measurement flaws from T4 and T4R1 are resolved. The engineering metrics for Bunny A now adhere to the highest standard of scientific integrity.
