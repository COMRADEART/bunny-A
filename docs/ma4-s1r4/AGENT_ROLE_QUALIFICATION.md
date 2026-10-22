# MA4-S1R4 — Agent role qualification (Phase B4/C, R4-G4)

## Method

`scripts/ma4-s1r4/role-evidence.mjs` turns recorded development trials into per-model, per-role verified outcomes
(the deterministic gate's evidence, never a model's self-report):

| Role | A trial counts as a success when |
|---|---|
| Worker | the final implementation passed the independent acceptance tests |
| Tester | no Tester fault was attributed in any attempt and its tests ran against the implementation |
| Planner | no Planner contract or schema fault was attributed |
| Reviewer | its verdict agreed with the deterministic gate (no false approval, no false rejection) |

Infrastructure outcomes (model errors, sandbox errors) are excluded. `assignRole()` (`ma4/hybrid.ts`) then decides per
role: explicit pin (never substituted) → eligibility (hard; decided upstream) → 95 % Wilson lower bound in that role
(soft; fewer than 3 samples = UNPROVEN, no bonus) → caller order (local-first) on ties → for high-risk work, **abstain**
unless the best lower bound ≥ 50 %.

## Evidence (paired runs, same strategy v3b, same 20 development trials; `evidence/role-evidence-v3b.json`)

| Role | coder 7B | abliterate 7B | Assigned | Lower bound |
|---|---|---|---|---|
| Planner | 20/20 | 20/20 | coder (tie → order) | 0.84 |
| Worker | 13/20 | 13/20 | coder (tie → order) | 0.43 |
| Tester | 15/19 | 16/20 | **abliterate** | 0.58 |
| Reviewer | 18/20 | 14/20 | coder | 0.70 |

## Interpretation

* Role assignments follow measured evidence, not size or name; but **no difference is statistically significant**
  at n = 20 (overlapping intervals). The assignment is a policy decision on the best available evidence.
* **Worker lower bound 0.43 < 0.50**: for high-risk coding work `assignRole(..., { highRisk: true })` **abstains**
  for the Worker role — Bunny A should report that no authorized local model has demonstrated reliable unattended
  implementation, rather than present unverified code as done.
* A single successful response never qualifies a model: every row is ≥ 19 recorded trials.
* Pins: G7 and development runs record served model = pin on every call (G7 invariant `pinsHeld`).
