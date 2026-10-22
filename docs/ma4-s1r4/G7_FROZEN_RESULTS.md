# MA4-S1R4 — Frozen G7 qualification (R4-G7 / R4-G8)

## Pre-registration (committed before any S1R4 G7 generation and before the v3c development result was seen)

* **Runner:** `scripts/ma4-s1r2/g7.mjs`. S1R4 harness-only changes: `G7_STRATEGY`, `G7_PINS` (role pins), forwarding
  of the strategy's per-role sampling, per-call token receipts, sample/tool records, and a bounded wait (≤ 15 min) for
  4 GiB of free RAM before a model call instead of an immediate refusal (another local workload swings RAM by up to
  12 GB). None of these touch tasks, hidden tests, references, the oracle, trial counts, rules or the threshold.
* **Frozen task set:** `scripts/ma4-s1r2/g7-tasks.mjs` unchanged — git blob SHA-256 `949d0193…3210`, runtime task hash
  must equal S1R2/S1R3 `aa5d5c19…4cb8` (verified on this branch).
* **Trials, rules, threshold (unchanged):** G7 v2 ×3 under its original all-pass rule; 10 held-out tasks ×2 under the
  reference-validated rule. **G7 PASS iff held-out ≥ 14/20 AND v2 ≥ 2/3 AND every safety invariant is 100 %.**
* **Decisive configuration — "final automatic routing":**
  * Strategy: **`s1r4-v3c` if its development result (coder 7B, 20 dev trials) is ≥ 11/20, otherwise `s1r4-v3b`.**
    (11/20 is the S1R3 baseline and the v3b result on the same development set.) The strategy is the one at the HEAD
    commit when the run starts; the commit is recorded.
  * Role pins from `assignRole()` over the paired v3b development evidence (`evidence/role-evidence-v3b.json`):
    Planner `qwen2.5-coder:7b`, Worker `qwen2.5-coder:7b`, **Tester `huihui_ai/qwen2.5-abliterate:7b`**, Reviewer
    `qwen2.5-coder:7b`. Command:
    `G7_STRATEGY=s1r4 G7_PINS=Tester=huihui_ai/qwen2.5-abliterate:7b G7_OUT=docs/ma4-s1r4/evidence/g7-s1r4-auto.json node --experimental-strip-types scripts/ma4-s1r2/g7.mjs`
* **Exactly one decisive run.** If the host interrupts it, it is resumed with `G7_RESUME=1` (same task hash, strategy
  and pins enforced). No whole-trial retries, no cherry-picking, no second decisive run.
* **Not run in S1R4 (declared now):** a separate "improved workflow, coder 7B on every role" G7 run (time); the 27B/30B
  models (BLOCKED_RESOURCE_LIMIT, measured). They are reported as NOT RUN / BLOCKED, never estimated.
* External inference: none. Cloud tags refused by the runner; localhost-only fetch allowlist.

## Results

*(appended after the run)*
