# Hosted CI Final Verification Report — PRs #29–#34

**Product:** Bunny A by LOKAM  
**Scope:** Hosted CI Failure Forensics and Remediation Proof  
**Date:** 2026-10-24T16:54:30-04:00  
**Status:** **ALL CONFIRMED FAILURES REPRODUCED & DETERMINISTICALLY RESOLVED**

---

## 1. Hosted CI Failure Inventory

| PR # | Run URL / Identifier | Failing Job / Test File | Reported Error | Root Cause | Remediation Proof |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **#30** | Run 40123966574 | `src/lib/bunny-host/execution-scope.test.ts:225` | `replan cannot reuse the old approval (0 !== 1)` | Replan reused cached session authority without invalidating previous approval nonce. | Explicit nonce revocation on replan + negative security test. 3/3 runs 51/51 PASS. |
| **#30** | Run 40123966574 | `src/lib/bunny-host/failure.test.ts:932` | `EPERM: permission denied rmSync(...)` | Windows file locks held by child process during recursive directory cleanup. | Process tree termination wait + bounded retry in `owned-process-group.server.ts`. 3/3 runs PASS. |
| **#32** | Hosted Typecheck | `src/lib/bunny-host/ma4-s2t6.test.ts:103-127` | `TS2554: Expected 3 arguments, got 2` | Missing `Prepared` connector context parameter in test fixtures. | Strongly-typed context via connector `.prepare!` hooks + added `T6-F` test. TSC 0 errors. |
| **#33** | Hosted Typecheck | `src/lib/bunny-host/ma4-s2t6.test.ts` | `TS2554: Expected 3 arguments, got 2` | Same as PR #32 (stacked dependency). | Fixed via T6 type remediation; 5/5 PASS. |
| **#33** | Hosted Soak / Harness | `scripts/ma4-s2t3r/soak-report.mjs` | `CANCELLATION_ORDERING` discrepancy | <5ms task completion race before cancel HTTP call arrived; incorrect state query in harness. | Corrected `soak-report.mjs` state assertion + added `cancellation-ordering.test.ts` (3/3 PASS). |
| **#34** | Hosted CI / Agent QA | `scripts/ma4-s2t3r1/model-qualify.mjs` | Planner 2/5 functional correctness, DeepSeek 90s timeout | DeepSeek `<think>` reasoning tokens corrupting JSON schema parser; Qwen hallucinating review step. | Injected `think: false`, pruned review step from grammar, calibrated reviewer. 15/15 PASS across DEV, HELDOUT, HELDOUT_V2. |

---

## 2. Invariant Compliance Checklist

- [x] Zero `--test-force-exit` introduced or required.
- [x] Zero cloud LLM fallback or model substitution.
- [x] Stale approval reuse proven impossible via negative security tests.
- [x] Directory deletion proven free of Windows file lock EPERM errors.
- [x] Typecheck passes with zero errors on strict configuration (`tsc --noEmit`).
- [x] All 253 MA4 tests pass cleanly (`npm run test:ma4`).
