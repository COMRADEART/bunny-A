# MA4-S2 — Skill promotion policy

Pre-registered in `INTELLIGENCE_EVALUATION.md` §1.3 before any skill existed. Summary:

1. **Discovery** only from trials the deterministic gate PASSED, only on the **train** split. Extraction input:
   public task specification, attributed failure categories, the Worker's own final source. Never hidden tests,
   references, hidden-test details or oracle messages (tested: the extraction prompt shares no 6-token run with them).
2. **Screening** (→ CANDIDATE): see `SKILL_REGISTRY.md`. At most 6 candidates advance (trials that needed a repair
   first, then task order); duplicate names are rejected.
3. **Sandbox validation** (→ SANDBOX_VALIDATED): the source task re-run once in arm C with only that skill reachable
   through Lotus; the deterministic gate must pass **and** the skill must actually have been shown.
4. **Benchmark qualification** (→ BENCHMARK_QUALIFIED): the **qualify** split (never a discovery source), 2 trials
   per task, arm C with all sandbox-validated skills vs arm B. Qualified only if the skill was retrieved in ≥ 1
   qualify trial, C's passes on those slots ≥ B's on the same slots, and no permission or security violation.
   A skill never retrieved stays SANDBOX_VALIDATED: its generalization is unproven.
5. **Approval / activation** belong to the workstation owner. This milestone's harness never approves anything; no
   skill becomes ACTIVE in the product as a result of the evaluation.
6. **Held-out** use: arm C uses BENCHMARK_QUALIFIED skills under the evaluation's authorization only.

## Rejection grounds (any one)

fails its required tests · depends on hidden reference answers (text overlap) · violates permissions (new tools) ·
unexpected side effects (handoff refusal, pin violation during use) · consistently increases error rates (four
consecutive failed uses → quarantine) · excessive resources (bounded by the guidance budget and the unchanged call
budgets) · depends on an unsupported or named model.

## What does not count as learning

Retaining a skill is not called successful learning. Only the pre-registered held-out comparison (C vs A, C vs B)
can show a benefit; if it does not, the result is reported as "functionally complete, intelligence improvement
unproven".
