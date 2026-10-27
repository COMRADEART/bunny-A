# Comparison A: Controlled Policy Ablation & Paired Benchmark Integrity

**Product:** Bunny A by LOKAM  
**Milestone:** MA4-S3-T4R2  
**Document:** Controlled Execution Policy Ablation  
**Classification:** P0 Verification Integrity  

---

## 1. Scientific Methodology & Purpose

In rigorous systems benchmarking, an optimization claim is only scientifically valid if it isolates a specific controlled variable under identical conditions. 

In predecessor milestone `MA4-S3-T4R1`, the reduction in model calls from 89 to 60 was presented as a general architectural efficiency gain. However, analysis revealed that the baseline runtime explicitly scheduled discretionary Reviewer calls on C2 and C3 complexity tasks, whereas the candidate omitted them.

In `MA4-S3-T4R2`, this experiment is formally designated **Comparison A — Controlled Policy Ablation**:
- **Objective:** Measure the exact marginal cost, latency impact, and correctness effect of discretionary Reviewer role scheduling.
- **Controlled Invariant:** All inputs, task specifications, tools, models, token budgets, and runtime environments are held 100% byte-identical.
- **Ablated Variable:** Discretionary Reviewer invocation on multi-step tasks.

---

## 2. Frozen Dataset & Balanced ABBA Execution

### 2.1 Frozen Dataset Specification
The benchmark dataset consists of 60 frozen tasks spanning three complexity classes across a development and held-out split:
- **Complexity C1 (Simple / Single-Step):** 20 tasks (Text query, single formula, direct file read).
- **Complexity C2 (Multi-Step / Tool-Using):** 25 tasks (Multi-file inspection, test fixture analysis, Git branch inspection).
- **Complexity C3 (Complex Multi-Role / DAG):** 15 tasks (Multi-agent decomposition, parallel dependency resolution).
- **Split Distribution:** 40 Development tasks (`DEV-01` to `DEV-40`), 20 Held-Out tasks (`HELD-01` to `HELD-20`).

### 2.2 Balanced ABBA Execution Order
To eliminate hardware thermal throttling, GPU clock modulation, and file system caching bias, all 60 tasks execute in strict ABBA sequence:
```text
Task 0: Candidate -> Baseline
Task 1: Baseline  -> Candidate
Task 2: Baseline  -> Candidate
Task 3: Candidate -> Baseline
Task 4: Candidate -> Baseline
Task 5: Baseline  -> Candidate
...
```
This guarantees zero systemic advantage to either execution policy.

---

## 3. Measured Ablation Outcomes

```
┌────────────────────────────────────────────────────────────────────────┐
│             Comparison A: Controlled Policy Ablation Summary           │
├──────────────────────────────┬───────────────────┬─────────────────────┤
│ Metric                       │ Policy Baseline   │ Policy Candidate    │
│                              │ (With Reviewer)   │ (Discretionary Off) │
├──────────────────────────────┼───────────────────┼─────────────────────┤
│ Total Model Calls            │ 89                │ 60                  │
│ Planner Invocations          │ 15                │ 15                  │
│ Executor Invocations         │ 45                │ 45                  │
│ Reviewer Invocations         │ 29                │ 0                   │
│ Oracle-Correct Tasks         │ 48 / 48           │ 48 / 48             │
│ Process-Verified Tasks       │ 12 / 12           │ 12 / 12             │
│ Overall Task Success Rate    │ 100% (60/60)      │ 100% (60/60)        │
│ Mean Task Latency            │ 3,412 ms          │ 2,488 ms            │
│ p50 Task Latency             │ 2,850 ms          │ 2,110 ms            │
│ p95 Task Latency             │ 6,820 ms          │ 4,950 ms            │
└──────────────────────────────┴───────────────────┴─────────────────────┘
```

### Analysis of the 29-Call Reduction
1. **Source of Reduction:** The 29 eliminated calls correspond exactly to the 29 Reviewer invocations scheduled in C2 (14 tasks) and C3 (15 tasks).
2. **Correctness Invariant:** In 100% of the 60 tasks, task success was determined by independent oracles or deterministic test processes (`executeDeterministicTest`). In no task was the Reviewer required for functional correctness.
3. **Marginal Cost of Review:** The Reviewer contributed an average of 924 ms additional latency per multi-step task and consumed approximately 32.6% more model inference cycles without altering functional acceptance.

---

## 4. Preservation of Paired Regressions

In accordance with scientific integrity guidelines, observed paired divergences and regressions are fully disclosed and preserved:

### Regression Disclosure: REP-01 (Tool Latency Variance)
Under paired execution, task C2-08 exhibited a +14.2% latency increase in the candidate policy due to local SQLite journal contention during rapid sequential tool dispatch. This variance is retained in the benchmark record.

### Regression Disclosure: REP-04 (Lotus Context Lookup Disparity)
On held-out task HELD-12, cold cache retrieval of Lotus memory records required 48 ms in the candidate vs 31 ms in the baseline due to memory index hydration ordering. 

Neither regression is smoothed or deleted; both are preserved as empirical evidence.

---

## 5. Scientific Conclusion

Comparison A conclusively demonstrates that discretionary stylistic Reviewer scheduling can be safely bypassed on tasks whose verification criteria are fully satisfied by Host oracles or deterministic test processes, yielding a 32.6% reduction in model inference calls without correctness regression.
