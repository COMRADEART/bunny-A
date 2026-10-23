# APK validation

Observed 2026-10-18T01:41:44.4779865Z. Existing APK releases/Bunny-A-Android-v2.apk, 49644 bytes.

| Identity | Verified value |
|---|---|
| SHA-256 | c2345d32af1b157fdad137bd64a038ac93ea0616b6695b9060cfa3717fb8c168 |
| Package | com.routeragent.jev |
| Version | 2.0 / code 2 |
| Minimum / target SDK | 26 / 35 |
| Signing certificate SHA-256 | 51b965f39ad64cc2b593c5d5a90fe307f368e19511338a163f90bf4310152dd7 |
| Signature verification | v2=true; v3=true; v1=false (not inferred from build-script intent) |
| Permissions | android.permission.INTERNET only; installed grant verified |
| Installed APK SHA-256 | c2345d32af1b157fdad137bd64a038ac93ea0616b6695b9060cfa3717fb8c168 |
| Device API compatibility | Android 17 / API 37 exceeds minimum; runtime observations remain separately scoped |

**PASS for signature, installed identity and source-content identity.** All four payload entries (AndroidManifest.xml, classes.dex, icon, resources.arsc) match a fresh unsigned rebuild of the unchanged accepted Android sources byte-for-byte. Signing metadata is excluded from content comparison and independently cryptographically verified. This is not a claim that signed ZIP timestamps or signature blocks are reproducible. Current executable source differs from baseline only in prior evidence/tooling; no Android working-tree edit.

Manifest inspection confirms backup=false and cleartext=false. The connection origin must be HTTPS, without embedded credentials or query tokens; no remote origin is embedded. Static WebView policy and 21 live Java address-policy checks support this boundary; actual end-to-end HTTPS/session behavior is not certified.

Installed candidate already matched exactly. No install/update was needed; app data preserved. APK hash unchanged, no re-signing or signing-key/password read.

Commands and exits: apk-observations.json and apk-logs/*.log. verify-apk.ps1 rebuilds only ignored local-build scratch. First restricted JVM attempt stalled, was stopped only by its task-owned PID, and retried successfully outside that restriction; apk-restricted-attempt.json retains that attempt. This is tooling execution context, not an APK defect.
