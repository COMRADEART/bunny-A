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

## Addendum (written while run 1 was in progress, after its 3 regression trials were observed)

Run 1 exposed two workflow gaps. Both follow from the policy already stated in the mission, and neither is specific to any task:

1. Under the all-pass rule, an invalid Tester test (one that fails on the frozen reference) that happens to *pass* on a buggy Worker is only flagged after the Worker is fixed, when the budget is already spent (v2 t2).
2. The execution layer reports a malformed structured reply as an error ("invalid structured JSON"), so it bypassed producer repair and ended the trial as `model_error` (v2 t3).

Rule fixed now, before any further generation: run 1 is reported in full as the result of workflow v1 (`611c37f`). At most **one** further S1R3 run (run 2) is made, with the fixes, under exactly the same tasks, trials, rules, threshold and pin, using a new evidence file. R3-G7/R3-G8 are decided by **run 2**; run 1 stays reported next to it. No further reruns in S1R3, whatever run 2 shows.

## Results — run 1 (workflow v1 `611c37f`, S1R2 sandbox; 2026-10-21 20:30–20:57 UTC)

Evidence: `evidence/g7-qwen2.5-coder-7b.json` / `.log`. The runtime task hash equals S1R2's (`aa5d5c19…4cb8`), and every reference pre-flight passed.

| Set | Passed | Notes |
|---|---|---|
| **G7 v2 regression** | **0/3** | t1: the Worker's source failed static validation in all 3 attempts. t2: the Worker was fixed on its 2nd repair (hidden acceptance **passed**), but a *latent* invalid Tester test then blocked it with the budget spent (gap 1). t3: `model_error`, a malformed Tester reply rejected by the execution layer (gap 2) |
| Held-out | **13/20** | simple 5/6, intermediate 3/6, debugging 4/4, planning 1/4 |
| `model_error` | 5 | 1 malformed structured reply (gap 2); **4 infrastructure**: Ollama `HTTP 500` ×3 and "Ollama is offline" ×1 (see below) |
| Repairs | 15 | Worker 11 (4 resolved), Tester 3, Planner 1 (resolved) |
| Reviewer | 0 false approvals, 1 false rejection | |
| Invariants | pins 23/23, ordering, gate authority, cancellation (`cancelled`, 0 sandbox runs, 0 live requests): **100%** | |

Run 1: **G7 FAIL**. Without the 4 infrastructure errors, held-out would be at most 13/16 attempted. The pre-registered score counts them as non-passes, and that rule is kept.

**Infrastructure errors.** Ollama 0.40.6 returned HTTP 500 mid-generation at 20:38:51, 20:46:00 and 20:46:59 UTC and was unreachable at 20:53:05. Its log shows no grammar or out-of-memory message. A targeted probe of 20 concurrent Worker-schema requests, with and without the new `pattern`, produced **0** errors (`scripts/ma4-s1r3/http500-probe.mjs`), so the decode-time constraint is not the cause. The same log shows Ollama instability before this session (`/api/tags` 500s, GPU-discovery watchdog timeouts). During run 2 the cause became visible: `llama-server` grew to 12.9 GiB of private memory while serving only the 5 GiB 7B model (see run 2).

## Results — run 2 (decisive; workflow v2 `3724349`, seccomp sandbox `9548eac`)

Evidence: `evidence/g7-run2-qwen2.5-coder-7b.json` / `.log`. Same task hash, pin, trials, rules and threshold as run 1.

**Interruption.** At 12/23 trials (21:02–21:16 UTC) Claude Code's host low-memory guard stopped the runner. Available RAM had fallen from 10.7 GiB to 2.4 GiB because Ollama's `llama-server` grew to **12.9 GiB private** memory (8.75 GiB resident) while serving only `qwen2.5-coder:7b` (5.04 GiB, 3.8 GiB in VRAM). The model was unloaded (`keep_alive: 0`), which restored 12.2 GiB, and nothing else was touched. With the owner's approval, the run was resumed with `G7_RESUME=1` (commit `5d223d5`). The resume kept the 12 recorded trials byte-for-byte, refused any task-hash or pin mismatch, re-ran the reference pre-flight (all pass), ran only the 11 missing trials plus the cancellation trial, and unloaded the model after every trial. The resumed part had **no** infrastructure errors.

| Set | Passed | Notes |
|---|---|---|
| **G7 v2 regression** | **0/3** | t1, t2: `malformed_artifact`. The Tester was attributed and repaired twice, but each repair reply was again rejected as invalid JSON, most likely the rewritten test file exceeding `num_predict` 2048. t3: hidden acceptance still failing after 2 Worker repairs (a Tester repair ran in parallel) |
| Held-out | **13/20** | simple 5/6, intermediate 3/6, debugging 3/4, planning 2/4 |
| Statuses | passed 13, failed 8, malformed_artifact 2, **model_error 0** | |
| Repair rounds | 24 | Worker 19 (3 resolved), Tester 7 (1 resolved), Planner 1 (resolved); 4 passes needed a repair |
| Reviewer | **3 false approvals, all blocked by the gate**; 1 false rejection | |
| Invariants | pins, ordering, gate authority, cancellation: **100%** | |
| Call latency (111 ok calls) | median 13.7 s, p95 46.7 s; trials 47–282 s | |

## G7 verdict — R3-G7 / R3-G8

| Gate | Requirement | Run 2 (decisive) | Status |
|---|---|---|---|
| R3-G7 | original G7 v2 ≥ 2/3 | 0/3 | **FAIL** |
| R3-G8 | held-out ≥ 14/20 | 13/20 | **FAIL** |
| R3-G5 | the Reviewer cannot override failed tests | 3 live false approvals blocked (plus run 1 and the unit tests) | **PASS** |
| R3-G9 | manual pins enforced | 23/23 + 23/23 trials, every call's served model = pin | **PASS** |

S1R2 reached 15/20 held-out with the S1R2 workflow. Runs 1 and 2 reached 13/20. With n = 20 and sampling at Ollama's default temperature 0.8, a difference of 2 is within noise (binomial sd ≈ 2). Fault-aware repair **did not measurably raise the pass rate on this model**. It changed *where* the budget goes: Tester faults are now repaired by the Tester, and correct Workers are not regenerated. But the 7B Tester rarely produces a valid repaired test file (1/7 resolved), and the 7B Worker rarely fixes a real defect within two rounds (3/19). The remaining failures are model-capability failures, now attributed explicitly. A stronger model is required. The 27B/30B models are BLOCKED_RESOURCE_LIMIT, and cloud inference is not approved.

## Lessons recorded (not applied post hoc)

* Tester repairs should ask for only the replaced test methods, not the whole file, to stay inside the output budget.
* Long qualification runs should unload the model periodically; Ollama 0.40.6's runner memory grows with request count.
* The G7 runner uses Ollama's default sampling temperature (0.8). Variance between runs is large at n = 3 and n = 20. A fixed seed or lower temperature would make reruns comparable, but changing it would change the frozen benchmark, so it is left to the owner.
