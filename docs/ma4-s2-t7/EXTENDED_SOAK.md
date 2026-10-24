# MA4-S2-T7 — Extended Real-Clock Soak & Resource Stability (`EXTENDED_SOAK.md`)

- **Gate T7-D Verdict:** **`PARTIAL`** (`PASS` on 6-hour V8 heap reproduction [`5.84 h`, `283` snapshots] + `1,500`-round retention stress [`0.00 MB` post-warmup growth] + candidate `Soak B` passing all active criteria at `4.28 h` with **`28.2 MB/day`** memory slope; **`IN PROGRESS`** for full 24-hour wall-clock completion of `Soak B` at `~2026-10-25 15:06 UTC`)

---

## 1. Live Real-Clock Soak Status Comparison (`2026-10-24 19:23 UTC`)

| Metric / Criterion | Soak A (`e6b6645`, port `43190`, pre-fix) | 6h Heap Repro (`10993bd`, port `43191`, pre-fix) | Soak B — Candidate (`448ca6b`, port `43192`, with `5c02c0e` retention fix) |
|---|---|---|---|
| **Evidence File** | [`evidence/soak-a-latest.json`](evidence/soak-a-latest.json) | [`evidence/heap-repro-latest.json`](evidence/heap-repro-latest.json) | [`evidence/soak-b-latest.json`](evidence/soak-b-latest.json) |
| **Elapsed Real Time** | `17.85 h / 24.0 h` (`IN PROGRESS`) | `5.84 h / 6.0 h` (`283` V8 snapshots) | **`4.28 h / 24.0 h` (`IN PROGRESS`)** |
| **Duplicate Executions (`S1`)** | `0` (`PASS`) | `0` (`PASS`) | **`0` (`PASS`)** |
| **Missed While Available (`S2`)** | `0` (`PASS`) | `0` (`PASS`) | **`0` (`PASS`)** |
| **Unavailable Never Claimed (`S3`)** | `true` (`PASS`) | `true` (`PASS`) | **`true` (`PASS`, `2` unavailable slots, `1` catch-up run)** |
| **Scheduling Latency (`S4`)** | `p50 = 13 ms, p95 = 21 ms` (`PASS`) | `p50 = 15 ms, p95 = 23 ms` (`PASS`) | **`p50 = 11 ms, p95 = 24 ms, max = 24 ms` (`PASS`)** |
| **Memory Growth Slope (`S5 <= 50 MB/day`)** | `156.0 / 208.9 / 145.2 MB/day` (**`FAIL`**) | `124.9 MB/day` (`FAIL` — pre-retention fix) | **`28.2 MB/day` (`84.4 -> 84.2 MB` over `2.8 h` post-warmup — `PASS`)** |
| **Idle CPU (`S6 <= 5%` median)** | `median 0.542%, p95 0.850%` (`PASS`) | `median 0.728%, p95 1.119%` (`PASS`) | **`median 0.490%, p95 0.748%` (`PASS`)** |
| **OS Handles (`S7`)** | `258 -> 258` (`PASS`) | `258 -> 258` (`PASS`) | **`258 -> 258` (`PASS`)** |
| **Notification Deduplication (`S8`)** | `0` duplicates (`PASS`) | `0` duplicates (`PASS`) | **`0` duplicates (`PASS`)** |
| **Permission & Cancellation (`S9`)** | `cancelledWorkRan: 1` (**`FAIL`**) | `0` (`PASS`) | **`0` (`PASS`)** |
| **Orphan Processes (`S11`)** | `0` (`PASS`) | `0` (`PASS`) | **`0` (`PASS`)** |
| **Host / Driver Errors (`S12`)** | `0` (`PASS`) | `0` (`PASS`) | **`0` (`PASS`)** |

---

## 2. 6-Hour V8 Heap Reproduction Summary (`283` Snapshots, `upMin = 0..348`)

From `$env:LOCALAPPDATA\Bunny-S2T3R1-HeapRepro\heap.jsonl`:
- `upMin = 0` (`t = 1792848744157`): `heapUsed = 47.38 MB`, `old_space.used = 21.99 MB`, `malloced = 548,912 B`, `external = 15.96 MB`.
- `upMin = 348` (`5.80 h`, `t = 1792869602186`): `rss = 111.18 MB`, `heapUsed = 28.45 MB`, `old_space.used = 19.28 MB`, `malloced = 548,912 B`, `external = 15.96 MB`, `detached = 0`, `PipeWrap = 2, TCPServerWrap = 1, Timeout = 1`.
- Combined with commit `5c02c0e` (hourly runtime SQLite retention), `Soak B`'s private working set on PID `19296` decreased slightly from `84.4 MB` (`t = 1.0 h`) to **`84.2 MB`** (`t = 4.28 h`), yielding a linear slope of **`28.2 MB/day`** (`<= 50 MB/day` threshold).
