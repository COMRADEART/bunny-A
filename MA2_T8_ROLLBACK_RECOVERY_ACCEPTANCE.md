# M-A-2 Gate T8

**BUNNY_MA2_T8_PASS** (2026-10-06). The real pinned-rollback / real-recovery acceptance
passed: production was moved from the accepted release `Bunny-A-Windows-v17-T6` back to the
nearest previously accepted ACTIVATED release `Bunny-A-Windows-v17-T5` using only immutable
installed artifacts (the T5 pin bundle created at T6R activation) plus the live config
machinery — then forward again to `Bunny-A-Windows-v17-T6` byte-for-byte — **without Git,
without stale-PID authority, without database rollback, without privilege expansion and
without silent state rollback**. The database was NOT rolled back in either direction (§9
code/release rollback only; a DB restore remains the §49 emergency measure and was never
invoked). The final production state is `Bunny-A-Windows-v17-T6` again, healthy, with the
remote surface reconciled and Windows sign-in pinned to T6 (§46). The verdict is exactly
`BUNNY_MA2_T8_PASS` (§66); the full-series operational verdict is NOT issued (§67 — no
BUNNY_MA2_OPERATIONAL_PASS claim); **NEXT = T9 (desktop approval policy), not begun** (§68).

| T8 gate role | Statement |
| --- | --- |
| Gate | M-A-2 Gate T8 — pinned rollback / real recovery acceptance outside git |
| Question answered | "Can Bunny move from the current production release to a pinned previously accepted installed release using only immutable installed artifacts and canonical external state, then move forward again to the current accepted release — without Git, stale PID authority, data loss, privilege expansion, or silent state rollback?" |
| Scope | REAL rollback T6→T5 + REAL forward recovery T5→T6 against the installed production runtime; §41–§47 focused revalidations; NO product-code changes; no OCT-1/OD-1 features (§59/§60); no auto-rollback policy or updater introduced |
| Code changes in T8 | NONE to the product or its release (acceptance-only gate; regression floor unchanged at 592; §52). Acceptance harness tooling under `test-results/ma2-gate8/tools/` was repaired during the gate — every repair is recorded in the T8 failure ledger below and none is a release change ("do NOT manufacture v17-T8" honored) |
| Verdict | **BUNNY_MA2_T8_PASS** with 6 recorded residual observations (harness-only; none a rollback or recovery defect) |

# Baseline (read from evidence, never invented)

The T8 gate ran immediately after Gate T7 (BUNNY_MA2_T7_PASS, commit `c126e7f`) against
production `Bunny-A-Windows-v17-T6`:

| Baseline fact | Value | Label |
| --- | --- | --- |
| Production release | `Bunny-A-Windows-v17-T6` (installed folder under `%LOCALAPPDATA%\Bunny-A\releases`, 156 files, integrity ok) | LIVE VERIFIED |
| Source / manifest | `cb005ef75bf86d4d9e722b5214612fe115db5c6b` / `f5bf648c92711baba3fe4a24ea46c449fd8f226c0afa018f8f9cf93da52fde88`; T7 close commit `c126e7f` | LIVE VERIFIED |
| Pre-rollback pids (T8 preflight) | Host 17956, gateway 5348, bootstrap 34004 (the T7 natural-boot chain), tunnel worker 56788 + cloudflared 33668 (consented, user-initiated 04:17:29Z); instance `15a6a576-573b-4efd-a897-7544cfba5b6e` | LIVE VERIFIED |
| B0 protected-row ledger | `db/protected-row-ledger-b0-prod.json` — 23 tables hashed before any mutation | LIVE VERIFIED |
| Regression floor | 592 (from T7; §52 statement below) | STATIC VERIFIED (T7 evidence) |
| Prior gate results | T1–T5 PASS; T6 FAIL(transport)→T6R PASS; T7 PASS; T9/T10 open | LIVE VERIFIED (ledger + matrix) |

# Rollback-target selection (§5)

