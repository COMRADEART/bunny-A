# BUNNY A — MA4-S2-T7 ENGINEERING REPORT

## Milestone
`MA4-S2-T7 — Reliability, Observability, Privacy & Beta Feedback`

## Repository & Branch
- **Repository:** `https://github.com/COMRADEART/bunny-A`
- **Base Branch:** `ma4-s2-t6-provider-integrations` (`823487df490daf14f4f96bb659908e1e1b5548d6`, Draft PR #32)
- **Working Branch:** `ma4-s2-t7-operations-reliability`

## Executive Summary
- **Overall Milestone Verdict:** **`PARTIAL`** (`PASS` on `T7-A` Operational Health & Sanitized Support Bundle, `T7-B` Privacy & Telemetry Governance, `T7-C` Crash/Hang/Sleep-Wake/Corruption Recovery, and `T7-E` Safe Local Beta Feedback; **`IN PROGRESS`** on `T7-D` full 24-hour wall-clock completion of candidate `Soak B`, which is currently passing all active criteria at `4.28 h` with **`28.2 MB/day`** memory growth slope `<= 50 MB/day`).
- **Key Engineering Deliveries:**
  1. **Operational Health & Support Bundle Redaction (`T7-A`):** Implemented `buildOperationalHealthSummary` and `exportSanitizedSupportBundle` in [`src/lib/bunny-host/ma4/diagnostics-feedback.ts`](../../src/lib/bunny-host/ma4/diagnostics-feedback.ts), omitting raw prompts, file contents, and tokens, and scrubbing API keys, JWTs, private keys, user paths, and emails.
  2. **Telemetry Governance (`T7-B`):** Enforced `DEFAULT_TELEMETRY_POLICY` (`telemetryOptIn: false`, `remoteUploadEnabled: false`) with 7 permanently prohibited data categories.
  3. **Extended Soak & Heap Verification (`T7-D`):** Captured [`docs/ma4-s2-t7/evidence/soak-b-latest.json`](evidence/soak-b-latest.json) (`4.28 h`, `28.2 MB/day` `PASS`, `84.4 -> 84.2 MB` private working set, `258 -> 258` handles, `0` duplicates, `0` errors), [`docs/ma4-s2-t7/evidence/heap-repro-latest.json`](evidence/heap-repro-latest.json) (`5.84 h`, `283` V8 snapshots), and [`docs/ma4-s2-t7/evidence/soak-a-latest.json`](evidence/soak-a-latest.json) (`17.85 h`).
  4. **Local-First Beta Feedback Channel (`T7-E`):** Implemented `LocalBetaFeedbackStore` with opt-in enforcement, redacted preview, and `clearHistory()`.

## Verification Results
- `node --experimental-strip-types --test src/lib/bunny-host/ma4-s2t7.test.ts`: **`3/3 PASS`** (`92 ms`).

## Artifact Index (`docs/ma4-s2-t7/`)
- [`OPERATIONAL_DIAGNOSTICS.md`](OPERATIONAL_DIAGNOSTICS.md)
- [`PRIVACY_AND_TELEMETRY.md`](PRIVACY_AND_TELEMETRY.md)
- [`CRASH_RECOVERY.md`](CRASH_RECOVERY.md)
- [`EXTENDED_SOAK.md`](EXTENDED_SOAK.md)
- [`BETA_FEEDBACK.md`](BETA_FEEDBACK.md)
- [`ENGINEERING_REPORT.md`](ENGINEERING_REPORT.md)
- [`evidence/soak-a-latest.json`](evidence/soak-a-latest.json)
- [`evidence/heap-repro-latest.json`](evidence/heap-repro-latest.json)
- [`evidence/soak-b-latest.json`](evidence/soak-b-latest.json)
