# M-A-2 Gate T7

**BUNNY_MA2_T7_PASS** (2026-10-06). The real Windows sign-out/sign-in acceptance passed:
the installed Bunny-A release started cleanly from the per-user Startup shortcut after a
real sign-out, recovered its canonical state, kept exactly one of every runtime process,
preserved every security boundary, and became fully usable without the development
repository or any manual intervention. The operational full-series verdict is NOT issued
(§62 — no BUNNY_MA2_OPERATIONAL_PASS claim); the factory is idle; **NEXT = T8 (pinned
rollback), not begun** (§63).

| T7 gate role | Statement |
| --- | --- |
| Gate | M-A-2 Gate T7 — real Windows sign-in / installed startup / session boundary |
| Question answered | "If the user leaves the Windows session and signs back in normally, does the installed Bunny-A release start cleanly, recover its canonical state, avoid duplicate processes, preserve security boundaries, and become usable without the development repository or manual intervention?" |
| Scope | OPERATIONAL STARTUP only: no new installer, UX, supervisor, remote or auth model; no reboot hardening (§41 reboot is not claimed); T8/T9/T10 not started; no OCT-1/OD-1 features |
| Code changes in T7 | NONE — acceptance-only gate (regression floor therefore unchanged at 592; §48) |
| Verdict | **BUNNY_MA2_T7_PASS** with 4 recorded residual observations (failure ledger, all LOW/harness-or-observation; none a startup defect) |

# Baseline

