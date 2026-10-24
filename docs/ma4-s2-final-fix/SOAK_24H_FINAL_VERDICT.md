# 24-Hour Reliability Soak Final Adjudication

**Product:** Bunny A by LOKAM  
**Milestone:** MA4-S2 Remediation  
**Soak Target:** 24-hour uninterrupted operation under continuous periodic workload  
**Status:** SOAK A (19.2h, Complete Forensic Audit) / SOAK B (5.6h, Healthy & Actively Running — OPEN RUNTIME GATE)

---

## 1. Local Soak Process Discovery & Identity

Both local soaks were discovered and preserved without disturbance:

### Soak Run A (`Bunny-S2T3R-Soak`)
- **Port:** `43190`
- **Working Directory:** `C:\Users\allam\AppData\Local\Bunny-S2T3R-Soak`
- **Driver PID:** `32948` (started `2026-10-23T21:32:17Z`)
- **Active Host PID:** `31616` (started `2026-10-24T12:36:04Z`)
- **Elapsed Duration:** **19.21 hours** (1,064 samples recorded)
- **Task Invariant:** 117 tasks total (114 COMPLETED, 3 CANCELLED, 0 FAILED, 0 CORRUPT)
- **Events Recorded:** 2,162 events across 19.2 hours
- **Memory Trajectory:** Private memory decreased from 106.6 MB to 94.5 MB (-12.1 MB).
- **Handle Trajectory:** 261 handles at start, 258 handles at current sample (0 handle leak).
- **Orphan Processes:** 0 orphan processes across 4 orphan sweeps.

### Soak Run B (`Bunny-S2T3R1-Soak`) — Candidate Soak
- **Port:** `43192`
- **Working Directory:** `C:\Users\allam\AppData\Local\Bunny-S2T3R1-Soak`
- **Driver PID:** `6840` (started `2026-10-24T11:06:15Z` / `15:06:22Z UTC`)
- **Active Host PID:** `19296` (started `2026-10-24T11:06:15Z` / `15:06:22Z UTC`)
- **Elapsed Duration:** **5.64 hours** (270 samples recorded)
- **Target Duration:** 24.00 hours
- **Projected Completion:** `2026-10-25T15:06:15Z`
- **Current Trajectory:**
  - Tasks: 32 tasks created (31 COMPLETED, 1 CANCELLED, 0 FAILED)
  - Receipts: 124 action receipts
  - Private Memory: 165.6 MB -> 86.4 MB (stable, negative slope)
  - Handles: 261 -> 258 (stable, 0 handle leak)
  - Restarts / Crashes: 0 (PID 19296 has operated uninterrupted since start)
  - Workload Operations: 39 `file_same`, 20 `file_flip`, 6 `file_report`, 3 reminders, 1 cancellation

---

## 2. Invariant Audits & Failure Classification

| Invariant Category | Soak A Audit | Soak B Audit (Interim) | Status |
|---|---|---|---|
| **Memory Leak** | Negative slope (`-12.1 MB`) | Negative slope (`-79.2 MB`) | PASS |
| **Descriptor / Handle Leak** | `261 -> 258` | `261 -> 258` | PASS |
| **Unhandled Rejections** | 0 | 0 | PASS |
| **Zombie / Orphan Processes** | 0 | 0 | PASS |
| **Corrupt State / Integrity** | 0 corrupt rows | 0 corrupt rows | PASS |
| **Schedule Slot Duplication** | 0 duplicates | 0 duplicates | PASS |
| **Cancellation Ordering** | 1 test harness race (§ see CANCELLATION_ORDERING_FIX.md) | 0 races, 1/1 clean cancel | PASS |

---

## 3. Go / No-Go Adjudication for Soak Gate

1. **Soak A Adjudication:**
   - 19.2+ hours of continuous execution with zero memory growth, zero handle accumulation, zero crash loops, and clean restart recovery under fault injection.
   - The solitary `CANCELLATION_ORDERING` flag was proven to be a harness reporting race where a task completed in < 5ms before the cancel request arrived.

2. **Soak B Gate Status:**
   - **OPEN RUNTIME GATE.** Soak B is healthy, zero failures, zero restarts, 5.64 hours in.
   - Per non-negotiable mission rules, Soak B must **NOT** be terminated early or faked as complete. It remains an active running soak until `2026-10-25T15:06:15Z`.
   - The interim trajectory fully qualifies for conditional Beta Candidate readiness pending final soak completion tomorrow.
