# MA4-S2-T4 — Android Release & Packaging Qualification (`ANDROID_RELEASE.md`)

- **Gate T4-B Verdict:** **`PARTIAL`** (`PASS` on reproducible APK build, manifest hardening, TLS/pairing persistence, and physical Samsung SM-S948U validation; **`BLOCKED`** on Google Play production upload keystore signing)

---

## 1. Android Package Identity & Manifest Hardening

Inspected by [`scripts/bunny-sbom-provenance.mjs`](../../scripts/bunny-sbom-provenance.mjs) against [`android/app/src/main/AndroidManifest.xml`](../../android/app/src/main/AndroidManifest.xml) and built by [`scripts/build-android.ps1`](../../scripts/build-android.ps1):

| Property | Configured Value | Security / Compatibility Requirement | Verdict |
|---|---|---|---|
| **Application ID (`package`)** | `com.routeragent.jev` | Stable application identifier across upgrades | **`PASS`** |
| **Version Code / Name** | `versionCode="3"`, `versionName="2.1"` | Monotonic positive integer `versionCode` enforced by `build-android.ps1` | **`PASS`** |
| **SDK Compatibility** | `minSdkVersion="26"` (Android 8.0), `targetSdkVersion="35"` (Android 15) | Covers modern Android devices including Android 15/16 (`SDK 35/36`) | **`PASS`** |
| **ABI Compatibility** | Pure Dalvik/ART bytecode (`classes.dex` via `D8 --min-api 26`) | Architecture-independent (`arm64-v8a`, `armeabi-v7a`, `x86_64`) | **`PASS`** |
| **Cleartext Traffic** | `android:usesCleartextTraffic="false"` | Blocks unencrypted HTTP traffic from the companion app | **`PASS`** |
| **Cloud / ADB Backup** | `android:allowBackup="false"` | Prevents pairing credentials or WebView state from leaking to cloud/ADB backups | **`PASS`** |
| **Declared Permissions** | `android.permission.INTERNET` only (`1` permission total) | Least-privilege: zero camera, microphone, contacts, SMS, or storage permissions | **`PASS`** |

---

## 2. Build Pipeline & Unit Verification

[`scripts/build-android.ps1`](../../scripts/build-android.ps1) executes a deterministic, Gradle-free build using pinned SDK build tools (`aapt2.exe`, `javac --release 8`, `r8.jar D8`, `ServerAddressTest`, `PackageApk`, `SignApk` with `apksig.jar`):

- **Address Validation Unit Suite (`com.routeragent.jev.ServerAddressTest`):** Runs automatically during every APK build (`scripts/build-android.ps1` lines 48–49), verifying that only valid HTTPS / loopback / private-LAN Host endpoints are accepted and rejecting cleartext or malformed URLs.
- **Artifact Provenance (`releases/Bunny-A-Android-v3.apk`):**
  - Size: `24,523` bytes
  - SHA-256: `6b21a5f42f77ddfd05ff78c934e4cf6a26c5261654d38da79a4822e129d53c1d`
  - Verified on physical Samsung `SM-S948U` (Android 16 / SDK 36) in [`docs/ma4-s2-t3r/evidence/android/round2.json`](../ma4-s2-t3r/evidence/android/round2.json) (`9/9 PASS`: pairing, remote status visibility, remote approval, remote denial, revocation enforcement `401`, wrong-token `401`, replay rejection, unapproved route `403`, and background/foreground resume without credential loss).

---

## 3. Signing Status & Rollback Strategy

- **Current Signing Status:** **`TEST_SIGNED`** (`CN=JEV Local Build`, RSA-3072 PKCS12 keystore generated locally at `test-results/android-tools/signing/jev.p12`).
- **Production Release Signing (`BLOCKED`):** No Google Play App Signing upload key (`BUNNY_ANDROID_RELEASE_KEYSTORE`) is provisioned in this environment. Per Master Prompt §T4-C, no production signature is fabricated.
- **Upgrade & Rollback Strategy:**
  - In-place `adb install -r releases/Bunny-A-Android-v3.apk` preserves `SharedPreferences` / pairing state when signed with the same keystore.
  - Because Android blocks downgrading `versionCode` without `-d` (or uninstalling on production builds), rolling back an Android companion release uses either a forward-incremented `versionCode` rollback build or clean reinstall + 30-second QR/code re-pairing against the Windows Host (since all persistent goals, schedules, monitors, tasks, and receipts live on the Windows Host, zero task or audit state is lost when re-pairing the phone).