The T7 gate ran against the production installed runtime from Gate T6R
(BUNNY_MA2_T6_PASS, commit `80b90f9`, "T6R: close gate — BUNNY_MA2_T6_PASS
(installed-runtime A–Q + security suite live)"):

| Baseline fact | Value | Label |
| --- | --- | --- |
| Production release | `Bunny-A-Windows-v17-T6` at `C:\Users\allam\AppData\Local\Bunny-A\releases\Bunny-A-Windows-v17-T6` | LIVE VERIFIED |
| Source commit | `cb005ef75bf86d4d9e722b5214612fe115db5c6b` (T6R pin `90a6e8da11e77bd1d3d402c166456f0d816fb4c4`) | LIVE VERIFIED |
| Release manifest SHA-256 | `f5bf648c92711baba3fe4a24ea46c449fd8f226c0afa018f8f9cf93da52fde88` | LIVE VERIFIED |
| Install root bootstrap exe | `C:\Users\allam\AppData\Local\Bunny-A\Bunny-A.exe` (12,288 B .NET/CLR PE, FileVersion 17.0.0.0); SHA-256 recorded pre- and post-signin (identical) | LIVE VERIFIED |
| Canonical state | `%LOCALAPPDATA%\Bunny-A\state` (layout `bunny-state/2`, user_version 3, schema SHA `f92b3e1076a4e6884378426e21e53db39d04ffa88c865b58f8c7274bcb1aaa89`) | LIVE VERIFIED |
| Pre-signin instance / pids | instance `e2eed181-7ceb-4cba-81da-d292c1427da8`; Host 36800, gateway 22508, bootstrap/island 43488 (state dir at `state\.bunny-a` only for the pre-migration v16 rows — T1+ runtime uses `state`) | LIVE VERIFIED |
| Session boundary precondition | Windows session `SessionId 1` pre-signin (CIM); all Bunny processes in session 1 | LIVE VERIFIED |
| Databases backup | `test-results/ma2-gate7/pre-signin/` pre-signin DB snapshot (`VACUUM INTO`, WAL-consistent) + file hashes + shortcut identity + event sequences | LIVE VERIFIED |
| Prior gate results | T1–T5 PASS; T6 FAIL (transport) → T6R PASS; T8–T10 open | LIVE VERIFIED |

# Actual Windows sign-in procedure

## IMPLEMENTED

Nothing was implemented for T7 by design (acceptance-only gate): the release's existing
installed startup chain (§45-authorized since T6), its state machinery and its security
surfaces were exercised as-is against a real session boundary.

## Procedure executed (all LIVE VERIFIED)

1. §2/§3–§11 preparation completed first: 11 pre-signin evidence files + a rollback/recovery
   handoff (`HANDOFF.md`) existed and were verified before authorization.
2. §2 explicit sign-out authorization: the workspace owner answered **"Authorize sign-out
   now (Recommended)"** through the session's structured question; recorded in
   `pre-signin/signin-authorization.json` (digest `d037f76a78ce9892`), with the rollback
   plan (manual pinned start; VACUUM INTO snapshot; snapshot restore-by-copy only, never
   auto-merge per §56).
3. **Real sign-out performed**: `logoff.exe` for the current session at
   **2026-10-06T04:11:32.800Z** (T7_WAIT_MS harness shell ended with the session, as
   expected). No simulated shutdown, no logoff stubs, no `shutdown /l` alternatives.
4. §12 the user signed back in normally through the Windows welcome screen; the harness
   (fresh Claude session) resumed via HANDOFF.md. Per §12 the observer did **not** manually
   start Bunny: startup was observed directly from the Startup shortcut chain.
5. Post-signin observation scripts under `test-results/ma2-gate7/post-signin/` with §13
   bounded windows 0–15/15–30/30–60/60–120 s (live where the harness was present,
   reconstructed from Windows CIM process creation timestamps + the Bunny event log where
   the logoff killed the harness shell — each sample label is explicit in the evidence).

## LIVE VERIFIED

| Step | Evidence |
| --- | --- |
| Session ended at logoff | All pre-signin Bunny processes gone at first post-signin inventory; old harness shell `bsnb97xee` died at logoff (expected) |
| User sign-back-in | New Explorer `36072` in **SessionId 2** created `04:11:54.312Z` (`session-evidence.json`) |
| Natural startup (no manual start) | Root bootstrap `Bunny-A.exe` pid **34004** parented to Explorer 36072, born `04:12:19.208Z` (§12 observed, not started) |
| §52 session boundary | Pre-signin session 1 → post-signin session 2 for user shell; every Bunny process in session 2 (`post-signin-processes.json`) |
| §53 no repo/dev parents | `repoParented: []`; zero processes with repo or dev-server command lines or parentage |

## SIMULATED

| Item | Statement |
| --- | --- |
| Watchdog degradation rules (§31) | Carried from T6R (SIMULATED rules with live restraint evidence). T7 records the restarted runtime's watchdog surfaces only (LIVE, § Security preservation below) |

## STATIC VERIFIED

| Item | Statement |
| --- | --- |
| Bootstrap binary identity | Strings of the .NET bootstrap exe inventoried (`pre-signin/root-exe-strings.json`): ".git" refusals ("Installed evidence cannot use a Git checkout." + directory/file/hard-link refusals), readiness-record keys (`bunny-windows-application/1`, sourceCommit, manifestSha256, title, visible, loaded, width, height, state, runtime, windows-application.json), `windows-application_failed` failure JSONL, island title "Bunny Island", launcher failure notices |
| Installed launcher control flow | `Start-Bunny-Release.ps1` read from the installed release: manifest verify → identity-checked already-running chain (host 43119 → gateway 8084 → remote-consent block → island mutex `Local\Bunny-A-Island`), `remote.skipped` catch, island `already-running` exit |
| §25 mission restriction of unknown binaries | `validatedCodexRuntimes` / `CODEX_SECURITY_POLICY_VERSION=1` in the installed bundle source: unknown binary/version/hash never auto-validated; Mission-ineligible |

## NOT TESTED

| Item | Reason |
| --- | --- |
| Winlogon / 4624 event-log record reads | Security event log not readable from the non-elevated harness; returned empty and recorded. Session boundary is instead proven LIVE via CIM session numbers (52) |
| §41 actual reboot | Explicitly out of T7 scope (no reboot was requested or performed) |
| §42 second consecutive sign-in cycle | Optional; not run (single real sign-out/sign-in satisfies §1) |
| Physical Android re-join after sign-in | No user participation step in T7; not part of the gate |
| Sign-in-autonomous remote start | The remote worker was deliberately NOT started by the sign-in startup (see Remote startup and the failure ledger); no sign-in-driven remote auto-start property was claimed or tested (consent stayed enforced) |

## BLOCKED

None.

## DEFERRED

| Item | Target |
| --- | --- |
| T8 pinned rollback | NEXT gate; factory idle (§63) — not begun |

# Startup authority

§4/§10: startup must NOT route through a Git checkout, npm dev scripts, repo scripts, Vite
dev or a developer cwd.

## LIVE VERIFIED

| Property | Evidence |
| --- | --- |
| The startup chain is the installed chain | Per-user Startup folder contains `Bunny-A.lnk` → unchanged since pre-signin (`legacy-startup-paths-refresh.json`, `shortcutUnchanged: true`); its target is the install-root bootstrap `C:\Users\allam\AppData\Local\Bunny-A\Bunny-A.exe`; the bootstrap at 04:12:19 parented Explorer 36072, in session 2, and is the same exe as pre-signin (SHA-256 unchanged, `bootstrapExeUnchanged: true`) |
| Release selection from installed state | `install.json` `currentRelease` = v17-T6, then `settings/deployment.json` pin `packagePath` → `releases\Bunny-A-Windows-v17-T6`; launcher verifies the release manifest SHA against `install.json` before anything starts (all LIVE in the 04:12 startup: release `17.0.0-T6` in the gateway health payload, manifest `f5bf648c…` in the readiness record and in `install.json` — equal) |
| State layout from installed state | `state-layout.json` = `bunny-state/2`; Host env from the installed launcher's `Set-BunnyStateEnvironment`; workspace `C:\Users\allam\Bunny-Workspace` |
| No repo/dev references anywhere in the chain | All four Bunny process command lines reference only `%LOCALAPPDATA%\Bunny-A\…` paths; `devPathReferences: false` (`canonical-state-check.json`); zero repo-parented processes (§53) |
| Windows logoff/restart safety | `installed evidence cannot use a Git checkout` + directory/file/hard-link refusal strings embedded in the bootstrap binary (STATIC VERIFIED): the chain refuses a substituted Git-checked-out environment instead of running from the repo |

## FAIL conditions checked (§4/§58) — none present (LIVE VERIFIED)

No fallback to repo state, no dev-parented process (§53 empty), no new npm/Vite paths in
any Bunny command line.

# Release identity

## LIVE VERIFIED

| Property | Value |
| --- | --- |
| `install.json` currentRelease | `Bunny-A-Windows-v17-T6` / `17.0.0-T6` / sourceCommit `cb005ef7…` / manifest `f5bf648c…` (identical pre- and post-signin; `matchesPreSignin: true` → §57 release-mismatch FAIL condition not present) |
| Booted gateway identity | pid 5348, version `17.0.0-T6`, sourceCommit `cb005ef7…` (`/bunny-health`) |
| Readiness record | schema `bunny-windows-application/1`, fresh (after the 04:11:32Z sign-out), pid 34004 = live bootstrap, sourceCommit matches |
| Bootstrap exe | unchanged SHA-256 post-signin |
| Gateway package path | `releases\Bunny-A-Windows-v17-T6` (launch log `gateway.started` `package` field) |

# Single-instance proof

## LIVE VERIFIED (§18, §55)

| Process class | Count after sign-in startup (rule) |
| --- | --- |
| bootstrap-root (island in the bootstrap exe) | 1 (exactly one) |
| host-node (`node --experimental-strip-types Bunny-Host.mjs`, credentials JSON port 43119) | 1 (exactly one) |
| gateway-node (`node Bunny-Server.mjs`, 127.0.0.1:8084) | 1 (exactly one) |
| tunnel wrapper node (`scripts\bunny-tunnel.mjs`) | 1 (≤1) — present from the 04:17Z user-initiated launch, not from sign-in startup |
| cloudflared.exe | 1 (≤1 child) |

Defects: none (`single-instance.json`). Nothing was ever killed by executable name
(§55); the count evidence is continuous inventory plus the launch log's own refusal chains.

## §19 startup race test (LIVE VERIFIED, evidence `startup-race.json` + `raw-race-run1/`)

Two deliberate competitor launches of the SAME Startup shortcut target (the root
bootstrap) were made while the natural chain was healthy. In both, the competitor walked
the pinned launcher's refusal chain and exited with zero footprint; the harness did not
kill anything (nothing was ever killed, §55/§28) and no child restart was attempted
(`Save-PreviousLogs` produced no `logs/archive` entries at either attempt time):

| Attempt | Competitor launcher | Launch-log refusal chain timestamps (host → gateway → island, pids unchanged: Host 17956, gateway 5348, island 34004) | New persistent processes | Disappeared |
| --- | --- | --- | --- | --- |
| 1 (`raw-race-run1/`) | bootstrap pid 29460 | `04:23:06.6106421Z` → `04:23:06.7660072Z` → `04:23:06.7725091Z` | 0 | 0 |
| 2 (`startup-race.json`) | bootstrap pid 18764 | `04:23:43.7451910Z` → `04:23:43.8767994Z` → `04:23:43.8833231Z` | 0 | 0 |

Both refusals completed in ~160 ms — faster than the 2 s inventory sampling window, which
is why the competitor processes themselves appear only in the launch log (the log entries
with their launcher pids are the proof of attempt; the inventory counts prove no residue).
The losers detected-and-exited; exactly one of each runtime process remained.

# State preservation

## §21 canonical state (LIVE VERIFIED)

The restarted Host serves the canonical per-user state directory
`%LOCALAPPDATA%\Bunny-A\state` (layout `bunny-state/2`, `canonical-state-check.json`).
`emptyDatabase: false` — the §56 stop condition never triggered. Post-signin Host instance
`15a6a576-573b-4efd-a897-7544cfba5b6e` ≠ pre-signin `e2eed181-7ceb-4cba-81da-…`
(§14 fresh instance, expected; PID preservation never required).

## §22 preservation sweep (LIVE VERIFIED; evidence `state-preservation.json`)

Order-independent, normalized row comparison (volatile telemetry fields excepted per §22)
of every user table against the pre-signin `VACUUM INTO` backup:

| Table group | Result |
| --- | --- |
| tasks (56 rows), projects (13), missions, devices, approvals/audit, settings/records | byte-equal on normalized comparison; 0 problems |
| providers (6 rows) | 6 classified `externalProviderDeltas` — all expected fresh-probe telemetry from the restarted Host, none an identity drift (§ Provider recovery) |
| events | continuity proven: every pre-signin sequence (through 2303) present; post-signin delta sequences listed (2304–2307 runtime telemetry; 2308+ T7 harness acceptance tasks created after the sweep — recorded, reviewed and labeled, never treated as user content) |
| §22 honesty rule | no byte-for-byte equality was claimed for mutable telemetry fields; only expected telemetry deltas were classified |

## §23 autonomy switches (LIVE VERIFIED; `autonomy-switches.json`)

Missions/triggers preserved OFF: pre-signin `{missions: false, triggers: false}` →
post-signin identical; `enabledDuringStartup: false`. No startup path enabled autonomy.

## §26 external changes (LIVE VERIFIED, report-only)

Personal Codex/Claude/Ollama/Git configs were not modified by the harness. The only
external user-generated change observed in the provider rows (claude CLI `2.1.290` →
`2.1.291` plus an auth-mode record change) is **reported, not overwritten** — a normal
user-side upgrade outside Bunny's state, consistent with §26.

# Provider recovery

## LIVE VERIFIED (§24; evidence `provider-recovery.json`, `provider-recovery-ollama-retry.json`)

The restarted Host re-probed all providers itself at
`04:12:22Z`+ (fresh `probedAt` on all 6 rows — the recovery is the Host's own work, no
manual re-registration was performed):

| Provider | Version seen post-signin | Recovery evidence |
| --- | --- | --- |
| ollama | 0.35.1 (model `huihui_ai/qwen2.5-abliterate:7b`) | reachable `/api/tags` 200; fresh direct task post-restart COMPLETED with exact `T7_LOCAL_OK` output (task `44c18b8a-…`, created `04:22:06.227Z`, fresh approvals 2330/2332) |
| codex | codex-cli 0.153.4 | fresh direct task post-restart COMPLETED with a real file write (`t7-codex-ok.txt` in `C:\Users\allam\Bunny-Workspace`) and Bunny's own independent disk-verify `Exact match` (task of 04:18:41–54Z, events 2308–2326, fresh approvals 2310/2312) |
| claude | 2.1.291 | fresh `probedAt`; §26 external upgrade recorded (row identity preserved apart from version/auth-mode records) |
| opencode | 1.18.34 | fresh `probedAt` |
| cline | 3.0.67 | fresh `probedAt` |
| cursor | 2026.09.10-fd3934a | fresh `probedAt` |

`POST /command action=discover` → 200; policy surface post-restart:
`missionRestrictionPolicyVersion: 1`.

## §25 fresh Codex evaluation (LIVE VERIFIED)

Stale approval trust is absent: every approval used in T7 acceptance tasks was created
after restart (`approvalEvents` sequences 2310/2312 and 2330/2332 recorded per task; no
pre-restart approval was consumed). The validated runtime identity re-validated fresh at
04:12:22Z against the byte-identical codex binary
(SHA-256 `444a3f0008050605cae73cd9b7a2dcac61294062dfaab56dd20430fd6498518b`, size
295,408,944 — same as T2/T6R records). Unknown binary/version/hash remains
Mission-restricted by the installed policy source (STATIC VERIFIED).

## Failure ledger (part of the §37/§59 honesty record)

| Id | Observation | Classification |
| --- | --- | --- |
| L-T7-1 | First ollama probe submit returned 400 ("No ready executor can satisfy this task's hard constraints. Filesystem capability unavailable. …") | HARNESS PROBE DEFECT, not a recovery defect: the probe sent `verify:{kind:'file'}`, which adds a filesystem hard constraint a text-only model executor cannot satisfy; the Host **correctly refused rather than falling back to another executor** (constraint enforcement evidence, §58-compatible). Corrected retry (T6R submit shape, capability flags false, text-only) COMPLETED as recorded above. Evidence retained: first-attempt record embedded in `provider-recovery-ollama-retry.json` |
| L-T7-2 | Bootstrap-invoked launcher runs (03:14Z, 04:12Z, both 04:23Z race competitors) log no `remote.*` line even with a live worker, while direct pinned-launcher runs (03:04Z, 04:17Z) log `remote.started`/`already-running` | UNRESOLVED MECHANISM QUESTION, not a defect: sign-in startup leaves the remote path OFF (consent-first behavior preserved; a live worker is never duplicated); the launcher source has no silent skip branch, and the binary string dumps are partial, so whether the bootstrap passes `-NoRemote` is unproven. Recorded honestly; no user impact |
| L-T7-3 | `Winlogon`/4624 event-log reads returned empty | TOOL LIMITATION, not a Bunny defect (non-elevated shell); session boundary proven via CIM session IDs (§52) |

# Remote startup

## LIVE VERIFIED (§30–§35; evidence `remote-startup.json`, `remote-auth-smoke.json`, `device-preservation.json`, `watchdog-surfaces.json`)

| Property | Result |
| --- | --- |
| Sign-in startup itself | Did NOT start the tunnel worker (truthfully recorded: no `remote.*` log line at 04:12Z; see L-T7-2). Remote consent stayed enforced |
| Worker start (user-initiated, via the pinned launcher `-NoIsland` at 04:17:30Z) | `remote.started` (tunnel pid 56788, cloudflared child 33668), `tunnel-process.json` root = canonical `state`, mode quick, target `127.0.0.1:8084` |
| Host/gateway identity under a running chain | `host.already-running` (fromThisRelease, Host 17956) + `gateway.already-running` (gateway 5348) — nothing was replaced |
| Hostname change after sign-in | new quick-tunnel hostname `christina-terminal-howto-holes.trycloudflare.com` ≠ pre-signin `isa-toys-proxy-ottawa.trycloudflare.com` (`hostnameChanged: true`) — freshness is expected and hostname persistence is NOT required (§30); recorded truthfully |
| Published URL ↔ worker generation (§32) | the new URL is served by the current worker (public `/bunny-health` 200, 161 ms, `{"app":"Bunny-A"}`); the stale URL is withdrawn from the edge (530) — `staleUrlStillServed: false` |
| cloudflared binary identity | unchanged post-signin (SHA-256 `f096265ec2fcbe9b…`, 55,366,080 B, matches pre-signin and install.json tool hash) |
| §33 minimal remote auth smoke | unpaired `/state` → **404** (no task data), `/` and `/bunny-health` → 200 with no secrets; token-leak scan of all three public responses: `tokenLeak: false` |
| §34 production "Phone companion" | intact and active (device `a307ff4b-…`, `revoked_at` NULL in the devices table, created 03/2026-era epoch `1791174129259`); never revoked or re-paired for T7 |
| §35 device authority preservation | T6R devices `6dbfe316…` and `617ad45c…` remain revoked with their exact T6R-era `revoked_at` timestamps (DB-read direct node:sqlite; `/state` lists only non-revoked devices, which is why the API view shows them absent); no startup path re-paired, unrevoked or substituted device secrets; `noRepairsPerformed: true` |
| §31 watchdog surfaces | the restarted runtime's watchdog state surfaces intact (`watchdog-surfaces.json`: remote/tunnel process records consistent; fresh provider probe timestamps are the only watchdog-adjacent state keys); degradation rules carried unchanged from T6R (SIMULATED there) |

# Security preservation

## LIVE VERIFIED (§33/§34/§35/§58)

| Boundary | Evidence |
| --- | --- |
| No auth bypass | unpaired public reads denied (404 on `/state`); bearer + device-token auth unchanged in the booted runtime |
| No unexpected Mission enablement | missions OFF + triggers OFF after startup (§ LIVE Verified above); `enabledDuringStartup: false` |
| No device authority reset | all pre-existing device rows preserved byte-equal except fresh provider telemetry; revoked stayed revoked (DB-verified timestamps) |
| No Codex compatibility bypass | policy version 1; validated single runtime; fresh validation against byte-identical binary; unknown stays Mission-restricted (static) |
| No secret exposure | public HTML/assets/state probes carry no credentials/tokens (`tokenLeak: false`); master credential remains server-side |
| No fallback to repo state | zero repo/dev references in any process; `devPathReferences: false` (§58 FAIL condition not present) |
| No broad process kill | nothing was killed by name at any point (§55/§28); the race competitors were only observed |
| No silent elevation | no Windows Service, no SYSTEM process, no scheduled task with highest privileges appeared (inventory classes fully accounted for; §40) |
| Console windows / focus stealing | §38: all Bunny children start with `-WindowStyle Hidden` / redirected logs (launcher source, STATIC VERIFIED); no console-window process observed in session 2 inventory; the island is the 360×86 island window itself |

# Startup timings

## LIVE VERIFIED (§36; from Windows actual timestamps, `startup-performance.json`)

All times UTC; process creation times from CIM (local −04:00 converted), T0 = first Bunny
process birth (the root bootstrap):

| Marker | Timestamp | T-relative |
| --- | --- | --- |
| Sign-back-in shell (Explorer 36072, session 2) | 04:11:54.312Z | −24.9 s (user phase; included for completeness) |
| T0 — root bootstrap exe born (pid 34004) | 04:12:19.208Z | 0 |
| Host node born (pid 17956; `host.started` 04:12:22.863Z) | 04:12:22.211Z | +3.65 s (recorded) |
| Gateway node born (pid 5348; `gateway.started` 04:12:25.518Z) | 04:12:24.999Z | +6.31 s (recorded) |
| Readiness record written (island ready) | 04:12:29.071Z | **+9.86 s** (T0 → readiness) |
| cloudflared / tunnel | — | not started at sign-in (consent-first; user-initiated at 04:17:30Z, separately timed) |

The measured chain from bootstrap birth to readiness is ≈ **9.9 s**; no estimates or
assumptions were used (§36 measured-rule satisfied).

# Final production state

## LIVE VERIFIED (evidence `final-production.json` and per-check files)

| Fact | Value |
| --- | --- |
| Release | Bunny-A-Windows-v17-T6 (sourceCommit `cb005ef7…`), still the only bootable release |
| Fresh instance | `15a6a576-573b-4efd-a897-7544cfba5b6e` (Host 17956, gateway 5348, island/bootstrap 34004) |
| Canonical content | 59 tasks (56 pre-gate + 3 T7 harness acceptance tasks recorded separately), 13 projects, 1 active device (Phone companion), pre-existing T6R test devices still revoked |
| Autonomy | missions OFF, triggers OFF |
| Remote | temporary quick tunnel on the new hostname (user-initiated), public health 200, stale hostname withdrawn |
| Error surface | `startup-errors.json`: all runtime logs scanned; post-signin findings = 1, the L-T7-1 harness-probe refusal (expected-labeled); host/gateway/tunnel error logs 0 bytes; no BLOCKER/HIGH |
| Nothing deleted | §20 legacy audit refresh: Startup folder = `Bunny-A.lnk` (unchanged SHA-256) + unrelated `Ollama.lnk`; HKCU Run contains NO Bunny entry (unrelated apps only); T7 deleted nothing and auto-deleted nothing (`nothingAutoDeleted: true`; legacy entries were only ever AUDITED, per §20) |

# Candidate identity

## LIVE VERIFIED

| Field | Value |
| --- | --- |
| Production candidate (unchanged by T7) | `Bunny-A-Windows-v17-T6` |
| Source commit | `cb005ef75bf86d4d9e722b5214612fe115db5c6b` |
| Release manifest SHA-256 | `f5bf648c92711baba3fe4a24ea46c449fd8f226c0afa018f8f9cf93da52fde88` |
| Zip (T6R staging artifact) | SHA-256 `29740a280d96a7d1ed87acab3fbd59fc709ed523e8f118da43be4603606ace1d` — unchanged |
| Bootstrap exe | SHA-256 unchanged through the sign-in cycle |
| Activation history | activated under §45 with prior explicit user authorization (v17-T6); reconfirmed by the 04:12:22Z natural startup; NOT re-installed or re-activated in T7 |
| Factory status | Idle — no staged build was manufactured or activated in T7 ("do NOT manufacture v17-T7" honored); **NEXT = T8 pinned rollback, not begun** (§63) |

## Evidence index

Under `test-results/ma2-gate7/`:
`pre-signin/` (11 prep + authorization + HANDOFF.md + binary string inventory), and
`post-signin/`: `session-evidence.json`, `post-signin-processes.json`,
`startup-performance.json`, `post-signin-health.json`, `post-signin-release-identity.json`,
`fresh-instance.json`, `single-instance.json`, `canonical-state-check.json`,
`state-preservation.json`, `autonomy-switches.json`, `dashboard-identity.json`,
`remote-startup.json`, `remote-auth-smoke.json`, `device-preservation.json`,
`watchdog-surfaces.json`, `provider-recovery.json`,
`provider-recovery-ollama-retry.json`, `codex-compatibility.json`,
`startup-race.json` (+ `startup-race-events.json`, `raw-race-run1/`),
`startup-errors.json`, `legacy-startup-paths-refresh.json`, `final-production.json`,
`shared.mjs`, scripts `10`…`50`.

## Verdict scope statement

§61 verdict: **BUNNY_MA2_T7_PASS**. §62: the full M-A-2 operational verdict
(BUNNY_MA2_OPERATIONAL_PASS) is NOT claimed — T8 (pinned rollback), T9 (desktop approval
policy), T10 (final operational audit) remain open. §41 reboot remains NOT TESTED
(separate gate). Gate T7 changes no product code and revokes nothing.