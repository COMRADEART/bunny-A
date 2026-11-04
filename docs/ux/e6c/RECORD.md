# E6C — Phase record: native Android build through the hermetic pipeline

Recorded 2026-11-04 on `feat/e6c-android-beta-preflight` from `main` `9bdcdc5`. The permission
restrictions are untouched: the manifest requests only the INTERNET permission — no overlay,
microphone, camera or background permissions were added; no authorization for those exists.

## What was run (commands verbatim)

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/prepare-android-native-tools.ps1
# exit 0 — "Verified Android preview build tools are staged. Download files remain in the
# isolated test-results directory."

powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/build-android.ps1
# exit 0 — build log committed as docs/ux/e6c/evidence/build-android.log
```

## Build outcome (facts from the log, verbatim lines)

| Fact | Value |
|---|---|
| APK | `releases/Bunny-A-Android-v4.apk` (ignored by Git; not distributed here) |
| SHA-256 | `8522E2EF088C88F25DB4E150F446A4F8ABFF4182964D92F9C90046B188682832` |
| Package | `com.routeragent.jev`, versionCode 4, versionName 2.2 |
| Launcher | `com.routeragent.jev/.MainActivity (alias) -> com.routeragent.jev/NativeCompanionActivity` |
| Permissions | `uses-permission: name='android.permission.INTERNET'` — the only one |
| Signatures | v1=false, v2=true, v3=true (API 26+ needs no v1); private key in `test-results/android-tools/signing/`, never packaged or committed |
| classes.dex | SHA-256 `0c38809d…6542`; the build refuses a dex referencing `android.webkit` (guard ran) |
| In-pipeline checks | connection policy 21 PASS, Keystore erasure 5 PASS, poll policy 22 PASS, cookie policy, launcher and manifest checks, interrupted-request honesty cases — **92 PASS lines, 0 FAIL** |

## Emulation vs native APK — what this phase does and does not prove

Everything above is the real, signed native APK built by the repository's own hermetic pipeline.
What it does NOT prove is Android runtime behavior: the pipeline's own README states signature
checks and desktop mobile layout tests alone do not prove Android runtime behavior.

## Owner-attended physical checks (next hardware step; none simulated)

1. APK install and upgrade path on a real phone (v2.2 over the existing install, then a fresh install).
2. Secure pairing and reconnection (pairing code from the workstation; reconnect after reboot).
3. Light/Dark/System themes and Glass Intensity persistence on the device.
4. TalkBack and accessibility walk of the companion surfaces.
5. Safe areas, orientation changes, large text.
6. Workstation-only approval enforcement from the device: consequential approvals (external side
   effects, destructive, sensitive reads) must refuse with `APPROVAL_ON_HOST` — the in-repo authority
   matrix (`tests/native-companion.test.ts`, 4/4) covers the adapter rules; physical enforcement needs
   the device.
7. Session expiration and revoked-device behavior (revoke from the workstation; the device must
   fail closed).
8. Do not add overlay/microphone/camera/background permissions without separate owner authorization.

## Rollback

This branch only adds documentation and uses the ignored build tools dir; revert the docs commit to
return to `9bdcdc5`. The staged toolchain (`test-results/android-tools/`) and the signed APK under
`releases/` are disposable artifacts.

🤖 Generated with [Claude Code](https://claude.com/claude-code)