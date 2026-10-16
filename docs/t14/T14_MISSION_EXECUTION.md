# M-A-3 T14 — Mission execution

## Loop phases

`MissionView.autonomy = { phase, basis, verified }` is computed by `autonomyPhase()` in
`src/lib/bunny-missions/autonomy.ts` every time a Mission view is built. Rules, in order (first match wins):

| Phase | Canonical fact |
| --- | --- |
| CANCELLED | Mission `stopped` |
| FAILED | Mission `failed` |
| COMPLETE | Mission `completed`. `verified` = no unverified step **and** no unverified worker |
| RECONCILIATION_REQUIRED | a step has `reconciliation.required` and the Mission is `waiting_for_user` |
| OUTCOME_UNCERTAIN | a step has `reconciliation.required` while the Mission still runs other work |
| PLAN | Mission `draft` or `planning` |
| WAITING_AUTHORIZATION | Mission `waiting_for_approval`; or `waiting_for_user` with an open permission request; or a step waiting for approval |
| DELEGATE | Mission `ready` (approved, about to dispatch), or ready steps being handed out |
| WAITING_RESOURCE | `waiting_for_user` after a provider, quota, budget, timeout, capability or workspace failure; or a ready retry after one |
| WAITING_DEPENDENCY | `waiting_for_user` after a dependency failure; or nothing runnable until earlier work or workers finish |
| VERIFY | Mission `verifying`, or any step `verifying` |
| REPAIR | a running step whose previous attempt failed verification, or a Team rework replica the Host activated; or such a retry queued |
| OBSERVE | a running step whose task finished and whose results are being collected |
| EXECUTE | a step running |

The phase is presentation and evidence only. MissionManager never reads it.

## Repair, by kind of work

| Work | On a failed check | Why |
| --- | --- | --- |
| Read-only model step | Bounded retry (`maxRetries`, Mission `budget.maxRetries`) with the Host's failure text in the prompt; reroute on provider loss | Repeating a read changes nothing |
| Team delivery (Implementer → Host write → Tester) | The owner-reviewed rework replica runs; the Host writes its output under the pre-image guard | The write is Host-enforced idempotent; nothing is replayed blindly (T11) |
| Deterministic capability `filesystem.write` with `expectBeforeSha256` | May replay | Host-enforced duplicate guard (N-C exception) |
| Raw write-capable provider session (`access: "write"`) | Pauses: "Outcome uncertain — reconciliation required"; the owner reconciles (`mission.reconcile`, workstation only) | T13.3 N-C owner decision: no automatic retry may duplicate a write |
| Worker | The worker closes REJECTED or INDETERMINATE; the parent records it unverified | A worker never retries itself beyond its own budget (`maxRetries` ≤ 1) |

So the fully unattended PLAN → … → REPAIR → COMPLETE loop for coding work is the Team Mission path (Scenario A); a
single write session that fails its check stops for the owner (also asserted in Scenario A).

## Bounds (configurable with `mission.configure`)

| Limit | Default | Range |
| --- | --- | --- |
| `maxRetriesPerStep` | 2 | 0–5 |
| `maxReplans` | 2 | 0–5 |
| `maxMissionRuntimeMs` | 2 h | 1 min–6 h |
| `maxActiveMissions` | **4** (was 3) | 1–10 |
| `maxConcurrentAgents` (steps per Mission) | 3 | 1–6 |
| Mission budget (fast / balanced / deep) | 2 / 6 / 12 external calls; 2 / 4 / 6 retries | per mode |
| Personal Agent fairness (`scheduler.fairness`) | 2 live steps per Agent, 4 shared | 1–8, 1–16 |

Every attempt, including an interrupted one, is charged to the budget (Scenario L shows the 13th external call of a
12-call allowance refused as `budget_exceeded`).

## Evidence before success

- A step is `verified` only by Bunny's own checks (command exit, file contents, capability output, Team requirement
  checks). A provider's "it works" is stored as an unverified conclusion.
- A Mission completes only from graph state; its result says how many steps were independently verified.
- A worker is VERIFIED only by `verdict()` over the Host's step verification; the parent records the verdict as a
  verified fact only in that case (`bunny:verification:worker:<id>` provenance; the memory layer refuses `verified`
  for any other provenance).

## Durability

Missions, steps, attempts, envelopes, requests, workers and Lotus rows are in the Host SQLite database. After a Host
restart the recovery walk marks running attempts `interrupted`, never resumes a provider stream, and holds the Mission in
`waiting_for_user` until the owner retries, reconciles or stops it (Scenarios F and L). Closing a window is not stopping
the Host: Missions keep running while the Host process runs (Scenario H closes voice and the Mission still completes).
