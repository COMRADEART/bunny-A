# BUNNY A — ANDROID APP BUNDLE (AAB) SIGNING INTEGRITY (E6R-R2)

**Repository:** `COMRADEART/bunny-A`  
**Date:** 2026-11-06  
**Auditor:** Bunny A Autonomous Qualification Harness (E6R-R2)  
**Package Identity:** `com.routeragent.jev`  
**Version Code:** `4` | **Version Name:** `2.2`  

---

## 1. Executive Summary & Verification Findings

During independent review of E6R-R1 PR #104, a critical signing gap was identified in the Android packaging pipeline:
1. `scripts/build-android-aab.ps1` used `bundletool build-bundle` to produce `releases/Bunny-A-Android-v4.aab`.
2. While `build-android-aab.ps1` verified that `bundletool build-apks` could generate and sign *split APKs* for testing, the generated `.aab` archive itself was **unsigned** (`no manifest. jar is unsigned`).
3. Google Play Console and secure enterprise stores require the uploaded `.aab` file to be signed by the developer's upload key using standard JAR signing (`jarsigner`).

---

## 2. Separate Release-Signing Architecture (`scripts/sign-android-aab.ps1`)

To remediate this compliance risk while strictly enforcing credential security boundaries:
- The base build script (`scripts/build-android-aab.ps1`) produces a reproducible, byte-for-byte deterministic unsigned AAB artifact.
- A dedicated, decoupled release-signing stage has been implemented in `scripts/sign-android-aab.ps1`.

### Non-Negotiable Credential Security Invariants:
1. **Explicit Owner Approval Required:** `scripts/sign-android-aab.ps1` requires an explicitly provided keystore path (`-KeystorePath`) and alias (`-KeyAlias`), or the explicit `-AllowTestKey` switch for local development staging.
2. **Refusal Gate:** Running `scripts/sign-android-aab.ps1` without an owner-approved key halts with exit code 1:
   ```text
   RELEASE-SIGNING GATE REFUSAL:
   No owner-approved upload key provided.
   Release signing requires an explicitly owner-approved upload key (-KeystorePath, -KeyAlias, etc.)
   or the explicit -AllowTestKey switch for local staging/development validation.
   Production signing credentials must NEVER be created, rotated, or exposed without explicit owner approval.
   ```
3. **No Credential Fabrication:** Production keys, cloud upload certificates, and Play Store credentials are never fabricated or rotated by automated tooling.

---

## 3. Signing Toolchain & Multi-Stage Validation

The signing pipeline validates the artifact across three independent tooling layers:

| Layer | Tool | Command / Check | Result |
| :--- | :--- | :--- | :--- |
| **1. Archive Signing** | JDK 21 `jarsigner.exe` | `-sigalg SHA256withRSA -digestalg SHA-256 -keystore <keystore>` | `jar signed.` |
| **2. Signature Audit** | JDK 21 `jarsigner.exe` | `-verify -verbose -certs <signed-aab>` | `jar verified.` |
| **3. Bundle Structure** | `bundletool.jar` v1.18.0 | `bundletool validate --bundle=<signed-aab>` | `PASSED` |
| **4. Split Generation** | `bundletool.jar` v1.18.0 | `bundletool build-apks --bundle=<signed-aab> --ks=...` | `PASSED` |

### Validation Evidence:
- **Unsigned Base AAB:** `releases/Bunny-A-Android-v4.aab` (SHA-256: `df51fc10d8e5319a1b8e8ef478cf41a7d444433249159c6ff6222fce62429ee9`)
  - `jarsigner -verify`: `no manifest. jar is unsigned.`
- **Staging-Signed AAB:** Tested via `scripts/sign-android-aab.ps1 -AllowTestKey`
  - Signed AAB SHA-256: `f4bad55f67248b473ddb5492a6c655b818dffff62ec40ba2f8b1e68ea01fb795`
  - `jarsigner -verify`: `jar verified.`
  - `bundletool validate`: Verified feature module `base` (`res/drawable-nodpi-v4/jev_icon.png`, `dex/classes.dex`).
  - `bundletool build-apks`: Split generation confirmed.

---

## 4. Google Play Ingestion Protocol

Upon operator authorization:
1. Operator prepares the official Play Console Upload Keystore.
2. Operator executes:
   ```powershell
   powershell.exe -ExecutionPolicy Bypass -File scripts/sign-android-aab.ps1 `
     -AabPath releases/Bunny-A-Android-v4.aab `
     -KeystorePath /path/to/upload-keystore.jks `
     -KeyAlias upload `
     -StorePass "<password>"
   ```
3. The resulting signed AAB is uploaded to Google Play Console Internal Testing track.
4. Google Play App Signing ingests the upload bundle, verifies the upload signature, strips the upload signature, and re-signs split APKs with the Google-held app signing key.
