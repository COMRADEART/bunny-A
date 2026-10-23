# MA4-S2-T1 — Task state machine

Source: `src/lib/bunny-host/ma4/task-runtime.ts` (`TASK_STATES`, `TASK_NEXT`). Enforced in the store's single update
transaction (`task-store.server.ts`), not only in the runtime, so no caller can make an invalid transition.

| From | Allowed to |
|---|---|
| CREATED | VALIDATED, FAILED |
| VALIDATED | AWAITING_APPROVAL, QUEUED, FAILED, CANCELLED |
| AWAITING_APPROVAL | QUEUED, FAILED, CANCELLED |
| QUEUED | RUNNING, PAUSED, AWAITING_APPROVAL (approval expired before claim), FAILED, CANCELLED |
| RUNNING | PAUSED, RESUMING (lease lost → recovery), COMPLETED, FAILED, CANCELLED, UNCERTAIN, AWAITING_APPROVAL |
| PAUSED | RESUMING, FAILED, CANCELLED |
| RESUMING | RUNNING, PAUSED, AWAITING_APPROVAL, FAILED, CANCELLED, UNCERTAIN |
| UNCERTAIN | QUEUED, FAILED, CANCELLED — only through owner reconciliation (or cancel/revoke) |
| COMPLETED / FAILED / CANCELLED | — (terminal) |

`UNCERTAIN → COMPLETED` does not exist: an action of unknown outcome can only become done through the owner's
reconciliation ("it happened", recorded as an owner-attested receipt), after which the task re-enters QUEUED and the
acceptance contract is evaluated again. Every row has `version`; user commands may pass `expectVersion`.

## Task record (persisted)

Stable id; owner (`workstation`) and project; immutable spec (title, steps, dependencies, acceptance contract,
deadline) with its SHA-256; the authorization envelope with its SHA-256; approval (hash-bound, expiring); revocation;
per-step state, attempts and output hash; usage (model calls, working time); controls (pause/cancel requested);
blocked reason; failure code; the uncertain operation key; observed suspended time. Lease holder, fence and expiry are
columns of the row.

## Display states (notch, dashboard, phone)

`displayState()` maps the trusted record: CREATED/VALIDATED/QUEUED → Queued; RUNNING → Working; AWAITING_APPROVAL →
Waiting for approval; PAUSED → Paused (or Needs attention when blocked by a missing model or resources); RESUMING →
Recovering; UNCERTAIN → Needs attention; COMPLETED / FAILED / CANCELLED. A corrupt row is shown as Needs attention.

Tests: `ma4-s2t1.test.ts` "T1 state machine" (every pair of states checked against the table).
