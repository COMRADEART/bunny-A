# MA4-S2-T1 — Checkpoints and recovery

## Ordering per step (the guarantee)

1. Re-check controls (cancel, pause), background policy and authority (revocation, envelope expiry, deadline, a live
   hash-bound approval). Check the pinned model is installed locally and the memory floor holds (GPU steps).
2. **Commit the operation as `started`** with the worker's fencing token, attempt + 1 and a checkpoint — before any
   effect.
3. Run the executor.
4. Commit the result: `succeeded` with its receipt, output and output hash; or `failed` (proven not dispatched, or the
   other side reported failure); or `interrupted` (read-only, unknown); or `needs_verify` (idempotent, unknown); or
   `uncertain` (irreversible, unknown → task UNCERTAIN).

## Recovery classification (a worker is gone: crash, kill, lease expiry)

The takeover transaction bumps the fence (the old worker can never commit again) and classifies the one operation
that was `started`:

| Category | Recovery |
|---|---|
| read-only | `interrupted`; the step is retried within its attempt budget (≤ 3). |
| idempotent | `needs_verify`; before any re-execution the executor's `verify(key)` is asked whether the stable key was already applied — if so its result is consumed. |
| irreversible | `uncertain`; the task becomes UNCERTAIN with a "recovery blocked" notification; nothing is re-sent until the owner reconciles. |
| none in flight | RESUMING; the next step runs after re-authorization. |

A `succeeded` operation found later is consumed, never re-executed. The store itself refuses to start an operation
that is `started`, `succeeded` or `uncertain` — the exactly-once guard sits below the runtime.

Then the startup policy applies (default: PAUSED, waiting for the user). Leftover child processes recorded for
tasks no longer active are killed only if their identity (pid, creation time, image) still matches; otherwise the
record is dropped.

## Crash-injection points tested

`after-claim`, `before-operation-start`, `after-operation-start`, `after-effect`, `after-receipt` (fault hook that
stops the runtime with no further write, then a new runtime on the same database), plus real `taskkill /F` of a
stand-in Host process during a read-only step and after an irreversible send, plus a real Host process killed during
real local inference. Results: CRASH_INJECTION_RESULTS.md.
