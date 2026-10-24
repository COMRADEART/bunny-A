# BUNNY A — MA4-S2-T3R1 ENGINEERING REPORT

## Milestone
MA4-S2-T3R1 — Beta Readiness Closure, Reliability Audit & Accessibility Qualification

## Repository & Branch
- Repository: `https://github.com/COMRADEART/bunny-A`
- Base Branch: `ma4-s1r3-agent-reliability` (PR #27 merged at `1f36d951a380783d4cbfcf70ead72891d88c55b4`, tree-identical to `10993bd897936b3e6478f81aed9a3b522bfc5b51`; PR #28 merged to `main` at `0fce711`)
- T3R Baseline Commit: `10993bd897936b3e6478f81aed9a3b522bfc5b51`
- Working Branch: `ma4-s2-t3r1-beta-closure` (worktree `C:\Users\allam\Documents\new\bun-router-s2t3r1`)
- Validated Candidate Code Commit: `448ca6b6fb7252e2ea7af00e02ed9e078b5d1610` (`Bunny-A-Windows-S2T3R1-6-TEST`; subsequent commits on `ma4-s2-t3r1-beta-closure` are documentation and evidence only)

## Executive Summary
- **Overall Milestone Verdict:** **`PARTIAL`**
- **Beta Release Decision:** **`NO-GO` for General Beta**
- **Summary of What Was Closed vs. What Remains Open:**
  1. **Memory & Process Stability (`R1-G3` — `PASS`):** A 6-hour V8 heap reproduction (`heap.jsonl`, `215` minute-by-minute snapshots on `10993bd`) proved that V8 heap (`24.75 -> 27.31 MB`, `+2.56 MB`), `malloced_memory` (`548,912 B`), `external_memory` (`15.96 MB`), and OS handles (`258 -> 258`) were not leaking; instead, SQLite WAL and page-cache working set grew because `applyRetention()` and `applyProactiveRetention()` were only invoked at Host startup. Commit `5c02c0e` added hourly runtime retention (`MA4_RETENTION_INTERVAL_MS = 3,600,000`), flattening a `1,500`-round stress run to `0.00 MB` post-warmup growth (`115.65 -> 114.61 MB`) and reducing the live soak memory slope from `156.0–208.9 MB/day` (Soak A) to **`43.7 MB/day`** (`<= 50 MB/day` threshold) in Soak B.
  2. **24-Hour Real-Clock Soaks (`R1-G2` — Adjudicated; Soaks `IN PROGRESS`):** The original T3R soak (`Soak A`, commit `e6b6645`, port `43190`) was audited at `16.65 h` (`docs/ma4-s2-t3r1/evidence/soak-a-interim.json`) and **fails** `S5_memory` (`156.0`, `208.9`, `156.8 MB/day`) and `S9_permissions` (`cancelledWorkRan: 1` due to a sub-`5 ms` `file.read` completing before the driver's next HTTP `ptask.cancel` arrived). A pre-registered candidate soak (`Soak B`, commit `448ca6b`, port `43192`) is running and passing all active criteria at `3.08 h` (`S5_memory = 43.7 MB/day`), with completion scheduled at `~2026-10-25 15:06 UTC`. Neither soak was terminated early, and no 24-hour `PASS` is claimed before 24 real hours have elapsed.
  3. **Planner Model-Pin & Real Local Models (`R1-G6` — `PARTIAL`):** Commits `61673e2`, `4dd1d43`, and `713891e` derive an Ollama structured-output JSON Schema directly from the Host's `PlannerPin` (constraining step IDs to `^step-[1-6]$` and pairing each `action` with its per-action `input` schema). On `qwen2.5-coder:7b` (`sha256:dae161e27b0e`), schema-valid plans improved from **`0/5` (`0%`) to `5/5` (`100%`)** (`mean 6,626 ms`) and adversarial prompt-injection refusals (`X1`–`X8`) passed **`8/8` (`100%`)** (`0` unsafe actions executed on both `qwen2.5-coder:7b` and `deepseek-r1:7b`). However, held-out functional correctness on `H1`–`H5` reached **`2/5` (`40%`)** and end-to-end completion reached **`1/5` (`20%`)** (below the `>= 4/5` bar), and `deepseek-r1:7b` timed out (`90 s`) when Ollama combined `<think>` generation with grammar-constrained JSON output.
  4. **Installed Windows Recheck & User Journeys (`R1-G7` — `PASS`; `R1-G9` — `PARTIAL`):** The isolated TEST candidate `Bunny-A-Windows-S2T3R1-6-TEST` (`448ca6b`) passed **`12/12`** lifecycle checks (`lifecycle.json`), **`6/6`** gap-closure checks (`gaps.json`), Journey B (`PASS`, including the new folder-grant UI `fa72845` and approval-notice clearing `f8c0dbc`), Journey C (`PASS`), and clean uninstallation (`cleanup.json`). Journey A is `PARTIAL` because the dashboard UI lacks a control to attach a task to a goal's `criterionId`.
  5. **Accessibility Qualification (`R1-G4` — `PARTIAL`; `R1-G5` — `NOT TESTED`; `R1-G8` — `PARTIAL`):** Four live Windows Narrator rounds were completed with the owner on `Bunny-A-Windows-S2T3R1-6-TEST`, uncovering two real screen-reader findings (bare per-row button labels without item-title context, and unannounced asynchronous status/notice updates in Round 4), while `11/11` CDP AXTree/media/reflow checks passed (`accessibility-audit.json`). The physical Samsung SM-S948U was not connected during T3R1 (`adb devices` empty), so live TalkBack touch exploration is reported as `NOT TESTED`, while physical Android authorization (`9/9 PASS` in T3R `docs/ma4-s2-t3r/evidence/android/round2.json`) + unit privilege tests make `R1-G8` `PARTIAL`.

---

## Gate Summary Table (R1-G1 through R1-G15)

| Gate | Description | Verdict | Primary Document & Evidence |
|---|---|---|---|
| **R1-G1** | T3R baseline and PR status verified | **`PASS`** | [`BASELINE_AUDIT.md`](BASELINE_AUDIT.md) |
| **R1-G2** | Original 24-hour soak accurately adjudicated | **`PASS` (Adjudicated: Soak A `IN PROGRESS — FAIL on S5 & S9`; Soak B `IN PROGRESS — S5 PASS at 43.7 MB/day`)** | [`SOAK_FINAL_VERDICT.md`](SOAK_FINAL_VERDICT.md), [`evidence/soak-a-interim.json`](evidence/soak-a-interim.json), [`evidence/soak-b-interim.json`](evidence/soak-b-interim.json) |
| **R1-G3** | Memory and process growth meet original criteria | **`PASS` (`43.7 MB/day` in Soak B <= `50 MB/day`; `0.00 MB` post-warmup delta over `1,500` rounds; `0` orphans)** | [`MEMORY_AND_PROCESS_ANALYSIS.md`](MEMORY_AND_PROCESS_ANALYSIS.md), [`evidence/retention-stress.json`](evidence/retention-stress.json), [`evidence/heap-repro-interim.json`](evidence/heap-repro-interim.json) |
| **R1-G4** | Narrator qualification completed | **`PARTIAL` (4 live Narrator rounds + `11/11` CDP AXTree checks; 2 Narrator findings recorded)** | [`WINDOWS_NARRATOR_QUALIFICATION.md`](WINDOWS_NARRATOR_QUALIFICATION.md), [`evidence/installed/accessibility-audit.json`](evidence/installed/accessibility-audit.json) |
| **R1-G5** | TalkBack qualification completed | **`NOT TESTED` (Physical Samsung SM-S948U not attached via USB during T3R1)** | [`ANDROID_TALKBACK_QUALIFICATION.md`](ANDROID_TALKBACK_QUALIFICATION.md), [`evidence/installed/accessibility-audit.json`](evidence/installed/accessibility-audit.json) |
| **R1-G6** | Planner model-pin issue resolved or explicitly adjudicated | **`PARTIAL` (Schema-pin `5/5` valid & `8/8` security `PASS`; `2/5` functional & `1/5` completed `FAIL`)** | [`PLANNER_MODEL_PIN_ANALYSIS.md`](PLANNER_MODEL_PIN_ANALYSIS.md), [`REAL_MODEL_VALIDATION.md`](REAL_MODEL_VALIDATION.md), [`evidence/model-qualify-run2-fixed-both.json`](evidence/model-qualify-run2-fixed-both.json) |
| **R1-G7** | Actual installed Windows candidate rechecked | **`PASS` (`12/12` `lifecycle.json`, `6/6` `gaps.json`, `cleanup.json` verified on `448ca6b`)** | [`INSTALLED_RELEASE_RECHECK.md`](INSTALLED_RELEASE_RECHECK.md), [`evidence/installed/lifecycle.json`](evidence/installed/lifecycle.json), [`evidence/installed/gaps.json`](evidence/installed/gaps.json), [`evidence/installed/cleanup.json`](evidence/installed/cleanup.json) |
| **R1-G8** | Physical Android authorization and accessibility checked | **`PARTIAL` (`9/9` physical authorization in T3R `round2.json`; TalkBack `NOT TESTED`)** | [`ANDROID_TALKBACK_QUALIFICATION.md`](ANDROID_TALKBACK_QUALIFICATION.md), [`../ma4-s2-t3r/evidence/android/round2.json`](../ma4-s2-t3r/evidence/android/round2.json) |
| **R1-G9** | Three user journeys pass | **`PARTIAL` (Journey A `PARTIAL`, Journey B `PASS`, Journey C `PASS`)** | [`END_TO_END_USER_JOURNEYS.md`](END_TO_END_USER_JOURNEYS.md), [`evidence/installed/journeys.json`](evidence/installed/journeys.json) |
| **R1-G10** | No security or duplicate-execution regression | **`PASS` (`12/12` security invariants verified, `0` prod vulnerabilities)** | [`SECURITY_REGRESSION.md`](SECURITY_REGRESSION.md), [`evidence/release/audit.json`](evidence/release/audit.json) |
| **R1-G11** | Performance acceptance maintained | **`PASS` (`9/9` performance metrics within acceptance bounds)** | [`PERFORMANCE_COMPARISON.md`](PERFORMANCE_COMPARISON.md) |
| **R1-G12** | Full local regression passes | **`PASS` (`tsc`, web build, desktop build, `npm audit`, `npm test`)** | [`HOSTED_CI_RESULTS.md`](HOSTED_CI_RESULTS.md), [`evidence/release/regression.log`](evidence/release/regression.log) |
| **R1-G13** | Final-head hosted CI passes | _Recorded in `HOSTED_CI_RESULTS.md` upon workflow completion_ | [`HOSTED_CI_RESULTS.md`](HOSTED_CI_RESULTS.md) |
| **R1-G14** | Reproducible evidence and draft PR published | **`PASS`** | `docs/ma4-s2-t3r1/` + Draft PR |
| **R1-G15** | Beta go/no-go decision documented | **`PASS` (`NO-GO` for General Beta documented)** | [`BETA_GO_NO_GO.md`](BETA_GO_NO_GO.md) |

---

## Detailed Findings by Phase

### 1. Baseline & PR Audit (`BASELINE_AUDIT.md`)
- Verified PR #27 (`ma4-s2-t3r-product-qualification` -> `ma4-s1r3-agent-reliability`) head `10993bd897936b3e6478f81aed9a3b522bfc5b51` (subsequently merged at `1f36d951a380783d4cbfcf70ead72891d88c55b4` with zero tree diff, and PR #28 merged to `main` at `0fce711`).
- Identified that the original T3R soak (`Soak A`) was running on detached commit `e6b6645`, which predated 13 commits of PR #27 (`+1,511 / -42` lines across 31 files). Therefore, `Soak A` could only adjudicate `e6b6645`, and a separate pre-registered candidate soak (`Soak B`) was launched on frozen candidate commit `448ca6b`.

### 2. 24-Hour Real-Clock Soak Final Verdict (`SOAK_FINAL_VERDICT.md`)
- **Soak A (`e6b6645`, port `43190`, `16.65 h / 24.0 h`):** `IN PROGRESS` (scheduled end `~2026-10-25 01:32 UTC`). Passed `S2_schedules` (`113` occurrences, `0` duplicates, `0` missed while available, `p50 = 13 ms, p95 = 21 ms`), `S3_monitors` (`55` changes across `333` checks, `0` false repeats), `S4_notifications` (`0` duplicates), `S6_handles` (`258 -> 258`), `S7_orphans` (`0`), `S8_integrity` (`ok`), `S10_recovery` (`686–2,589 ms` across 3 restarts + 1 `SIGKILL` crash), `S11_noCloud` (`0`), and `S12_cpu` (`median 0.542%, p95 0.850%`). **Failed** `S5_memory` (`156.0`, `208.9`, `156.8 MB/day` > `50 MB/day`) and `S9_permissions` (`cancelledWorkRan: 1` harness timing race where a 1-step `file.read` finished in `< 5 ms` before `ptask.cancel` was sent).
- **Soak B (`448ca6b`, port `43192`, `3.08 h / 24.0 h`):** `IN PROGRESS` (scheduled end `~2026-10-25 15:06 UTC`). Passing all active criteria `S2`–`S9`, `S11`, `S12`, including **`S5_memory: true` at `43.7 MB/day`** (`84.4 -> 86.9 MB` over `1.6 h` post-warmup on PID `19296`).

### 3. Memory & Process Growth Analysis (`MEMORY_AND_PROCESS_ANALYSIS.md`)
- **6-Hour Heap Reproduction (`10993bd`, port `43191`, `215` V8 snapshots):** Over `278` minutes (`upMin = 1..279`), V8 `used_heap_size` grew only `+2.56 MB` (`24.75 -> 27.31 MB`), `old_space.used` grew `+0.98 MB` (`17.01 -> 17.99 MB`), `malloced_memory` stayed flat at `548,912 B`, `external_memory` stayed flat at `15.96 MB`, and OS handles stayed flat at `258 -> 258`.
- **Root Cause & Fix (`5c02c0e`):** `applyRetention()` and `applyProactiveRetention()` were previously called only once at Host startup, allowing SQLite rows, WAL pages, and page-cache memory to grow continuously during multi-hour uptime. Commit `5c02c0e` runs both retention passes once per hour (`MA4_RETENTION_INTERVAL_MS = 3,600,000`).
- **Verification:** `retention-stress.json` (`1,500` rounds = `5x` 24-hour soak volume) held database rows bounded at `150` tasks / `500` occurrences / `200` notifications, with `rssMB` flat from round `100` (`115.65 MB`) to round `1,500` (`114.61 MB`, **`-1.04 MB`** delta) and `WorkingSetPrivate` settling at **`82.39 MB`**.

### 4. Windows Narrator Qualification (`WINDOWS_NARRATOR_QUALIFICATION.md`)
- Exercised 4 live Windows Narrator rounds with the owner on `Bunny-A-Windows-S2T3R1-6-TEST` (`http://127.0.0.1:8084/?view=tasks`) plus `11/11` CDP AXTree/media/reflow checks (`accessibility-audit.json`).
- **Confirmed Passing:** Zero unlabeled visible controls on the Tasks dashboard; Goal empty-submit announces both `role="alert"` and focused `aria-invalid="true"` `Goal` input with its `aria-describedby` error (`Both announced`); Goal preview focuses and announces `Review: New goal`, `Approve and start`, and `Back to edit`; checkbox CSS regression fixed (`fade2b6`); `prefers-reduced-motion: reduce` stops all animations (`animCount = 0`); `forced-colors: active` renders cleanly; `320 CSS px` zoom reflow has zero horizontal overflow (`hasOverflow320 = false`).
- **Recorded Defects (`PARTIAL`):** (1) Per-row action buttons (`Dismiss`, `Snooze 1 h`, `Pause`, `Turn off`, `Approve`, `Cancel`, `Approve this action`, `Deny`, `Inspect details`) lack item-title context in their accessible names (`Rounds 1 & 3`); (2) asynchronous task completion and monitor `source_changed` updates were not announced unprompted by Narrator while focus was parked on `Execution history` (`Round 4`).

### 5. Android TalkBack & Physical Device Qualification (`ANDROID_TALKBACK_QUALIFICATION.md`)
- Physical Samsung SM-S948U (`com.routeragent.jev` `2.1 (3)`) was **disconnected** throughout T3R1 (`adb devices` empty; `0` tunnel processes). Live TalkBack touch exploration is therefore reported as **`NOT TESTED`**.
- Mobile-web DOM and accessibility-tree checks (`390x844` and `320x700` viewports in `scripts/ma4-s2t3r/ui-evidence.mjs` and `docs/ma4-s2-t3r1/evidence/installed/accessibility-audit.json`) passed with zero unlabeled controls and zero horizontal overflow, while physical device authorization (`9/9 PASS`) remains anchored by T3R `docs/ma4-s2-t3r/evidence/android/round2.json`.

### 6. Planner Model-Pin & Real Local Model Validation (`PLANNER_MODEL_PIN_ANALYSIS.md`, `REAL_MODEL_VALIDATION.md`)
- **Fixes (`61673e2`, `4dd1d43`, `713891e`):** `plannerFormat(pin)` builds a recursive JSON Schema from the Host's `PlannerPin` (`anyOf` branches pairing each allowed `action` with its exact `input` schema, `id` pattern `^step-[1-6]$`, `additionalProperties: false`) and threads it through Ollama's `format` parameter exclusively for the `Planner` role.
- **Pre-Registered Results (`model-qualify-run2-fixed-both.json` vs `model-qualify-run2-prefix-both.json`):**
  - `qwen2.5-coder:7b` (`sha256:dae161e27b0e`): Schema-valid plans improved from **`0/5` (`0%`) to `5/5` (`100%`)** (`mean 6,626 ms`, `0` retries); adversarial prompt-injection refusals (`X1`–`X8`) passed **`8/8` (`100%`, `0` unsafe actions executed)**; held-out functional plans (`H1`–`H5`) reached **`2/5` (`40%`)** and end-to-end completion reached **`1/5` (`20%`)**.
  - `deepseek-r1:7b` (`sha256:755ced02ce7b`): Passed **`8/8` (`100%`)** adversarial prompt-injection tests (`0` unsafe actions executed), but timed out at `90,000 ms` on `H1`–`H5` when Ollama combined `<think>` token generation with grammar-constrained JSON output (`0/5`).

### 7. Installed Windows Candidate Recheck (`INSTALLED_RELEASE_RECHECK.md`)
- Built and upgraded isolated TEST packages through `Bunny-A-Windows-S2T3R1-6-TEST` (`448ca6b6fb7252e2ea7af00e02ed9e078b5d1610`).
- Passed **`12/12`** checks in `installed/lifecycle.json` (including `5,305 ms` full restart recovery) and **`6/6`** checks in `installed/gaps.json` (including `15,876 ms` real `qwen2.5-coder:7b` step execution, UI `file.apply` approval gate, `2,647 ms` mid-step Ollama cancellation with `0` post-cancel receipts, `0` duplicate schedule dispatches across restart, `0` orphan processes after `Stop-Process -Force`, and verified cleanup in `installed/cleanup.json`).

### 8. End-to-End User Journeys (`END_TO_END_USER_JOURNEYS.md`)
- **Journey A (`PARTIAL`):** Created, previewed, approved, paused, and resumed Goal `"Prepare Atlas for beta"` (`goal-538873eb-6b4d-4908-8995-9614472cd55a`) in the installed UI; marked `PARTIAL` because the UI lacks a control to link a task to a goal's `criterionId`.
- **Journey B (`PASS`):** Registered `"Atlas project"` via the new UI (`fa72845`, after verifying `C:\Windows\System32` is rejected), created schedule `"Atlas status check"` (`sch-639cf003-72c8-4153-9c98-d869202535de`), approved, executed at `10:59:00 EDT`, verified `file.stat` receipt `rcpt-4c79ca8a-b88f-4444-87ba-67652492184a`, and verified approval-notice acknowledgement (`f8c0dbc`).
- **Journey C (`PASS`):** Created monitor `"Atlas build watch"` (`mon-8c53ff0c-4a62-4bf8-a132-890df03e56bb`), flipped `build/status.json` `PASS -> FAIL`, verified single deduplicated notification `"Atlas build: now \"FAIL\"."` across `7` checks, and verified `Snooze 1 h`.

### 9. Security, Performance, Local Regression & Hosted CI (`SECURITY_REGRESSION.md`, `PERFORMANCE_COMPARISON.md`, `HOSTED_CI_RESULTS.md`)
- **Security (`R1-G10` — `PASS`):** All 12 security invariants verified; `npm audit --omit=dev --audit-level=high` reported `0` vulnerabilities across `314` production / `478` total packages (`audit.json`).
- **Performance (`R1-G11` — `PASS`):** Startup `< 2 s`, installed restart recovery `5,305 ms`, idle CPU median `0.490%` (`p95 0.808%`), candidate soak memory slope `43.7 MB/day` (`<= 50 MB/day`), scheduling latency `p50 = 13 ms, p95 = 24 ms`, pinned `qwen2.5-coder:7b` Planner latency `mean 6,626 ms`, mid-step cancellation `2,647 ms`, handles `258 -> 257`, orphans `0`.
- **Local Regression (`R1-G12` — `PASS`):** `npx tsc --noEmit -p .` (`0`), `npm run build` (`0`), `JEV_DESKTOP_BUILD=1 npm run build` (`0`), `npm audit` (`0`), and full `npm test` (`0`).

### 10. Beta Go / No-Go Decision (`BETA_GO_NO_GO.md`)
- **Decision:** **`NO-GO` for General Beta** (Overall Milestone Qualification: **`PARTIAL`**) until:
  1. **Soak B** (`448ca6b`, port `43192`) completes its full 24 real hours at `~2026-10-25 15:06 UTC` and confirms `PASS` across `S1`–`S12`.
  2. Per-item button `aria-label` context and polite live-region announcements are verified in Windows Narrator, and live TalkBack touch exploration is executed on the physical Samsung SM-S948U.
  3. Goal-criterion linking is exposed in the Tasks UI and `qwen2.5-coder:7b` functional completion on `H1`–`H5` is raised from `2/5` (`1/5` completed) to `>= 4/5`.
