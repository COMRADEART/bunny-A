# JEV Android APK

Created October 1, 2026.

- APK: `C:\Users\<user>\Downloads\JEV-Android-v1.apk`.
- Workspace copy: `releases/JEV-Android-v1.apk`.
- App name: JEV; package: `com.routeragent.jev`; version: 1.0.
- Minimum Android: 8.0 (API 26); target/compile API: 35.
- Size: 37,356 bytes. No model weights or Windows runtime are bundled.
- SHA-256: `B9FCE25C8EFF37B62E4B337E8291247C7514189F377C51419E86A58B56F48795`.

## What is included

A native connection screen, saved HTTPS address, loading indicator, retry/change
connection controls, back navigation and a WebView for the existing JEV workspace.
The app asks for the remote address on first launch; no placeholder address is
used as a working server. JEV and Ollama continue to run on the computer.

The only requested permission is Internet access. Cleartext traffic and mixed
content are disabled. Invalid TLS certificates are rejected. Localhost,
credential-bearing URLs, query tokens and non-HTTPS addresses are refused.
The WebView has no native JavaScript bridge and cannot read file/content URLs.
App history remains separate from the desktop browser's history.

## Verified

- Java compilation and D8 conversion completed; final build has no compiler errors.
- AAPT2 identified the expected app label, launcher, permission and SDK versions.
- Google's apksig verifier accepted the signed APK for API 26 and newer; v2 and
  v3 verification passed. The APK also contains a v1 signature.
- APK resources are uncompressed and aligned to 4-byte boundaries.
- DEX header and both application classes are present.
- Private signing files and source files are absent from the APK.
- 21 connection policy checks passed.
- The Downloads copy matches the built APK.

Evidence: `test-results/android-build-verified.log`. Android source and build
instructions: `android/README.md` and `scripts/build-android.ps1`.
The build follows Android's documented
[AAPT2 packaging](https://developer.android.com/tools/aapt2) and
[APK signing](https://developer.android.com/tools/apksigner) steps.

## Installation and remaining checks

Copy/open the APK on Android and choose Install. Open JEV and enter the computer's
authenticated remote HTTPS address. The computer must be awake, JEV and Ollama
must be running, and the Windows service must allow that remote origin.

There is no connected phone or Android emulator here. Physical installation,
first launch, remote sign-in, network reconnection, and task execution through the
APK remain unverified. The previously tested desktop/mobile web application and
real desktop Ollama task do not substitute for an Android device test.
