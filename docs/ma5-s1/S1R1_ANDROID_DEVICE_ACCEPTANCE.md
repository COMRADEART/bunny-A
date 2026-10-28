# MA5-S1R1: Android physical device acceptance

The owner connected a phone during S1R1 and approved two things:
- upgrading its installed Bunny A in place;
- pairing it only with a **disposable** Host.

The owner's real Host, its credentials and its paired devices were not touched.

## Setup

| Item | Value |
|---|---|
| Device | Samsung Galaxy SM-S948U (`m3q`), Android 17 (SDK 37), over USB/adb |
| Installed before | `com.routeragent.jev` versionCode 3 / 2.1 (WebView app), first installed 2026-10-05, signer `51b965f3…2dd7` (`CN=JEV Local Build`) |
| Installed build | The tested S1R1 build (`classes.dex` `5573629c…eee5`, later `10bc29f1…e14f` after the gateway fix below), **re-signed with the same key as v3** so Android accepts it as an upgrade. The CI/worktree key (`76c0b488…`) differs and would have been refused |
| Host | Disposable `startHost` in an empty temp folder. Real web gateway (S1R1 worktree, Vite dev) with explicit `BUNNY_HOST_DATA_DIRECTORY` / `BUNNY_HOST_CREDENTIALS_FILE` / `BUNNY_REMOTE_ORIGIN` |
| HTTPS | A temporary Cloudflare quick tunnel (`*.trycloudflare.com`, publicly trusted certificate) using a private copy of `cloudflared`. Stopped after the test |
| Driving | `adb input` for taps and text. UI Automator dumps for on-screen text, which also works on `FLAG_SECURE` screens. `screencap` for non-secure screens |

The test harness was scratch-only and is not part of the PR. Evidence: `evidence/s1r1/android-device/`. UI dumps
were filtered to `com.routeragent.jev` nodes; screenshots show only the app and the status bar.

## Results

| # | Check | Observed | Verdict |
|---|---|---|---|
| D1 | Upgrade over v3 | `adb install -r`: **Success**; versionCode 4 / 2.2; same package id and signer | **PASS** |
| D1a | v3 app data kept by the upgrade | After the install, user 0 shows `firstInstallTime` = today and `notLaunched=true`, so Android reset the per-user install record. The app is not debuggable, so its data folder cannot be inspected. v3's data was WebView storage that the native app never reads | **NOT ESTABLISHED** |
| D2 | Native launcher, no WebView | The launcher intent resolves to `.MainActivity` (the alias) and the resumed activity is `com.routeragent.jev/.MainActivity`. The app has no renderer process; the `webview_zygote` processes are system-wide | **PASS** |
| D3 | Permissions | The APK declares only `INTERNET`. Android 17 itself grants `ACCESS_LOCAL_NETWORK`, which is not in our manifest, and v3 had the same | **PASS** (note) |
| D4 | Pairing screen is secure | `screencap` of the pairing screen is fully black (`FLAG_SECURE`), while UI Automator shows its native fields | **PASS** |
| D5 | Pairing over trusted HTTPS | One-time code → "Supervised Work". The Host lists the device "Bunny Android Native Companion". An unpaired request through the tunnel gets 401 `PAIRING_REQUIRED` | **PASS** |
| D6 | Workstation-only authority | A chat prompt routed by the Host to `codex · gpt-6.1-sol`. The task was created waiting for Windows approval, and the phone's approve was refused: "Approval required on Windows Host…". Nothing ran | **PASS** |
| D7 | Stop from the phone | Chat Stop: Host task → `stopped`; the line shows "Stopped."; Stop disabled afterwards | **PASS** |
| D8 | Lost connection to the Host's address | The tunnel was closed: "⚠️ Offline: … Showing data from 12:00 PM; retrying in 31 s", with bounded backoff (31 → 59 s) | **PASS** (wording: Cloudflare's 530 is called "the workstation refused this request") |
| D9 | Revoke while the Host is unreachable | "Revocation Not Confirmed … This phone kept its credential." It did not pretend to unpair | **PASS** |
| D10 | Revoke while the Host is reachable | "This phone was revoked and its local key erased." The Host device record has `revoked: true`. The pairing screen returns | **PASS** |
| D11 | Polling stops in the background | Host-side count of the phone's state reads: 3 in 30 s in the foreground; **0 in 30 s after Home**; reads resume within 12 s of returning | **PASS** |
| D12 | Poll cadence matches the label | Chat tab "refreshes every 10.0 s": measured intervals 10.4 s, 10.2 s, 10.2 s | **PASS** |
| D13 | Session survives an app update | After reinstalling the fixed build over the paired one, the app opened straight to "Supervised Work", still paired | **PASS** |
| D14 | **Command applied, answer lost: before the gateway fix** | Fault: the Host applies the phone's next command and its connection is destroyed before the answer leaves. The phone showed **"Not done — The workstation Host is not available right now."** The Host's tasks went 1 → 2 | **FAIL (defect found)** |
| D15 | **Same fault after the fix** | The phone shows **"Outcome unknown — Connection interrupted. Bunny A cannot confirm whether this operation completed. It was not automatically retried. Review the current task and Host state before taking another action."** Host tasks 2 → 3; **exactly one** device `/command` reached the Host; no retry | **PASS** |

