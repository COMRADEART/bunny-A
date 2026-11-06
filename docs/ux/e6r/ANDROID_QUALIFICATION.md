# Bunny A — E6R Android Qualification Report
## Hermetic Build, In-Pipeline Security Verification, and Device Release Packet

**Repository:** `COMRADEART/bunny-A`  
**Target Commit:** `18c86c72c3880b9e57a030272d66d446628ae326` (Baseline `main` post-PRs #101 & #102)  
**Branch:** `feat/e6r-release-qualification`  
**Date:** 2026-11-06  
**Status:** **CONDITIONAL GO** (Hermetic software build and in-pipeline unit/security suites 100% verified; physical handset validation marked BLOCKED pending connected hardware).

---

## 1. Executive Summary

The Android native companion application (`com.routeragent.jev`) was fully built and qualified using the hermetic native toolchain pinned in `android/native-preview-toolchain.json`. Every in-pipeline test suite—covering network fault injection, Keystore erasure, cookie isolation, single-launcher aliasing, and the Liquid Glass appearance model—executed and passed cleanly.

The built artifact strictly adheres to the security architecture:
1. **Single Permission:** `android.permission.INTERNET` only. No camera, microphone, overlay, or background permissions are present.
2. **WebView-Free:** Zero references to `android.webkit` exist in `classes.dex`.
3. **Consequential Approvals Workstation-Only:** Consequential workstation actions (e.g. file mutations, execution) cannot be authorized from the Android companion; they require the native Windows Approval Center.
4. **Physical Handset Gate:** Because no physical handset is connected to the test host (`adb devices` reports 0 devices attached), device-dependent runtime checks are marked **BLOCKED** and provided as an executable attended test packet.

---

## 2. Hermetic Build Verification

### 2.1 Build Environment and Toolchain Locks
- **Host Java Runtime:** Java SE 21.0.12 LTS (`21.0.12+7-LTS-205`)
- **Compiler:** `javac 21.0.12` (targeting Java bytecode release 8)
- **Toolchain Specification:** `android/native-preview-toolchain.json` (`bunny-android-preview-toolchain.v2`)
- **Toolchain Integrity Hashes:**
  - `android.jar`: `36133388` bytes, SHA-256 verified
  - `aapt2/aapt2.exe`: `5104640` bytes, SHA-256 verified
  - `apksig.jar`: `506609` bytes, SHA-256 verified
  - `r8.jar`: `20597762` bytes, SHA-256 verified

### 2.2 Built Artifact Identity
- **Artifact Path:** `releases/Bunny-A-Android-v4.apk`
- **File Size:** `111,084` bytes
- **SHA-256 Hash:** `587D68D8C3D802C75871B42B66318874C8879DDBDAC02CEE9777807BBAA8070A`
- **Classes DEX SHA-256:** `0c38809d1fc594a8a2850fa385197ef0e928fca6cc94bd2b21d22f94948e6542`
- **Package Name:** `com.routeragent.jev`
- **versionCode:** `4`
- **versionName:** `2.2`
- **minSdkVersion:** `26` (Android 8.0 Oreo)
- **targetSdkVersion:** `35` (Android 15)
- **compileSdkVersion:** `35`
- **Launcher Component:** `com.routeragent.jev/.MainActivity` (activity-alias target `com.routeragent.jev.NativeCompanionActivity`)
- **Signature Schemes:** APK Signature Scheme v2 (`true`), Scheme v3 (`true`), Scheme v1 (`false` / disabled)
- **Signing Certificate SHA-256:** `51b965f39ad64cc2b593c5d5a90fe307f368e19511338a163f90bf4310152dd7`

---

## 3. In-Pipeline Test Results

The hermetic build script (`scripts/build-android.ps1`) compiles and executes all standalone verification suites against loopback fixtures:

| Test Suite | File | Checks Passed | Verdict | Description |
| :--- | :--- | :--- | :--- | :--- |
| **ServerAddressTest** | `android/tests/ServerAddressTest.java` | 21/21 | **PASS** | Validates IPv4 loopback, LAN IP parsing, port bounds, and invalid scheme rejections. |
| **KeystoreErasureTest** | `android/tests/KeystoreErasureTest.java` | 5/5 | **PASS** | Validates cryptographic key erasure from Android Keystore and memory zeroization. |
| **NativeCookiePolicyTest** | `android/tests/NativeCookiePolicyTest.java` | 1/1 | **PASS** | Verifies strict cookie header formatting and process isolation. |
| **PollPolicyTest** | `android/tests/PollPolicyTest.java` | 22/22 | **PASS** | Verifies bounded exponential backoff, jitter, and poll interval clamp policies. |
| **HostExchangeTest** | `android/tests/HostExchangeTest.java` | 37/37 | **PASS** | Injected socket faults: reset mid-body, timeout after body, server 5xx, host epoch change, uncertain outcome honesty. |
| **ChatTurnTest** | `android/tests/ChatTurnTest.java` | 55/55 | **PASS** | Message turn state machine, duplicate prevention, fail-closed handling, crash restoration without credential leak. |
| **ManifestLauncherTest** | `android/tests/ManifestLauncherTest.java` | 1/1 | **PASS** | Verifies exactly one MAIN/LAUNCHER activity-alias targeting `NativeCompanionActivity`. |
| **CompanionAppearanceTest**| `android/tests/CompanionAppearanceTest.java` | 40/40 | **PASS** | Glass intensity mapping (0, 50, 85, 100), Light/Dark/System themes, high contrast palette compliance. |
| **Total In-Pipeline Checks** | | **182/182** | **PASS** | All checks passed with 0 failures. |

---

## 4. Security & Permissions Review

### 4.1 Permission Enforcement
```xml
<!-- Extracted via aapt2 dump badging -->
uses-permission: name='android.permission.INTERNET'
```
- **Prohibited Permissions Verified Absent:**
  - `android.permission.RECORD_AUDIO`: **ABSENT** (zero acoustic capture on Android).
  - `android.permission.CAMERA`: **ABSENT**.
  - `android.permission.SYSTEM_ALERT_WINDOW`: **ABSENT** (no floating screen overlay).
  - `android.permission.ACCESS_BACKGROUND_LOCATION`: **ABSENT**.
  - `android.permission.READ_EXTERNAL_STORAGE`: **ABSENT**.
  - `android.permission.WRITE_EXTERNAL_STORAGE`: **ABSENT**.

### 4.2 Fail-Closed Authorization & Revocation
- **Consequential Actions:** The companion API enforces that file write operations (`file.apply`), terminal commands, and system missions require workstation review. Android clients can view state and prompt chat, but cannot approve consequential changes.
- **Revoked Device:** When a device ID is marked revoked on the Host, all subsequent requests fail with `401 Unauthorized` / `DEVICE_REVOKED`, causing the client to clear stored session state.
- **Epoch Change:** When the Host restarts with a new instance ID / epoch, ongoing uncertain turns transition to `OUTCOME_UNKNOWN` rather than falsely asserting completion.

---

## 5. Attended Device Test Packet (For Connected Hardware)

Because `test-results/android-tools/platform-tools/adb.exe devices` reports 0 attached handsets on the qualification host, physical validation is staged as an automated packet:

### 5.1 Test Packet Files
1. `scripts/android-device/fault-harness.mjs`: Starts disposable Host on port 43391 and proxy on port 43392 with injectable socket drop modes (`lose-answer`, `drop-before`, `drop-status`).
2. `scripts/android-device/lifecycle.sh`: Executes rotation, background/foreground cycling, process force-stop/relaunch, and verifies state preservation.
3. `scripts/android-device/ui.py`: Drives UI Automator via ADB to inspect XML views and perform touch events.

### 5.2 Device Execution Procedure
```bash
# 1. Connect authorized Android device with USB debugging enabled
adb devices
# Verify device ID appears

# 2. Install qualified APK
adb install -r releases/Bunny-A-Android-v4.apk

# 3. Execute automated lifecycle harness
export EVIDENCE_DIR="./test-results/android-device-evidence"
export COMMANDS_LOG="./test-results/android-device-evidence/commands.log"
bash scripts/android-device/lifecycle.sh
```

---

## 6. Android Release Gate Matrix

| Check | Target / Contract | Result | Verdict |
| :--- | :--- | :--- | :--- |
| **Hermetic Toolchain** | JDK 21.0.12, pinned aapt2, r8, apksig | Verified matching lock schema v2 | **PASS** |
| **Permission Posture** | `android.permission.INTERNET` only | Confirmed via aapt2 dump badging | **PASS** |
| **WebView Absence** | 0 references to `android.webkit` in DEX | Confirmed via ASCII search on `classes.dex` | **PASS** |
| **Unit & Fault Tests** | 182 in-pipeline verification checks | 182/182 checks passed | **PASS** |
| **Single Launcher** | Exported `.MainActivity` -> `NativeCompanionActivity` | Confirmed via XML tree inspection | **PASS** |
| **Glass Theme Tokens** | Intensity 0/50/85/100 & Light/Dark/System | Validated in `CompanionAppearanceTest` | **PASS** |
| **Physical Hardware Smoke** | Physical handset screen render & TalkBack | No device attached (`adb devices` = 0) | **BLOCKED** |
| **Google Play Keystore** | Production Play Console signing continuity | Local dev key only (`jev.p12`); owner must enroll upload key | **BLOCKED** |

**Release Verdict:** **CONDITIONAL GO** (Hermetic code and security verified; physical device validation and Play Console enrollment blocked on external prerequisites).
