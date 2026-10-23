# MA4-S2 — Model and agent performance evidence

## What S2 adds to routing

`role-performance.ts` turns verified workflow trials into per-model, per-role, per-kind evidence and feeds it to the
existing `assignRole()` as `RoleEvidence` (`toRoleEvidence`). Routing order is unchanged from S1R4:

1. **Hard pins** — user and per-agent pins are never substituted; an ineligible pin abstains and the team is refused.
2. **Eligibility** — privacy, local-only mode, provider approval, quotas, cancellation (decided upstream, unchanged).
3. **Measured evidence** — Wilson 95 % lower bound per (model, role).
4. **Local-first order.**

Model capability and orchestration capability are kept apart:

| Measure | Attributed to | Meaning |
|---|---|---|
| `structured` | the role's model | calls that returned a usable, schema-valid artifact |
| `held` | the role's model | trials in which the deterministic attribution never blamed this role's artifact |
| `firstAttempt`, `final` | the team (reported on the Worker row only) | gate pass without repair / at the end |
| latency, failure causes | the role's model | per-call wall time; attributed failure categories |

`compare(a, b)` names a winner only when the two Wilson intervals do not overlap and both have ≥ 3 samples; anything
else is `unresolved`. Nothing is inferred from a small score difference.

## Evidence (held-out run, 24 trials per arm)

Reproduce with `node --experimental-strip-types scripts/ma4-s2/role-evidence.mjs` →
`evidence/role-evidence.json` (reads only `evidence/heldout.json`; no model runs). Pins for all arms: Planner, Worker,
Reviewer `qwen2.5-coder:7b`; Tester `huihui_ai/qwen2.5-abliterate:7b`.

| Arm | Role | Structured | Held (not blamed) | Latency median / P95 | Attributed causes |
|---|---|---|---|---|---|
| A | Planner | 24/24 [0.86, 1.00] | 24/24 [0.86, 1.00] | 24.7 s / 35.5 s | — |
| A | Worker | 70/70 [0.95, 1.00] | 13/24 [0.35, 0.72] | 14.1 s / 82.3 s | implementation 33 |
| A | Tester | 36/36 [0.90, 1.00] | 17/24 [0.51, 0.85] | 31.0 s / 110.6 s | test_invalid 15 |
| A | Reviewer | 24/24 [0.86, 1.00] | 21/24 [0.69, 0.96] | 3.3 s / 15.7 s | false approval 3 |
| B | Planner | 24/24 | 24/24 | 23.5 s / 30.5 s | — |
| B | Worker | 75/75 | 11/24 [0.28, 0.65] | 12.4 s / 20.6 s | implementation 35 |
| B | Tester | 28/28 | 21/24 [0.69, 0.96] | 23.8 s / 42.0 s | test_invalid 5 |
| B | Reviewer | 24/24 | 20/24 [0.64, 0.93] | 9.2 s / 11.0 s | false approval 4 |
| C | Planner | 24/24 | 24/24 | 23.0 s / 37.1 s | — |
| C | Worker | 77/77 | 9/24 [0.21, 0.57] | 11.9 s / 20.8 s | implementation 38, dependency 2 |
| C | Tester | 30/30 | 20/24 [0.64, 0.93] | 26.6 s / 41.6 s | test_invalid 8 |
| C | Reviewer | 24/24 | 18/24 [0.55, 0.88] | 9.1 s / 16.6 s | false approval 6 |

Team outcome on the Worker row: first attempt A 11/24, B 11/24, C 7/24; final A 14/24, B 14/24, C 10/24.
`compare()` on final and first-attempt rates, A vs B, A vs C, B vs C: **all unresolved.**

Baseline (A) Worker by kind, final: strict 2/8 [0.07, 0.59], intermediate 4/6, debugging 5/6, planning 3/4. Each
cell has ≤ 8 samples, so none supports a per-kind routing decision.

## Reading

* **Structured-output reliability is not the bottleneck:** every role returned a usable artifact in every call
  (100 %, lower bounds 0.86–0.95). Tool calls are Host-run deterministic tools (static check, import smoke, tests);
  no model emits tool calls in this workflow, so tool-calling reliability of the models was not measured.
* **Correctness is the bottleneck, and it sits in the Worker** (blamed in 11–15 of 24 trials per arm), then the
  Tester on strict tasks.
* **Tester `test_invalid` fell from 15 (A) to 5 (B)** under the grouped schedule. This is one sample; it may come from
  the Tester no longer sharing the GPU with a concurrent Worker load (A's Tester P95 was 110.6 s vs 42.0 s), but the
  data does not establish cause. Reported, not acted on.
* With one model family pinned in every role and 24 trials per arm, the evidence cannot rank models. No routing
  default was changed by S2. The Groq/GPT-OSS adapter from G7C (PRs #15/#16) is not in this branch and not in routing.

## Cloud

Disabled. No purpose-scoped approval exists for S2; the historical G7C-2 approval does not apply and its Groq key was
revoked. The evaluation harness refuses any non-localhost model endpoint; 0 external requests were attempted.
