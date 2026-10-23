# MA4-S2 — Task planning, adaptive delegation and workflow control

## Planning inside one task (unchanged S1R4 core)

A deterministic profile (`profileCodingTask`) derives category, complexity, error conditions and budgets from Host
task facts only; `buildTaskGraph` produces a bounded, typed graph (plan → implement ∥ test → select → verify →
diagnose → repair → review) that `validateGraph` checks for unique ids, known dependencies, no cycles, ≤ 12 nodes and
≤ 4 agents. The Planner's artifact is advisory and is frozen with the Host facts into the immutable contract. S2 does
not change any of this; the profile's model-call budget now also bounds the Coordinator channel.

## Team composition (S2)

`composeTeam` covers the task's needed capabilities with the fewest roles:

| Request needs | Model roles | Host roles |
|---|---|---|
| coding (plan, code, tests, review) | Planner, Worker, Tester, Reviewer | Coordinator (+ Researcher when memory is enabled) |
| review only | Reviewer | Coordinator |
| retrieval only | — | Coordinator, Researcher |

Not every request gets every role; memory never adds an active model role.

## Delegation

For each model role the Coordinator applies, in order: the user's hard pin (never substituted; an ineligible pin
abstains and the team is refused) → eligibility (privacy, local-only mode, provider approval, quota — decided
upstream, unchanged) → measured role evidence (Wilson lower bound) → local-first order. Hardware enters through the
schedule: two different models run concurrently only when both fit in VRAM.

## Multi-step workflow control (`team-run.server.ts`)

A run is a validated DAG of steps (≤ 128, acyclic). Each step is reversible (sandboxed generation, tests) or
irreversible (a consequential external action).

| Capability | Behaviour |
|---|---|
| Dependency-aware scheduling | `ready()` returns pending steps whose dependencies are done, bounded by `maxConcurrent` (≤ 4) |
| Progress | per-step state, attempts, result hash; run summary counts |
| Pause / resume | a paused run admits nothing; resume continues |
| Cancellation | pending and running reversible steps become cancelled at once; a running irreversible step becomes uncertain |
| Partial failure | a failed step makes dependants unreachable; the run fails only when nothing reachable remains |
| Controlled retry | a reversible step retries within `maxRetries` (≤ 3) |
| Restart recovery | the start of a step is persisted before it runs; `recover()` re-queues reversible steps within budget and marks irreversible in-flight steps **uncertain** — never replayed automatically |
| Approval | an irreversible step cannot start without an owner approval (`workstation` actor); only the owner resolves an uncertain step (`happened` / `retry` / `abandon`) |
| Privacy | `persist: false` keeps the ledger in memory only (no database row) |

The evaluation harness runs every phase through this ledger (one reversible step per trial), so a crash would be
recovered by it rather than by ad-hoc re-runs. All generated code still executes only in the qualified sandbox; no
step type grants command execution.
