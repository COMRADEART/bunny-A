# MA4-S2R1 — Relevance gate evidence (R1-G2 … R1-G5)

## 1. Broad-tag-only selection eliminated (R1-G2)

`selectSkills` and `renderGuidance` are deleted from `ma4/skills.ts`; no code path selects a skill from Host tags.
`taskTags` survives only as descriptive text in experience records. The S2 test that asserted tag-based selection
was replaced by `S2R1 (replaces S2 tag selection): one shared coarse tag no longer selects a skill`, which offers the
S2 fixture skill to a task sharing its `strict-parsing` tag and asserts **no selection**, with the reason
`missing applicability metadata`.

## 2. Weights and threshold: how they were set

* **Weights** (`WEIGHTS` in `relevance.ts`) were written with the code, before any dev result: operation 2/match,
  exact format 2, output 1, domain 1, evidence 0.5/record (max 3), success 0.5/use (max 3), failure −1/use (max 3),
  cost −1 per 400 excerpt characters.
* **Threshold** was a placeholder of 4 at first; on the dev split it rejected two correct matches (median 3.22/3.33,
  slug 3.14) while no incorrect candidate had passed the hard filters. It was set to **3** from the dev scores (lowest
  correct eligible score 3.14). It now only removes eligible skills with weak evidence, a costly excerpt or recorded
  failures.
* **Excerpt budget** 400 → 320 characters after the dev model run measured 4.92 % injected-token share against the
  5 % gate (`CONTEXT_EFFICIENCY.md`).
* Nothing else changed after the dev run. The candidate was frozen at `f282951`; its held-out decisions were recorded
  in `006075f` before the held-out run, and the run started on `006075f` with a clean tree.

## 3. Deterministic retrieval quality (no model; all 9 S2 skills offered to every task)

| Set | Tasks | TP | FN | **FP** | TN | No-skill decisions |
|---|---|---|---|---|---|---|
| S2 tasks (development regressions) | 24 | 3 | 0 | **0** | 21 | 21 |
| S2R1 dev | 8 | 3 | 0 | **0** | 5 | 5 |
| S2R1 held-out (frozen candidate, recorded once) | 16 | 6 | 0 | **0** | 10 | 10 |

Held-out per task (`evidence/relevance-heldout.json`): the two ISO-date tasks get `parse-date-procedure` (score
5.24), the two median tasks `compute-median` (3.33, preferred over the near-duplicate `calculate-median` 3.22), the
two slug tasks `slugify` (3.43); all four near-misses and all six none tasks get nothing.

Why each candidate was rejected (counts per task are the same pattern across splits):

| Reason | Skills it removes |
|---|---|
| `missing applicability metadata` | the 5 rejected S2 skills (never sandbox-validated: no attestation possible) |
| `operation X not required by the task` | the attested skills on every task that does not need their operation (incl. `h-hms`, `h-mostfreq`, `h-snake`) |
| `precondition formats ∋ YYYY-MM-DD not satisfied` | the ISO-date skill on `h-dmy` (`DD.MM.YYYY`) |
| `category plan not in implement/debug` | all four attested skills on the planning tasks |

No eligible candidate was ever rejected by the threshold on these sets, and no score ever had to break a tie between
different families.

**Interpretation limit.** Retrieval precision here is measured against labels written by the same engineer who wrote
the lexicon (`TASK_SIGNATURE_SCHEMA.md`), with a corpus of only four attested skills in three families. It shows the
gate does what it is specified to do; it is not evidence that the lexicon generalises to unseen task wording.

## 4. No-skill fallback (R1-G5)

* Deterministic: `S2R1 no-skill fallback` runs the real workflow with a task no skill fits; the decision is
  `selected: null` (1 inspected, 1 rejected), the run passes, no guidance is recorded, and every prompt is
  byte-identical to the run without retrieval.
* Model runs: in the dev run 4 of 8 C trials had zero injection; their prompts equal arm A's.

## 5. Model-run retrieval behaviour

Dev run (A/C, 8 tasks): C injected a skill in exactly the 3 applicable trials, always the correct family. The one
experience line on a non-applicable task (`d-mean`) was the record written by the same task's own A trial minutes
earlier (signature `mean`). That is a dev-only artifact of running two arms of one task with memory writes on; held-out
memory is read-only and holds only dev records.

Held-out run (96 trials): B and C injected the correct-family skill in 12 of 12 applicable trials and nothing in any of
the 20 near-miss or none trials, matching the decisions recorded before the run. Pass rates:
`INTELLIGENCE_EVALUATION.md`.
