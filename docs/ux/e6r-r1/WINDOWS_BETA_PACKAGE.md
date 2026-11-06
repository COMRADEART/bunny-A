# BUNNY A — WINDOWS BETA PACKAGE INTEGRITY REPORT (E6R-R1)

**Date:** 2026-11-06  
**Source Commit:** `a9e45d8ce9da25f58f52275bf7dddc3eaa7109da`  
**Tooling Commit:** `a9e45d8ce9da25f58f52275bf7dddc3eaa7109da`  
**Host Environment:** Windows 11 Enterprise (x64), .NET 8.0.427 SDK, Node.js v26.13.0, Windows Kits 10 `makeappx.exe` (10.0.22621.0)

---

## 1. Pinned Hermetic Desktop Distribution Build

A clean Windows release package candidate was built directly from the reviewed source commit `a9e45d8ce9da25f58f52275bf7dddc3eaa7109da` using `scripts/package-bunny-desktop.ps1`:

### Package Verification Artifacts:
- **Zip Package:** `releases/Bunny-A-Windows-v28-BETA-1-TEST.zip`
- **Package SHA-256:** `1b0944f5bb8ce0ae012f0e94be6d13e2a32286dafae9d87f34c5ba03a824411d`
- **Release Manifest:** `releases/Bunny-A-Windows-v28-BETA-1-TEST/release-manifest.json`
- **File Count in Manifest:** `1467` files
- **Package Lock SHA-256:** `c3c5dd1f0705a4d064e7150b4c5b3e34e8405c7f55729a7231761497fcad3cbc`

### Compatibility Verification:
```json
{
  "hostEntry": "Bunny-Host.mjs",
  "launcher": "Start-Bunny-Release.ps1",
  "hostPortDefault": 43119,
  "stateLayoutVersion": 2,
  "databaseSchemaVersion": 3,
  "codexCompatibilityPolicyVersion": 1,
  "hostFailurePolicyVersion": 1,
  "gitProcessOwnershipPolicyVersion": 1,
  "providerProcessContainmentPolicyVersion": 1,
  "hostSchemaUserVersion": 3
}
```

### Hermetic Verification Checks:
1. `node scripts/bunny-release.mjs verify releases/Bunny-A-Windows-v28-BETA-1-TEST`
   - Result: `ok: true`, checked: 1467, extra: 0, missing: 0, changed: 0.
2. `node scripts/bunny-release.mjs closure releases/Bunny-A-Windows-v28-BETA-1-TEST`
   - Result: `ok: true`, missing: 0, outside: 0.
3. `node scripts/bunny-release.mjs source-check . releases/Bunny-A-Windows-v28-BETA-1-TEST`
   - Result: `ok: true`, checked: 262 source files against Git HEAD `a9e45d8`, mismatched: 0.

---

## 2. MSIX Package Generation & Desktop Bridge Contract

To fulfill the Microsoft Store and packaged desktop installation pathway, we implemented native MSIX packaging via `scripts/package-bunny-msix.ps1` and declarative manifest `native/windows/BunnyA/AppxManifest.xml`.

### Package Output:
- **Package File:** `releases/BunnyA.Workstation-0.5.1.0.msix`
- **Package SHA-256:** `3624c5d4a8eca63ccc1eb79a5de331b3bd610d4b57e5476c8d13caf0e50edc97`
- **Package BlockMap & Content Types:** Generated via Windows Kits 10 `makeappx.exe` pack with `/h SHA256`.

### Declarative Identity & Capabilities:
- **Package Identity:** `BunnyA.Workstation`
- **Publisher:** `CN=BunnyA-Development` (Staged development identity; operator updates to Partner Center publisher ID on store submission)
- **Version:** `0.5.1.0` (matching `BunnyA.csproj` v0.5.1)
- **TargetDeviceFamily:** `Windows.Desktop`, MinVersion `10.0.17763.0`, MaxVersionTested `10.0.26100.0`
- **Application ID:** `BunnyA`
- **Executable:** `BunnyA.exe`
- **EntryPoint:** `Windows.FullTrustApplication`
- **Capabilities:** `runFullTrust` (Restricted Centennial capability permitted for workstation developer tools)
- **Protocols:** `bunny-a://` protocol handler declared for cross-app automation and deep links.

### Visual Assets Included:
- `Assets/msix/StoreLogo.png` (50x50)
- `Assets/msix/Square44x44Logo.png` (44x44)
- `Assets/msix/Square150x150Logo.png` (150x150)
- `Assets/msix/Square71x71Logo.png` (71x71)
- `Assets/msix/Wide310x150Logo.png` (310x150)
- `Assets/msix/SplashScreen.png` (620x300)

---

## 3. Microsoft Store vs. Authenticode Direct Web Distribution

A critical release distinction governs the two distribution channels:

| Channel | Packaging Format | Signing Mechanism | Trust Root & User Experience | Operator Requirement |
| :--- | :--- | :--- | :--- | :--- |
| **Microsoft Store** | `.msix` or `.msixupload` | Ingestion re-signing by Microsoft Store CA | Trusted out-of-the-box on all Windows 10/11 devices. Seamless auto-updates via Windows Store service. | Windows Partner Center account ($19-$99 one-time registration); reserve app name `Bunny A`. |
| **Direct Web Distribution** | `.zip` or `.msix` | Authenticode signature via RFC 3161 timestamping | Requires Standard Code Signing or EV Code Signing certificate from a trusted public CA (DigiCert, Sectigo). Unsigned MSIX fails Windows App Installer check with `0x800B0109`. | Operator must provide authorized Authenticode code-signing certificate and password/HSM. |

> [!IMPORTANT]
> In accordance with release constraints, no production certificates were fabricated, purchased, or injected into the local machine trust store. Unsigned and development-manifested packages are ready for operator signing.
