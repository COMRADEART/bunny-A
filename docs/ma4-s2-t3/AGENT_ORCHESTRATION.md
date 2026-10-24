# MA4-S2-T3 — Agent orchestration (T3-G8)

Proactive work reuses the S2 team and the S2-T1 runtime unchanged; the engine adds no executor and no agent.

| Step (scheduled development review) | Who | Where it is enforced |
|---|---|---|
| Host validates the schedule | proactive engine | `decide()` on fresh facts, occurrence key |
| Confirms project and permissions | engine + runtime | schedule/envelope project scopes; `validateTask` at create, approve, change and again in `runtime.create` |
| Planner constructs a bounded task graph | existing `ptask.plan` (S2-T2) | a plan is a **proposal**: the owner turns it into the schedule's template and approves the schedule |
| Worker reads approved artifacts | `file.read` / `email.list` through the S2-T2 broker | grants ∩ Host registry at every execution |
| Worker summarizes | `local.generate`, pinned model, sources fenced as DATA | served model ≠ pin → `PIN_VIOLATION` |
| Tester / Reviewer evaluates evidence | `local.review` (Reviewer); a deterministic monitor check plays the tester role for build status | Reviewer rejection fails the step (E2E-C) |
| Host records the outcome | runtime receipts → occurrence settled → notification → goal progress | receipts only |
| Bunny presents a concise summary | panel, phone, notch, away summary | sanitized views |

## Smallest team

The template names exactly the steps needed (Scenario A: read → Worker → Reviewer; Scenario D: read → Worker → send).
No step is added to demonstrate orchestration. Monitors run **no** agent and **no** model (T3-M1, P6).

## Preserved controls

* One GPU-heavy call at a time Host-wide (`gateCalls`, maxConcurrent 1) — scheduled runs share it with everything else.
* Hard pins: a missing pinned model defers the slot (`modelsAvailable`), never substitutes (T3-A5).
* Cancellation: `schedule.cancel` cancels its open run; the runtime aborts the step and kills tracked children (T3-A8:
  child process gone, process table empty).
* Resource limits: the envelope's `maxModelCalls`/`maxWallMs` per run; the proactive `maxModelCallsPerDay` reserved
  per occurrence **before** dispatch; `maxConcurrentTasks` (default 1) across schedules.
* Sandbox: the S2-T1/S2-T2 sandbox and isolated browser are untouched; scheduled steps get no other execution path.
* No overlap: a schedule never starts while its previous run is open, including UNCERTAIN (T3-A9).
