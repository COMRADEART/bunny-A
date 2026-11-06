# BUNNY A — TRANSPORT SECURITY & DATA SAFETY AUDIT (E6R-R2)

**Repository:** `COMRADEART/bunny-A`  
**Date:** 2026-11-06  
**Auditor:** Bunny A Autonomous Qualification Harness (E6R-R2)  
**Distribution Targets:** Google Play Store (Android Companion) & Microsoft Store / Authenticode Direct (Windows Workstation)

---

## 1. Architectural Audit of Communication Paths

A comprehensive source-code and network transport audit was conducted across all 4 system communication pathways:

```
┌─────────────────────────────────┐                 ┌─────────────────────────────────┐
│        Android Companion        │                 │        Windows Workstation      │
│  (com.routeragent.jev, v4/2.2)  │                 │    (BunnyA.exe + Host Service)  │
└────────────────┬────────────────┘                 └────────────────┬────────────────┘
                 │                                                   │
                 │ 1. HTTPS / TLS 1.3 (Strictly Enforced)            │ 2. Local Loopback IPC
                 │    Via Operator Tunnel / Reverse Proxy            │    127.0.0.1:43119 (HTTP)
                 ▼                                                   ▼
┌─────────────────────────────────┐                 ┌─────────────────────────────────┐
│     Secure Remote Gateway       ├────────────────►│     Bunny Host HTTP Service     │
│   (Cloudflare / Tailscale TLS)  │                 │    (http.server.ts, port 43119) │
└─────────────────────────────────┘                 └───────┬─────────────────┬───────┘
                                                            │                 │
                                    3. Local AI (Default)   │                 │ 4. Cloud AI (Opt-in)
                                       127.0.0.1:11434      │                 │    Provider HTTPS
                                       (Ollama Loopback)    ▼                 ▼    (xAI, OpenAI, Anthropic)
                                                    ┌───────────────┐ ┌───────────────────────┐
                                                    │ Ollama Runtme │ │ External Cloud LLMs   │
                                                    └───────────────┘ └───────────────────────┘
```

### Detailed Path Audit:

1. **Android Companion to Host (Remote & LAN):**
   - **Protocol:** HTTPS / TLS only.
   - **Cleartext HTTP Check:** Evaluated in `scripts/transport-security.test.mjs`. Cleartext HTTP is **strictly impossible** on the Android Companion:
     - `android/app/src/main/AndroidManifest.xml`: Declares `android:usesCleartextTraffic="false"`. Android OS blocks any unencrypted socket connection attempt at the OS network stack.
     - `android/app/src/main/java/com/routeragent/jev/ServerAddress.java`: Enforces `https://` scheme. Any URL starting with `http://`, `ws://`, or plain IP without TLS throws `IllegalArgumentException`.
     - `android/app/src/main/java/com/routeragent/jev/NativeCompanionClient.java`: Casts target connections exclusively to `javax.net.ssl.HttpsURLConnection`.
     - `src/lib/orch/host-bridge.server.ts`: Rejects non-loopback TCP peers attempting to access remote endpoints without the local secure tunnel terminating TLS.
   - **Local LAN Handling:** The companion cannot connect directly to unencrypted LAN HTTP sockets (e.g. `http://192.168.1.x:43119`). To communicate over local LAN, the workstation operator must provide an HTTPS reverse proxy (e.g. Caddy, local TLS cert, or Tailscale HTTPS).

2. **Windows WPF Client to Host Service (Desktop Local IPC):**
   - **Protocol:** HTTP over loopback interface `127.0.0.1:43119`.
   - **Security Perimeter:** Confined entirely within the Windows kernel local IPC boundary. The host binds strictly to `127.0.0.1` and never opens external listening sockets. Zero network wire transmission.

3. **Bunny Host to Local Inference Engine (Ollama):**
   - **Protocol:** HTTP loopback to `127.0.0.1:11434`.
   - **Data Flow:** Prompt tokens and model completions remain 100% on the local CPU/GPU. Zero external transit.
   - **Companion Permission Boundary:** Paired mobile companions are strictly restricted to local tool-free Ollama models via `deviceMayLaunch()`. Cloud models and tools cannot be launched from mobile.

4. **Bunny Host to Cloud Model Providers (Opt-in):**
   - **Protocol:** Direct HTTPS to `api.x.ai`, `api.openai.com`, or `api.anthropic.com`.
   - **Condition:** Occurs if and only if the workstation operator explicitly enters their personal API keys on the workstation. Keys are never transmitted to mobile companions or developer servers.

---

## 2. Remediation of E6R-R1 Declaration Inconsistency

In E6R-R1 `docs/ux/e6r-r1/STORE_PRIVACY_COMPLIANCE.md` (Table §2), the declaration read:
> `Data in Transit: Data is encrypted in transit — HTTPS/WSS supported for remote tunnels; local LAN transmission.`

### Clarification & Correction:
The reference to "local LAN transmission" was ambiguous and risked creating the false impression that the app transmits unencrypted traffic over local LAN.
**Corrected Fact:**
- The companion app permits **ZERO unencrypted traffic**.
- The Android client sets `android:usesCleartextTraffic="false"` and rejects all non-HTTPS URIs.
- All Android-to-Host communication is **100% encrypted in transit using HTTPS/TLS**.
- Plaintext HTTP is completely disabled in the Android client binary and manifest.

---

## 3. Reassessed Google Play Data Safety Declaration

Based on exhaustive source audit and physical data flow mapping:

| Data Safety Question | Answer | Technical Reality & Verification Evidence |
| :--- | :--- | :--- |
| **Does your app collect or share user data?** | **No** | The app developer operates zero data collection servers, zero analytics SDKs, zero ad networks, and zero telemetry infrastructure. |
| **Is all user data encrypted in transit?** | **Yes** | 100% of network traffic from the Android app uses HTTPS/TLS. `usesCleartextTraffic="false"` enforced by Android OS. |
| **Do you provide a way for users to request data deletion?** | **Yes** | Users can tap "Revoke Pairing" or clear app data in Android Settings. Revocation erases Host pairing records, zeroizes the AndroidKeyStore AES-256 key (`KeystoreErasure.delete`), and clears local storage. |
| **Off-device Processing:** | **Self-Hosted Workstation Only** | The app communicates solely with the user's private, self-hosted Windows workstation. Data never passes through developer-owned infrastructure. |
| **Account Creation:** | **No Account Required** | The companion requires no developer account or sign-up. Pairing uses ephemeral, user-approved challenge codes directly with the user's PC. |
| **Stored Credentials:** | **Hardware KeyStore Encrypted** | Session tokens are encrypted with AES-256-GCM via the hardware-backed `AndroidKeyStore`. No plaintext secrets on disk. |
| **Message & Prompt Storage:** | **Memory-Only Ephemeral** | Companion prompt history is retained only in RAM during the active process lifecycle. Zero message history is written to persistent flash storage. |

---

## 4. Microsoft Store Privacy Compliance

For Microsoft Store Windows Workstation submission:
1. **Developer Data Collection:** None. Bunny A collects zero telemetry, zero error reports, and zero personal information.
2. **Local Storage:** State is stored in `%LOCALAPPDATA%\Bunny-A\state\host.sqlite`. State remains exclusively on the user's hard drive.
3. **Full Trust Justification:** `runFullTrust` is required to orchestrate local developer CLI tools, compile C/C++ shims, communicate with local Ollama runtimes, and interact with native Windows desktop APIs (DPI scaling, multi-monitor notch positioning).
