# MA4-S3-T0 — Release Provenance

## Status: NOT SEALED FOR THIS TIP

| Artifact | Status |
|---|---|
| Source commit | Branch tip after T0 fixes (record at seal) |
| Windows installer | Prior T3R1/T4 evidence; rebuild required on tip |
| Android APK | Prior artifacts; re-verify SHA-256 |
| SBOM | `scripts/bunny-sbom-provenance.mjs` present |
| Signing | **BLOCKED** — production credentials absent |
| Hosted CI | Pending push/PR |

Do not publish or install into owner production automatically.
