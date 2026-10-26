# MA4-S3-T4 Live Model Quality Evaluation

**Product:** Bunny A by LOKAM  
**Milestone:** MA4-S3-T4  
**Benchmark Suite:** `src/lib/bunny-host/ma4/live-benchmark.server.ts`  
**Execution Script:** `scripts/run-live-benchmark.mjs`  
**Target Model:** `qwen2.5-coder:7b` (local Ollama v0.40.11, CUDA GPU)  
**Report Output:** `test-results/ma4-s3-t4/benchmark-report.json`  
**Total Benchmark Runtime:** 1,083.3 seconds (~18.05 minutes)  

---

## 1. Evaluation Methodology

The live model quality evaluation assesses agent intelligence, efficiency, and reliability on native local hardware.

### 1.1 Ground Truth Assertions
All 60 tasks in the frozen benchmark dataset are evaluated strictly against **deterministic Host assertions**:
- **No LLM Evaluators:** LLMs are never used to grade model responses.
- **Structural Integrity:** Assertions verify JSON validity, regex matches, exact substrings, or code syntax guards.
- **Fail-Closed Binary Verdict:** A task passes only if Host assertions return `true` with zero unhandled exceptions.

### 1.2 Dataset Split Balance
- Total Tasks: **60**
- Development Tasks: **30** (50%)
- Held-Out Tasks: **30** (50%)
- The held-out split was isolated during development to measure out-of-distribution generalization and guard against prompt overfitting.

---

## 2. Summary of Verified Results

| Metric | Baseline System | Candidate System (MA4-S3-T4) | Delta / Improvement |
| :--- | :--- | :--- | :--- |
| **Total Tasks Evaluated** | 60 | 60 | Balanced 30 Dev / 30 Held-Out |
| **Verified Tasks Passed** | 50 / 60 | 50 / 60 | 0 regressions (**83.33% Pass Rate**) |
| **Total Model Calls** | 90 calls | 60 calls | **30 fewer model calls** (-33.3%) |
| **Model Calls per Success** | 1.80 calls/success | 1.20 calls/success | **33.3% efficiency gain** |
| **Total Tool Calls** | 77 calls | 46 calls | **31 fewer tool calls** (-40.3%) |
| **Average Wall-Clock Duration**| 10,089.7 ms | 3,377.6 ms | **6,712.1 ms faster** (**-66.5% latency**) |
| **Artifacts Reused** | 0 | 15 | **15 cache hits** from verified outcomes |
| **Redundant Steps Pruned** | 0 | 15 | **15 duplicate steps eliminated** |

---

## 3. Generalization Analysis (Dev vs Held-Out)

The candidate system achieved identical high accuracy across both splits:
- **Development Tasks (30 tasks):** 25 passed / 30 (**83.33%**)
- **Held-Out Tasks (30 tasks):** 25 passed / 30 (**83.33%**)
- **Generalization Gap:** **0.00%**

This proves that the adaptive C0-C3 planning rules and prompt grounding generalize without overfitting to the development set.

---

## 4. Category Breakdown

| Category | Class | Total Tasks | Passed Tasks | Pass Rate | Invocations Saved |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Direct Assistant** | C0 | 15 | 13 | 86.67% | Avoided Planner/Tester/Reviewer |
| **Single-Resource Grounded** | C1 | 15 | 14 | 93.33% | Direct single-tool extraction |
| **Multi-Step Compositional** | C2 | 15 | 12 | 80.00% | 15 redundant steps eliminated |
| **Repair & Verification** | C3 | 15 | 11 | 73.33% | Safe single-turn bounded repair |
| **Total** | | **60** | **50** | **83.33%** | **30 model calls saved** |
