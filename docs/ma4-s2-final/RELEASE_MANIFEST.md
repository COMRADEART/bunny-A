# BUNNY A — MA4-S2 RELEASE MANIFEST (`RELEASE_MANIFEST.md`)

## 1. Branch & Pull Request Stack

| Order | Milestone | Branch | Base Branch | Draft PR |
|---|---|---|---|---|
| 1 | `MA4-S2-T3R1` | `ma4-s2-t3r1-beta-closure` | `ma4-s1r3-agent-reliability` | [PR #29](https://github.com/COMRADEART/bunny-A/pull/29) |
| 2 | `MA4-S2-T4` | `ma4-s2-t4-release-packaging` | `ma4-s2-t3r1-beta-closure` | [PR #30](https://github.com/COMRADEART/bunny-A/pull/30) |
| 3 | `MA4-S2-T5` | `ma4-s2-t5-native-experience` | `ma4-s2-t4-release-packaging` | [PR #31](https://github.com/COMRADEART/bunny-A/pull/31) |
| 4 | `MA4-S2-T6` | `ma4-s2-t6-provider-integrations` | `ma4-s2-t5-native-experience` | [PR #32](https://github.com/COMRADEART/bunny-A/pull/32) |
| 5 | `MA4-S2-T7` | `ma4-s2-t7-operations-reliability` | `ma4-s2-t6-provider-integrations` | [PR #33](https://github.com/COMRADEART/bunny-A/pull/33) |
| 6 | `MA4-S2-T8` | `ma4-s2-t8-release-candidate` | `ma4-s2-t7-operations-reliability` | Draft PR #34 |

---

## 2. Artifact Digests & Provenance

- **SBOM (`docs/ma4-s2-t4/evidence/sbom.json`):**
  - Schema: `bunny-sbom/1`
  - SHA-256 (`sbomSha256`): `9b4849ff6817079b362615d13e8f3ec399039974a5facb5d762757b6bc192ee8`
  - Components: `70` direct dependencies, `364` production lock components, `1` standalone Host runtime package (`zod`), `0` copyleft packages.
- **Windows Candidate Release (`Bunny-A-Windows-S2T3R1-6-TEST` / `Bunny-A-Windows-v26-MA2-R1`):**
  - Manifest Schema: `bunny-release-manifest/1` (`hostSchemaUserVersion: 3`)
  - Manifest SHA-256: `06836b4847824edcbfa4c1628b4e0106c5ccded24a8d9361355003f467339e54`
  - Signing Status: `UNSIGNED` (`BLOCKED` for public distribution without Authenticode OV/EV certificate)
- **Android Companion Release (`releases/Bunny-A-Android-v3.apk`):**
  - Package: `com.routeragent.jev` (`versionCode="3"`, `versionName="2.1"`, `minSdkVersion="26"`, `targetSdkVersion="35"`)
  - APK SHA-256: `656d7e039fa7e7a4b766cadaecbf48ebe226c9a5b232018067e593a3307401a6` (`49,644` bytes)
  - Signing Status: `TEST_SIGNED` (`CN=JEV Local Build`, `SHA-256: 51b965f39ad64cc2b593c5d5a90fe307f368e19511338a163f90bf4310152dd7`; `BLOCKED` for Google Play store distribution without production upload keystore)
- **Pinned Local Models & Voice Runtime:**
  - `qwen2.5-coder:7b`: `sha256:dae161e27b0e`
  - `deepseek-r1:7b`: `sha256:755ced02ce7b`
  - `whisper-cli.exe` (`v1.8.3`): `sha256:de5b8ac6be6fbffe9bfca1fb6db4fb7fb1bfcead74decffbe9eb50da95bbd2c5`
  - `ggml-base.en.bin`: `sha256:a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002`
