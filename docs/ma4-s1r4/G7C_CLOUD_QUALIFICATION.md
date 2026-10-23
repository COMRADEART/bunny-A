# MA4-S1R4-G7C — Cloud-assisted G7 v2 qualification

Scope: only the remaining failing gate, R4-G7 (original G7 v2 ≥ 2/3). Held-out G7 (17/20, local), routing, pins,
scheduler, sandbox, security, CI, audit and UI results are unchanged and not rerun. A cloud-assisted result is reported
separately from local-only qualification and is **not** evidence of local-model capability or broad generalization.

## Pre-registration (committed before any cloud request)

* **Authorization (owner, written):** Groq `openai/gpt-oss-120b` only; Worker and Tester only; synthetic G7 task
  specifications only; ≤ 12 requests total, ≤ 4 per trial; $0; 7-day validity; no fallback cloud provider; no project
  files, memories, credentials, hidden tests or reference solutions sent.
* **Owner steps (agents cannot do these):** enable Zero Data Retention in Groq Data Controls; create the key on a Free
  plan org with no payment method; run `node --experimental-strip-types scripts/ma4-s1r4/g7c-cloud.mjs issue` in the
  owner's own terminal. That command records the ZDR / Free-plan attestations (owner-attested; Groq exposes no API to
  read them), checks with one metadata request (`GET /openai/v1/models`, no inference, no task data) that the model is
  offered to the org, DPAPI-protects the key in an isolated store (`%LOCALAPPDATA%\Bunny-A\ma4-g7c\g7c.sqlite`, never
  the Host DB, env, files or logs), and issues the scoped approval as the workstation actor.
* **Run (one decisive run, no resume, no retries):**
  `G7_STRATEGY=s1r4 G7_CLOUD=groq G7_OUT=docs/ma4-s1r4/evidence/g7c-groq.json node --experimental-strip-types scripts/ma4-s1r2/g7.mjs`
  * Frozen tasks/hidden tests/references (task hash `aa5d5c19…4cb8`, reference pre-flight), strategy `s1r4-v3c`
    unchanged (adaptive Worker samples, max 2 repairs), the v2 all-pass rule, threshold ≥ 2/3. No prompt changes; the
    previously observed `''` failure is not given to any model.
  * Agents: Planner `qwen2.5-coder:7b` local; **Worker, Tester `groq/openai/gpt-oss-120b`**; Reviewer `qwen2.5-coder:7b`
    local; acceptance = the local deterministic gate; generated code runs only in the WSL2 sandbox.
  * **Cap policy (owner decision "strict"):** caps are checked before sending. The frozen strategy's first attempt
    already uses 4 cloud calls (3 Worker samples + Tester), so a 5th cloud call in a trial is refused unsent and the
    trial ends `model_error` (counted as not passed). Cloud calls are serialized and paced on Groq's rate-limit headers.
  * **Stop the whole run immediately** (evidence saved, approval revoked, credential deleted) on: a hidden test,
    reference or host path in a cloud prompt (checked before sending); HTTP 401/402/403/429; an invalid, expired or
    revoked approval; a sandbox error, pin violation or pin mismatch.
  * Adapter mapping: `max_completion_tokens` = the strategy's `numPredict` + 2,048 because gpt-oss counts hidden
    reasoning in that budget.
  * Not rerun: held-out (local 17/20 stands) and the controlled-cancellation trial (it would spend cloud budget; the
    local S1R4 result stands).
* After the three trials the harness revokes the approval and deletes the stored credential; external inference
  returns to DISABLED. The owner should also delete the key in the Groq console.

## Results

**G7 v2 cloud-assisted: 1/3 — FAIL** (threshold ≥ 2/3). Not cloud-assisted qualification; R4-G7 stays FAIL.

One decisive run, 2026-10-23 02:15:18Z → 02:21:41Z, exit 0, no resume, no retries
(`evidence/g7c-groq.json`, `evidence/g7c-groq.log`). Task hash `aa5d5c19…4cb8` and reference pre-flight matched;
strategy `s1r4-v3c`; sandbox `wsl2-userns-pivot_root-cgroupv2`.

