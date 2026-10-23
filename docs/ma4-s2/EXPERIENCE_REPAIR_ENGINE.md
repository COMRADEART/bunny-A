# MA4-S2 — Experience-guided repair

Builds on the S1R3/S1R4 evidence-based repair engine (`coding-workflow.server.ts`); nothing in its attribution or
budgets changed.

## Loop (S2 additions in bold)

1. Collect sanitized failure evidence (static errors, the Tester's own failing lines, "independent acceptance suite
   failed — details withheld", oracle verdicts on the Tester's tests).
2. Identify the failing component with the deterministic `attributeAttempt` (verified / supported / ambiguous).
   Ambiguous failures get a diagnosis, never a blind repair.
3. **Retrieve verified prior lessons**: the guidance hook is asked with the target role, phase `repair` and that
   target's attributed failure categories; it returns only usable skills whose roles include the target and whose
   recorded failure categories match (or that share two task tags), plus up to three verified experience lines.
4. **Decide whether a trusted skill applies**: `selectSkills` — no match, no guidance (nothing is shown or recorded).
5. Select a bounded repair action: only the attributed components are repaired; the Coordinator sends the Host
   feedback as a protocol message (1 model call of budget each).
6. Run deterministic validation (sandbox static checks, hidden acceptance tests, Tester tests with the oracle).
7. Record the outcome: repair record (round, target, categories, previous/proposed hash, valid/identical/malformed,
   outcome); in arms that learn, the trial becomes a Host experience record (train/qualify only).

## Budgets and stops

* Frozen G7 workflow: ≤ 2 repair rounds, unchanged; G7 is not rerun in S2.
* S2 workloads (pre-registered): ≤ 2 repair rounds per trial — deliberately the same number, so no arm wins by
  repairing more; plus the profile's model-call budget and the 60-call tool budget.
* An identical resubmission stops the loop (unproductive). Guidance is ≤ 1,200 characters.

## Invariants (tested)

* Acceptance tests are never modified or shown to a model: hidden tests and references stay Host-side.
* A Reviewer approval never overrides a deterministic failure (`reviewerFalseApproval` recorded and blocked).
* Guidance is advisory text after the contract; it cannot change pins, the contract, the Tester rule or the gate.
