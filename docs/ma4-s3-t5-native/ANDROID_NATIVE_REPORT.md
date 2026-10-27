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
  - Explicit user-controlled self-revocation (`api/bunny-pair` DELETE / `device.revoke`). The local Keystore key is deleted and reported as erased only when it is observably gone (R1R2); a failed deletion is shown to the user, never reported as success.
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
- Automated test suites: `NativeCookiePolicyTest` passed; `ServerAddressTest` (21 checks) passed. See §4 for the corrected classification of `native-companion.test.ts` and the Keystore test.
- Keystore key deletion goes through `KeystoreErasure.delete`, exercised on the JVM in §4. It is NOT TESTED on a physical Android Keystore.
- Discrete 300-ms HTTP polling (not streaming) is a client design fact; no test measures it on a device.
- Existing WebView launcher (`MainActivity`) preserved alongside `NativeCompanionActivity` in `AndroidManifest.xml`.
- Physical Samsung phone pairing remains truthfully marked **BLOCKED** pending laboratory hardware qualification.

### 4. R1R2 corrections and security classification (2026-10-27)

**Keystore clearing defect, fixed.** `NativeSessionStore.clear()` caught every Keystore exception and returned only whether the
SharedPreferences entry was removed, so a failed key deletion was reported to the user as a successful erasure. It now returns
true only when the session preference is removed **and** `KeystoreErasure.delete` observes that the alias is gone; any exception
returns false. "Forget locally" and "Revoke" now tell the user when local erasure could not be confirmed.

| Check | Kind | Result |
| --- | --- | --- |
| `android/tests/KeystoreErasureTest` (5 checks): real delete, absent key, throwing delete, delete that leaves the key | JVM, real `java.security.KeyStore` (PKCS12 + failing SPI); run by `scripts/build-android.ps1` in CI | PASS locally; the previous swallow-and-succeed logic fails it |
| `tests/native-companion.test.ts` 1–3: device action rights and workstation-only approval | Node, real Host functions; now part of `npm test` | PASS (3) |
| `tests/native-companion.test.ts` 8–9 | Source-pattern checks of manifest and storage source | PASS, but they are **not** security qualification |
| Former 4–6 (polling, revocation, cancellation) | Asserted on local variables; no product code ran | **Removed** |
| Former 7 (Keystore) | Source regex | **Replaced** by the JVM test above |
| Android Keystore deletion on a physical device | Physical | **NOT TESTED**: no authorized device was attached (`adb` not installed, no device) |
| Pairing, conversation, supervision, revocation on a physical phone | Physical | **BLOCKED** |

**What a paired phone may and may not approve** (Host: `http.server.ts` `approve`, `device-authority.server.ts`):

- *Limited device-approved local chat.* A phone may submit a chat and approve **launching that direct task only** when
  `deviceMayLaunch` holds: local, tool-free inference that does not use a hosted model. Anything else is refused with
  `Approval required on Windows Host.`
- *Workstation-only consequential approval.* Mission work, persistent-task actions (`action.approve`/`action.deny`),
  `file.apply`, filesystem writes, desktop launch, shell, and voice sessions cannot be approved from the phone.
  `deviceApprovalRefusal` returns `APPROVAL_ON_HOST` for any unknown, consequential, destructive, sensitive or hard-approval
  action.

Physical Android security qualification is **not claimed** by any source-pattern or JVM test.
