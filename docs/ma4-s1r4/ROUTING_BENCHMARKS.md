# MA4-S1R4 — Performance-aware routing (Phase F)

## Decision order (implemented and tested)

1. **Explicit pins** — `selection.ts` / `routing.server.ts` (unchanged hard pins, no silent fallback) and the new
   role-level `assignRole({ pin })`: an ineligible pinned model yields `abstain` with "no substitute is chosen".
2. **Privacy and provider permission** — `applyRoutingMode`, `approvalExclusion` (exact provider + model approval,
   workstation-issued only); unchanged.
3. **Mandatory capabilities** — router hard filters (tools, structured output, context, modality, sensitivity);
   unchanged. The S1R4 task profile lists the capabilities a coding task needs.
4. **Resources and quota** — usage component and runner RAM floor (now a bounded wait).
5. **Task-specific correctness** — router: Wilson-bounded `ma4_reliability` per category; S1R4 adds **role-level**
   evidence (`RoleEvidence`, `assignRole`).
6. **Latency and cost** — router latency prior; S1R4 records per-call Ollama receipts.
7. **Local-first among eligible** — candidate order breaks ties.

Eligibility (1–4) and ranking (5–7) are separate functions: `assignRole` only ranks candidates whose `exclusion` is
null, so a high score can never override a pin, a privacy rule or a missing approval (test *R4-G4/R4-G9 role
assignment*).

## Abstention

`assignRole(role, …, { highRisk: true })` returns `model: null, decision: "abstain"` when no eligible model's 95 %
lower bound reaches 0.5 in that role. On today's evidence the **Worker role abstains for high-risk work**
(best lower bound 0.43): Bunny A must report that no authorized model has demonstrated reliable unattended
implementation instead of presenting unverified code as done.

## Reliability records

The existing `ma4_reliability` store keeps bounded counts (provider, model, category, passes, samples, source). Role
evidence (`evidence/role-evidence-v3b.json`) holds model, role, passes, samples and evaluator version only — no prompts,
source code or model outputs. Nothing retrains a model from user interactions.

## Measured routing outcomes

| Routing | Dev set (20) | G7 held-out (20) | G7 v2 (3) |
|---|---|---|---|
| S1R3 workflow, coder 7B pinned on every role | 11 | 13 | 0 |
| S1R4 v3b, coder 7B on every role | 11 | not run | not run |
| S1R4 v3b, abliterate 7B on every role | 12 | not run | not run |
| S1R4 v3c, coder 7B on every role | 11 | not run | not run |
| **S1R4 v3c, automatic role assignment** (Tester → abliterate) | — | **17** | **0** |

The router's contribution cannot be separated from the strategy's in G7 (one decisive run, pre-registered). On the
development set the two 7B models are within one trial of each other, so the role assignment is evidence-based but
not statistically decisive.

## Cost of mixing models

Worker (coder) and Tester (abliterate) in one trial means both 4.7 GB models share a 6 GiB GPU: median call latency
18.4 s vs 13.7 s in S1R3's single-model run, +6.6 % total trial time, same number of calls.
