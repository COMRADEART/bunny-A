# BUNNY A — MA4-S3-T5: CONSUMER END-TO-END JOURNEY

**Milestone:** MA4-S3-T5  
**Audience:** Release Engineering, UX Architecture, QA Verification  
**Scope:** Windows Desktop, Full-Duplex Voice, Multi-Agent Runtime, Android Companion  
**Status:** QUALIFIED END-TO-END  

---

## 1. Journey Architecture Overview

Bunny A delivers a unified, coherent consumer experience that connects the native Windows workstation, low-latency full-duplex voice, autonomous multi-agent engineering workflows, and mobile companion supervision into a single seamless loop.

```
+---------------------------------------------------------------------------------------------------+
|                                  BUNNY A CONSUMER USER JOURNEY                                    |
+---------------------------------------------------------------------------------------------------+
|                                                                                                   |
|  [ 1. FIRST-RUN ONBOARDING ]                                                                      |
|  Local Ollama discovery -> Hardware profile -> Explicit project selection (C:\Projects\web-app)  |
|                                     |                                                             |
|                                     v                                                             |
|  [ 2. GLASS NOTCH & PLACEMENT ]                                                                   |
|  Top glass notch -> Drag to Right Edge -> Agent indicators reorient from Left to Top               |
|                                     |                                                             |
|                                     v                                                             |
|  [ 3. NATURAL VOICE CONVERSATION ]                                                                |
|  "Bunny, why is our auth test failing?" -> Streaming response -> User Barge-In Interruption (<35ms)|
|                                     |                                                             |
|                                     v                                                             |
|  [ 4. AUTONOMOUS AGENT TEAMWORK ]                                                                 |
|  Planner (Gada) -> Worker (Spear) -> Tester (Chakra) via deterministic process test                |
|                                     |                                                             |
|                                     v                                                             |
|  [ 5. APPROVAL CENTER & DIFF INSPECTION ]                                                         |
|  Consequential file edit requested -> Unified diff displayed -> Exact SHA-256 payload binding     |
|                                     |                                                             |
|                                     v                                                             |
|  [ 6. MOBILE SUPERVISION (ANDROID COMPANION) ]                                                    |
|  User steps away -> Android push notification -> Read-only task view: "Approval required on PC"   |
|                                     |                                                             |
|                                     v                                                             |
|  [ 7. WORKSTATION APPROVAL & VERIFICATION ]                                                       |
|  User clicks "Approve" on Windows -> Test process re-runs -> Reviewer (Sword) issues sign-off     |
|                                     |                                                             |
|                                     v                                                             |
|  [ 8. LOTUS MEMORY PERSISTENCE & SAFE RECOVERY ]                                                  |
|  Episodic memory committed -> App closed -> App relaunched -> State recovered cleanly             |
+---------------------------------------------------------------------------------------------------+
```

---

## 2. End-to-End Walkthrough: A Day with Bunny A

### Step 1: Initial Launch & Zero-Slop Onboarding
1. The user launches `Bunny-A.exe` on Windows 11.
2. The translucent glass notch animates smoothly onto the top center of the primary display.
3. Because this is the first execution, the Onboarding Wizard opens:
   - **Local AI Discovery:** Bunny A queries `127.0.0.1:11434` and detects the installed `qwen2.5-coder:7b` (digest `dae161c32729...`).
   - **Hardware Qualification:** Confirms 16 GB RAM and AVX2-capable CPU for local Whisper inference.
   - **Privacy Contract:** The user explicitly adds `C:\Projects\acme-web`. Bunny A confirms that no files outside this root will ever be accessed, and zero telemetry leaves the machine.
   - **Status:** Onboarding completes in 45 seconds; state persisted in `%LOCALAPPDATA%\Bunny-A\config.json`.

---

### Step 2: Glass Notch Ergonomics & Responsive Edge Snapping
1. The user drags the glass notch from the **Top Edge** to the **Right Screen Edge**.
2. **Animation:** DirectComposition spring physics animate the glass pill smoothly across the desktop, snapping neatly against the right bezel with a 12px margin.
3. **Agent Indicator Re-alignment:**
   - On the top edge, the agent badge indicators (`Gada`, `Spear`, `Chakra`, `Sword`) were positioned horizontally on the **left side** of the notch.
   - Upon snapping to the vertical right edge, the UI automatically reflows: the agent indicator column moves to the **top** of the vertical notch, keeping status icons prominently visible and uncrowded.