`rollback-target.json`: **T5 is the nearest previously accepted, ACTIVATED production
release** — activated production 2026-10-04T22:28:52Z, production until T6R activation
2026-10-06T03:14:32Z. Explicitly excluded: T4 (staged-only, never production), T2
(staged-only; its manifest is cross-checked but the folder was never the accepted
production), v16 (does not declare installed state layout 2 — migration-era), T3 (accepted
production but OLDER than T5, hence not "nearest"). The live switch material is the T5 pin
bundle `C:\Users\allam\AppData\Local\Bunny-A\rollback\20261005-230352-b2e4e5f1` — created
by the installer at T6R activation — carrying the exact pre-T6 `install.json`
(currentRelease T5), `deployment.json` (T5 `packagePath`) and saved Startup shortcut (`ca7f5616…`).
Forward switch material is T8's own pre-rollback snapshot `rollback/recovery-bundle-t6/`
(T6 bytes: `install d3d9ace0…`, `deployment 77cf9dee…`, `lnk a7a3e942…`), never mutated
after creation (SHA-asserted at every use). T5 identity: sourceCommit
`eb96c053c238ec0bd385187e0f4dad6777a0a4bc`, manifest
`f0531f8d2a02ed3302c3b4ade5e28859e39ec1dba380cf3f8596866ac4a18a4e` (integrity 156/156
files, both directions).

# IMPLEMENTED

Nothing was implemented for T8 by design (acceptance-only gate). The release's existing
installed rollback/recovery machinery — install.json bootstrap, `Start-Bunny-Release.ps1`,
the T6R-era `install-bunny-release.ps1 -Rollback` fail-safe, `Bunny-Release-Info.ps1`
integrity check, the per-release dashboard — was exercised as-is for both directions. The
only writes in this gate were the accepted controller's config-switch (the three config
files, restored/committed via their recorded bundles) — exactly the §25/§37 contract.

## Procedure executed (rollback leg §22–§35, all LIVE VERIFIED)

Authorization: the user answered **"Authorize: full run (Recommended)"** before §22 — the
full §22–§40 rollback + forward recovery, §41–§47 revalidations, ledgers, docs and verdict.

| Step | Evidence |
| --- | --- |
| §15–§18 preflight: identity of live production from live config + accepted ledger; validation of BOTH targets (`validateTarget`: live manifest SHA match, identity match, outside-git ancestor walk, no reparse points); B0 ledger (23 tables) | `rollback-target.json`, `forward-target.json`, `accepted-release-ledger.json`, `db/protected-row-ledger-b0-prod.json` |
| §20 pre-stop inventory + idle check (shape-aware `/state`; tasks/missions/capability shapes all served on 43119) | `rollback/inventory-before.json` |
| §21 instanceId roundtrip legs 1–4 | `roundtrip/` — four boots on ONE install minted four different instanceIds (`bceccce7`, `fc398d37`, `105d90fd`, `7beadbd3`): instanceId is per-boot by design; durable fidelity is the devices/tasks/settings rows + the token being accepted (§14 fresh instance, PID preservation never required) |
| §22–§28 sentinel (protected bystander process, pid 6924 — a sleep-only PowerShell spawn) survived EVERY stop/switch/boot of the whole gate until its deliberate corroborated end at the close (§23 sentinel preservation, `taskkill` by explicit pid with prior entry corroboration, never by name) | `rollback/inventory-before.json`, `stops-t6.json`, `stops-t5.json`, `restart-t5.json`, `sentinel-end.json` |
| §29 real owned stop of the production chain, child-first, ONLY Bunny-owned corroborated roles (never by name). TWO authorized-leg passes are evidenced: **pass 1** (run log `tools/70-run.log`) stopped the TRUE pre-gate production chain — tunnel worker 56788 + cloudflared 33668 + gateway 5348 + host 17956 + bootstrap 34004 — with the pass-1 sentinel 30708 preserved; **pass 2** (the final leg, files below) stopped the §2-recovery-era T6 boot — gateway 55108 → host 11772 → bootstrap 17344 — with tunnel-worker/cloudflared correctly absent-from-inventory (the unattended recovery boot runs no tunnel by installed design); in both passes "all Bunny processes stopped; sentinel `alive: true`" before the switch | `tools/70-run.log` (pass 1, incl. tunnel), `rollback/stops-t6.json` (pass 2, corroborated identities), sentinel records: `rollback/run4-sentinel-cleanup.json` (30708, corroborated+ended during the §2-recovery era), `rollback/boot-t5.json` (6924 alive) |
| §25 atomic config switch to T5 — shortcut → `deployment.json` → `install.json` LAST (the commit point); bytes verbatim from the immutable T5 pin bundle; post-switch SHA re-check | `rollback/switch-t5.json` (install `ba356261…`, deployment `81435cc4…`, lnk `ca7f5616…` — exact bundle bytes) |
| §27 REAL restart into T5 | `rollback/boot-t5.json` — bootstrap 38084, Host 19540, gateway 53952; T5 release identity `17.0.0-T5` / `eb96c053…` / manifest `f0531f8d…` verified in the gateway `/bunny-health` release block and the host process entry (`Bunny-Host.mjs` on T5 runtime node) |
| §28 canonical state still served (same `state` root, same token accepted, no re-onboarding) | `rollback/state-checks-t5.json` — devices 15 total / 14 revoked / 1 active preserved; tasks 59; instance minted (`d3731484…`) |
| §30 launcher restart WHILE ROLLED BACK (one normal restart, same pinned T5 target, no repo dependency) | `rollback/restart-t5.json` — owned stop + fixed start; Host 19540→26552, bootstrap 38084→36092, gateway→22480; exactly one of each process; T5 config bytes unchanged; sentinel alive |
| §34 one harmless deterministic LOCAL task (ollama `huihui_ai/qwen2.5-abliterate:7b`; overrides fast/localOnly/offlineOnly/provider allowlist `[ollama]`/maxRuntimeMs 90000; fresh approval created) | `rollback/smoke-t5.json` — task `0b4964b5-40b5-44c8-9862-ace65b5e2b6c` COMPLETED, exact marker `T8_T5_LOCAL_OK`, noCloudModel |
| §33 remote transport while rolled back — truth recorded | `rollback/remote-during-rollback.json` — measured truth: while rolled back NO tunnel runs (the bootstrap chain is remote-disabled — see L-T7-2 resolution below), the pre-stop worker record is stale/dead, hostname `christina-…` dead; NO authentication weakened |
| §39/§40 B1 preserved-row ledger + B0→B1 diff | `db/protected-row-ledger-b1-prod.json`, `db/b0-to-b1-diff.json` — verdict **PRESERVED** (2 appended, 0 unexpected, 0 modified, 0 missing) |
| Rollback verdict | `rollback/rollback-live-summary.json` — `rollbackOk: true`, releaseNow T5 |

