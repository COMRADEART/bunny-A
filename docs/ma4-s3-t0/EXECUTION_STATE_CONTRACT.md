# MA4-S3-T0 — Execution State Contract

## Authoritative MA4 states

`CREATED → VALIDATED → AWAITING_APPROVAL → QUEUED → RUNNING → {PAUSED,RESUMING,COMPLETED,FAILED,CANCELLED,UNCERTAIN}`

Source: `src/lib/bunny-host/ma4/task-runtime.ts` (`TASK_STATES`, `TASK_NEXT`).

### T0 change

`UNCERTAIN` exits **only** to `QUEUED` or `FAILED` via `reconcile`. Cancel throws `TaskConflictError`.

## Frontend projection rules

- Live snapshot → display Host `display` / `state`
- Stale / offline → "Last known …" and **no controls** (`ptask-model.ts`)
- Never treat model text as status

## Parallel managers (not collapsed in T0)

OrchTask, Mission, AgentRuntime, PersistentTask, Proactive — each owns its vocabulary. Unifying is MA4-S3-T1+ scope if product chooses a single path.
