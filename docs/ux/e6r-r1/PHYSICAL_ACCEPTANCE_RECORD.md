# BUNNY A — PHYSICAL ATTENDED ACCEPTANCE RECORD (E6R-R1)

**Date:** 2026-11-06  
**Audited Baseline:** `a9e45d8ce9da25f58f52275bf7dddc3eaa7109da`  
**Execution Environment:** Windows 11 Enterprise (Workstation), Android Device Bridge daemon active (`tcp:5037`)  
**Hardware Status:** No authorized physical handset connected (`adb devices` -> empty); no authorized acoustic microphone active in automated session.

---

## 1. Executive Summary & Attended Gate Policy

In accordance with release qualification policy:
- **No claims of physical acceptance without physical evidence.**
- Software-verifiable criteria (UIA, layout math, contract fuzzing, keystore erasure, state machines, packet hashing, bundle validation) are automated and verified.
- Hardware-dependent gates requiring physical handset manipulation, acoustic voice input, or operator credentials are provided with complete, reproducible test packets and classified as **BLOCKED** until operator attendance.

---

## 2. Windows Attended Test Packet

### W-ATT-1: Physical Edge Docking & Multi-Monitor Drag-Snap
- **Prerequisites:** Windows 10/11 workstation with one or more physical displays.
- **Test Procedure:**
  1. Launch Bunny A Workstation (`native/windows/BunnyA/bin/Debug/net8.0-windows/BunnyA.exe` or installed MSIX).
  2. Click and hold the notch grip handle.
  3. Drag the notch toward the Top, Bottom, Left, and Right screen edges.
  4. Release within 50px of each edge.
  5. Drag across monitor boundaries to a secondary display.
- **Expected Result:**
  - Notch snaps within 2px of the work area boundary on all four edges.
  - Notch dynamically switches between horizontal orientation (Top/Bottom: width 340-420px, height 36px) and vertical orientation (Left/Right: width 36px, height 340-420px).
  - Agents lead the notch layout in canonical order: Gada -> Spear -> Chakra -> Sword.
- **Status:** **PASS (UIA Automated)** / Attended physical verification: **BLOCKED (Operator Attendance)**.

### W-ATT-2: Windows Narrator & UIA Accessibility
- **Prerequisites:** Windows Narrator enabled (`Win + Ctrl + Enter`).
- **Test Procedure:**
  1. Navigate to Bunny A Notch using `Tab` and Arrow keys.
  2. Observe Narrator announcements for agent avatars and task badges.
  3. Trigger Approval Center action via keyboard.
- **Expected Result:**
  - `AutomationProperties.Name` announced clearly for each control ("Gada Agent Idle", "Approve Button").
  - Notch window does not steal focus or trap keyboard focus loops.
- **Status:** **BLOCKED (Operator Attendance)**.

### W-ATT-3: Multi-Monitor Mixed-DPI Scaling
- **Prerequisites:** Display 1 at 100% DPI (96 DPI), Display 2 at 150% or 200% DPI (144-192 DPI).
- **Test Procedure:**
  1. Drag notch from 100% display to 150% display.
  2. Observe window scaling transition during `WM_DPICHANGED`.
- **Expected Result:**
  - Window resizes crisply without blurriness, clipped text, or misplaced agent icons.
- **Status:** **BLOCKED (Multi-Monitor Hardware Attendance)**.

### W-ATT-4: Full-Duplex Acoustic Voice Interruption
- **Prerequisites:** Working hardware microphone and speakers; Whisper local worker active.
- **Test Procedure:**
  1. Start voice session from native client.
  2. Speak a prompt: "Tell me a story about ancient architecture."
  3. While Bunny A is speaking the response audio, interrupt aloud: "Wait, stop that."
- **Expected Result:**
  - Bunny A immediately detects user voice onset via energy/VAD threshold, silences TTS playback within 200ms, and transitions avatar animation to `Interrupted` state.
- **Status:** **BLOCKED (Acoustic Hardware Attendance)**.

### W-ATT-5: Signed MSIX Package Installation & Protocol Invocation
- **Prerequisites:** Operator-signed `.msix` or test certificate imported into `Trusted People`.
- **Test Procedure:**
  1. Double click `releases/BunnyA.Workstation-0.5.1.0.msix`.
  2. Observe Windows App Installer UI.
  3. Click "Install", launch app from Windows Start Menu.
  4. In browser/Run dialog, execute `bunny-a://open`.
- **Expected Result:**
  - Installs cleanly into Windows Apps without trust errors; deep link launches or focuses Bunny A.
- **Status:** **BLOCKED (Operator Signing Credential)**.

---

