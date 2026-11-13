# BUNNY A — E6R-R3 ATTENDED ACCEPTANCE RECORD

**Date:** 2026-11-09 · **Base:** `main` `8bdb06d` · **Candidate:** `28.0.0-beta.1` (unactivated)
**Owner decisions this session:** phone connected for attended tests; Windows signing with a self-signed **test**
certificate; no Partner Center or Play Console account yet; promote the pin only if every gate passes.

## Verdict

Both platforms remain **CONDITIONAL GO**. The candidate pin was **not promoted**; `install/release-pin.json` is unchanged.

## Defects found and fixed

| Defect on `main` | Effect | Fix |
|---|---|---|
| `native/windows/BunnyA/AppxManifest.xml` had two `Version` attributes on `<Identity>` | Invalid XML; the MSIX could not be rebuilt from source | Removed the stale `0.5.1.0` line |
| `scripts/package-bunny-msix.ps1` `param` block had a missing comma and a duplicate `$MakeAppx` | Script did not parse | Removed the duplicate |
| `scripts/upgrade-rollback.test.mjs` took the first `Version=` match | CI stayed green over both defects | Asserts one `Version` attribute and unique, comma-separated parameters; fails on the old files |

The shipped `releases/BunnyA.Workstation-28.0.0.0.msix` was intact (SHA-256 `890de990…6012`, valid inner manifest).
After the fix the script rebuilds a `28.0.0.0` package. The rebuild's hash (`65a7ba8d…4f31`) differs from the recorded
one, so the MSIX build is **not byte-reproducible**; gate W-MSX-2 records an artifact hash, not a reproducible build.

## Android — Samsung SM-S948U, Android 17 (SDK 37), USB/adb

Rig: disposable Host on an empty scratch state folder, dev web gateway on loopback, temporary Cloudflare quick tunnel
using the installed hash-pinned `cloudflared` (`f096265e…a7e2`). All three were stopped afterwards. The owner's installed
Host and state were not touched. Screens were read with UI Automator; taps and text were sent with `adb input`.

| Case | Observed | Result |
|---|---|---|
| A-ATT-1 install and upgrade | `adb install -r releases/Bunny-A-Android-v4.apk` (`587d68d8…070a`) over an older versionCode-4 build (`d0731a1d…e56e`): Success, no prompts. Launcher alias `.MainActivity` opens `NativeCompanionActivity`, cold start 109 ms, `WebViews: 0`. Pinned home-screen shortcuts were not checked | **PASS** |
| A-ATT-1 permissions | APK requests `INTERNET`; Android 17 adds `ACCESS_LOCAL_NETWORK` itself (same as S1R1 D3) | **PASS (note)** |
| A-ATT-2 pairing | Unpaired request through the tunnel: `401 PAIRING_REQUIRED`. One-time code entered on the phone: "Supervised Work"; Host lists "Bunny Android Native Companion". Pairing is by typed address and code; the app has no QR scanner, so the "scan QR" step does not exist | **PASS** |
| A-ATT-2 reconnect | Airplane mode 13 s: "Offline… Showing data from 4:18 PM; retrying in N s". After restore it recovered by itself in **19 s**. The record requires 3 s | **FAIL against the 3 s criterion** |
| A-ATT-2 outcome unknown | Fault injection not re-run (covered by S1R1 D15) | NOT RUN |
| A-ATT-3 revocation | Host `device.revoke`: within 5 s the phone showed "Pair Again — This phone's access ended", still so after force-stop and relaunch; Host row has `revoked_at`. "Forget Locally & Re-Pair" → confirm → pairing screen | **PASS** |
| A-ATT-3 Keystore erasure | The app is not debuggable, so the key store cannot be inspected; only the behaviour above was observed | NOT ESTABLISHED |
| A-ATT-4 approval refusal | Phone chat "Create a file named attended.txt…": "Not done — Approval required on Windows Host". Task listed "waiting for approval" with **Stop** as its only action and "Open Bunny A on Windows to review and decide". No file was created | **PASS** |
| A-ATT-5 labels and cutout | No unlabelled clickable control. Landscape: content starts at 214 px, clear of the 139 px cutout. The Forget confirmation dialog was dismissed by rotation | **PASS (layout)** |
| A-ATT-5 TalkBack | Not enabled; nobody listened to announcements | **BLOCKED** |

State left on the phone: release APK installed, unpaired, rotation settings restored.

## Windows

| Case | Observed | Result |
|---|---|---|
| W-SGN-1 signing pipeline | A copy of the release MSIX was signed with `signtool` using a 90-day self-signed certificate `CN=BunnyA-Development` (thumbprint `A1BD6AA6…2405`, CurrentUser store). The signature is present and, as expected, **untrusted**. This is not production signing | **Pipeline PASS; production BLOCKED** |
| W-ATT-5 signed install and `bunny-a://` | Needs the test certificate trusted machine-wide, which needs an elevated prompt; this session was not elevated | **BLOCKED** |
| W-ATT-1 docking, W-ATT-2 Narrator, W-ATT-4 voice interruption | Need a person at this PC watching and listening | **BLOCKED** |
| W-ATT-3 mixed DPI | One monitor attached | **BLOCKED** |

## Still open

1. A-ATT-2 reconnect — resolved in code after this session: network retries are now capped at 5 s while the screen is
   open (`PollPolicy.MAX_NETWORK_RETRY_MS`; polling stops in `onStop`), and the criterion reads "within 5 s". Not yet
   re-run on the phone: needs a rebuilt APK and one attended airplane-mode check.
2. Owner-attended: TalkBack, Narrator, voice interruption, docking, and a second monitor for mixed DPI.
3. Elevated trust of the test certificate, then the signed MSIX install and protocol test.
4. Production Authenticode certificate, Partner Center publisher CN, Play Console and upload key.
5. Pin promotion, after the above.
