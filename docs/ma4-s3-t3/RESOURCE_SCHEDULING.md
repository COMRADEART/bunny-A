# Resource Scheduling, Concurrency, and Lease Fencing

## 1. Local Resource Constraints

Bunny-A executes local AI workflows on consumer workstations where CPU, RAM, and GPU memory are shared with other user applications. Unconstrained spawning of model processes or memory-intensive tools risks system instability.

The Host Coordinator and `PersistentTaskRuntime` implement strict resource management:

```
                  ┌───────────────────────────────┐
                  │    Host Resource Monitor      │
                  │  (Free RAM, GPU VRAM, Leases) │
                  └───────────────┬───────────────┘
                                  │
         ┌────────────────────────┼────────────────────────┐
         ▼                        ▼                        ▼
  [ 4 GiB Free RAM Floor ]  [ Sequential VRAM ]    [ Concurrency Gate ]
   Blocks admission when     Groups steps by model  Bounds in-flight
   system memory is low      to prevent thrashing   calls to 1 per GPU
```

---

## 2. Scheduling Policies

### 1. Free Memory Floor
Before launching any inference worker or tool subprocess, the Host checks available system memory:
- **Floor Requirement:** 4 GiB free RAM minimum.
- **Action on Violation:** If available memory falls below 4 GiB, execution is deferred. The task enters state `PAUSED` with reason `RESOURCES_UNAVAILABLE` and detail:
  `"Free memory is below the 4 GiB floor."`
- The system retries during the next maintenance cycle once memory is freed.

### 2. VRAM Conservation & Sequential Model Grouping
Loading a 7B model requires 4.5 GiB to 5.5 GiB of VRAM. Attempting to run a Worker model and a Tester model simultaneously causes VRAM exhaustion and driver crashes.
- **Grouped Scheduling:** The Host groups steps assigned to the same model so they execute in succession.
- **Single Model in Flight:** Only one GPU-accelerated model inference runs at any given moment.

### 3. Wall-Clock and Call Budgets
Every task envelope specifies hard upper bounds:
```typescript
budgets: {
  maxModelCalls: 20,
  maxWallMs: 3_600_000 // 1 hour ceiling
}
```
If a task runs longer than its allowed wall time or makes more than its allotted model calls, the Host immediately terminates execution with `BUDGET_EXHAUSTED`.

---

## 3. Lease Fencing and Zombie Worker Elimination

In distributed or concurrent task execution, a worker process that hangs or loses communication must not be allowed to commit changes after another worker has taken over.

### The Lease Protocol:
1. When a worker claims a task, it receives a **lease** with an expiration timestamp (`now + leaseMs`, default 30 seconds).
2. The active worker sends periodic heartbeats during maintenance cycles (`maintain()`).
3. If a worker fails to heartbeat before the lease expires, the Host considers the lease lapsed.
4. **Fencing Tokens:**
   - Every state change in SQLite increments the task's `version`.
   - When a worker attempts to commit a step result, it must present the exact `lease` and `version` it received when claiming the task.
   - If the task was reclaimed by another worker or recovered by the Host, the commit fails with `StaleLeaseError`.
   - The stale worker's outputs are discarded and its subprocesses are killed.
