# MA4-S3-T0 — Current Architecture

**Baseline branch tip at doc draft:** see `BASELINE_AND_BRANCH_AUDIT.md`  
**Principle:** Host is authority; UI is a projection.

## Dual execution paths (intentional, not unified in T0)

| Path | Entry | State machine | Used by |
|---|---|---|---|
| OrchTask / Mission | Island `submit` / `mission.create` | `orch/types` + MissionManager | Main prompt, voice drafts |
| PersistentTask (MA4) | `ptask.create` / schedules | `TASK_STATES` in `task-runtime.ts` | Proactive schedules, Approval Center, tests |

T0 does **not** rewrite the main prompt onto `ptask` (would be a large product change). Schedules and connected workflows remain the production ptask creators. Planner (`ptask.plan`) stays preview-only until the owner creates/approves.

## Request path (MA4 ptask)

```
UI/API → host-bridge → Host /command (bearer|device)
  → assertDeviceAction / workstation check
  → OperationLedger (exactly-once command id)
  → ptaskCommand → PersistentTaskRuntime
  → ActionBroker (schema → grants → approval → connector)
  → TaskStore receipts + ActionLedger hash chain
  → emit(ptask.*, detail, taskId) → events + SSE wake
  → client poll/snapshot projection
```

## Components (summary)

See `CAPABILITY_MATURITY_MATRIX.md` for maturity class per component.

## S3-T0 integration repairs (this milestone)

1. `emit` wrapper now passes `taskId` into `db.event` (`http.server.ts`).
2. `UNCERTAIN` cannot transition via `cancel`; phone/PC must `reconcile` (`task-runtime.server.ts` + `TASK_NEXT`).
3. UI hides Cancel for UNCERTAIN (`ptask-model.ts`).
4. `LocalBetaFeedbackStore` optional durable file + Host `feedback.*` commands.
5. Session browser notifications route through `evaluateNativeNotification` (OS tray still NOT IMPLEMENTED).
6. Runtime limit timers `.unref()` to stop agent-team force-exit hang root cause.
