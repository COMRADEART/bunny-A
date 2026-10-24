# Android Release Artifact Verification

**Product:** Bunny A by LOKAM  
**Milestone:** MA4-S2 Remediation  
**Status:** PASS (Deterministic APK Build, Zero Leaks, Least-Privilege Manifest Verified)

---

## 1. Artifact Identity & Provenance

Built by [`scripts/build-android.ps1`](file:///C:/Users/allam/Documents/new/bun-router-s2-remediation/scripts/build-android.ps1) and audited via `scripts/bunny-sbom-provenance.mjs`:

- **Artifact:** `releases/Bunny-A-Android-v3.apk`
- **Application Package ID:** `com.routeragent.jev`
- **Version Code:** `3`
- **Version Name:** `2.1`
- **Size:** `24,523` bytes
- **SHA-256:** `6b21a5f42f77ddfd05ff78c934e4cf6a26c5261654d38da79a4822e129d53c1d`
- **Bytecode:** Pure Dalvik/ART `classes.dex` (`D8 --min-api 26`) targeting `arm64-v8a`, `armeabi-v7a`, `x86_64`.

---

## 2. Manifest Hardening & Security Audit

Verified against `android/app/src/main/AndroidManifest.xml`:

| Security Property | Configured Value | Intent / Defense | Status |
|---|---|---|---|
| **Debuggable Flag** | `android:debuggable="false"` | Prevents runtime memory inspection or attaching debuggers on production builds. | PASS |
| **Cleartext Traffic Policy** | `android:usesCleartextTraffic="false"` | Enforces TLS (HTTPS) on all network connections; plain HTTP connections are blocked by the OS. | PASS |
| **Backup Protection** | `android:allowBackup="false"` | Disallows extracting pairing keys, tokens, or WebView cache via `adb backup` or Google Drive backup. | PASS |
| **Declared Permissions** | `android.permission.INTERNET` (1 total) | Zero access to camera, microphone, contacts, location, SMS, or external storage. | PASS |
| **API Compatibility** | `minSdkVersion="26"`, `targetSdkVersion="35"` | Compatible with Android 8.0 through Android 15/16. | PASS |

---

## 3. Privacy, Private URLs & Token Leak Checks

Inspection of `MainActivity.java` and compiled bytecode confirms:
- **No Embedded URLs:** The APK contains zero hardcoded hostnames, dev tunnels, quick-tunnel URLs, or localhost ports. The user inputs their PC's HTTPS address dynamically upon pairing.
- **No Embedded Tokens:** Zero pairing secrets, API keys, or pre-authenticated credentials exist in the binary.
- **Address Validation:** `ServerAddress.normalize()` validates that only valid HTTPS origins (or local loopback during development) are accepted.

---

## 4. Signing Status & External Blocker

- **Build Signature:** Test-signed with local RSA-3072 keystore (`CN=JEV Local Build`, `test-results/android-tools/signing/jev.p12`).
- **Production Upload Signing (`BLK-S2-02`):** Requires the operator's Google Play App Signing release keystore. Documented in `EXTERNAL_BLOCKERS_SEPARATION.md`.
