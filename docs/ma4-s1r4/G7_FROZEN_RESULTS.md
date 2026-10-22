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

## Results — decisive run (2026-10-22 21:08–21:50 UTC, commit `386815e`)

Evidence: `evidence/g7-s1r4-auto.json` / `.log`. Strategy `s1r4-v3c` (selected by the pre-registered rule: v3c dev
11/20 ≥ 11). Pins Planner/Worker/Reviewer `qwen2.5-coder:7b`, Tester `huihui_ai/qwen2.5-abliterate:7b`. Runtime task
hash `aa5d5c19…4cb8` = S1R2/S1R3; every reference pre-flight passed. No interruption, no resume, 0 memory waits.

| Configuration | G7 v2 (≥ 2/3) | Held-out (≥ 14/20) | Source |
|---|---|---|---|
| S1R2 workflow, coder 7B | 0/3 | 15/20 | `docs/ma4-s1r2/evidence/g7.json` |
| **S1R3 baseline**, coder 7B (run 2, decisive) | **0/3** | **13/20** | `docs/ma4-s1r3/evidence/g7-run2-qwen2.5-coder-7b.json` |
| Improved S1R4 workflow, coder 7B on every role | NOT RUN (declared in pre-registration) | NOT RUN | — |
| Stronger local model (27B/30B) | BLOCKED_RESOURCE_LIMIT | BLOCKED_RESOURCE_LIMIT | `evidence/load-probe-*.json` |
| **S1R4 final automatic routing** (decisive) | **0/3** | **17/20** | `evidence/g7-s1r4-auto.json` |

Held-out by kind: simple 6/6, intermediate 4/6 (i1-roman 0/2), debugging 3/4 (d1-flatten t1), planning 4/4
(S1R3: 5/6, 3/6, 3/4, 2/4).

| Measure | S1R3 run 2 | S1R4 decisive |
|---|---|---|
| Statuses | passed 13, failed 8, malformed_artifact 2 | passed 17, failed 6, **malformed 0** |
| Passed on the first attempt | 9 | **16** |
| Repair rounds used | 24 | 11 rounds, 14 targeted repairs (Worker 11: 1 resolved, 2 not retested after an identical proposal; Tester 3: 1 resolved) |
| Passed only after repair | 4 | 1 |
| Reviewer false approvals (all blocked by the gate) | 3 | 2 |
| Model calls | 117 (5.1 / trial) | 118 (5.1 / trial) — Worker samples offset by fewer repairs |
| Call latency median / P95 | 13.7 s / 46.7 s | 18.4 s / 57.4 s (two models swap in 6 GiB VRAM) |
| Trial wall time total / median / max | 2,223 s / 70 s / 282 s | 2,371 s (+6.6 %) / 78 s / 303 s |
| Output tokens, throughput | — | 36,803; median 23.7 tok/s; 2 replies hit `num_predict` |
| Tool receipts | — | 100 % orchestrator-invoked, all allowed by the broker, all ok |

### Invariants (must be 100 %): all held

pins held 23/23 trials (served model = pin on every call), ordering, deterministic gate is the only authority, and
the controlled cancellation ended `cancelled` with 0 sandbox runs and 0 live requests. External requests refused: 0.

### G7 verdict

| Gate | Requirement | Result | Status |
|---|---|---|---|
| **R4-G7** | original G7 v2 ≥ 2/3 | **0/3** | **FAIL** |
| **R4-G8** | held-out ≥ 14/20 | **17/20** | **PASS** |
| G7 overall | both, plus invariants | — | **FAIL** (v2 regression threshold not met) |

### Why v2 still fails (read after the run; not used to change anything)

All three final v2 implementations are the same near-correct design: `re.match(r'^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$', text)`.
Every component is optional, so `''` matches and returns 0 instead of raising `ValueError` — the single remaining
hidden-test failure in each trial (S1R3's v2 failures were malformed Tester JSON and a broken Worker). No generated
test covered the empty string, so the Worker's only signal was "the independent acceptance suite failed (details
withheld)", and its repairs came back byte-identical (stopped). The fix is one line; the 7B Worker never found it.
Sampling could not help because all samples shared the same blind spot.

### Statistical caution

17/20 vs 13/20 (S1R3) and 15/20 (S1R2) on n = 20 at temperature > 0: the improvement is consistent with the
development evidence (first-attempt passes 16 vs 9; no malformed artifacts) but a single run is not proof of a stable
+4. v2 at 0/3 is consistent across S1R2, S1R3 and S1R4.
