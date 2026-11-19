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

1. ~~A-ATT-2 reconnect~~ — closed: re-run on the phone with v5 on 2026-11-14, **PASS** 3/3 (see below).
2. ~~W-ATT-1 docking & W-ATT-3 mixed-DPI multi-monitor~~ — closed: verified on dual mixed-DPI displays (150% ↔ 100%) on 2026-11-19 after fixing cross-monitor drop snapping, **PASS** (see below).
3. Owner-attended still open: TalkBack listening (automated check done 2026-11-14), Narrator listening (automated UIA check done 2026-11-19, see below), and `W-ATT-4` acoustic voice interruption.
4. Elevated trust of the test certificate, then the signed MSIX install and protocol test (`W-ATT-5`).
5. Production Authenticode certificate, Partner Center publisher CN, Play Console and upload key.
6. Pin promotion, after the above.

## Rebuild after launch-prep changes (2026-11-13, commit `cc22bf9`)

Built with the pinned toolchain in `test-results/native-toolchain` (SDK 8.0.408, runtime 8.0.33):

| Artifact / check | Result |
|---|---|
| `BunnyA.Tests` (pinned .NET 8) | ALL PASSED |
| `BunnyA.OutcomeTests` (pinned .NET 8) | 114/114 |
| `releases/msix-cc22bf9/BunnyA.Workstation-28.0.0.0.msix` | SHA-256 `2909d574…5ffd`; inner `<Identity>` has one `Version` (`28.0.0.0`), publisher `CN=BunnyA-Development` (test); `BunnyA.dll` carries the new "Voice offline" label |
| `releases/Bunny-A-Android-v5.apk` | SHA-256 `700fcd56…5f10`; v5 / 2.3, target API 36, `INTERNET` only, signing cert `51b965f3…` (same as v4) |
| `releases/Bunny-A-Android-v5.aab` | SHA-256 `d2a70828…18bc`; unsigned base, needs the owner's upload key |

The earlier recorded MSIX (`releases/BunnyA.Workstation-28.0.0.0.msix`, `890de990…6012`) was left in place. The candidate
pin is re-cut after this branch merges, against the merge commit on `main`.

## A-ATT-2 reconnect re-run on v5 (2026-11-14)

Owner present with the phone (SM-S948U) on USB; owner approved the quick tunnel for this test. `releases/Bunny-A-Android-v5.apk`
(`700fcd56…5f10`, v5 / 2.3, target API 36) installed over adb. Rig: disposable Host (`BUNNY_HOST_DATA_DIRECTORY` in a
scratch folder, port 43771), vite on loopback 8090, cloudflared quick tunnel (hash-pinned binary). QUIC to the Cloudflare
edge timed out on this network, so the tunnel ran with `--protocol http2`. The owner paired the phone by address and
one-time code; the Host listed "Bunny Android Native Companion".

Method: airplane mode toggled from the PC (`adb shell cmd connectivity airplane-mode enable|disable`), held ~13 s as in
R3. After disable, a loop took a screenshot about every 0.4 s and pinged 1.1.1.1 from the phone until the first reply
("network restored"). Recovery = first screenshot where the offline banner is replaced by "Updated … • refreshes every
5.0 s while open" (banner detected by its yellow pixels; frames at the boundary checked by eye). Criterion: reconnect
within 5 s of network restoration while the screen is open.

| Run | Airplane held | Network restored after disable | Banner last seen | Live data first seen | Recovery after network restored | Result |
|---|---|---|---|---|---|---|
| 1 | 13.18 s | 3.08 s | 7.61 s | 7.95 s | 4.5–4.9 s | PASS |
| 2 | 13.14 s | 3.08 s | 7.31 s | 7.67 s | 4.2–4.6 s | PASS |
| 3 | 13.11 s | 3.83 s | 7.44 s | 7.83 s | 3.6–4.0 s | PASS |

**A-ATT-2 reconnect: PASS (3/3)** against the 5 s criterion, with little margin (worst 4.9 s). The ping gives an upper
bound for when the network came back (screenshot loop granularity ~0.4 s), so true recovery may be slightly longer.
R3 measured 19 s on v4.

Observed, not part of the criterion: while offline the banner read "retrying in 4 s" in every frame (at 4.2 s and 11.6 s
of airplane mode and up to 7.6 s after restore); the countdown text did not change between frames.

