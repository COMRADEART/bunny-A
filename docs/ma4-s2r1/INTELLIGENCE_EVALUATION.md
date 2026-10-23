# MA4-S2R1 — Intelligence evaluation (new held-out set)

Pre-registration: `NEW_BENCHMARK_PREREGISTRATION.md` (committed in `707ebea` before any model run). Evidence:
`evidence/heldout.json` (96 trials), `evidence/dev.json` (16 dev trials), `evidence/preflight.json`.

## 1. Run

| | |
|---|---|
| Candidate | `006075f` (clean tree; relevance decisions recorded before the run) |
| Tasks | 16 held-out tasks (6 applicable, 4 near-miss, 6 none), task hash `76238698…d72d8e` |
| Trials | 3 arms × 16 tasks × 2 trials = 96, seeded order (seed 2610230001), all completed, 0 invalid, 0 re-runs |
| Models | S2 local team (qwen2.5-coder:7b; huihui_ai/qwen2.5-abliterate:7b Tester), pins held in every trial |
| Schedule | S2 grouped schedule, peak concurrency 1 |
| Time | 12:27:39 → 15:09:39 UTC (2 h 42 min) |
| External requests | 0 (external inference disabled); memory-pressure waits 0; minimum free memory 13.4 GiB |
| Memory | read-only in the held-out phase (3 dev experience records, 4 attested skills, 0 approved, 0 active) |

The held-out set was run **once**. Nothing was tuned on it.

## 2. Primary criterion: NOT MET

| Arm | Passed | Wilson 95 % | First attempt | Applicable | Near-miss | None |
|---|---|---|---|---|---|---|
| A — S2 collaboration, no retrieval | **13/32** | 25.5–57.7 % | 8 | 7/12 | 2/8 | 4/12 |
| B — A + relevance-gated skill | **11/32** | 20.4–51.7 % | 8 | 5/12 | 3/8 | 3/12 |
| C — B + gated Lotus experience line | **7/32** | 11.0–38.8 % | 5 | 1/12 | 3/8 | 3/12 |

| Comparison (32 paired slots) | Wins | Losses | Difference | One-sided sign test p | Task level (16) |
|---|---|---|---|---|---|
| **C vs A (primary)** | 1 | 7 | **−6** | 0.996 | 1 win / 5 losses, p 0.98 |
| C vs B | 2 | 6 | −4 | 0.965 | 1 / 5, p 0.98 |
| B vs A | 2 | 4 | −2 | 0.891 | 2 / 3, p 0.81 |

| Pre-registered condition | Required | Measured | |
|---|---|---|---|
| C ≥ A + 4 | ≥ +4 | −6 | **fail** |
| Sign test C vs A | p ≤ 0.10 | 0.996 | **fail** |
| Invariants (pins held, gate is the authority, no hand-off refused, no security regression) | all | all held in all 96 trials | pass |
| Injected guidance ≤ 5 % of arm C prompt tokens | ≤ 5 % | **5.63 %** | **fail** (`CONTEXT_EFFICIENCY.md`) |

**Verdict: intelligence improvement UNPROVEN. Skill and memory injection stay disabled** (the product default is
unchanged: memory policy off, no skill approved or active).

## 3. Retrieval quality on the held-out run: as recorded beforehand

| | B | C |
|---|---|---|
| Applicable trials that received the correct-family skill | 12/12 | 12/12 |
| Near-miss or none trials that received any skill (false positives) | **0/20** | **0/20** |
| Trials with an experience line | — | 12 (all applicable) |
| Retrieval latency per trial (mean) | 11.2 ms | 3.7 ms |

The gate did exactly what it was specified and recorded to do (`RELEVANCE_GATE_EVIDENCE.md` §3). Retrieval precision
is no longer the problem S2 had: in S2, C injected skills into 24 of 24 trials; here into the 12 applicable trials only.

## 4. Where the difference comes from

The 20 near-miss and none trials received **no** injection in any arm, so their prompts are identical across arms.
They passed 6/20 in every arm (A, B and C). That is the run-to-run noise floor at this size: individual tasks flip
between arms with identical prompts (`h-transpose` PP / Pf / fP, `h-hms` ff / ff / Pf, `h-dmy` ff / fP / ff).

