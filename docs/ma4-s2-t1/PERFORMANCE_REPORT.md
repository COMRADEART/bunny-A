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

## 2. Results (measured after §1 was committed in `d0bafcc`)

Benchmark: `node --expose-gc --experimental-strip-types scripts/ma4-s2t1/bench.mjs` → `evidence/bench.json`
(Node v24.18.0, win32-x64, file-backed WAL database, recorded fake executors). Live: `scripts/ma4-s2t1/live-qualify.mjs`
→ `evidence/live-qualification.json` (real Host process, real `qwen2.5-coder:7b` on local Ollama).

| # | Metric | Target | Measured | Verdict |
|---|---|---|---|---|
| P1 | Durable task creation | p95 ≤ 25 ms | p50 11.0, **p95 12.4**, max 19.3 ms (n = 200) | PASS |
| P2 | Task claim | p95 ≤ 25 ms | p50 15.7, **p95 20.6**, max 25.5 ms (n = 50) | PASS (closest to its limit) |
| P3 | Checkpointed step bookkeeping | p95 ≤ 20 ms | p50 11.5, **p95 15.4**, max 20.7 ms (n = 190) | PASS |
| P4 | Snapshot with 200 tasks | p95 ≤ 50 ms | p50 4.5, **p95 5.9** ms | PASS |
| P5 | Restart recovery, 50 interrupted tasks | ≤ 1,000 ms | **373 ms** (all 50 → PAUSED for the user) | PASS |
| P6 | Durable queue memory, 200 tasks | ≤ 20 MB | **+10.7 MB RSS** | PASS |
| P7 | Fairness (2 × 10 tasks) | longest run ≤ 2 | **1** — strict alternation alpha, beta, alpha, … | PASS |
| P8 | Peak concurrent model calls (4 active tasks) | = 1 | **1** (0 model switches) | PASS |
| P9 | Real Host idle CPU, 60 s | ≤ 1 % of one core | **0.29 %** (172 ms CPU in 60.3 s) | PASS |
| P10 | Cleanup over 10 crash cycles (detached children) | 0 survivors | **0 / 10**, 0 process records left | PASS |
| P11 | Real Host restart → correct task state | ≤ 15 s | **909 ms** (Host healthy in 845 ms) | PASS |

Other observations: identity-verified orphan cleanup costs one OS process-table read (~0.5 s on this PC: real-process
recovery 529 ms with an orphan vs 5 ms without). The S2 grouped-schedule benefit itself (−61 % model load time) was
measured in S2 and is not re-measured here; this milestone only shows the gate is honoured across tasks (P8).
Recovery makes no model calls (the ledger shows none between the kill and the user's resume).
