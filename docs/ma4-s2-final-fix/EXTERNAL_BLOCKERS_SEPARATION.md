# Credential & External Blocker Separation

**Product:** Bunny A by LOKAM  
**Milestone:** MA4-S2 Remediation  
**Status:** COMPLETE (Zero Unresolved Code Blockers; 5 External/Environmental Gates Categorized with Operator Runbooks)

---

## 1. Release Blocker Classification Matrix

All remaining gates are strictly external to the source code:

| Blocker ID | Classification | Blocker Name | Missing Resource / Dependency | Failing Check / Command | Workspace Resolvable? |
|---|---|---|---|---|---|
| **BLK-S2-01** | Credential Requirement | Windows Authenticode Production Signing | EV/OV Authenticode signing certificate + hardware token or HSM | `signtool.exe verify /pa dist-native\Bunny-A-Setup.exe` (fails with self-signed test root) | **NO** (Production private key must never exist in sandbox) |
| **BLK-S2-02** | Credential Requirement | Android Google Play Release Signing | Organization Google Play App Signing release keystore | `apksigner.bat verify --verbose releases\Bunny-A-Android-v3.apk` (identifies `CN=JEV Local Build`) | **NO** (Production upload key must never exist in sandbox) |
| **BLK-S2-03** | Hardware Dependency | Physical Android TalkBack Live Exploration | Physical Samsung SM-S948U attached via USB with ADB authorized | `%LOCALAPPDATA%\Android\platform-tools\adb.exe devices -l` (returns empty device list) | **NO** (Requires physical USB connection to host) |
| **BLK-S2-04** | Wall-Clock Soak Dependency | 24-Hour Reliability Soak Completion | Elapsed time for Soak B (`PID 19296`, `port 43192`) | `node scripts/ma4-s2t3r/soak-report.mjs` (in-progress until `2026-10-25T15:06:15Z`) | **NO** (Requires wall-clock time; premature termination prohibited) |
| **BLK-S2-05** | Environmental Dependency | Live X53 Interactive Desktop Automation | Interactive console desktop session (WinSta0\Default) | `node --experimental-strip-types --test src/lib/bunny-missions/cross-app-live.test.ts` (reports NOT TESTED on private desktop) | **NO** (Headless sandbox runs in private desktop `exebox-...`) |

---

## 2. Operator Runbooks for Non-Code Blockers

### BLK-S2-01: Windows Authenticode Production Signing
1. **Target Artifact:** `dist-native\Bunny-A-Setup.exe`
2. **Operator Action:**
   ```powershell
   signtool.exe sign /v /tr http://timestamp.digicert.com /td sha256 /fd sha256 /n "LOKAM / Comrade Art" dist-native\Bunny-A-Setup.exe
   signtool.exe verify /pa /v dist-native\Bunny-A-Setup.exe
   ```

### BLK-S2-02: Android Release Upload Signing
1. **Target Artifact:** `releases\Bunny-A-Android-v3.apk`
2. **Operator Action:**
   ```powershell
   apksigner.bat sign --ks <path-to-production-keystore.jks> --ks-key-alias <alias> --out releases\Bunny-A-Android-v3-signed.apk releases\Bunny-A-Android-v3.apk
   apksigner.bat verify --verbose releases\Bunny-A-Android-v3-signed.apk
   ```

### BLK-S2-03: Physical Android TalkBack Touch Exploration
1. **Target Hardware:** Samsung SM-S948U (Android 17)
2. **Operator Action:**
   - Connect phone via USB; verify `adb devices` shows `SM-S948U device`.
   - Install release APK: `adb install -r releases\Bunny-A-Android-v3.apk`.
   - Enable TalkBack under `Settings -> Accessibility -> TalkBack`.
   - Execute gesture traversal across connection screen, pairing prompt, and supervision controls.

### BLK-S2-04: 24-Hour Soak Final Adjudication
1. **Target Process:** Soak B (`PID 6840` driver, `PID 19296` host) on `port 43192`.
2. **Operator Action:**
   - At `2026-10-25T15:06:15Z` (or later), execute:
     ```powershell
     node scripts/ma4-s2t3r/soak-report.mjs --dir C:\Users\allam\AppData\Local\Bunny-S2T3R1-Soak
     ```
   - Verify 0 invariant errors and record final verdict.

### BLK-S2-05: Live X53 Interactive Desktop Execution
1. **Target Test:** `src/lib/bunny-missions/cross-app-live.test.ts`
2. **Operator Action:**
   - Open a standard PowerShell console on the interactive desktop (logged in as `allam`).
   - Run:
     ```powershell
     node --experimental-strip-types --test src/lib/bunny-missions/cross-app-live.test.ts
     ```
   - Confirm all 10 cross-application steps pass against the visible desktop Calculator.
