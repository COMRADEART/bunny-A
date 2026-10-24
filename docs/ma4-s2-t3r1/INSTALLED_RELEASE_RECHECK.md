# MA4-S2-T3R1 — Installed Windows Release Recheck (Gate R1-G7)

- **Gate R1-G7 Verdict:** **`PASS`** (Isolated TEST installation of final candidate code `448ca6b6fb7252e2ea7af00e02ed9e078b5d1610` verified end-to-end and cleanly removed; owner's production installation untouched)
- **Primary Evidence:**
  - Pre-install system snapshot: [`docs/ma4-s2-t3r1/evidence/release/system-before.json`](evidence/release/system-before.json)
  - Package & upgrade logs (`-3`, `-4`, `-5`, `-6` TEST packages): [`docs/ma4-s2-t3r1/evidence/release/package-6.log`](evidence/release/package-6.log), [`docs/ma4-s2-t3r1/evidence/release/install-upgrade-6.log`](evidence/release/install-upgrade-6.log)
  - 12-check installed lifecycle report (`12/12 PASS`): [`docs/ma4-s2-t3r1/evidence/installed/lifecycle.json`](evidence/installed/lifecycle.json)
  - 6-check installed gap-closure report (`6/6 PASS`): [`docs/ma4-s2-t3r1/evidence/installed/gaps.json`](evidence/installed/gaps.json)
  - Interactive UI user-journey report: [`docs/ma4-s2-t3r1/evidence/installed/journeys.json`](evidence/installed/journeys.json)
  - Post-uninstall system cleanup verification: [`docs/ma4-s2-t3r1/evidence/installed/cleanup.json`](evidence/installed/cleanup.json)

---

## 1. Why an Installed-Release Recheck Was Required in T3R1

In T3R, the 18/18 installed Windows checks ran on `Bunny-A-Windows-S2T3R4-TEST` built from commit `8802e0c`, which predated the T3R final head (`10993bd`) and all T3R1 fixes. Between `10993bd` and the T3R1 candidate freeze (`448ca6b`), the following runtime and UI changes were made:

| Commit | Surface Changed | Purpose |
|---|---|---|
| `61673e2` / `4dd1d43` / `713891e` | `src/lib/bunny-host/ma4/agent-loop.ts`, `task-commands.server.ts`, `task-executors.server.ts` | Pin-derived structured-output JSON Schema for the Planner (per-action input schema + `^step-[1-6]$` step IDs) |
| `5c02c0e` | `src/lib/bunny-host/ma4/task-runtime.server.ts`, `proactive.server.ts`, `http.server.ts` | Hourly runtime enforcement of `applyRetention()` and `applyProactiveRetention()` so SQLite WAL/shared-memory pages stay bounded during multi-hour uptime |
| `fade2b6` | `src/components/island/proactive.css` | Exclude `<input type="checkbox">` from text-input `min-height: 2.3rem` sizing |
| `fa72845` | `src/components/island/proactive.tsx`, `src/store/use-island.ts` | Add dashboard UI (`Folders Bunny-A may read`) to register and remove allowed connector roots via `connector.roots.set` |
| `f8c0dbc` | `src/lib/bunny-host/ma4/task-commands.server.ts`, `task-store.server.ts` | Acknowledge active `approval_needed` task notifications when the owner approves or denies the task (`ptask.approve`, `ptask.action.approve`, `ptask.action.deny`) |
| `448ca6b` | `scripts/ma4-s2t3r/installed-lifecycle.mjs`, `installed-gaps.mjs` | Parameterize installed check scripts via environment variables (`BUNNY_T3R_PROJECT`, `BUNNY_T3R_GOAL_TITLE`, etc.) for candidate `S2T3R1-6-TEST` |

---

## 2. Packaging & Isolated Upgrade Chain

All packaging and installation ran strictly inside the isolated root `C:\Users\allam\AppData\Local\Bunny-S2T3R-Install\r1` (`hostPort = 43193`, gateway `http://127.0.0.1:8084`, synthetic workspace `C:\Users\allam\Documents\new\bunny-t3r1-installed-project`), never touching the owner's `%LOCALAPPDATA%\Bunny-A`:

1. Packaged and installed `Bunny-A-Windows-S2T3R1-TEST` (`5c02c0e`), upgraded through `Bunny-A-Windows-S2T3R1-3-TEST` (`fade2b6`), `Bunny-A-Windows-S2T3R1-4-TEST` (`fa72845`), `Bunny-A-Windows-S2T3R1-5-TEST` (`f8c0dbc`), and finally **`Bunny-A-Windows-S2T3R1-6-TEST`** (`448ca6b6fb7252e2ea7af00e02ed9e078b5d1610`).
2. `Install-Bunny-Release.ps1 -Upgrade` verified `release-manifest.json` SHA-256 (`E4B150E57FC3E23C582B542E07D9575B2E94957630201C6460BA1100E937DB82` for `-6-TEST`), backed up `host.sqlite` before switching `install.json`, and preserved all SQLite goals, schedules, monitors, tasks, occurrences, receipts, and notifications across every upgrade.

---

## 3. Lifecycle Verification (`12/12 PASS` — `evidence/installed/lifecycle.json`)

Executed against the installed `Bunny-A-Windows-S2T3R1-6-TEST` build (`sourceCommit = 448ca6b6fb7252e2ea7af00e02ed9e078b5d1610`):

| # | Check | Result | Measured Detail |
|---|---|---|---|
| 1 | Installed Host and gateway are from `Bunny-A-Windows-S2T3R1-6-TEST` | **PASS** | `release = "Bunny-A-Windows-S2T3R1-6-TEST"`, `sourceCommit = "448ca6b6fb7252e2ea7af00e02ed9e078b5d1610"`, `hostPid = 36244`, `gatewayPid = 30608` |
| 2 | Installed dashboard opens in real Chrome (`1280 px` and `390 px`, zero console errors) | **PASS** | `errors = []` |
| 3 | Local models come from real local Ollama; cloud tag (`deepseek-v4.1-flash:cloud`) is never offered | **PASS** | Offered: `qwen2.5-coder:7b`, `deepseek-r1:7b`, `qwen2.5:1.5b`, `llama3.2:latest`; `:cloud` excluded |
| 4 | UI Goal creation (`Prepare Atlas for beta`) -> Review -> Approve | **PASS** | `goal-538873eb-6b4d-4908-8995-9614472cd55a` (`state: "ACTIVE"`) |
| 5 | UI Schedule creation (`Atlas status check`) -> Review -> Approve | **PASS** | `sch-639cf003-72c8-4153-9c98-d869202535de` (`state: "ACTIVE"`) |
| 6 | UI Monitor creation (`Atlas build watch`) -> Review -> Approve | **PASS** | `mon-8c53ff0c-4a62-4bf8-a132-890df03e56bb` (`state: "ACTIVE"`) |
| 7 | Scheduled occurrence runs at real wall-clock minute (`10:59 EDT`) and writes verified `file.stat` receipt | **PASS** | `occ-sch-639cf003-72c8-4153-9c98-d869202535de:1792853940000` (`state: "EXECUTED"`, `receipts: 1`) |
| 8 | Monitor detects `build/status.json` `PASS -> FAIL` and raises `source_changed` notification | **PASS** | `"Atlas build: now \"FAIL\"."` (`pnote-source_changed:mon-8c53ff0c-4a62-4bf8-a132-890df03e56bb:4`) |
| 9 | Unchanged `build/status.json` rewrite does not emit a duplicate notification | **PASS** | `notes = 1` across `7` checks |
| 10 | Snoozed notification (`Snooze 1 h`) stays hidden until `snoozedUntil` | **PASS** | `snoozedUntil = 1792862997223` |
| 11 | Clean stop and restart via `Start-Bunny-Release.ps1` recovers state in `<= 30 s` | **PASS** | Recovered in **`5,305 ms`** (`oldPid = 11340 -> newPid = 17112`); goals `1`, schedules `1`, monitors `1`, occurrences `1`, tasks `5`, integrity `"ok"`, orphans `0` |
| 12 | Reboot / re-login startup path (`Start-Bunny-Release.ps1`) starts installed Host and restores state | **PASS** | `hostPid = 17112`, all proactive and task records intact |

---

## 4. Gap-Closure Verification (`6/6 PASS` — `evidence/installed/gaps.json`)

Executed against the installed `Bunny-A-Windows-S2T3R1-6-TEST` build (`sourceCommit = 448ca6b6fb7252e2ea7af00e02ed9e078b5d1610`):

| Gate | Check | Result | Measured Detail |
|---|---|---|---|
| **G2** | Real local `qwen2.5-coder:7b` (`sha256:dae161e27b0e`) runs a `local.generate` step in the installed Host, persists a verified receipt, and makes `0` external calls | **PASS** | `taskId = "ptask-fd24fc04-a813-4df0-beb7-170ff5159169"`, `durationMs = 15,876`, `receiptId = "rcpt-d8582682-6fd3-4f8c-8561-75498b88535d"` |
| **G3** | Real `file.apply` step pauses in `WAITING_APPROVAL`, renders in the installed Approval Center UI (`Approve this action` / `Deny` / `Inspect details`), applies only after UI click on `Approve this action`, and acknowledges the approval notification (`f8c0dbc`) | **PASS** | `taskId = "ptask-65178bd5-a8b8-46ec-b2bd-e2c8dd5c15f5"`, `beforeBytes = 42`, `afterBytes = 79`, `receiptId = "rcpt-28931a75-9d8a-4e28-8886-699482e78b7e"` |
| **G4** | Clicking `Cancel` in the installed UI while a real Ollama `local.generate` call is in flight aborts the request within `10 s` and writes `0` post-cancel receipts | **PASS** | `taskId = "ptask-c801122e-46f0-4a8e-be98-8f68190d03c9"`, **`cancelMs = 2,647`**, `finalState = "CANCELLED"`, `postCancelReceipts = 0` |
| **G5** | Restarting the installed Host during the same due minute produces `0` duplicate schedule occurrences, `0` duplicate tasks, and `0` duplicate notifications | **PASS** | `occCount = 1`, `taskCount = 1`, `duplicateNotes = 0` |
| **G6** | Forced kill (`Stop-Process -Force`) of the installed Host leaves `0` outliving child processes; restart recovers all SQLite state with `PRAGMA integrity_check = ok` | **PASS** | `killedPid = 19784`, `childrenBefore = [18068, 22488]`, **`outlived = []`**, `restartedPid = 36244`, `integrity = "ok"` |
| **G7** | Uninstalling the isolated test release stops only test processes, removes test files, and leaves production `%LOCALAPPDATA%\Bunny-A`, Startup shortcuts, Run keys, scheduled tasks, and services untouched | **PASS** | Verified in [`docs/ma4-s2-t3r1/evidence/installed/cleanup.json`](evidence/installed/cleanup.json) (`r1DirectoryRemoved: true`, `testProcessesLeft: 0`, `ports43193and8084Listening: false`, `startupItemsUnchanged: true`, `runKeysUnchanged: true`) |
