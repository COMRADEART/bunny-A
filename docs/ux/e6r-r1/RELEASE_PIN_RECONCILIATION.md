# BUNNY A — E6R-R1 RELEASE-PIN RECONCILIATION REPORT

**Repository:** `COMRADEART/bunny-A`  
**Current Baseline HEAD:** `a9e45d8ce9da25f58f52275bf7dddc3eaa7109da` (PR #103 merged; GitHub Actions CI run `42164947223` green)  
**Date:** 2026-11-06  
**Status:** COMPLETE (Candidate Pin Staged; Production Pin Unactivated)

---

## 1. Executive Summary & Problem Analysis

During the E6R qualification phase, an inconsistency emerged between the committed release pin in the repository and the proposed beta release pin documented in `docs/ux/e6r/RELEASE_PACKAGE_READINESS.md`:

1. **Committed Active Pin (`install/release-pin.json`):**
   - Release: `Bunny-A-Windows-v26-MA2-R1`
   - Version: `26.0.0-MA2-R1`
   - Source Commit: `8001d51d871f12c15b8de03005a40e9d4c3fd8c2`
   - Baseline Commit: `f1934bda6b0d33f27bef198e8967a69f6eb329ff`
   - Note: Retained as the last formally authorized production milestone.

2. **E6R Proposed Beta Pin (`docs/ux/e6r/RELEASE_PACKAGE_READINESS.md` §2.1):**
   - Release: `Bunny-A-Windows-v28-BETA-1`
   - Version: `28.0.0-BETA.1`
   - Proposed Source Commit: `18c86c72c3880b9e57a030272d66d446628ae326`
   - Discrepancy: `18c86c7` represents the state prior to PR #103. Packaging from `18c86c7` excludes the unified qualification harness, native test fixtures, and verified documentation merged in PR #103.

3. **Circular Dependency Constraint:**
   - A Git commit cannot record its own SHA inside a committed file without altering the tree hash, creating a mathematical circular dependency.
   - Any proposed release candidate pin must point to an existing, reviewed, and immutable commit on `main`, while candidate release pins must be staged as reviewable candidates rather than prematurely overwriting the active production pointer.

---

## 2. Git Ancestry & Source Verification

We audited the commit graph connecting the baseline, intermediate commits, and current `main` HEAD:

```
f1934bda6b0d33f27bef198e8967a69f6eb329ff (Verified Baseline)
  └── 8001d51d871f12c15b8de03005a40e9d4c3fd8c2 (MA2-R1 Final Remediation)
        └── 18c86c72c3880b9e57a030272d66d446628ae326 (E6R pre-PR-103)
              └── a9e45d8ce9da25f58f52275bf7dddc3eaa7109da (Current Protected main / PR #103)
```

### Verification Checks:
- `git merge-base --is-ancestor f1934bda6b0d33f27bef198e8967a69f6eb329ff a9e45d8ce9da25f58f52275bf7dddc3eaa7109da` -> **EXIT 0 (PASS)**
- `git merge-base --is-ancestor 18c86c72c3880b9e57a030272d66d446628ae326 a9e45d8ce9da25f58f52275bf7dddc3eaa7109da` -> **EXIT 0 (PASS)**
- Commit `a9e45d8ce9da25f58f52275bf7dddc3eaa7109da` represents a linear, clean descendant of all prior milestones.

---

## 3. Staged Candidate Pin Manifest

To resolve the discrepancy without violating the release gating policy, we generated `install/release-pin.candidate.json` pointing to the exact reviewed commit `a9e45d8ce9da25f58f52275bf7dddc3eaa7109da`:

```json
{
  "release": "Bunny-A-Windows-v28-BETA-1",
  "version": "28.0.0-beta.1",
  "sourceCommit": "a9e45d8ce9da25f58f52275bf7dddc3eaa7109da",
  "baselineCommit": "f1934bda6b0d33f27bef198e8967a69f6eb329ff",
  "note": "Bunny A Windows Beta 1 candidate: Liquid Glass UI, native WPF workstation, dynamic glass notch, multi-agent coordination, local-only Ollama inference, and voice worker integration.",
  "compatibility": {
    "hostEntry": "Bunny-Host.mjs",
    "launcher": "Start-Bunny-Release.ps1",
    "hostPortDefault": 43119,
    "stateLayoutVersion": 2,
    "databaseSchemaVersion": 3,
    "codexCompatibilityPolicyVersion": 1,
    "hostFailurePolicyVersion": 1,
    "gitProcessOwnershipPolicyVersion": 1,
    "providerProcessContainmentPolicyVersion": 1,
    "hostSchemaUserVersion": 3
  }
}
```

### Operational Posture:
- `install/release-pin.json` is preserved in its authorized state (v26-MA2-R1).
- `install/release-pin.candidate.json` is reviewable in PR.
- Activation requires explicit operator authorization and promotion via PR merge.
