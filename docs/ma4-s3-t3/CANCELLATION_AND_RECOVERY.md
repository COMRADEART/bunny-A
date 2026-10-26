# Cancellation, Restart Recovery, and Failure Safety

## 1. Universal Cancellation Propagation

Bunny-A supports immediate, deterministic cancellation across every phase of task execution. When the user clicks Stop or issues `task.stop`, cancellation propagates instantly through the Host path.

### Cancellation Response Across Execution Phases:

| Execution Phase | Cancellation Behavior | State Result |
|---|---|---|
| **Before Team Starts** (Queued / Proposed) | Proposal is abandoned or task is dequeued immediately without claiming a worker lease. | `CANCELLED` |
| **During Planning** | Active LLM generation is aborted via `AbortSignal`; incomplete plan is discarded. | `CANCELLED` |
| **During Model Generation** | Inference socket to Ollama is closed; GPU frees allocated compute buffers immediately. | `CANCELLED` |
| **During Tool Call** (e.g., file read) | Tool execution aborts; no partial data is committed to the evidence chain. | `CANCELLED` |
| **During Deterministic Verification** | Test runner subprocess is terminated via `process.kill()`; no orphaned background processes remain. | `CANCELLED` |
| **Awaiting Approval** | The pending approval request is cancelled; any staged temporary diffs are wiped. | `CANCELLED` |

---

## 2. Restart Recovery and Exact-Once Semantics

When the Host crashes, is terminated, or the workstation reboots mid-execution, `PersistentTaskRuntime.recover(startup: true)` executes upon revival to restore system invariants.

```
                   Host Restarts mid-execution
                               │
            ┌──────────────────┴──────────────────┐
            ▼                                     ▼
   Interrupted Step is                   Interrupted Step is
    Read-Only / Safe                      Irreversible / Consequential
            │                                     │
   State -> RESUMING                     State -> UNCERTAIN
   Step is retried once                  Halts until Workstation Owner
                                         decides what happened
```

### 1. Read-Only Step Recovery
- If a read-only step (`file.read`, `local.generate`, `local.test`) was interrupted, the Host transitions the task to `RESUMING`.
- The step is retried once cleanly from its recorded inputs.

### 2. Irreversible Step Recovery: The `UNCERTAIN` State
- If an irreversible operation (e.g. `file.apply`, `notify.send`) was interrupted after intent was committed (`after-operation-start`) but before an execution receipt was written:
  - The Host **cannot know** whether the side effect actually occurred on the external system.
  - The task transitions to `UNCERTAIN`.
  - Truthful UI state is `Uncertain`.

### 3. Workstation Owner Reconciliation
- An `UNCERTAIN` task is strictly fenced:
  - Phone or remote devices **cannot** cancel or settle the task (`"An uncertain action must be reconciled on the Windows workstation"`). Blind remote settlement is prohibited.
  - The workstation owner must choose one of three explicit options:
    1. `"happened"`: Owner confirms the effect occurred; Host records owner-attested receipt and proceeds.
    2. `"not_happened"`: Owner confirms the effect did not occur; Host resets step to `pending` for retry.
    3. `"abandon"`: Owner abandons the operation; task transitions to `FAILED`.
