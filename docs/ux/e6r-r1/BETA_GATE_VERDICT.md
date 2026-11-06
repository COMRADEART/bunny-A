# BUNNY A — E6R-R1 BETA GATE & ACCEPTANCE VERDICT

**Repository:** `COMRADEART/bunny-A`  
**Verified Baseline HEAD:** `a9e45d8ce9da25f58f52275bf7dddc3eaa7109da` (PR #103 merged, CI run `42164947223` green)  
**Date:** 2026-11-06  
**Auditor:** Bunny A Autonomous Qualification Harness (E6R-R1)

---

## 1. Release Acceptance Summary

The **E6R-R1: Beta Package Integrity & Acceptance** cycle has verified software reproducibility, corrected release-pin inconsistencies, implemented the native MSIX packaging pipeline, created and verified the hermetic Android App Bundle (AAB) export pipeline, audited network flows and privacy compliance, and generated complete physical attended test packets.

### Platform Release Verdicts:
- **Windows Native Workstation:** **CONDITIONAL GO**
- **Android Native Companion:** **CONDITIONAL GO**

Neither platform may be classified as unconditional **GO** until operator-held signing certificates are applied and physical handset/acoustic hardware attended tests are executed.

---

## 2. Windows Native Qualification Gate Matrix

| Gate ID | Capability / Acceptance Criterion | Evidence / Test Suite | Result | Blocking Dependency |
| :--- | :--- | :--- | :--- | :--- |
| **W-BLD-1** | Native WPF Workstation Build | `.NET 8.0.427`, `BunnyA.exe` | **PASS** | None |
| **W-BLD-2** | Native Unit Test Suite | `dotnet test BunnyA.Tests.csproj` | **PASS** | None |
| **W-PKG-1** | Pinned Hermetic Desktop Distribution | `scripts/package-bunny-desktop.ps1` (`1467` files verified) | **PASS** | None |
| **W-PKG-2** | Archive Integrity & SBOM | SHA-256 `1b0944f5bb8ce0ae012f0e94be6d13e2a32286dafae9d87f34c5ba03a824411d` | **PASS** | None |
| **W-MSX-1** | Native MSIX Manifest & Packaging | `native/windows/BunnyA/AppxManifest.xml` + `makeappx.exe` | **PASS** | None |
| **W-MSX-2** | Desktop Bridge Capabilities & Protocol | `runFullTrust` + `bunny-a://` protocol declared | **PASS** | None |
| **W-UI-1** | Dynamic Notch 4-Edge Placement | `verify-notch-windows.mjs` (Top, Right, Bottom, Left docking within 2px) | **PASS** | None |
| **W-UI-2** | Notch Placement Restart Persistence | `verify-notch-windows.mjs` (`n2-placement-survives-restart`) | **PASS** | None |
| **W-ART-1** | Canonical Indian Avatars | Gada, Spear, Chakra, Sword 512px assets & animation poses | **PASS** | None |
| **W-SEC-1** | Native Approval Center Cryptographic Flow | `verify-ma5-s1-windows.mjs` (`w5-approvals`: SHA256 match, deny, stale refusal) | **PASS** | None |
| **W-LIF-1** | Host Lifecycle & Restart Resilience | `verify-ma5-s1-windows.mjs` (`w2-host-restart`: reconnect, zero duplicate commands) | **PASS** | None |
| **W-LOC-1** | Local-Only Inference & Stop Mechanism | `verify-ma5-s1-windows.mjs` (`w3-chat`: Ollama `qwen2.5:1.5b` + prompt cancel) | **PASS** | None |
| **W-ATT-1** | Multi-Monitor Mixed-DPI Scaling | `W-ATT-1` / `W-ATT-3` physical display test | **BLOCKED** | Multi-monitor hardware attendance |
| **W-ATT-2** | Windows Narrator Accessibility | `W-ATT-2` physical accessibility test | **BLOCKED** | Operator physical attendance |
| **W-ATT-3** | Full-Duplex Acoustic Voice Interruption | `W-ATT-4` acoustic microphone test | **BLOCKED** | Physical microphone attendance |
| **W-SGN-1** | Authenticode Production Code Signing | RFC 3161 timestamped Authenticode signature | **BLOCKED** | Operator code signing certificate |

---

## 3. Android Companion Qualification Gate Matrix

| Gate ID | Capability / Acceptance Criterion | Evidence / Test Suite | Result | Blocking Dependency |
| :--- | :--- | :--- | :--- | :--- |
| **A-BLD-1** | Hermetic Native APK Build | `scripts/build-android.ps1` (`Bunny-A-Android-v4.apk`) | **PASS** | None |
| **A-BLD-2** | Deterministic APK Output | Repeat-build verification: SHA-256 `587D68D8...` byte-identical | **PASS** | None |
| **A-SGN-1** | Signature Scheme Continuity | APK v2/v3 signatures; cert SHA-256 `51b965f39...` preserved | **PASS** | None |
| **A-PERM-1** | Single Permission Posture | `android.permission.INTERNET` exclusively | **PASS** | None |
| **A-WEB-1** | Zero WebView Dependency | `classes.dex` verified free of `Landroid/webkit/` | **PASS** | None |
| **A-AAB-1** | Android App Bundle (AAB) Pipeline | `scripts/build-android-aab.ps1` (`Bunny-A-Android-v4.aab`) | **PASS** | None |
| **A-AAB-2** | Deterministic AAB Output | Repeat-build verification: SHA-256 `1A413807...` byte-identical | **PASS** | None |
| **A-AAB-3** | Bundletool Split APK Validation | `bundletool validate` + `bundletool build-apks` (master split verified) | **PASS** | None |
| **A-TST-1** | Native Core Journeys & Fault Injections | 8 test suites passed (185+ assertions) | **PASS** | None |
| **A-ENC-1** | Hardware Keystore Zeroing on Reset | `KeystoreErasureTest` passed | **PASS** | None |
| **A-ATT-1** | Physical Device Install & Upgrade | `A-ATT-1` physical install test | **BLOCKED** | Physical handset |
| **A-ATT-2** | Dynamic QR Pairing & Network Faults | `A-ATT-2` physical Wi-Fi interruption test | **BLOCKED** | Physical handset |
| **A-ATT-3** | Consequential Approval Refusal | `A-ATT-3` physical workstation delegation check | **BLOCKED** | Physical handset |
| **A-ATT-4** | TalkBack & Display Cutout Insets | `A-ATT-5` physical screenreader & notch test | **BLOCKED** | Physical handset |
| **A-STR-1** | Google Play Console Store Submission | Internal Testing Track upload | **BLOCKED** | Operator Play Console account |

---

## 4. Key Artifact Hashes & Commit Links

| Artifact Description | File Path | Algorithm | Hash |
| :--- | :--- | :--- | :--- |
| **Source Commit Baseline** | Git `HEAD` | SHA-1 | `a9e45d8ce9da25f58f52275bf7dddc3eaa7109da` |
| **Windows Desktop Release Zip** | `releases/Bunny-A-Windows-v28-BETA-1-TEST.zip` | SHA-256 | `1b0944f5bb8ce0ae012f0e94be6d13e2a32286dafae9d87f34c5ba03a824411d` |
| **Windows Desktop Candidate Pin** | `install/release-pin.candidate.json` | SHA-256 | `2aa04d1efce0e633d3170a4401bb264a4d6f4c51e06fa99ce18cbfece4f82662` |
| **Windows Native MSIX Package** | `releases/BunnyA.Workstation-0.5.1.0.msix` | SHA-256 | `3624c5d4a8eca63ccc1eb79a5de331b3bd610d4b57e5476c8d13caf0e50edc97` |
| **Android Signed Native APK** | `releases/Bunny-A-Android-v4.apk` | SHA-256 | `587d68d8c3d802c75871b42b66318874c8879ddbdac02cee9777807bbaa8070a` |
| **Android Signed APK Bytecode** | `classes.dex` | SHA-256 | `0c38809d1fc594a8a2850fa385197ef0e928fca6cc94bd2b21d22f94948e6542` |
| **Android App Bundle (AAB)** | `releases/Bunny-A-Android-v4.aab` | SHA-256 | `1a413807fa694ab81b15c6bcf45f860789447a9406d60de581cc0c703a970ffb` |
| **Android Developer Signing Cert** | `test-results/android-tools/signing/jev.p12` | SHA-256 | `51b965f39ad64cc2b593c5d5a90fe307f368e19511338a163f90bf4310152dd7` |

---

## 5. Rollback Procedures & Security Considerations

### Rollback Contract:
1. **Windows Desktop Rollback:**
   - Active production pin remains pinned to `8001d51d871f12c15b8de03005a40e9d4c3fd8c2` (`Bunny-A-Windows-v26-MA2-R1`).
   - If Beta 1 deployment encounters workstation failure, running `scripts/package-bunny-desktop.ps1` without arguments instantly packages the trusted v26-MA2-R1 release.
   - Per-user installs can be removed cleanly using `native/windows/install-dev-candidate.ps1 -Uninstall`.
2. **Android Companion Rollback:**
   - Previous APK versions can be re-installed over ADB without loss of shortcut mappings due to `<activity-alias android:name=".MainActivity">`.
   - Signing key continuity (`51b965f39...`) ensures that downgrading to earlier test builds will not trigger signature collision errors.

---

## 6. Remaining Operator Actions

Before initiating public beta release distribution:
1. **Authenticode Signing (Windows):** Operator must sign `BunnyA.Workstation-0.5.1.0.msix` and `Bunny-A-Windows-v28-BETA-1.zip` using an EV Code Signing Certificate or Microsoft Partner Center certificate.
2. **Google Play Console Enrollment (Android):** Operator must upload `releases/Bunny-A-Android-v4.aab` to Google Play Console Internal Testing track and accept Play App Signing terms.
3. **Physical Attended Verification:** Execute the 5 Windows and 5 Android attended test cases in `PHYSICAL_ACCEPTANCE_RECORD.md` with physical hardware connected.
4. **Candidate Pin Promotion:** Authorize promotion of `install/release-pin.candidate.json` to `install/release-pin.json` via PR merge.
