# MA4-S1R3 fault-aware agent repair — R3-G2 … R3-G5

Implementation: `src/lib/bunny-host/ma4/coding-workflow.server.ts`. Tests: `src/lib/bunny-host/ma4-repair.test.ts` (9) and `ma4-workflow.test.ts` (6), all passing on the live WSL2 sandbox.

## Lifecycle

```text
Planner ─► host check of the plan (dependencies ⊆ allowed imports) ─► frozen Task Contract (hash = contractVersion)
   │ plan_invalid / schema_error → Planner repair (shares the budget)
   ▼
Worker ∥ Tester (concurrent, both see only the contract)
   ▼
schema validation per artifact ── malformed → producer repair; nothing is executed
   ▼
static validation in the sandbox (per file: source / tests) + import smoke test
   ▼
independent acceptance suite (hidden)   Tester tests vs implementation   Tester tests vs frozen reference (oracle, cached per test hash)
   ▼
attributeAttempt() — pure, deterministic ─► FailureRecord[] ─► targets ⊆ {Planner, Worker, Tester}
   ▼
targeted repair (targets in parallel, one round) ─► retest … (≤ 2 rounds per trial, shared)
   ▼
Reviewer (advisory) ─► deterministic gate (sole authority) ─► passed / failed
```

## Attribution rules (`attributeAttempt`)

| Evidence | Category | Component | Confidence |
|---|---|---|---|
| source syntax / import-time code / wrong file list | `implementation_invalid` | Worker | verified |
| disallowed import or declared dependency in source | `dependency_violation` | Worker | verified |
| test-file syntax / disallowed import in tests | `test_invalid` | Tester | verified |
| independent acceptance suite fails | `implementation_defect` | Worker | verified |
| failing generated test that **passes on the frozen reference** | `implementation_defect` | Worker | verified |
| failing generated test that **also fails on the frozen reference** (all-pass rule) | `test_invalid` | Tester | verified |
| no generated test passes on the reference (reference-validated rule) / no tests at all | `test_invalid` | Tester | verified |
| tests load on the reference but not on the implementation | `implementation_defect` | Worker | verified |
| tests fail to load even on the reference | `test_invalid` | Tester | verified |
| test fails, acceptance passes, **no oracle exists** | `ambiguous` | none → `diagnose` | ambiguous |
| test fails, acceptance fails, no oracle | `implementation_defect` | Worker | supported |
| Planner dependency outside the allowed imports | `plan_invalid` | Planner | verified |
| artifact not JSON / fails its strict schema | `schema_error` | producer | verified |
| model timeout | `timeout` | infrastructure (stop) | verified |
| model/capability unavailable | `unsupported_capability` | router (stop) | verified |
| served model ≠ pin | `pin_violation` | router (stop) | verified |
| sandbox failure | `sandbox_failure` | infrastructure (stop, no code repair) | verified |
| Reviewer approves a gate failure | `reviewer_false_approval` | Reviewer → `block_approval` | verified |

A test is never blamed on the Tester merely because it failed. Only failures that block acceptance are attributed. Under the reference-validated rule, invalid tests are not counted, so they block nothing unless no valid test remains.

`FailureRecord` = `{ taskId, attempt, failingStage, failureCategory, suspectedComponent, evidence[], confidence, recommendedAction, retryBudgetRemaining }` (camelCase, consistent with the repository).

## Repair inputs (information boundaries)

* **Worker:** contract, its own static errors, failing tests attributed to it with their messages, the note "an independent acceptance suite also failed (details withheld)", and its previous source. It never receives invalid tests, hidden tests or the reference.
* **Tester:** contract, its own static errors, and, for each invalid test, *its own failing line and exception type* (`line 10: self.assertEqual(clamp(9, 0, 3), 9) (AssertionError)`). It never receives the reference's values, the implementation or hidden tests (asserted in `ma4-repair.test.ts`).
* **Planner:** the rejected dependency list and the allowed imports.
* A valid test is never rewritten to fit wrong code. Tester repair happens only on oracle-proven invalidity.

## Budget and logging

* `maxRepairs` is clamped to ≤ 2 **rounds** per trial (the frozen G7 contract's limit). Every agent draws from it, and one round may repair the Worker and the Tester in parallel.
* Each round is logged as `RepairRecord { round, target, categories, evidence, outcome: resolved | unresolved | not_retested }`. The outcome is settled from the next evaluation.
* When the budget is exhausted, the run stops cleanly. A malformed final artifact ends as `malformed_artifact`; otherwise the result is `failed`, with the stage named. An ambiguous-only failure stops without a blind repair.

## Artifact integrity (B2)

Every model reply is recorded as `ArtifactRecord { taskId, producer, model (served), contractVersion, attempt, sha256, bytes, validation: valid | malformed, createdAt }`. Artifacts are strict zod schemas: unknown keys such as `model_override` are rejected, and declared dependencies must match `^[A-Za-z_][A-Za-z0-9_.]{0,59}$`, enforced at decode time through Ollama's JSON-Schema `pattern`. Pins come only from the caller, so no artifact can change routing, pins or policy.

## Reviewer independence (B3)

The Reviewer runs last and is advisory. `status` equals the deterministic gate. A false approval is recorded as `reviewer_false_approval` with `block_approval`. A malformed review fails closed, because a missing review is missing evidence. The Reviewer cannot override failed tests, sandbox violations, exhausted budgets or missing evidence; all of these are already gate failures.

## Behaviour change versus S1R2 (recorded separately from harness changes)

| Area | S1R2 | S1R3 |
|---|---|---|
| Repair target | always the Worker | the attributed component(s) |
| Malformed artifact | immediate `malformed_artifact` | producer repair within the budget; still never executed |
| Planner | advisory text, never checked | dependencies checked against host facts; repairable |
| Tester tests vs reference | only under the reference-validated rule | whenever a reference exists (for attribution only; the counting rule is unchanged) |
| Worker feedback in all-pass mode | every failing test | only tests proven valid |
| Declared dependencies | free text, checked after generation | module names constrained at decode time |

Harness changes (G7 output path, extra recorded fields) are listed in G7_REGRESSION_RESULTS.md.
