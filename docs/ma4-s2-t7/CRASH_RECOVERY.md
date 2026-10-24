# MA4-S2-T7 — Crash, Hang, Sleep/Wake & Corruption Recovery (`CRASH_RECOVERY.md`)

- **Gate T7-C Verdict:** **`PASS`**

---

## 1. Crash, Hang, Sleep/Wake & Corruption Verification Matrix

| Failure Mode | Mechanism & Safeguard | Verified Evidence |
|---|---|---|
| **Host Process Crash (`SIGKILL` / `Stop-Process -Force`)** | `Start-Bunny-Release.ps1` / `reconcileOnStart()` scans durable SQLite checkpoints; idempotent reads resume, while in-flight consequential actions enter `NEEDS_RECONCILIATION` (`0` blind replays); Windows Job Object (`bunny_proc.exe`) terminates child processes (`0` orphans) | [`docs/ma4-s2-t3r1/evidence/installed/gaps.json`](../ma4-s2-t3r1/evidence/installed/gaps.json) (`gap5_crashOrphans: 0`), [`docs/ma4-s2-t7/evidence/soak-a-latest.json`](evidence/soak-a-latest.json) (`4` recoveries in `686–2,589 ms`) |
| **Graceful Host + UI Restart** | Preserves goals, schedules, monitors, tasks, and receipts across restart without duplicate schedule dispatches (`gap4_duplicateAfterRestart: 0`) | [`docs/ma4-s2-t3r1/evidence/installed/lifecycle.json`](../ma4-s2-t3r1/evidence/installed/lifecycle.json) (`restartElapsedMs: 5,305 ms`) |
| **Local Model Hang / Timeout / Mid-Step Cancel** | Per-call AbortController + `timeoutMs` aborts in-flight Ollama HTTP streams immediately on `ptask.cancel` or timeout (`gap3_cancelElapsedMs: 2,647 ms`, `postCancelReceipts: 0`) | [`docs/ma4-s2-t3r1/evidence/installed/gaps.json`](../ma4-s2-t3r1/evidence/installed/gaps.json) |
| **Sleep / Wake & Long Shutdown Gaps** | `ProactiveEngine` records `asleep` / `off` gaps in `proactive_gaps`; schedules with `missedPolicy: "skip"` record `missed` without running late, while `run_once` fires only the latest missed slot once (never a burst of historical runs) | [`docs/ma4-s2-t7/evidence/soak-b-latest.json`](evidence/soak-b-latest.json) (`asleepMinutes: 134`, `unavailableSlots: 2`, `catchUpRuns: 1`, `skipPolicyRanLate: []`) |
| **Corrupted SQLite Row /Tampered State** | `TaskStore` and `ProactiveStore` validate every stored JSON record and SHA-256 spec hash on load; corrupted records are quarantined into `corrupt[]` (`readOnly` alert) without crashing the Host or widening permissions | `ma4-s2t1-recovery.test.ts`, `ma4-s2t3-proactive.test.ts`, `bunny-state-migration.test.mjs` |
