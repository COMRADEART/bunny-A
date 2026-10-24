# MA4-S2-T3R1 — Memory and process-lifecycle analysis (Phase B, gate R1-G3)

## 1. Original S5 failure in Soak A (`e6b6645`)

Pre-registered criterion **S5** (`docs/ma4-s2-t3r/REAL_CLOCK_SOAK.md` §2): within each Host process life, after its first hour of warm-up, the least-squares slope of Windows `PrivateMemorySize64` must be **≤ 50 MB / 24 h**, and handle growth (`median(lastHour) − median(secondHour)`) must be **≤ +200** (**S7**).

Soak A (`%LOCALAPPDATA%\Bunny-S2T3R-Soak`, frozen worktree `bun-router-soak` at `e6b6645`, started `2026-10-24T01:32:17.850Z`) **failed S5** across all three Host lives that reached > 1 hour of post-warmup samples (`evidence/soak-a-interim.json` at `16.65 h` elapsed):

| Host PID | Measured post-warmup window | Private MB start → end | Slope (`mbPerDay`) | S5 threshold (`≤ 50 MB/day`) | Handles (`secondHour → lastHour`) |
|---|---:|---:|---:|---|---|
| `35388` (initial life) | 5.0 h | 81.9 → 111.3 MB | **156.0 MB/day** | **FAIL** | 258 → 258 (PASS) |
| `25736` (after 6 h restart) | 2.0 h | 82.9 → 93.0 MB | **208.9 MB/day** | **FAIL** | 258 → 258 (PASS) |
| `17296` (after 9 h offline window) | 1.8 h | 84.1 → 92.8 MB | **156.8 MB/day** | **FAIL** | 258 → 258 (PASS) |

Soak A's result is preserved unchanged in `evidence/soak-a-interim.json` and `SOAK_FINAL_VERDICT.md` and is never reused as proof of the corrected build.

---

## 2. Reproduction and component-by-component measurement

To separate normal V8 / SQLite warm-up from sustained retention, three complementary diagnostics were run:

1. **Accelerated post-GC retention stress (`scripts/ma4-s2t3r1/retention-stress.mjs`)** — runs the production Host entry (`runHostEntry`) in-process on an isolated data directory, repeating the soak's workload loop (`ptask.create` → `ptask.approve` → `COMPLETED`, `schedule.create` → `schedule.approve` → `schedule.cancel`, and `GET /state`) for 1,500 rounds (`evidence/retention-stress.json`) and 600 rounds with V8 heap snapshots at rounds 0, 200, and 600 (`evidence/retention-stress-snap.json`), forcing `gc(); gc()` before each 100-round measurement block.
2. **Heap retainer & constructor diff (`scripts/ma4-s2t3r1/heap-diff.mjs`, `scripts/ma4-s2t3r1/heap-retainers.mjs`)** — compares V8 heap snapshots by constructor self-size and traces retaining paths for objects allocated after snapshot A that survive in snapshot B.
3. **Real-clock 6-hour heap reproduction (`%LOCALAPPDATA%\Bunny-S2T3R1-HeapRepro`, port `43191`, started `2026-10-24T13:32:19.073Z` on pre-retention-fix `10993bd`)** — runs `scripts/ma4-s2t3r/soak.mjs --hours 6` with preload `scripts/ma4-s2t3r1/heap-probe.mjs` (`NODE_OPTIONS="--import .../heap-probe.mjs"`), recording V8 heap spaces, `process.memoryUsage()`, and `process.getActiveResourcesInfo()` every minute without calling `gc()` (`evidence/heap-repro-interim.json`).

### Measured breakdown across all required dimensions