## 3. Android Attended Test Packet

### A-ATT-1: Handset Installation & Upgrade Continuity
- **Prerequisites:** Physical Android 8.0+ handset connected via USB debugging (`adb`).
- **Test Procedure:**
  1. Install release APK: `adb install -r releases/Bunny-A-Android-v4.apk`.
  2. Launch app from home screen launcher icon (`com.routeragent.jev/.MainActivity`).
  3. Verify previous desktop shortcuts and pinned icons continue to launch `NativeCompanionActivity`.
- **Expected Result:**
  - Package installs with zero permission prompts (single `INTERNET` permission auto-granted).
  - Launcher opens native companion immediately with zero WebView flicker.
- **Status:** **BLOCKED (Physical Handset Required)**.

### A-ATT-2: QR Pairing, Connection Resiliency & Reconnect
- **Prerequisites:** Host running on workstation; Android handset on same Wi-Fi.
- **Test Procedure:**
  1. Scan pairing QR code from workstation dashboard into Android companion.
  2. Verify pairing completion and initial state synchronization.
  3. Toggle airplane mode on handset for 10 seconds; turn off airplane mode.
- **Expected Result:**
  - Companion reconnects automatically within 5 seconds of network restoration while its screen is open (retries every 5 s at most; a faster, event-driven reconnect would need `ACCESS_NETWORK_STATE`, which the single-permission posture excludes).
  - Zero duplicate commands sent; pending commands display "Outcome unknown" rather than "Not sent".
- **Status:** **BLOCKED (Physical Handset Required)**.

### A-ATT-3: Hardware Keystore Erasure & Revocation Fail-Closed
- **Prerequisites:** Paired handset.
- **Test Procedure:**
  1. From workstation, revoke paired device authorization.
  2. On handset, attempt to send a message.
  3. Tap "Unpair / Reset" in companion settings.
- **Expected Result:**
  - Host returns 401/revoked refusal; companion immediately closes session and resets to pairing screen.
  - Android KeyStore zeroed; all session tokens permanently wiped from memory and secure hardware enclave.
- **Status:** **BLOCKED (Physical Handset Required)**.

### A-ATT-4: Mobile Approval Refusal (Workstation Consequential Security)
- **Prerequisites:** Paired handset; workstation with pending agent file modification task.
- **Test Procedure:**
  1. Inspect pending task notification on phone.
  2. Verify available actions on phone.
- **Expected Result:**
  - Consequential actions (file writes, shell execution, credential grant) cannot be authorized from the phone.
  - Phone UI displays: "Approval required on workstation."
- **Status:** **BLOCKED (Physical Handset Required)**.

### A-ATT-5: TalkBack, Gesture Navigation & Display Cutouts
- **Prerequisites:** Handset with punch-hole / notch display; Android TalkBack enabled.
- **Test Procedure:**
  1. Navigate screen using TalkBack gestures.
  2. Rotate device between Portrait and Landscape.
  3. Verify safe-area insets around camera cutouts and gesture navigation bars.
- **Expected Result:**
  - TalkBack announces all controls; content respects `WindowInsets` with zero overlap under camera cutouts.
- **Status:** **BLOCKED (Physical Handset Required)**.

---

## 4. Hardware Gate Verdict

| Platform | Case ID | Description | Status | Blocking Dependency |
| :--- | :--- | :--- | :--- | :--- |
| **Windows** | `W-ATT-1` | Physical Edge Docking / Multi-Monitor | **BLOCKED** | Operator physical attendance |
| **Windows** | `W-ATT-2` | Windows Narrator UIA Verification | **BLOCKED** | Operator physical attendance |
| **Windows** | `W-ATT-3` | Mixed-DPI Multi-Monitor Layout | **BLOCKED** | Dual-display hardware attendance |
| **Windows** | `W-ATT-4` | Acoustic Full-Duplex Voice Interruption | **BLOCKED** | Microphone / audio operator attendance |
| **Windows** | `W-ATT-5` | Authenticode Package Installation | **BLOCKED** | Operator code signing certificate |
| **Android** | `A-ATT-1` | APK Physical Install & Upgrade | **BLOCKED** | Physical handset |
| **Android** | `A-ATT-2` | QR Pairing & Network Interruption | **BLOCKED** | Physical handset |
| **Android** | `A-ATT-3` | Enclave Keystore Erasure Verification | **BLOCKED** | Physical handset |
| **Android** | `A-ATT-4` | Consequential Approval Phone Refusal | **BLOCKED** | Physical handset |
| **Android** | `A-ATT-5` | TalkBack & Safe Area Inspection | **BLOCKED** | Physical handset |
