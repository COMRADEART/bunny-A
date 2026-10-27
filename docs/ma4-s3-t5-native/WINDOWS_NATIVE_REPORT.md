# Bunny A — Windows Native Application Report (Track W)
## Milestone: MA4-S3-T5-NATIVE-MVP

### 1. Executive Summary
The compiled .NET 8 WPF application (`native/windows/BunnyA`) has been elevated from an incomplete preview into a full-featured native Windows client. The application connects directly to the authoritative loopback Host via bearer authentication (`http://127.0.0.1:<port>`), eliminating browser dependence for primary user journeys while preserving Host-side security boundaries and the Action Broker.

### 2. Implemented Capabilities (W1–W7)

- **W1 — WPF Application Foundation:**
  - Complete navigation architecture with 10 native screens:
    1. Chat & Conversation
    2. Agent Dashboard
    3. Projects & Workspaces
    4. Approval Center
    5. Voice Studio
    6. Task History & Reconciliations
    7. Lotus Memory Store
    8. Models & AI Providers
    9. Android Device Pairing
    10. Workstation Settings & Safety Policy
  - Standard .NET 8 BCL / WPF libraries without third-party NuGet dependencies (`NuGet.Config` clear source lock maintained).
  - Modern dark glass aesthetic (`#0A0D16` / `#141824`) compliant with M-A-3 T13 design tokens.

- **W2 — Real AI Conversation:**
  - Multi-agent speaker selection: Bunny, Gada (Slot 1), Spear (Slot 2), Vishnu Chakra (Slot 3), Sword (Slot 4).
  - Direct Host conversation execution (`personal_agent.converse` for personal agent facts/memory, `submit` for model inference).
  - Model selection, prompt input, send/stop controls, message copy, and error recovery states.

- **W3 — Native Agent Dashboard:**
  - 4 Personal Agent cards embedding approved character weapon artwork:
    - Gada (`gada.compact.png`, Worker)
    - Spear (`spear.compact.png`, Tester)
    - Vishnu Chakra (`chakra.compact.png`, Reviewer)
    - Sword (`sword.compact.png`, Planner)
  - 13 Host-authoritative states mapped (`IDLE`, `PLANNING`, `WORKING`, `TESTING`, `REVIEWING`, `WAITING_APPROVAL`, `PAUSED`, `COMPLETED`, `FAILED`, `CANCELLED`, `UNCERTAIN`).
  - Active tasks view with task cancellation (`ptask.cancel`), pause, and resume controls.

- **W4 — Native Approval Center (Workstation-Only):**
  - Consequential action proposal inspection with exact proposed diffs, permission scopes, and side-effect taxonomy.
  - Strict SHA-256 payload binding: approvals (`action.approve`) require the exact reviewed `payloadSha256` hash.
  - Deny control (`action.deny`) to fail-closed without consequential mutations.

- **W5 — Movable Glass Notch Window:**
  - Floating borderless window with Apple-inspired translucent glass styling, rounded pill corners, and dynamic drop shadow.
  - 4-Edge Docking: Top, Bottom, Left, Right.
  - Responsive reflow: horizontal docking positions agent badges on the **left side**; vertical docking reflows agent badges to the **top**.
  - Live status indicators: Bunny mood avatar, 4 weapon badges with live state rings, voice indicator pill, approval alert badge, quick-stop button, and expand to main window.
  - Persistent placement configuration saved in `%LOCALAPPDATA%/BunnyA/config.json`.

- **W6 — Native Voice Studio:**
  - Full-duplex controls connected to `voice.*` Host API.
  - Microphone and speaker device enumeration and selection.
  - Push-to-talk, start/stop listening, barge-in interruption (`voice.interrupt`), and mic mute (`voice.mute`).
  - Live conversation transcript display.

- **W7 — Native Lifecycle & OS Integration:**
  - Single-instance enforcement via `Global\BunnyA_Workstation_SingleInstance_Mutex`.
  - Background tray/notch continuity when window is closed.
  - Safe shutdown with no orphaned child processes.

### 3. Verification & Acceptance (R1 Real Application Acceptance)
- **Executable build:** `BunnyA.exe` compiles with 0 errors and 0 warnings using .NET SDK 8.0.408.
- **Security Closure:** GHSA-q84f-53jg-9ppm resolved against `better-auth@1.7.14` with generic OAuth compatibility in `client.ts` and `popup.server.ts`. 0 vulnerabilities under `npm audit --omit=dev --audit-level=high`.
- **Stage 1 (Windows Chat & Local Inference):** Exercised via UI automation (`scripts/ui-automation-helper.ps1` driving `System.Windows.Automation`) against launched `BunnyA.exe` and real local Ollama (`qwen2.5-coder:7b`). Verified prompt entry ("What is 34 + 28? Answer with ONLY the number."), SendButton click, Host task creation (`30e8d37a-...`), model output ("62"), native chat list rendering, cross-check against Host output, and active task cancellation via UI StopButton.
- **Stage 2 (Multi-Agent Action Broker):** Exercised multi-step workflow in disposable project (`file.prepare`, consequential `file.apply`, `local.test`). Verified proposal creation, Run with Agents, exact SHA-256 payload approval (`act-60263569-...`, hash `ae67f674...`), tamper rejection of mismatched hash, disk effect (`config.json` before: `e39809...`, after: `43a847...`), independent test execution receipt (`receipt:test-exec:test-1793128350988-f244392f...`), explicit denial (`FAILED`), and cancellation (`CANCELLED`).
- **Stage 3 (Windows Graphical Evidence & Notch Positions):** Observed authenticated Host request at `GET /state` with Bearer token. Rendered translucent glass notch window and exercised all 4 positions (`Right`, `Bottom`, `Left`, `Top`), verifying bounding rectangles, orientation reflow (horizontal on left, vertical on top), configuration persistence in `%LOCALAPPDATA%\BunnyA\config.json`, single-instance mutex enforcement, and clean process termination with 0 orphaned child processes.
- **Stage 4 (Android Companion Contract):** Verified discrete 300-ms polling loop vs streaming, permitted supervisor actions, strict workstation-only consequential approval invariant (`APPROVAL_ON_HOST`), actual Android Keystore key deletion (`KeyStore.deleteEntry(ALIAS)`), and preservation of legacy WebView launcher (`MainActivity`).
- **Hardware Qualification Status:** Physical acoustic audio room, physical Samsung hardware phone, and hardware EV Authenticode token remain strictly **BLOCKED**. Public beta release recommendation remains **STRICT NO-GO**.
