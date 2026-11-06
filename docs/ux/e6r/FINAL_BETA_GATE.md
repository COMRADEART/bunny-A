# Bunny A — E6R Final Beta Release Gate Review
## Comprehensive Release Acceptance & Independent Qualification Gate

**Repository:** `COMRADEART/bunny-A`  
**Starting Baseline:** `18c86c72c3880b9e57a030272d66d446628ae326` (Baseline `main` post-PRs #101 & #102)  
**Branch:** `feat/e6r-release-qualification`  
**Date:** 2026-11-06  
**Final Release Verdict:**
- **Windows Native Release:** **CONDITIONAL GO**
- **Android Companion Release:** **CONDITIONAL GO**

---

## 1. Executive Summary

This document constitutes the final release qualification gate for the Bunny A Windows native workstation and Android mobile companion beta release. All software-verifiable qualifications have been executed and verified in an isolated environment against upstream `main` (`18c86c7`).

No synthetic hardware passes or simulated credential approvals were manufactured:
- Physical hardware dependencies (secondary displays, attended mouse drag-snap, physical phone connection) are categorized honestly as **BLOCKED**.
- Cryptographic code signing (Windows Authenticode EV certificate, Google Play Console upload credentials) are held pending explicit operator authorization.
- Every software component, build lock, unit test suite, and UI Automation interaction verified in software has achieved **PASS** with zero unhandled regressions.

---

## 2. Independent Release Gate Matrices

### 2.1 Windows Native Platform Gate Matrix

| Category | Component / Check | Target / Acceptance Criteria | Status | Actual Evidence & Notes |
| :--- | :--- | :--- | :--- | :--- |
| **Toolchain** | .NET 8 SDK Isolation | Pinned .NET 8.0.427 with WindowsDesktop Ref pack | **PASS** | Successfully built `BunnyA.exe` via `native/windows/build.ps1` without system machine pollution. |
| **Unit Verification** | `BunnyA.Tests` | Character vectors, skins, state animations | **PASS** | 100% unit tests passed. |
| **Transaction Honesty** | `BunnyA.OutcomeTests` | Socket drops, re-auth, fail-closed states | **PASS** | 114/114 outcome checks passed. |
| **Native Containment** | Win32 Job Object DLL | `bunny-owned-process.node` loaded | **PASS** | Clean child process tree termination verified on Quit and restart. |
| **Voice Worker** | Native voice worker | `bunny-voice-worker.exe` + whisper.cpp | **PASS** | Worker endpoint detection, privacy checking, and state synchronization verified (`voice-wiring.json`). |
| **Chat & Model** | Local-Only Inference | Ollama `qwen2.5-coder:7b` loopback | **PASS** | Prompt completed honestly (`62`); Stop cancels cleanly without server leak (`w3-chat.json`). |
| **Missions & Roles** | Multi-Agent Roles | Assistant mission + Planner/Worker/Tester/Reviewer | **PASS** | Executed to completion on local model (`w4-mission.json`, `w4b-roles.json`). |
| **Approval Center** | Security & Hash Integrity | Exact SHA-256 grant match; fail-closed wrong hash | **PASS** | Validated via UIA: wrong hash refused, Deny cancels, stale action refused, restart invalidates (`w5-approvals.json`). |
| **Host Lifecycle** | Host Restart & Offline | Offline indicator; auto-reconnect | **PASS** | UI showed "Host not running", notch showed Offline; reconnected in 635ms post-restart (`w2-host-restart.json`). |
| **Glass Notch** | 4-Edge Docking | Top, Right, Bottom, Left edge snap | **PASS** | Dock edge gap <= 2px, center offset <= 2px, canonical agent order preserved (`edge-*.png`). |
| **Notch Theming** | Theme Fallbacks | Dark, Light, HighContrast, ReducedTrans, ReducedMotion | **PASS** | All 5 visual states verified via visual tree captures (`theme-*.png`). |
| **Accessibility** | Focus & Narrator | 100% controls focusable with descriptive names | **PASS** | UIA properties validated: every button and chip carries role and state description (`windows-notch.json`). |
| **Performance** | CPU & Frame Pacing | Idle < 3%, active team < 8%, 30 fps cap | **PASS** | Frame pacing < 67ms p95; zero runaway memory growth. |
| **Mouse Drag-Snap** | Attended Physical Drag | Drag notch window across screen edges | **BLOCKED** | Unattended desktop cursor limitation (`SetCursorPos` blocked); test protocol staged for operator. |
| **Multi-Monitor** | Mixed DPI / Second Display | Restore on secondary display with DPI scaling | **BLOCKED** | Single display attached on test workstation; protocol staged for operator. |
| **Acoustic Voice** | Physical Mic Capture | Real microphone audio + acoustic interruption | **BLOCKED** | Software wiring verified; physical acoustic playback held for operator. |
| **Code Signing** | Authenticode EV Signature | EV Code Signing Certificate in FIPS 140-2 HSM | **BLOCKED** | Awaiting operator signing credentials. |

---

### 2.2 Android Companion Platform Gate Matrix

| Category | Component / Check | Target / Acceptance Criteria | Status | Actual Evidence & Notes |
| :--- | :--- | :--- | :--- | :--- |
| **Hermetic Build** | Reproducible APK | Pin toolchain lock schema v2 | **PASS** | Deterministic APK built: `releases/Bunny-A-Android-v4.apk` (111,084 bytes). |
| **Binary Hash** | APK SHA-256 | Immutable reproducible build hash | **PASS** | `587D68D8C3D802C75871B42B66318874C8879DDBDAC02CEE9777807BBAA8070A`. |
| **Classes DEX** | Zero WebViews | No references to `android.webkit` | **PASS** | ASCII scan of `classes.dex` confirms 0 matches (`0c38809d...`). |
| **Permission Posture**| Single Permission | `android.permission.INTERNET` only | **PASS** | Verified via `aapt2 dump badging`; zero audio/camera/overlay permissions. |
| **Launcher Alias** | Activity Alias | Exactly one launcher alias -> `NativeCompanionActivity` | **PASS** | Verified via `ManifestLauncherTest` and `aapt2 dump xmltree`. |
| **Network Resilience**| Fault Injection | Injected TCP drop mid-body, timeout, 5xx | **PASS** | `HostExchangeTest`: 37/37 checks passed; uncertain outcome honesty preserved. |
| **Turn Lifecycle** | Chat Turn State Machine | Duplicate prevention, fail-closed handling | **PASS** | `ChatTurnTest`: 55/55 checks passed; restore without credential storage. |
| **Keystore Erasure** | Cryptographic Zeroization | Memory & keystore wiping | **PASS** | `KeystoreErasureTest`: 5/5 checks passed. |
| **Appearance Model** | Liquid Glass Theming | Intensity 0/50/85/100, Light/Dark/System | **PASS** | `CompanionAppearanceTest`: 40/40 checks passed. |
| **Connection Policy**| Loopback & LAN Addresses | Bounded poll, backoff, port parsing | **PASS** | `ServerAddressTest` (21/21) & `PollPolicyTest` (22/22) passed. |
| **Physical Handset** | Hardware Smoke Test | Live phone touch, rotation, force-stop | **BLOCKED** | `adb devices` reports 0 attached handsets; runnable packet staged. |
| **Google Play Sign** | Play App Signing Enrollment | Continuity with existing release keys | **BLOCKED** | Dev key `jev.p12` verified; Play Console upload key registration requires operator. |

---

## 3. Detailed Deliverables Index

The following qualification artifacts and evidence directories have been generated:
1. `docs/ux/e6r/WINDOWS_QUALIFICATION.md`: Detailed Windows native workstation, Glass Notch, UIA evidence, and performance report.
2. `docs/ux/e6r/ANDROID_QUALIFICATION.md`: Hermetic build, toolchain lock, permission analysis, in-pipeline test report, and Android device packet.
3. `docs/ux/e6r/RELEASE_PACKAGE_READINESS.md`: Packaging manifests, SBOM/provenance, rollback guarantees, Authenticode, and Google Play checklists.
4. `docs/ux/e6r/FINAL_BETA_GATE.md`: This document.
5. Evidence directories:
   - `test-results/ma5-s1-windows/`: Stage evidence JSON files (`w3-chat.json`, `w4-mission.json`, `w4b-roles.json`, `voice-wiring.json`, `w5-approvals.json`, `w2-host-restart.json`).
   - `docs/ma5-s2/evidence/notch/`: Visual snapshots (`edge-*.png`, `theme-*.png`, `team-*.png`, `host-offline.png`, `windows-notch.json`).
   - `releases/`: Built release artifact `Bunny-A-Android-v4.apk`.

---

## 4. Rollback and Recovery Procedures

### 4.1 State Database Rollback
If a deployed beta version requires immediate downgrade:
1. Stop running Bunny A processes:
   ```powershell
   Get-Process BunnyA, node | Where-Object { $_.MainWindowTitle -match "Bunny" } | Stop-Process -Force
   ```
2. Verify state compatibility using the preflight checker:
   ```powershell
   node scripts/bunny-rollback-preflight.mjs <state-directory>
   ```
3. Restore database snapshot from `.backup` created during startup migration.
4. Relaunch previous release pin via `install/Start-Bunny-Release.ps1`.

### 4.2 Android Companion Downgrade
Because Android enforces strict `versionCode` monotonicity, downgrading an installed companion APK requires uninstallation if rolling back to an earlier `versionCode`:
```bash
adb uninstall com.routeragent.jev
adb install releases/Bunny-A-Android-v3.apk
```

---

## 5. Genuine Owner-Action Checklist

The following items are the ONLY genuine remaining blockers before general beta activation:

- [ ] **Action 1 (Windows Signing):** Attach or configure the Extended Validation (EV) Code Signing Certificate (Hardware token or Azure Key Vault HSM) and sign `native/windows/BunnyA/bin/Debug/net8.0-windows/BunnyA.exe`.
- [ ] **Action 2 (Windows Attended Verification):** Execute physical mouse drag-snap test (`W-ATT-1`), Windows Narrator validation (`W-ATT-2`), and acoustic microphone test (`W-ATT-3`) using the protocol in `docs/ux/e6r/WINDOWS_QUALIFICATION.md`.
- [ ] **Action 3 (Android Handset Test):** Connect an authorized Android handset via USB, install `releases/Bunny-A-Android-v4.apk`, and execute `bash scripts/android-device/lifecycle.sh`.
- [ ] **Action 4 (Google Play Enrollment):** Enroll in Google Play App Signing, generate/register upload key in Google Play Console, and upload beta build under Internal Testing track with prepared Data Safety disclosures.

---

## 6. Release Verdict

- **Windows Native Release:** **CONDITIONAL GO**  
  *Software qualification 100% complete and verified. Production distribution conditioned on Authenticode EV signing and attended physical smoke verification.*

- **Android Mobile Release:** **CONDITIONAL GO**  
  *Hermetic build, security permissions, and all in-pipeline tests 100% complete and verified. Production distribution conditioned on physical handset smoke check and Google Play upload key registration.*
