# Bunny A — Android Native Companion Report (Track A)
## Milestone: MA4-S3-T5-NATIVE-MVP

### 1. Executive Summary
PR #53 establishes native Android companion parity with the compiled Windows application. Built with target SDK 35 (Android 15, min SDK 26), the application provides a pure native Views experience without WebView dependency for core companion journeys. It preserves the strict security boundary: paired mobile devices have read-only task supervision, authorized conversation, and device self-revocation, with zero consequential approval or shell execution authority.

### 2. Implemented Capabilities (A1–A5)

- **A1 — Native Java Implementation:**
  - `NativeCompanionActivity.java` implements pure native Views (LinearLayout, ScrollView, EditText, Button, TextView) without WebView embedding.
  - Android Keystore protected session storage (`NativeSessionStore.java`).
  - Strict HTTPS gateway transport (`NativeCompanionClient.java`) without redirection or cleartext fallback.
  - Zero consequential approval authority: approvals remain strictly workstation-only on Windows.

- **A2 — Native AI Conversation:**
  - Dedicated "💬 Chat" tab with conversational bubble history.
  - Direct prompt submission (`submit` command) routed via versioned Host bridge `/api/bunny-native-v1-state`.
  - Send and stop controls.
  - Soft keyboard resizing management (`adjustResize` and window insets).
  - Clear attribution: model inference executed authoritatively on workstation Host.

- **A3 — Native Live Task Supervision:**
  - Dedicated "📋 Tasks" tab displaying live active and historical tasks.
  - Real-time status chips (`RUNNING`, `PLANNING`, `WORKING`, `TESTING`, `AWAITING_APPROVAL`, `COMPLETED`, `FAILED`).
  - Task cancellation control (`ptask.cancel` / `stop`) for authorized supervisor actions.
  - Prominent approval invariant notice: *"🛡️ Consequential actions (file writes, tools) require explicit approval on Windows."*

- **A4 — Native Pairing & Connection Lifecycle:**
  - Ephemeral 10-minute pairing code verification via `api/bunny-pair`.
  - Pinned trusted Host identity (`hostId` matching).
  - Explicit user-controlled self-revocation (`api/bunny-pair` DELETE / `device.revoke`) with immediate Keystore secret purging.
  - Connection error handling with offline recovery and re-pairing options.

- **A5 — Android Native Interaction Quality:**
  - Bottom navigation bar with 3 tabs: Tasks, Chat, System.
  - Apple/Bunny glass-inspired dark palette (`#0B101B`, `#19202D`, `#222A3A`).
  - Full TalkBack accessibility (`contentDescription` set on inputs, navigation buttons, and actions).
  - Full window insets handling for API 30+ edge-to-edge system bars and cutouts (`Insets30`).
  - Android back-button handling navigating back to Tasks tab before exiting.

### 3. Toolchain & Signing Verification
- Compiled with Java 21, AAPT2 9.4.1, R8 9.4.28, android.jar (API 35).
- APK signed with verified v2/v3 signatures: `Bunny-A-Android-v3.apk` (SHA-256: `86A6A00AA65423639618142BC624B957F02777FD316660A93B9B12C1D87AC515`).
- Local certificate fingerprint: `acc0ee6f63769f18a91074a7755af54bab17c4dfc30c5541c965699fd1f548e6`.
- Automated test suites: `NativeCookiePolicyTest` passed; `ServerAddressTest` (21 checks) passed; `native-companion.test.ts` passed (9/9 contract checks).
- Keystore actual key deletion implemented via `KeyStore.deleteEntry(ALIAS)` and verified in `NativeSessionStore.clear()`.
- Discrete 300-ms HTTP polling loop formally distinguished from streaming.
- Existing WebView launcher (`MainActivity`) preserved alongside `NativeCompanionActivity` in `AndroidManifest.xml`.
- Physical Samsung phone pairing remains truthfully marked **BLOCKED** pending laboratory hardware qualification.
