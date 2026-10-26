# MA4-S3-T3R1 — Notch & Task Status Presentation Integrity

## 1. Truthful State Vocabulary & Prohibited Heuristics

The dynamic Notch and Task Status UI components in Bunny A provide users with a real-time window into Host operations.

### Truthful State Taxonomy
The Notch presentation maps directly from the 12 canonical Host execution states:
1. `IDLE` — No task scheduled or executing.
2. `PLANNING` — Planner analyzing requirements.
3. `WORKING` — Worker formulating code or documentation.
4. `TESTING` — Tester actively running deterministic test process.
5. `REVIEWING` — Reviewer validating evidence.
6. `WAITING_APPROVAL` — Consequential action paused waiting for human decision.
7. `STOPPING` — Cancellation initiated; killing child processes.
8. `STOPPED` — Task halted by user request.
9. `FAILED` — Step or process exited with non-zero status.
10. `COMPLETED` — All steps succeeded with verified receipts.
11. `INTERRUPTED` — Host restart or network severance during execution.
12. `UNCERTAIN` — Consequential operation interrupted; awaiting owner reconciliation.

### Strict Prohibitions (No-Slop UI Invariants)
- **Zero Synthetic Percentages:** The UI must NEVER display estimated progress bars (e.g. "47% complete" or "ETA: 12 seconds") based on heuristics, character counts, or model assertions. Progress is represented strictly via discrete step completion counts (e.g. `Step 2 of 4`).
- **Role Transitions Grounded in Execution:** The Notch badge for a role (`Worker`, `Tester`) must light up ONLY when an actual execution context for that role is dispatched by the Host, never speculatively.
- **Exact Approval Details:** Consequential approval dialogs must present the exact file path, action kind, and SHA-256 payload digest. They must never use generic "Allow this app to continue?" prompts.
- **Visual Separation of Opinions vs. Receipts:** Green "Verified" badges may only accompany verified deterministic receipts (`receipt:test-exec:...` or `receipt:file:...`). Model explanations are styled as "Model Assessment" with distinct neutral tokens.

---

## 2. Accessibility & Layout Placement Rules

### Orientation & Multi-Monitor Placement
- **Horizontal Placement:** Aligns with standard top-center or left-anchor navigation (`side: "left"`, `axis: "row"`).
- **Vertical Placement:** Dynamic drop-down expanding downward (`side: "top"`, `axis: "column"`), avoiding collision with Windows taskbar or application menu headers.
- **Z-Index & Modality:** High-priority alerts (`WAITING_APPROVAL`, `UNCERTAIN`) maintain modal focus; passive states do not capture focus.

### Accessibility Standards
- **Keyboard Navigation:** Full Tab/Shift-Tab focus loops across approval dialogs and cancel buttons (`keyboardNav: true`).
- **Screen Reader Announcements:** Dynamic state changes announced via `aria-live="polite"` regions (`ariaLivePolite: true`).
- **Reduced Motion:** If `prefers-reduced-motion` is detected, pulsing animations and transitions are replaced with instantaneous state changes (`reducedMotionRespected: true`).
