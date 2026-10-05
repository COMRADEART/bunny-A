# M-A-2 Gate T6

**BUNNY_MA2_T6_FAIL.** The installed T5 release successfully handled real public
HTTPS pairing, state, a completed local direct Task, remote approval, a deterministic
Mission and isolated Git Stop. Acceptance is incomplete: the real public browser later
returned **Cloudflare Error 1033 / HTTP 530 repeatedly**, including after the installed
tunnel supervisor restarted its child. Public stale-session/revocation and the final
Mission render could not be accepted during this failure. Physical Android installation
and pairing remain unverified. No full M-A-2 verdict is issued.

Evidence: `test-results/ma2-gate6/`. This is an acceptance-only gate against the installed
`Bunny-A-Windows-v17-T5`; Host, dashboard, authority and process ownership source were not
changed. The user's additional APK request was completed by rebuilding the existing
Android companion from the recorded, clean source identity.

## IMPLEMENTED

- Recorded branch `ma2-operational-hardening`, HEAD
  `1a9bd6988b4b30d99e3d49c16847fe62bfcdac46` and initial Git status. The three
  pre-existing untracked user reports were preserved.
- Verified the actual installed release and its 156 manifest entries, the canonical
  cloudflared binary/hash/version, live process identities and production configuration.
  Created a consistent schema-3 database/configuration backup before test mutations.
- Started the real installed `Start-Bunny-Release.ps1 -NoIsland` path. Existing Host,
  gateway and Island were reused. The worker and cloudflared came from the installed
  release and application-owned tool location, respectively.
- Built a signed, installable **Bunny-A Android 2.0 APK** using the existing Android
  source and local, previously installed build tools. It is an HTTPS WebView companion
  using existing pairing and revocation, with no embedded server address or master token,
  no native JavaScript bridge and Internet permission only. The user was given its file
  link and asked to confirm phone installation/model before another one-time code.
- Used disposable repositories/projects and harmless local hook children. Created two
  direct Task records and three Mission records, retaining their audit history. Removed
  only the three temporary project registrations and revoked all three temporary clients.
  Original production history was preserved. Missions and triggers are OFF.

## LIVE VERIFIED

| Property | Actual evidence and limit |
| --- | --- |
| Installed public HTTPS chain | `tunnel-start.json`, `public-endpoint.json`: public DNS, a non-loopback Cloudflare edge, valid wildcard certificate and installed gateway response; TLS verification stayed enabled |
| Unpaired denial | `unpaired-auth-boundary.json`, `unpaired-denial.json`, `header-security.json`: correct browser protocol without a device receives pairing denial, invalid/cross-site cases fail safely, `/state` and `/events` are not public Host routes |
| Fresh pairing and state | `pairing.json`, `paired-state.json`: new device `6bccafe0-5258-4e87-aa01-82c9a4cd247b`; secure HttpOnly SameSite=Strict cookie; Host identity/history/providers readable only after pairing |
| Actual mobile browser pairing | Additional supported UI clients `ce764606-6b20-4f90-a539-86ee6b46dc46` and `4c05f639-9993-425e-8184-f6ecf2c0273c`, at the original/restarted origins; these are laptop browser tests, not physical Android evidence |
| Direct Task and approval | `remote-task.json`, `remote-approval.json`: Task `cf021271-ed8c-4874-8f0f-31a64021ae33` submitted over the original public origin and approved in the real mobile UI, completed locally with `T6_LOCAL_OK`; provider output remains suppressed and independent verification is not fabricated |
| Honest bounded first attempt | `remote-task-first-attempt.json`, `remote-task-timeout.json`: first cold-model Task `5fbc6216-a36b-491e-b74d-d107b661fa1a` stopped at its 90-second limit. A bounded, prompt-free local model load preceded the successful retry; no paid provider was used |
| Mission and scope | `remote-mission.json`: Mission `e17f7115-591a-435e-b806-73f6a83e6120`, deterministic `git.snapshot`, remotely submitted/approved/completed in a disposable project using existing authority |
| Remote Stop and isolation | `remote-stop-active.json`, `remote-stop.json`: canonical Stop ended Mission A's Git hook/child; Mission B retained the same process creation times and kept running until separately stopped. Both Mission/step states became stopped; no delayed child marker appeared afterward |
| Disconnect/reconnect | `network-loss.json`, `sse-reconnect.json`: real HTTPS client polling paused for five seconds while Host work continued; reconnect returned canonical state, advancing cursor and unique logical activities. This did not simulate physical Wi-Fi loss |
| Tunnel child failure | `tunnel-failure.json`: only the session-created child, matched by executable, parent and creation time immediately before termination, was killed. Remote unavailability was observed; Host and local gateway remained healthy |
| Installed automatic restart | `tunnel-restart.json`: the same installed worker spawned a new child and new quick hostname. Initial DNS propagation failed, then normal DNS/TLS and paired state worked. Old hostname returned 530. This brief success does not establish sustained availability |
| Canonical revocation | `revocation.json`, `production-preservation.json`: after supported workstation revocation, the old device credential received Host HTTP 401 without Host restart. Retries overwrote the original timing, so an immediate enforcement latency is not claimed. All temporary device rows remain as revoked audit history |
| Public privacy | `token-leak-audit.json`: actual public HTML, observed JS/CSS, paired projection, public health and all seven decompressed APK entries contain no master credential. Raw provider output, logs and process trees are suppressed. Existing authorized Task input remains governed by the unchanged T5 contract |
| Phone rendering | `phone-render.json` and inspected screenshots: real public 390×844 dark/light views, readable Task approval and Codex detail, Stop control observed, no horizontal overflow or observed console errors. The final Mission render was blocked by actual Cloudflare 1033 |
| Local preservation | `production-preservation.json`: original Host instance/PIDs/creation times, healthy local gateway, loaded Island, all 156 release hashes, T1 hashes, state/workspace, install configuration and consent retained; original 54 Tasks, 3 Missions, 13 projects and 9 historical device rows unchanged |
| Regression and builds | `full-tests-windows.log`, `ui-tests.log`, `typecheck.log`, `lint.log`, `normal-build.log`, `windows-desktop-build.log`: 240 script + 311 application + 34 UI = **585/585**, typecheck, lint (0 errors, 10 existing warnings), normal build and pinned Windows desktop rebuild pass |

