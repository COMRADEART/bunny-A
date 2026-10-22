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

PENDING — not run. Blocked on the owner steps above (no credential, no approval issued as of this commit).
