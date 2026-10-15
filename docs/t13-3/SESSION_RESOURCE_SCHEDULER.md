# Session resource scheduler (M-A-3 T13.3 Gate F)

Gate F adds three things on top of the T13.2 dispatch gate and the T3 router: a per-session usage ledger, a quota rule
that stops write work from switching providers blindly, and fair sharing of capacity between the four Personal
Agents. It also adds an owner routing priority. None of it is a second router or scheduler: BunnyRouter still picks
the route, `evaluateDispatch` still decides whether any Task may run, and MissionManager still owns step execution.

Code:

- `src/lib/bunny-host/session-ledger.ts`: pure ledger view (totals, allowance, UNKNOWN rules).
- `src/lib/bunny-host/session-ledger.server.ts`: the `session_ledger` table.
- `src/lib/bunny-host/fairness.ts`: pure admission rule, settings validation, routing priorities.
- Hooks:
  - `TaskManager` (`manager.server.ts`) reserves and settles ledger rows, applies the routing priority, and pauses quota-hit write attempts.
  - `MissionManager.missionAdmissionGate` holds steps.
  - `retryVerdict(…, access)` applies the write-step rule.
- Host wiring, snapshot and `scheduler.*` commands: `http.server.ts`.
- UI: `src/components/island/session-usage.tsx` (Settings → AI & Models → Usage & limits).

## 1. Ledger (§16)

Each row in the ledger is one T13.2 reservation. Its key is the same `connection_usage.id` that the dispatch gate already counts, so the ledger and the account caps can never disagree on how many requests were sent.

| Dimension | Source |
| --- | --- |
| Bunny session | `TaskManager.instanceId`, which is new on every Host start |
| Personal Agent | The Mission's owning slot: the worker's slot for a child Mission, otherwise the coordinator Agent's owner |
| Project, Mission, worker Task | The Task record (`projectId`, `mission.missionId`, `id`) |
| Provider session | `task.sessionId` at settle |
| Account / harness | The T13.2 connection id and its catalogue name |
| Model | The launched model (`null` when the provider picked its default) |
| Consumption | Provider-reported input and output tokens for that attempt only. Unreported tokens are counted as `unreported`, never as 0 |
| Estimated / observed cost | `0` for `local_device`. Every other value is `UNKNOWN`: no provider reports cost to Bunny today, and none is inferred from a plan price |
| Remaining allowance | Only from provider-reported usage windows on a `plan_included` route. API keys, credits and missing windows are `UNKNOWN`, with the reason shown |
| Account totals, daily limits | T13.2 `usage()` and consent caps. They are shown beside the session totals and never merged into them |
| Reservations | Rows still `pending`. A restart marks them `unknown_restart` |

The rule is that planning is per session, and the account totals remain independent hard ceilings enforced by `evaluateDispatch`. Rows from other sessions are kept for 30 days.

## 2. Selection and routing priority (§17)

The order from the directive maps onto existing stages:

1. Capability, privacy and locality, and context limits: hard exclusions in `buildCandidates`.
2. Active-session availability, quota, rate limits and the user's cost caps: the T13.2 `connectionGate` and `evaluateDispatch`, plus usage pressure in the score.
3. Measured quality, estimated time and reliability history: policy priors, latency and empirical score components.
4. Provider consent and harness compatibility: T13.2 consent and the Gate E harness lifecycle.

The owner priority (`scheduler.priority`, setting `routing_priority`) adds one score component named `priority`. It is applied only after every exclusion has run:

| Priority | Effect |
| --- | --- |
| Balanced (default) | No component; scores are identical to T3 |
| Minimize cost | +8 for local candidates, or +16 when the work is lightweight (low reasoning, no or low coding, no tools). Cloud candidates get 0, because a plan is never assumed free |
| Prioritize quality | Up to +8 by the policy rank for the task class |
| Fastest eligible | Up to +8 from the latency prior plus a local advantage |
| Local only | Adds the existing `localOnly` constraint, so cloud candidates are excluded |

A priority never widens eligibility. A tool-requiring Task still cannot go to a tool-less local model under Minimize cost; the test proves it. OpenCode and Cline confer nothing: they remain detect-only harnesses, and being installed is not entitlement.

## 3. Quota continuation (§18)

