# MA4-S2-T3R — Real-clock soak (T3R-G10)

## 1. Design

Real time only: no clock is moved, no hours are simulated. One Host process started through the **production entry**
(`runHostEntry`: real process policy and containment), isolated data directory
(`%LOCALAPPDATA%\Bunny-S2T3R-Soak\state`) and port (43190), provider adapters off (no CLI or network probes). The
workload is permission-safe and model-free: no external account, send, purchase, publication or model call.

| Workload | Detail |
|---|---|
| Recurring tasks | 48 daily schedules, one every 30 min from start + 20 min (≈ 48 runs / day), each a `file.read` + `file.stat` S2-T1 task through the S2-T2 broker; alternating `skip` / `run_once`; one schedule ends at 12 h |
| Monitors | 4 build-status monitors (60 s), 1 report monitor (`changed`), at the policy minimum interval |
| File changes | status-0/1 flip PASS↔FAIL every 13 min; status-2 rewritten with identical bytes every 7 min; REPORT.md appended every 47 min |
| Condition runs | 2 schedules triggered by the flipping monitors, `minGapMs` 20 min |
| Reminders | a one-time reminder created every 2 h for +30 min |
| Cancellation | every 4 h: a one-time schedule cancelled before its slot, and a queued task cancelled |
| Host restarts | graceful at 6 h, 12 h, 21 h |
| Offline interval | Host stopped for 12 min at 9 h |
| Crash | Host process killed (`taskkill /f`, not its tree) at 15 h, then restarted |
| Background policy | owner background execution off from 18 h to 19.2 h |

Sampled every minute: Host process CPU seconds, working set, private bytes, handles, threads, child processes, and the
Host's `/state`. The driver records a gap whenever wall time advances > 3 min between its one-minute ticks (sleep);
the Host records its own gaps (`ma4_host_gaps`). Those intervals are **unavailable**, never counted as work.

Scripts: `scripts/ma4-s2t3r/soak.mjs` (driver), `soak-host.mjs`, `soak-report.mjs` (read-only analysis, usable
mid-run). Started from a frozen worktree at the commit recorded in `events.jsonl` (`soak_start.commit`).

## 2. Pre-registered criteria (frozen before the run; not changed afterwards)

A slot is **available** when the Host was up, the PC awake and background policy on at the slot and 2 min later.

| # | Criterion | Threshold |
|---|---|---|
| S1 | Duplicate executions: dispatch receipts per task step; condition runs closer than `minGapMs` | 0 |
| S2 | Daily slots missed while available, or their tasks not COMPLETED | 0 |
| S3 | Unavailable time never claimed: a `skip` schedule never runs late; an ended schedule never runs | 0 violations |
| S4 | Trigger latency of available daily slots (decision time − slot) | p95 ≤ 5 s and max ≤ 120 s |
| S5 | Host private-memory growth per Host life, after its first hour (least-squares) | ≤ 50 MB / 24 h |
| S6 | Host CPU, median of per-minute samples | ≤ 2 % of one core |
| S7 | Handle growth per Host life (last-hour median − second-hour median) | ≤ 200 |
| S8 | Semantically duplicated notifications (same category, source, reason within 1 min) | 0 |
| S9 | Cancelled work that ran; refused/out-of-scope broker receipts | 0 |
| S10 | Recovery latency after each restart / offline window / crash (spawn → state served) | ≤ 10 s each |
| S11 | Orphaned child processes of a stopped or killed Host | 0 |
| S12 | Host error events (`proactive.error`, `ptask.worker_error`, `ptask.scheduler_error`, stale-worker rejections, storage refusals) and driver errors | 0 |

**Verdict rule:** IN PROGRESS until 24 h of real time have elapsed and the driver finished; then PASS only if all of
S1–S12 hold, otherwise FAIL. Sleep or power-off periods are reported as unavailable minutes; a soak whose 24 h window
is mostly unavailable is reported as such, not as PASS.

## 3. Result

_Filled from `soak-report.mjs` output; interim reports are labelled IN PROGRESS._
