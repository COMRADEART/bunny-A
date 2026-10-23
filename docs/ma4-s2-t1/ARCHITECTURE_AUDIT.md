# MA4-S2-T1 — Architecture audit (Phase 0)

## Baseline

| Fact | Verified value |
|---|---|
| PR #18 | MERGED 2026-10-23T16:12:04Z into `ma4-s1r3-agent-reliability` (not `main`) |
| Merge commit | `2cba36b` (head `e939cd0`) |
| Integration branch | `ma4-s1r3-agent-reliability` = `2cba36b`; PR #19 (→ `main`) open |
| Starting SHA | `2cba36b` |
| Worktree / branch | `../bun-router-s2t1`, `ma4-s2-t1-persistent-runtime` (new; all other worktrees untouched) |
| Baseline `test:ma4` at `2cba36b` | 117 pass / 1 skip / 0 fail (same as S2R1) |

Fresh-worktree setup (as recorded after S2R1): git-ignored `native/voice/vendor/` and
`releases/installed/JEV-Windows-v1/runtime/LICENSE` copied from the main checkout; `npm ci`; `npm run pretest`. The
rebuilt tracked voice binaries are restored, never committed.

## What already existed and is reused

| Need | Existing mechanism (reused) |
|---|---|
| Host independent of any window | The Host is its own hidden `node` process (`scripts/bunny-host.mjs` via `start-bunny-host.ps1` / `Start-Bunny-Release.ps1`); the Island and dashboard are clients. Closing them never stopped the Host. |
| Local durable storage | `HostDatabase` (node:sqlite, WAL, `migrations` table) — additive owner-created tables, as MA3 T4 and MA4 stores do. |
| Checkpoint material guard | `scanCheckpointJson` / `CHECKPOINT_SECRET_PATTERNS` (MA3 T4) — every task checkpoint and every step input passes it. |
| Uncertain irreversible work never replayed | S2 `TeamRuns` design (start recorded before work; irreversible in-flight → uncertain; owner decides) and MA3 `classifyReplay`. The new runtime implements the same rule with receipts and fencing. |
| Command idempotency | Host `/command` ledger keyed by `operationId`, plus Host-identity/epoch expectations. Task commands inherit it. |
| Phone authority | Default-deny `DEVICE_RIGHTS` / `assertDeviceAction`; device snapshot projection. |
| Stale view semantics | Phone `phoneStatus` (live / stale / offline) and the store's `canAct()`. |
| One GPU-heavy call at a time | S2 Coordinator `gateCalls` (grouped schedule — the one measured S2 win). Reused Host-wide. |
| Local inference with pin checks | `execute()` (Ollama, `localOnly`, refuses a missing model and hosted tags; returns the served-model receipt). |
| Notch placement | `Get-BunnyPlacement` / `Get-BunnyIndicatorLayout` (horizontal → indicators left; side → indicators top). |
| Process cleanup | libuv kill-on-close Job (children die with the Host); `processTable` / `sameProcessIdentity` / `killProcess` for identity-verified termination. |

## What was missing (built in this milestone)

- A durable *task* record with the brief's state machine (`CREATED … UNCERTAIN`), per-row version and an append-only
  transition history. (MA3 Agents derive state from Missions; S2 `TeamRuns` had no versioning, leases or receipts.)
- Leases with fencing tokens so a superseded worker cannot commit.
- An owner-issued, hash-bound, expiring authorization envelope and approval per task.
- An operations ledger distinguishing read-only / idempotent / irreversible work, with receipts.
- Background-execution and startup policies (both default OFF).
- A deduplicated local notification outbox.
- Host wiring, notch and phone projections.

## Not reimplemented / preserved

MA4-S1 routing, S2 collaboration protocol, Lotus Memory filtering, the S2R1 relevance gate and the voice fix are not
touched. The grouped scheduler is reused unchanged. Skill and memory injection stay OFF (nothing in the runtime reads
skills or memory). Cloud inference stays disabled (an envelope cannot express a non-Ollama provider).
