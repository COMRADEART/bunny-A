# MA4-S3-T3R1 — User Approval & Crash Recovery Qualification

## 1. Consequential Approval Invariants

In Bunny A, read operations within granted project folders proceed autonomously, while consequential actions (disk modifications, file deletions, credential changes, external network calls) require explicit human approval.

### Invariant Rules
1. **Proposal Isolation:** Creating a task proposal does NOT execute tools or modify files. The task enters `AWAITING_APPROVAL`.
2. **"Run with Agents" Gate:** Execution only begins when the owner explicitly approves the proposal via `ptask.approve`.
3. **Payload-Bound Approval:** For consequential actions (such as `file.apply`), the Host computes the SHA-256 hash of the exact patch payload:
   ```ts
   const payloadSha256 = createHash("sha256").update(patchContent).digest("hex");
   ```
4. **Approval Presentation:** The exact file path, change summary, and `payloadSha256` are presented to the user in the Approval Center.
5. **Payload Mutation Invalidation:** If the file or patch payload is modified after approval was requested, the previous approval is invalidated fail-closed.
6. **No Auto-Grant:** An approval applies strictly to the specified action ID and payload digest; it does NOT grant broad future file write permissions.

---

## 2. Crash Recovery & UNCERTAIN State Handling

### State Transitions During Failure
```
                [Interruption / Crash]
             +----------------------------+
             |                            |
    [Read Operation]            [Consequential Operation]
             |                            |
      (No side-effects)           (State may have changed)
             v                            v
    [Bounded Auto-Retry]          [Marked UNCERTAIN]
             |                            |
             |                    (Never Auto-Replayed!)
             v                            v
       [Step Retries]             [Owner Reconciliation]
                                          |
                              +-----------+-----------+
                              |                       |
                       [Owner Confirms]        [Owner Rejects]
                              v                       v
                         [Marked DONE]        [Marked FAILED]
```

### Crash Recovery Invariants Verified in `ma4-s3-t3r1-approval-recovery.test.ts`
1. **Interrupted Read Actions:** Read-only operations (`file.read`, `local.test`) that are interrupted by process crash or timeout are bounded and may follow safe retry policies (up to 3 attempts).
2. **Interrupted Consequential Actions (UNCERTAIN):** Any action that has side effects (`file.apply`, `file.delete`, `service.send`) and is interrupted during or immediately after execution transitions to `UNCERTAIN`.
3. **No Automatic Replay:** The runtime strictly forbids automatic re-execution of an `UNCERTAIN` step. Replaying an unverified write could corrupt data or duplicate transactions.
4. **Owner-Only Reconciliation:** Only the workstation owner can reconcile an `UNCERTAIN` task via `ptask.reconcile` with decision `"happened"` or `"failed"`.
5. **Lease Expiry & Stale Workers:** If a worker lease expires, the Host reclaims the lease. A stale worker attempting to commit results after lease expiration is rejected with `LEASE_EXPIRED`.
6. **Persistence Across Restart:** All task history, step logs, approvals, and execution receipts stored in SQLite survive Host crashes and restarts without data corruption.
