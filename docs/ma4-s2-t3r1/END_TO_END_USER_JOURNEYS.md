# MA4-S2-T3R1 — End-to-End User Journeys (Gate R1-G9)

- **Gate R1-G9 Verdict:** **`PARTIAL`** (`Journey A: PARTIAL`, `Journey B: PASS`, `Journey C: PASS`)
- **Environment:** Installed TEST release `Bunny-A-Windows-S2T3R1-6-TEST` (commit `448ca6b6fb7252e2ea7af00e02ed9e078b5d1610`), dashboard gateway `http://127.0.0.1:8084/?view=tasks` backed by installed Host `http://127.0.0.1:43193`
- **Primary Evidence:** [`docs/ma4-s2-t3r1/evidence/installed/journeys.json`](evidence/installed/journeys.json), [`docs/ma4-s2-t3r1/evidence/installed/lifecycle.json`](evidence/installed/lifecycle.json), [`docs/ma4-s2-t3r1/evidence/installed/gaps.json`](evidence/installed/gaps.json)

---

## Summary Table

| Journey | Required Flow | Installed-UI Execution & Host Evidence | Verdict |
|---|---|---|---|
| **Journey A — Create and track a goal** | Create goal in UI -> review Host preview -> approve -> track progress -> inspect receipts -> pause/resume/cancel | Goal `"Prepare Atlas for beta"` (`goal-538873eb-6b4d-4908-8995-9614472cd55a`) created in UI, previewed by Host, approved (`state: "ACTIVE"`, criterion `crit-goal-538873eb-6b4d-4908-8995-9614472cd55a-1`), paused and resumed (`PAUSED -> ACTIVE`), and persisted across upgrades and Host restarts. **Why PARTIAL:** The dashboard UI does not provide a control to link a task to a goal's `criterionId`, so a user cannot drive goal criterion completion (`"0 of 1 criteria met by completed work"` -> `"1 of 1"`) through the UI alone (and the real 7B Planner failed the held-out functional gate `2/5` correct, `1/5` completed). | **`PARTIAL`** |
| **Journey B — Schedule background work** | Register allowed folder in UI -> create schedule in UI -> review preview (next run, actions, data, model, approvals, expiry) -> approve -> enable background execution -> wait for real scheduled execution -> inspect receipt & notification | Registered `"Atlas project"` (`C:\Users\allam\Documents\new\bunny-t3r1-installed-project`) via the new `Folders Bunny-A may read` UI (`fa72845`, after verifying `C:\Windows\System32` is refused with `"System and application folders cannot be granted."`). Created schedule `"Atlas status check"` (`sch-639cf003-72c8-4153-9c98-d869202535de`) for `2026-10-24 10:59 America/New_York`, reviewed Host preview, approved, enabled background checkboxes, and verified at `10:59:00 EDT` (`14:59:00 UTC`, `1792853940000`) that occurrence `occ-sch-639cf003-72c8-4153-9c98-d869202535de:1792853940000` dispatched task `ptask-sch-639cf003-72c8-4153-9c98-d869202535de-1792853940000`, reached `COMPLETED`, wrote verified `file.stat` receipt `rcpt-4c79ca8a-b88f-4444-87ba-67652492184a`, and cleared its approval notice upon approval (`f8c0dbc`). | **`PASS`** |
| **Journey C — Monitor and receive notification** | Create monitor in UI -> review preview -> approve -> trigger monitored condition -> receive deduplicated notification -> snooze/dismiss -> verify no duplicate notification | Created monitor `"Atlas build watch"` (`mon-8c53ff0c-4a62-4bf8-a132-890df03e56bb`, short label `"Atlas build"`) watching `build/status.json` JSON field `status` for `PASS -> FAIL` every `1 min`. Reviewed preview and approved. Flipped `build/status.json` to `{"status":"FAIL"}` (`lastChangedAt: 1792853693297`) and rewrote identical bytes on subsequent minutes (`lastCheckedAt: 1792854672227`). Verified exactly **one** notification (`"Atlas build: now \"FAIL\"."`, `pnote-source_changed:mon-8c53ff0c-4a62-4bf8-a132-890df03e56bb:4`) was emitted across `7` checks (`0` duplicates), and verified `Snooze 1 h` (`snoozedUntil: 1792862997223`) hid the notification without re-emission. | **`PASS`** |

---

## Detailed Step-by-Step Evidence

### 1. Journey A — Create and Track a Goal (`PARTIAL`)

1. **Creation & Host Preview (`http://127.0.0.1:8084/?view=tasks`):**
   - Clicked `New goal` in `[data-testid="proactive-create"]`.
   - Entered Goal `"Prepare Atlas for beta"` and Success criteria `"Status checked and build passing"`.
   - Clicked `Review` -> Host preview rendered `What Bunny-A will do`, `Success criteria`, and `Your approval lasts until` without persisting the goal before approval.
