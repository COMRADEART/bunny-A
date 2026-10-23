# Pairing execution

**Android debugging authorization: PASS. Bunny-A workstation pairing: BLOCKED / NOT ATTEMPTED.**

The user authorized wireless ADB access. The initial secure manual-entry dialog did not establish a session. Initial adb connect returned without an authenticated device. At the user's request, a temporary local QR page used Android's official WIFI/ADB pairing format and a random in-memory credential. The phone scanned it; adb pair completed with exit 0. Exactly one physical handset subsequently reported device. qr-session.json records sanitized results. No QR/pairing secret is retained in evidence; the page removed its in-memory QR after success. This is workstation debugging trust, not Bunny-A enrollment.

Bunny-A's installed candidate APK was verified and launched. No Bunny-A code was issued, entered, persisted or redeemed because installed gateway source differs and candidate compatibility cannot be established; the current HTTPS origin is unavailable. No application credential/session/device registration was created.

Consequently single-use/expiry, authenticated monitoring, approvals, device consent, revocation/reconnection and negative authorization checks were not performed on this phone. Historical software checks and Android's debugging-code semantics do not substitute for those tests.

Evidence: qr-session.json, device-observations.json, launch-observations.json, transport-observations.json, HARDWARE_MATRIX.md. Secure local helpers pass credentials through process stdin only; they never put them in adb command arguments.
