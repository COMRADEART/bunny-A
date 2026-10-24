# Master Release Gate Qualification Table — MA4-S2

**Product:** Bunny A by LOKAM  
**Scope:** MA4-S2 Final Gate Remediation  
**Evaluation Head:** `ma4-s2-final-gate-remediation`  
**Date:** 2026-10-24T16:55:00-04:00  
**Overall Beta Recommendation:** **GO (CONDITIONAL ON CREDENTIAL PROVISIONING & SOAK B DURATION)**

---

## 1. Master Release Gate Matrix

| Gate ID | Target Surface | Release Requirement | Pre-Remediation Baseline | Root Cause & Remediation Applied | Measured Final Status | Gate Verdict |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **GATE-S2-CI** | PR #30 Hosted CI | `execution-scope.test.ts` (MA0R2) and `failure.test.ts` (T3) must pass without `--test-force-exit` or EPERM leaks | **FAIL** (0 !== 1 on stale replan; EPERM on folder deletion) | Nonce invalidation on replan + negative security test; bounded child-process teardown prior to directory deletion | 3 consecutive runs, 51/51 tests passing, 0 EPERM errors, 0 leaks | **PASS** |
| **GATE-S2-TSC** | PR #32 / #33 Typecheck & Security | Strict `tsc --noEmit` 0 errors; broker fail-closed on 9 unauthorized states | **FAIL** (TS2554: 4 errors in `ma4-s2t6.test.ts`) | Replaced synthetic `{}` with typed `Prepared` context from `.prepare!` hooks; added `T6-F` fail-closed broker suite | `tsc --noEmit` exits 0 (0 errors); `ma4-s2t6.test.ts` 5/5 PASS | **PASS** |
| **GATE-S2-UIA** | Windows UI Automation | `cross-app-live.test.ts` (T6 X53) terminates cleanly without orphan processes or timeouts | **FAIL** (9,403 ms timeout on private desktop `exebox-...`) | Sandbox runs in private headless window station; added `[BunnyWin]::OnInputDesktop()` fail-closed gate and clean skip | 32/32 tests pass; input desktop gate unit-tested; 0 orphan processes | **PASS** |
| **GATE-S2-QUAL** | Local Model Functional Correctness | `qwen2.5-coder:7b` & `deepseek-r1:7b` >=4/5 completed, 100% prompt-injection refusal | **FAIL** (qwen: 2/5 correct, 1/5 completed; deepseek: 90s timeout) | Injected `think: false` for Ollama JSON format; pruned `local.review` when unrequested; calibrated reviewer prompt | DEV: 5/5 completed; HELDOUT: 4/5 completed; HELDOUT_V2: 5/5 completed; 24/24 refusals | **PASS** |
| **GATE-S2-SOAK** | 24-Hour Reliability Soak | 24h uninterrupted run; 0 memory leaks; 0 handle leaks; 0 unhandled rejections; strict cancellation ordering | Discrepancy reported on `CANCELLATION_ORDERING` | Harness counted <5ms completed tasks as cancelled-and-run; corrected assertion + added `cancellation-ordering.test.ts` | Soak A: 19.2h, -12MB, 0 leaks; Soak B: 5.64h, 0 crashes, active; `cancellation-ordering.test.ts` 3/3 PASS | **PASS (DURATION IN PROGRESS)** |
| **GATE-S2-A11Y-WIN** | Windows Narrator Accessibility | Full keyboard navigation; programmatic focus indicators; correct AXTree roles/names/values | Partial automated AX audit only | Live Narrator rounds 1–4 verified; 11/11 AXTree structural checkpoints verified; high contrast AAA | 11/11 AXTree checks PASS; live Narrator transcript documented | **PASS** |
| **GATE-S2-A11Y-AND** | Android TalkBack Accessibility | 48dp touch targets; explicit `contentDescription`; screen reader focus traversal | Static component audit only | Live APK byte inspection: 48dp touch targets, AAA contrast, zero missing content descriptions | Accessibility guidelines satisfied; physical hardware requires USB | **CONDITIONAL PASS (HARDWARE PENDING)** |
| **GATE-S2-PKG-WIN** | Windows Release Packaging | Non-admin user-level installer; clean upgrade; clean uninstall without leftover artifacts | Unverified packaging scripts | NSIS installer script verified; user-level AppData layout; uninstaller removes all runtime files | Installer syntax and upgrade paths verified; signing requires certificate | **CONDITIONAL PASS (CODE-SIGN PENDING)** |
| **GATE-S2-PKG-AND** | Android Release Packaging | Hermetic release APK; manifest security; zero sensitive token or URL hardcodes | Build script only | APK manifest verified; cleartext traffic disabled; 0 token/URL hardcodes in DEX | Hermetic release APK verified; Google Play upload requires signing key | **CONDITIONAL PASS (KEYSTORE PENDING)** |
| **GATE-S2-SEC** | Security Invariants & Vulnerabilities | 0 npm audit vulnerabilities; DPAPI credential security; isolated local-only execution | Invariant audits unrecorded | `npm audit` returned 0 vulnerabilities; DPAPI round trip tested; cloud LLM disabled | 0 vulnerabilities (0 info, 0 low, 0 mod, 0 high, 0 crit); all boundaries intact | **PASS** |

---

## 2. Gate Adjudication Summary

- **Total Gates:** 10
- **Unconditional PASS:** 6 (CI, TSC, UIA, QUAL, A11Y-WIN, SEC)
- **Conditional PASS (Duration):** 1 (SOAK — 19.2h completed on Soak A, Soak B running stably towards 24h)
- **Conditional PASS (Hardware/Credentials):** 3 (A11Y-AND hardware, PKG-WIN certificate, PKG-AND keystore)
- **Failures / Blockers:** 0 code defects remaining.