2. **Approval & Persistence (`goal-538873eb-6b4d-4908-8995-9614472cd55a`):**
   - Clicked `Approve and start`.
   - Persisted record in `journeys.json`:
     - `id`: `goal-538873eb-6b4d-4908-8995-9614472cd55a`
     - `title`: `"Prepare Atlas for beta"`
     - `state`: `"ACTIVE"`
     - `createdAt`: `1792853277620` (`2026-10-24T14:47:57.620Z`)
     - `criteria`: `[{"id": "crit-goal-538873eb-6b4d-4908-8995-9614472cd55a-1", "label": "Status checked and build passing", "met": false, "evidenceTaskId": null, "evidenceReceiptId": null}]`
3. **Pause / Resume & Upgrade Survival:**
   - Exercised `Pause` (`ACTIVE -> PAUSED`) and `Resume` (`PAUSED -> ACTIVE`) in the dashboard UI, and verified the goal survived upgrades `-3 -> -4 -> -5 -> -6` and Host restarts (`lifecycle.json` checks #11–12).
4. **Identified Product Gap (Why Journey A is `PARTIAL`):**
   - While `goal.evaluate` on the Host marks a criterion met when a completed task has `goalId` and `criterionId` plus a verified receipt, the dashboard UI has no task-creation or schedule-creation control to attach a task to a goal's `criterionId`. Consequently, a user operating strictly through the UI cannot advance `"0 of 1 criteria met by completed work"` to `"1 of 1"`.

---

### 2. Journey B — Schedule Background Work (`PASS`)

1. **UI Folder Registration (`fa72845`):**
   - Opened `Add folder` in `Folders Bunny-A may read` on `http://127.0.0.1:8084/?view=tasks`.
   - First attempted to register system folder `C:\Windows\System32` -> Host rejected with `"System and application folders cannot be granted."`
   - Registered `"Atlas project"` (`C:\Users\allam\Documents\new\bunny-t3r1-installed-project`, root ID `atlas`).
2. **UI Schedule Creation, Preview, and Approval (`sch-639cf003-72c8-4153-9c98-d869202535de`):**
   - Clicked `New schedule`, entered Name `"Atlas status check"`, Folder `"Atlas project"`, Files `"STATUS.md, ISSUES.md"`, Frequency `"Once"`, Date `"2026-10-24"`, Time `"10:59"`, Time zone `"America/New_York"`, Local model `"qwen2.5-coder:7b"`.
   - Clicked `Review` -> verified Host preview listed next run (`10:59 EDT`), actions (`file.stat`), files read (`STATUS.md, ISSUES.md`), local model (`qwen2.5-coder:7b`), further approval requirements, and expiry.
   - Clicked `Approve and start` and enabled both background-execution checkboxes (`Allow approved tasks to run in the background` and `Allow approved schedules and monitors to run in the background`).
3. **Real Wall-Clock Execution & Receipt Verification:**
   - At `2026-10-24T14:59:00.289Z` (`10:59:00 EDT`, slot `1792853940000`), the Host created occurrence `occ-sch-639cf003-72c8-4153-9c98-d869202535de:1792853940000` and task `ptask-sch-639cf003-72c8-4153-9c98-d869202535de-1792853940000`.
   - After owner approval, the task transitioned `WAITING_APPROVAL -> READY -> RUNNING -> COMPLETED` at `1792853997253` (`14:59:57 UTC`), writing verified `file.stat` receipt `rcpt-4c79ca8a-b88f-4444-87ba-67652492184a` (`{"files":[{"path":"STATUS.md","size":42},{"path":"ISSUES.md","size":44}]}`).
   - Approving the task automatically acknowledged its `approval_needed` notification (`tnote-ptask-sch-639cf003-72c8-4153-9c98-d869202535de-1792853940000-approval_needed-1`, commit `f8c0dbc`), leaving only the `completed` notification `"Atlas status check completed (1 verified receipt)."`

---

### 3. Journey C — Monitor and Receive Notification (`PASS`)

1. **UI Monitor Creation, Preview, and Approval (`mon-8c53ff0c-4a62-4bf8-a132-890df03e56bb`):**
   - Clicked `New monitor`, entered Name `"Atlas build watch"`, Short label `"Atlas build"`, Folder `"Atlas project"`, JSON file `"build/status.json"`, JSON field `"status"`, Notify when `"A JSON field changes from one value to another"` (`from: "PASS"`, `to: "FAIL"`), Check every `"1 min"`.
   - Clicked `Review` -> verified Host preview -> clicked `Approve and start`.
2. **Real Condition Trigger & Deduplication Verification:**
   - Initial check saw `{"status":"PASS"}` (`lastValueJson: "\"PASS\""`, `0` notifications).
   - Updated `build/status.json` to `{"status":"FAIL"}` -> at `1792853693297` (`14:54:53 UTC`), monitor transitioned `lastValueJson` to `"\"FAIL\""` and emitted notification `pnote-source_changed:mon-8c53ff0c-4a62-4bf8-a132-890df03e56bb:4` (`title: "Atlas build"`, `body: "Atlas build: now \"FAIL\"."`).
   - Rewrote identical `{"status":"FAIL"}` bytes and observed subsequent minute checks through `lastCheckedAt: 1792854672227` (`15:11:12 UTC`) -> `0` duplicate notifications emitted.
   - Clicked `Snooze 1 h` in the dashboard UI -> `state` transitioned to `"SNOOZED"` (`snoozedUntil: 1792862997223`) and remained hidden.
