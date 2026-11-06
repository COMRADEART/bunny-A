# BUNNY A — STORE PRIVACY & DATA SAFETY COMPLIANCE (E6R-R1)

**Date:** 2026-11-06  
**Audited Baseline:** `COMRADEART/bunny-A` at `a9e45d8ce9da25f58f52275bf7dddc3eaa7109da`  
**Distribution Targets:** Google Play Store (Companion App) & Microsoft Store / Direct Authenticode (Windows Workstation)

---

## 1. Source Code & Network Flow Privacy Audit

A granular audit was performed across Android Java sources, Node.js Host services, and native Windows WPF components to map all data flows:

### 1.1 Android Companion App (`android/`):
- **Permissions Declared:** Exactly one permission: `android.permission.INTERNET`.
- **Prohibited Hardware Access:** No camera, no microphone, no location, no contacts, no device storage (`READ_EXTERNAL_STORAGE`), no telephony/IMEI, and no background services.
- **Network Endpoints:**
  - `ServerAddress.java` and `HostExchange.java` restrict outbound HTTP/SSE traffic strictly to the user-entered or QR-scanned Bunny Host socket (e.g., `http://192.168.1.x:43119` or user-configured custom tunnel domain).
  - No connections to analytics services, crash reporting engines (Firebase Crashlytics, Sentry), ad networks, or telemetry trackers.
- **Local Storage:**
  - Ephemeral session credentials stored in Android hardware KeyStore (`KeystoreErasure.java`).
  - Zero prompt text, model answers, or secrets written to persistent disk storage (`ChatTurnTest` check C6: storage holds no message text, answer, or credential). All companion chat history is memory-only and disappears on process termination.

### 1.2 Windows Desktop Host (`src/` & `native/`):
- **Local Loopback:** Host binds locally to `127.0.0.1:43119`. Local communication between `BunnyA.exe` (WPF client) and `Bunny-Host.mjs` is strictly loopback IPC.
- **Local AI Inference:** Default inference executes through Ollama (`http://127.0.0.1:11434`) on the local CPU/GPU. No prompt tokens leave the workstation.
- **Cloud Providers (Opt-in by User):**
  - If and only if the workstation operator explicitly provides third-party cloud API keys (`XAI_API_KEY`, OpenAI, Anthropic), prompt text is dispatched to that provider's HTTPS endpoint.
  - The companion UI indicates whether a model is `Local only` or `Cloud`. Under `Local only`, cloud routes are filtered from selection.
- **System Telemetry Module (`telemetry.server.ts`):**
  - Queries local CPU ticks via `node:os`, memory via `/proc/meminfo` or `os.freemem()`, and GPU metrics via `nvidia-smi` or `Get-CimInstance Win32_VideoController`.
  - Telemetry is rendered purely on the local dashboard. Zero telemetry is broadcast or transmitted externally.

---

## 2. Google Play Data Safety Declaration

Based on the source audit, the official Google Play Data Safety declaration form must be completed as follows:

| Question / Section | Statement | Technical Justification |
| :--- | :--- | :--- |
| **Data Collection** | **No data is collected** | The app developer operates zero collector servers; no telemetry, analytics, or user identifiers are collected. |
| **Data Sharing** | **No data is shared with third parties** | The companion communicates exclusively with the user's private Host. |
| **Data in Transit** | **Data is encrypted in transit** | HTTPS/WSS supported for remote tunnels; local LAN transmission. |
| **Data Deletion** | **Users can request deletion** | Revoking pairing or clearing app storage triggers full Android KeyStore erasure. |
| **Target Audience** | **Ages 13 and older** | Professional developer and technical companion tool. |
| **Account Creation** | **No developer account required** | Pairing uses ephemeral challenge-response cryptographic tokens directly with the Host. |

---

## 3. Microsoft Store Policy & Capability Declaration

For Microsoft Store package ingestion:

### 3.1 Restricted Capability Justification: `runFullTrust`
- **Capability:** `rescap:Capability Name="runFullTrust"` in `AppxManifest.xml`.
- **Justification for App Reviewer:**  
  "Bunny A is a developer workstation productivity application that manages local developer environments, executes local background AI orchestration tasks, inspects developer repository directories via approved connectors, and communicates with local hardware runtimes (whisper.dll, Ollama, local compilers). These operations require Full Trust execution outside the UWP sandbox."

### 3.2 Privacy Policy URL & Publisher Disclosures:
- **Privacy Policy Statement:**  
  "Bunny A does not collect, sell, or transmit personal data or telemetry to the app developers. All tasks, prompts, and code remain on your workstation and your designated local or cloud model providers."
- **Publisher Identity:** Staged as `CN=BunnyA-Development`; must match Microsoft Partner Center Publisher CN upon store submission.

---

## 4. Beta Release Notes & Metadata

### 4.1 Store Listing Metadata:
- **App Title:** Bunny A Workstation
- **Short Description:** Agentic AI workstation companion with Liquid Glass UI and local-first execution.
- **Key Features:**
  - Native Windows desktop notch with dynamic edge docking and focus immunity.
  - Multi-agent coordination with Approval Center cryptographic receipt verification.
  - Zero-telemetry companion app for Android with instant hardware keystore erasure.
  - Local-first inference support via Ollama with explicit Local-Only enforcement.
  - Canonical Indian mythical companion avatars (Gada, Spear, Chakra, Sword).

### 4.2 Beta 1 (v28.0.0-beta.1 / Android v2.2) Release Notes:
```text
Bunny A Beta 1 introduces the complete Windows native workstation and Android companion experience:
• Dynamic Glass Notch: Snaps seamlessly to top, bottom, left, and right screen edges with multi-monitor support.
• Native Approval Center: Consequential agent actions require explicit cryptographic confirmation on your workstation.
• Android Companion: Monitor and prompt your workstation from mobile with zero background tracking and single-permission security.
• Local Inference: Run completely offline with Ollama local model support.
• Full Duplex Voice: Native Whisper worker integration ready for operator-authorized acoustic sessions.
```
