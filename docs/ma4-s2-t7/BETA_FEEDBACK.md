# MA4-S2-T7 — Safe Beta Feedback Channel (`BETA_FEEDBACK.md`)

- **Gate T7-E Verdict:** **`PASS`** (Local-first opt-in submission, preview, redaction, export, and history clearing qualified; remote upload disabled)

---

## 1. Beta Feedback Architecture (`src/lib/bunny-host/ma4/diagnostics-feedback.ts`)

Implemented in [`src/lib/bunny-host/ma4/diagnostics-feedback.ts`](../../src/lib/bunny-host/ma4/diagnostics-feedback.ts) (`LocalBetaFeedbackStore`, `BetaFeedbackEntry`) and verified in `T7-E` ([`src/lib/bunny-host/ma4-s2t7.test.ts`](../../src/lib/bunny-host/ma4-s2t7.test.ts)):

1. **Explicit Opt-In Required:**
   - `store.isOptedIn()` defaults to `false`. Calling `submit()` while opted out throws `"Beta feedback is disabled until the user explicitly opts in."`
2. **Full Payload Preview & Automatic Secret/Path/Email Redaction (`previewEntry`):**
   - Before saving a feedback entry (`bug`, `usability`, `accessibility`, `model_quality`, `general`), `previewEntry()` applies `redactDiagnosticString()` to `summary` and `details` and `scrubDiagnosticValue()` to any attached `SanitizedSupportBundle` so the user can inspect the exact redacted payload.
3. **Local-Only Storage & History Clearing (`clearHistory`):**
   - Every entry sets `remoteUploadDispatched: false` (no unapproved external feedback server is contacted).
   - Users can inspect all stored feedback entries via `list()` and delete them at any time via `clearHistory()`.
