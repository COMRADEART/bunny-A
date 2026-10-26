# MA4-S3-T3R2: Consequential Action Approval and Crash Recovery Architecture

**Product:** Bunny A by LOKAM  
**Milestone:** MA4-S3-T3R2 — Security Boundary Closure, Execution Containment & Production Qualification  
**Target:** Approval Lifecycle, Payload Cryptographic Binding, and UNCERTAIN Crash Recovery  

---

## 1. Executive Summary

Autonomous agent architectures that execute filesystem modifications, external process invocations, or irreversible notifications face two fatal operational risks:
1. **Unreviewed / Phantom Side Effects**: An agent altering system state without the user inspecting the exact payload.
2. **Crash-Replay Hazards**: If the host process terminates while an irreversible action is underway, blindly replaying the transaction on restart can duplicate side effects, corrupt data, or re-trigger dangerous operations.

Bunny A addresses these challenges through a strict, deterministic **Consequential Action Approval Broker** and an **Atomic State Recovery Engine** that settles in an `UNCERTAIN` state when idempotency cannot be guaranteed.

---

## 2. Consequential Action Approval Architecture

In Bunny A, all task steps are classified according to their potential impact on the host system:
- **Read-Only / Pure Queries**: E.g., `file.read`, `system.status`. Executed within authorized envelope grants without pausing for interactive confirmation.
- **Consequential Actions**: E.g., `file.apply`, `notify.critical`, `process.launch`. Must be encapsulated in an `ActionProposal` and submitted to the `ActionBroker`.

```
     +-------------------------------------------------------------------+
     |                        Task Runtime Step                          |
     +-------------------------------------------------------------------+
                                       |
                           Is Step Consequential?
                                       |
                    +------------------+------------------+
                    | NO                                  | YES
                    v                                     v
       [ Execute Immediately ]                  [ Generate ActionProposal ]
                                                          |
                                                          v
                                            [ Compute SHA-256 Digest ]
                                                          |
                                                          v
                                            [ State: AWAITING_APPROVAL ]
                                                          |
                                      +-------------------+-------------------+
                                      | User Approves                         | User Cancels
                                      v                                       v
                              [ State: APPROVED ]                    [ State: CANCELLED ]
                                      |                                       |
                                      v                                       v
                            [ Execute Step ]                         [ Step Aborted ]
```

### Immutable Payload Binding

When an action proposal is submitted, the broker does not simply store the proposal description; it computes and locks a cryptographic hash of the exact execution payload:
```typescript
const payloadSha256 = crypto
  .createHash("sha256")
  .update(JSON.stringify(action.payload))
  .digest("hex");
```
When the workstation owner inspects the proposal in the desktop UI or via API, the exact hash is displayed. When approval is submitted:
1. The approval must come from actor `"workstation"`.
2. The payload is re-verified against `payloadSha256`. If the file on disk or the task step modified the payload in memory after proposal generation, approval fails with `PAYLOAD_TAMPERED`.
3. If valid, the proposal transitions to `APPROVED` and execution proceeds.

---

## 3. Crash Recovery and the UNCERTAIN State

When the Bunny A Host daemon restarts, it inspects `task-store.server.ts` to reconcile tasks that were in progress at the time of shutdown.

```
       [ Host Daemon Initializes ]
                    |
                    v
       [ Scan Stored Task Snapshots ]
                    |
    +---------------+---------------+
    |                               |
[ Status == RUNNING ]     [ Status != RUNNING ]
    |                               |
    v                               v
Is Current Step Irreversible?    [ Normal State Preserved ]
    |
    +-------------------+
    | YES               | NO (Pure / Idempotent)
    v                   v
[ State: UNCERTAIN ]  [ Re-queue Step ]
    |
    v
[ Log Alert: Manual Reconciliation Required ]
    |
    v
[ Operator Inspects Disk & Calls reconcileTask() ]
    |
    v
[ Settle Cleanly: COMPLETED or CANCELLED ]
```

### The Inviolable Rules of UNCERTAIN Recovery

1. **Never Blindly Replay**:
   If an operation was marked `category: "irreversible"` (such as sending a network notification or invoking an un-checkpointed system mutation), the Host **never** automatically restarts the step upon recovery. Doing so could duplicate payments, double-send notifications, or corrupt shared files.
2. **Immediate UNCERTAIN Settlement**:
   The task runtime marks the task's state as `UNCERTAIN` and records the exact in-flight operation key (e.g., `taskId:stepId`).
3. **Owner-Gated Reconciliation**:
   The task remains frozen in `UNCERTAIN` until the workstation owner explicitly inspects the environment and issues a reconciliation directive:
   - If the operator determines the effect completed cleanly: `reconcileTask(taskId, "workstation", { resolution: "mark_completed" })`.
   - If the operator determines the effect was aborted: `reconcileTask(taskId, "workstation", { resolution: "retry" })` or `cancel(taskId)`.
4. **No Silent State Concealment**:
   The Host logs a structured security event: `TASK_UNCERTAIN_ON_RESTART`, making the ambiguity visible in system health logs and the desktop status notch.

---

## 4. Verification Evidence

The crash recovery semantics were qualified in live test suites:
- In `ma4-s3-t3r2-live-ollama.test.ts` (Workflow F):
  - Task `ptask-f19df74a-ab38-4cd2-9bc3-8de06250376b` had an irreversible step in flight.
  - The runtime simulated an ungraceful shutdown.
  - Upon reboot, `recoveredState` was verified as `UNCERTAIN`.
  - Automatic replay was confirmed **not triggered**.
  - Operator reconciliation transitioned the task to `QUEUED` and then `COMPLETED` within 213ms.
- In `ma4-s3-t3r2-held-out-eval.test.ts` (Case C30 & C31):
  - Verified that concurrent crashes preserve snapshot integrity and require human sign-off before retrying unverified mutations.

---

## 5. Conclusion

By separating idempotent queries from consequential mutations, locking proposal payloads with SHA-256 digests, and failing safely into `UNCERTAIN` upon host interruption, Bunny A guarantees that no destructive side-effect can occur without explicit, informed human consent.