## Defect found on the device (D14) and its fix

The phone does not talk to the Host directly. The gateway (`src/lib/orch/native-companion.server.ts`) forwards the
command. When the Host's answer was lost after delivery (reset, the 10 s timeout, or an unreadable body), the gateway
returned `503 HOST_UNREACHABLE` "Host command unavailable", and the phone showed it as "not available" / "Not done".
The S1R1 JVM tests did not catch this, because they exercise the phone's own transport, not the gateway hop. The
dashboard's bridge (`transportFailure`) already returned `504 OUTCOME_UNKNOWN` in this case; the native gateway did not.

Fix:
- **Gateway:** once the command is handed to the Host, a lost, late or unreadable answer returns `504 OUTCOME_UNKNOWN`.
  Only a refused connection (`ECONNREFUSED`) still returns `503 HOST_UNREACHABLE`.
- **Android:** `HostExchange.refusal` maps `OUTCOME_UNKNOWN` on a command to "Outcome unknown".

Tests:
- `native-companion.test.ts`, new case with real sockets (a Host that reads the command then resets, then a closed
  port). It fails on the old gateway (`503 !== 504`) and passes on the new one. The command is delivered once and the
  phone's operation id is forwarded unchanged;
- `HostExchangeTest`: 37 checks (2 new);
- D14 → D15 on the device.

## Findings not fixed in S1R1

1. **Re-pairing after an address change.** With an unreachable Host, Unpair correctly keeps the credential (D9), but
   there is no local "forget this workstation", and the pairing screen is only reachable without a session. A phone
   whose Host address changed permanently cannot re-pair without clearing app data. Quick tunnels change address on
   every restart. During the test the app data was cleared with `pm clear`; it held only the disposable test pairing.
2. **Phone chat depends on Host routing.** The Android chat sends no model override. On this workstation the Host
   routed a short prompt to Codex, so a phone-launched local answer was not observed. The refusal itself is correct
   (D6).
3. **Offline wording.** An HTTP 530 from the tunnel provider is described as "the workstation refused this request".
4. **Chat line during an unknown outcome.** Behind the "Outcome unknown" dialog, the chat line read "Sending to the
   workstation…". Its text after the dialog was dismissed was not checked.
5. **TalkBack / screen reader** was not exercised by a person. Rotation and process death were not driven.

## State left on the device

- Bunny A is now the S1R1 native companion (versionCode 4, signed with the owner's existing local key), **unpaired**.
  The device record on the disposable Host was revoked, and that Host, the gateway and the tunnel were shut down.
- "Stay awake while charging over USB" was enabled for the session and switched back off (`svc power stayon false`).
- No files remain in the phone's Download folder. A return to v3 would require uninstalling the app.
