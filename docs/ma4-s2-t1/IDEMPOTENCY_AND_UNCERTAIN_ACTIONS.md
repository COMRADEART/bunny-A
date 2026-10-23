# MA4-S2-T1 — Idempotency and uncertain actions

## Categories come from the executor, not the task

An executor declares `category` (`read_only` | `idempotent` | `irreversible`) and `sideEffect`. A task spec only names
the executor kind; it cannot relabel an irreversible action as read-only. Idempotent executors must implement
`verify(idempotencyKey)` or the runtime refuses to register them. The idempotency key is stable per step:
`<taskId>:<stepId>`, the same across attempts and Host lives.

## Product executors in this milestone

Exactly one: `local.generate` (read-only, local Ollama on a pinned model). **No consequential executor exists** —
no send, publish, delete, remote update, form submission, purchase or account change. A task asking for one is
refused at validation ("No registered executor"). The irreversible and idempotent paths are exercised only against
recorded fake services in the tests (`external.send` writes to an in-memory/file ledger; `external.upsert` keyed by
idempotency key). Nothing was sent, published or bought.

## No exactly-once claim beyond what the receipt supports

The runtime guarantees: an irreversible operation is started at most once automatically; an outcome without a
trusted receipt becomes UNCERTAIN and is never converted to success without evidence. It does **not** claim
exactly-once delivery at the external service: if a service lacks idempotency keys and its reply is lost, only the
owner can say whether it happened.

## Owner reconciliation (workstation only)

| Decision | Effect |
|---|---|
| It happened | Operation `succeeded` with an `owner-attested` receipt; the step is done; nothing is re-sent. |
| It did not happen | Operation `failed`; one fresh attempt is authorized (within the step's attempt budget). |
| Stop the task | Task FAILED (`OWNER_ABANDONED`); the operation stays recorded as `uncertain`. |

A paired phone sees "Needs attention" and "Approve or resolve this on your PC"; it cannot reconcile.

Tests: `T1-5` × 5 crash boundaries, idempotent verify-by-key, cancel-during-send, and the real-process send test —
**0 duplicate consequential operations** in every scenario.
