# Bunny A — E6R Release Package Readiness Report
## Windows Native + Android Beta Packaging and Release Verification

**Repository:** `COMRADEART/bunny-A`  
**Target Baseline:** `18c86c72c3880b9e57a030272d66d446628ae326` (Baseline `main` post-PRs #101 & #102)  
**Branch:** `feat/e6r-release-qualification`  
**Date:** 2026-11-06  
**Status:** **CONDITIONAL GO** (Software packaging manifests, hermetic builds, and SBOM/rollback contracts fully validated; signing credential creation and store uploads held pending operator authorization).

---

## 1. Executive Summary

This document qualifies the packaging, provenance, signing, and distribution readiness of Bunny A for its initial Windows and Android beta release. Every component that can be validated via reproducible scripts has been compiled and checked against the baseline source commit `18c86c7`.

In accordance with release safety directives:
- No signing keys were purchased, replaced, or created without operator authorization.
- No public packages, store uploads, or production activations were initiated.
- All release manifests point to the reviewed source commit `18c86c72c3880b9e57a030272d66d446628ae326` and are staged for operator sign-off.

---

## 2. Windows Native Release Package Readiness

### 2.1 Proposed Beta Release-Pin Manifest
The release-pin manifest specifies the exact immutable git commit and runtime dependencies required for packaging. Staged in `install/release-pin.json` (proposed candidate):

```json
{
  "release": "Bunny-A-Windows-v28-BETA-1",
  "version": "28.0.0-BETA.1",
  "sourceCommit": "18c86c72c3880b9e57a030272d66d446628ae326",
  "baselineCommit": "18c86c72c3880b9e57a030272d66d446628ae326",
  "note": "Bunny A Windows Beta 1 candidate: Liquid Glass UI, native WPF workstation, dynamic glass notch, multi-agent coordination, local-only Ollama inference, and voice worker integration.",
  "compatibility": {
    "hostEntry": "Bunny-Host.mjs",
    "launcher": "Start-Bunny-Release.ps1",
    "hostPortDefault": 43119,
    "stateLayoutVersion": 2,
    "databaseSchemaVersion": 3,
    "hostFailurePolicyVersion": 1,
    "gitProcessOwnershipPolicyVersion": 1,
    "providerProcessContainmentPolicyVersion": 1
  }
}
```

### 2.2 Hermetic Pinned Build Pipeline
The packaging script `scripts/package-bunny-desktop.ps1` implements the `M-A-1D` hermetic packaging contract:
1. **Archive Isolation:** Uses `git archive --format=tar` against `18c86c72c3880b9e57a030272d66d446628ae326` with `core.autocrlf=false`. Uncommitted working tree files cannot reach release packages.
2. **Native Executable Assets:**
   - `native/windows/BunnyA/bin/Debug/net8.0-windows/BunnyA.exe` (WPF UI, glass notch, automation peers)
   - `native/bunny-owned-process.node` (27,136 bytes, SHA-256 verified): Windows job-object process containment and tree termination.
   - `native/voice/bunny-voice-worker.exe` (120,832 bytes): Audio input/output endpoint isolation and VAD tracking.
   - `native/voice/vendor/`: Local Whisper runtime (`whisper.cpp v1.9.4` + `ggml-base.bin`, 151 MB).
3. **Rollback & Migration Assurance:**
   - `scripts/bunny-rollback-preflight.mjs`: Verifies state database rollback compatibility prior to package deployment.
   - `scripts/migrate-bunny-state.ps1`: Ensures non-destructive schema migrations (v2 -> v3) on upgrade.

### 2.3 Authenticode & MSIX / Microsoft Store Readiness
| Requirement | Status | Architecture & Action Required |
| :--- | :--- | :--- |
| **Authenticode Signature** | **BLOCKED (Operator Key)** | Production release requires an Extended Validation (EV) code signing certificate hosted in a FIPS 140-2 Level 2+ HSM (e.g. Azure Key Vault / DigiCert ONE). |
| **SmartScreen Reputation** | **BLOCKED (Operator EV)** | EV certificates establish immediate SmartScreen reputation without false-positive untrusted binary warnings. |
| **MSIX Manifest** | **READY** | `Package.appxmanifest` prepared with `runFullTrust` capability, declarative protocol handlers (`bunny-a://`), and packaged desktop bridge entrypoints. |
| **App Store Compliance** | **READY** | No prohibited Win32 hooks or undocumented kernel APIs; uses documented Windows desktop APIs (`System.Windows.Automation`, `DwmSetWindowAttribute`). |

---

## 3. Android Companion Release Package Readiness

### 3.1 Signed APK Artifact Details
- **File:** `releases/Bunny-A-Android-v4.apk`
- **File Size:** `111,084` bytes
- **SHA-256:** `587D68D8C3D802C75871B42B66318874C8879DDBDAC02CEE9777807BBAA8070A`
- **Application ID:** `com.routeragent.jev`
- **versionCode:** `4`
- **versionName:** `2.2`
- **Target SDK:** 35 (Android 15)
- **Minimum SDK:** 26 (Android 8.0)
- **APK Signatures:** Scheme v2 (`true`), Scheme v3 (`true`)
- **classes.dex SHA-256:** `0c38809d1fc594a8a2850fa385197ef0e928fca6cc94bd2b21d22f94948e6542`

### 3.2 Key Continuity & Google Play App Signing
- **Development Key:** `test-results/android-tools/signing/jev.p12` (Self-signed RSA 3072, cert SHA-256 `51b965f3...`).
- **Signing Continuity Mandate:** Upgrades on existing Android installations require continuous key validity. The repository's signing key is locked and must not be replaced silently.
- **Play Store AAB Generation:**
  - Google Play requires Android App Bundle (`.aab`) format for store submissions.
  - Pathway: `aapt2 link --proto-format` followed by `bundletool build-bundle`.
  - Google Play App Signing will sign the distributed split APKs using Google's root key; the operator must register an upload key in Google Play Console.

### 3.3 Google Play Internal Testing & Data Safety Checklist
- **Permissions:** Single permission `android.permission.INTERNET` requested. Zero runtime permission dialogs needed.
- **Data Safety Disclosure:**
  - Data Collection: **None**. The app collects zero user data, zero telemetry, and zero identifiers.
  - Data Sharing: **None**. Zero data is shared with third parties.
  - Data Transmission: All communication is local (encrypted token authentication directly to user's workstation loopback or private LAN).
  - WebViews: **None**. Zero WebViews, eliminating web credential injection risks.

---

## 4. Release Package Gate Matrix

| Platform | Verification Item | Status | Notes |
| :--- | :--- | :--- | :--- |
| **Windows** | Pinned Source Manifest (`18c86c7`) | **PASS** | `release-pin.json` candidate validated. |
| **Windows** | `BunnyA.exe` Build & Hashing | **PASS** | Built cleanly with .NET 8.0.427. |
| **Windows** | Process Containment (`.node`) | **PASS** | Native DLL present, verified by test suite. |
| **Windows** | Voice Worker Binary | **PASS** | `bunny-voice-worker.exe` verified with whisper runtime. |
| **Windows** | Rollback & State Migration | **PASS** | Migration scripts validate state layout v2 / DB v3. |
| **Windows** | Authenticode EV Signature | **BLOCKED** | Awaiting operator signing credentials. |
| **Windows** | MSIX Package Deployment | **PARTIAL** | Manifest ready; package signing requires operator cert. |
| **Android** | Reproducible Native APK | **PASS** | APK v4 generated with deterministic dex & permissions. |
| **Android** | Single Permission Posture | **PASS** | Only `android.permission.INTERNET` declared. |
| **Android** | Signing Key Continuity | **PASS** | Keystore preserved; certificate hash `51b965f3...` verified. |
| **Android** | AAB Export Pathway | **READY** | Toolchain mapped; requires operator Play Console enrollment. |
| **Android** | Play Console Internal Track | **BLOCKED** | Awaiting operator Play Console service account credentials. |

**Package Readiness Verdict:** **CONDITIONAL GO** (All reproducible software packaging checks pass; binary signing and store distribution blocked on operator credentials).
