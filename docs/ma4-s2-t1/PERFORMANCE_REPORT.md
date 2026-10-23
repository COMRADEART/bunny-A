# MA4-S2-T1 — Performance report

## 1. Pre-registered targets (committed before any measurement)

Registered 2026-10-23, before `scripts/ma4-s2t1/bench.mjs` or `scripts/ma4-s2t1/live-qualify.mjs` produced a number.
The targets do not change after results are seen; a missed target is reported as missed.

| # | Metric | Method | Target |
|---|---|---|---|
| P1 | Durable task creation latency | `create()` on a file-backed WAL database, 200 tasks | p95 ≤ 25 ms |
| P2 | Task claim latency | one scheduler `tick()` claiming one queued task | p95 ≤ 25 ms |
| P3 | Checkpoint write overhead per step | runtime bookkeeping per step (start + receipt + checkpoint), executor work excluded | p95 ≤ 20 ms |
| P4 | Task-state query latency | `snapshot()` with 200 tasks in the store | p95 ≤ 50 ms |
| P5 | Host restart recovery duration | `start()` (integrity check + recovery) with 50 interrupted tasks, no orphan processes | ≤ 1,000 ms |
| P6 | Memory overhead of the durable queue | RSS increase after creating 200 tasks (heap-settled) | ≤ 20 MB |
| P7 | Concurrent task fairness | 2 projects × 10 queued tasks; longest run of consecutive claims from one project while both have work | ≤ 2 |
| P8 | Model scheduling impact | peak concurrent model calls across all tasks (Host-wide gate) | = 1 |
| P9 | CPU while idle | real Host process, no client, no running task, CPU time over 60 s | ≤ 1 % of one core |
| P10 | Process cleanup reliability | 10 crash/recover cycles with a real tracked child each | 0 surviving children |
| P11 | Real Host restart to correct task state | real Host process killed during real local inference; time from restart to a correct, persisted task state | ≤ 15 s |

Measurement rules: model inference and the full regression suite never run at the same time; the benchmark uses
recorded fake executors (no model); the live qualification uses the real Host process and the real local Ollama model.
