# MA4-S3-T4R2 Baseline & Provenance Audit

**Product:** Bunny A by LOKAM  
**Repository:** https://github.com/COMRADEART/bunny-A  
**Milestone:** MA4-S3-T4R2  
**Priority:** P0 — Verification Integrity Closure  
**Branch:** `ma4-s3-t4r2-measurement-integrity-closure`  
**Predecessor PR:** PR #49  
**Verified Predecessor Merge SHA:** `4d54b9e40af77bd2cdbeb18222ee0f632f6d19e6`  
**Audit Date:** October 26, 2026  

---

## 1. Lineage & Source Provenance

Milestone `MA4-S3-T4R2` branches directly from the verified merge head of Pull Request #49 (`4d54b9e40af77bd2cdbeb18222ee0f632f6d19e6`), which merged `MA4-S3-T4R1` into `bunny-a/main`.

### Upstream Verification Summary

```text
Commit: 4d54b9e40af77bd2cdbeb18222ee0f632f6d19e6
Author: COMRADEART <artcomrade@gmail.com>
Date:   Mon Oct 26 19:42:01 2026 -0400
Message: Merge pull request #49 from COMRADEART/ma4-s3-t4r1-real-benchmark-integrity
```

The repository worktree was initialized in an isolated directory:
- **Worktree Location:** `C:\Users\allam\Documents\new\bun-router-s3t4r2`
- **Active Branch:** `ma4-s3-t4r2-measurement-integrity-closure`
- **Upstream Remote:** `https://github.com/COMRADEART/bunny-A.git`

---

## 2. Historical Evidence Preservation Policy

All reports, datasets, telemetry snapshots, and qualification matrices generated during predecessor milestone `MA4-S3-T4R1` located in `docs/ma4-s3-t4r1/` are strictly **preserved as immutable historical evidence**. 

Under no circumstances are historical documentation files altered or retroactively edited to conceal past reporting anomalies. Instead, milestone `MA4-S3-T4R2` provides transparent reconciliation, formal reclassifications, and explicit corrections within its own dedicated documentation directory `docs/ma4-s3-t4r2/`.

Preserved predecessor records:
- `docs/ma4-s3-t4r1/BASELINE.md`
- `docs/ma4-s3-t4r1/MEASUREMENT_INTEGRITY_AUDIT.md`
- `docs/ma4-s3-t4r1/RECEIPT_AND_PROVENANCE_VALIDATION.md`
- `docs/ma4-s3-t4r1/PERFORMANCE_COMPARISON.md`
- `docs/ma4-s3-t4r1/REAL_RESOURCE_TELEMETRY.md`
- `docs/ma4-s3-t4r1/WINDOWS_GUI_ACCEPTANCE.md`
- `docs/ma4-s3-t4r1/FINAL_ACCEPTANCE_MATRIX.md`
- `docs/ma4-s3-t4r1/ENGINEERING_REPORT.md`

---

## 3. Mission Scope & Boundary Invariants

Milestone `MA4-S3-T4R2` is a targeted P0 correction milestone dedicated to resolving four specific measurement and qualification issues identified post-merge. 

### Scope Boundaries (Strictly Enforced)
- **Zero Architecture Rebuild:** The Coordinator, adaptive planner, Lotus memory, resource scheduler, Host runtime, and desktop interface are preserved without architectural refactoring.
- **Zero Number Inflation:** The mission is to correct measurement claims and implement fail-closed honesty, not to engineer artificially superior benchmark figures.
- **Zero Fabrication:** Synthetic receipts, default hardware telemetry fallbacks, predefined model digests, and simulated desktop interaction PASS states are entirely eliminated.
- **Zero User State Tampering:** No mutation of `%LOCALAPPDATA%\Bunny-A` or Windows user profile configuration.
- **Beta Gate Discipline:** Public beta remains strictly **NO-GO** until physical Windows desktop qualification and EV signing are completed in downstream milestones.

---

## 4. Initial File Verification Status

The core measurement files inspected at baseline entry:

| Source File | Baseline Inspection Finding | Required Correction in T4R2 |
| :--- | :--- | :--- |
| `src/lib/bunny-host/ma4/live-benchmark.server.ts` | Contained synthetic receipt generation in `local.test`; returned fallback RTX 4050 6,141 MiB telemetry when `nvidia-smi` failed; returned `BENCHMARK_MODEL_DIGEST` when Ollama was unreachable. | Remove synthetic receipts; fail closed on model queries; return explicit `available: false` and nulls on telemetry failure. |
| `src/lib/bunny-host/ma4/outcome-measurement.ts` | Did not distinguish oracle validation from process test execution in evidence schemas. | Introduce `evidenceCategory` (`oracle_validation`, `tool_execution`, `process_test`); enforce strict receipt provenance in `isVerifiedSuccess()`. |
| `src/lib/bunny-host/ma4/task-runtime.server.ts` | Permitted any receipt format to count as test verification. | Restrict test verification strictly to `receipt:test-exec:` process receipts from authorized test runner. |
| `src/lib/bunny-host/ma4/benchmark-integrity.test.ts` | Lacked negative tests for receipt provenance and live model fail-closed behavior. | Expand with 18 comprehensive integrity tests including 12 negative process-receipt provenance tests. |
| `scripts/ma4-s3-t4r1/gui-qualification.mjs` | Marked GUI verification as PASS despite physical Windows desktop interaction being blocked. | Reclassified as `gui-contract-qualification.mjs`; model contract PASS, physical desktop interaction explicitly BLOCKED. |

---

## 5. Predecessor Gate Conclusion

The baseline merge PR #49 has been verified as cleanly integrated, and the worktree is isolated and prepared for the final verification integrity closure.
