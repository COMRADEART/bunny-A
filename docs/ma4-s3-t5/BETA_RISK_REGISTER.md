# BUNNY A — MA4-S3-T5: BETA RISK REGISTER & MITIGATION MATRIX

**Milestone:** MA4-S3-T5  
**Assessment Target:** Controlled Beta Release Preflight (Windows & Android)  
**Overall Risk Status:** CONTROLLED (Contingent on Physical Qualification Gates)  
**Release Recommendation:** NO-GO for Unrestricted Public Release / GO for Gated Developer Preview  

---

## 1. Executive Summary

This document establishes the preflight risk ledger for the Bunny A consumer experience. While core architectural, functional, security, and packaging regressions have achieved 100% verification, specific environmental and physical device risks require explicit mitigation before broad consumer deployment.

---

## 2. Beta Risk Ledger

| Risk ID | Category | Risk Description | Severity | Likelihood | Impact | Current Mitigation / Safeguard | Residual Risk | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `RSK-01` | **Signing** | Absence of hardware EV Authenticode certificate causes Windows SmartScreen warning during installer execution. | **HIGH** | HIGH | Consumer distrust, installation abandonment. | Self-signed test certificate (`CN=Bunny A Dev`) provided for internal validation; clear sideloading instructions authored in `INSTALLER_AND_UPGRADE_TESTS.md`. Public release blocked pending EV token. | MODERATE | **OPEN (BLOCKER FOR PUBLIC)** |
| `RSK-02` | **Audio** | Acoustic echo and double-talk behavior unverified in noisy physical room environments (acoustic loopback test gate marked BLOCKED). | **HIGH** | MEDIUM | Spurious barge-in triggers, audio feedback squeal in high-reverberation rooms. | Software barge-in (<35ms) and VAD validated in 76 synthetic/driver tests (`scripts/voice-worker.test.mjs`). Energy threshold tuned conservatively. Physical acoustic room test gate strictly preserved as BLOCKED. | MODERATE | **CONTROLLED (PRE-BETA)** |
| `RSK-03` | **Android** | APK candidate verified in build/sign pipeline (`Bunny-A-Android-v3.apk`), but physical USB/Wi-Fi pairing unverified on physical Samsung phone. | **MEDIUM** | MEDIUM | Mobile notifications or WebSocket reconnection edge cases on aggressive vendor battery managers (e.g. OneUI). | Companion protocol verified via mock client; target SDK 35 and background service lifecycle tested against Android 14/15 specs. Physical test gate preserved as BLOCKED. | MODERATE | **CONTROLLED (PRE-BETA)** |
| `RSK-04` | **Hardware** | Consumer workstation lacks dedicated GPU, causing local LLM (`qwen2.5-coder:7b`) to spill to CPU RAM, degrading token generation rate. | **MEDIUM** | HIGH | Slow response times (>10s per thought cycle), high CPU fan noise. | Hardware preflight in Onboarding checks RAM and VRAM. Recommends quantization profiles (`q4_k_m`) or falls back gracefully with UI progress indicators. | LOW | **MITIGATED** |
| `RSK-05` | **Concurrency**| User edits a file in an external IDE (e.g. VS Code) while an agent is waiting for approval to write changes to the same file. | **MEDIUM** | MEDIUM | Conflict or unintentional overwrite of user's manual edits. | Host Action Broker recomputes SHA-256 hash of destination file immediately prior to write. If file changed on disk post-diff generation, write is rejected with `FILE_MODIFIED_CONCURRENTLY`. | LOW | **MITIGATED** |
| `RSK-06` | **Packaging** | Windows Job Object fails to terminate child process if system forcibly logs out or hibernates abruptly. | **LOW** | LOW | Orphaned background node process lingering post-reboot. | Host registers `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` with OS kernel. Cleanup confirmed in shutdown lifecycle tests (<145ms). | NEGLIGIBLE | **MITIGATED** |
| `RSK-07` | **Security** | Malicious workspace repository contains adversarial prompt injection in markdown or comments. | **HIGH** | MEDIUM | Agent tricked into attempting unauthorized network or filesystem access. | Action Broker enforces 17 permission categories at the Host API level; prompt-level directives cannot bypass OS file boundaries or human approval modals. | LOW | **MITIGATED** |
| `RSK-08` | **Android** | Google Play Protect warning on manual APK install due to untrusted debug/ad-hoc developer signing key. | **MEDIUM** | HIGH | Sideload friction for non-technical companion users. | Comprehensive sideloading guide authored; Google Play Store release path documented with AAB and Play App Signing requirements in `ANDROID_SIGNING_AND_PLAY_READINESS.md`. | MODERATE | **CONTROLLED (PRE-BETA)** |

---

## 3. Contingency & Containment Plans

### 3.1 Rollback Preflight
- The Windows installer supports atomic downgrade and rollback. If an upgrade corrupts local state, running the installer with `--rollback` restores the previous stable binary and retains existing user configuration at `%LOCALAPPDATA%\Bunny-A\config.json`.
- SQLite Lotus journals feature write-ahead logging (WAL) and automatic transaction rollback on unexpected crash.

### 3.2 Emergency Kill Switch
- The user can press `Ctrl+Shift+Esc` or click the global **Cancel Task** button in the glass notch at any time.
- The Host dispatches `SIGTERM` followed by immediate Job Object termination, killing all active agent threads and test processes in < 50 ms.

---

## 4. Residual Risk Assessment for Release Decision

| Domain | Unmitigated Risk Level | Post-Mitigation Risk Level | Beta Gate Recommendation |
| :--- | :--- | :--- | :--- |
| **Windows Desktop & Notch UI** | High | **LOW** | **PASS / READY** |
| **Multi-Agent Runtime & Tests** | High | **LOW** | **PASS / READY** |
| **Security & Action Broker** | Critical | **VERY LOW** | **PASS / READY** |
| **Installer & Packaging** | High | **MODERATE** (Unsigned EV) | **INTERNAL BETA ONLY** |
| **Full-Duplex Voice Engine** | High | **MODERATE** (Synthetic OK) | **BLOCKED (PHYSICAL ROOM)** |
| **Android Companion App** | Medium | **MODERATE** (Build OK) | **BLOCKED (PHYSICAL PHONE)** |

**Conclusion:** Bunny A is architecturally sound and verified for controlled developer beta testing. Public release must remain **NO-GO** until physical hardware gates (`T5-G12`, `T5-G13`, `T5-G16`, `T5-G20`) are cleared in an authorized acoustic and device laboratory.
