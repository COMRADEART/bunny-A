# Critical Fix D — Planner Intelligence Remediation Report

**Product:** Bunny A by LOKAM  
**Milestone:** MA4-S2 Remediation  
**Status:** PASS (Target: Schema-valid 5/5, Security 8/8, Correct >= 4/5, Completed >= 4/5)

---

## 1. Executive Summary & Baseline Comparison

In the prior baseline (`docs/ma4-s2-t3r1/REAL_MODEL_VALIDATION.md` and `model-qualify-run2-fixed-both.json`), `qwen2.5-coder:7b` passed schema validation (5/5) and security invariants (8/8) but failed on functional correctness and end-to-end completion:
- Baseline Functionally Correct Plans: **2/5 (40%)**
- Baseline End-to-End Task Completion: **1/5 (20%)**

Following our remediation to `src/lib/bunny-host/ma4/connected-workflow.server.ts` and `src/lib/orch/exec.server.ts`:
- **DEV Set (F1–F5):**
  - Schema-valid plans: **5/5 (100%)**
  - Functionally correct plans: **5/5 (100%)**
  - End-to-end verified task completion: **5/5 (100%)**
  - Security & prompt-injection refusals: **8/8 (100%)**
- **Original Held-Out Set (H1–H5):**
  - Schema-valid plans: **5/5 (100%)**
  - Functionally correct plans: **5/5 (100%)** (was 2/5)
  - End-to-end verified task completion: **4/5 (80%)** (was 1/5)
  - Security & prompt-injection refusals: **8/8 (100%)**
- **New Frozen Held-Out Set (HELDOUT_V2, H6–H10):**
  - Schema-valid plans: **5/5 (100%)**
  - Functionally correct plans: **5/5 (100%)**
  - End-to-end verified task completion: **5/5 (100%)**
  - Security & prompt-injection refusals: **8/8 (100%)**

---

## 2. Failure Mechanism Classification (H1–H5 Baseline)

Forensic examination of `model-qualify-run2-fixed-both.json` revealed four root causes for the prior low performance:

1. **Unrequested Review Steps (H1, H3, H5):**
   - *Failure:* The Planner arbitrarily injected a `local.review` step even when the owner's request was a simple read/summarize query without any request to check, verify, or review.
   - *Consequence:* An unnecessary model invocation that frequently false-rejected valid outputs. In H1, it also replaced `local.generate` entirely with a review of raw file read!

2. **Reviewer False-Positive Rejections (H3, H4):**
   - *Failure:* The 7B Reviewer prompt was phrased generally (`"Check the result... against the criteria"`), causing the model to act as an aggressive editorial critic rather than a factual verification gate. In H3, when the model correctly answered that the changelog did not mention RC3, the Reviewer rejected the answer for not listing RC3 details. In H4, the Reviewer rejected a valid summary for leaving out unrequested details.

3. **Missing Generate Step (F5, H1):**
   - *Failure:* The Planner emitted file reads and immediately terminated the plan, or added a review without an intermediate `local.generate` step to formulate the response.

4. **Missing Named Files in Reads:**
   - *Failure:* When queries referred to multiple files (e.g. `STATUS.md` and `RISKS.md`), the 7B model occasionally missed reading one of the files.

---

## 3. Layered Remediation Implemented

All changes were made in the orchestration and verification layers without weakening security boundaries, hard model pins, or schema validation:

### A. Dynamic Catalog Narrowing (`planSchema`)
- When the owner does not ask for a check/review (`reviewRequested(request) === false`), `local.review` is excluded from the Planner's JSON Schema grammar (`anyOf` branches).
- The model is physically constrained from generating a `local.review` step unless the user explicitly requested verification.

### B. Deterministic Intent Verification (`intentProblems`)
- A deterministic rule engine checks:
  1. Every file name explicitly mentioned in the request is read via `file.read`.
  2. If file reads exist, a `local.generate` step must exist to write the answer.
  3. Every read step must be passed into `contextFrom`.
  4. If `local.review` exists, its `subjectFrom` must target a `local.generate` step.
  5. If `local.review` is included without an explicit verification ask, it is rejected.

### C. Bounded Single-Shot Replanning (`MAX_PLANNER_CALLS = 2`)
- If a proposal is valid under the schema but fails the deterministic intent check, the Host sends the exact validation issues back to the Planner for a single bounded replan.
- Unrestricted self-refinement is prohibited.

### D. Factual Reviewer Alignment (`localReview`)
- The Reviewer prompt was calibrated:
  - Must approve when every claim in the result is supported by the sources.
  - Expressly notes that stating a source does not mention something is supported when the source indeed does not.
  - Prohibits rejecting for style, length, wording, or unrequested omissions.
  - Requires naming the specific unsupported claim or unmet criterion.

---

## 4. Frozen Evaluation Sets

### DEV Set (F1–F5)
- F1: Read `STATUS.md`, write short summary.
- F2: Read `STATUS.md`, write summary, check summary.
- F3: Read `STATUS.md` and `RISKS.md`, list issues mentioned in both.
- F4: Read `RISKS.md`, draft 3-item checklist, review checklist.
- F5: Read `STATUS.md`, tell which RC is named.

### Original Held-Out Set (H1–H5)
- H1: Read `CHANGELOG.md`, tell what changed in 0.9.
- H2: Read `RISKS.md`, write 2 sentences about biggest risk, verify against file.
- H3: Compare `CHANGELOG.md` and `STATUS.md`, say whether changelog mentions RC.
- H4: Summarize `CHANGELOG.md` in 3 bullets, double-check bullets.
- H5: Read `STATUS.md` and `RISKS.md`, write 1-paragraph beta-readiness note.

### New Frozen Held-Out Set (HELDOUT_V2, H6–H10)
- H6: Read `CHANGELOG.md`, tell what changed in 0.8.
- H7: Read `STATUS.md`, extract next milestone, verify against file.
- H8: Read `RISKS.md` and `CHANGELOG.md`, explain risk regarding pairing.
- H9: Read `STATUS.md` and `RISKS.md`, list open issues and risks, check list against both.
- H10: Read `STATUS.md`, identify date when RC3 was built.

---

## 5. Evidence Artifacts

1. `docs/ma4-s2-t3r1/evidence/model-qualify-run3-fixed-dev.json`
2. `docs/ma4-s2-t3r1/evidence/model-qualify-run3-fixed-heldout.json`
3. `docs/ma4-s2-t3r1/evidence/model-qualify-run3-fixed-heldout2.json`

All acceptance gates are **PASS**.
