# MA4-S2-T1 — Permissions and approvals

## Authorization envelope (issued by the workstation owner with the task)

| Field | Meaning |
|---|---|
| `capabilities` | Executor kinds the task may use |
| `providers` | Exactly `["ollama"]` — a literal; cloud inference is not expressible |
| `localOnly` | Exactly `true` |
| `models` | The only models any step may pin |
| `projectScopes` | The project the task belongs to must be listed |
| `sideEffects` | Whether side-effecting executors are allowed at all |
| `background` | Whether the task may run with no window attached (still subject to the owner's global policy) |
| `budgets` | `maxModelCalls`, `maxWallMs` |
| `expiresAt` | Hard end of the task's authority; a deadline cannot lie beyond it |

The envelope and the spec are hashed at creation. Nothing in a task spec, step input, retrieved memory, skill or model
response can change them: they are never re-read from any of those, and a stored row whose envelope no longer matches
its hash (or widens a provider) is refused as corrupt.

## When approval is required

Whenever impact demands it: any side-effecting or non-read-only executor, or background execution. Approval is
workstation-only, binds the exact spec and envelope hashes, and always expires (default 24 h, max 7 days, never past the
envelope). A saved task cannot turn a historical approval into standing authority: an expired approval returns the task
to "Waiting for approval" before any further work (tested after a 3-hour Host restart).

## Re-verified before every step and every recovery

Revocation (→ FAILED `AUTHORITY_REVOKED`), envelope expiry (→ FAILED `ENVELOPE_EXPIRED`), deadline (→ FAILED
`DEADLINE_MISSED`), approval (→ AWAITING_APPROVAL), pinned model availability (→ PAUSED, Needs attention), memory floor
(→ PAUSED, Needs attention), background policy (→ PAUSED at the next boundary).

## Who may do what

Creation, approval, reconciliation, revocation and policy are workstation-only (`isTrustedLocalActor`), enforced in the
runtime and again at the HTTP boundary (`DEVICE_RIGHTS` default-deny). A paired device may read, pause, resume, cancel.

Cloud inference: disabled. Skill and memory injection: disabled (the runtime reads neither).
