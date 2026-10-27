# Windows Code Signing & Microsoft Store Readiness Preflight

**Product:** Bunny A by LOKAM  
**Milestone:** MA4-S3-T5  
**Document:** Windows Distribution Channels, Code Signing Strategy & Store Prerequisites  
**Classification:** Release Engineering & Compliance Specification  

---

## 1. Executive Summary & Distribution Strategy

A critical prerequisite for transitioning Bunny A from internal engineering development into a consumer-facing product is evaluating the distribution, signing, and store certification requirements for Windows 11.

Misunderstandings often arise regarding code signing—specifically the mistaken belief that an expensive Extended Validation (EV) certificate is universally required for any Windows application. 

This document provides a rigorous technical analysis of the three primary distribution channels for Windows:
1. **Microsoft Store Distribution (MSIX / Centennial)**
2. **Direct Web Download (Authenticode Signed)**
3. **Controlled Developer / Internal Beta Sideload**

In accordance with milestone rules:
- **No Private Keys in Repository:** Private signing keys are strictly forbidden from being committed or logged.
- **Controlled Beta Candidate:** Artifacts built in T5 are explicitly labeled as non-public candidate builds.
- **Zero Store Submissions:** Bunny A is **not** submitted to the Microsoft Store during T5.

---

## 2. Comparison of Windows Distribution Channels

```
+--------------------------+-----------------------+------------------------+-------------------------+
| Channel                  | Package Format        | Signing Authority      | SmartScreen / Trust     |
+--------------------------+-----------------------+------------------------+-------------------------+
| Microsoft Store          | MSIX / AppX           | Microsoft Store CA     | Immediate Trust         |
| (Recommended Consumer)   |                       | (Store signs binary)   | Zero SmartScreen alerts |
+--------------------------+-----------------------+------------------------+-------------------------+
| Direct Web Download (EV) | NSIS / MSI / Zip      | Commercial CA (EV)     | Immediate Trust         |
| (Enterprise / Pro)       |                       | Hardware token required| Zero SmartScreen alerts |
+--------------------------+-----------------------+------------------------+-------------------------+
| Direct Web Download (OV) | NSIS / MSI / Zip      | Commercial CA (Std OV) | Trust earned over time  |
| (Independent Developer)  |                       | Soft certificate       | SmartScreen warning     |
|                          |                       |                        | until download volume   |
+--------------------------+-----------------------+------------------------+-------------------------+
| Controlled Developer Beta| Directory / Self-Sign | Test Root Certificate  | User must trust test CA |
| (Current T5 Target)      |                       |                        | or enable developer mode|
+--------------------------+-----------------------+------------------------+-------------------------+
```

---

## 3. Microsoft Store Submission Prerequisites

The Microsoft Store represents the preferred path for consumer adoption because it eliminates user-facing SmartScreen warnings, handles automatic background updates safely, and signs the package using Microsoft's trusted root authority without requiring a separate commercial EV certificate.

### 3.1 Store Technical Prerequisites
1. **Packaging Format:** The existing Windows package can be packaged into an MSIX container using the Desktop App Converter (`MakeAppx.exe` / `msix-packaging-tool`).
2. **Manifest Declarations (`Package.appxmanifest`):**
   ```xml
   <Package xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10"
            xmlns:uap="http://schemas.microsoft.com/appx/manifest/uap/windows10"
            xmlns:rescap="http://schemas.microsoft.com/appx/manifest/foundation/windows10/restrictedcapabilities">
     <Identity Name="LOKAM.BunnyA" Publisher="CN=..." Version="2.1.0.0" ProcessorArchitecture="x64" />
     <Properties>
       <DisplayName>Bunny A</DisplayName>
       <PublisherDisplayName>LOKAM</PublisherDisplayName>
       <Logo>assets\store-logo.png</Logo>
     </Properties>
     <Capabilities>
       <rescap:Capability Name="runFullTrust" />
     </Capabilities>
   </Package>
   ```
3. **Full Trust Capability (`runFullTrust`):** Required because Bunny A interacts with local hardware, manages child processes (Node test runner, voice worker), and communicates over loopback IPC.
4. **Partner Center Account:** Requires an active Microsoft Partner Center Developer Account ($19 one-time registration for individuals; $99 for companies).
5. **Privacy Policy & Support URLs:** Mandatory links describing local data retention, zero cloud collection, and contact endpoints.

---

## 4. Direct Web Distribution & Authenticode Analysis

If distributed directly outside the Microsoft Store:
- **Standard (OV) Certificate:** Cost ~$200–$300/year. When a new binary is signed, Windows SmartScreen will display an amber warning (*"Windows protected your PC — Microsoft Defender SmartScreen prevented an unrecognized app from starting"*) until hundreds of users have downloaded and run the software without malware reports, establishing reputation.
- **Extended Validation (EV) Certificate:** Cost ~$400–$700/year. Mandates hardware cryptographic token (YubiKey / HSM) with identity vetting. Provides immediate SmartScreen reputation without warning dialogs.
- **Current Development Environment:** Hardware HSM token is not physically present on the workstation. Therefore, production EV signing is marked **`BLOCKED (EV_TOKEN_ABSENT)`**.

---

## 5. Current T5 Candidate Packaging

For milestone T5, packages are produced in `releases/` under the controlled beta designation:
- **Package Manifest:** Sealed with internal SHA-256 manifest in `release-manifest.json`.
- **Integrity Verification:** Verified at startup by `Start-Bunny-Release.ps1`.
- **Classification:** **Internal Developer Candidate / Non-Public Beta**.
- **Public Store Distribution:** Strictly **NO-GO** until Partner Center ingestion and independent release sign-off.

---

## 6. Verification Summary (Gate T5-G19)

- **`T5-G19` (Signing and store prerequisites documented and qualified):** **PASS**.
- Store prerequisites, MSIX container architecture, SmartScreen dynamics, and EV token requirements are thoroughly evaluated and documented without exposing private credentials.
