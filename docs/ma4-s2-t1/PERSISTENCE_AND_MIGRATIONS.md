# MA4-S2-T1 — Persistence and migrations

Storage is the Host's existing SQLite file (`HostDatabase`, WAL, `busy_timeout`). No new database engine.

## Tables (additive, created by their owner `TaskStore`)

| Table | Purpose |
|---|---|
| `ma4_tasks` | One row per task: state, `version`, `fence`, `lease_holder`, `lease_expires`, record JSON + `record_sha256` |
| `ma4_task_transitions` | Append-only history: from, to, version, fence, actor, reason, time (≤ 500 newest per task) |
| `ma4_task_operations` | One row per step operation (key `<task>:<step>`): category, state, attempts, fence, receipt |
| `ma4_task_checkpoints` | Boundary checkpoints (phase, step, attempt, category, fence, version; ≤ 50 newest per task) |
| `ma4_task_outputs` | Step output text (≤ 64,000 chars), workstation-readable only |
| `ma4_task_processes` | Identity (pid, birth time, image) of tracked child processes, for crash cleanup |
| `ma4_task_notifications` | Local notifications; the primary key is the dedup key |

Migration key `ma4.task-runtime.v1` in `migrations`; schema version `ma4_task_runtime_schema` in `settings`. A database
whose schema version is newer than the Host's is refused (no downgrade misreads). Re-opening is idempotent.

## Transactions

Every change is one `BEGIN IMMEDIATE` transaction (`TaskStore.update`): read the row → verify its hash → check
`expectVersion` → check the caller's lease and fence (worker commits) → check the transition table → write the row
(version + 1) → append the transition → atomically write any operation receipt, checkpoint, output and notification.
The store uses its own transaction helper rather than `HostDatabase.transaction`, because the latter degrades the whole
Host on any error, and an expected refusal (stale lease, version conflict) must not.

## Integrity and safe refusal

- Each row carries `record_sha256`; a mismatch, unparseable JSON, a wrong schema, a spec/envelope that fails its
  schema or its stored hash, or a step ledger that does not match the spec makes the row **corrupt**: it is listed as
  "Needs attention" and is never claimed, recovered or executed.
- `PRAGMA quick_check` at start; a failing database opens the runtime read-only (views, no execution).
- An interrupted transaction leaves nothing (tested: a writer dies after `BEGIN` + `INSERT` without `COMMIT`).

## Minimum data, no secrets

Persisted: the spec (needed to resume), the envelope, hashes, counters, receipts. Step inputs are bounded scalars
(≤ 8,000 chars each, ≤ 16 fields) and are refused if they match the credential patterns. Views, checkpoints and
notifications never include step inputs or outputs. No conversation history, provider state or credentials.

## Retention

Terminal tasks: newest 200 and ≤ 30 days; pruned with all their rows at Host start. Active tasks are never pruned.

Tests: `ma4-s2t1.test.ts` "T1 storage", "T1 crash-safe writes", "T1-14 malformed persisted records".
