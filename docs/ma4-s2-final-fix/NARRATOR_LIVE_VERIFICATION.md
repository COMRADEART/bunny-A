# Windows Narrator Live Verification & Screen-Reader Evidence

**Product:** Bunny A by LOKAM  
**Milestone:** MA4-S2 Remediation  
**Status:** PARTIAL (Automated AXTree & Keyboard 11/11 PASS; Live Narrator Rounds Documented with Detailed Findings)

---

## 1. Overview of Verification Methodology

Per prompt requirements, static code checks are NOT reported as live screen-reader evidence. Evidence is stratified into:
1. **Live Windows Narrator Listening Sessions** conducted with the workstation owner on the installed Windows candidate.
2. **Computed Chromium Accessibility Tree (`Accessibility.getFullAXTree` with `--force-renderer-accessibility`)** and UI Automation tree inspection.
3. **High-Contrast, Reflow (320px / 400% zoom), and Reduced-Motion Evaluation.**

---

## 2. Live Windows Narrator Rounds (Installed Release Candidate)

Tested on installed candidate `Bunny-A-Windows-S2T3R1-6-TEST` against `http://127.0.0.1:8084`:

| Round | Screen / Flow | Controls Tested | Actual Narrator Spoken Output | Finding / Verdict |
|---|---|---|---|---|
| **Round 1** | Main Dashboard & Tasks (`/?view=tasks`) | Primary nav (`Tasks`, `Execution history`), background policy checkboxes, notification `Dismiss` / `Snooze 1 h`, `New goal` disclosure, Goal `Pause`, Schedule `Turn off` | Announced name, role, and states (`selected`, `collapsed`, `unchecked`). Per-item buttons announced bare labels without naming the target row. | **PARTIAL** (Finding N-1) |
| **Round 2a** | Goal creation validation error | Empty submit on goal form: alert summary (`role="alert"`), invalid `Goal` input (`aria-invalid="true"`, `aria-describedby`) | Narrator announced alert summary (`"2 fields need attention"`) and focused input with error description. | **PASS** |
| **Round 2b** | Goal creation Host preview | Review heading focus move (`Review: New goal`), `Approve and start`, `Back to edit` | Focused heading read aloud; `Approve and start` and `Back to edit` announced as buttons. | **PASS** |
| **Round 3** | Approval Center & Task rows | Action approval (`Approve this action`, `Deny`, `Inspect details`), `Action details` region, task `Approve` / `Cancel` | Controls announced expected name and role; `Action details` region identified. Per-task buttons lacked task title context. | **PARTIAL** (Finding N-1) |
| **Round 4** | Dynamic live-region announcements | Focus parked on `Execution history`; task completed asynchronously (`15:24:55 UTC`), monitor notification arrived (`15:26:17 UTC`) | Neither asynchronous update was spoken unprompted while focus remained on `Execution history`. | **FAIL** (Finding N-2) |

---

## 3. UI Automation / AXTree Inspection Evidence

Full inspection evidence recorded in `docs/ma4-s2-t3r1/evidence/installed/accessibility-audit.json` (`11/11` checks PASS):

1. **Accessible Names & Roles:**
   - 0 unlabeled visible interactive controls across 126 accessibility tree nodes.
   - Primary navigation marked with `aria-current="page"`.
   - Native Windows WPF glass-notch (`Bunny-Island.ps1`) exposes `AutomationProperties.Name` on all 8 icon/progress controls (`Close Island`, `Expand or collapse`, `Connect a phone`, `Other integrations`, `System`, `Task progress`, `Routing approach`, `Switch light or dark`).

2. **Keyboard Traversal & Focus Rings:**
   - Unbroken logical `Tab` traversal with visible 2px high-contrast focus rings (`#0A84FF`).
   - `Skip to content` link moves focus directly to `#bunny-content`.
   - Zero keyboard focus traps.

3. **High Contrast, Reflow & Motion:**
   - `prefers-reduced-motion: reduce`: All CSS transitions and animations in the proactive dashboard and notch are halted (0 active animations).
   - High contrast (`forced-colors: active`): Semantic text borders and backgrounds render cleanly.
   - 320 CSS px reflow (equivalent to 400% zoom): Zero horizontal scroll/overflow (`hasOverflow320: false`).

---

## 4. Known Remediation Items for Post-Beta Polish

1. **N-1 (Item Context on Action Buttons):**
   - *Current Behavior:* Narrator speaks `"Dismiss, button"`, `"Approve, button"`, `"Turn off, button"`.
   - *Target Enhancement:* Append `aria-label="Approve Atlas status digest"` or `aria-describedby` pointing to row title so users navigating out of context hear the target item name.

2. **N-2 (Live Region Scheduling in Windows Chromium):**
   - *Current Behavior:* Polite live regions (`role="status"`, `aria-live="polite"`) may be suppressed by Windows Narrator when focus is parked on active interactive controls.
   - *Target Enhancement:* Add dual assertive announcement buffer for urgent task failures and notifications.
