# Final acceptance matrix

Parent `dca8d06`. Environment: Windows 11, Node from this machine, no Android device, no `adb`. A gate is not PASS on a pure helper that production does not call.

| Gate | Verdict | Why |
|---|---|---|
| T0R-G1 Integrated baseline | **PASS** | S3 tip `dca8d06` read, including `docs/ma4-s3-t0`. Errata is this folder. Soak trees untouched. |
| T0R-G2 Eight agent suites exit naturally | **PARTIAL** | Combined run exited without `--test-force-exit` (62 pass, 5 recovery fails). After the detach fix, `agent-recovery.test.ts` exited 0 (11 pass, 21s). The other seven were not re-run after that fix. |
| T0R-G3 Deadlines still enforced | **PASS** | `T0R a short runtime deadline still stops the live task` (30ms budget, state `stopped`, reason contains `Runtime limit`). |
| T0R-G4 Windows policy wired | **PASS** | `notification.decide` is an HTTP action. `deliverNative` in `use-island.ts` calls it before any banner. |
| T0R-G5 Windows OS delivery | **NOT TESTED** / background **FAIL** | No toast activator. No installed window was observed. Closed-window delivery is reported unsupported. |
| T0R-G6 Android adapter | **PARTIAL** | `BunnyNotifications.java`, manifest permission, origin check. Not compiled with the Android SDK. |
| T0R-G7 Android delivery | **NOT TESTED** | No device. `adb` missing. |
| T0R-G8 Ten-stage onboarding wired | **PASS** | `Onboarding` in `surfaces.tsx` uses the 10 stage ids. Not click-tested in a browser. |
| T0R-G9 Host onboarding and migration | **PASS** | `saveOnboarding` / `migrateLegacyOnboarding` covered by `ma4-s3-t0r.test.ts`, and HTTP calls those functions. |
| T0R-G10 Feedback survives restart | **PASS** | New `LocalBetaFeedbackStore` on the same file saw the opted-in row. Not a killed desktop Host. |
| T0R-G11 Export and delete | **PASS** | Same test exports and deletes. Settings buttons call the same actions. Buttons not clicked. |
| T0R-G12 Diagnostics in the UI | **PARTIAL** | `HostCare` is on the Runtime diagnostics page and calls `diagnostics.health`. Not opened in a browser. |
| T0R-G13 Device status | **PARTIAL** | Revoked rows stay in the snapshot. Labels covered by unit test. No paired phone. |
| T0R-G14 Journeys | **NOT TESTED** | See E2E_USER_JOURNEYS.md. Journey E harness only. |
| T0R-G15 Permission and privacy | **PARTIAL** | Adversarial cases in `ma4-s3-t0r.test.ts` and recovery re-run. No full audit. |
| T0R-G16 Full local regression | **NOT RUN** | |
| T0R-G17 Hosted CI | **NOT RUN** | |
| T0R-G18 Docs | **PASS** | This folder. Historical S3 docs were not edited. |
