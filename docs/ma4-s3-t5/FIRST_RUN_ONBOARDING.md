# First-Run Consumer Onboarding Specification & Acceptance

**Product:** Bunny A by LOKAM  
**Milestone:** MA4-S3-T5  
**Document:** First-Run Onboarding Flow & Privacy Invariants  
**Classification:** Consumer Experience & Trust Specification  

---

## 1. Design Ethos: Radical Transparency & Zero Silent Privileges

Traditional AI applications frequently operate as "black boxes," silently indexing user document directories, scanning personal emails, and sending telemetry to remote cloud servers during setup.

Bunny A rejects this pattern. The first-run onboarding experience is designed to build lasting consumer trust through radical transparency, explicit consent, and clear explanation of capabilities.

### Mandatory Trust Invariants
1. **Zero Silent Scanning:** Bunny A never initiates background filesystem crawling of `%USERPROFILE%\Documents`, OneDrive, Outlook mailboxes, or code repositories during setup.
2. **Explicit Privilege Grants:** File access is granted strictly on a per-folder, user-selected basis.
3. **Local-First Affirmation:** The user is explicitly shown that their selected model runs locally on their machine, with zero prompts or code uploaded to external servers.
4. **Non-Destructive for Existing Users:** If a valid `%LOCALAPPDATA%\Bunny-A` configuration exists, onboarding detects prior setup, preserves user projects and memory, and offers a non-destructive settings review rather than re-initialization.

---

## 2. The 10-Step Onboarding Sequence

```
+----------------------------------------------------------------------------------------------------+
|                                    BUNNY-A FIRST-RUN WIZARD                                        |
|                                                                                                    |
|  [Step 1]  Welcome to Bunny A            -> Introduce product vision and companion philosophy      |
|  [Step 2]  Privacy & Local-First         -> Explain on-device inference and data boundaries        |
|  [Step 3]  Choose Language               -> Select primary interface language (Default: English)   |
|  [Step 4]  Select Approved AI Model      -> Discover and pin local Ollama model (qwen2.5-coder:7b) |
|  [Step 5]  Audio & Mic Permissions       -> Configure push-to-talk / hands-free voice capture      |
|  [Step 6]  Select Notch Placement        -> Choose Top, Bottom, Left, or Right edge                |
|  [Step 7]  Register Project Folders      -> (Optional) Authorize initial workspace directories     |
|  [Step 8]  Connect Android Companion     -> (Optional) Scan pairing QR code to connect mobile app  |
|  [Step 9]  Review Security Permissions   -> Explicit review of all granted boundaries              |
|  [Step 10] Harmless First Conversation   -> Interactive read-only demo task to verify system       |
|                                                                                                    |
+----------------------------------------------------------------------------------------------------+
```

### Detailed Step Analysis

#### Step 1: Welcome to Bunny A
- **UI Screen:** Clean, focused glass card featuring the Bunny A logo and a concise statement of purpose: *"Your local, private AI companion for coding, thinking, and daily workflows."*
- **User Action:** Click "Get Started".

#### Step 2: Privacy & Local-First Architecture
- **Content:** Explains the physical execution boundary:
  - *"Inference happens on your GPU (RTX 4050)."*
  - *"Code and files never leave your computer."*
  - *"Zero cloud analytics, tracking, or data harvesting."*
- **User Action:** Click "Continue".

#### Step 3: Choose Interface Language
- **Selection:** Primary language dropdown (Default: `English (US)`).
- **Persistence:** Saved to `preferences.json` under `%LOCALAPPDATA%\Bunny-A\state\`.

#### Step 4: Choose Approved AI Model
- **Discovery:** Probes local Ollama instance at `http://127.0.0.1:11434/api/tags`.
- **Selection:** Discovers installed models, highlights approved model `qwen2.5-coder:7b` (digest `dae161...`), and confirms GPU hardware acceleration.
- **Fail-Closed Rule:** Remote cloud models (`:cloud`) are flagged as unsupported for local execution.

#### Step 5: Configure Audio & Microphone Permissions
- **Options:**
  1. *Push-to-Talk (Default):* Microphone activates only while holding the talk button.
  2. *Hands-Free Duplex:* Full-duplex listening with Acoustic Echo Cancellation.
  3. *Text-Only Mode:* Disables voice engine entirely for users without microphones.
- **Transparency:** Explains that audio processing uses local `whisper.cpp` without cloud speech APIs.

#### Step 6: Select Glass Notch Placement
- **Interactive Picker:** Visual display showing a monitor outline with selectable edges: **Top**, **Bottom**, **Left**, **Right**.
- **Dynamic Preview:** Moving the selector immediately positions the live notch on the screen to let the user test visual comfort and monitor fit.

#### Step 7: Optionally Register Project Folders
- **Folder Picker:** Windows folder browser dialog allows the user to select specific code directories.
- **Scope Restriction:** Clear explanation that Bunny A will have access *only* to the explicitly selected folders.

#### Step 8: Optionally Connect Android Companion
- **Mobile Pairing:** Displays the ephemeral pairing QR code for users who wish to connect their Android phone.
- **Bypass Option:** Users can click "Skip for now" to use Bunny A purely as a desktop assistant.

#### Step 9: Review Security & Permission Boundaries
- **Summary Dashboard:** Displays an audit card listing all configured settings:
  - Model: `qwen2.5-coder:7b` (Local GPU)
  - Registered Folders: `<count> folders authorized`
  - Audio: `<mode>`
  - Remote Access: `<enabled/disabled>`
- **User Confirmation:** User clicks "Confirm and Launch".

#### Step 10: Harmless First Conversation & Read-Only Demo
- **Onboarding Verification Task:** Bunny A automatically opens a harmless greeting prompt: *"Hello! I am Bunny A. Ask me a question or give me a task."*
- **Read-Only Demonstration:** Demonstrates direct conversation (Scenario A) without requesting consequential permissions.

---

## 3. Resumability & State Migration Safety

- **Pause & Resume:** If the user closes Bunny A during onboarding (e.g. at Step 6), `install.json` records `onboardingStep: 6`. Upon next launch, the wizard resumes at Step 6 without repeating earlier selections.
- **Safe Migration for Upgrading Users:** If upgrading from a previous release (e.g. MA3-T13), the installer inspects `%LOCALAPPDATA%\Bunny-A\state\install.json`:
  - Confirms schema version `bunny-state/2`.
  - Preserves existing project workspace grants, Lotus Memory databases, and pairing tokens.
  - Skips the first-run sequence and displays a brief "What's New in MA4-T5" summary.

---

## 4. Verification Evidence (Gate T5-G5)

- **Automated Flow Verification:** `scripts/ma4-s3-t5/consumer-qualification.mjs` verifies all 10 steps, zero-scan enforcement, and preference persistence.
- **Status:** **PASS** (Gate `T5-G5`).
