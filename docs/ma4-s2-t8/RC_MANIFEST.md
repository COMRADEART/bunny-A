# MA4-S2-T8 — Release Candidate Freeze & Manifest (`RC_MANIFEST.md`)

- **Gate T8-A Verdict:** **`PASS`** (Release candidate tree frozen, SBOM & SHA-256 artifact manifests verified; signing blockers tracked in `BETA_GO_NO_GO.md`)

---

## 1. Frozen Release Candidate Stack (`MA4-S2`)

| Milestone | Branch | Head Commit / Base | Draft PR | Status |
|---|---|---|---|---|
| **Baseline (`MA4-S2-T3R`)** | `ma4-s1r3-agent-reliability` | `10993bd897936b3e6478f81aed9a3b522bfc5b51` (PR #27 merged at `1f36d951a380783d4cbfcf70ead72891d88c55b4`; PR #28 merged to `main` at `0fce711`) | #27 / #28 | **`PASS`** |
| **MA4-S2-T3R1** | `ma4-s2-t3r1-beta-closure` | `aa255cd83232d886ae273d546be0b0d0f6b77a26` (code frozen at `448ca6b6fb7252e2ea7af00e02ed9e078b5d1610`) | [#29](https://github.com/COMRADEART/bunny-A/pull/29) | **`PARTIAL`** |
| **MA4-S2-T4** | `ma4-s2-t4-release-packaging` | `c8a55a10fc1e4fc634f1e20ccb8992e6de02afac` | [#30](https://github.com/COMRADEART/bunny-A/pull/30) | **`PARTIAL`** |
| **MA4-S2-T5** | `ma4-s2-t5-native-experience` | `fa07f5d56b00aa5165d9758bd6d27d254324942c` | [#31](https://github.com/COMRADEART/bunny-A/pull/31) | **`PARTIAL`** |
| **MA4-S2-T6** | `ma4-s2-t6-provider-integrations` | `823487df490daf14f4f96bb659908e1e1b5548d6` | [#32](https://github.com/COMRADEART/bunny-A/pull/32) | **`PARTIAL`** |
| **MA4-S2-T7** | `ma4-s2-t7-operations-reliability` | `e3e88ea754a6c6895f05b96306c042d74918332b` | [#33](https://github.com/COMRADEART/bunny-A/pull/33) | **`PARTIAL`** |
| **MA4-S2-T8** | `ma4-s2-t8-release-candidate` | Stacked on `e3e88ea754a6c6895f05b96306c042d74918332b` | Draft PR #34 | **`PARTIAL`** |

---

## 2. Artifact Hashes & Provenance Summary

- **SBOM (`bunny-sbom/1`):** [`docs/ma4-s2-t4/evidence/sbom.json`](../ma4-s2-t4/evidence/sbom.json) — `sbomSha256: 9b4849ff6817079b362615d13e8f3ec399039974a5facb5d762757b6bc192ee8` (`70` direct deps, `364` prod lock components, `1` standalone Host runtime npm package `zod`, `0` copyleft dependencies).
- **Windows Candidate Release (`Bunny-A-Windows-S2T3R1-6-TEST` / `Bunny-A-Windows-v26-MA2-R1`):**
  - Manifest Schema: `bunny-release-manifest/1` (`hostSchemaUserVersion: 3`)
  - Manifest Digest: `06836b4847824edcbfa4c1628b4e0106c5ccded24a8d9361355003f467339e54`
  - Signing Status: **`UNSIGNED` (`BLOCKED` for public distribution until Windows Authenticode OV/EV certificate is provisioned)**
- **Android Companion Release (`releases/Bunny-A-Android-v3.apk`):**
  - Package Identity: `com.routeragent.jev`, `versionCode="3"`, `versionName="2.1"`, `minSdkVersion="26"`, `targetSdkVersion="35"`
  - APK SHA-256 (`build-android.ps1`): `656d7e039fa7e7a4b766cadaecbf48ebe226c9a5b232018067e593a3307401a6` (`49,644` bytes)
  - Signing Status: **`TEST_SIGNED` (`CN=JEV Local Build`, `SHA-256: 51b965f39ad64cc2b593c5d5a90fe307f368e19511338a163f90bf4310152dd7`; `BLOCKED` for Google Play store distribution until production upload keystore is provisioned)**
