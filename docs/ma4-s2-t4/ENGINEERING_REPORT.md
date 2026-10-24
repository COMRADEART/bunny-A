# BUNNY A — MA4-S2-T4 ENGINEERING REPORT

## Milestone
`MA4-S2-T4 — Secure Packaging, Signing & Distribution`

## Repository & Branch
- **Repository:** `https://github.com/COMRADEART/bunny-A`
- **Base Branch:** `ma4-s2-t3r1-beta-closure` (`aa255cd83232d886ae273d546be0b0d0f6b77a26`, Draft PR #29)
- **Working Branch:** `ma4-s2-t4-release-packaging`

## Executive Summary
- **Overall Milestone Verdict:** **`PARTIAL`**
- **What Passed (`PASS`):**
  - **T4-A (Windows Packaging — `PASS`):** Self-contained Windows release (`Bunny-Host.mjs`, `.output/public`, `.output/server`, `runtime/node/node.exe`, `node_modules/zod`, native `bunny_proc.exe`, and hash-pinned optional `whisper.cpp` voice runtime) installs under standard non-administrator user scope (`%LOCALAPPDATA%\Bunny-A`) with zero developer checkout dependency, zero automatic Windows startup entries, and verified clean uninstallation.
  - **T4-B (Android Packaging Artifact & Hardening — `PASS`):** Deterministic Gradle-free build (`scripts/build-android.ps1`) produced `releases/Bunny-A-Android-v3.apk` (`com.routeragent.jev` `versionCode=3`, `versionName=2.1`, `minSdkVersion=26`, `targetSdkVersion=35`, `49,644` bytes, `sha256:656d7e039fa7e7a4b766cadaecbf48ebe226c9a5b232018067e593a3307401a6`) with `21/21` `ServerAddressTest` checks passing, `usesCleartextTraffic="false"`, `allowBackup="false"`, and least-privilege `INTERNET`-only permission.
  - **T4-C (SBOM, License Inventory & Provenance — `PASS`):** Implemented [`scripts/bunny-sbom-provenance.mjs`](../../scripts/bunny-sbom-provenance.mjs) and [`scripts/bunny-sbom-provenance.test.mjs`](../../scripts/bunny-sbom-provenance.test.mjs), producing [`docs/ma4-s2-t4/evidence/sbom.json`](evidence/sbom.json) (`sbomSha256: 9b4849ff6817079b362615d13e8f3ec399039974a5facb5d762757b6bc192ee8`, `364` production lock components, `0` copyleft dependencies) and [`docs/ma4-s2-t4/evidence/provenance.json`](evidence/provenance.json).
  - **T4-D (Upgrade & Rollback Safety — `PASS`):** Passed **`40/40`** automated packaging, state-migration (`23` SQLite tables + WAL preservation), and rollback-preflight tests (`74.79 s`).
- **What Is Blocked (`BLOCKED`):**
  - **Production Code Signing (`T4-B` / `T4-C`):** Windows Authenticode (`BUNNY_WINDOWS_AUTHENTICODE_THUMBPRINT`) and Google Play production upload keystore (`BUNNY_ANDROID_RELEASE_KEYSTORE`) credentials are not provisioned in this environment. Per Master Prompt §T4-C, Windows packages are explicitly reported as `UNSIGNED` (with local SHA-256 `release-manifest.json` enforcement) and Android APKs are explicitly reported as `TEST_SIGNED` (`CN=JEV Local Build`), keeping external store/public distribution `BLOCKED`.

## Artifact Index (`docs/ma4-s2-t4/`)
- [`PACKAGING_REPORT.md`](PACKAGING_REPORT.md)
- [`WINDOWS_INSTALLER.md`](WINDOWS_INSTALLER.md)
- [`ANDROID_RELEASE.md`](ANDROID_RELEASE.md)
- [`SIGNING_AND_PROVENANCE.md`](SIGNING_AND_PROVENANCE.md)
- [`UPDATE_ROLLBACK.md`](UPDATE_ROLLBACK.md)
- [`evidence/sbom.json`](evidence/sbom.json)
- [`evidence/provenance.json`](evidence/provenance.json)
