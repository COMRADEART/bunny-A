# BUNNY A — WINDOWS MSIX IDENTITY & INSTALLATION INTEGRITY (E6R-R2)

**Repository:** `COMRADEART/bunny-A`  
**Date:** 2026-11-06  
**Auditor:** Bunny A Autonomous Qualification Harness (E6R-R2)  
**Host Environment:** Windows 11 Enterprise (x64), .NET 8.0.427 SDK, Node.js v26.13.0, Windows Kits 10 `makeappx.exe`

---

## 1. Identity & Version Reconciliation

During independent review of E6R-R1 PR #104, a version discrepancy was identified between the candidate release pin and the packaged MSIX manifest:
- **Candidate Release Pin (`install/release-pin.candidate.json`):**
  - Release Identifier: `Bunny-A-Windows-v28-BETA-1`
  - Semantic Version: `28.0.0-beta.1`
- **E6R-R1 MSIX Manifest (`native/windows/BunnyA/AppxManifest.xml`):**
  - Declared Version: `0.5.1.0` (internal project revision from `BunnyA.csproj`).

### Reconciled Mapping:
Windows MSIX packaging requires a four-part integer format (`Major.Minor.Build.Revision`).
The version in `AppxManifest.xml` has been reconciled to **`28.0.0.0`**, creating an exact, unambiguous 1:1 mapping with the `v28.0.0-beta.1` release candidate pin.

### Microsoft Partner Center Publisher Requirements:
- **Package Identity Name:** `BunnyA.Workstation`
- **Staged Development Identity:** `CN=BunnyA-Development` (used for development builds and local sideloading tests).
- **Store Submission Identity:** Upon operator submission to Microsoft Partner Center, the `Publisher` attribute in `AppxManifest.xml` must be updated to the operator's registered Partner Center Publisher CN (e.g., `CN=XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX`), and `PublisherDisplayName` to the registered legal identity.
- Automated parameterization has been added to `scripts/package-bunny-msix.ps1` via `-Version` and `-Publisher` to support dynamic injection during release packaging without manual XML edits.

---

## 2. Clean-Environment Installation Test

To eliminate unverified deployment claims, an automated clean-environment installation test was designed and executed via `scripts/clean-installation.test.mjs`. The test creates a pristine sandbox directory in `%TEMP%` and validates every critical runtime component:

| Subsystem / Component | Verification Method | Outcome | Detailed Evidence |
| :--- | :--- | :--- | :--- |
| **1. WPF Client (`BunnyA.exe`)** | Pinned .NET 8.0.427 publish to isolated directory | **PASS** | Valid PE header (`MZ` magic bytes 0x4D 0x5A), 152,064 bytes, SHA-256: `eeab38a1ee17cc50b946dac5ce3c1cae95281f7ed7fe89bb21541410dde08f80`. |
| **2. Node Runtime** | Execute pinned standalone `runtime/node.exe` | **PASS** | Version confirmed: `v26.13.0` (Node 26 hermetic runtime). |
| **3. Voice Worker & Whisper** | Validate binary and linked DLL hashes against pinned JSON | **PASS** | `whisper.dll` SHA-256: `b7bb4ba9...` matches pin; `ggml.dll` SHA-256: `c6e88687...` matches pin. |
| **4. Bunny Host Startup** | Spawn `scripts/bunny-host.mjs` on isolated port 43195 | **PASS** | Host listens on `127.0.0.1:43195`, answers `GET /health` with HTTP 200 OK (`app: "Bunny-A"`, `operationalState: "healthy"`). |
| **5. Process Teardown** | Send SIGTERM and verify complete process cleanup | **PASS** | Host releases listening port, stops workers, and terminates cleanly within 500 ms. Sandbox deleted. |

Test execution confirmed in 3.3 seconds with 0 errors (`node --test scripts/clean-installation.test.mjs`).

---

## 3. Separation of Microsoft Store vs. Direct Authenticode Signing

A critical correction to E6R-R1 documentation concerns code-signing certificate requirements. E6R-R1 mistakenly indicated that an EV (Extended Validation) hardware token certificate was strictly required.

### Corrected Signing Architecture:

```
                                ┌───────────────────────────────┐
                                │   BunnyA.Workstation MSIX     │
                                └──────────────┬────────────────┘
                                               │
                       ┌───────────────────────┴───────────────────────┐
                       ▼                                               ▼
         ┌───────────────────────────┐                   ┌───────────────────────────┐
         │   Microsoft Store Path    │                   │ Direct Web Download Path  │
         └─────────────┬─────────────┘                   └─────────────┬─────────────┘
                       │                                               │
       • Upload unsigned/test-signed                   • Valid Alternatives to EV:
       • Microsoft signs automatically with              1. Standard Authenticode (OV)
         trusted Microsoft root CA                       2. Azure Trusted Signing (Cloud HSM)
       • Zero certificate purchase required              3. Sideloading / Enterprise CA
       • Seamless auto-updates                         • EV token is NOT mandatory
```

### Channel Comparison Matrix:

| Requirement | Microsoft Store Pathway | Direct Download (Authenticode) Pathway |
| :--- | :--- | :--- |
| **Ingestion Artifact** | `BunnyA.Workstation-28.0.0.0.msix` | `Bunny-A-Windows-v28-BETA-1-TEST.zip` or `.msix` |
| **Signing Mechanism** | Microsoft Store CA ingestion re-signing | RFC 3161 timestamped Authenticode signature |
| **EV Certificate Needed?** | **NO** (Store signs automatically) | **NO** (Standard OV or Azure Trusted Signing supported) |
| **Windows SmartScreen** | Instant reputation via Store trust root | Established via Azure Trusted Signing or CA reputation |
| **Operator Action** | Submit package to Microsoft Partner Center | Sign artifact using Azure Trusted Signing or OV certificate |
