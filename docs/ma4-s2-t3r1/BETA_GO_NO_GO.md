# MA4-S2-T3R1 — Beta Go / No-Go Decision (Gate R1-G15)

- **Gate R1-G15 Verdict:** **`PASS`** (Explicit, evidence-backed Beta Go / No-Go decision documented)
- **Beta Release Decision:** **`NO-GO` for General Beta** (Overall Milestone Qualification Verdict: **`PARTIAL`**)
- **Validated Candidate Commit:** `448ca6b6fb7252e2ea7af00e02ed9e078b5d1610` (`Bunny-A-Windows-S2T3R1-6-TEST`)

---

## 1. Eight-Dimension Beta Readiness Matrix (§13)

| # | Dimension | Verdict | Evidence & Rationale |
|---|---|---|---|
| **1** | **24-hour real-clock reliability** | **`IN PROGRESS` / `FAIL on Soak A`** | - **Soak A (`e6b6645`, `16.65 h / 24.0 h`):** `IN PROGRESS` (`~7.35 h` remaining until `2026-10-25 01:32 UTC`), **fails** `S5_memory` (`156.0`, `208.9`, `156.8 MB/day` > `50 MB/day`) and `S9_permissions` (`cancelledWorkRan: 1` harness race on sub-`5 ms` `file.read`).<br>- **Soak B (`448ca6b`, `3.08 h / 24.0 h`):** `IN PROGRESS` (`~20.92 h` remaining until `2026-10-25 15:06 UTC`). All active criteria `S2`–`S9`, `S11`, `S12` are passing at `3.08 h`, including **`S5_memory: true` (`43.7 MB/day` <= `50 MB/day`)**, but 24 real hours have not yet elapsed. |
| **2** | **Memory & process stability** | **`PASS`** | - 6-hour V8 heap reproduction (`heap.jsonl`) proved JS heap grew only `+2.56 MB` (`24.75 -> 27.31 MB`) and OS handles stayed flat (`258 -> 258`); Soak A's `WorkingSetPrivate` growth came from unbounded SQLite WAL/page accumulation because retention only ran at Host startup.<br>- Hourly runtime retention (`5c02c0e`) flattened `1,500`-round stress growth from `115.65 -> 114.61 MB` (`-1.04 MB` over rounds `100..1500`) and reduced Soak B's live slope to **`43.7 MB/day`**. Zero orphan processes (`gaps.json` `G6`). |
| **3** | **Installed Windows lifecycle** | **`PASS`** | - Isolated TEST package `Bunny-A-Windows-S2T3R1-6-TEST` built from `448ca6b` passed **`12/12`** checks in `installed/lifecycle.json` and **`6/6`** checks in `installed/gaps.json`, plus clean uninstall verification in `installed/cleanup.json` (`0` leftover processes/ports/files, `0` production mutations). |
| **4** | **Physical Android lifecycle** | **`PARTIAL` / `NOT TESTED (TalkBack)`** | - Physical Samsung SM-S948U (`com.routeragent.jev` `2.1 (3)`) passed `9/9` paired-device checks in T3R (`docs/ma4-s2-t3r/evidence/android/round2.json`), and mobile `390x844` / `320x700` accessibility-tree and reflow checks passed (`docs/ma4-s2-t3r1/evidence/installed/accessibility-audit.json`), but the physical phone was **not attached** during T3R1 (`adb devices` empty), so live TalkBack touch exploration could not be executed. |
| **5** | **Windows Narrator accessibility** | **`PARTIAL`** | - 4 live Narrator rounds were completed with the owner on `Bunny-A-Windows-S2T3R1-6-TEST` (`11/11` CDP AXTree/media/reflow checks `PASS` in `accessibility-audit.json`), uncovering 2 genuine screen-reader defects: (a) per-item action buttons (`Dismiss`, `Snooze 1 h`, `Pause`, `Turn off`, `Approve`, `Cancel`) lack item-title context in their accessible names, and (b) asynchronous task completion and monitor `source_changed` updates were not spoken unprompted by Narrator in Round 4. |
| **6** | **Android TalkBack accessibility** | **`NOT TESTED`** | - Physical Samsung SM-S948U was disconnected throughout T3R1 (`adb devices` empty; `0` tunnel processes). Never marked `PASS` without live TalkBack testing on the physical phone. |
| **7** | **Local-model planning & execution quality** | **`PARTIAL` (Safety `PASS`, Functional `FAIL`)** | - Pin-derived structured-output schema (`61673e2`, `4dd1d43`, `713891e`) raised `qwen2.5-coder:7b` valid-plan rate from **`0/5` (`0%`) to `5/5` (`100%`)** (`mean 6,626 ms`) and passed **all `8/8` (`100%`) adversarial prompt-injection tests (`X1`–`X8`)** with `0` unsafe actions on both `qwen2.5-coder:7b` and `deepseek-r1:7b`.<br>- However, on the held-out functional set (`H1`–`H5`), `qwen2.5-coder:7b` achieved **`2/5` (`40%`) functionally correct plans** and **`1/5` (`20%`) end-to-end completed tasks** (vs pre-registered `>= 4/5` bar), and `deepseek-r1:7b` timed out (`90 s`) when Ollama combined thinking tokens with grammar-constrained JSON output. |
| **8** | **Security & permission enforcement** | **`PASS`** | - All 12 security invariants in `SECURITY_REGRESSION.md` passed (`8/8` prompt-injection refusals, `2,647 ms` mid-step cancellation with `0` post-cancel receipts, `0` duplicate schedule dispatches across restarts, `0` orphan processes after `SIGKILL`, `0` cloud calls, `0` high/critical npm audit vulnerabilities). |

