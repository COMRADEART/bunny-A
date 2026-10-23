# MA4-S2 — Intelligence evaluation

## 1. Pre-registration (committed before any S2 implementation existed or ran)

Everything in this section was written and committed before any S2 code was written, before any model output on
these tasks was seen, and before any skill existed. It is not edited after results are observed; deviations are
recorded in §3 instead.

### 1.1 Task suites

`scripts/ma4-s2/eval-tasks.mjs`, version `bunny-ma4-s2-eval-v1`, **task hash
`2b9d01a75e17464028543cd757c88df0542b442675bd5332c05fb44818165784`** (sha256 of the JSON task list).
Pre-flight (`scripts/ma4-s2/preflight.mjs`, `evidence/preflight.json`), run in the OS-enforced sandbox with no model:
all 24 references pass their hidden tests, all 6 quoted buggy programs fail them, and no module or function name
is shared with G7, the S1R4 dev set or the S1R2 benchmark sets (one clash, `flatten`, was renamed `flatten_dict`
before any model saw the suite).

| Split | Tasks | Use |
|---|---|---|
| train | 8 (2 strict, 1 simple, 2 intermediate, 2 debugging, 1 planning) | the **only** source skills may be discovered from |
| qualify | 4 (1 strict, 1 simple, 1 intermediate, 1 debugging) | the **only** tasks a candidate skill is benchmark-qualified on |
| heldout | 12 (4 strict, 3 intermediate, 3 debugging, 2 planning) | the decisive A/B/C comparison; never a discovery or qualification source |

Strict tasks use the G7 v2 `all-pass` Tester rule; the others use `reference-validated`, as in G7 and the S1R4 dev set.
Hidden tests and references never reach a model, a skill, a memory record or a prompt.

### 1.2 Arms (same models, same tasks, same budgets)

Pins for every arm, every role (the S1R4 decisive configuration): Planner, Worker and Reviewer
`qwen2.5-coder:7b`; Tester `huihui_ai/qwen2.5-abliterate:7b`. Local Ollama only. Cloud inference is disabled (no
approval exists; the revoked G7C-2 Groq approval is not reused). Generated code runs only in the WSL2 sandbox.

* **A — S1R4 baseline:** `runCodingWorkflow` with the frozen strategy `s1r4-v3c`, exactly as in S1R4.
* **B — S2 collaboration, no persistent learning:** the S2 Coordinator composes and assigns the team, every role
  handoff is a validated typed protocol message, model calls are scheduled model-grouped (no concurrent loads of two
  models on the 6 GiB GPU), the S2 repair budget applies. No memory read or write, no skills. Prompts are the A prompts.
* **C — S2 with qualified skills and Lotus Memory:** B, plus retrieval of benchmark-qualified skills and verified
  experience records through the Lotus stem, injected as a bounded, labelled advisory block (the contract always wins),
  and experience-guided repair (skills matched to the attributed failure categories). Memory is **read-only** during
  the held-out run: nothing learned from a held-out trial can reach a later held-out trial.

S2 repair budget for new workloads (fixed now): ≤ 2 repair rounds per trial (the same number as the frozen G7
budget, deliberately, so a difference cannot come from more repairs), identical-proposal stop, model-call budget
from the existing task profile. Advisory guidance ≤ 3 skills and ≤ 1,200 characters; experience lines ≤ 3.

### 1.3 Skill discovery and promotion protocol

1. **Discovery:** arm B on the train split, 2 trials per task (16 trials). For each trial the deterministic gate
   passed, the local Reviewer pin is asked once for a declarative procedure (schema-validated JSON: name, description,
   categories from a fixed vocabulary, preconditions, ≤ 6 procedure steps, target roles). Its input is the public task
   specification, the attributed failure categories with the Tester's own evidence lines, and the final passing source
   — never hidden tests, references or hidden-test details.
2. **Screening → CANDIDATE:** schema; no steering/injection text; no credential-like text; no 6-token overlap with
   any hidden test or reference of any S2, G7 or S1R4-dev task; requested permissions ⊆ the workflow's existing
   deterministic tools (anything else needs owner approval and is rejected for evaluation); at most 6 candidates go
   forward (trials that needed a repair first, then task order), duplicates by name merged.
3. **Sandbox validation → SANDBOX_VALIDATED:** the skill's source task re-run once in arm C with only that skill;
   the deterministic gate must pass.
4. **Benchmark qualification → BENCHMARK_QUALIFIED:** the qualify split, 2 trials per task, arm C with all
   sandbox-validated skills vs arm B. A skill qualifies only if it was retrieved in ≥ 1 qualify trial, the C passes on
   the trials where it was retrieved are ≥ the B passes on the same task/trial slots, and no permission or security
   violation occurred. A skill that was never retrieved stays SANDBOX_VALIDATED (generalization unproven).
