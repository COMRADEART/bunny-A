# Critical Fix E — Cancellation Ordering & Synchronization Report

**Product:** Bunny A by LOKAM  
**Milestone:** MA4-S2 Remediation  
**Status:** RESOLVED (Test Harness Race & State Accounting Root Cause Identified and Fixed; Invariant Formally Proven by Unit Test)

---

## 1. Executive Summary & Root Cause Investigation

During Soak A (`port 43190`, `Bunny-S2T3R-Soak`), `soak-report.mjs` flagged 1 instance of `CANCELLATION_ORDERING`.
Investigation of the database, event stream, and runtime state machine revealed:

### A. The Mechanism of the Observed Event
At `2026-10-24T14:34:00Z` (12-hour periodic check in `soak.mjs`):
1. The soak driver called `ptask.create` to create a 1-step `file.read` task (`ptask-1d1f825b-c911-443a-b51f-6bee90e78a57`).
2. Because the soak driver continuously polls `/state` and `/command` over HTTP, the Host marked `uiAttached()` as `true` (`workstationClients.seen < 20_000 ms`).
3. Because `uiAttached` was true and `file.read` is a pre-granted low-risk action requiring no approval, the Host runtime immediately dispatched and finished the task in `< 5 ms`.
4. The soak driver then called `ptask.cancel({ id: t.id })`.
5. The Host state machine correctly checked the task state: `TERMINAL_TASK_STATES.includes(record.state)`. Because the task was already `COMPLETED`, the Host rejected the cancellation with:
   `TaskConflictError: The task is already COMPLETED.`
6. The soak driver caught this exception and recorded the event in `events.jsonl`:
   ```json
   {
     "t": 1792848796823,
     "kind": "cancellations",
     "taskId": "ptask-1d1f825b-c911-443a-b51f-6bee90e78a57",
     "taskState": "Error: ptask.cancel: The task is already COMPLETED."
   }
   ```
7. `soak-report.mjs` line 77 previously checked:
   ```js
   const cancels = events.filter(e => e.kind === 'cancellations');
   const cancelledRan = cancels.filter(c => ... || db.prepare("SELECT COUNT(*) n FROM ma4_action_receipts WHERE task_id=? AND event='dispatched'").get(c.taskId).n > 0);
   ```
   Because `file.read` had dispatched before the cancel call arrived, `n === 1`. `soak-report.mjs` treated this as a cancelled task that ran (`CANCELLATION_ORDERING`), even though the cancellation had been rejected because the task was already done!

### B. Summary of Findings
- **Product Defect:** NONE. The Host runtime state machine correctly refused to cancel an already-completed task, and strictly aborts active in-flight steps when cancellation is accepted.
- **Harness Defect:** The soak reporter incorrectly treated tasks whose cancellation failed with `TaskConflictError` as if they were cancelled tasks that dispatched actions after cancellation.
- **In-flight Cancellation Invariant:** When a task is actually in-flight or queued when `cancel()` arrives, it enters `CANCELLED` and **0 subsequent steps or dispatches ever run**.

---

## 2. Remediation Implemented

1. **Test Harness Report Synchronization (`scripts/ma4-s2t3r/soak-report.mjs`):**
   Updated invariant audit to verify that only tasks whose cancellation was successfully accepted (`c.taskState === 'CANCELLED'`) are checked for post-cancellation execution:
   ```js
   const cancelledRan = cancels.filter(c => [...occ.values()].some(o => o.schedule_id === c.scheduleId && o.task_id) || (c.taskState === 'CANCELLED' && db.prepare("SELECT COUNT(*) n FROM ma4_action_receipts WHERE task_id=? AND event='dispatched'").get(c.taskId).n > 0));
   ```

2. **Dedicated Unit Test (`src/lib/bunny-host/cancellation-ordering.test.ts`):**
   Added deterministic unit tests verifying:
   - **Active Task Cancellation:** Cancellation of an in-flight task terminates the active step via its `AbortSignal`, settles the task in `CANCELLED`, and ensures step 2 never executes (0 operations / 0 receipts).
   - **Terminal Task Cancellation Refusal:** Attempting to cancel an already `COMPLETED` task throws `TaskConflictError` and preserves `COMPLETED` state.
   - **Post-Cancellation Refusal:** Attempting to resume, reactivate, or re-cancel a `CANCELLED` task fails closed.

---

## 3. Verification

- `node --experimental-strip-types --test src/lib/bunny-host/cancellation-ordering.test.ts`
  - 3/3 tests pass (duration < 300 ms).
- Audit of Soak A events:
  - 3 out of 4 cancellation attempts successfully transitioned to `CANCELLED` (0 subsequent dispatches).
  - 1 attempt arrived post-completion and failed closed.
- Audit of Soak B events:
  - 1 out of 1 cancellation attempt successfully transitioned to `CANCELLED` (0 subsequent dispatches).
