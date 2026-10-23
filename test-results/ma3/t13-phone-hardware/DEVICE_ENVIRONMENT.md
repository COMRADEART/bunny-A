# Physical device environment

Observed 2026-10-18T01:45:17.7622131Z. Branch ma3-t13-product; starting evidence HEAD e46620bec1e5a18208479a52aed6c1f66819d88a; accepted executable baseline b23005136c48036968036475e841dcf67a38a794.

- Exactly one authorized device selected as phone-1; adb state device. No device serial/address retained.
- Physical indicators: manufacturer samsung, model SM-S948U, hardware qcom, qemu=0. User-authorized actual handset; no emulator used.
- Android 17, API 37, ABI arm64-v8a. API 26 minimum satisfied.
- Android Debug Bridge version 1.0.41; Version 37.0.1-15733141. Executable located under test-results/android-tools/platform-tools/adb.exe; not on PATH.
- Restricted daemon startup failed; normal-access adb start-server succeeded, exit 0. Initial enumeration had zero devices. Supplied wireless endpoint was reachable but adb connect did not authenticate.
- Official Android-format QR authorization subsequently succeeded (qr-session.json: adb pair exit 0); exact one-device enumeration then succeeded. QR password/pixels remained in memory and were removed after pairing.
- No USB/wireless device identifiers, pairing codes, authentication tokens or personal phone content retained. No storage clear/uninstall/downgrade.

Reproducible commands and exits: device-observations.json; collect-device.ps1; adb-connection.json; installed-permissions.json. Timestamps are UTC. This supersedes the prior unavailable-ADB prerequisite only; it does not close Bunny-A enrollment.
