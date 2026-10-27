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

### 3. Verification & Acceptance
- Executable build: `BunnyA.exe` compiles with 0 errors and 0 warnings using .NET SDK 8.0.408.
- Integration test: `scripts/test-windows-native.mjs` verifies launch, authenticated Host state retrieval, agent mapping, and single-instance mutex enforcement.
