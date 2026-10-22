# MA4-S1R3 G7 failure analysis (S1R2 evidence, read per attempt)

Source: `docs/ma4-s1r2/evidence/g7.json` (23 trials, unaltered). The S1R2 report summarized failures per trial. Reading each attempt shows which repairs were spent on the wrong component.

## Repairs spent on a component that was not at fault

| Trial | Attempt | Evidence | Actual fault | S1R2 repaired | Consequence |
|---|---|---|---|---|---|
| v2 t2 | 2 | hidden acceptance **passed**; Tester `test_edge_cases` expects `ValueError` the frozen reference does not raise | **Tester** (test contradicts the contract) | Worker (budget exhausted) | trial failed with correct code (all-pass rule) |
| p2-bucket t2 | 1, 2 | `tests: import of 'time' is not allowed` (Tester), hidden run on Worker code | **Tester** (policy violation in tests) | Worker ×2 | the Worker cannot change the Tester's import; both repairs wasted |
| s2-chunk t1 | 0, 1, 2 | hidden acceptance **passed** every attempt; the Tester's only test is invalid against the reference (0 valid) | **Tester** | Worker ×2 with **empty feedback** | correct code failed for lack of a valid test |
| v2 t1, v2 t2 | 0 | `declared dependency 're (regular expression module)' is not allowed` | **schema/format** (prose in a module-name list); the actual imports were fine | Worker | one of two repairs spent on metadata wording |
| v2 t2 | 2 (feedback) | in all-pass mode the Worker's feedback included failing **invalid** tests | Tester | Worker told to satisfy a wrong test | misleading repair signal |

## Failures correctly attributed to the Worker (model quality)

v2 t1 and t3 (hidden acceptance failed after 2 repairs; strict ordered-unit parsing), d1-flatten ×2 (recursion fix never produced), p2-bucket t1 (stateful design). These are model-capability failures. Routing cannot fix them. A stronger model can.

## Reviewer

1 false approval (d1-flatten t1), overridden by the deterministic gate. 1 false rejection (i2-kv t1), advisory only. The gate behaved correctly.

## Root cause of the repair defect

The S1R2 loop had one repair target, the Worker, and one feedback channel, which mixed static errors from both files with every failing counted test. It had no attribution step. So a Tester fault (invalid test, policy violation, zero valid tests) and a metadata-format fault could only be "repaired" by re-generating the implementation.

## Consequences for S1R3 (implemented, see AGENT_REPAIR_DESIGN.md)

1. Attribute every blocking failure from deterministic evidence: static errors by file, the independent acceptance suite, and Tester tests run against the frozen reference (the oracle).
2. Repair only the attributed component. Repair the Worker and the Tester in the same round when both are at fault.
3. Never feed invalid tests to the Worker, and never show the Tester the implementation, the reference or reference values.
4. Constrain declared dependencies to module names at decode time. Ollama honours the JSON-Schema `pattern`: prose dependencies went from 3/3 without the pattern to 0/3 with it (`evidence/pattern-probe.log`, script `evidence/pattern-probe.mjs`).
5. Keep the cap of two repair rounds per trial. Do not change any task, rule or threshold.
