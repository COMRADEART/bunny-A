# MA4-S2-T7 — Operational Health & Sanitized Diagnostics (`OPERATIONAL_DIAGNOSTICS.md`)

- **Gate T7-A Verdict:** **`PASS`**

---

## 1. User-Visible Operational Health Projection

Implemented in [`src/lib/bunny-host/ma4/diagnostics-feedback.ts`](../../src/lib/bunny-host/ma4/diagnostics-feedback.ts) (`buildOperationalHealthSummary`, schema `bunny-operational-health/1`):

| Diagnostic Dimension | Projected Fields | Classification Rules |
|---|---|---|
| **Host Health** | `hostHealth`: `"healthy" \| "recovering" \| "degraded"` | `"degraded"` when `corruptRecordCount > 0` or `unreadableMonitors > 0`; `"recovering"` when `reconciliationWaiting > 0`; `"healthy"` otherwise |
| **Connected Model Status** | `ollamaReachable`, `runnableLocalModels`, `externalCloudInferenceEnabled: false` | Strips `:cloud` models; explicitly confirms external cloud inference is disabled |
| **Active Tasks & Failures** | `activeTaskCount`, `taskFailureCount` | Counts live persistent tasks and failed runs |
| **Scheduler & Monitor Health** | `activeSchedules`, `missedCount`, `duplicateDispatches: 0`, `activeMonitors`, `unreadableMonitors` | Surfaces unreadability warnings when a monitor fails `>= 3` consecutive reads |
| **Connected Services & Devices** | `localFoldersCount`, `liveOAuthProvidersEnabled: false`, `pairedDevices`, `connectedDevices` | Reports registered local roots and live paired devices |
| **Resource Usage** | `rssMB`, `heapUsedMB`, `cpuMedianPct` | Real process memory and 1-core CPU percentage |
| **Background & Recovery State** | `backgroundEnabled`, `resumeOnStartEnabled`, `automaticStartupEnabled: false`, `lastRecoveryEvent` | Tracks last restart recovery timestamp, recovered task count, and pending owner reconciliations |

---

## 2. Sanitized Support Bundle Exporter (`exportSanitizedSupportBundle`)

Implemented in [`src/lib/bunny-host/ma4/diagnostics-feedback.ts`](../../src/lib/bunny-host/ma4/diagnostics-feedback.ts) (`schema: "bunny-support-bundle/1"`) and verified in `T7-A2` ([`src/lib/bunny-host/ma4-s2t7.test.ts`](../../src/lib/bunny-host/ma4-s2t7.test.ts)):

- **Omitted Sensitive Object Keys:** `prompt`, `rawPrompt`, `content`, `fileContent`, `body`, `emailBody`, `token`, `accessToken`, `refreshToken`, `pairingCode`, `secret`, `password` -> replaced with `"[OMITTED_SENSITIVE_FIELD]"`.
- **Regex String Scrubbing:**
  - API keys / secrets (`sk-...`, `gsk_...`, `AKIA...`) -> `"[REDACTED_SECRET]"`
  - Bearer tokens (`Bearer ...`) -> `"Bearer [REDACTED_TOKEN]"`
  - JWTs (`eyJ...`) -> `"[REDACTED_JWT]"`
  - PEM private keys -> `"[REDACTED_PRIVATE_KEY]"`
  - Windows & POSIX user paths (`C:\Users\...`, `/Users/...`, `/home/...`) -> `"[REDACTED_USER_PATH]"`
  - Email addresses (`user@domain.tld`) -> `"[REDACTED_EMAIL]"`
