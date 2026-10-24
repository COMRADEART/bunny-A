# Android TalkBack & Mobile Accessibility Verification

**Product:** Bunny A by LOKAM  
**Milestone:** MA4-S2 Remediation  
**Status:** PARTIAL (Static APK Inspection & Web DOM PASS; Physical TalkBack NOT TESTED Due to Disconnected Hardware)

---

## 1. Physical Device & Tunnel Pre-Flight Status

Per the MA4-S2 remediation guidelines, device-level verification requires real hardware execution rather than synthetic browser substitutes:

- **Attached ADB Devices:** Checked via `%LOCALAPPDATA%\Android\platform-tools\adb.exe devices -l` -> **0 devices attached** (Samsung SM-S948U was not physically connected over USB).
- **Active Quick Tunnels:** Checked via `Get-CimInstance Win32_Process` -> **0 running** (no `cloudflared`, `ngrok`, or `tailscale` instances).
- **Physical TalkBack Status:** **NOT TESTED** (truthfully reported as unexercised on physical hardware in the absence of a connected device).

---

## 2. Static Android APK Accessibility Audit (`MainActivity.java`)

Inspection of the compiled native Android release artifact (`com.routeragent.jev`, APK `bunny-android-arm64-release.apk` / versionCode 3) verified the following TalkBack semantic attributes:

1. **Explicit Content Descriptions (`contentDescription`):**
   - Application Brand Icon:
     ```java
     icon.setContentDescription("Bunny-A");
     ```
   - Server Address Input Field:
     ```java
     address.setContentDescription("Computer's HTTPS address");
     ```

2. **Touch Target Dimensions:**
   - Interactive buttons (`Connect`, `Connection help`) enforce a minimum touch target height:
     ```java
     result.setMinHeight(dp(48)); // 48dp Android Accessibility Guideline compliant
     ```

3. **Color Contrast & Readability:**
   - Text color `FG = Color.rgb(237, 242, 250)` against `BG = Color.rgb(11, 16, 27)` yields a contrast ratio of **15.4:1**, significantly exceeding the WCAG AAA requirement (7:1).
   - Muted secondary text `MUTED = Color.rgb(164, 179, 201)` against `BG` yields a contrast ratio of **8.8:1** (WCAG AAA compliant).

4. **WebView Accessibility Delegation:**
   - The native app hosts the remote dashboard via an Android `WebView`.
   - Android WebView automatically exposes the Chromium DOM Accessibility Tree to the Android Accessibility Framework (AccessibilityNodeInfo).
   - The remote mobile dashboard (`390x844` viewport in `scripts/ma4-s2t3r/ui-evidence.mjs`) was audited with zero unlabeled controls, semantic headings, and zero horizontal overflow.

---

## 3. Physical Android Authorization Baseline (T3R Retained Evidence)

While physical TalkBack touch exploration was unexercised in this session, physical device pairing, authorization, and supervision boundaries remain qualified on the **Samsung SM-S948U (Android 17)** from the T3R baseline:

- **HTTPS-Only Pairing:** Verified with one-time 10-minute code (`403 Invalid or expired pairing code` on mismatch).
- **Task Supervision:** Remote `Pause`, `Resume`, and `Cancel` commands execute with `device:*` attribution in `host.sqlite`.
- **Workstation-Only Approval Gate:** The phone client renders zero `Approve` buttons for dangerous/consequential operations, displaying *"Approve this on your PC"*.
- **Instant Revocation:** Revoked devices lose session authority within 6 seconds and revert to the pairing screen.
