# MA4-S1R4 — Evidence-guided repair 2.0 (Phase D, R4-G5)

## What changed (on top of S1R3 fault attribution)

| Mission requirement | Implementation |
|---|---|
| Planner contract error | `plan_invalid` → Planner repair (unchanged) |
| Worker implementation defect | `implementation_defect` / `implementation_invalid` / `dependency_violation` → Worker repair (unchanged) |
| Tester syntax vs semantic defect | `test_invalid` now carries `defect: "syntax" \| "policy" \| "semantic"` |
| Schema violation | `schema_error` → producer repair (unchanged) |
| Missing capability | `unsupported_capability` → router (unchanged) |
| Sandbox / runtime failure | `sandbox_failure` → infrastructure, never model code (unchanged) |
| **Tool execution failure** | **new** `tool_failure`: broker denial or tool error, terminal, infrastructure |
| Timeout | `timeout` → infrastructure (unchanged) |
| **Resource exhaustion** | **new** `resource_exhaustion`: tool or model-call budget exhausted, terminal |
| Ambiguous | diagnosis only, no blind repair (unchanged) |
| Reviewer false approval | recorded and blocked by the deterministic gate (unchanged) |

Repair records now carry `previousSha256`, `proposedSha256`, `proposal` (`valid` / `malformed` / `identical`) and
`remaining`. **An identical proposal stops the loop** (fenced strategies): it cannot change the outcome. The repair budget
is still ≤ 2 rounds per trial, shared by every agent and managed by the orchestrator; models cannot request retries.
A valid test that exposes a Worker defect is never removed or rewritten: Tester repairs are only ever triggered by
oracle-proven invalid tests, and the Worker never sees invalid tests (S1R3 rule, re-tested in `ma4-repair.test.ts`).

## Measured on identical development tasks (20 trials each, `evidence/dev-*.json`)

| Run | Pin | Final | 1st attempt | Passed after repair | Repair rounds (target:proposal:outcome) | schema_error | Reviewer false approvals (all blocked) |
|---|---|---|---|---|---|---|---|
| S1R3 workflow | coder 7B | 11 | 10 | 1 | 27: Worker 15 (2 resolved), Tester 12 (4 resolved, 3 malformed) | **5** | 1 |
| S1R4 v3 | coder 7B | 11 | 8 | 3 | 21: Worker 18 (3 resolved, 6 identical), Tester 3 (1 resolved) | **0** | 0 |
| S1R4 v3b | coder 7B | 11 | 9 | 2 | 24: Worker 15 (2 resolved, 5 identical), Tester 9 (2 resolved, 3 identical) | **0** | 2 |
| S1R4 v3b | abliterate 7B | 12 | 9 | 3 | 23: Worker 15 (2 resolved, 3 identical), Tester 8 (1 resolved) | **0** | 6 |

Findings:

1. **The JSON transport failure class is gone** (5 schema errors → 0; the S1R3 "Tester artifact is not JSON" and
   "unterminated string literal" failures do not occur under the fenced transport).
2. **Repair does not measurably improve final correctness on 7B models.** Worker repairs resolve 2–3 of ~15 rounds; a
   third to a half of Worker repair proposals are byte-identical to the previous artifact, now detected and stopped
   instead of re-tested. First-pass → final gains are +1 to +3 trials per 20.
3. Tester repairs resolve 1–4 per run; Tester semantic defects (invented or miscomputed expectations) remain the
   dominant Tester fault (7–8 per run).
4. Reviewer false approvals (up to 6 per run for abliterate) were **all blocked** by the deterministic gate; no
   trial was accepted on a Reviewer verdict.

G7 repair outcomes: see G7_FROZEN_RESULTS.
