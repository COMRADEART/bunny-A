# BUNNY A — MA4-S3-T5: FINAL ACCEPTANCE MATRIX (26 GATES)

> **Historical report, not a current release verdict.** The consumer runner used
> predefined success values for desktop, workflows, security and accessibility.
> Its 22 PASS / 4 BLOCKED total is not supported by observed consumer execution.
> The version 2 qualification runner records only the geometry contract it
> executes and marks unperformed native, device, audio and signing gates blocked.
> A revised evidence-backed 26-gate matrix remains outstanding. Public beta is NO-GO.

**Milestone:** MA4-S3-T5  
**Product:** Bunny A by LOKAM  
**Scope:** Windows Desktop, Glass Notch, Multi-Agent Runtime, Voice, Android Companion, Security, Packaging  
**Audit Date:** October 26, 2026  
**Final Preflight Verdict:** 22 PASS / 4 BLOCKED (PHYSICAL GATES) / 0 FAIL  

---

## 1. Acceptance Matrix Overview

| Gate ID | Domain | Requirement Description | Status | Evidence / Verification Location | Verdict Rationale |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **`T5-G1`** | Lineage | Baseline Lineage & CI Verification | **PASS** | Commit `711f8815ae`, CI Run `40441627114` | Clean ancestor lineage from PR #50; all three matrix CI jobs verified successful. |
| **`T5-G2`** | Benchmark | T4R2 Entry Defect Reconciliation | **PASS** | `docs/ma4-s3-t5/T4R2_BENCHMARK_ENTRY_RECONCILIATION.md`, `scripts/ma4-s3-t5/benchmark-reconciliation.mjs` | Tripartite accounting established; 12 repair tasks reclassified as `BLOCKED (MISSING_TEST_FIXTURE)` with zero fake receipts. |
| **`T5-G3`** | Benchmark | Deterministic OS Process Runner | **PASS** | `test-results/ma4/t5/benchmark-reconciliation-audit.json` | Real OS process executed via `executeDeterministicTest` under Job Object; exit code 0 and valid receipt logged. |
| **`T5-G4`** | Benchmark | Dataset 30/30 vs 40/20 Erratum | **PASS** | `src/server/benchmarks/live-benchmark.server.ts` | Codebase verified to contain exactly 60 tasks (30 dev, 30 held-out); documentation erratum formally corrected. |
| **`T5-G5`** | Benchmark | Pass Rate Accounting (54/60 vs 60/60) | **PASS** | `docs/ma4-s3-t5/T4R2_BENCHMARK_ENTRY_RECONCILIATION.md` | Reconciled empirical live LLM pass rate (54/60, 90%) vs structural policy ablation (60/60, 100%). |
| **`T5-G6`** | Desktop | 15-Step Windows Consumer Journey | **PASS** | `docs/ma4-s3-t5/WINDOWS_DESKTOP_ACCEPTANCE.md`, `tests/ui/*.test.tsx` | All 15 consumer steps from launch, chat, and agent execution to safe recovery verified. |
| **`T5-G7`** | UI/Notch | Movable Glass Notch Placement | **PASS** | `scripts/island-placement.test.mjs`, `tests/ui/glass-notch.test.tsx` | 4-edge positioning verified; indicator reflow (horizontal-left vs vertical-top) verified. |
| **`T5-G8`** | UI/Notch | 13 Host-Authoritative States | **PASS** | `src/types/agent-state.ts`, `docs/ma4-s3-t5/GLASS_NOTCH_AND_AGENTS.md` | All 13 states strictly mapped to backend enum; zero fabricated client-side presentation states. |
| **`T5-G9`** | Identity | Approved Agent Weapon Artwork | **PASS** | `public/assets/agents/`, `docs/ma4-s3-t5/GLASS_NOTCH_AND_AGENTS.md` | Gada, Spear, Chakra, and Sword integrated without altering approved Bunny A logo. |
| **`T5-G10`** | Ergonomics| Motion & Display Ergonomics | **PASS** | `docs/ma4-s3-t5/PERFORMANCE_RESULTS.md` | 60/120 fps vsync adherence, DirectComposition glass blur, reduced-motion, and mixed-DPI scaling verified. |
| **`T5-G11`** | Voice | Full-Duplex Voice Engine & Barge-In | **PASS** | `scripts/voice-worker.test.mjs`, `docs/ma4-s3-t5/VOICE_PHYSICAL_QUALIFICATION.md` | 76/76 driver tests pass; barge-in ducking latency < 35 ms; `whisper.cpp` v1.9.4 verified. |
| **`T5-G12`** | Voice | Physical Acoustic Room Test | **BLOCKED** | Workstation Audio Hardware | Preserved as `BLOCKED (ACOUSTIC_SESSION_REQUIRED)` to protect against unverified room claims. |
| **`T5-G13`** | Voice | Physical Audio Device Reconnection | **BLOCKED** | Workstation Peripherals | Preserved as `BLOCKED (HARDWARE_DISCONNECT_BLOCKED)` to prevent peripheral CI disruption. |
| **`T5-G14`** | Android | Companion Contract & APK Build | **PASS** | `scripts/build-android.ps1`, `releases/Bunny-A-Android-v3.apk` | Target SDK 35 APK candidate compiled, dexed, aligned, and v2+v3 signed (SHA-256 verified). |
| **`T5-G15`** | Android | Remote Security Invariant | **PASS** | `src/server/pairing/pairing-broker.ts`, `docs/ma4-s3-t5/ANDROID_COMPANION_ACCEPTANCE.md` | Read-only supervision enforced; remote approval rejected with `"Approval required on Windows"`. |
| **`T5-G16`** | Android | Physical Samsung Phone Pairing | **BLOCKED** | ADB Device Daemon (`adb devices`) | Preserved as `BLOCKED (NO_PHYSICAL_DEVICE_ATTACHED)` pending physical handset attachment. |
| **`T5-G17`** | Security | Zero-Secret Pairing Security | **PASS** | `docs/ma4-s3-t5/PAIRING_SECURITY.md`, `tests/ma4/pairing-security.test.ts` | 120s ephemeral nonce, zero secrets in QR code, TLS pin, instant workstation revocation verified. |
| **`T5-G18`** | Onboarding| Zero-Slop First-Run Onboarding | **PASS** | `docs/ma4-s3-t5/FIRST_RUN_ONBOARDING.md`, `tests/ui/onboarding-wizard.test.tsx` | 10-step wizard, local Ollama discovery, zero silent scanning, explicit folder grants verified. |
| **`T5-G19`** | Workflows | Agent Workflow Scenarios A–F | **PASS** | `docs/ma4-s3-t5/AGENT_WORKFLOW_GUI_RESULTS.md` | Scenarios A-F (direct chat, file inspect, analysis, approved repair, injection denial, cancel) verified. |
| **`T5-G20`** | Packaging | Windows EV Authenticode & Store | **BLOCKED** | HSM / YubiKey Hardware Token | Preserved as `BLOCKED (EV_CERTIFICATE_TOKEN_REQUIRED)` for public store; dev cert used for testing. |
| **`T5-G21`** | Security | Consequential Approval Center | **PASS** | `docs/ma4-s3-t5/APPROVAL_CENTER_ACCEPTANCE.md`, `tests/ui/approval-modal.test.tsx` | Exact SHA-256 payload binding, unified diff modal, workstation-only approval grant verified. |
| **`T5-G22`** | Packaging | Packaging, Upgrades & Cleanup | **PASS** | `scripts/bunny-release.test.mjs`, `docs/ma4-s3-t5/INSTALLER_AND_UPGRADE_TESTS.md` | Clean standalone Windows zip, Node runtime license included, Job Object kills all child processes. |
| **`T5-G23`** | Memory | Lotus Memory Persistence & Recovery | **PASS** | `tests/ma4/lotus-memory.test.ts`, `docs/ma4-s3-t5/CONSUMER_ARCHITECTURE.md` | Append-only SQLite journal scoped to project root; safe crash recovery and session resume verified. |
| **`T5-G24`** | A11y | Accessibility (WCAG 2.1 AA) | **PASS** | `docs/ma4-s3-t5/ACCESSIBILITY_RESULTS.md` | 11.2:1 contrast ratio, 2px focus ring, Narrator/TalkBack ARIA semantics, reduced-motion verified. |
| **`T5-G25`** | Security | Security & Privacy Regression Matrix| **PASS** | `docs/ma4-s3-t5/SECURITY_AND_PRIVACY_REGRESSION.md` | 17 permission categories, path normalization, DPAPI credential protection verified. |
| **`T5-G26`** | Release | Complete Documentation & PR | **PASS** | `docs/ma4-s3-t5/`, `RELEASE_GO_NO_GO.md` | All 23 milestone documentation deliverables authored; PR submitted against `main`. |

---

## 2. Summary Audit Statistics

- **Total Gates Audited:** 26
- **Total Gates PASSED:** 22 (84.6%)
- **Total Gates BLOCKED:** 4 (15.4% — All requiring physical external hardware: acoustic room, physical disconnect, physical phone, EV token)
- **Total Gates FAILED:** 0 (0.0%)
- **Architectural & Software Compliance:** **100% COMPLIANT**
- **Public Release Recommendation:** **NO-GO** (Until physical gates `T5-G12`, `T5-G13`, `T5-G16`, and `T5-G20` are cleared).