5. **APPROVED / ACTIVE** require the workstation owner. The harness never approves. Arm C uses BENCHMARK_QUALIFIED
   skills under this evaluation's authorization only; no skill becomes ACTIVE in the product by this run.

### 1.4 Decisive held-out run and criteria

Held-out split, 2 trials per task per arm (72 trials), arms interleaved per task and trial (A, B, C, A, B, C …),
the model unloaded after every trial, one run, no resume except trials refused by the free-memory guard (no model ran).

* **Primary quality criterion (S2 intelligence improvement):** C final passes ≥ A final passes **+ 3** (of 24),
  **and** a one-sided exact sign test over the discordant (task, trial) slots, C vs A, gives p ≤ 0.10, **and** every
  invariant holds (pins, ordering, gate authority, no permission or leakage violation).
* **Secondary (memory/skill contribution):** the same test, C vs B.
* **Secondary (collaboration alone):** B vs A, same test. B is expected to match A on correctness; its claimed value is
  scheduling efficiency (latency, model loads), which is reported, not gated.
* Reported for every arm: first-attempt and final accuracy, by kind; median/P95 call latency and trial time; model
  calls; prompt and output tokens; model loads; peak free-RAM floor and memory waits; failure categories; repairs;
  Reviewer false approvals; Wilson 95 % intervals.
* If the primary criterion is not met, the result is reported as **functionally complete, intelligence improvement
  unproven**, whatever the direction of the difference.

### 1.5 Deterministic evaluation areas (no model; pass = every case)

Fixtures in `src/lib/bunny-host/ma4-s2.test.ts`: complex task planning (graph validity, cycles, bounds), multi-agent
handoff correctness (valid/invalid/tampered messages), memory retrieval quality (fixed corpus, precision@3 = 1.0 on the
fixed queries), incorrect-memory resistance (model-trust, untrusted, steering, expired, unverified, cross-project and
quarantined records never enter guidance), validated skill reuse (lifecycle, rollback, quarantine), tool permission
enforcement (skills cannot add tools or permissions), cancellation and restart safety (no duplicate irreversible
action after a crash), prompt-injection resistance (handoff and memory content stay data), resource bounds
(concurrency, model-call and tool budgets).

## 2. Results

All runs local (Ollama 0.40.6, pins as in §1.2), generated code only in the WSL2 sandbox, 0 external requests.
Evidence: `evidence/{discover,validate,qualify,heldout}.{json,log}` (per-trial calls, gate output, guidance hashes and
sources, final sources). Wilson 95 % intervals in brackets.

### 2.1 Discovery, validation, qualification (train and qualify splits only)

| Phase | Result |
|---|---|
| Discovery (B, train, 16 trials) | 9/16 passed (7 first attempt); strict 2/4, simple 1/2, intermediate 2/4, debugging 4/4, planning 0/2; 172 handoffs, 0 refused; 9 extractions → 6 candidates (3 rejected: duplicate name ×2, candidate cap ×1) |
| Sandbox validation (C, source task, skill alone) | 4/6 passed → SANDBOX_VALIDATED: `slugify`, `parse-date-procedure`, `calculate-median`, `compute-median`; rejected: `merge-intervals-procedure`, `parse-csv-line` |
| Benchmark qualification (qualify, 8 slots) | B 2/8, C 4/8 (2 wins, 0 losses, sign test p = 0.25); all 4 retrieved, none harmful on its slots → all 4 BENCHMARK_QUALIFIED. None approved or activated |

Observation recorded before the held-out run: the 7B extractor mostly restated the task-specific algorithm (two of the
four qualified skills are near-duplicate median procedures) rather than a transferable procedure.

### 2.2 Decisive held-out run (72 trials, 04:41–07:04 UTC, ledger `s2-heldout` completed 72/72, 0 resumes)

