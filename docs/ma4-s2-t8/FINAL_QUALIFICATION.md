# MA4-S2-T8 — Final End-to-End Qualification (`FINAL_QUALIFICATION.md`)

- **Gate T8-D Verdict:** **`PARTIAL`** (`PASS` on installed Windows lifecycle, gap-closure, Journey B, Journey C, and T5 code closure of Journey A Goal-Criterion UI linking; **`IN PROGRESS` / `BLOCKED`** on full 24h completion of `Soak B`, physical Android TalkBack swipe verification, and `>= 4/5` real-model functional completion on `H1`–`H5`)

---

## 1. End-to-End Qualification Summary Across All Surfaces

| Qualification Surface | Result | Evidence |
|---|---|---|
| **1. Non-Developer Onboarding (`T5-A`)** | **`PASS`** | 10-stage guided flow (`resolveGuidedOnboardingState`, `evaluateLocalModelReadiness`), safe skip/resume (`implicitPermissionsGranted: 0`), verified in `ma4-s2t5.test.ts` |
| **2. Local Model Setup & Pinned Execution (`T3R1-D`)** | **`PARTIAL`** | `qwen2.5-coder:7b` (`sha256:dae161e27b0e`) achieved `5/5` (`100%`) schema-valid plans and `8/8` (`100%`) adversarial security refusals (`model-qualify-run2-fixed-both.json`), and executed real local-model step completion in `15,876 ms` (`installed/gaps.json`); held-out `H1`–`H5` functional completion is `2/5` (`1/5` e2e) |
| **3. Goal Creation, Preview, Pause/Resume & Criterion Linking (`Journey A`)** | **`PASS` (with `T5-D` UI fix)** | Goal `"Prepare Atlas for beta"` verified on installed candidate (`installed/journeys.json`), and `ScheduleForm` now exposes `Serves goal (optional)` + `Goal criterion` (`T5-D` in `ma4-s2t5.test.ts`) |
| **4. Folder Registration & Scheduled Check (`Journey B`)** | **`PASS`** | Registered `"Atlas project"` via UI (`fa72845`), approved schedule `"Atlas status check"`, executed on real clock, verified `file.stat` receipt `rcpt-4c79ca8a-b88f-4444-87ba-67652492184a` and approval-notice clearing (`f8c0dbc`) |
| **5. Condition Monitoring & Deduplicated Notice (`Journey C`)** | **`PASS`** | Created monitor `"Atlas build watch"`, flipped `build/status.json` `PASS -> FAIL`, verified single deduplicated notice across `7` checks and `Snooze 1 h` |
| **6. Consequential Action Approval & Mid-Step Cancellation** | **`PASS`** | `file.apply` paused for UI approval and wrote after approval; mid-step Ollama `local.generate` cancelled in `2,647 ms` with `0` post-cancel receipts (`installed/gaps.json`) |
| **7. Crash / Restart Recovery & Process Containment** | **`PASS`** | Graceful restart recovered in `5,305 ms` (`installed/lifecycle.json`); forced kill left `0` orphan processes (`installed/gaps.json`) |
| **8. Paired Android Supervision & Revocation** | **`PARTIAL`** | `9/9 PASS` on physical Samsung `SM-S948U` in `docs/ma4-s2-t3r/evidence/android/round2.json`; live TalkBack swipe test `NOT TESTED` while phone is disconnected |
| **9. Clean Uninstallation** | **`PASS`** | Verified in `docs/ma4-s2-t3r1/evidence/installed/cleanup.json` (`r1DirectoryRemoved: true`, `testProcessesLeft: 0`) |