The disposable Git snapshot skill recorded its expected three additional runs, one success
and two stopped attempts. Its reviewed definition/authority remained unchanged. Provider
probe timestamps/observations refreshed normally. These are documented runtime observations,
not unexplained changes to accepted state.

## SIMULATED

Client network interruption was modeled by ceasing real HTTPS polling; no physical radio,
router or cellular outage was controlled. Existing full tests also cover invalid authority,
unknown Codex compatibility, T3 fatal containment, T4 ownership and T5 safe projection.
Those tests supplement the live evidence; they do not replace unavailable public or physical
device acceptance. An initial sandbox-only regression run lacked Windows CIM access; the
complete native Windows rerun passed. Acceptance harness errors were corrected and are not
represented as production Host failures.

Four disposable migration-test Hosts outlived that restricted run because its CIM cleanup
was denied. Each was subsequently terminated through its live process handle after checking
the exact launch evidence, executable, parent, command hash and creation time. Production
Host identity stayed unchanged; `test-host-cleanup.json` records their completed cleanup.

## STATIC VERIFIED

- Installed gateway/Host authentication, explicit trusted peer boundary, Origin/Sec-Fetch
  checks and revocable device authentication remain unchanged. Forwarded localhost claims
  do not grant workstation authority; remote workstation-only commands were denied live.
- The Host API remains loopback-only. Cloudflared targets only gateway `127.0.0.1:8084`.
  Its diagnostic listener was observed on loopback. No public Host/debug route was added.
- Phone/dashboard use authenticated snapshot polling and existing Host sequence/revision
  semantics. There is no public authenticated SSE or WebSocket path to claim as tested.
  [Cloudflare quick tunnels](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/)
  do not support SSE.
- Existing pairing abuse controls are five attempts per client and 100 globally per ten
  minutes; the full regression includes the existing limiter behavior.
- APK manifest: API 26 minimum / API 35 target, backup and cleartext disabled, mixed content,
  file/content access and third-party cookies disabled, invalid certificates rejected.
  Signatures v2/v3 verify; 21 connection policy checks pass. No keystore/password is included.
- The reviewed T1–T5 source and installation remain intact. No scheduler, authorization
  system, remote control plane, AG-UI, Slack/calls or T7–T10 implementation was introduced.

## NOT TESTED

Physical Android installation, model/WebView/browser identity, external-Wi-Fi traffic and
device-side approval/Stop are **NOT TESTED**. The user reports an Android phone on external
Wi-Fi, but has not supplied the requested installation/pairing confirmation; no phone
record was observed. No emulator is being described as a physical phone.

The computer-use read-only page scope does not expose `document.cookie`, localStorage or
sessionStorage. Their direct browser inspection is **NOT TESTED**; live Set-Cookie flags,
all observable public payloads/HTML/assets, APK contents and unchanged server-side
credential handling were audited instead. Native Island visual control is unavailable in
this tool session; its unchanged loaded process/binary and accepted T5 render are preserved.

Live repeated invalid pairing abuse, public stale-session denial after revocation, cached
page reload after revocation, and final public Mission rendering did not complete acceptance.
Private physical Host ports were not probed from an external Android network. Production
Host crash, paid providers, credential helpers, named tunnels and custom domains were not
part of these tests.

## BLOCKED

