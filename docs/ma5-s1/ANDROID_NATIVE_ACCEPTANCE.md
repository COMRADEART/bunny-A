# MA5-S1 — Android native acceptance

No Android device or emulator was available. `adb devices` listed none; the adb server was started only for the
probe and stopped afterwards. Everything below is verified **at build and source level**. Runtime acceptance on a
device is **BLOCKED** and not claimed.

## A1 — Native launcher migration

| Check | Result | How |
|---|---|---|
| Package identity unchanged | `com.routeragent.jev` | `aapt2 dump badging` in `scripts/build-android.ps1` |
| Version | `versionCode 4`, `versionName 2.2` (upgrade over v3/2.1) | manifest, badging |
| Exactly one launcher; it opens the native activity | `.MainActivity` is an `activity-alias` (exported, MAIN/LAUNCHER) whose `targetActivity` is `com.routeragent.jev.NativeCompanionActivity` | `android/tests/ManifestLauncherTest.java` (DOM parse) and the APK xmltree check in the build script |
| Pinned icons and shortcuts to `.MainActivity` keep working | Alias keeps the old component name | same |
| No WebView | `MainActivity.java` (WebView) and `BunnyNotifications.java` deleted; build refuses a `classes.dex` containing `Landroid/webkit/` | build script |
| Permissions | `INTERNET` only (`POST_NOTIFICATIONS` removed with the WebView notification bridge) | ManifestLauncherTest; `scripts/bunny-sbom-provenance.mjs` allowlist |
| Legacy address | The pairing screen prefills the previous `MainActivity` `server_url` preference | source |

Upgrade over an installed v3 on a real device: NOT TESTED.

## A2 — Workflows (source level)

- Chat: sends `submit` (mode `fast`). If the Host leaves the task waiting, the phone asks for `approve`, which the
  Host accepts only under its unchanged device rule (`deviceMayLaunch`: Ollama, not a cloud tag, not remote).
  Everything else stays waiting for Windows. The reply is tracked from the polled snapshot.
- Tasks: Missions and persistent tasks with state and Host progress (`done/total`); Stop is behind a confirmation
  dialog. Pending approvals appear only as a count ("Open Bunny A on Windows to review and decide"). The phone
  cannot approve consequential actions or plans.
- System: Host identity and epoch, polling cadence, an explicit note that there are no push notifications, and
  revoke.

## A3 — Pairing and session

Unchanged security components: `NativeSessionStore` (Keystore AES-GCM), `NativeCookiePolicy`, `KeystoreErasure`,
HTTPS-only `ServerAddress`. The pairing screen uses `FLAG_SECURE`. Every snapshot pins the Host identity; a
changed identity or a TLS failure shows a terminal "Host identity changed" page instead of retrying. Commands carry
`expect{hostId,epoch}`.

## A4 — Lifecycle and polling

See APP_LIFECYCLE_RESULTS.md. Polling is not described as streaming anywhere in the app or docs.

## A5 — Java toolchain policy

`android/native-preview-toolchain.json` schema v2: Java feature 21, minimum patch 11. CI stays pinned to `21.0.11`.
`javac` must report the same version as `java`.

| Build | Java | `classes.dex` SHA-256 |
|---|---|---|
| Local | 21.0.12 | `7ab17923a2028727736d49816a25edf6bec74cdf126d587447090e2c4b83704b` |
| Hosted CI run 40644157461 (commit `394f4d1`) | 21.0.11 (Temurin) | `7ab17923a2028727736d49816a25edf6bec74cdf126d587447090e2c4b83704b` |

The dex is identical across both builds. SDK-component and signing verification (`apksigner verify`) are
unchanged; nothing was weakened.

## Verdict

Android native: **PARTIAL** for build/source acceptance, with physical device acceptance **BLOCKED**. The A1
migration is fully verified in the built APK. A2–A4 runtime behaviour has not been observed on hardware.
