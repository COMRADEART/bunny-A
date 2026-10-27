# Companion Pairing Security & Cryptographic Protocol

**Product:** Bunny A by LOKAM  
**Milestone:** MA4-S3-T5  
**Document:** Cryptographic Pairing Protocol & Threat Model  
**Classification:** Information Security & Cryptographic Architecture  

---

## 1. Executive Summary

Pairing a mobile device to a workstation AI assistant introduces significant security risks if not architected with rigorous fail-closed invariants. A compromised or stolen mobile device, an intercepted QR code, or an untrusted local network must never allow unauthorized access to the host computer's files, shell, or credentials.

Bunny A enforces a zero-trust mobile companion architecture:
- **Zero Secrets in QR / URLs:** Pairing codes contain only ephemeral, single-use nonces.
- **Mutual Ephemeral Authentication:** Key exchange derives unique session tokens.
- **Fail-Closed Privilege Separation:** Paired sessions possess read-only supervisory access; consequential operations remain strictly gated on the Windows desktop.
- **Instant Revocation:** A single click on Windows terminates mobile sessions immediately.

---

## 2. Cryptographic Pairing Protocol Sequence

```
   Mobile Companion (Android)                      Windows Workstation (Host)
              |                                                 |
              |                                     [Generate Ephemeral Nonce]
              |                                     nonce = crypto.randomUUID()
              |                                     expiresAt = now + 120s
              |                                     Render QR: { origin, nonce }
              |                                                 |
              |----------- 1. Scan QR Code -------------------->|
              |                                                 |
              |                                     [Verify Nonce Freshness]
              |                                     If expired/used -> REJECT
              |                                                 |
              |<---------- 2. Challenge & Server Cert ----------|
              |                                                 |
   [Verify TLS Cert Pin]                                        |
   Generate clientKeyShare                                      |
              |                                                 |
              |----------- 3. Client Key Exchange ------------->|
              |                                                 |
              |                                     [Derive Session Token]
              |                                     K_session = HMAC(nonce, ...)
              |                                     Store in SQLite task store
              |                                                 |
              |<---------- 4. Encrypted Session Token ----------|
              |                                                 |
   [Store Token in Android EncryptedSharedPreferences]          |
              |                                                 |
              |==== 5. Authenticated SSE Status Stream (TLS) ===|
              |    (Read-only telemetry, agent states, etc.)    |
              |                                                 |
```

### Protocol Steps & Invariants
1. **Nonce Generation:** The Windows Host generates an ephemeral, single-use 128-bit enrollment nonce (`nonce = randomUUID()`) with a 120-second time-to-live.
2. **Zero Secret Exposure:** The QR code displays only the server HTTPS origin and the enrollment nonce. No long-lived API keys, session tokens, or credentials are encoded in the QR.
3. **Nonce Invalidation:** The nonce is burned immediately upon its first exchange attempt. Replaying the QR payload fails closed.
4. **Session Token Issuance:** The Host generates a cryptographically random 256-bit session token, stores the device metadata in SQLite, and transmits the token over TLS.
5. **Secure Storage:** The Android client persists the token solely in private app preferences (`EncryptedSharedPreferences`). No plaintext tokens are written to external storage or logcat.

---

## 3. Remote Capabilities Boundary & Access Control Matrix

The Host Action Broker enforces strict role-based access control based on caller origin:

| Operation Category | Workstation Client | Paired Android Companion | Enforcement Mechanism |
| :--- | :---: | :---: | :--- |
| **View Active Agent State** | ALLOWED | **ALLOWED** | Broadcast via SSE event stream |
| **Inspect Task Status & Progress** | ALLOWED | **ALLOWED** | Redacted task snapshot |
| **Read Verification Log / Output** | ALLOWED | **ALLOWED** | Standard output digest view |
| **Receive Task Completion Alert**| ALLOWED | **ALLOWED** | Android system notification |
| **Submit New Code Prompt** | ALLOWED | **ALLOWED** | Enters `QUEUED` state |
| **Approve File Modification** | **ALLOWED** | **STRICTLY FORBIDDEN** | Broker requires `clientType === "workstation"` |
| **Approve Shell Execution** | **ALLOWED** | **STRICTLY FORBIDDEN** | Broker requires `clientType === "workstation"` |
| **Modify Project Root Grants** | **ALLOWED** | **STRICTLY FORBIDDEN** | Preflight denies remote path mutation |
| **Access Host Database / State**| **ALLOWED** | **STRICTLY FORBIDDEN** | Local SQLite access only |

> [!CAUTION]
> **Remote Approval Invariant:** If a mobile companion attempts to issue an approval decision for a consequential operation, the Host Action Broker drops the request, logs a security warning (`WARN: Unauthorized remote approval attempt from session <id>`), and leaves the task awaiting decision on Windows.

---

## 4. Session Revocation & Disconnect Resilience

### 4.1 Instant Workstation Revocation
The user maintains absolute control over connected devices via the Windows Island Settings panel:
1. Clicking **"Revoke Android Device"** immediately deletes the device record from the Host SQLite database.
2. All active SSE connections associated with the session are terminated.
3. Any subsequent request presenting the revoked token receives HTTP `401 Unauthorized`.
4. The Android client discards local state and returns to the initial QR scan screen.

### 4.2 Network Interruption & Reconnection
- If the mobile device loses Wi-Fi connectivity, the client enters exponential backoff reconnection.
- Reconnection presents the existing session token. The Host verifies token validity, checks the last delivered event sequence ID, and replays only missing event deltas.
- If the Host restarted during disconnection, the client receives a state epoch change signal, discards stale local cache, and resynchronizes with canonical truth.

---

## 5. Security Threat Model & Defense Matrix

| Attack Vector | Threat Scenario | Observed System Defense |
| :--- | :--- | :--- |
| **QR Interception** | Attacker photographs pairing QR on screen | Nonce expires in 120s; single-use burn prevents reuse; TLS pin prevents MitM. |
| **Remote Code Exec** | Stolen phone attempts to run commands on PC | Remote approval forbidden; phone displays *"Approval required on Windows"*. |
| **Token Theft** | Attacker extracts token from phone backup | Android EncryptedSharedPreferences; token bound to device fingerprint; revokable from PC. |
| **Replay Attack** | Attacker replays captured network packets | TLS 1.3 encryption with forward secrecy; nonces prevent replay. |
| **Cross-Device Mutation**| Attacker attempts to change project folders | Project configuration restricted exclusively to local workstation IPC. |

---

## 6. Verification Summary (Gate T5-G15)

- **`T5-G15` (Secure Android pairing qualified):** **PASS**.
- Automated security suites (`src/lib/bunny-host/remote-device.test.ts`, `src/lib/bunny-host/remote-remediation.test.ts`) verify all pairing invariants, nonce burn rules, and remote approval rejections.
