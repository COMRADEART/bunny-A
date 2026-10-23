# MA4-S2-T1 — Crash-injection results

All scenarios use recorded fake external services (an in-memory or file ledger of "sends" and a keyed "upsert"
store). Nothing was sent, published, deleted or bought. Counts below are what those ledgers recorded.

## A. Fault hook at every state boundary (`ma4-s2t1.test.ts`)

The hook stops the runtime with no further write and closes its database connection; a new runtime opens the same
file 60 s later (fake clock) with `resumeOnStart` on, then recovery and scheduling run three more times.

| Crash point | State after restart | External sends after crash | After repeated recovery | Final | Total sends |
|---|---|---|---|---|---|
| after-claim (nothing started) | RESUMING | 0 | sent once by the new owner | COMPLETED | **1** |
| before-operation-start | RESUMING | 0 | sent once | COMPLETED | **1** |
| after-operation-start (intent recorded, not sent) | UNCERTAIN | 0 | still 0 while the owner decides | owner: "did not happen" → COMPLETED | **1** |
| after-effect (sent, no receipt) | UNCERTAIN | 1 | still 1 | owner: "happened" → COMPLETED | **1** |
| after-receipt (sent and receipted) | RESUMING | 1 | not re-sent (receipt consumed) | COMPLETED | **1** |
| idempotent upsert, after-effect | RESUMING, op `needs_verify` | 1 apply | `verify(key)` found it | COMPLETED | **1 apply** |
| cancel during a dispatched send | UNCERTAIN | 1 | still 1 | — | **1** |

Other boundary scenarios: read-only step killed after its effect (retried once, COMPLETED, 2 reads); three queued
tasks with dependencies recovered in order A → B → C; a stuck worker superseded by a second Host whose takeover bumped
the fence — the old worker's commit was refused (`ptask.stale_worker_rejected`) and the direct stale write threw
`StaleLeaseError`; two Hosts ticking at once produced exactly one claim; expired approval / expired envelope /
revocation after a 3-hour restart (0 sends); pinned model missing after recovery (no substitute model called);
notifications identical across four Host lives (one approval, one recovery-blocked, one completed); three crash cycles
with a tracked child each (no child survived; the step's attempt budget then failed the task honestly).

## B. Real process kill (`ma4-s2t1-process.test.ts`)

A stand-in Host process (`scripts/ma4-s2t1/crash-runner.mjs`) owns the store and runtime, starts a step and is killed
with `taskkill /F` (no `/T`).

| Scenario | Result |
|---|---|
| Read-only step with an ordinary child | The child died with the Host (libuv kill-on-close Job); recovery dropped the stale process record; the step re-ran once; COMPLETED |
| Read-only step with an escaped (detached) child | The child outlived the Host; recovery verified its identity (pid, creation time, image) and terminated it with the reviewed native helper; step re-ran once; COMPLETED |
| Irreversible send, reply lost, Host killed | 1 line in the external ledger; UNCERTAIN in each of three Host lives; one recovery-blocked notification in total; owner "happened" → COMPLETED; still 1 line |

## C. Real Host, real local model (`scripts/ma4-s2t1/live-qualify.mjs`, evidence `live-qualification.json`)

Real `scripts/bunny-host.mjs` process, isolated application data, no window attached at any time, pinned
`qwen2.5-coder:7b` on the local Ollama:

1. Background off: a queued task stayed QUEUED for 25 s.
2. Background on: a two-step task was approved and ran. The Host was killed with `taskkill /F` while step g2's local
   model call was in flight (ledger: g1 succeeded, attempt 1; g2 started, no receipt).
3. Restart: correct persisted state in 909 ms (RESUMING → PAUSED "Bunny-A restarted"); nothing ran for the next 10 s.
4. Resume (still no window): COMPLETED in 1.5 s; g1 consumed (attempts 1), g2 re-ran once (attempts 2); served model
   equalled the pin on both steps; two output receipts (570 and 81 characters; hashes in the evidence file).
5. A task pinned to the hosted tag `deepseek-v4.1-flash:cloud` was blocked (PAUSED, MODEL_UNAVAILABLE) and never ran.

## Totals

Unauthorized actions: **0**. Duplicated consequential operations: **0** in every tested scenario. Every uncertain
outcome stayed uncertain until the owner resolved it.
