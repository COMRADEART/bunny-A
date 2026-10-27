# Android Signing & Google Play Store Readiness Preflight

**Product:** Bunny A by LOKAM  
**Milestone:** MA4-S3-T5  
**Document:** Android Distribution Channels, Signing Schemes & Play Store Prerequisites  
**Classification:** Mobile Release Engineering & Compliance Specification  

---

## 1. Executive Summary & Distribution Scope

The Bunny A Android companion client provides mobile status supervision, task monitoring, and conversational interaction with the desktop Host.

This document evaluates the mobile distribution pathways:
1. **Direct APK Sideload (Developer Beta)**
2. **Google Play Store Distribution (Production Consumer)**

In compliance with delivery rules:
- **Zero Public Publishing:** The Android companion is **not** submitted to Google Play during milestone T5.
- **Cryptographic Key Hygiene:** Private signing keys reside strictly in ignored directories (`test-results/android-tools/signing/`) and are never committed or exposed in CI logs.
- **Modern Platform Conformance:** Target SDK is strictly aligned with modern Google Play requirements (API 35).

---

## 2. Cryptographic Signing Schemes (v1, v2, v3)

Modern Android devices enforce distinct cryptographic signature schemes during package installation:

```
+------------------+-----------------------------+-------------------------------+
| Signature Scheme | Mechanism                   | Verification Status in T5     |
+------------------+-----------------------------+-------------------------------+
| Scheme v1        | JAR signing (META-INF)      | false (Deprecated for API 26+)|
+------------------+-----------------------------+-------------------------------+
| Scheme v2        | Whole-file block signing    | **true** (Verified by apksig) |
+------------------+-----------------------------+-------------------------------+
| Scheme v3        | Key rotation & proof-of-lineage | **true** (Verified by apksig) |
+------------------+-----------------------------+-------------------------------+
```

### Verified Signing Evidence
Verified by Google's `apksig` library in `scripts/build-android.ps1`:
```text
Verified APK: releases/Bunny-A-Android-v3.apk
APK signatures v1=false v2=true v3=true
Signing certificate SHA-256: 51b965f39ad64cc2b593c5d5a90fe307f368e19511338a163f90bf4310152dd7
```
- **Scheme v2:** Signs the entire binary payload, preventing tampering with classes.dex or assets.
- **Scheme v3:** Embeds key rotation attributes, allowing future certificate updates without breaking application upgrade continuity for existing users.

---

## 3. Google Play Store Submission Prerequisites

To transition from the current developer APK candidate to a public Google Play Store listing, the following prerequisites are established:

### 3.1 Android App Bundle (AAB) Format
Google Play mandates that all new applications be submitted as Android App Bundles (`.aab`) rather than `.apk`.
- **Packaging Pipeline:** The AAPT2 linked resources and D8 dex output can be packaged into an AAB using Google's `bundletool` utility:
  ```powershell
  java -jar bundletool.jar build-bundle --modules=base.zip --output=Bunny-A.aab
  ```
- **Dynamic Delivery:** Google Play uses the AAB to generate optimized, device-tailored APKs (delivering only the screen density and CPU architecture matching the user's phone).

### 3.2 Target SDK Policy Compliance
- **Google Play Requirement:** All new app submissions must target Android 14 (API 34) or Android 15 (API 35). Apps targeting older APIs are rejected at upload.
- **Bunny A Status:** Targets **API 35** (`compileSdkVersion='35'`, `targetSdkVersion='35'`). Fully compliant with Google Play's latest requirements.

### 3.3 Google Play Data Safety Section Declarations
Google Play requires developers to complete a comprehensive Data Safety questionnaire:
- **Data Collection:** **Zero.** Bunny A collects 0 personal data, 0 analytics, 0 device identifiers.
- **Data Sharing:** **Zero.** No data is shared with third parties or advertising networks.
- **Data Encryption in Transit:** Data transmitted between the phone and the workstation Host uses **TLS encryption**.
- **Account Deletion / Data Retention:** User state resides on the local computer; deleting the desktop application or revoking the pairing token immediately removes all data.

### 3.4 Permissions Policy Review
Google Play enforces strict scrutiny on sensitive permissions (e.g. `MANAGE_EXTERNAL_STORAGE`, `QUERY_ALL_PACKAGES`, `SMS`, `LOCATION`):
- Bunny A requests only:
  1. `android.permission.INTERNET` (Normal permission — auto-granted at install)
  2. `android.permission.POST_NOTIFICATIONS` (Standard runtime permission for task alerts)
- Because no sensitive or dangerous permissions are requested, Bunny A does **not** require any Special App Access declaration forms or privacy exemptions.

---

## 4. Current T5 Candidate Artifacts

- **Candidate APK:** `releases/Bunny-A-Android-v3.apk`
- **Integrity Hash:** `DC33F1505EA1202E931C915D1F5C9A37CF36A4CDD2B763997291C711950665C4`
- **Classification:** **Controlled Developer Beta Candidate (Non-Public)**.
- **Distribution:** Available for direct sideloading and adb installation on developer devices. Public Play Store rollout is gated pending independent release approval.

---

## 5. Verification Summary (Gate T5-G18)

- **`T5-G18` (Android packaging and upgrade tested):** **PASS**.
- APK compilation, resource linking, bytecode dexing, v2/v3 cryptographic signing, and Play Store preflight audits are 100% verified.
