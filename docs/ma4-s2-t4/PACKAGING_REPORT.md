# MA4-S2-T4 — Packaging Report (`PACKAGING_REPORT.md`)

- **Milestone:** `MA4-S2-T4 — Secure Packaging, Signing & Distribution`
- **Branch:** `ma4-s2-t4-release-packaging` (stacked on `ma4-s2-t3r1-beta-closure` `aa255cd83232d886ae273d546be0b0d0f6b77a26`)
- **Milestone Verdict:** **`PARTIAL`** (`T4-A` Windows Packaging `PASS`, `T4-B` Android Packaging `PASS` locally / Production Signing `BLOCKED`, `T4-C` Hashes & Provenance `PASS` / Trusted Code Signing `BLOCKED`, `T4-D` Upgrade & Rollback Safety `PASS`)

---

## 1. Packaging Architecture Summary

Bunny A ships two coordinated release artifacts from a single git source commit:

| Platform | Packaging Script | Output Artifact | Target Install / Package Identity | Bundled Runtime | Signing Status |
|---|---|---|---|---|---|
| **Windows 11 (`x64`)** | [`scripts/package-bunny-desktop.ps1`](../../scripts/package-bunny-desktop.ps1) + [`scripts/install-bunny-release.ps1`](../../scripts/install-bunny-release.ps1) | Self-contained release directory `<InstallRoot>\releases\<ReleaseId>` + `release-manifest.json` (`bunny-release-manifest/1`) | `%LOCALAPPDATA%\Bunny-A` (user-scoped, non-administrator) | Node.js `v24.14.1` (`runtime/node/node.exe`), `node_modules/zod`, native `bunny_proc.exe`, optional staged `whisper-cli.exe` (`sha256:de5b8ac6...`) | **`UNSIGNED` (`BLOCKED` for public distribution; `node.exe` vendor-signed, PowerShell launchers unsigned; integrity verified via SHA-256 `release-manifest.json`)** |
| **Android (`API 26–35`)** | [`scripts/build-android.ps1`](../../scripts/build-android.ps1) | `releases/Bunny-A-Android-v3.apk` (`24,523` bytes, `sha256:6b21a5f42f77ddfd05ff78c934e4cf6a26c5261654d38da79a4822e129d53c1d`) | `com.routeragent.jev` (`versionCode="3"`, `versionName="2.1"`, `minSdkVersion="26"`, `targetSdkVersion="35"`) | Native Java (`--release 8` + `D8 --min-api 26`) + Android WebView HTTPS/TLS client | **`TEST_SIGNED` (`CN=JEV Local Build` RSA-3072 PKCS12; `BLOCKED` for Google Play store distribution until production upload keystore is provisioned)** |

---

## 2. Gate Summary

| Sub-Milestone | Requirement | Status | Evidence |
|---|---|---|---|
| **T4-A: Windows Packaging** | Self-contained Windows release (`Bunny-Host.mjs`, `.output/public`, `.output/server`, `runtime/node/node.exe`, `node_modules/zod`, `bunny_proc.exe`), standard user install under `%LOCALAPPDATA%` without elevation, no developer checkout dependency | **`PASS`** | [`WINDOWS_INSTALLER.md`](WINDOWS_INSTALLER.md), [`../ma4-s2-t3r1/evidence/installed/lifecycle.json`](../ma4-s2-t3r1/evidence/installed/lifecycle.json) |
| **T4-B: Android Packaging** | Reproducible APK (`com.routeragent.jev` `2.1 (3)`), `usesCleartextTraffic="false"`, `allowBackup="false"`, least-privilege `INTERNET`-only permission, pairing persistence, update without data loss | **`PARTIAL` (Artifact & Security `PASS`; Play Signing `BLOCKED`)** | [`ANDROID_RELEASE.md`](ANDROID_RELEASE.md), [`../ma4-s2-t3r/evidence/android/round2.json`](../ma4-s2-t3r/evidence/android/round2.json) |
| **T4-C: Code Signing, Hashes & Provenance** | Deterministic SBOM (`bunny-sbom/1`), license inventory (`0` copyleft), SHA-256 `release-manifest.json`, `bunny-provenance/1`, honest `UNSIGNED / TEST_SIGNED / PRODUCTION_SIGNED` reporting | **`PARTIAL` (SBOM & Provenance `PASS`; Trusted Certs `BLOCKED`)** | [`SIGNING_AND_PROVENANCE.md`](SIGNING_AND_PROVENANCE.md), [`evidence/sbom.json`](evidence/sbom.json), [`evidence/provenance.json`](evidence/provenance.json) |
| **T4-D: Upgrade & Rollback Safety** | Preserves goals, schedules, monitors, tasks, approvals, receipts, device bindings, permissions, and audit trails across upgrades and rollbacks; fails closed on incompatible `PRAGMA user_version` (`bunny-rollback-preflight.mjs`) | **`PASS`** | [`UPDATE_ROLLBACK.md`](UPDATE_ROLLBACK.md), [`../../scripts/bunny-rollback-preflight.test.mjs`](../../scripts/bunny-rollback-preflight.test.mjs), [`../../scripts/bunny-state-migration.test.mjs`](../../scripts/bunny-state-migration.test.mjs) |
