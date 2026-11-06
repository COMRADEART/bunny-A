# BUNNY A — ANDROID BETA PACKAGE INTEGRITY REPORT (E6R-R1)

**Date:** 2026-11-06  
**Package Identity:** `com.routeragent.jev`  
**Version Code:** `4`  
**Version Name:** `2.2`  
**Target SDK:** `35` (Android 15) | **Min SDK:** `26` (Android 8.0 Oreo)  
**Security Posture:** Single-permission (`android.permission.INTERNET`)  

---

## 1. Hermetic Native APK Qualification

The standalone Android companion APK was built and validated using the hermetic pipeline in `scripts/build-android.ps1`.

### Core Artifacts & Hashes:
- **Signed APK:** `releases/Bunny-A-Android-v4.apk`
- **APK SHA-256:** `587D68D8C3D802C75871B42B66318874C8879DDBDAC02CEE9777807BBAA8070A`
- **Bytecode (`classes.dex`):** `0c38809d1fc594a8a2850fa385197ef0e928fca6cc94bd2b21d22f94948e6542`
- **Signing Keystore:** `test-results/android-tools/signing/jev.p12`
- **Signing Certificate SHA-256:** `51b965f39ad64cc2b593c5d5a90fe307f368e19511338a163f90bf4310152dd7`

### Signature Verification:
- **v1 (JAR signing):** `false`
- **v2 (APK Signature Scheme v2):** `true`
- **v3 (APK Signature Scheme v3):** `true`
- Checked via pinned `apksig.jar` (v9.4.1) using `SignApk.java`.

### Architecture & Permission Verification:
1. **Single Permission:** `android.permission.INTERNET` exclusively declared. No access to camera, microphone, device storage, fine location, Bluetooth, or floating overlay windows (`SYSTEM_ALERT_WINDOW`).
2. **Zero WebView Dependency:** `classes.dex` scanned; zero references to `Landroid/webkit/`. The companion UI is 100% native Android Views.
3. **Launcher Alias Continuity:** Declares `<activity-alias android:name=".MainActivity" android:targetActivity="com.routeragent.jev.NativeCompanionActivity">` preserving launcher shortcut resolution across upgrades.
4. **Unit Test Gate:** 8 independent native test suites executed and passed (21 connection policy checks, 5 keystore erasure checks, NativeCookiePolicy, 22 poll policy checks, 37 host exchange fault-injection checks, 55 chat turn state restoration checks, manifest launcher test, and 40 companion appearance checks).

### Deterministic Repeat-Build Verification:
To eliminate unverified claims, two consecutive clean builds were executed from scratch:
- Build 1 APK SHA-256: `587D68D8C3D802C75871B42B66318874C8879DDBDAC02CEE9777807BBAA8070A`
- Build 2 APK SHA-256: `587D68D8C3D802C75871B42B66318874C8879DDBDAC02CEE9777807BBAA8070A`
- Match: **EXACT (100% Deterministic & Reproducible)**.

---

## 2. Android App Bundle (AAB) Export & Split Validation

Google Play requires the Android App Bundle (`.aab`) format for all new app submissions. We implemented and verified the complete AAB generation pipeline via `scripts/build-android-aab.ps1`.

### Toolchain Pinned Components:
- **bundletool:** v1.18.0 (`test-results/android-tools/bundletool.jar`, SHA-256: `78343764d2e79c8f55710378b04981fcb1e46daebfc3b5dc577778082e6a98fd`)
- **aapt2:** v9.4.1-15978811 (`--proto-format` link support)
- **Module Packager:** `android/tools/PackageModule.java` (normalizes protobuf resource trees with forward slashes and fixed timestamps `1609459200000L`).

### AAB Artifact Details:
- **App Bundle:** `releases/Bunny-A-Android-v4.aab`
- **AAB SHA-256:** `1a413807fa694ab81b15c6bcf45f860789447a9406d60de581cc0c703a970ffb`
- **Manifest:** Protobuf binary `manifest/AndroidManifest.xml`
- **Resource Table:** Protobuf binary `resources.pb`
- **Dex Payload:** `dex/classes.dex` (`0c38809d1fc594a8a2850fa385197ef0e928fca6cc94bd2b21d22f94948e6542`)

### Bundle Verification & Split Testing:
1. `bundletool validate --bundle=releases/Bunny-A-Android-v4.aab` -> **PASSED**.
2. Split APK extraction tested via `bundletool build-apks` using keystore `jev.p12`.
3. Generated master split APK inspected:
   - Package identity: `com.routeragent.jev`
   - Version code: `4`, version name: `2.2`
   - Permissions: `android.permission.INTERNET`
   - Signature: v2=true, v3=true signed with certificate `51b965f39ad64cc2b593c5d5a90fe307f368e19511338a163f90bf4310152dd7`.
4. Deterministic Repeat-Build Comparison:
   - Run 1 AAB SHA-256: `1a413807fa694ab81b15c6bcf45f860789447a9406d60de581cc0c703a970ffb`
   - Run 2 AAB SHA-256: `1a413807fa694ab81b15c6bcf45f860789447a9406d60de581cc0c703a970ffb`
   - Match: **EXACT (100% Deterministic & Reproducible)**.

---

## 3. Google Play Signing & Store Ingestion Requirements

| Stage | Requirement | Current Status | Operator Action Required |
| :--- | :--- | :--- | :--- |
| **AAB Format** | Protobuf-encoded App Bundle | **PASS** | None. Generated hermetically. |
| **Target SDK** | API level 35 (Android 15) | **PASS** | Meets Google Play August 2025/2026 requirement. |
| **Play App Signing** | Cloud signing key management | **READY** | Enroll app in Google Play App Signing upon initial bundle upload. |
| **Upload Key Continuity** | Certificate continuity | **PRESERVED** | The developer keystore (`jev.p12`) can serve as the designated Upload Key, or a dedicated upload certificate can be registered in Play Console. |
| **Play Console Account** | Store developer identity | **BLOCKED** | Operator must provide Play Console developer credentials for store submission. |
