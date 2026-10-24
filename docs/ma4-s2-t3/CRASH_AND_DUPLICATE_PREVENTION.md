# MA4-S2-T3 — Crash and duplicate prevention (T3-G5, T3-G6)

## Ordering

```
decide()  ──►  ONE transaction: occurrence row (PK = schedule:slot) + schedule cursor + notification
          ──►  create task (deterministic id ptask-<schedule>-<slot>)  ──►  approveScheduled  ──►  mark dispatched
runtime   ──►  S2-T1 exactly-once: operation start committed before the effect, receipt after
engine    ──►  settle occurrence + completion/failure notification (one transaction, key = event identity)
```

| Crash point | What a restarted Host finds | Result | Test |
|---|---|---|---|
| Before the decision commits (incl. a failing notification insert) | nothing | the slot is decided once, later | T3-A2 |
| After the decision, before the task exists | occurrence `dispatched = 0` | within `graceMs`: created once; after: recorded missed, notified | T3-A3 |
| After the task exists, before `dispatched` | task with the deterministic id | found, not re-created | T3-A3 (repeat restarts) |
| During a read-only step | S2-T1 RESUMING/PAUSED per policy | re-run within budget | S2-T1 suites |
| During an irreversible effect | S2-T1 UNCERTAIN | owner decides; next slot defers (overlap); one `recovery_blocked` notice | T3-A9 |
| During settlement | occurrence `settled = 0` | settled once; notification key dedups | T3-A4 |

## Duplicate guards

* Slot: `ma4_occurrences` PRIMARY KEY; the insert is inside the decision's transaction, so a second engine (or Host) on
  the same file rolls back (T3-S7) and a restarted one finds the slot decided (T3-S3).
* Cursor: monotonic; a clock moving backwards cannot re-open a decided slot (T3-S4).
* Task: deterministic id; `runtime.create` refuses an existing id.
* Notification: key = event identity, `INSERT OR IGNORE` (T3-A4: unique keys across three restarts).
* Overlap: no new run while the previous one is open or UNCERTAIN.
* Competing Hosts: the S2-T2 port guard prevents two Hosts on one machine; the store guard covers a shared file anyway.

## Corruption

Every record carries a SHA-256 of its JSON and its spec hash. A tampered or unparseable row is listed under
`snapshot.corrupt`, shown as needing attention, and never fires (T3-S6). The S2-T1 integrity check still makes the
runtime read-only on a failing database, and the engine then does nothing.