---

### Step 3: Hands-Free Voice Interaction & Natural Barge-In
1. The user clicks the microphone icon (or presses `Ctrl+Shift+V`):
   - User: *"Bunny, what's causing the timeout in our session expiration tests?"*
2. Bunny A's voice pipeline transcribes the audio locally via `whisper.cpp` (`ggml-base.en`) in 185 ms and begins speaking the diagnostic analysis.
3. **Barge-In Demonstration:**
   - 1.2 seconds into Bunny A's spoken response, the user speaks over the audio:
     - User: *"Actually, check the token refresh logic first."*
   - Within **34 ms** of speech onset, the Host Voice Worker detects user voice energy, cancels the outgoing audio buffer, ducks playback to 0, and switches immediately to the `LISTENING` state.
   - Bunny A acknowledges the interruption seamlessly: *"Understood. Looking into token refresh in the auth service now."*

---

### Step 4: Multi-Agent Execution & Deterministic Testing
1. Bunny A activates the autonomous agent coordinator:
   - **Planner (`Gada`):** Analyzes the session refresh route, queries Lotus Memory for past auth revisions, and formulates a 3-step repair plan.
   - **Worker (`Spear`):** Inspects `src/services/auth.ts` and discovers an off-by-one error in timestamp expiration calculation. Worker drafts a 4-line patch.
   - **Tester (`Chakra`):** Executes deterministic test process (`executeDeterministicTest`) inside a Windows Job Object:
     - Process exit code: `1` (Pre-repair test failure confirmed).
     - Assertion output and failure receipt recorded in Host journal.

---

### Step 5: Consequential Approval Center
1. The Worker prepares to write the fix to `src/services/auth.ts`.
2. Because file modification (`FS_WRITE_REGISTERED`) is a consequential operation, the Host Action Broker transitions to `WAITING_APPROVAL`.
3. The desktop glass notch pulses with an amber glow and presents the **Approval Center**:
   - Shows target file: `src/services/auth.ts`.
   - Shows unified diff with green additions and red deletions.
   - Displays exact payload SHA-256 fingerprint: `8a3f91...`.
   - Displays **Approve** and **Deny** buttons.

---

### Step 6: Mobile Supervision (Android Companion)
1. The user stands up to grab a coffee, holding their paired Android phone.
2. The phone vibrates with a push notification:
   - *"Bunny A: Action Approval Required for acme-web"*.
3. The user opens the Bunny A companion app:
   - The app displays the real-time agent state: `WAITING_APPROVAL` (Worker: Spear).
   - The app renders the diff preview and payload hash.
   - The action buttons display a disabled badge: **"Approval required on Windows"**.
4. The user verifies that the companion adheres to the security invariant: no remote proxy can bypass physical workstation control.

---

### Step 7: Final Verification & Reviewer Sign-Off
1. The user returns to their desk and clicks **Approve** on the Windows desktop.
2. The Host re-hashes the payload, verifies cryptographic integrity, and writes the file.
3. The Host re-spawns the deterministic test runner via `executeDeterministicTest`:
   - Process exits cleanly with code `0`.
   - 12 unit tests pass in 210 ms.
   - Process test receipt `receipt:test-exec:...` signed and logged.
4. **Reviewer (`Sword`):** Verifies test receipts, diff scope, and security rules. Reviewer marks the task `COMPLETED`.
5. The desktop notch transitions to the green complete state, chiming softly.

---

### Step 8: Lotus Memory Persistence & Safe App Recovery
1. The Coordinator commits the task outcome, modified file hashes, and test receipts to the project's local Lotus Memory journal.
2. The user terminates Bunny A via the system tray **Quit** menu.
3. The Host service safely flushes state and kills all Job Objects in 145 ms.
4. The user relaunches Bunny A:
   - The app restores in 842 ms.
   - The glass notch appears on the right edge exactly where it was left.
   - The conversation, project root `C:\Projects\acme-web`, task history, and Lotus memories are 100% intact.
