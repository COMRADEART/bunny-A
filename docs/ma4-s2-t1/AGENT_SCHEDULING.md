# MA4-S2-T1 — Persistent task scheduling

| Requirement | Mechanism |
|---|---|
| Dependency-aware ordering | A task is claimable only when every `dependsOn` task is COMPLETED. Dependencies must exist at creation and belong to the same project (no cycles can form). A FAILED/CANCELLED/missing dependency fails the dependent (`DEPENDENCY_FAILED`). |
| Fairness | Among ready tasks, the project served longest ago goes first, then the oldest task (measured: strict alternation between two projects, P7). |
| Resource-aware model execution | GPU steps check the pinned model is installed locally and the free-memory floor (4 GiB, same as the S2 evaluation); otherwise the task pauses as Needs attention. |
| Grouped scheduler preserved | One Host-wide `gateCalls` instance (S2 Coordinator) with `maxConcurrent: 1`: one GPU-heavy model call at a time across all tasks (measured peak 1, P8). No measured headroom on this 6 GiB GPU justifies more. |
| Hard model pins | A GPU step's model is the step's pin; it must be in the envelope; the served-model receipt must equal it (`PIN_VIOLATION` otherwise). An unavailable pin blocks; no other model or provider is ever substituted. Hosted Ollama tags are refused (`localOnly`). |
| Concurrency | At most 2 active tasks per Host (`maxActive`), each sequential over its steps. |
| Cancellation propagation | Cancel aborts the step's signal (model call, child processes); children are killed; the outcome is recorded honestly (UNCERTAIN if an irreversible step was dispatched). |
| Pause / resume | Pause lands at the next step boundary; resume goes through RESUMING and re-authorization. |
| Timeouts | Per-executor timeout (`local.generate`: 300 s) and the Host-wide gate timeout. |
| Bounded retries | Per-step `maxAttempts` (1–3, default 2); task budgets `maxModelCalls` and `maxWallMs`. |
| Interrupted task graphs | Recovery reclassifies each task's in-flight step; dependency order is preserved after restart (T1-6). |
| Duplicate active workers | Claims are conditional on version and lease; a second Host cannot claim a leased task; a superseded worker's commits are refused by the fence (T1-7). |
| Inactive tasks consume nothing | Only RUNNING tasks call models; paused, queued, waiting and uncertain tasks do no inference. Recovery makes no model calls. |

The existing CPU/RAM/GPU thermal guards, sandbox, routing and quota protections are untouched; the runtime never
routes, and the only model path is the existing local `execute()`.
