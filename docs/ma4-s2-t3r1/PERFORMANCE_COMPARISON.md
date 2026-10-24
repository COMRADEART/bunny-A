# MA4-S2-T3R1 — Performance Comparison (Gate R1-G11)

- **Gate R1-G11 Verdict:** **`PASS`** (All 9 performance metrics meet acceptance thresholds on candidate `448ca6b6fb7252e2ea7af00e02ed9e078b5d1610`, with memory growth slope reduced from `156.0–208.9 MB/day` in T3R Soak A to **`43.7 MB/day`** in T3R1 Soak B)
- **Primary Evidence:**
  - Candidate soak (`Soak B`, `448ca6b`): [`docs/ma4-s2-t3r1/evidence/soak-b-interim.json`](evidence/soak-b-interim.json)
  - Original T3R soak (`Soak A`, `e6b6645`): [`docs/ma4-s2-t3r1/evidence/soak-a-interim.json`](evidence/soak-a-interim.json)
  - Retention stress test (`1,500` rounds, `0.00 MB` post-warmup RSS delta): [`docs/ma4-s2-t3r1/evidence/retention-stress.json`](evidence/retention-stress.json)
  - Installed candidate lifecycle & gap checks (`448ca6b`): [`docs/ma4-s2-t3r1/evidence/installed/lifecycle.json`](evidence/installed/lifecycle.json), [`docs/ma4-s2-t3r1/evidence/installed/gaps.json`](evidence/installed/gaps.json)
  - Real-model validation (`qwen2.5-coder:7b` & `deepseek-r1:7b`): [`docs/ma4-s2-t3r1/evidence/model-qualify-run2-fixed-both.json`](evidence/model-qualify-run2-fixed-both.json)

---

## T3R vs. T3R1 Candidate (`448ca6b`) Performance Matrix

| # | Metric | Acceptance Threshold | T3R Baseline (`8802e0c` / Soak A `e6b6645`) | T3R1 Candidate (`448ca6b` / Soak B) | Delta / Comparison | Verdict |
|---|---|---|---|---|---|---|
| **1** | **Host startup time** | `<= 10,000 ms` | `~1,500 ms` (Soak A cold start) | **`686 – 1,511 ms`** (Host start) / **`< 3,000 ms`** (installed Host + Gateway via `Start-Bunny-Release.ps1`) | Unchanged (`< 2 s` Host startup) | **PASS** |
| **2** | **Restart recovery time** | `<= 30,000 ms` | `6,100 ms` (installed `S2T3R4-TEST` restart); `715 – 2,589 ms` (Soak A restarts/crash) | **`5,305 ms`** (installed `S2T3R1-6-TEST` full stop + `Start-Bunny-Release.ps1` restart in `lifecycle.json` check #11) | **`-795 ms`** faster installed restart (`5.31 s` vs `6.10 s`) | **PASS** |
| **3** | **Idle Host CPU** | Median `<= 2.0 %`, p95 `<= 5.0 %` | Median `0.542 %`, p95 `0.850 %` (Soak A, `121` samples) | **Median `0.490 %`, p95 `0.808 %`** (Soak B, `25` samples) | **`-0.052 %`** median CPU | **PASS** |
| **4** | **Memory growth slope** | Post-1h least-squares private-memory slope `<= 50 MB / 24 h` | **`156.0 MB/day`**, **`208.9 MB/day`**, **`156.8 MB/day`** (Soak A — **FAILED** `S5_memory`) | **`43.7 MB/day`** (`84.4 -> 86.9 MB` over `1.6 h` post-warmup in Soak B); **`0.00 MB`** growth from round `100` to `1,500` (`115.65 -> 114.61 MB`) in `retention-stress.json` | **`-112.3 MB/day`** (`3.6x` lower slope after hourly SQLite retention fix `5c02c0e`) | **PASS** |
| **5** | **Task scheduling delay** | p95 `<= 5,000 ms`, max `<= 15,000 ms` | `p50 = 13 ms`, `p95 = 21 ms`, `max = 26 ms` (`30` daily occurrences in Soak A) | **`p50 = 13 ms`, `p95 = 24 ms`, `max = 26 ms`** (`7` daily occurrences in Soak B; `289 ms` on installed 1-time schedule) | Identical sub-`30 ms` scheduling latency | **PASS** |
| **6** | **UI responsiveness** | Zero console/page errors; preview & navigation `< 500 ms` | `0` console errors across `1280/767/390 px` | **`0` console errors** on installed candidate (`1280 px`, `390 px`, `320 px`); `animCount = 0` under `prefers-reduced-motion: reduce` | Maintained | **PASS** |
| **7** | **Local model-call latency (`qwen2.5-coder:7b`)** | Bounded (`<= 90,000 ms` timeout); no hangs | Planner calls frequently timed out (`90,000 ms`) or returned untrusted JSON before schema pin (`0/5` functional plans in T3R) | **`4,284 – 8,242 ms`** per pinned Planner call (`mean = 6,626 ms`, `0` timeouts across `H1`–`H5` and `X1`–`X8`); **`15,876 ms`** for installed `local.generate` step (`G2`) | Eliminated `90 s` Planner formatting timeouts on `qwen2.5-coder:7b` | **PASS** |
| **8** | **Mid-step cancellation latency** | `<= 10,000 ms` (`0` post-cancel receipts) | `2,700 ms` (installed `S2T3R4-TEST`) | **`2,647 ms`** (installed `S2T3R1-6-TEST` `gaps.json` `G4`: real in-flight Ollama call aborted, `postCancelReceipts = 0`) | **`-53 ms`** (`2.65 s` vs `2.70 s`) | **PASS** |
| **9** | **Handle & child-process count** | Post-1h handle growth `<= 100`; `0` orphan children | `258 -> 258` handles (`+0` to `+2`), `2` owned children, `0` orphans | **`258 -> 257` handles (`-1`)**, `2` owned children (`18068, 22488`), **`0` orphans** after `Stop-Process -Force` (`gaps.json` `G6`) | Flat handle and child-process count | **PASS** |
