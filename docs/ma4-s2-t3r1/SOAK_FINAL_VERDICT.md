# MA4-S2-T3R1 — Real-clock soak verdicts (gate R1-G2, input to R1-G3 / R1-G11)

Two soaks, never merged into one result.

| Soak | Code | Started (UTC) | Purpose |
|---|---|---|---|
| **A — original T3R soak** | `e6b6645` (pre-dates 13 PR #27 commits) | 2026-10-24 01:32:17 | adjudicate the T3R pre-registration as written |
| **B — T3R1 candidate soak** | `448ca6b` (T3R1 candidate Host) | see §2 | reliability evidence for the beta candidate itself |

## 1. Pre-registration for soak B (frozen before it started; nothing changed afterwards)

Soak B reuses, unchanged, the T3R harness (`scripts/ma4-s2t3r/soak.mjs`, `soak-host.mjs`, `soak-report.mjs`) and the T3R
criteria S1–S12 with their thresholds (`docs/ma4-s2-t3r/REAL_CLOCK_SOAK.md` §2), including S5 (Host private-memory
least-squares slope per Host life after its first hour ≤ 50 MB / 24 h). No criterion is added, removed or relaxed, even
though soak A's interim data showed S5 failing: soak B tests whether the candidate passes the **same** bar.

- Frozen worktree `bun-router-soak-r1` detached at `448ca6b`; isolated data `%LOCALAPPDATA%\Bunny-S2T3R1-Soak`; Host port
  43192; synthetic project `Documents\new\bunny-soak-r1-project`; no heap probe or other preload (the measured process is
  the product Host alone; `NODE_OPTIONS` cleared).
- Same timeline: restarts at 6 h, 12 h, 21 h; offline 12 min at 9 h; crash at 15 h; background off 18–19.2 h.
- Verdict rule as in T3R: IN PROGRESS until 24 h of real time and the driver finished; then PASS only if S1–S12 all hold.
- Other processes on the PC during soak B (disclosed, not controlled): soak A until ~01:32 UTC 10-25, the 6 h heap
  reproduction until ~19:39 UTC 10-24, the isolated installed TEST release, Ollama.

## 2. Results

### 2.1 Soak A — Original T3R Soak (`e6b6645`, `%LOCALAPPDATA%\Bunny-S2T3R-Soak`, port `43190`)

- **Evidence:** [`docs/ma4-s2-t3r1/evidence/soak-a-interim.json`](evidence/soak-a-interim.json)
- **Started:** `2026-10-24T01:32:17.850Z`
- **Inspected at:** `2026-10-24T18:11:19.013Z` (**`16.65 h`** real-clock elapsed; target `24.0 h`, scheduled completion `~2026-10-25T01:32:17Z`)
- **Overall Soak A Status:** **`IN PROGRESS` (fails pre-registered criteria `S5_memory` and `S9_permissions` at 16.65 h)**

| Criterion | Threshold | Soak A Measured Value (`16.65 h`) | Verdict |
|---|---|---|---|
| `S1_duration` | `>= 24.0 h` real-clock & finished | `16.65 h` (`finished: false`) | `IN PROGRESS` |
| `S2_schedules` | `0` duplicate dispatches, `0` missed while available, p95 `<= 5,000 ms`, max `<= 15,000 ms` | `113` total occurrences (`30` daily executed, `72` condition runs, `2` unavailable slots during `148` asleep min + `12` host-down min, `8` reminders, `55` sourceChanged); `0` duplicates, `0` missed while available; latency `p50 = 13 ms`, `p95 = 21 ms`, `max = 26 ms` | `PASS` |
| `S3_monitors` | `>= 1` change detected, `0` false repeats | `55` `source_changed` detections across `333` monitor checks; `0` false repeats on unchanged bytes | `PASS` |
| `S4_notifications` | `0` semantic duplicates, snoozed stay hidden until `snoozedUntil` | `0` semantic duplicate notifications; `55` snoozed, `0` reappeared early | `PASS` |
| `S5_memory` | Post-1h least-squares private-memory slope `<= 50 MB / 24 h` per Host life | **`156.0 MB/day`** (`81.9 -> 111.3 MB` over `5.0 h`, PID `35388`), **`208.9 MB/day`** (`82.9 -> 93.0 MB` over `2.0 h`, PID `25736`), **`156.8 MB/day`** (`84.1 -> 92.8 MB` over `1.8 h`, PID `17296`) | **`FAIL`** |
| `S6_handles` | Post-1h handle growth `<= 100` per Host life | `258 -> 258` (`+0`), `257 -> 258` (`+1`), `257 -> 259` (`+2`), `258 -> 258` (`+0`) | `PASS` |
| `S7_orphans` | `0` orphaned child processes | `0` (`orphans: []`) | `PASS` |
| `S8_integrity` | SQLite `PRAGMA integrity_check = ok`, `foreign_key_check = []` | `integrity: "ok"`, `foreignKeys: 0`, WAL `4.25 MB` | `PASS` |
| `S9_permissions` | `0` unapproved high-risk actions, `0` background dispatches while off, `0` cancelled work ran | `unapprovedHighRisk: 0`, `ranWhileBackgroundOff: 0`, **`cancelledWorkRan: 1`** (see root cause below) | **`FAIL`** |
| `S10_recovery` | Restart recovery `<= 30,000 ms`, `0` lost state across restarts/crash | Clean restarts at `6 h` (`1,511 ms`), `9.2 h` (`686 ms`), `12 h` (`715 ms`); forced `SIGKILL` crash recovery at `15 h` (`2,589 ms`); `0` lost state | `PASS` |
| `S11_noCloud` | `0` external/cloud requests | `0` | `PASS` |
| `S12_cpu` | Idle Host CPU median `<= 2.0 %`, p95 `<= 5.0 %` | `median = 0.542 %`, `p95 = 0.850 %` (`121` samples) | `PASS` |

#### Root Cause of Soak A `S9_permissions` (`cancelledWorkRan: 1`)
At `2026-10-24T13:33:16.823Z` (`12 h` mark), the soak driver (`scripts/ma4-s2t3r/soak.mjs`) created a 1-step read-only `file.read` task (`ptask-1d1f825b-c911-443a-b51f-6bee90e78a57`) while `policy.background` was `true`, and then sent a separate HTTP request (`ptask.cancel`) to cancel it. Because `policy.background` was enabled and `file.read` is a low-risk local read requiring no approval gate, the Host worker dispatched and completed the `file.read` step in `< 5 ms` **before** the `ptask.cancel` HTTP request arrived (`taskState: "Error: ptask.cancel: The task is already COMPLETED."`). `soak-report.mjs` flags any task in `cancellations` that has a `dispatched` receipt, even when `ptask.cancel` was rejected because the task had already completed prior to the cancel request. Real mid-step cancellation of an active long-running step is separately verified on the installed candidate in [`docs/ma4-s2-t3r1/evidence/installed/gaps.json`](evidence/installed/gaps.json) (`G4`: in-flight Ollama model call aborted in `2,647 ms`, `postCancelReceipts: 0`, `finalState: "CANCELLED"`).

---

### 2.2 6-Hour Heap Reproduction (`10993bd`, `%LOCALAPPDATA%\Bunny-S2T3R1-HeapRepro`, port `43191`)

- **Evidence:** [`docs/ma4-s2-t3r1/evidence/heap-repro-interim.json`](evidence/heap-repro-interim.json) and `heap.jsonl` (`215` minute-by-minute V8/process snapshots)
- **Started:** `2026-10-24T13:32:54.307Z` (with `--import ./scripts/ma4-s2t3r1/soak-heap-probe.mjs` on pre-fix `10993bd`)
- **Inspected at:** `2026-10-24T18:11:37.211Z` (**`4.65 h`** elapsed of `6.0 h` reproduction window)
- **Findings:**
  - `S5_memory` on pre-fix `10993bd` is `false` (**`54.3 MB/day`**, `84.4 -> 93.1 MB` over `3.6 h` post-warmup on PID `27856`).
  - Over `278` minutes (`upMin = 1` to `upMin = 279`), V8 `used_heap_size` grew only **`+2.56 MB`** (`24.75 -> 27.31 MB`), `old_space.used` grew **`+0.98 MB`** (`17.01 -> 17.99 MB`), `malloced_memory` was flat (`548,912 B`), `external_memory` was flat (`15.96 MB`), active libuv resources were constant (`{"PipeWrap":2,"TCPServerWrap":1,"Timeout":1}`), and OS handles were flat (`258 -> 258`).
  - Full root-cause and retention-fix analysis is documented in [`MEMORY_AND_PROCESS_ANALYSIS.md`](MEMORY_AND_PROCESS_ANALYSIS.md).

---

### 2.3 Soak B — T3R1 Candidate Soak (`448ca6b`, `%LOCALAPPDATA%\Bunny-S2T3R1-Soak`, port `43192`)

- **Evidence:** [`docs/ma4-s2-t3r1/evidence/soak-b-interim.json`](evidence/soak-b-interim.json)
- **Started:** `2026-10-24T15:06:15.638Z` on frozen candidate commit `448ca6b` (`fix(ma4): apply task and proactive retention hourly, not only at Host start` + Planner schema pins + UI fixes)
- **Inspected at:** `2026-10-24T18:11:20.118Z` (**`3.08 h`** real-clock elapsed; target `24.0 h`, scheduled completion `~2026-10-25T15:06:15Z`)
- **Overall Soak B Status:** **`IN PROGRESS` (all active criteria `S2`–`S9`, `S11`, `S12` passing at `3.08 h`, including `S5_memory: true` at `43.7 MB/day`)**

| Criterion | Threshold | Soak B Measured Value (`3.08 h`) | Verdict |
|---|---|---|---|
| `S1_duration` | `>= 24.0 h` real-clock & finished | `3.08 h` (`finished: false`) | `IN PROGRESS` |
| `S2_schedules` | `0` duplicate dispatches, `0` missed while available, p95 `<= 5,000 ms`, max `<= 15,000 ms` | `23` total occurrences (`7` daily executed, `16` condition runs, `2` reminders, `12` sourceChanged); `0` duplicates, `0` missed; latency `p50 = 13 ms`, `p95 = 24 ms`, `max = 26 ms` | `PASS (interim)` |
| `S3_monitors` | `>= 1` change detected, `0` false repeats | `12` `source_changed` detections across `62` monitor checks; `0` false repeats | `PASS (interim)` |
| `S4_notifications` | `0` semantic duplicates, snoozed stay hidden until `snoozedUntil` | `0` semantic duplicate notifications; `12` snoozed, `0` reappeared early | `PASS (interim)` |
| `S5_memory` | Post-1h least-squares private-memory slope `<= 50 MB / 24 h` per Host life | **`43.7 MB/day`** (`84.4 -> 86.9 MB` over `1.6 h` post-warmup on PID `19296`, `<= 50 MB/day`) | **`PASS (interim)`** |
| `S6_handles` | Post-1h handle growth `<= 100` per Host life | `258 -> 257` (`-1`) | `PASS (interim)` |
| `S7_orphans` | `0` orphaned child processes | `0` (`orphans: []`) | `PASS (interim)` |
| `S8_integrity` | SQLite `PRAGMA integrity_check = ok`, `foreign_key_check = []` | `integrity: "ok"`, `foreignKeys: 0`, WAL `4.23 MB` | `PASS (interim)` |
| `S9_permissions` | `0` unapproved high-risk actions, `0` background dispatches while off, `0` cancelled work ran | `unapprovedHighRisk: 0`, `ranWhileBackgroundOff: 0`, `cancelledWorkRan: 0` | `PASS (interim)` |
| `S10_recovery` | Restart recovery `<= 30,000 ms`, `0` lost state | Pending first scheduled restart at `6 h` (`~21:06 UTC`) | `IN PROGRESS` |
| `S11_noCloud` | `0` external/cloud requests | `0` | `PASS (interim)` |
| `S12_cpu` | Idle Host CPU median `<= 2.0 %`, p95 `<= 5.0 %` | `median = 0.490 %`, `p95 = 0.808 %` (`25` samples) | `PASS (interim)` |

### 2.4 Gate R1-G2 Adjudication
- **Gate R1-G2 (`Original 24-hour soak accurately adjudicated`):** **`PASS` (Adjudication Complete) / Soak A Verdict: `IN PROGRESS — FAIL on S5_memory & S9_permissions` / Soak B Verdict: `IN PROGRESS` (`3.08 h / 24.0 h`, `S5_memory` passing at `43.7 MB/day`).**
- Neither 24-hour soak is terminated early; both remain running in their isolated directories (`%LOCALAPPDATA%\Bunny-S2T3R-Soak` on port `43190` and `%LOCALAPPDATA%\Bunny-S2T3R1-Soak` on port `43192`), and no 24-hour `PASS` is claimed before 24 real hours have elapsed.
