# BUNNY A — MA4-S3-T0R FINAL REPORT

```text
REPOSITORY
  Base: dca8d06 (origin/ma4-s3-t0-unified-foundation)
  Final SHA: this commit (branch ma4-s3-t0r-product-wiring)
  PR: opened from that branch, not merged
  Hosted CI: NOT RUN

RUNTIME
  Forced exit removed: no. npm test still passes --test-force-exit. The eight suites and the T0R file were run without it.
  Natural shutdown: yes for those runs (recovery re-run exit 0 in 21s; first combined run exit 1 after 363s, process ended)
  Session cancellation: adapter stop() on close; task row left non-terminal for the restart walk
  Runtime deadline enforcement: yes, 30ms budget stopped the fixture task
  Remaining handles: not sampled with process.getActiveResources beyond process exit

ONBOARDING
  Actual steps: 10, GUIDED_ONBOARDING_STAGE_IDS, surfaces.tsx
  Host persistence: settings key guided_onboarding_v1
  Local model readiness: evaluateLocalModelReadiness plus catalogue check on save
  First-task completion: NOT TESTED on an installed app
  Migration: legacy step blob cannot carry background, notification opt-in, or a model name

WINDOWS NOTIFICATIONS
  Host event integration: notification.decide reads the journal
  Policy application: prefs, quiet hours, categories, redaction, ledger
  Actual OS delivery: NOT TESTED
  Window-closed behavior: unsupported (no AppUserModelID)
  Restart deduplication: ledger unit-tested; desktop process not restarted

ANDROID
  Native notification adapter: BunnyNotifications.java
  Runtime permission: POST_NOTIFICATIONS, checked before notify
  Physical delivery: NOT TESTED
  Offline behavior: no event, no fabricated completion (code path; not observed on a device)
  Device revocation: existing authenticateDevice path unchanged; revoked rows stay visible

DIAGNOSTICS
  Host health: diagnostics.health → buildOperationalHealthSummary
  Feedback persistence: beta-feedback.json
  Feedback export: feedback.export, local JSON, user button
  Clear/delete: feedback.clear and feedback.delete
  Privacy verification: secret-shaped detail absent from the file in the unit test

QUALITY
  Typecheck: npx tsc --noEmit exit 0 after the detach fix and deadline test
  Unit tests: ma4-s2t5, ma4-s2t7, journey-model, ma4-s3-t0r pass
  Agent suite: see CLEAN_SHUTDOWN_VERIFICATION.md
  Full regression: NOT RUN
  Installed Windows: NOT TESTED
  Physical Android: NOT TESTED
  Hosted CI: NOT RUN

GATES
  PASS: G1, G3, G4, G8, G9, G10, G11, G18
  PARTIAL: G2, G6, G12, G13, G15
  FAIL: G5 background OS delivery (shell has no toast activator)
  BLOCKED: none beyond missing devices
  NOT TESTED: G5 visible toast, G7, G14, G16, G17

FINAL STATUS:
  PARTIAL

CONTROLLED PREVIEW:
  CONDITIONAL GO
  (onboarding, feedback, device labels, and shutdown are in the Host; OS notifications are not)

PUBLIC BETA:
  NO-GO

RECOMMENDED NEXT MILESTONE:
  Install the Windows build and an authorized Android phone. Qualify journeys A–D on those binaries. Remove --test-force-exit from npm test only after a full natural-exit run. Do not treat browser Notification as a background Windows toast.
```
