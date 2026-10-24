# MA4-S2-T8 — Google Play & Android Companion Readiness (`GOOGLE_PLAY_READINESS.md`)

- **Gate T8-B (Android Distribution Readiness) Verdict:** **`PARTIAL`** (`PASS` on API 35 targeting, network security hardening, least-privilege permissions, and physical Samsung SM-S948U authorization; **`BLOCKED`** on Google Play production upload keystore & live TalkBack hardware verification)

---

## 1. Google Play Readiness Checklist

| Requirement | Status | Evidence & Notes |
|---|---|---|
| **Target SDK Level (`targetSdkVersion="35"`, `minSdkVersion="26"`)** | **`PASS`** | Meets Google Play API 35 requirement for new apps and updates ([`android/app/src/main/AndroidManifest.xml`](../../android/app/src/main/AndroidManifest.xml)) |
| **Application ID & Monotonic Versioning** | **`PASS`** | `com.routeragent.jev`, `versionCode="3"`, `versionName="2.1"` |
| **Least-Privilege Permissions** | **`PASS`** | Declares only `android.permission.INTERNET` (`1` permission total; zero camera, mic, location, contacts, or storage permissions) |
| **Cleartext Traffic & Cloud Backup Hardening** | **`PASS`** | `android:usesCleartextTraffic="false"`, `android:allowBackup="false"`, `21/21` `ServerAddressTest` checks passing |
| **Data Safety Disclosure Accuracy** | **`PASS`** | Companion app transmits only pairing code and authenticated supervision commands to the user's own Windows Host; zero third-party analytics or ad SDKs |
| **Physical Device Authorization & Revocation** | **`PASS`** | `9/9 PASS` on Samsung `SM-S948U` (Android 16 / SDK 36) in [`docs/ma4-s2-t3r/evidence/android/round2.json`](../ma4-s2-t3r/evidence/android/round2.json) |
| **Google Play Upload Keystore Signing (`.aab` / `.apk`)** | **`BLOCKED`** | Signed locally with `CN=JEV Local Build` (`TEST_SIGNED`); production upload keystore (`BUNNY_ANDROID_RELEASE_KEYSTORE`) not provisioned |
| **Live Physical TalkBack Touch-Exploration Pass** | **`NOT TESTED` / `BLOCKED`** | Physical Samsung `SM-S948U` was disconnected during T3R1–T8 |