| Step | Behaviour |
| --- | --- |
| Detect | `classifyFailure` maps the result to `QUOTA_CONSTRAINED`, and `classifyTaskFailure` maps it to `provider_rate_limited` |
| Preserve checkpoint | Completed Mission steps are never re-run. Only the failed step changes state |
| Mark accurately | The attempt is recorded with taxonomy `QUOTA_CONSTRAINED` and the ledger row settles as `failed` |
| Unresolved side effects | For **write** work Bunny cannot prove what landed. The TaskManager refuses the reroute (`QUOTA_PAUSE`) and the step's retry verdict is `waitForUser`, so the Mission moves to `waiting_for_user`. Gate J (owner decision): a direct Chat or `/submit` task with no declared scope counts as write work, and a persistent transport failure pauses write work the same way (`WRITE_PAUSE`, Mission category `provider_write_paused`). **N-C (owner decision 2026-10-14):** write work is not re-executed after **any** failure once an attempt may have started, not even on the same provider. The task or step records `reconciliation.required` and shows "Outcome uncertain — reconciliation required". See `T13_3_NC_RETRY_CLOSURE.md` |
| Read work | Only work that **declares** read access keeps the bounded T3 reroute (two alternates at most), because it has no side effects |
| Destination consent | Any reroute still passes the T13.2 cross-vendor switch rule (`CROSS_VENDOR_SWITCH`, `switchAllowlist`) and per-account consent |
| Context | Bunny sends no context of its own. A reroute relaunches the same Task prompt only to a destination the owner already allowed |
| Expired authority | Mission envelope expiry or revocation and stale connection authority refuse resumed cloud work (existing T9/T13.2 checks) |
| Pause and ask | The write path pauses. The owner reconciles on the workstation (`task.reconcile` with retry or close; `mission.reconcile` with retry or stop) before any retry; plain `mission.retry` and `mission.replan` are refused until then |

## 4. Fairness (§19)

All four Agents may run at the same time. `admitStep` is consulted before each ready step of a Mission that a Personal Agent owns is launched:

| Check | Default | Hold code |
| --- | --- | --- |
| Per-Agent concurrent steps | 2 (1–8) | `AGENT_CAP` |
| Shared ceiling across all Agents | 4 (1–16) | `SHARED_CEILING` |
| Fair turn | Waiting Agents are ranked by aged priority (one rank higher per minute held, up to high: `FAIRNESS_AGING_MS`), then by fewer live steps, then by longest wait, so no Agent is starved | `FAIR_TURN` |
| Memory pressure | 95% of system memory (50–100). It applies only while another Agent step is live, so it never starves the only Agent | `MEMORY_PRESSURE` |

A held step stays `ready`; it is not failed. The Mission records a `mission.step.held` event, and every held Mission is ticked again when any step leaves a live state or the settings change. Missions that no Personal Agent owns are not affected.

Pause, resume, cancel and bounded retries reuse the existing Agent pause gate, Mission stop and `retryVerdict` bounds. Quota cannot be double-reserved, because each dispatch's `evaluateDispatch` counts pending `connection_usage` rows after the asynchronous registry refresh. Four Agents racing for the last allowed request get exactly one reservation; the Host test proves it.

## 5. Settings and visibility

These settings are workstation-only: `scheduler.priority` and `scheduler.fairness`. Both are refused for paired devices with `WORKSTATION_REQUIRED`, and both persist across restarts. Device snapshots have `sessionLedger` and `scheduler` stripped. The Usage & limits tab shows:

- the priority;
- per-account session totals beside the account's totals for today;
- the remaining allowance, or Unknown with the reason;
- per-Agent usage;
- the fairness controls.

## 6. Tests

| Directive §35 item | Test |
| --- | --- |
| Light Tasks pick free/local resources; heavy Tasks pick a stronger provider | `routing.test.ts` "T13.3 F §17", `routing-matrix.test.ts` |
| Different steps of one Project can use different providers | `scheduler.test.ts` read-step reroute; `missions.test.ts` parallel/independent review |
| Session usage is tracked separately from account totals | `session-ledger-host.test.ts` (both tests) |
| Unknown quota stays UNKNOWN | `session-ledger-host.test.ts` (pure test), which also checks that an API key is not an allowance |
| Exhaustion leads to a safe pause or an eligible failover | `scheduler.test.ts` (write pause, read reroute), `t3-manager.test.ts` "T13.3 F §18" and "T3 §22" |
| Failover preserves verified checkpoints | `scheduler.test.ts` write-pause test (the completed reader step is kept and not re-run) |
| Cloud switching respects exact destination consent | `connections.test.ts` R06 and R05/R06 allowlist, `connections-host.test.ts` R07 |
| No double reservation; concurrent Agents stay under shared ceilings | `session-ledger-host.test.ts` race, `scheduler.test.ts` admission tests, `connections.test.ts` R11 (capped fresh dispatch) |
| Expired authorizations prevent resumed cloud work | `missions.test.ts` (an expired envelope asks; MA0R expired envelope requires a new approval), `connections.test.ts` R05 (no approval binding gives `STALE_AUTHORITY`) |
| An apparent subscription does not imply API entitlement | `connections.test.ts` R01/R03/R10 (API and detect-only modes never dispatch) and R04 (unexpected API billing trips the connection), `connections-host.test.ts` R02/R10 |

Two mutation checks were run on the new rule. Disabling the write check in `retryVerdict` makes the Mission write-pause test fail, and disabling it in the TaskManager makes the `t3-manager` write test fail.

## 7. Limits

- **CPU and GPU are not measured.** The admission rule enforces memory, the per-Agent limits and the shared step limits.
- **Cost is UNKNOWN for every cloud route.** No provider adapter reports spend to Bunny. Monetary limits remain the T13.2 `maxUsdPerDay` consent caps.
- **Provider concurrency is not separately capped.** Each account's daily request cap and pending reservations are the provider-level ceiling.
- **Fairness has not run with four live Personal Agents.** It was tested in-process and through pure-rule tests, not with live provider work.