| | A (S1R4) | B (S2 collab) | C (S2 + skills + Lotus) |
|---|---|---|---|
| Final passes | **14/24** [0.39, 0.76] | **14/24** [0.39, 0.76] | **10/24** [0.24, 0.61] |
| First attempt | 11 | 11 | 7 |
| strict / intermediate / debugging / planning | 2/8, 4/6, 5/6, 3/4 | 3/8, 3/6, 6/6, 2/4 | 3/8, 3/6, 2/6, 2/4 |
| Repairs used / passes after repair | 20 / 3 | 21 / 3 | 26 / 3 |
| Model calls | 154 | 151 | 155 |
| Prompt / output tokens | 133,031 / 52,010 | 118,313 / 45,250 | 149,519 / 43,699 |
| Model loads / switches | 88 / 68 | 76 / 52 | 76 / 52 |
| Peak concurrent model calls | 2 | 1 | 1 |
| Call latency median / P95 | 17.7 s / 76.4 s | 14.2 s / 31.2 s | 14.1 s / 34.3 s |
| Trial time total | 52.5 min | 45.6 min | 45.1 min |
| Reviewer false approvals | 3 | 4 | 6 |
| Failure categories | impl 33, test_invalid 15, rev 3 | impl 35, test_invalid 5, rev 4 | impl 38, test_invalid 8, rev 6, dependency 2 |
| Handoffs (refused) | — | 272 (0) | 280 (0) |
| Invariants (pins, gate authority, no refused handoff) | hold | hold | hold |

Run-wide: minimum free RAM 8.32 GiB, 0 memory waits, 0 external requests refused (none attempted).

| Comparison (24 paired slots) | wins | losses | difference | one-sided sign test p |
|---|---|---|---|---|
| **C vs A (primary)** | 1 | 5 | **−4** | 0.98 |
| C vs B | 2 | 6 | −4 | 0.96 |
| B vs A | 4 | 4 | 0 | 0.64 |

Per task (trial 1, trial 2; P = pass): h-time24 A fP B Pf C fP · h-money ff ff ff · h-phone fP Pf fP · h-pairs ff fP fP ·
h-rpn PP Pf Pf · h-winmax PP PP PP · h-topo ff ff ff · h-rotate PP PP **ff** · h-palin PP PP PP · h-wavg fP PP **ff** ·
h-parking fP ff ff · h-ttlcache PP PP PP.

### 2.3 Verdict

**Primary criterion NOT met** (C − A = −4, needed ≥ +3; p = 0.98). Per §1.4 the S2 result is:
**functionally complete, intelligence improvement UNPROVEN.** The point estimate is in the wrong direction: arm C was
worse than both A and B on this sample. With 24 slots the intervals overlap heavily and the C-vs-A difference is not
statistically significant in either direction (two-sided sign test on 1 vs 5 discordant slots, p ≈ 0.22), so the
honest reading is "no evidence of improvement, weak evidence of harm".

B vs A: identical correctness (14/24, 4 wins / 4 losses), as pre-registered as the expectation. B's measured value is
efficiency: −14 % model loads, −24 % model switches, peak concurrency 1 instead of 2 on the 6 GiB GPU, call-latency
P95 31 s vs 76 s, 13 % less trial time.

### 2.4 Why C underperformed (post-hoc analysis — explanatory only, not used to change any result)

* **Irrelevant retrieval.** `selectSkills` admits a skill when it shares **one** coarse task tag with the task
  (e.g. `numeric`, `collections`). The two median procedures were attached to 22 of 24 held-out C trials and
  `parse-date-procedure` to 22 of 24, including matrix rotation, topological sort and weighted average. The advisory
  block (~700 characters) therefore described an unrelated algorithm in most trials.
* **Cost of that noise:** +26 % prompt tokens vs B, first-attempt passes 7 vs 11, debugging 2/6 vs 6/6, 2
  `dependency_violation` failures (only in C), Reviewer false approvals 6 vs 4.
* **Weak qualification signal.** Qualification (+2 on 8 slots, p = 0.25) was too small to distinguish a useful skill
  from a harmless one; the rule "C ≥ B on retrieved slots" admitted all four. The extracted skills were near-copies of
  train-task algorithms, not procedures.
* What would need to change (future work, a new pre-registration, new held-out tasks — this held-out set is now
  spent for tuning): retrieval relevance threshold (≥ 2 specific tags or an explicit applicability predicate, abstain
  otherwise), duplicate merging by content, a larger qualification split with a minimum effect, and an extractor
  prompt that forbids task-specific algorithms. None of this was done or tried in S2.

## 3. Deviations from the pre-registration

1. **Harness `validation` use mode (before any qualification or held-out trial).** §1.3 step 3 re-runs a CANDIDATE skill on its source task, but the product rule only lets SANDBOX_VALIDATED or better skills be retrieved. A `validation` mode was added so a candidate is usable during its own gating run (and only then). It does not change any criterion.
2. **Run-ledger node cap 64 → 128 (before any held-out trial ran).** The first held-out start was refused by `TeamRuns.create` ("more than 64 nodes": 72 trials) before any model call. The cap was raised to 128 (commit 65daf5f), the stale log deleted and the run restarted once. No trial result existed or was discarded.
3. No other deviation: tasks, arms, pins, budgets, criteria and the held-out split are as pre-registered; no held-out trial was re-run; nothing was tuned after results were observed.