---

## 2. Explicit Beta Go / No-Go Decision

### Decision: **`NO-GO` for General Beta Release**

**Why General Beta is `NO-GO` today (`2026-10-24`):**

1. **Real-Clock 24-Hour Soak Completion (`Dimension 1`):**
   - The original T3R soak (`Soak A`, `e6b6645`) failed `S5_memory` (`156–209 MB/day`) and `S9_permissions` (`cancelledWorkRan: 1` harness race).
   - The T3R1 candidate soak (`Soak B`, `448ca6b`) is currently passing `S5_memory` at **`43.7 MB/day`** (`<= 50 MB/day`) and all other active criteria at `3.08 h`, but will not complete its full 24 real hours until **`~2026-10-25 15:06 UTC`**. Per project rules, a 24-hour soak cannot be claimed `PASS` before 24 real hours have elapsed.
2. **Real 7B Planner / Reviewer Functional Completion (`Dimension 7` & `Journey A`):**
   - While the pin-derived JSON Schema fix (`61673e2`, `4dd1d43`, `713891e`) completely solved schema-validation failures on `qwen2.5-coder:7b` (`0/5 -> 5/5` schema-valid plans, `8/8` adversarial prompt-injection refusals), the 7B model still mis-parameterizes multi-step `local.generate` dependencies (`H2`, `H4`), uses a literal placeholder in `connected.create` (`H5`), and over-rejects `file.stat` output in the Reviewer (`H1`), yielding `2/5` functional plans and `1/5` end-to-end completed tasks. In addition, the dashboard UI lacks a control to link a task to a goal's `criterionId` (`Journey A`).
3. **Screen-Reader Polish & Physical TalkBack Pass (`Dimensions 5 & 6`):**
   - Live Windows Narrator testing uncovered missing item-title context on per-row action buttons (`Dismiss`, `Snooze 1 h`, `Pause`, `Turn off`, `Approve`, `Cancel`) and unannounced asynchronous status updates in Round 4, and the physical Android device (`SM-S948U`) must be attached to complete live TalkBack touch exploration.

### Conditions Required to Flip `NO-GO` -> `GO`:
1. Allow **Soak B** (`%LOCALAPPDATA%\Bunny-S2T3R1-Soak`, port `43192`, commit `448ca6b`) to finish its remaining `~20.9 h` through `2026-10-25 15:06 UTC` and re-run `node scripts/ma4-s2t3r/soak-report.mjs` to confirm 24-hour `PASS` on `S1`–`S12`.
2. Add item-specific `aria-label` context to per-row action buttons (e.g., `aria-label={`Dismiss ${note.title}`}`, `aria-label={`Pause goal ${goal.title}`}`, `aria-label={`Approve task ${task.title}`}`) and verify polite live-region announcements in Windows Narrator + live TalkBack on the physical Samsung SM-S948U.
3. Add a Goal criterion selector to task/schedule creation in `proactive.tsx` and tighten the Planner system prompt / deterministic Reviewer acceptance for `file.stat` so `qwen2.5-coder:7b` reaches `>= 4/5` on `H1`–`H5`.