| Trial | Result | Cloud requests sent | Refused unsent | What happened |
|---|---|---|---|---|
| g7-v2-duration#1 | `model_error` | 4 | 2 | Attempt 0: Worker samples 17/18, 18/18, 18/18 on the Tester suite → sample 1; static pass, hidden **1/2 failed**; Tester case `test_invalid_1h30m45s` fails on the frozen reference (test_invalid). Repair needed a 5th call → refused by the per-trial cap. |
| g7-v2-duration#2 | `model_error` | 4 | 2 | Same pattern: samples 11/11, 11/11, 10/11 → sample 0; hidden 1/2 failed; same invalid Tester case; repair refused by cap. |
| g7-v2-duration#3 | **passed** | 4 | 0 | Samples 9/9 ×3 → sample 0; static, hidden 2/2 and Tester all pass on attempt 0; local Reviewer approved. |

* **Requests:** 12 sent (12/12 total cap, 4/4 per trial), all HTTP 200; 4 further calls refused before sending by the
  strict per-trial cap. Tokens: 10,397 prompt / 15,807 completion (7,966 reasoning). **Cost $0** (Free plan, no
  payment method, owner-attested; no 402).
* **Errors:** no HTTP 401/402/403/429, no forbidden-content block, no sandbox error, no pin violation, no stop.
  The two `model_error` results are the cap refusals defined by the strict policy, not provider errors.
* **Invariants:** pins held (Planner/Reviewer local `qwen2.5-coder:7b`, Worker/Tester `groq/openai/gpt-oss-120b`),
  ordering held, the deterministic gate was the only authority; Reviewer false approvals/rejections 0; non-allowlisted
  external requests refused 0. Cancellation not rerun (local S1R4 result stands).
* **Revocation:** approval marked `revoked` and the DPAPI-stored credential deleted by the harness at
  2026-10-23T02:21:41Z; `g7c-cloud.mjs status` afterwards: `credentialSaved: false`, `approval_status: revoked`,
  block "External model approval was revoked." External inference is DISABLED again. The owner should also delete the
  key in the Groq console.

**Reading:** with gpt-oss-120b the first-attempt pass rate on v2 was 1/3. Both failures were still repairable under the
frozen 2-repair budget (the gate attributed them to Worker and Tester), but the owner-chosen strict cap of 4 requests
per trial leaves no budget for any repair, because the frozen strategy spends all 4 on attempt 0. This run does not show
whether gpt-oss-120b would pass with repairs, and it says nothing about local-model capability.

---

# G7C-2 — repair-enabled rerun (separate result; G7C-1 above stays on record unchanged)

## Pre-registration (committed before any G7C-2 cloud request)

* **Owner decision (2026-10-23, after G7C-1):** rerun the same three frozen G7 v2 trials with caps of **≤ 8 requests per
  trial, ≤ 24 total**; report as a separate G7C-2 result beside G7C-1. Everything else in the G7C authorization is
  unchanged: Groq `openai/gpt-oss-120b` only, Worker and Tester only, synthetic G7 specs only, $0, 7-day approval,
  no fallback provider, no project files, memories, credentials, hidden tests or references sent.
* **Why 8:** under the frozen `s1r4-v3c` strategy a trial makes at most 4 cloud calls on attempt 0 (3 Worker samples +
  Tester) plus at most 2 repair rounds × (1 Worker + 1 Tester) = **8**. The cap therefore can no longer end a trial;
  only the frozen 2-repair budget, the gate and the stop conditions can.
* **The only code change** is `CAPS` in `scripts/ma4-s1r4/g7c-cloud.mjs` (12/4 → 24/8), pinned by
  `ma4-g7c.test.ts`. Tasks, hidden tests, references, task hash `aa5d5c19…4cb8`, strategy, prompts, repair budget,
  threshold (≥ 2/3), stop conditions and security controls are unchanged. G7C-1 failures are not given to any model.
* **Owner step:** the G7C-1 approval is revoked and its credential deleted, so the owner issues a fresh approval in
  their own terminal: `node --experimental-strip-types scripts/ma4-s1r4/g7c-cloud.mjs issue` (it shows the new caps).
  A new Groq key is recommended if the G7C-1 key was deleted in the console.
* **Run (one decisive run, no resume, no retries):**
  `G7_STRATEGY=s1r4 G7_CLOUD=groq G7_OUT=docs/ma4-s1r4/evidence/g7c2-groq.json node --experimental-strip-types scripts/ma4-s1r2/g7.mjs`
  The harness revokes the approval and deletes the credential when the run finishes or stops.
* **Reporting:** ≥ 2/3 → "cloud-assisted G7 v2 qualification (G7C-2)", never local-only qualification. < 2/3 → R4-G7
  stays FAIL. Either way G7C-1 (1/3 under the strict cap) is reported alongside.

## G7C-2 results

PENDING — waiting for the owner to issue the G7C-2 approval.
