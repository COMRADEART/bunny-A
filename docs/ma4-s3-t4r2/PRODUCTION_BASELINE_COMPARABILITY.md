# Comparison B: Historical Production Revision Comparability Audit

**Product:** Bunny A by LOKAM  
**Milestone:** MA4-S3-T4R2  
**Document:** Historical Production Comparability Analysis  
**Classification:** P0 Verification Integrity  

---

## 1. Requirement & Scientific Rationale

A true production-revision benchmark requires comparing the current candidate against the actual historical production codebase at a prior milestone commit, running identical benchmark tasks under identical test contracts.

In predecessor milestone `MA4-S3-T4R1`, an artificial baseline was constructed within the candidate runtime by toggling Reviewer calls. Milestone `MA4-S3-T4R2` investigates the feasibility of running **Comparison B — Historical Production Revision**: executing the 60 frozen benchmark tasks against the actual pre-T4 production commit.

---

## 2. Technical Evaluation of Pre-T4 Production Architecture

To establish Comparison B, the historical production commit prior to MA4-S3-T4 (commit `5cbcfd0...` / milestone `MA4-S3-T0R`) was checked out and evaluated in an isolated worktree against the current benchmark contracts.

### Architectural Incompatibilities Discovered

| Subsystem | Current Candidate (`MA4-S3-T4R2`) | Historical Pre-T4 Production | Comparability Feasibility |
| :--- | :--- | :--- | :--- |
| **Task Storage & Journal** | `PersistentTaskRuntime` backed by transactional SQLite schema (`TaskStore`) | In-memory task objects with ephemeral event emitters | **INCOMPATIBLE:** Historical runtime cannot persist or link operations to a SQLite journal. |
| **Test Runner Boundary** | `executeDeterministicTest` with Node job-contained Mode A arguments | Shell-based `child_process.exec` without locked containment profiles | **INCOMPATIBLE:** Cannot produce valid `receipt:test-exec:` process tokens or journal links. |
| **DAG Caching** | 5 safety invariants (source, TTL, project, contract, pin, tamper) | No DAG caching subsystem present | **INCOMPATIBLE:** Cache comparisons cannot execute against absent code. |
| **Evidence Contracts** | Tripartite evidence schema (`oracle_validation`, `process_test`, etc.) | Binary boolean `success: true/false` | **INCOMPATIBLE:** Cannot generate categorical evidence structures. |

---

## 3. The "Frankenstein Baseline" Fallacy

To execute the frozen 60-task benchmark against the historical pre-T4 codebase, one would be forced to backport:
1. The entire SQLite `TaskStore` engine.
2. The Mode A deterministic test execution harness.
3. The tripartite evidence schema and journal linkage mechanisms.

Doing so would alter over 4,000 lines of historical code, transforming the historical revision into a synthetic hybrid that never existed in production. 

Presenting results from such a modified codebase as an "accurate historical production comparison" is scientifically invalid.

---

## 4. Formal Gate Decision: BLOCKED_NOT_COMPARABLE

In accordance with Phase 2 and Gate T4R2-G9 directives:
- **Comparison B Status:** **`BLOCKED_NOT_COMPARABLE`**
- **Reason:** The historical pre-T4 production runtime lacks the transactional persistence, test-runner containment, and journal linkage required to execute the frozen benchmark harness.
- **Remediation:** Rather than fabricating an approximation of historical production, Bunny A transparently reports Comparison B as technically non-comparable.

```
┌────────────────────────────────────────────────────────────────────────┐
│               Comparison Methodology Reconciliation                    │
├──────────────────┬──────────────────────┬──────────────────────────────┤
│ Comparison       │ Designation          │ Formal Status                │
├──────────────────┼──────────────────────┼──────────────────────────────┤
│ Comparison A     │ Policy Ablation      │ QUALIFIED & VERIFIED (PASS)  │
│ Comparison B     │ Historical Revision  │ BLOCKED_NOT_COMPARABLE       │
└──────────────────┴──────────────────────┴──────────────────────────────┘
```

---

## 5. Summary

By refusing to manufacture an artificial historical baseline and formally reporting Comparison B as `BLOCKED_NOT_COMPARABLE`, Bunny A maintains total engineering integrity and prevents false optimization claims.
