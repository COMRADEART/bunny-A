# MA4-S2-T3R — Physical Android qualification (Phase F)

**Gate T3R-G8: PASS** on one real device. No emulator or desktop browser result is counted here.

## Device and setup

| Item | Value |
|---|---|
| Device | Samsung SM-S948U (adb serial R3GL1025V4J), Android 17 (SDK 37), 1440×3120 @ 600 dpi |
| App | existing `com.routeragent.jev` 2.1 (versionCode 3) — the secure HTTPS companion wrapper; nothing installed or replaced |
| Host | installed TEST release `S2T3R4-TEST` (`8802e0c`), isolated, port 43191 |
| Transport | owner-authorized temporary Cloudflare quick tunnels to the TEST gateway only; closed after use; tunnel records in `evidence/installed/tunnel-records/` (no addresses) |
| Driving | adb (`uiautomator dump`, taps, typing, screencap) on the real app; Host-side truth from the Host database's transition log |
| Phone settings | font scale and rotation were changed for the large-text/landscape checks and restored; the owner confirmed the current values (font scale 0.801, auto-rotate off) are their normal settings |

## Results

| Area | Check | Result |
|---|---|---|
| Connection | the app accepts only a bare HTTPS address (refuses paths/queries) | PASS |
| | pairing with a one-time code; session shows "Live from your PC" | PASS |
| | wrong code: "Invalid or expired pairing code." | PASS |
| | disconnect and reconnect; Host restart → reconnect without user action (~25 s after the Host was back) | PASS |
| | revoked pairing → back to the pairing form within 6 s, no controls | PASS |
| Supervision | goals, schedules, monitors and background tasks visible with states | PASS |
| | pause and resume a schedule and a monitor; cancel a schedule | PASS — Host transitions by `device:*` actors |
| | completion evidence and notification status visible | PASS (round 1 screenshots) |
| Security | no Approve control anywhere; "Approve this on your PC." / "Approve or resolve this on your PC." | PASS |
| | broaden scope, read protected outputs, reconcile uncertain operations | no such controls on the phone ("Only the workstation owner can decide. Nothing is replayed from this phone."); Host refusals covered by T1-11/12, T3-A1, T3R-A2/A5 |
| | unpaired or forged-cookie caller over the public address | PASS — 401; wrong pairing code 403 |
| | no secret, credential or local path in phone screens | PASS (visual review of the captured screens) |
| Offline | "Showing last known state from 11:41 PM. Controls are paused." with the correct time, 0 controls, nothing shown as running | PASS |
| Usability | 1.3× font scale and landscape captured and readable | PASS (round 1) |
| | background → foreground after 30 s: Live again in ~4 s | PASS |
| | TalkBack, battery saver, cellular hand-over | NOT TESTED |

Round 1 (Codex, `android/supervision.json`) recorded "resume of one-time reminder" as FAIL; the Host log shows the device's
PAUSED→ACTIVE transition (seq 10), and round 2 re-ran pause/resume with the Host log confirming both — a harness false
negative, not a product failure.

The first quick tunnel of round 2 (HTTP/2) kept losing its edge connection and served empty JavaScript, so the page stayed
on "Connecting"; a QUIC quick tunnel worked. This is a property of account-less quick tunnels, not of Bunny-A.