Teardown: tunnel, Host and vite stopped; the public URL returned 530 afterwards; `src/routeTree.gen.ts` reverted. The
phone still holds a pairing for the now-deleted test Host. Screenshots are in the session scratch folder, not committed.

## A-ATT-5 TalkBack, rotation and cutouts on v5 (2026-11-14)

Same phone and rig recipe as the A-ATT-2 re-run (fresh disposable Host, new quick tunnel approved by the owner, HTTP/2).
The phone was paired from the PC with `adb shell input`.

**TalkBack listening: NOT RUN.** TalkBack was enabled over adb and bound, but its first-run tutorial took the screen; it
was then switched off on the phone, and re-enabling it over adb three times did not bind the service again. Nobody
listened to announcements. The owner chose an automated check instead; it is recorded below and is not an attended
TalkBack pass.

**Automated accessibility check (`uiautomator dump` of every screen).** TalkBack reads a control's content description,
or its text when there is none. Checked: every clickable or editable node has one; tap targets are at least 48 dp (180 px
at 600 dpi); hierarchy order matches the visual order.

| Screen | Controls and accessible names (hierarchy order) | Result |
|---|---|---|
| Pairing | "Workstation HTTPS address" (edit), "One-time pairing code" (edit), "Pair Securely", "Close" | All named; both edit fields 163 px tall (~43 dp) |
| Tasks | "Refresh Now", "Tasks tab, selected", "Chat tab", "System tab" | All named |
| Chat | "Message" (edit), "Send", "Stop", tabs | All named |
| System | "Appearance System, follows this phone's dark mode, selected", "Appearance Light", "Appearance Dark", "Glass intensity 85 percent of 100" (slider), "Sync Now", "Unpair & Revoke This Phone", tabs | All named; "Unpair & Revoke" shows 174 px because the scroll viewport clips it (see below) |