**BLOCKER: sustained installed public transport / Error 1033.** Both quick hostnames
returned repeated public HTTP 530 responses. The real browser reload displayed Cloudflare
Error 1033; this is more than a mocked or desktop-only failure. Loopback Host/gateway
remained healthy and retained their original identities. The installed cloudflared child
remained alive, with repeated edge registrations/unregistrations observed in its loopback
metrics. The cause between cloudflared, network and Cloudflare has not been determined.
[Cloudflare's Error 1033 documentation](https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-1xxx-errors/error-1033/)
describes the lack of a healthy connector route. IPv4 and IPv6 diagnostics both briefly
succeeded; no address family is being claimed as the proven cause or repair.

Public revocation/stale-session checks used bounded retries and fresh TLS connections,
but transport responses cannot be counted as Bunny authorization denials. Canonical local
401 and revoked database rows are proven; public acceptance remains blocked. The APK is
built and signed, but its connection can encounter the same tunnel failure. T6 cannot pass
with this blocker and the incomplete phone acceptance. Authentication/TLS was not weakened
to obtain a passing result, and no speculative production patch was activated.

## DEFERRED

Physical phone acceptance and remaining public checks must resume after the actual installed
transport is reliable. Named tunnel/custom domain choices remain outside T6. T7–T10 and
the full operational verdict remain open.

## Public endpoint identity

- Original quick origin: `https://sellers-roughly-sample-suspected.trycloudflare.com`.
- Restarted quick origin: `https://martin-lovely-myself-tomatoes.trycloudflare.com`.
- Both are temporary runtime identities, not permanent addresses. The original endpoint
  became unusable after restart; the second subsequently showed the same 1033 failure.
- Worker PID 8420, created `2026-10-05T02:36:29.4439380Z`, installed
  `Bunny-A-Windows-v17-T5/scripts/bunny-tunnel.mjs`. Initial child 13948 was deliberately
  terminated only after exact live identity checks; restarted child 26404 is recorded.
- Tool: `C:\Users\allam\AppData\Local\Bunny-A\state\cloudflared\cloudflared.exe`,
  version 2026.9.3, SHA-256
  `f096265ec2fcbe9bb6e2d64268db167ced3fcbb83d894bdb9e2fcdb26f2ea7e2`,
  matching the recorded expected hash. No binary update or download occurred.
- TLS wildcard `*.trycloudflare.com`, Google Trust Services WE1, verified August 7–November
  5, 2026 validity; DNS/edge/certificate fingerprint and cf-ray values are in the JSON evidence.

## Pairing/revocation results

Fresh supported HTTPS and UI pairing worked before transport failures. The master Host
credential stayed server-side. All three temporary clients are now revoked and their
private test-cookie file was removed. Their audit records were retained. Canonical revocation
requires no Host restart; its public stale-session proof is incomplete because of 1033.
Any later phone test needs a newly generated one-time code and the currently valid temporary
hostname, rather than a revoked test credential or an expired invitation.

## Remote Task/Mission acceptance

One cold-model Task honestly stopped at the bounded limit; its warmed local retry completed
and was approved through the actual public mobile UI. It is a completed text result without
independent verification. The deterministic Git Mission completed through existing approval
and capability authority; two separate Git Missions demonstrated remote Stop isolation and
no delayed hook-child completion. Their history remains retained. Missions/triggers were
restored OFF, and all three disposable project registrations were removed. Test repositories
remain under the recorded T6 workspace for review.

## Local preservation

Host PID 22184 / instance `046c323b-5e58-45e9-9922-bdc53d2d0c78`, gateway PID 22060
and Island PID 21224 retain their exact baseline creation times. State remains at
`C:\Users\allam\AppData\Local\Bunny-A\state`, database `host.sqlite`, workspace
`C:\Users\allam\Bunny-Workspace`. Database integrity is `ok`, schema 3.

All original rows checked for Task/Mission/history/authority/skills/project/device data remain
intact. Final totals are 56 Tasks, 6 Missions in the database, 13 registered projects and
12 historical device rows; three additional revoked test devices have no live authority.
Accepted T1 protected hashes and install configuration are unchanged. The backup is
`C:\Users\allam\AppData\Local\Bunny-A\backups\t6-remote-acceptance-2026-10-05T02-35-45-634Z`.

## Candidate identity

No new Windows release was manufactured for acceptance-only work. Production remains
`Bunny-A-Windows-v17-T5` / `17.0.0-T5`, Host/dashboard source
`eb96c053c238ec0bd385187e0f4dad6777a0a4bc`, tooling
`ec81f9b9dbab4236b735f917a89cf3e8393024f4`, manifest SHA-256
`f0531f8d2a02ed3302c3b4ade5e28859e39ec1dba380cf3f8596866ac4a18a4e`.
The disposable desktop rebuild uses those exact commits; it was not installed or activated.

Android artifact: `releases/Bunny-A-Android-v2.apk`, package `com.routeragent.jev`,
version 2.0, SHA-256
`c2345d32af1b157fdad137bd64a038ac93ea0616b6695b9060cfa3717fb8c168`.
Rebuilt from source HEAD `1a9bd6988b4b30d99e3d49c16847fe62bfcdac46`; its Android
source last changed in `ea0e803b8186ac777ba67f4c47db58ccd6b4407d`.
Signer certificate SHA-256
`51b965f39ad64cc2b593c5d5a90fe307f368e19511338a163f90bf4310152dd7`.
`android-apk.json` records per-source/tool hashes and build identity; the signing key stays
private and outside the artifact. Android runtime acceptance is not inferred from signing.
