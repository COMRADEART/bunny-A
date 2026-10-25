# Android hardware qualification

## Static and integration evidence

The closure-tree provenance test now expects the manifest permissions to be exactly:

- `android.permission.INTERNET`
- `android.permission.POST_NOTIFICATIONS`

`leastPrivilegeInternetOnly` is asserted false. `matchesDeclaredAllowlist` is asserted true. `allowBackup` false, `usesCleartextTraffic` false, `minSdk` 26, `targetSdk` 35, package `com.routeragent.jev`. `productionReleaseGate` stays `BLOCKED`. Signing status stays `UNSIGNED` or `TEST_SIGNED`.

That assertion is in the closure diff. It is what stage 0 of the natural-exit chain executed (387 pass, 0 fail). The merge commit `97d188e` still has the old assertion, and hosted CI on that commit failed `T4-ANDROID-1` because `leastPrivilegeInternetOnly` was false.

`BunnyNotifications.java` is the notification bridge covered by the existing Android static tests in the suites that passed locally. This qualification did not add a bridge, a model, or an agent.

## Hardware

`where.exe adb` returned no match. No authorized physical device was attached. No emulator was used.

| Check | Result |
| --- | --- |
| Pairing and revocation on a phone | NOT TESTED |
| Real notification display on Android | NOT TESTED |
| Permission denial and regrant | NOT TESTED |
| TalkBack | NOT TESTED |
| Offline and reconnection on Android | NOT TESTED |
| Pause, resume, and cancel from Android | NOT TESTED |

Windows Devices showed remote access unconfigured and no paired device. That is not a substitute for a phone.

Classification of Android hardware: **NOT TESTED**.
Classification of the notification-permission allowlist on the closure tree: **PASS** (local test). Classification of that same assertion on the installed `97d188e` archive and on merge-commit CI: **FAIL** until the closure commit is what CI runs.
