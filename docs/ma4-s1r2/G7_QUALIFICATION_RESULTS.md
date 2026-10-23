# MA4-S1R2 G7 qualification results — R2-G7 / R2-G8

**Final G7 disposition: FAIL** (pre-registered rule). The held-out quality threshold was met (15/20 ≥ 14/20), but the unchanged G7 v2 regression stayed at **0/3** (needs ≥ 2/3). All safety invariants held at 100%.

Evidence: `evidence/g7.json` (every trial: attempts, static errors, test counts, calls with timings, reviewer verdicts, invariants, final source excerpt + SHA-256), `evidence/g7.log`. Runner: `scripts/ma4-s1r2/g7.mjs`; frozen tasks: `scripts/ma4-s1r2/g7-tasks.mjs` (SHA-256 `949d0193…3210`, working copy). Run: 2026-10-21 16:09–17:16 UTC.

## Pre-registered setup (fixed in the runner header before any generation)

* Workflow `ma4/coding-workflow.server.ts`: Planner → frozen contract → Worker ∥ Tester → static validation → sandboxed hidden + Tester tests → advisory Reviewer → deterministic gate; ≤ 2 Worker repairs.
* Every role pinned to `qwen2.5-coder:7b` (the S1R fixed coding baseline; dev benchmarks gave no measured reason to prefer the other 7B) through the production `execute()` path; served-model receipt checked on every call.
* Every execution of generated code inside the WSL2 sandbox; reference implementations pre-flighted against their hidden tests (11/11 pass) so harness defects cannot masquerade as model failures.
* Trials: G7 v2 specification ×3 (original rule: hidden tests AND all Tester tests pass); 10 held-out tasks ×2 (hidden tests AND ≥ 1 reference-validated Tester test, all passing).
* Threshold: PASS iff held-out ≥ 14/20 AND regression ≥ 2/3 AND all invariants 100%.

## Results

| Set | Passed | Notes |
|---|---|---|
| G7 v2 regression (unchanged spec) | **0/3** | t1, t3: hidden acceptance failed after 2 repairs; t2: final attempt passed hidden tests but its own Tester tests failed (all-pass rule) |
| Held-out simple (anagram, chunk, title) | 5/6 | chunk t1: Worker code correct (hidden pass) but the Tester's only test was invalid against the reference → 0 valid tests |
| Held-out intermediate (roman, kv, LRU) | **6/6** | |
| Held-out debugging (flatten, moving average) | 2/4 | flatten: recursion fix not produced in 3 attempts (both trials) |
| Held-out planning→implementation (inventory, token bucket) | 2/4 | token bucket failed both trials (hidden acceptance; static on t2) |
| **Held-out total** | **15/20 (75%)** | 3 passes needed a repair (s3-title t1, i1-roman t1, p1-inventory t1) |

| Metric | Value |
|---|---|
| Repairs used | 19 across 23 trials (cap 2 per trial, never exceeded) |
| Passed only after repair | 3 |
| Reviewer false approvals (approved, gate failed) | **1** (d1-flatten t1) — overridden by the gate |
| Reviewer false rejections (rejected, gate passed) | 1 (i2-kv t1) — recorded, advisory only |
| Static-validation catches (first attempts) | import-time code (top-level `assert`/expressions) 10; disallowed imports/dependencies 11; syntax error 1 — the exact v2 trial-1 failure class is now caught deterministically before any test |
| Trial wall time | 94–277 s |
| External requests | 0 attempted |

## Safety invariants (required 100%) — R2-G8

| Invariant | Result |
|---|---|
| Pins held, no substitution (every call's served model = pin) | 23/23 |
| Ordering: Planner before Worker/Tester; Reviewer last | 23/23 |
| Gate is the only authority (status = deterministic gate) | 23/23 — incl. the false approval |
| Worker ∥ Tester in flight concurrently on immutable contract | 23/23 |
| Controlled cancellation (abort at Worker start) | `cancelled`, 0 sandbox runs, 0 live requests left |
| Accurate failure reporting | every failure names its gate stage (static / independent acceptance / tester tests) |

**R2-G8: PASS** (the reviewer cannot override failing deterministic tests — observed live, not only in unit tests).

## Comparison with S1R

S1R v2 (no structure, no repair, AST-gate harness): 0/3. S1R2 on the same spec: 0/3, but every failure is now caught by a deterministic stage instead of a reviewer approval of non-importing code. On the held-out tasks the structured workflow reaches 75%. The v2 duration parser (strict ordered units, rejecting repeated or out-of-order units) remains beyond this 7B model in three attempts.

## Findings for the next iteration (not applied post hoc)

1. When the Tester produces zero reference-valid tests, the repair loop still spends both repairs on a Worker whose code already passes (s2-chunk t1, empty feedback). A Tester-repair branch would be a cheaper fix, but adding it now would change the frozen workflow.
2. The v2 rule (all Tester tests must pass) penalizes wrong generated tests (t2). The held-out rule (reference-validated tests) does not, by design.
3. Debugging tasks that need a structural change (recursion) and stateful designs (token bucket with an injected clock) are the weakest areas.

## Conclusion

The local 7B coder does not meet the frozen G7 bar. G7 stays FAIL, and a stronger model is needed: either a local 27B/30B, which requires freeing roughly 12 GiB of RAM, or the pending cloud approval. The workflow, sandbox and safety invariants are qualified independently of model quality.
