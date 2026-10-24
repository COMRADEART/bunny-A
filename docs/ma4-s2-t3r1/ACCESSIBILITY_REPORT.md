# MA4-S2-T3R1 — Accessibility Report (T3R1-C / Gates R1-G4, R1-G5 & R1-G8)

- **Windows Narrator & Desktop Accessibility (`R1-G4`):** **`PARTIAL`** — Full screen-by-screen details in [`WINDOWS_NARRATOR_QUALIFICATION.md`](WINDOWS_NARRATOR_QUALIFICATION.md) and [`evidence/installed/accessibility-audit.json`](evidence/installed/accessibility-audit.json) (`11/11` CDP AXTree, keyboard, High Contrast, Reduced Motion, and `320 CSS px` reflow checks `PASS`; 4 live Windows Narrator rounds completed with the workstation owner).
- **Android TalkBack Qualification (`R1-G5`):** **`NOT TESTED`** — Physical Samsung SM-S948U (`com.routeragent.jev` `2.1`, versionCode `3`) was not attached via USB during T3R1 (`adb devices` empty; `0` tunnel processes). Mobile-web DOM/AXTree checks (`390x844` and `320x700`) pass with zero unlabeled controls and zero overflow, but are not substituted for live TalkBack touch exploration. Full details in [`ANDROID_TALKBACK_QUALIFICATION.md`](ANDROID_TALKBACK_QUALIFICATION.md).
- **Physical Android Authorization & Supervision (`R1-G8`):** **`PARTIAL`** — Physical pairing, supervision, revocation, offline behavior, and workstation-only approval boundaries passed on the Samsung SM-S948U in T3R (`docs/ma4-s2-t3r/evidence/android/round2.json`) and in T3R1 regression suites, while physical TalkBack remains `NOT TESTED`.

---

## Summary of Live Screen-Reader Findings (Windows Narrator Rounds 1–4)

1. **Finding N-1 — Missing item-title context on per-row action buttons (`Narrator Rounds 1 & 3`):**
   - Per-item action buttons (`Dismiss`, `Snooze 1 h`, `Pause`, `Turn off`, `Approve`, `Cancel`, `Approve this action`, `Deny`, `Inspect details` — `17` instances in `accessibility-audit.json`) expose only their bare action label without an `aria-label` or `aria-describedby` naming which notification, goal, schedule, monitor, or task they act upon.
2. **Finding N-2 — Unannounced asynchronous status/notice updates (`Narrator Round 4`):**
   - When keyboard focus remained parked on `Execution history`, asynchronous task completion (`"Atlas status digest"` at `15:24:55 UTC`) and monitor `source_changed` notification (`"Atlas build: now \"FAIL\"."` at `15:26:17 UTC`) updated DOM `role="status"` elements, but Windows Narrator did not speak either update unprompted (`Heard neither`).
3. **Confirmed Passing in Live Narrator (`Rounds 1, 2a, 2b, 3`):**
   - Empty Goal form submission (`Round 2a`) announced both the assertive `role="alert"` summary (`"2 fields need attention."`) and the focused invalid `Goal` input with its `aria-describedby` error (`"Name the goal."`).
   - Goal preview (`Round 2b`) moved focus to `<h3 tabIndex="-1">Review: New goal</h3>` and read the heading, `Approve and start`, and `Back to edit`.
   - Action-level approval (`Round 3`) exposed `Approve this action`, `Deny`, `Inspect details` (`aria-expanded`), and the `Action details` region.
   - Checkbox sizing regression fixed (`fade2b6`), `prefers-reduced-motion: reduce` stops all animations (`animCount = 0`), `forced-colors: active` renders cleanly, and `320 CSS px` zoom reflow has zero horizontal overflow (`hasOverflow320 = false`).
