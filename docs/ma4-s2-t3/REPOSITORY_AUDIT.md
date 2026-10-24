# MA4-S2-T3 — Repository and baseline audit (T3-G1)

Audited 2026-10-23/24 before any code was written.

## S2-T2 integration state

| Item | Finding |
|---|---|
| PR #24 (`ma4-s2-t2-connected-actions` → `ma4-s1r3-agent-reliability`) | **MERGED** 2026-10-23 23:04 UTC as merge commit `bddd575` |
| PR #25 (same head `8d6ea3b` → `main`) | **CLOSED, not merged**. Identical head and file set to #24; it was a duplicate target, not separate work |
| Overlap between #24 and #25 | 100 % (same head commit). Nothing to reconcile: #24 is the integration of record |
| `main` | Does **not** yet contain S2-T2 (`git merge-base --is-ancestor 8d6ea3b origin/main` → false). Latest `main` merge is #23 (`c7c0493`), which predates #24 |
| CI on `8d6ea3b` (PR #24/#25 head) | All three jobs green (runs 40033623988, 40036715552) |
| CI on `bddd575` (integration branch push) | In progress at audit time (run 40037492240) |
| Open merge blockers | None found on #24 (merged). Promoting `ma4-s1r3-agent-reliability` to `main` is an owner decision, not part of this milestone |

**Base SHA: `bddd57575aa1e471c22a7374a5101c61ebba5abd`** (the actual integration merge commit).
Branch `ma4-s2-t3-proactive-companion`, isolated worktree `../bun-router-s2t3`. No PR was merged by this work.

## What was reused (no second persistence or execution system)

| Need | Reused component |
|---|---|
| Durable state | The Host's own SQLite file (`HostDatabase`), additive tables only, same `BEGIN IMMEDIATE` + record-SHA-256 pattern as `task-store.server.ts` |
| Execution of scheduled work | S2-T1 `PersistentTaskRuntime`: leases, fencing, exactly-once operation ledger, UNCERTAIN, background/restart policy, model pins, budgets, one-GPU-call gate |
| Effects on files, pages, accounts | S2-T2 permission broker (`brokered()`), grants, payload-bound action approvals, receipt chain |
| Monitored files | S2-T2 `FileRootRegistry` + `walk()`/`readText()` (traversal, link, ADS, protected-name and identity checks) |
| Approvals of consequential actions | S2-T2 Approval Center (`action.approve` / `action.deny` with payload hash), unchanged |
| Device rights | `DEVICE_RIGHTS` default-deny table; new actions added explicitly |
| Notifications | New proactive journal next to `ma4_task_notifications`, same key-is-identity dedup |
| Notch | `Get-BunnyTaskStrip` (one cell in the agent strip, existing placement rule) extended, not duplicated |

## Existing facilities inspected

* `ma4/task-runtime*.ts`, `task-store.server.ts`, `task-commands.server.ts`, `task-executors.server.ts` (S2-T1).
* `ma4/action-broker.server.ts`, `connected-actions.server.ts`, `connectors/*` (S2-T2).
* `http.server.ts` wiring (start order, port guard before state, close order), `device-authority.server.ts`,
  `presentation.ts`, `contracts.ts`, `use-island.ts`, `ptasks.tsx`, `install/Bunny-Island.*.ps1`.
* There was **no** time-based scheduler before this milestone (the MA3 "scheduler" is a model-routing setting).

## One runtime change

`PersistentTaskRuntime.approveScheduled()` (Host-internal, unreachable from any command): approves one occurrence task
created from an owner-approved schedule, binding the same spec/envelope hashes, logging `schedule:<id>` as the actor,
and refusing whenever a consequential action is pending (those stay with the owner).