The rollback leg ran as two authorized passes with the §48 recovery between them
(chronology above); across the full trail six harness defects were recorded — each
corrected within the same gate, none affecting product state or data (see the failure
ledger below and the `runTrail` fields inside the evidence files).

## §48 emergency path exercise (recorded honestly)

The authorized rolling-back leg ran in two passes, with the §48-class emergency machinery
exercised for real between them:

1. **Authorized-leg pass 1** (`tools/70-run.log`): pre-stop checks + owned stop of the true
   pre-gate production chain (including the consented tunnel worker 56788 + cloudflared
   33668) and the T5 switch committed from the pin bundle — then the T5 boot attempt failed
   on a PowerShell 5.1 defect (`Start-Process -ArgumentList` rejects empty arguments for
   the empty-arguments lnk) and the run was killed before its self-recovery, leaving the
   production config on the committed T5 bytes with the chain stopped. Sentinel 30708
   (spawned by pass 1) was later corroborated and ended during the recovery era
   (`rollback/run4-sentinel-cleanup.json`).
2. **§2-recovery / §48 exercise** (`rollback/boot-t6-pre70.json` — the prepared recovery
   restored the current accepted T6 config from the immutable recovery bundle
   (`install.json` LAST), booted v17-T6 through the fixed start path, and verified
   identity/health from the live endpoints; bootstrap 17344, host 11772, gateway 55108;
   config byte-verified back to the exact T6 bytes with the durability record
   (token accepted, devices unchanged, tasks 59)). The gate did NOT silently continue; this
   recovery is an evidenced, byte-verified LIVE exercise of the §48 machinery with its own
   trail and run logs (`tools/71-run.log`, `tools/72-run.log`).