| Dimension | Measurement | Finding |
|---|---|---|
| **Private bytes (`PrivateMemorySize64`)** | Soak A: `81.9 → 111.3 MB` in 5 h (`156 MB/day`). Heap Repro (`10993bd`): `84.4 → 93.1 MB` over 3.6 h post-warmup (`54.3 MB/day`). | Exceeded `50 MB/day` before the retention fix (`5c02c0e`). |
| **RSS / Working set** | Heap Repro `heap.jsonl`: startup peak `198.5 MB` (module strip-types compilation), drops after first GC at `upMin=1` to `109.4 MB` (`104.3 MB`), and at `upMin=279` (`4.65 h`) is `114.2 MB` (`108.9 MB`). | Only `+4.6 MB` RSS change between minute 1 and minute 279 in real-clock execution; most early private-byte movement is V8/OS page commit after initial GC compaction. |
| **JavaScript heap (`v8.getHeapStatistics()`)** | Heap Repro (`upMin=1` → `upMin=279`, no forced GC): `used_heap_size` `24.75 MB → 27.31 MB` (`+2.56 MB` over 4.65 h); `old_space.used` `17.01 MB → 17.99 MB` (`+0.98 MB`); `large_object_space.used` `2.99 MB → 2.99 MB` (`0` change); `malloced_memory` `548,912 → 548,912 B` (`0` change); `external_memory` `15.96 MB → 15.96 MB` (`0` change). In 1,500-round forced-GC stress (`retention-stress.json`): `heapUsed` `27.35 MB` (round 100) → `29.79 MB` (round 1500), slope **`1.77 KB/round`**. | No runaway JS object or native buffer leak. The `1.77–2.21 KB/round` slope in the stress test tracked the growing `/state` payload and unpruned SQLite rows. |
| **SQLite cache & prepared statements** | Single `DatabaseSync` connection (`host.sqlite` in WAL mode); micro-benchmark of 220,000 fresh `db.prepare()` calls added `~1.3 MB` total. SQLite page cache is bounded per connection (`~2,000` pages max), filling gradually as `ma4_tasks`, `ma4_task_transitions`, `ma4_action_receipts`, and `ma4_occurrences` grow on disk. | Normal bounded page-cache fill, amplified when historical rows are never pruned while the Host stays up. |
| **Retained task records & `/state` payload** | In `retention-stress-snap.json`, `GET /state` response size grew linearly from **`198 KB` (round 100) to `740 KB` (round 600)** — **`+1.08 KB` per completed task**. `PersistentTaskStore.prune()` (200 terminal tasks / 30 days) was called **only in `PersistentTaskRuntime.start()`**, never while the Host remained running. | **Primary root cause #1.** A long-running Host accumulated every terminal task in SQLite, causing every 60 s `/state` poll and every 5 s maintenance pass to scan and serialize an ever-larger table. |
| **Schedule, monitor & occurrence objects** | `ProactiveStore.prune()` (settled occurrences and ended schedules older than 30 days) was also called **only in `ProactiveEngine.start()`**. In addition, `ProactiveEngine.lateness` (`readonly lateness: number[] = []`) pushed one number on every fired time slot and was **never trimmed** in memory. | **Primary root cause #2.** Unbounded in-memory `lateness` array plus startup-only proactive pruning. |
| **Listener and timer retention** | Heap Repro `heap.jsonl` (`upMin=2` through `upMin=279`): `resources` is invariant at `{"PipeWrap":2,"TCPServerWrap":1,"Timeout":1}` (4–5 active resources in `retention-stress.json`; `contexts: 2`, `detached: 0`). | **PASS** — zero leaked timers, sockets, event listeners, or detached V8 contexts. |
| **Browser / session cleanup** | `connection: close` on all soak/health probes; `TCPServerWrap: 1` with no retained `TCPSocketWrap` between requests. | **PASS** — no socket or session accumulation. |
| **Child process lifetime** | `maxChildren: 3` (Soak A) and `maxChildren: 2` (Heap Repro and Soak B); `orphans: 0` across all scheduled restarts, offline windows, and `taskkill /f` crash injections. | **PASS** — zero orphaned child processes. |
| **Handle growth** | `258 → 258` handles (`secondHour → lastHour`, Δ = `0`) across all measured Host lives in Soak A and the Heap Repro. | **PASS** — zero handle growth (criterion ≤ +200). |

---

## 3. Minimum fix and regression test (`5c02c0e`)

Without introducing periodic process restarts or production `gc()` calls, commit **`5c02c0e`** (`fix(ma4): apply task and proactive retention hourly, not only at Host start`) applies three surgical fixes:

1. **`PersistentTaskRuntime.maintain()` (`src/lib/bunny-host/ma4/task-runtime.server.ts`)**: tracks `lastPrune` (initialized at `start()`) and calls `this.store.prune(now)` whenever `now - this.lastPrune >= PRUNE_EVERY_MS` (`3,600,000 ms` = 1 hour), keeping terminal task history bounded at ≤ 200 terminal tasks while the Host stays up.
2. **`ProactiveEngine.tick()` (`src/lib/bunny-host/ma4/proactive.server.ts`)**: tracks `lastPrune` and calls `this.store.prune(now)` hourly after the `if (this.deps.runtime.readOnly) return;` guard so read-only/corrupt storage is never mutated.
3. **`ProactiveEngine.late(ms)` (`src/lib/bunny-host/ma4/proactive.server.ts`)**: caps `this.lateness` at the most recent `1,000` fired slots (`if (this.lateness.length > 1_000) this.lateness.shift()`).

### Regression test

- **`T3R1-R1`** (`src/lib/bunny-host/ma4-s2t3r1.test.ts`): creates 210 read-only tasks and a settled schedule on the fake clock without restarting the Host, advances the clock past 1 hour (`PRUNE_EVERY_MS`), and verifies that terminal tasks are pruned to the retention cap (`200`) and `lateness` is capped at `≤ 1,000` while the Host keeps running. Verified to fail when `5c02c0e` is stashed and pass with `5c02c0e`.

---

## 4. Candidate soak verification (Soak B at `448ca6b`)

Because Soak A (`e6b6645`) failed S5 and predates both T3R's final commits and `5c02c0e`, a new 24-hour real-clock soak (**Soak B**) was pre-registered (`SOAK_FINAL_VERDICT.md`, commit `d964cfe`) and launched on the frozen candidate worktree `bun-router-soak-r1` (`448ca6b`, port `43192`, `%LOCALAPPDATA%\Bunny-S2T3R1-Soak`, no `NODE_OPTIONS` preload) at **`2026-10-24T15:06:15.638Z`**.

At `3.08 h` elapsed (`evidence/soak-b-interim.json`, `1.6 h` of post-warmup samples on PID `19296`):
- **Private memory (`privMBStart → privMBEnd`)**: `84.4 MB → 86.9 MB`
- **Least-squares slope (`mbPerDay`)**: **`43.7 MB/day`** (within the `≤ 50 MB / 24 h` S5 threshold; `S5_memory: true`)
- **CPU (`cpuPctOneCore`)**: median `0.490 %`, p95 `0.772 %` (threshold ≤ 2.0 %)
- **Orphans / errors / duplicates / missed runs**: `0`

**Gate R1-G3 disposition**: **IN PROGRESS** — the root causes of long-running retention growth are identified, fixed in `5c02c0e`, covered by `T3R1-R1`, and currently passing S5 (`43.7 MB/day ≤ 50 MB/day`) in Soak B, which must complete its full 24 real hours (`~2026-10-25 15:06 UTC`) before R1-G3 can be marked final PASS.
