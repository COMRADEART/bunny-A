# MA4-S1R4 — Adaptive task intelligence (Phase A, R4-G2)

## Principle

A 7B model is not asked to be smarter. It is asked for smaller, independently verifiable things, and deterministic
tools decide what is correct. Effort is spent where the contract is strict; agents are not multiplied.

## Task profile (`ma4/task-intelligence.ts` `profileCodingTask`)

Deterministic, from host task facts only (spec text, module, allowed imports, acceptance rule) — never from model output.

| Field | Source |
|---|---|
| `category` coding / debugging / planning | spec wording ("fix it", "Plan and implement") |
| `complexity` low / medium / high | strict acceptance (every generated test must pass), `analyzeModelTask` complexity, number of stated error conditions, spec length |
| `capabilities` | code generation, test generation, structured output, review (all four roles) |
| `tools` | `static_check`, `import_smoke`, `run_tests` (orchestrator only) |
| `sensitivity` | `local-only` (coding tasks never leave the workstation in S1R4) |
| `artifacts` / `acceptance` | `<module>.py`, `test_generated.py`; static validation, hidden acceptance, the Tester rule |
| `budgets` | `maxRepairs` (≤ 2, never raised), `maxAgents` 4, `maxModelCalls`, `maxToolCalls` |

The user's requirements are immutable: the frozen contract object is built from the task spec and is never rewritten by
the profile, the Planner, the Tester or a repair.

## Task graph (`buildTaskGraph`, `validateGraph`)

```text
plan (Planner)
  ├─► implement (Worker × k samples) ─┐
  └─► test (Tester) ──────────────────┤
                                      ▼
                          select (orchestrator, k > 1)      ranks samples by the Tester's own tests
                                      ▼
                          verify (orchestrator)             static → hidden acceptance → generated tests (+ oracle)
                                      ▼
                          diagnose (orchestrator)           deterministic fault attribution
                                 ┌────┴────┐
                     repair (≤ 2 rounds)   review (Reviewer, advisory)
                     → back to verify
```

* Typed nodes (`plan|implement|test|select|verify|diagnose|repair|review`), explicit dependencies.
* Validation: unique ids, every dependency exists, **no cycles** (DFS), ≤ 12 nodes, ≤ 4 distinct agents. An invalid
  graph throws before any model call. The repair loop is bounded by the shared budget, not by unrolling the graph.
* `k` (Worker samples) = 1 / 2 / 3 for low / medium / high complexity. Samples are not agents: same role, same pin, same
  contract, different sampling temperature (first sample 0.2, others 0.8).
* Cancellation: one `AbortSignal` reaches every model call and sandbox run (unchanged S1R3 behaviour; G7 cancellation
  invariant re-measured).
* Pins: the caller's pins are frozen before the first call; artifacts can never change them.

## Strategy v3 (`STRATEGY_S1R4`), opt-in; `STRATEGY_S1R3` stays the default

| Change | Why (evidence) |
|---|---|
| **Fenced code transport** for Worker and Tester: the reply is a fenced code block, not a JSON string; Planner and Reviewer keep JSON-schema decoding | S1R3 run 2: code inside JSON produced `unterminated string literal` and "artifact is not JSON" failures in ≥ 5 of 10 failing trials (ARCHITECTURE_AUDIT) |
| **Checklist before code**: initial replies first list required behaviours / invalid inputs; repairs first state what the failing checks show is wrong | dev set: `dv-size` samples misread two-letter units; with the checklist 2/3 dev trials passed vs 0/2 (smoke, dev only) |
| **Verified sampling**: k independent Worker samples ranked by the Tester's own tests | a correct sample is often present among k; the orchestrator, not the model, picks it — with test evidence |
| **Per-role sampling**: 0.2 for Planner/Worker/Tester/Reviewer, 0.8 for extra samples, 0.6 for repairs, larger output budget for Tester/repairs | S1R3 used Ollama's default (≈ 0.7–0.8) everywhere; repairs at 0.3 returned the previous code byte-for-byte (dev smoke) |
| **Unproductive repair stop**: a repair returning the identical artifact ends the loop (recorded with both hashes) | mission D: stop on repeated or unproductive repairs |
| **Tester prompt**: test only behaviour the contract states; no invented edge cases | all-pass rule: one invented expectation fails a correct implementation |

No change touches the G7 tasks, hidden tests, references, scoring, trial counts or threshold.

## Measurement

See the *Results* section appended after the development comparison (S1R3 vs S1R4 k=adaptive vs S1R4 k=1, identical
frozen development tasks, same pin, same sandbox, same runner).