3. **Authorized-leg pass 2** (`tools/70-run2.log`, final leg, sentinel 6924): the full
   §22–§35 leg re-executed cleanly from the restored T6 production — recorded in the
   evidence files cited in the table above (inventory-before, stops-t6, switch-t5,
   boot-t5, then 73's completion). Both passes committed identical T5 bytes
   (deterministic from the immutable bundle).

# Forward recovery (§36–§40, all LIVE VERIFIED)

| Step | Evidence |
| --- | --- |
| §36 forward precheck — T6 files were NOT assumed unchanged: `Bunny-Release-Info.ps1` integrity run on the installed folder → `ok:true` (156 files listed/verified, 0 missing/0 changed/0 extra); `validateTarget` re-run against the T6 recovery bundle | `rollback/forward-precheck.json` |
| §37 owned stop of the rolled-back T5 chain (gateway 22480 → host 26552 → bootstrap 36092 — fresh CIM pids, role+entry corroboration, child-first, sentinel 6924 alive, zero remnants) | `rollback/stops-t5.json` |
| §37b atomic switch back to T6 — same machinery, bytes from `recovery-bundle-t6`, `install.json` LAST; **byte parity asserted**: final config bytes byte-identical to the pre-rollback production bytes | `rollback/switch-t6.json` (`byteParity: true`) |
| §37c/§38 REAL forward restart into T6 — bootstrap 40712, Host 35792, gateway 17040; live-endpoint release identity verified (`/bunny-health` release block + `/state` release object): `17.0.0-T6` / `cb005ef7…` / manifest `f5bf648c…` / dashboard `assetManifestSha256 c78fc00a…` | `rollback/boot-t6.json`, `rollback/forward-live-summary.json` |
| §45/§47 published-URL reconciliation — the release's own consented launcher invocation (durable consent file: `remote-consent.json` enabled/Cloudflare/approvedAt 2026-10-01) under the recovered release: `remote.started` fresh worker pid 45724 + cloudflared child 49052 (worker executable under the T6 release folder, entry `bunny-tunnel.mjs`); stale pre-rollback record reconciled to the fresh worker; the launcher spawned NO duplicate host/gateway/island (`host.already-running fromThisRelease`, `gateway.already-running`, `island.already-running`) | `rollback/tunnel-revalidation-t6.json`; `state/logs/release-launch.log` 13:53:25Z events |
| §45 public endpoint health | public `/bunny-health` on the fresh quick-tunnel hostname → **200** `{"app":"Bunny-A"}` (by design the remote-origin health payload is the reduced identity shape — the full release block is only served to the local loopback Host header; `Bunny-Server.mjs` request handling, T6R A–Q precedent) |
| §45 unpaired denial | unpaired public fetch → **403** (evidence-only probe standing on the T6R A–Q unpaired-denial campaign; not a re-proof) |
| §47 hostname trail | `preRollbackT6` `christina-…` → `duringRollback` null (no tunnel while unattended) → `postRecovery` `redeem-yeah-qui-tri.trycloudflare.com` — fresh URL actually served by the fresh worker; `tokenLeaked: false` |
| §39/§40 B2 ledger + B0→B2 diff | `db/protected-row-ledger-b2-prod.json`, `db/b0-to-b2-diff.json` — verdict **PRESERVED** (22 appended, 0 unexpected, 0 modified, 0 missing) |

Forward verdict: `rollback/forward-live-summary.json` — `forwardOk: true`,
`releaseNow: "Bunny-A-Windows-v17-T6"`.

## §40 appended-row enumeration (new legitimate T8 data only)

`db/appended-rows-b1-b2.json` (`unexpected: false`):

| Table | Appended | Content |
| --- | --- | --- |
| tasks | 1 | the §34 smoke task `0b4964b5-…` (T8's own acceptance record) |
| outcomes | 1 | that task's outcome (state `completed`, provider `ollama`, exact marker) |
| events | 20 | the event-stream entries of that task plus the §41 T2 discovery probes (`agent.*`, `audit.command`, `provider.status_changed`) |

Every protected pre-existing row survived with its B0 digest in both directions
(23-table diff, volatile-telemetry classification per §22).

# §41–§47 focused revalidations (LIVE VERIFIED, `rollback/revalidations.json`)

Per the brief: verify the current tunnel worker, the current T6 watchdog surface, published
URL reconciliation, public endpoint health, unpaired denial — and **do not rerun the full
A–Q T6 campaign unless a defect appears** (no defect appeared; the A–Q campaign stands).

| Item | Result |
| --- | --- |
| T2 codex discover policy | `POST /command action=discover` → 200; codex recorded from the live policy surface: availability `ready`, compatibilityClass `VALIDATED`, no secret recorded |
| T3 host startup boundary | the recovered T6 boot satisfied the same boundary live (state marker + cloudflared boundary + stateRoot equality enforced by the installed launcher) |
| T4 process ownership | owned stops of BOTH boots corroborated on fresh CIM identities (child-first, sentinel preserved); the §55/§56 refusal suite + the installed-tooling audit stand from this gate's security evidence (below) |
| T5 dashboard assets | recovered `/state` release.dashboard `assetManifestSha256` = the accepted T6 record exactly |
| T6 watchdog surface (carried + live) | tunnel process record consistent with the live worker (fresh `{pid,childPid,startedAt}` record); watchdog rules remain the T6R-accepted SIMULATED rules — no watchdog behavior re-claimed beyond the T6R record |
| T7 startup preservation (§46) | Windows sign-in was NOT left pinned to the rollback target: `Bunny-A.lnk` SHA-256 is the pre-rollback T6 value `a7a3e942…` (target `Bunny-A.exe`, empty arguments, working directory = install root — read via WScript) and the running bootstrap 40712 was started from that T6 lnk |
| Final instance census | exactly 1 host (35792) + 1 gateway (17040) + 1 bootstrap (40712) + 1 tunnel worker (45724) + 1 cloudflared child (49052), `otherRoles: 0` |

# L-T7-2 RESOLVED (sign-in remote suppression mechanism)

T7's residual "Bootstrap-invoked launcher runs log no `remote.*` line even with a live
worker, while direct pinned-launcher runs do" is resolved by T8 evidence:

1. **Installed launcher source (read once more from the T6 release folder, never edited):**
   the remote block runs only when the `-NoRemote` switch is absent AND the consent file
   (`state\settings\remote-consent.json`) exists with `enabled:true, provider:'Cloudflare'`
   (`Bunny-State.ps1` `paths.consent`; guarded by the cloudflared SHA + identity-collision
   + dead-pid-clean-spawn branches). There is indeed no silent skip branch.
2. **T8's every bootstrap-chain boot (T5 and T6 alike) emitted no `remote.*` event and
   started no tunnel** — matching the T7 natural-boot precedent — while BOTH manual
   launcher invocations (the pre-gate 04:17:29Z user one on T6, and T8's own §45 consented
   invocation at 13:53:25Z) produced `remote.started`. The mechanism the T7 packet could
   not prove is thereby established: **the bootstrap chain invokes the launcher
   remote-disabled (`-NoRemote`)**, and unattended boots publish no public URL by
   installed design; tunnels only run under the durable consent file via a direct launcher
   invocation. No product change was needed or made; consent-first behavior was never
   weakened.

# §32 expected feature regression (recorded honestly — not corruption)

While rolled back, production was by definition the OLDER accepted release T5, and it
showed exactly its accepted surface: T5 dashboard build (`builtAt 2026-10-04T22:10:56Z`,
T5 asset identity), T5 tooling commit `ec81f9b9…`, the T5-era remote behavior row
("tunnel supervisor exit-only, NO watchdog" — the T6R watchdog-era refinements absent), and
no `17.0.0-T6`-only refinements. Every one of these differences is the T5 accepted
identity, proven by the release/manifest SHAs at boot — the T8 report labels them **expected
feature regression of the pinned prior release, never corruption or silent state rollback**:
the B1 protected-row diff was PRESERVED while running T5, and the local §34 smoke passed on
T5. On forward recovery the full T6 identity (including the T6 dashboard asset manifest and
the reconciled tunnel surface) was re-verified live, so no regression persists.

Security/provider floor while rolled back (brief §30–§31): the T5 release boots the same
canonical state (layout `bunny-state/2`, schema user_version 3), keeps the same
compatibility-policy surface (`codexCompatibilityPolicyVersion 1`, `hostSchemaUserVersion
3`), and no provider was contacted beyond the local §34 ollama task — the provider
compatibility floor was maintained; authentication unchanged; no privilege expansion.

# Security / §54–§58 attack tests (LIVE VERIFIED on disposable state; `security/attack-tests.json`)

| Attack | Result |
| --- | --- |
| t54a target not in install.json | REFUSED (`targetRefused:not-in-install.json`) |
| t54b valid target control | accepted (controller correctness control) |
| t54c manifest SHA mismatch | REFUSED |
| t54d folder missing | REFUSED |
| t54e / t54f inside-Git target | REFUSED (t54f the REAL inside-git case: `targetRefused:inside-git`) |
| t55a stale record dead pid | REFUSED (`savedPidRefused:does-not-exist`) |
| t55b pid reused by other executable | REFUSED (`savedPidRefused:executable-changed`) |
| t55c role mismatch | REFUSED (`savedPidRefused:role-mismatch`) |
| t55d owned-stop on sentinel role | REFUSED (`ownedStopRefused:role-mismatch`) |
| t55e entry mismatch | REFUSED (`savedPidRefused:entry-mismatch`) |
| t56a/t56b tampered content / tampered manifest boot | REFUSED by the installed launcher itself (exit 1, guard messages) — tampered releases never boot |
| t19 sentinel preserved | through ALL refusals, then deliberately owned-stopped (corroboration recorded) |
| Unrelated production intact | throughout the attack run (gateway health 200 on unaffected chain) |
| §15/§51 installed tooling audit | `security/rollback-controller-audit.json` — the installed `install-bunny-release.ps1 -Rollback` executed VERBATIM (no modification) with a real T5-pin bundle copy against disposable roots REFUSED at its guard ("Rollback shortcut does not start the pinned prior release."), `restoredNothing`, `exit 1`, production untouched: the installed fail-safe is real, and T8's controller conforms to the same discipline (never starts/stops a process in rollback mode; switch material only) |
| §59/§61 no auto-rollback policy / updater | none introduced; no scheduled task, no updater, no auto-rollback of anything |

# §52 regression-floor statement

**T8 made NO code or tooling changes to the product, the release, or the test suite.**
Accepted-read-only: `npm run build`, `npm run typecheck`, the 592-test floor, and every T1–T7
test stand unchanged from the T7 evidence (gate-scoped acceptance tooling under
`test-results/ma2-gate8/tools/` is not product tooling and is not part of the 592 floor;
its in-gate repairs are recorded below). Therefore per the §52 rule no full-suite re-run was
required by T8; the floor **592 stands**. No test was removed or reclassified (§53); no
release was manufactured or activated ("do NOT manufacture v17-T8" honored — the final
production release remains the already-accepted v17-T6).

# T8 failure ledger (harness-only; every entry corrected during the gate)

| Id | Observation | Classification |
| --- | --- | --- |
| L-T8-1 | Controller run crashed dereferencing a return key after a fully-successful T5 boot | HARNESS DEFECT (`startAndVerify` returned `health`, old call read `.pid` of the absent `host` alias); boot facts were not lost — the identity asserts had passed and were re-verified from the live state by the resume; return contract fixed and every later run consumed the fixed contract |
| L-T8-2 | Forward run 2 crashed at §45 ("no-fresh-worker") although the reconciliation had succeeded | HARNESS SHAPE DEFECT: `state/runtime/tunnel-process.json` is `{pid,childPid,startedAt,exists}` (no hostname/url — the hostname lives in `remote.json`); the crash fired at ~40 s after the `remote.started` event while the fresh worker was already up. Fixed at the read site (both in the recorded tool and the resume); the gate completed from the live state with every §36–§38 precondition re-asserted |
| L-T8-3 | Two early "instanceId changed" alarms | HARNESS MISCONCEPTION (§21): credentials.json/instanceId is minted per boot (roundtrip legs 1–4 prove four values on ONE install); durable-fidelity assertions (devices/tasks/settings rows + token accepted + no re-onboarding) replaced the invalid equality assertions in every later run |
| L-T8-4 | Authorized-leg pass 1 died after committing the T5 switch (L-T8-6 boot defect), leaving config on T5 with the chain stopped; the §48-class restoration was then executed by the prepared recovery, outside the planned sequence: `tools/71` verified the committed T5 bytes then re-switched to the T6 recovery-bundle bytes (crashing at boot on a missing import — harness), `tools/72` completed the fixed-path boot | UNPLANNED BUT REAL §48 exercise, recorded honestly with its own runTrail (`rollback/boot-t6-pre70.json`, runs 5–6b): recovery-bundle restore + byte-verified T6 config + healthy boot re-verified BEFORE the authorized pass 2 resumed; no data effect (B1 diff PRESERVED stands) |
| L-T8-5 | Rollback-leg resume initially refused a fresh Host pid as non-fresh (inverted comparison) | HARNESS DEFECT in a resume script's guard; corrected before any stop/switch; the final recorded stops use the corrected rule |
| L-T8-6 | Authorized-leg pass-1 T5 boot attempt failed at `Start-Process` ("Cannot validate argument on parameter 'ArgumentList'. The argument is null or empty") | HARNESS DEFECT (PowerShell 5.1 rejects empty-argument lists; the T6/T5 Startup lnk has empty arguments by design). No process state was damaged (the stop/switch had completed). Fixed in the controller's empty-arguments start branch; BOTH the §2-recovery boot and every later boot (T5 passes, T6 boots) ran through the fixed path successfully — the defect is visible verbatim in `tools/70-run.log` |

# Final production state (LIVE VERIFIED, post-gate)

| Fact | Value |
| --- | --- |
| Release | `Bunny-A-Windows-v17-T6` — `install.json`/`deployment.json`/Startup lnk byte-identical to the pre-rollback production bytes (`d3d9ace0…` / `77cf9dee…` / `a7a3e942…`) |
| Live processes | Host 35792, gateway 17040, bootstrap 40712, tunnel worker 45724 (+ cloudflared 49052); exactly one of each; nothing by-name-killed anywhere in the gate |
| Canonical state | DB PRESERVED both directions (B0→B1 and B0→B2 verdicts PRESERVED); devices 15 total / 14 revoked / **1 active** (the production "Phone companion"); tasks 60 (59 pre-gate + 1 T8 smoke task, fully enumerated in §40 above); instance minted per boot (`3ea628ff…` at the forward boot) |
| Remote | temporary quick tunnel on the fresh consented hostname (public `/bunny-health` 200; unpaired denial 403; stale pre-gate hostname dead and recorded) — remote surface restored to the accepted pre-rollback shape under durable consent |
| Windows sign-in | pinned to T6 lnk `a7a3e942…` (§46 satisfied; nothing left on T5) |
| Sentinel / bystanders | the only extra process of the gate (sleep-only sentinel 6924) ended corroborated; nothing else was touched |
| Git use | ** ZERO** `git checkout/switch/reset/restore` operations during recovery (§14 — git used read-only for evidence only; the controller's ancestor-walk refusal is evidenced by `t54f`) |
| Database restores | none — §49 emergency DB restore was NEVER invoked (rollback and recovery were code/release rollbacks only) |

# Evidence index

Under `test-results/ma2-gate8/`: `accepted-release-ledger.json`, `rollback-target.json`,
`forward-target.json`, `pre-rollback/preflight.json`, `rollback/` (recovery-prep,
`recovery-bundle-t6/`, `inventory-before.json`, `stops-t6.json`, `switch-t5.json`,
`boot-t5.json`, `state-checks-t5.json`, `smoke-t5.json`, `restart-t5.json`,
`remote-during-rollback.json`, `rollback-live-summary.json`, `boot-t6-pre70.json`,
`stops-t5.json`, `switch-t6.json`, `boot-t6.json`, `forward-precheck.json`,
`tunnel-revalidation-t6.json`, `revalidations.json`, `sentinel-end.json`,
`forward-live-summary.json`), `db/` (`protected-row-ledger-b0-prod.json`,
`protected-row-ledger-b1-prod.json`, `b0-to-b1-diff.json`,
`protected-row-ledger-b2-prod.json`, `b0-to-b2-diff.json`, `appended-rows-b1-b2.json`),
`roundtrip/` (instanceId legs 1–4), `security/` (`attack-tests.json`,
`rollback-controller-audit.json`), `evidence/index.json` (§62/§63 — **92 files,
every file SHA-256-indexed, `tokenLeaked: false`**: the local record token was compared
against every text evidence file and its VALUE appears nowhere; secret values are never
recorded or hashed), and the tools under `tools/` with their run logs (the runTrail of
every crash/resume is preserved inside the evidence files themselves).

## Verdict scope statement (§66–§69)

Verdict: **BUNNY_MA2_T8_PASS** — real pinned rollback to the accepted T5, real forward
recovery to the accepted T6, byte-parity on both switches, protected state PRESERVED in
both directions, zero Git, zero DB rollback, zero stale-PID authority, security refusal
suite live and green, final production = v17-T6. The full M-A-2 operational verdict
(BUNNY_MA2_OPERATIONAL_PASS) is still NOT claimed (§67). **NEXT = T9 (desktop approval
policy), not begun** (§68); §41 actual reboot remains NOT TESTED (separate gate); the
factory is idle.