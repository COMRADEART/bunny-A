# MA4-S2-T3 — Proactive decision engine

Code: `decide()` in `proactive.ts` (pure), its facts from `ProactiveEngine.facts()`.

```
USER-APPROVED SCHEDULE / MONITOR
  → trigger (time slot or meaningful observation)
  → trigger validation      record intact, state ACTIVE, end date
  → permission recheck      approval live AND bound to the current spec hash; envelope not expired; goal state
  → duplicate detection     occurrence key (store PRIMARY KEY) + overlap with the previous run
  → resource evaluation     proactive on/off, runs per day, goal task budget, daily model budget,
                            concurrent proactive tasks, pinned model present, window or background policy
  → decision (exactly one outcome) → durable record (occurrence + cursor + notification, one transaction)
  → task orchestration (S2-T1 runtime) → result verification (receipts, acceptance) → notification → evidence
```

## Outcomes

| Outcome | Meaning |
|---|---|
| `execute` | create the authorized task (no model steps) |
| `queue` | create the authorized task (model steps; it enters the one-GPU-call gate) |
| `request_approval` | approval missing/expired/changed → schedule AWAITING_APPROVAL, owner notified |
| `notify` | reminder due |
| `record_no_change` | condition unchanged or routine |
| `defer` | resources/limits; **transient** (retry within grace: overlap, concurrency, model, no window) or not (day budget, runs per day, goal paused, proactive off) |
| `stop_expired` | schedule/envelope/goal ended or source no longer authorized |
| `fail_safe` | corrupt record, unreadable/uncertain/invalid source — nothing runs, explained |

Order is authority first: no fact that a model, a file or a page can influence is consulted before integrity, state,
expiry and approval. There is no "urgency" input: a model's suggested priority cannot change permissions or
notification rules. T3-D1 enumerates 28 fact combinations and checks that each yields exactly one expected outcome.

## No unbounded chains

A task cannot create schedules (no executor does, and `schedule.*` commands are workstation-only); a schedule creates at
most one task per slot (occurrence key), never while its previous run is open, at most `maxRunsPerDay`, and condition
triggers at most once per `minGapMs`. Monitors never create monitors.
