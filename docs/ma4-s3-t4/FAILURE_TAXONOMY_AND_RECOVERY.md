# MA4-S3-T4 Failure Taxonomy and Safe Recovery Policy

**Product:** Bunny A by LOKAM  
**Milestone:** MA4-S3-T4  
**Modules:** `src/lib/bunny-host/ma4/failure-recovery.ts`, `src/lib/bunny-host/ma4/coordinator.ts`  

---

## 1. Failure Taxonomy Classification

Bunny A MA4-S3-T4 replaces ad-hoc LLM retry loops with a **deterministic Host failure taxonomy**. Errors occurring during task execution are classified into seven discrete codes:

```typescript
export const FAILURE_TAXONOMY = [
  "TRANSIENT_RESOURCE_OVERLOAD", // High GPU/VRAM load, Ollama busy
  "MODEL_TIMEOUT",              // Inference wall clock limit exceeded
  "TOOL_EXECUTION_ERROR",       // Non-zero exit code or filesystem failure
  "PERMISSION_DENIED",          // Unregistered path or unauthorized resource
  "POLICY_VIOLATION",           // Model pin mismatch, envelope expiry
  "UNCERTAIN_SIDE_EFFECT",      // Interrupted irreversible external action
  "ACCEPTANCE_UNMET",           // Acceptance criteria verification failed
] as const;
```

---

## 2. Recovery Decision Matrix

| Failure Code | Classification | Automatic Recovery Action | Max Retries | Backoff Strategy | Escalation Requirement |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `TRANSIENT_RESOURCE_OVERLOAD` | **Recoverable** | Delay and retry model call | 2 | Exponential ($200\text{ms} \times 2^n$) + jitter | Fails task if exhausted |
| `MODEL_TIMEOUT` | **Recoverable** | Single retry with compact context | 1 | 500ms fixed backoff | Fails task if exhausted |
| `TOOL_EXECUTION_ERROR` | **Conditionally Recoverable** | Retry if operation is `read_only` or `idempotent` | 1 | 250ms fixed backoff | Irreversible ops enter `UNCERTAIN` |
| `PERMISSION_DENIED` | **Non-Recoverable** | **Zero automatic retries** | 0 | None | Requires owner authorization envelope |
| `POLICY_VIOLATION` | **Non-Recoverable** | **Immediate fail-closed halt** | 0 | None | Operator inspection |
| `UNCERTAIN_SIDE_EFFECT` | **Approval Required** | **Zero automatic retries** | 0 | None | Halts in `UNCERTAIN`; requires operator reconciliation |
| `ACCEPTANCE_UNMET` | **Repair Eligible** | Bounded single repair plan | 1 | None | Evaluated via `replan.server.ts` |

---

## 3. Safe Recovery Contracts

### 3.1 Idempotency and Side Effect Fencing
- Operations categorized by Host executors as `irreversible` (e.g. sending emails, remote API mutations, permanent file deletions) are **strictly forbidden** from automatic replay.
- If a crash, lease expiration, or network drop occurs while an irreversible operation is in flight, the task transitions immediately to `UNCERTAIN`.
- The task remains frozen in `UNCERTAIN` until the operator inspects the state on the Windows workstation and issues a reconciliation directive (`happened`, `not_happened`, or `abandon`).

### 3.2 Cancellation Propagation in Model Gate (`coordinator.ts`)
Prior systems suffered from "zombie model calls": when an operator cancelled a task, queued requests already awaiting entry into the model gate would still execute once a slot opened.

In MA4-S3-T4:
1. `gateCalls` registers an explicit `abort` listener on the caller's `AbortSignal` upon queue insertion.
2. If the signal aborts while queued:
   - The waiter is immediately spliced out of the queue array.
   - The queue memory is released.
   - The promise rejects immediately with `AbortError`.
   - The model call slot is never acquired, preventing GPU thrashing and unwanted inference.

### 3.3 Backoff Calculation Formula

$$T_{\text{wait}} = \min(M_{\text{max}}, T_{\text{base}} \times 2^{\text{attempt}} + \text{random}(0, J_{\text{max}}))$$

Where:
- $T_{\text{base}} = 200\text{ ms}$
- $M_{\text{max}} = 2000\text{ ms}$
- $J_{\text{max}} = 100\text{ ms}$
- Active sleep timers register an abort listener to wake up immediately upon task cancellation without lingering.
