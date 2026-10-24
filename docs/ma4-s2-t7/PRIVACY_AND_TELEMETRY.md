# MA4-S2-T7 — Privacy & Telemetry Governance (`PRIVACY_AND_TELEMETRY.md`)

- **Gate T7-B Verdict:** **`PASS`**

---

## 1. Local-First Storage & Retention Policy

1. **What Bunny A Stores Locally (`<InstallRoot>\data\`):**
   - `host-state.sqlite` and `ma4-tasks.sqlite` (persistent tasks, checkpoints, action receipts, goals, schedules, schedule occurrences, monitors, notifications, paired device records, and connector folder roots).
   -Hourly runtime retention (`MA4_RETENTION_INTERVAL_MS = 3,600,000` in [`src/lib/bunny-host/ma4/task-runtime.server.ts`](../../src/lib/bunny-host/ma4/task-runtime.server.ts) and [`src/lib/bunny-host/ma4/proactive.server.ts`](../../src/lib/bunny-host/ma4/proactive.server.ts), commit `5c02c0e`) prunes terminal tasks (`<= 150`), occurrences (`<= 500`), and notifications (`<= 200`).
2. **Optional Telemetry Disabled by Default (`DEFAULT_TELEMETRY_POLICY`):**
   - `telemetryOptIn: false`
   - `remoteUploadEnabled: false` (no external telemetry collection endpoint is enabled).
3. **Permanently Prohibited Telemetry Categories (`prohibitedCategories`):**
   - `raw_prompts`
   - `file_contents`
   - `email_bodies`
   - `calendar_details`
   - `document_contents`
   - `oauth_tokens`
   - `pairing_secrets`
   - Even if optional telemetry is enabled in a future release, these 7 categories are structurally excluded from collection.
