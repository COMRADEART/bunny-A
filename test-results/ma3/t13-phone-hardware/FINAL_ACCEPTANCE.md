# MA3 T13 physical Android final acceptance

**Physical gate: BLOCKED. Overall MA3 T13: CONDITIONAL PASS; NOT COMPLETE.**

Observed 2026-10-18T01:57:20.048Z. Branch ma3-t13-product. Starting HEAD e46620bec1e5a18208479a52aed6c1f66819d88a; executable candidate baseline b23005136c48036968036475e841dcf67a38a794. Final evidence commit: resolve with git log -1 --format=%H -- test-results/ma3/t13-phone-hardware/FINAL_ACCEPTANCE.md.

| Gate | Result |
|---|---|
| Authorized physical Android discovery | PASS: one Samsung SM-S948U, Android 17, API 37, arm64, device state |
| APK signature/source/installed identity | PASS: existing installed com.routeragent.jev 2.0/code 2 exactly matches candidate SHA-256 c2345d32af1b157fdad137bd64a038ac93ea0616b6695b9060cfa3717fb8c168; all four unsigned payload entries reproduced |
| Native launch/interaction row | PASS: Verified candidate app launched and native screen visually inspected; interactions recorded. |
| Candidate workstation/gateway HTTPS compatibility | BLOCKED: live installed source 8145377 differs from b230051; changed mission files; no compatibility attestation; current HTTPS configuration absent |
| Bunny-A device pairing | BLOCKED; never attempted against unverified gateway |
| Authoritative physical matrix | 1/15 PASS; remaining BLOCKED, see HARDWARE_MATRIX.md |
| Physical authentication/authorization/security | BLOCKED; required negative/live checks unexecuted |
| Prior mandatory T13 gates | Retained with original limitations: 69 sealed receipt hashes match; executable source unchanged. No fresh full-suite/browser/Windows-native/voice claim |
| Preservation | No product source changes; previous receipts and unrelated dirty/untracked files preserved (final source-preservation-after.json) |

ADB is now available and authorized; the previous missing-hardware-tool prerequisite is resolved. Debugging QR pairing is not Bunny-A pairing. Completed live checks provide no basis to waive the remaining physical gate. No confirmed critical defect warrants a production fix.

Resume requires a manifest-validated compatible candidate Host/gateway over an existing authorized HTTPS origin, followed by actual-device rows 2–15 and any uncompleted native UI checks. Existing installed services were not restarted/replaced/retargeted. No authority broadened, no important user files changed, no PR/merge/push or MA4.

Evidence: DEVICE_ENVIRONMENT.md, APK_VALIDATION.md, TRANSPORT_COMPATIBILITY.md, PAIRING_EXECUTION.md, HARDWARE_MATRIX.md, SECURITY_RESULTS.md, PERFORMANCE_RESULTS.md; JSON command observations, apk-logs/, sanitized screenshots if available, INDEX.sha256 and secret-scan.json.
