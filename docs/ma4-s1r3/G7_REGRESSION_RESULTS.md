# MA4-S1R3 G7 regression results — R3-G7 / R3-G8

## Pre-registration (committed before any S1R3 G7 generation)

* **Runner:** `scripts/ma4-s1r2/g7.mjs`, unchanged except the harness-only changes listed below.
* **Frozen task set:** `scripts/ma4-s1r2/g7-tasks.mjs`, git blob SHA-256 `949d01934e93be644e9ca7735d839a81c3b6fc8fc68721904a032a48dc2f3210` (same as S1R2). The runtime `taskHash` must equal S1R2's.
* **Trials and rules (unchanged):** G7 v2 regression ×3 with its original rule (hidden tests AND every Tester test passes); 10 held-out tasks ×2 (hidden tests AND ≥ 1 reference-validated Tester test, all passing).
* **Threshold (unchanged):** G7 PASS iff held-out ≥ 14/20 AND v2 regression ≥ 2/3 AND every safety invariant is 100%. Held-out passes never compensate for the regression.
* **Workflow under test:** the S1R3 fault-aware workflow (`src/lib/bunny-host/ma4/coding-workflow.server.ts`): deterministic failure attribution, targeted Planner/Worker/Tester repair, ≤ 2 repair rounds per trial shared by every agent, decode-time module-name constraint on declared dependencies, Reviewer advisory only.
* **Decisive pin:** every role pinned to `qwen2.5-coder:7b`. The local 27B and 30B models are `BLOCKED_RESOURCE_LIMIT` (see `MODEL_QUALIFICATION.md`), so this is the strongest runnable coding model.
* **Exploratory run (does not decide any gate):** the same runner with `G7_PIN=huihui_ai/qwen2.5-abliterate:7b`, only if time allows after the decisive run. Its result is reported, never substituted for the decisive run.
* **Harness-only changes (no effect on tasks, rules, scoring or threshold):** `G7_OUT` selects the evidence file so the historical `docs/ma4-s1r2/evidence/g7.json` is not overwritten; each run additionally records `repairs`, `failures` and `contractVersion`; the summary adds `repairsByTarget`.
* No whole-trial retries, no cherry-picking; every trial is recorded. Generated code runs only inside the WSL2 sandbox. External requests are refused by the runner's network allowlist.

Command:

```text
G7_OUT=docs/ma4-s1r3/evidence/g7-qwen2.5-coder-7b.json node --experimental-strip-types scripts/ma4-s1r2/g7.mjs
```

## Results

Pending (filled in after the decisive run completes).
