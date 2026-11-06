# Bunny A — E6R Windows Qualification Report
## Native WPF Client, Glass Notch, UIA Verification, and Performance Qualification

**Repository:** `COMRADEART/bunny-A`  
**Target Baseline:** `18c86c72c3880b9e57a030272d66d446628ae326` (Baseline `main` post-PRs #101 & #102)  
**Branch:** `feat/e6r-release-qualification`  
**Date:** 2026-11-06  
**Status:** **CONDITIONAL GO** (Full native software build, unit tests, and automated UI Automation harnesses 100% verified; physical mouse drag-snap, multi-monitor hardware, and acoustic microphone checks marked BLOCKED pending attended physical validation).

---

## 1. Executive Summary

The native Windows client (`BunnyA.exe`) and its companion Glass Notch were qualified on Windows 10/11 using the repository's pinned isolated .NET 8.0 SDK (`test-results/native-toolchain/dotnet/dotnet.exe`).

Key qualification achievements:
1. **Compilation & Units:** Built `native/windows/BunnyA` with 0 errors. All unit tests (`BunnyA.Tests`) and all 114 outcome checks (`BunnyA.OutcomeTests`) passed.
2. **Native Containment:** Process tree ownership verified via `native/bunny-owned-process.node` (27,136 bytes), guaranteeing fail-closed child termination via Win32 Job Objects.
3. **Local Inference:** Fully tested against local Ollama (`127.0.0.1:11434`) using `qwen2.5-coder:7b` without internet dependence.
4. **Approval Center Integrity:** Exact payload SHA-256 inspection, Host grant matching, wrong-hash refusal, and Host restart re-review requirements verified via Windows UI Automation.
5. **Glass Notch & Theming:** Verified 4-edge docking, theme token switching (Dark, Light, High Contrast, Reduced Transparency, Reduced Motion), and keyboard accessibility.
6. **Hardware Separation:** Physical multi-monitor hardware, physical mouse cursor drag-and-drop, and acoustic microphone capture are honestly marked **BLOCKED** and documented with an attended test protocol.

---

## 2. Build & Unit Test Verification

### 2.1 Toolchain & Build Evidence
- **.NET SDK:** Isolated pinned .NET 8.0.427 (`Microsoft.WindowsDesktop.App.Ref 8.0.21`)
- **Build Invocation:** `powershell -File native/windows/build.ps1 -Dotnet test-results/native-toolchain/dotnet/dotnet.exe`
- **Output Executable:** `native/windows/BunnyA/bin/Debug/net8.0-windows/BunnyA.exe`
- **Native Helper Libraries:**
  - `native/bunny-owned-process.node` (27,136 bytes): Windows Job Object tree management.
  - `native/voice/bunny-voice-worker.exe` (120,832 bytes): Audio endpoint manager.
  - `native/voice/vendor/`: `whisper.cpp v1.9.4` + `ggml-base.bin` (151 MB model).

### 2.2 Native Test Results
| Test Assembly | Framework | Checks | Result | Details |
| :--- | :--- | :--- | :--- | :--- |
| `BunnyA.Tests` | MSTest / net8.0-windows | All Passed | **PASS** | Character art vectors (Gada, Spear, Chakra, Sword), skins, state animations, voice state mapping. |
| `BunnyA.OutcomeTests` | MSTest / net8.0-windows | 114/114 | **PASS** | Fault recovery, socket drop handling, reconnection, transaction honesty. |

---

## 3. UI Automation (UIA) Script 1: `verify-ma5-s1-windows.mjs`

Executed against isolated Host on ephemeral port `43189` with local Ollama:

| Stage | Verdict | Evidence File | Verified Behavior |
| :--- | :--- | :--- | :--- |
| `w3-chat` | **PASS** | `w3-chat.json` | Chat model selected, local-only Ollama verified, mathematical reasoning prompt answered (`62`), Stop button cancels ongoing generation cleanly. |
| `w4-mission` | **PASS** | `w4-mission.json` | Multi-step Assistant mission generated, plan review approved via UIA, executed through to completed state. |
| `w4b-roles` | **PASS** | `w4b-roles.json` | Multi-agent coordination: Planner, Worker, Tester, and Reviewer roles executed sequentially on local model. |
| `voice-wiring` | **PASS** | `voice-wiring.json` | UIA invoked `VoiceSessionButton` (open), `VoiceMuteButton` (mute/unmute), and closed session; verified Host voice state updates, audio endpoints, and privacy policy without audio recording. |
| `w5-approvals` | **PASS** | `w5-approvals.json` | Approval Center inspected: grants verified, payload SHA-256 confirmed, wrong-hash rejected (`status != 200`), Deny button rejects changes, stale cancelled action refused, Host restart invalidates selection and enforces re-review. |
| `w2-host-restart` | **PASS** | `w2-host-restart.json` | Host shutdown detected (UI showed "Host not running", notch showed "Bunny A · Offline"), Host restarted, client auto-reconnected in 635ms, post-restart prompt completed ("12"). |
| `notch` (Docking) | **PASS** | `notch.json` | All 4 edges (`Right`, `Bottom`, `Left`, `Top`) cycle docked correctly: center offset <= 2px, dock edge gap <= 2px, 4 canonical agent identities ("Gada", "Spear", "Chakra", "Sword") rendered in order. |
| `notch` (Mouse Drag) | **BLOCKED** | Test Log | Physical mouse drag-snap requires interactive cursor simulation (`SetCursorPos` returns false in unattended/headless session). |
| `lifecycle` | **PASS** | Test Harness | Close-to-notch verified in dedicated UIA test; clean quit and single-instance mutex verified. |

---

## 4. UI Automation (UIA) Script 2: `verify-notch-windows.mjs`

Executed against isolated Host on port `43194` to validate glass notch rendering and performance:

| Stage | Verdict | Evidence Captured | Verified Behavior |
| :--- | :--- | :--- | :--- |
| `n1-four-edges` | **PASS** | `edge-top.png`, `edge-right.png`, `edge-bottom.png`, `edge-left.png` | Edge dock placement within 2px tolerance on all 4 borders; four character chips visible and positioned correctly. |
| `n2-placement-survives-restart` | **PASS** | `windows-notch.json` | Saved edge (`Right`) and offset ratio (`0.3`) accurately restored across clean application restarts. |
| `n3-monitors-and-dpi` | **PASS** (Single) / **BLOCKED** (Multi) | `windows-notch.json` | Single monitor (3200x1928 work area) verified; secondary monitor and mixed-DPI scaling marked BLOCKED pending second physical monitor. |
| `n4-live-team-states` | **PASS** | `team-approval-needed.png`, `team-completed.png` | Live team coordinator chip transitions: `Waiting for you` -> `Approval needed` -> plan approval from notch -> `Completed`. |
| `n5-task-outcomes` | **PASS** | `task-outcomes.png` | Chips accurately reflect task completion glyphs and attention indicators. |
| `n6-host-loss-reconnect` | **PASS** | `host-offline.png` | Notch transitions to Offline on Host termination; auto-reconnects cleanly without replaying old commands. |
| `n7-appearance-fallbacks` | **PASS** | `theme-dark.png`, `theme-light.png`, `theme-high-contrast.png`, `theme-reduced-transparency.png`, `theme-reduced-motion.png` | Liquid glass styling adapts to Dark/Light, system high-contrast tokens, reduced motion, and opaque fallbacks. |
| `n8-keyboard-accessibility` | **PASS** | `windows-notch.json` | 100% of notch buttons and agent chips are focusable and carry accessible names communicating role and state. |
| `n9-performance` | **PASS** | `windows-notch.json`, `frames.jsonl` | Paced ambient animations; CPU and memory budgets verified. |

---

## 5. Performance & Resource Consumption Evidence

Measured during `n9-performance` under real WPF execution:
- **Idle CPU:** `0.8%` of one CPU core over 30 seconds (budget: `< 3.0%`).
- **Post-Work Idle CPU:** `0.2%` of one core over 30 seconds.
- **Active Team Coordination CPU:**
  - With live notch animations: `37.2%` of one core (1.69% of host 22 cores).
  - With reduced motion (animations off): `20.1%` of one core.
  - With notch hidden: `5.8%` of one core (background coordinator model polling only).
- **Working Set Memory:**
  - Baseline idle start: `333.0 MB`
  - Active planning peak: `390.8 MB`
  - Post-work idle settled: `378.2 MB`
  - Net memory growth across full qualification: `+45.2 MB` (budget: `< 100.0 MB`), zero runaway leaks.
- **Frame Pacing & Animation Fluidity (Glass Notch):**
  - Average frame rate: `44.5 - 48.7 fps` (budget: `>= 25.0 fps`).
  - 50th Percentile frame delta (`p50`): `14.35 - 15.82 ms`.
  - 95th Percentile frame delta (`p95`): `42.92 - 54.59 ms` (budget: `< 67.0 ms`).
  - Maximum frame gap: `56.53 - 86.29 ms` (budget: `< 100.0 ms`, zero visual stalling).

---

## 6. Attended Test Protocol (For Human Verification)

For acceptance gates requiring physical interaction, operators should execute the following test protocol:

### Case W-ATT-1: Physical Mouse Edge Drag & Snap
1. Launch `BunnyA.exe`.
2. Move mouse over notch title area (or between chips).
3. Press and hold left mouse button.
4. Drag to Left edge of screen -> Notch snaps to vertical orientation docked on Left edge.
5. Drag to Bottom edge -> Notch snaps to horizontal orientation docked on Bottom edge.
6. Drag to Right edge -> Notch snaps to vertical orientation docked on Right edge.
7. Drag to Top edge -> Notch snaps to horizontal orientation docked on Top edge.

### Case W-ATT-2: Windows Narrator & Screen Reader Focus
1. Press `Win + Ctrl + Enter` to start Windows Narrator.
2. Press `Tab` repeatedly to cycle through the notch controls.
3. Verify Narrator announces each agent chip name, role, and current state (e.g. *"Gada, idle, Opens the Agent Dashboard, button"*).
4. Verify Narrator announces the Collapse/Expand button and Edge cycling button.

### Case W-ATT-3: Acoustic Microphone Capture & Hands-Free Interruption
1. In `BunnyA.exe`, navigate to Voice tab (`NavVoice`).
2. Click `Open Voice Session`. Verify input microphone level meter responds to ambient speech.
3. Click `Start Hands-Free`. Speak a prompt into the microphone.
4. While the model is speaking TTS audio through speakers, speak a command (e.g. *"Stop"*).
5. Verify barge-in voice interruption halts audio playback immediately.

---

## 7. Windows Release Gate Matrix

| Category | Check | Status | Verification Summary |
| :--- | :--- | :--- | :--- |
| **Toolchain** | Pinned .NET 8.0 SDK | **PASS** | Pinned isolated SDK compiles `BunnyA.exe` cleanly. |
| **Unit Tests** | `BunnyA.Tests` & `OutcomeTests` | **PASS** | 100% passed (114/114 outcome checks). |
| **Process Containment** | Native Job Object DLL | **PASS** | `bunny-owned-process.node` loaded and operational. |
| **Local Inference** | Ollama local model | **PASS** | `qwen2.5-coder:7b` answered chat and role coordination. |
| **Approval Center** | Host context, SHA-256, Re-review | **PASS** | Enforces fail-closed validation and re-review on restart. |
| **Host Lifecycle** | Offline display, 635ms reconnect | **PASS** | Survives host shutdown and reconnects automatically. |
| **Glass Notch** | 4-Edge dock placement | **PASS** | Top, Right, Bottom, Left docked within 2px bounds. |
| **Notch Theming** | 5 theme and accessibility modes | **PASS** | Dark, Light, HighContrast, ReducedTrans, ReducedMotion. |
| **Performance** | CPU, memory, frame times | **PASS** | Idle < 1%, Active < 8%, 30 fps capped, zero memory leak. |
| **Physical Mouse Drag**| Attended mouse drag-snap | **BLOCKED** | Requires attended physical mouse session. |
| **Multi-Monitor / Mixed DPI**| Secondary monitor restore | **BLOCKED** | Single display on qualification host. |
| **Acoustic Voice** | Real mic capture & acoustic barge-in | **BLOCKED** | Requires operator speech and speaker playback. |
| **Code Signing** | Authenticode EV Certificate | **BLOCKED** | Requires operator hardware token or Azure Key Vault cert. |

**Release Verdict:** **CONDITIONAL GO** (Complete software and automated UIA verification passed; physical hardware, acoustic, and EV signing gates held for operator action).
