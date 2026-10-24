# MA4-S2-T3 — Persistent scheduler (T3-G3, T3-G5, T3-G6)

Code: `proactive.ts` (`ScheduleSpecSchema`, `TriggerSchema`, `nextSlot`, `slotsBetween`), `proactive.server.ts`
(`schedule*`, `runSchedule`, `fire`, `dispatch`, `settleOccurrences`), `proactive-store.server.ts` (`ma4_occurrences`).

## Contract (`ma4.schedule.v1`)

| Field | Meaning |
|---|---|
| id, `projectId`, owner | Schedule id (`sch-<uuid>`); owner is always the workstation (only it creates/approves) |
| `goal` | Optional `{ id, criterionId }`: each occurrence's task is linked to that criterion |
| `trigger` | `once` (`YYYY-MM-DDTHH:MM` + IANA zone), `daily` (`HH:MM`, IANA zone, optional weekdays), `condition` (a monitor id) |
| `action` | `remind` (text) or `task` (an S2-T1 task template **without** deadline + its full envelope) |
| authorized executor | Implicit and fixed: the S2-T1 runtime with the Host's registered executors; validated with `validateTask` at create, approve and change |
| `maxRunsPerDay`, `minGapMs` | Maximum frequency (rolling 24 h; condition triggers: least time between runs) |
| `expiresAt` | ≤ 1 year; the schedule ends (EXPIRED) and says so |
| resource / inference limits | The envelope's budgets per run + the proactive policy (`maxModelCallsPerDay`, `maxConcurrentTasks`) across runs |
| `notify` | Notify on completed / failed runs |
| permission envelope | `action.envelope` — local Ollama only, project scopes, grants; never widened |
| `missedPolicy`, `graceMs`, `runWindowMs` | See below |
| last attempt / next eligible | `lastAttempt {at, slot, outcome, reason, taskId}`, `nextAt`, `retryAt` |
| deduplication key | `<scheduleId>:<slot UTC ms>` (time) or `<scheduleId>:o<observation seq>` (condition) — the `ma4_occurrences` PRIMARY KEY |

States: `AWAITING_APPROVAL → ACTIVE ⇄ PAUSED`, `→ COMPLETED | CANCELLED | EXPIRED | FAILED`. Any change
(`schedule.update`) returns it to AWAITING_APPROVAL; approval binds the spec hash and ends (≤ 30 days, ≤ `expiresAt`).
Approving or resuming covers **slots from now on**: time that passed unapproved or paused is never caught up.

## How a slot fires

1. Each pass, for every ACTIVE, intact schedule: end date and approval are re-checked (lapsed → AWAITING_APPROVAL +
   `permission_expired`).
2. `slotsBetween(trigger, cursor, now)` lists due slots (bounded to 400, so a clock jumping years ahead cannot loop).
3. Earlier slots are recorded **once** as missed (one occurrence row, one `schedule_missed` notification).
4. The latest slot: if later than `graceMs` and the policy is `skip`, recorded as missed. Otherwise `decide()`
   (PROACTIVE_DECISION_ENGINE.md) runs on fresh facts.
5. The decision, the schedule's new cursor and the occurrence row (the duplicate guard) commit in **one** transaction,
   with any notification. Only then is the task created, under the deterministic id
   `ptask-<schedule>-<slot>` with deadline `max(slot, now) + runWindowMs`, and approved by the schedule
   (`approveScheduled`) when its envelope requires approval. The runtime runs it; its result settles the occurrence.

## Time correctness

* **Wall-clock semantics.** Slots are local wall times in a named IANA zone, converted with `Intl` (no offsets stored),
  so DST changes move the UTC instant, not the local time (TIMEZONE_AND_DST_VALIDATION.md).
* **Monotonic progress.** The cursor only moves forward. A clock moving backwards finds no slot after the cursor until
  real time passes it again; the occurrence key prevents a second run of any slot (T3-S4).
* **Clock forward / long shutdown / sleep.** Handled by the missed-run policy below. Live durations (lease renewal,
  step timeouts) stay on the S2-T1 runtime's own timers.
* **Restart recovery.** Schedules, cursors and occurrences are durable. At start the engine records the time it was not
  running (heartbeat gap → `ma4_host_gaps`), then runs a normal pass. An occurrence whose decision committed but whose
  task did not exist (Host died in between) is dispatched once within `graceMs`, otherwise recorded as missed (T3-A3).

## Missed-run policy (documented, per schedule)

| Situation | `skip` (default) | `run_once` |
|---|---|---|
| Slot due ≤ `graceMs` ago | runs | runs |
| Latest slot due > `graceMs` ago (Host off, PC asleep, clock jumped) | recorded missed, notified | runs **once**, late, with a fresh run window |
| Older slots in the same gap | recorded missed together (one row, one notification) | same |
| Slot deferred for a transient reason (model, window, previous run, concurrency) | retried every minute inside `graceMs`, then recorded with that reason | same |

Never: all missed runs at once, a run for time the PC was asleep or off, or a claim that work happened then. The away
summary and notch say "Bunny-A was asleep / not running for N min; nothing ran then".

## Ambiguous and nonexistent local times

The Temporal "compatible" policy: an ambiguous time (fall back) uses the **earlier** instant, so a daily slot fires once;
a nonexistent time (spring forward) moves **forward** by the gap (02:30 → 03:30).

## Tests

T3-TZ1–3, T3-S1–S7, T3-A2–A7, T3-E2E-A, T3-E2E-D (`ma4-s2t3*.test.ts`).
