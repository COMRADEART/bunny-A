# MA4-S2-T5 — Windows & Android Native Notifications (`NATIVE_NOTIFICATIONS.md`)

- **Gate T5-B (Windows Native Notifications) Verdict:** **`PASS`**
- **Gate T5-C (Android Companion Notifications) Verdict:** **`PASS` (Authenticated session delivery & revocation qualified; remote push relay explicitly disabled)**

---

## 1. Notification Categories & Opt-In Policy

Implemented in [`src/lib/bunny-host/ma4/native-notifications.ts`](../../src/lib/bunny-host/ma4/native-notifications.ts) (`NATIVE_NOTIFICATION_CATEGORIES`, `DEFAULT_NATIVE_NOTIFICATION_PREFS`, `evaluateNativeNotification`):

- **Global Opt-In Default:** `enabled: false` (Bunny A never emits OS banners unless the user opts in).
- **Supported Categories (`6`):**
  1. `approval_needed` — Consequential action or new schedule/goal waiting for approval.
  2. `task_completed` — Persistent task completed with verified receipts.
  3. `task_failed` — Persistent task failed or exceeded budget.
  4. `schedule_triggered` — Scheduled run started (default `false` even when notifications are enabled, to prevent routine noise).
  5. `source_changed` — Active monitor detected a meaningful source transition.
  6. `recovery_needed` — Interrupted task requires owner reconciliation (`happened` / `not_happened` / `abandon`).

---

## 2. Deduplication, Quiet Hours, Privacy Redaction & Truthful Wording

Verified in `T5-B & T5-C` ([`src/lib/bunny-host/ma4-s2t5.test.ts`](../../src/lib/bunny-host/ma4-s2t5.test.ts)):

1. **Deterministic Deduplication:** Keyed by `${category}:${sourceId}:r${revision}` (`suppressedReason: "duplicate"` on repeat evaluations).
2. **Quiet Hours Enforcement:** `isWithinQuietHours(localHour, quietHours)` suppresses delivery during configured quiet hours (e.g., `22:00–07:00`, holding notices in the dashboard until quiet hours end).
3. **Lock-Screen / Banner Privacy Redaction (`sanitizeNotificationText`):** Strips Windows paths (`C:\Users\...`), POSIX paths (`/home/...`), bearer/API tokens (`sk-...`, `Bearer ...`, JWTs), and email addresses (`user@domain.tld`), replacing them with `[redacted]`.
4. **Never Implies Pending Work Is Completed:**
   - `approval_needed` banners are prefixed with `"Approval waiting (not started): ..."` and set `impliesCompleted: false`.
   - `recovery_needed` banners are prefixed with `"Recovery needed (paused): ..."` and set `impliesCompleted: false`.
5. **Android Companion Revocation & Offline Rules:**
   - Revoked devices (`revoked: true`) are immediately blocked (`suppressedReason: "revoked_device"`).
   - Disconnected devices (`connected: false`) are suppressed (`suppressedReason: "device_offline"`).
   - `remotePushRelayUsed` is hard-coded to `false`: Bunny A never routes notifications through an unapproved third-party cloud push relay.