Tabs announce their selected state; the slider announces its value. Tasks and Chat were in their empty states ("No
missions or tasks", "No messages yet"), so populated lists were not checked.

**Rotation and safe area.** Rotation was locked from the PC (portrait, landscape 90°, landscape 270°) and restored to
auto-rotate afterwards. Safe areas came from `dumpsys window displays` (non-decor frame excludes the camera cutout and
gesture bar): portrait `[0,139]–[1440,3064]`, 90° `[139,0]–[3120,1384]`, 270° `[0,0]–[2981,1384]`. Every visible app
node on all three tabs, in all three orientations, lies inside the safe area. The landscape screenshot shows content clear
of the cutout on the left and the tab bar above the gesture bar. In landscape the System tab scrolls (`scrollable=true`)
to reach "Sync Now" and "Unpair & Revoke".

| Part | Result |
|---|---|
| TalkBack announces all controls | Automated: all controls named (PASS); attended listening **NOT RUN** |
| Rotation portrait ↔ landscape | **PASS** (both landscape orientations) |
| No overlap with cutout or gesture bar | **PASS** |
| Tap targets ≥ 48 dp | **2 below**: the two pairing edit fields (~43 dp). Fixed in source, see below |

**Tap-target follow-up (2026-11-14, no phone).** "Unpair & Revoke This Phone" is not undersized: in the portrait dump its
bounds are `[75,2649][1365,2823]` and the scrollable container ends at 2823, so the dump reports the clipped part of a
button that sits at the bottom edge of the viewport. It is built by the same helper as "Sync Now", which measures 180 px
(48 dp). The two pairing fields were really 163 px; `NativeCompanionActivity` now gives both a 48 dp minimum height. The
change compiles (`javac --release 8` against the pinned `android.jar`). It is **not** in the v5 APK.

**Re-measured on the phone the same day.** The phone held the v6 build from `feat/android-on-device-voice`
(versionCode 6, 2.4 GB of app data), so a v5 build could not be installed over it without a downgrade. The same
two-line change was applied temporarily in that worktree, built with `scripts/build-android.ps1`, and installed with
`adb install -r`. `uiautomator dump` of the pairing screen: before, both fields 163 px; after, "Workstation HTTPS
address" 180 px and "One-time pairing code" 180 px (48 dp at 600 dpi), "Pair Securely" and "Close" 180 px. **PASS**,
measured on a v6-line build, not on a v5 build. Afterwards the worktree was reverted, its v6 artifact restored, and the
original v6 APK reinstalled (installed SHA-256 `cc6b938c…` matches the artifact; app data still 2.4 GB).

Teardown: Host, vite and tunnel stopped (old URL returned 530); TalkBack off; rotation restored; the app's data was
cleared so it no longer holds the test pairing. Dumps and screenshots are in the session scratch folder, not committed.

## Pairing-address crash found and fixed on the phone (2026-11-15)

Found while checking the address guard on the phone (USB/adb, no Host and no tunnel; the pairing screen needs neither).

**Defect.** On the installed v6 build (`cc6b938c…`), typing `https://[::ffff:127.0.0.1]` and any code, then "Pair
Securely", **crashed the app**: `FATAL EXCEPTION … java.lang.AssertionError at com.android.okhttp.HttpUrl$Builder.canonicalizeHost`,
reached from `HostExchange.send`. Android's built-in HTTP stack throws an unchecked error on an IPv4-mapped IPv6 literal,
and the app caught only `Exception`. The same code is in the v5 APK; v5 was not run for this.

**Fix (source only).** `ServerAddress.normalize` now treats `[::]`, `[::1]` and IPv4-mapped loopback as this phone,
rewrites any other IPv4-mapped literal to its plain IPv4 form, and refuses bare-number and hex spellings of an address.
`HostExchange.send` reports an unchecked error from `connect()` as "not sent". JVM tests: `ServerAddressTest` 31 checks,
`HostExchangeTest` 38 checks.

**Re-check on the phone** (the same changes built temporarily on the v6 line, installed with `adb install -r`):

| Address typed | Result |
|---|---|
| `https://[::ffff:127.0.0.1]` | App stays on the pairing screen, no connection attempt, no crash |
| `https://2130706433` | App stays on the pairing screen, no connection attempt, no crash |
| `https://[::ffff:192.0.2.1]` | "Verifying pairing with workstation…", then "The workstation could not be reached…"; no crash |

The pairing screen blocks screenshots, so the field's error text was **not read**; the results come from `uiautomator`
dumps, the process list and `logcat` (0 `FATAL EXCEPTION` lines). Afterwards the worktree was reverted, its v6 artifact
restored and the original v6 APK reinstalled (hash `cc6b938c…`, app data 2.4 GB). No built APK contains these fixes.

## Rebuild after security and Android fixes (2026-11-18, commit `5435cd1`)

Built after committing the Android pairing-address crash guard, 48 dp pairing-field minimum height, paired-device
approval provenance, and Host/Mission hardening (`bf23b0c`, `b2e2cc6`, `5435cd1`):

| Artifact / check | Result |
|---|---|
| `npm run typecheck` & `npm run lint` | PASS (0 type errors; 0 lint errors, 41 pre-existing warnings) |
| `npm run test:ui` | 480 / 480 PASS |
| `npm test` (full Host, Missions, scripts, MA4) | PASS (exit 0) |
| `npm run build` | PASS (`src/routeTree.gen.ts` reverted afterwards) |
| `BunnyA` WPF build + `BunnyA.Tests` (pinned .NET 8) | 0 warnings, 0 errors; ALL PASSED |
| `BunnyA.OutcomeTests` (pinned .NET 8) | 114 / 114 |
| Android JVM suites (via `build-android.ps1` / `build-android-aab.ps1`) | ALL PASSED (`ServerAddressTest` 31, `HostExchangeTest` 38, `ChatTurnTest` 55, `CompanionAppearanceTest` 40, `PollPolicyTest` 23, `KeystoreErasure` 5, cookie & launcher checks) |
| `releases/msix-5435cd1/BunnyA.Workstation-28.0.0.0.msix` | SHA-256 `e7d39f5b…3737`; Version `28.0.0.0`, Publisher `CN=BunnyA-Development` (test) |
| `releases/Bunny-A-Android-v5.apk` | SHA-256 `86b0c2d4…bcb5`; `classes.dex` `7247ef17…0146`; v5 / 2.3, target API 36, `INTERNET` only, signing cert `51b965f3…` |
| `releases/Bunny-A-Android-v5.aab` | SHA-256 `d8a79645…7cd7`; unsigned base (`bundletool validate` & split generation PASS), needs the owner's upload key |

The earlier recorded MSIX (`releases/BunnyA.Workstation-28.0.0.0.msix`, `890de990…6012`) and active production pin
(`install/release-pin.json`) were left untouched. The newly built v5 APK/AAB now include the 48 dp pairing-field height
and IPv4-mapped IPv6 crash fixes.

## Windows W-ATT-1 / W-ATT-3 attended check & W-ATT-2 automated UIA check (2026-11-18–19)

Rig: disposable Host on an isolated scratch folder (`BUNNY_HOST_DATA_DIRECTORY`, port `43779`, `operationalState: healthy`)
and `BunnyA.exe` with isolated `BUNNY_HOST_CREDENTIALS_FILE` and `BUNNY_CONFIG_DIRECTORY`. The owner's installed Host,
settings, and audio configuration were not touched; the disposable Host was stopped afterwards.

Monitors observed via `PerMonitorV2` (`EnumDisplayMonitors` + `GetDpiForMonitor`):
- `\\.\DISPLAY1` (Primary): `(0,0)–(3200,2000)`, work `(0,0)–(3200,1928)`, **144 DPI (150%)**
- `\\.\DISPLAY21` (Secondary): `(-1280,-164)–(0,860)`, work `(-1280,-164)–(0,812)`, **96 DPI (100%)**

**Defect found during attended drag across mixed-DPI displays (`W-ATT-1` / `W-ATT-3`).**
Docking within a single screen worked, and the first move onto the secondary display worked, but moving the notch back
between the 150% and 100% displays got stuck on the previous monitor:
1. `NotchWindow.SnapToNearestEdge` computed the drop center from the pre-drag window size and grip offset measured at
   the old monitor's DPI, pulling the drop point back across the monitor seam.
2. `dragging` was cleared before `SnapToNearestEdge` ran, letting `WM_DPICHANGED` / `SizeChanged` invoke `Place()`
   mid-snap against the old edge/monitor.
3. Vertical mode (`Left`/`Right`) contained only `Button` controls (which consume `MouseLeftButtonDown`), leaving no
   dedicated drag grip.

**Fix.** Extracted pure physical-pixel drop/edge math into `native/windows/BunnyA/Services/NotchPlacement.cs` (target
monitor chosen from the drop cursor and clamped strictly inside the destination work area; 9 new unit checks in
`BunnyA.Tests`), guarded `ApplyEdgePlacement` with a `placing` lock and a post-DPI-settle pass in
`NotchWindow.xaml.cs`, and added an always-visible drag grip (`⋮⋮` horizontal / `⋯` vertical) in `NotchWindow.xaml`.

| Case | Observed | Result |
|---|---|---|
| W-ATT-1 edge docking & multi-monitor drag | Owner re-tested rebuilt `BunnyA.exe` after the fix: four-edge docking and dragging between both monitors worked cleanly; scratch `config.json` confirmed settled drop back on primary (`NotchEdge: Top`, `NotchOffsetRatio: 0.6128125`, `NotchLeft: 1409`, `NotchTop: 0`) | **PASS** |
| W-ATT-3 mixed-DPI multi-monitor scaling | Verified live across 150% (`DISPLAY1`) ↔ 100% (`DISPLAY21`) with `PerMonitorV2` active | **PASS** |
| W-ATT-2 UIA accessibility & keyboard control | **Automated UIA check** against the disposable Host with a seeded `waiting_for_approval` task (`368d0125…`): **0 unlabelled keyboard-focusable buttons** across `Bunny Island Notch` (8 buttons, canonical agent order `AgentGada → AgentSpear → AgentChakra → AgentSword`) and `Bunny A — Native Workstation` (14 nav/header buttons). Invoking `ApprovalBadge` (`Open the Approval Center`) via UIA `InvokePattern` opened Approval Center (`1` list item), exposed focusable `ApproveActionButton` (`✓ Approve`) and `DenyActionButton` (`✗ Deny`), and invoking `DenyActionButton` moved the task to `stopped`. **Attended Narrator listening: NOT RUN** | **Automated UIA: PASS; Narrator listening: NOT RUN** |
| W-ATT-4 full-duplex acoustic voice interruption | Owner opted out of voice testing in this session | **BLOCKED** |
| W-ATT-5 signed MSIX install & `bunny-a://` | Non-elevated session; test-cert trust or production signing not run | **BLOCKED** |

**Rebuilt artifacts & checks after notch fix:**
- `native/windows/build.ps1` (`BunnyA` WPF + `BunnyA.Tests` incl. 9 placement tests): 0 warnings, 0 errors; **ALL PASSED**
- `BunnyA.OutcomeTests`: **114 / 114 PASS**
- `scripts/upgrade-rollback.test.mjs`: **6 / 6 PASS**
- `releases/msix-watt-notch-fix/BunnyA.Workstation-28.0.0.0.msix`: SHA-256 `88b34e8d…4e06` (v28.0.0.0, `CN=BunnyA-Development`)