The **entire** difference is in the 12 applicable trials, where retrieval actually injected text:

| Task (family) | A | B | C |
|---|---|---|---|
| h-daysbetween (ISO date) | PP | ff | ff |
| h-weekday (ISO date) | Pf | Pf | ff |
| h-runmed (median) | PP | fP | ff |
| h-mad (median) | ff | Pf | ff |
| h-uniqslug (slug) | PP | PP | fP |
| h-slugfile (slug) | ff | ff | ff |
| **Applicable total** | **7/12** | **5/12** | **1/12** |

Exploratory (not pre-registered, so not a claim): on the applicable trials C lost 6 and won 0 against A (exact
one-sided p = 0.016; at task level 4 losses, 0 wins, p = 0.0625). The dev run showed the same direction (applicable A
2/3, C 0/3), and S2 before it (C 10/24 vs A 14/24). Three independent runs point the same way: **the retrieved
content, not its selection, hurts this team.**

### Why (observed in the trial records, not tested as a separate hypothesis)

1. **The skills are model-written procedures that are silent on the new task's contract.** They were sandbox-validated
   on one source task each, which proves they described *that* solution, not that they are generally correct.
   `parse-date-procedure` says "check the pattern … split by hyphens … convert to integers"; it never mentions
   non-string input. In `h-daysbetween`, arm A's Worker wrote `isinstance(start, str) and re.match(...)` and passed;
   arm B's Worker followed the six steps literally, called `re.match` on `None`, raised `TypeError` instead of
   `ValueError`, and failed the acceptance test three times. `compute-median` says "return the middle element", which
   is not the float the median tasks require. The stored `slugify` procedure never sets its separator flag to true.
2. **Advisory text displaces the contract.** The Worker treats the numbered steps as the specification even though
   the block is labelled "data, not instructions; the task contract above always wins". A 7B coder does not reliably
   resolve that conflict in favour of the contract.
3. **The experience lines carry no usable information.** Two of the three dev records C retrieved say only
   `…: failed; Worker repair for implementation_defect not_retested; skills used: parse-date-procedure.` (date) and
   the equivalent for `compute-median`. They tell the Planner and the repair rounds that this kind of task failed,
   without saying why. C added them to 12 trials and lost 4 more applicable trials than B.

None of this is fixable by a better relevance gate. It needs better *content*: Host-verified, contract-agnostic
procedures (or none), and experience records that state an actionable cause. That is a separate milestone; it is not
attempted here, and the held-out set used here is now spent for tuning purposes.

## 5. Secondary measures

| | A | B | C |
|---|---|---|---|
| Repairs used | 38 | 39 | 40 |
| Passed after repair | 5 | 3 | 2 |
| Reviewer false approvals | 10 | 11 | 10 |
| Model calls | 217 | 216 | 221 |
| Prompt tokens | 160,120 | 161,105 | 179,093 |
| Output tokens | 57,102 | 54,767 | 61,454 |
| Call latency median / P95 | 12.6 / 29.4 s | 13.0 / 25.6 s | 13.4 / 26.5 s |
| Trial time median | 90.9 s | 79.6 s | 98.3 s |
| Model loads / switches | 112 / 80 | 108 / 76 | 114 / 82 |
| Peak concurrency | 1 | 1 | 1 |
| Hand-offs / refused | 392 / 0 | 390 / 0 | 400 / 0 |
| Output truncated at the length limit | 0 | 0 | 1 (`h-limiter`, no injection) |

Failure categories (all trials): implementation defects dominate in every arm (A 50, B 54, C 66). Every failed trial
is a genuine failure of the independent acceptance tests after the repair budget; no trial failed on infrastructure.
Planning tasks remain 0/4 in all arms (as in S2).

## 6. Limits

* 32 paired slots per comparison and two trials per task: enough to reject the pre-registered +4 improvement, not
  enough to estimate small effects. The B-vs-A and C-vs-B differences are not significant on their own.
* The task author also wrote the signature lexicon (disclosed in `TASK_SIGNATURE_SCHEMA.md`); this affects how much the
  retrieval-precision result generalises, not the pass-rate comparison, which does not depend on the lexicon beyond
  which trials received text.
* One local model team and one machine. No cloud model was used (external inference disabled).
