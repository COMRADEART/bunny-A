# Android environment discovery

Source: `b23005136c48036968036475e841dcf67a38a794`. Observation: 2026-10-17T21:50:58.1961317Z. Command: `./test-results/ma3/t13-gate-closure/discover-android.ps1`, exit 0. Full sanitized observations and candidate paths: `android-environment.json`.

| Prerequisite | Observed result |
|---|---|
| ADB | Not on PATH; absent from checked SDK, platform-tools, environment-variable and WinGet candidate paths. Workspace adb.exe inventory also returned no matches. |
| Authorized Android device | **Not enumerable because ADB is unavailable.** No adb/emulator process was observed. This is not proof that no USB hardware is attached. |
| Companion APK | `releases/Bunny-A-Android-v2.apk`, 49,644 bytes, SHA-256 `c2345d32af1b157fdad137bd64a038ac93ea0616b6695b9060cfa3717fb8c168`. |
| Native build configuration | `android/app/src/main/AndroidManifest.xml`; package com.routeragent.jev, version 2.0, min API 26, target API 35; `scripts/build-android.ps1` uses Java/AAPT2/D8/apksig, not Gradle. Java, javac and all four required Android tool artifacts are present. |
| BUNNY_REMOTE_ORIGIN | Absent in this session's process/user/machine environments. This does not establish the installed gateway's environment. |
| remote.json | Present in installed state/settings with a valid HTTPS origin; absent in the workspace/development candidate paths. Existing gateway derives the origin from this file. Address and any secret fields were not retained. |
| Workstation transport | Existing installed gateway and cloudflared process observed. TLS-verified HTTPS /bunny-health returned 200 with Bunny-A identity; anonymous /api/bunny-events returned 401. Existing headers include DENY, frame-ancestors none and no-referrer. |

Available checks executed: `./test-results/ma3/t13-gate-closure/check-android.ps1`, exit 0. APK verifier reports **v2=true, v3=true, v1=false**; do not infer v1 from the build script's intent. The existing APK is accepted by the verifier at min checked platform 26. Actual badging matches the manifest. Java connection policy: **21 checks passed**. Commands and logs: `android-checks.json`, `android-checks/*.log`. No APK rebuild, re-sign, installation or signing-secret read was necessary.

The transport probe used the existing configured origin in memory, sent no credentials and retained only status/security headers. It did not start a tunnel, change firewall rules, or create any endpoint. It proves workstation reachability at observation time; it does not prove reachability/cookie persistence on a physical phone.

The installed release manifest declares source `8145377880fa4ab330238db827fa488430b2328d`, which differs from candidate `b23005136c48036968036475e841dcf67a38a794`. See installed-release-observation.json (read-only manifest pin/hash observation, not a new whole-release integrity verification). The reachable installed transport therefore does **not** establish candidate-source phone acceptance. Before hardware validation, stage a manifest-validated candidate workstation/gateway through an explicitly authorized HTTPS test transport. Do not repoint, replace or restart the existing installed release automatically.

Required setup before the physical gate: make official Android SDK Platform-Tools available; connect an Android 8+ physical handset and complete its owner-authorized USB/wireless debugging prompt; require `adb devices -l` state device (not unauthorized/offline); confirm the existing configured HTTPS origin works on that phone with normal certificate validation; confirm/install the signed version-2 companion only on that authorized test handset. Revalidate actual package identity and capture sanitized logs/screenshots per PHONE_PAIRING_MATRIX.md. Do not expose the loopback Host, disable TLS checks, or open firewall access as a workaround.

Disposition: **physical pairing BLOCKED by unavailable ADB and unverified authorized physical-device access**. Transport configuration itself is present and was reachable.
