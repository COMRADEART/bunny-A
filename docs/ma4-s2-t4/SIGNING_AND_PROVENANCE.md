# MA4-S2-T4 — Signing, Hashes & Provenance (`SIGNING_AND_PROVENANCE.md`)

- **Gate T4-C Verdict:** **`PARTIAL`** (`PASS` on deterministic SBOM, license inventory, SHA-256 artifact manifests, and provenance record; **`BLOCKED`** on external production Authenticode and Google Play signing credentials)

---

## 1. Software Bill of Materials (SBOM) & License Inventory

Generated deterministically by [`scripts/bunny-sbom-provenance.mjs`](../../scripts/bunny-sbom-provenance.mjs) (`node scripts/bunny-sbom-provenance.mjs sbom docs/ma4-s2-t4/evidence/sbom.json`):

- **SBOM Schema:** `bunny-sbom/1`
- **Deterministic SBOM Digest (`sbomSha256`):** `9b4849ff6817079b362615d13e8f3ec399039974a5facb5d762757b6bc192ee8`
- **Component Counts:**
  - Direct `package.json` dependencies: `70`
  - Direct `devDependencies`: `14`
  - Production `package-lock.json` components: `364`
  - Standalone Windows Host runtime npm packages: `1` (`zod` `v3.25.76`; all other Host modules use Node.js `v24` built-ins `node:sqlite`, `node:http`, `node:tls`, `node:crypto`)
  - Copyleft (`GPL`/`AGPL`) production dependencies: **`0`**
- **License Distribution (`364` production components):**
  - `MIT`: `289`
  - `MPL-2.0`: `24`
  - `ISC`: `21`
  - `OFL-1.1`: `14`
  - `Apache-2.0`: `6`
  - `BSD-3-Clause`: `5`
  - `0BSD`: `1`, `CC-BY-4.0`: `1`, `MIT AND ISC`: `1`, `Python-2.0`: `1`, `Unlicense`: `1`

---

## 2. Artifact Hashes & Provenance Manifest (`docs/ma4-s2-t4/evidence/provenance.json`)

| Artifact | Path / Identifier | SHA-256 Digest | Verification Command |
|---|---|---|---|
| **SBOM (`bunny-sbom/1`)** | [`docs/ma4-s2-t4/evidence/sbom.json`](evidence/sbom.json) | `9b4849ff6817079b362615d13e8f3ec399039974a5facb5d762757b6bc192ee8` | `node scripts/bunny-sbom-provenance.mjs sbom` |
| **Windows Release Manifest (`bunny-release-manifest/1`)** | `release-manifest.json` (`Bunny-A-Windows-S2T3R1-6-TEST`, `454` files on `448ca6b` / `Bunny-A-Windows-v26-MA2-R1`, `160` files) | `06836b4847824edcbfa4c1628b4e0106c5ccded24a8d9361355003f467339e54` | `node scripts/bunny-release.mjs verify <ReleaseDir>` |
| **Android APK (`com.routeragent.jev` `2.1 (3)`)** | `releases/Bunny-A-Android-v3.apk` (`49,644` bytes) | `656d7e039fa7e7a4b766cadaecbf48ebe226c9a5b232018067e593a3307401a6` | `Get-FileHash releases/Bunny-A-Android-v3.apk -Algorithm SHA256` |
| **Whisper Voice CLI (`v1.8.3`)** | `whisper-cli.exe` (staged via `scripts/stage-voice-runtime.ps1`) | `de5b8ac6be6fbffe9bfca1fb6db4fb7fb1bfcead74decffbe9eb50da95bbd2c5` | Verified at runtime before spawning voice worker |
| **Whisper Base English Model** | `ggml-base.en.bin` (staged via `scripts/stage-voice-runtime.ps1`) | `a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002` | Verified at runtime before spawning voice worker |

---

## 3. Code Signing Status & Honest Blocker Disclosure

| Platform | Current Signing Status | Signer / Mechanism | Public Beta Gate Status | Blocker & Verification Procedure |
|---|---|---|---|---|
| **Windows (`Bunny-A-Windows-*`)** | **`UNSIGNED`** | Bundled `runtime/node/node.exe` is vendor-signed; `.ps1` launchers and `bunny_proc.exe` are unsigned; local integrity enforced by `Start-Bunny-Release.ps1` checking `release-manifest.json` SHA-256 hashes before launch | **`BLOCKED`** | Requires a trusted Windows Authenticode OV/EV certificate (`BUNNY_WINDOWS_AUTHENTICODE_THUMBPRINT`) and `Set-AuthenticodeSignature` / `signtool verify /pa`. Never claimed as `PRODUCTION_SIGNED` without a valid root-chained certificate. |
| **Android (`Bunny-A-Android-v3.apk`)** | **`TEST_SIGNED`** | Signed via `apksig.jar` (`v1=false, v2=true, v3=true`) with local RSA-3072 PKCS12 certificate `CN=JEV Local Build` (`SHA-256: 51b965f39ad64cc2b593c5d5a90fe307f368e19511338a163f90bf4310152dd7`) | **`BLOCKED`** | Requires a dedicated Google Play App Signing upload keystore (`BUNNY_ANDROID_RELEASE_KEYSTORE`) stored in hardware-backed/HSM secret storage outside the developer workspace. |
