# MA4-S2R1 — Why S2 retrieval hurt: root cause

Source: the S2 decisive held-out evidence (`docs/ma4-s2/evidence/heldout.json`, unchanged) and the S2 code at
`b5271b1`. This is an explanation of a recorded result; it does not change it (S2: A 14/24, B 14/24, C 10/24).

## 1. What arm C actually injected

| Measure (S2 held-out, arm C, 24 trials) | Value |
|---|---|
| Trials with at least one skill injected | **24 / 24** |
| `parse-date-procedure` | 22 trials |
| `calculate-median` | 22 trials |
| `compute-median` (a near-duplicate of `calculate-median`) | 22 trials |
| `slugify` | 2 trials |
| Guidance records (role × phase) | 101, mean **939 characters** each |
| Held-out tasks for which any injected skill was the right procedure | **0 of 12** |

Per task: every one of the 12 held-out tasks (24-hour time, money, phone, pairs, RPN, sliding max, topological
order, rotation, palindrome, weighted average, parking lot, TTL cache) received a date-parsing procedure and/or two
median procedures. None of these tasks parses an ISO date, computes a median or builds a slug.

## 2. Mechanism

`selectSkills` (removed in S2R1) kept a skill when

```
shared coarse tags ≥ 1   and   (attempt phase  or  a failure category matches  or  shared tags ≥ 2)
```

over eight Host tags (`strict-parsing`, `validation-errors`, `string-processing`, `collections`, `algorithm`,
`debugging`, `stateful-class`, `numeric`). Those tags are properties of almost every function-level task:
`numeric` fires on "numbers", "digits", "seconds", "cents" or "sum"; `validation-errors` on any "raises
ValueError"; `algorithm` on "order", "sort", "window", "merge" or "rotat". The qualified skills carried exactly such
tags (`parse-date-procedure`: string-processing, validation-errors, numeric; the median pair: algorithm,
validation-errors). Any task mentioning numbers and an error case matched both families. Up to three skills were
shown, so near-duplicates were not merged either.

Contributing factors, all from S2's own analysis:

* **No notion of what a skill does.** A skill had no operation, input type or format, so a tag match was the only
  signal. "Shares a tag" meant "shares a property of most tasks".
* **No abstention.** The ranking always returned the top three that shared a tag; there was no threshold and no "no
  skill" outcome short of zero shared tags.
* **Weak qualification signal.** Qualification (+2 of 8 slots, p = 0.25) could not tell useful from harmless, and the
  qualify trials had the same over-broad retrieval, so "retrieved and not harmful" admitted all four skills.
* **Cost.** +26 % prompt tokens vs B; first-attempt passes 7 vs 11; debugging 2/6 vs 6/6; 2 `dependency_violation`
  failures only in C.

## 3. What S2R1 changes (and the same S2 tasks under the new gate)

* A skill must carry a Host-attested **applicability contract** (operation, input type, format, category family)
  taken from the signature of the task it was sandbox-validated on. No contract → never eligible.
* The task gets a typed **signature** from its contract; the hard filters compare the two. Sharing a coarse property
  (numbers, an error case) is no longer a match.
* Ranking only orders candidates that passed every hard filter; a threshold, at most one skill, and an empty result
  is a normal outcome.

Development regression (deterministic, no model; `evidence/relevance-s2-regressions.json`): over all 24 S2 tasks
the gate selects a skill for exactly the three source tasks of the qualified skills (`tr-isodate`, `tr-slug`,
`tr-median`) and for **none** of the 21 others, including all 12 S2 held-out tasks. Those tasks were already
diagnosed, so this is a regression check, not new evidence of quality; the decisive comparison uses the new
held-out set (`NEW_BENCHMARK_PREREGISTRATION.md`).
