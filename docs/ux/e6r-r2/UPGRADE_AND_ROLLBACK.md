# BUNNY A — UPGRADE, ROLLBACK & LIFECYCLE SPECIFICATION (E6R-R2)

**Repository:** `COMRADEART/bunny-A`  
**Date:** 2026-11-06  
**Auditor:** Bunny A Autonomous Qualification Harness (E6R-R2)  

---

## 1. Executive Summary & Correction of Prior Misleading Instructions

During independent review of E6R-R1 PR #104, a misleading statement regarding Android rollback was discovered in `docs/ux/e6r-r1/BETA_GATE_VERDICT.md` (§5):
> *"Signing key continuity (`51b965f39...`) ensures that downgrading to earlier test builds will not trigger signature collision errors."*

### Why That Statement Was Technically Flawed:
1. **Android OS Downgrade Prevention:** The Android Package Manager enforces `versionCode` monotonicity. If an APK with `versionCode 4` (Beta 1) is installed on a device, installing an older build with `versionCode 3` via ADB fails with `INSTALL_FAILED_VERSION_DOWNGRADE`. Downgrading without uninstalling requires the explicit `-d` flag (`adb install -r -d <old.apk>`).
2. **Google Play Prohibition:** Google Play Console strictly forbids rolling back to an APK or AAB with a lower or equal `versionCode`.
3. **Uninstall Destruction of Session & KeyStore:** If a user uninstalls the app to install an older build, the Android OS destroys the app's private sandbox and zeroes all hardware-backed `AndroidKeyStore` keys associated with the app UID (`bunny-native-companion-v1`). As a result, **all pairing state is permanently destroyed**, and the user must re-pair with the Host using a newly generated pairing code.

This document establishes the precise, verified upgrade, downgrade, and rollback contract for both Android and Windows platforms.

---

## 2. Android Lifecycle Contract

### 2.1 Same-Key Upgrades (Standard Path)
- **Version Code Transition:** Must be strictly increasing (`versionCode N+1 > N`).
- **Signature Continuity:** Both packages must be signed with the same developer signing key (certificate fingerprint `51b965f39ad64cc2b593c5d5a90fe307f368e19511338a163f90bf4310152dd7`).
- **Data Persistence:**
  - `SharedPreferences` (`native_session_v1`) is preserved.
  - Hardware `AndroidKeyStore` master key (`bunny-native-companion-v1`) is preserved.
  - Active pairing session, host identity (`hostId`), and authentication token remain intact.
  - The companion connects to the workstation immediately upon launch without user intervention.
- **Launcher Continuity:** `<activity-alias android:name=".MainActivity" android:targetActivity="com.routeragent.jev.NativeCompanionActivity">` ensures home screen icons and launcher shortcuts resolve without disruption.

### 2.2 Downgrades & Rollbacks
- **Over-the-Air / Store:** Not supported by Google Play. If a severe defect is identified, the remediation procedure is to roll **forward** by uploading a patched build with an incremented `versionCode` (`versionCode 5`).
- **Developer / ADB Sideloading:**
  - In-place downgrade: `adb install -r -d Bunny-A-Android-v3.apk` (retains data if signatures match).
  - Clean downgrade: `adb uninstall com.routeragent.jev` followed by `adb install Bunny-A-Android-v3.apk`.
  - **Critical Consequence of Uninstall:** The cryptographic KeyStore key is wiped. The companion displays the pairing setup screen and requires generating a fresh pairing code on the Windows Workstation.

---

## 3. Windows Lifecycle Contract

### 3.1 Pinned Desktop Release (`scripts/install-bunny-release.ps1`)
The production desktop release manages upgrades and rollbacks outside the Git repository:

1. **State Preservation:**
   - Canonical state is stored in `%LOCALAPPDATA%\Bunny-A\state` (Layout 2: `host.sqlite`, `credentials/credentials.json`).
   - Releases are staged in `%LOCALAPPDATA%\Bunny-A\releases\<ReleaseName>`.
   - Installing a new release updates `%LOCALAPPDATA%\Bunny-A\install.json` and the startup shortcut `Bunny-A.lnk`.

2. **Rollback Procedure:**
   - Execute:
     ```powershell
     powershell.exe -ExecutionPolicy Bypass -File scripts/install-bunny-release.ps1 -Rollback
     ```
   - **Rollback Preflight Safety Check (`scripts/bunny-rollback-preflight.mjs`):**
     Before switching release pointers, the script checks the canonical SQLite database:
     - Verifies zero running or pending missions in `missions` table (`!terminal.has(mission.state) && mission.state !== 'draft'`).
     - Verifies zero in-flight capability runs in `capability_runs` table (`['running', 'in_flight', 'started']`).
     - Verifies zero active authorization batches in `approval_batches` table (`status === 'active' && expiresAt > Date.now()`).
     - Verifies `missions_config.enabled` and `triggersEnabled` are disabled.
     - If active work is detected, rollback is **refused** to prevent database state corruption:
       `idleCheckRefused:active-work {"tasks":0,"missions":1,...}`.
   - Upon clean preflight, the prior release pointer and logon shortcut are restored from `%LOCALAPPDATA%\Bunny-A\rollback`.

### 3.2 MSIX Package Lifecycle
- **Upgrades:** Handled by Windows App Installer service when package `Version` is greater (e.g. `28.0.0.0` upgrading a prior build). App data in `%LOCALAPPDATA%\Packages\BunnyA.Workstation_...\LocalState` is retained.
- **Downgrades:** Windows AppX engine prohibits in-place downgrades to an older MSIX version. Downgrading requires uninstalling the package via Windows Settings or `Remove-AppxPackage`, followed by installing the prior package.

### 3.3 Development Candidate Lifecycle (`native/windows/install-dev-candidate.ps1`)
- **Safety Markers:** Refuses to touch any folder unless proven to be installed by the script via `install.json` schema `bunny-windows-dev-install.v1`.
- **Replacement:** Safely replaces an existing development install if the folder contents exactly match the marker.
- **Clean Removal:** `-Uninstall` completely deletes candidate binaries and shortcuts without touching owner data.

---

## 4. Verification Evidence

The lifecycle invariants were verified by automated test suites:
1. `scripts/upgrade-rollback.test.mjs` (5 checks passed):
   - Verified Android `versionCode 4` / `versionName 2.2`.
   - Verified `AndroidKeyStore` alias stability (`bunny-native-companion-v1`).
   - Verified uninstall error handling and re-pairing enforcement.
   - Verified Windows rollback preflight active-work assertions.
   - Verified MSIX `28.0.0.0` quad-version reconciliation with candidate release pin `28.0.0-beta.1`.
2. `scripts/bunny-state-migration.test.mjs` (23 checks passed):
   - Verified complete cutover, idempotent retries, and failure-injection recovery across state layouts.
