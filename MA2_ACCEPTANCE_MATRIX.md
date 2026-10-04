# Bunny-A M-A-2 acceptance matrix

The first table and T1/T2 sections retain their earlier checkpoint results. The T3 section below
records the current installation and T3 builder result. T4–T10 and independent review remain open.

| Gate | Result at this checkpoint | Evidence |
|---|---|---|
| T1 state migration | LIVE VERIFIED PASS | installed T1 controller; committed external journal |
| T1 database preservation | LIVE VERIFIED PASS | 23 user tables and SQLite sequence; no lost rows |
| T1 original file retention | LIVE VERIFIED PASS | 54 equal file hashes in both external recovery trees |
| T1 installed Host startup | LIVE VERIFIED PASS | PID 2200; correct source, state, token and schema |
| T1 gateway state access | LIVE VERIFIED PASS | v10 gateway; 54 tasks; clean browser console |
| T1 duplicate startup and migration | LIVE VERIFIED PASS | same Host instance; `already-migrated` |
| T1 installed inventory | LIVE VERIFIED PASS | 140 files; 63 exact source/tooling blobs |
| T1 cloudflared location and identity | LIVE VERIFIED PASS | external binary; version 2026.9.3; equal hashes |
| T1 separate native Host test | SIMULATED PASS | real installed candidate; disposable production snapshot |
| T1 cutover recovery | SIMULATED PASS | Windows controller; three injected failures |
| T1 repository cleanup isolation | SIMULATED PASS | disposable `git clean -fdx` |
| T1 tool hash checks | SIMULATED PASS | missing and changed binary tests |
| T2 Codex compatibility gate | IMPLEMENTED; native runtime LIVE VERIFIED; refusal cases SIMULATED PASS | policy 1; T2 evidence below |
| T3 fatal-error containment | NOT TESTED; not implemented | open |
| T4 Git launcher and hooks | NOT TESTED; not implemented | open |
| T5 current dashboard promotion | NOT TESTED | v10 remains configured |
| T6 public installed tunnel | NOT TESTED | no new public tunnel in T1 |
| T7 real sign-out/sign-in | NOT TESTED | requires a controlled user session |
| T8 later release rollback | NOT TESTED | T1 failure recovery is separate evidence |
| T9 desktop approval policy | NOT TESTED; not implemented | open |
| T10 final operational audit | NOT TESTED | requires completed gates |
| Physical Android | NOT TESTED | no hardware test |
| Actual reboot | NOT TESTED | no reboot |

The final full M-A-2 verdict is NOT ISSUED.
At the T1 baseline, all 439 regression tests passed. Typecheck and build passed.
Lint had 0 errors and 10 existing warnings.
The evidence applies to source `898c52cbb439cbaa738f6a44e89ca4c526591cc9` and tooling `e7f82de8f82fb427bc00fdb19a715b58df32fadf`.

# M-A-2 Gate T2

## IMPLEMENTED

| T2 check | Result | Evidence |
|---|---|---|
| Exact runtime registry and policy version | PASS | `codex-compatibility.server.ts`; policy 1 |
| Both Mission access modes require compatibility | PASS | hard router constraint; Mission approval hook; adapter |
| Manual retarget, including old children | PASS | MissionManager public retarget; router constraint |
| Retry and replan recalculate eligibility | PASS | fresh child routing; launch validation |
| Direct legacy policy | PASS | unchanged argv; separate UI readiness |
| Existing provider observation persistence | PASS | existing JSON; schema 3 unchanged |

## LIVE VERIFIED

| Native check | Result | Evidence |
|---|---|---|
| Codex 0.153.4 exact binary | VALIDATED for read and write | `native-profile.json` |
| Trusted Windows enum | accepted; invalid enum rejected | parser probes and implemented gate |
| All 12 MA1 tool defaults | reported disabled | `features list` parser check |
| T1 and user config preservation after staging | PASS | `preservation-final.json`; equal protected hashes |

Canonical binary: `C:\Users\allam\.codex\packages\standalone\releases\0.153.4-x86_64-pc-windows-msvc\bin\codex.exe`.
SHA-256: `444a3f0008050605cae73cd9b7a2dcac61294062dfaab56dd20430fd6498518b`.

## SIMULATED

| Refusal or policy check | Result |
|---|---|
| Unknown future / old version / other patch | PASS: Mission ineligible |
| Empty / malformed / nonzero / timeout version | PASS: fail closed |
| Failed help / missing required flag or sandbox mode | PASS: fail closed |
| Windows enum or extension control contradiction | PASS: incompatible |
| Same version, different bytes | PASS: no inherited approval |
| Binary replacement after discovery, restored size and mtime | PASS: no model starts |
| Path change before or during checks | PASS: no model starts |
| Version change with unchanged file bytes | PASS: re-probed and refused |
| Stale facts / wrong policy / missing evidence | PASS: ineligible |
| Read and write routing / scoring / manual override | PASS: hard exclusion |
| New and old child retarget / child direct approval | PASS: refused |
| Automatic retry / explicit retry / replan after replacement | PASS: no second model session |
| Stop during metadata probes | PASS: no later model spawn |
| Restart with saved validated facts | PASS: unknown until this Host probes |
| Legacy direct launch and retarget | PASS: deliberate old policy |
| Restricted UI on desktop and mobile | PASS: direct readiness and Mission restriction are separate |
| Installed T2 Host with copied state | PASS: fresh native policy 1 validation; 54 tasks; 13 projects; no model |

## STATIC VERIFIED

482/482 tests: 233 scripts + 228 application + 21 UI. No test was deleted.
Typecheck, lint and builds passed. Lint has 10 existing warnings and no errors.
Dev and desktop middleware browser checks have visible content, no console/page errors and no overflow.
Live temperature caused baseline text drift; both built screenshots were inspected.
The staged candidate also passed desktop and mobile checks with no errors or overflow.
Its baseline flag is true because live temperature changed; body lengths match.
Candidate inventory: 142 exact files. Git check: 65 exact source/tooling blobs.
Host and tunnel import closure passed. The candidate is staged and has not been activated.
Source: `e483f95dd329322d7846b73483fae7aa015d3bce`.
Tooling: `c39d3b76734b6c8a466bfbece1cdb0c0f5152719`.
Read `test-results/ma2-gate2/package-evidence.json` for package identities and final checks.

## NOT TESTED

New live Codex model Mission; production T2 activation; other Codex binaries and platforms.

## BLOCKED

None for T2.

## DEFERRED

T3–T10 and final independent operational review remain open.
T2 does not authorize a full M-A-2 operational verdict.

# M-A-2 Gate T3

Checkpoint: 2026-10-04. The earlier T1/T2 sections are historical evidence.
The user subsequently requested a laptop update and a proper Windows application followed by testing.
The combined T3 release was validated first, backed up, production-activated once and then tested in place.
This is a T3 builder checkpoint. Independent review is pending; no full M-A-2 verdict is issued.

## IMPLEMENTED

The four failure classes are OPERATION_FAILURE, SUBSYSTEM_FAILURE, HOST_DEGRADED and HOST_FATAL.
Known local boundaries fail their owning operation. Known subsystem failure refuses dependent work.
Unknown global rejection, any uncaught exception or failed containment drains and exits conservatively.
Correlation alone never authorizes continuation. The real source and installed entries own the process handlers.

Health exposes healthy/degraded/draining/fatal and a safe previous-fatal summary.
Fatal drain refuses new command/pairing mutations, reserves one terminal winner, persists redacted
local evidence, stops only live Bunny-owned child handles and exits 70 at a bounded deadline.
SQLite state/event/outcome transitions roll back together. Database logging failure has a bounded
file fallback; public events and status do not disclose stacks, credentials or connector payloads.
Startup reconciles active tasks, capability runs and Mission steps before acknowledging the marker.
Old sessions are never claimed resumed, including when Missions are OFF.

The local ownership audit, safe serialization limits, process authority and retired credential writer
investigation are in `MA2_T3_FAILURE_CONTAINMENT.md`.
The unsafe legacy repo launchers are retired. T1 layout 2/schema 3 and T2 Codex policy 1 remain in force.
The per-user `Bunny-A.exe` loads the exact manifest-pinned launcher in an STA runspace, reuses a healthy
Host/gateway and supplies `NoRemote`. It is a separate native entry, outside the immutable release inventory.

## LIVE VERIFIED

- The actual packaged candidate entry encountered an unknown unhandled rejection in a disposable
  database/workspace with its own port/token. A deliberately blocked capability forced the real
  shutdown deadline: exit 70 after 3043 ms. Read inspection remained available; command and pairing
  requests returned 503 and no new task appeared.
- The owned harmless native worker PID 12180 and descendant 29776 exited. Unrelated sentinel 24120,
  production T1 Host 2200, gateway 42156 and M3 QA 11020 retained their exact creation identities
  during the failure test. These are real process observations, not model execution.
- A fresh packaged Host PID 9828 reported the previous fatal instance. The task stayed failed with
  exactly one failed terminal event; the blocked capability became interrupted, its step failed with
  `host_restart`, and the Mission waited for user review. SQLite integrity was OK/schema 3.
  Recovery events and marker acknowledgement followed reconciliation; no old session resumed.
- A separate real packaged gateway exited 71 after an injected unknown rejection while the copied
  local Host remained healthy with the same instance/PID. No public tunnel was created.
- After all candidate gates passed, the user-authorized cutover preserved the canonical state and
  workspace. Production T3 Host 33068/instance `37ee7306-9511-4115-b261-307f28247efe` and gateway
  33116 remain healthy. Later native interface launches reused them without restarting the Host.
- The installed native Windows application PID 41220 is responding. Its own WPF PresentationSource
  reported a visible, loaded 360×86 Bunny Island. The installed native self-test rendered the Bar,
  exited 0 and had empty stderr; its screenshot was visually inspected. Start menu and startup
  shortcuts target the exact installed EXE, with no remote startup.
- Post-update comparison preserves all 54 tasks, 13 projects, nine device database records,
  historical Mission/capability rows, migration lineage and schema. Five protected baseline hashes,
  43 protected state files and all 59 backup inventory entries match. All nine device records were
  already revoked; no pairing was added. Missions and triggers remain OFF.
- Actual native Codex 0.153.4 remains VALIDATED for read/write under policy 1 and the same binary hash.
  User configuration was unchanged. No model session was requested for T3 acceptance.
- Desktop/mobile source, packaged candidate and actual installed dashboard render with visible
  content, no console/page errors and no horizontal overflow. Screenshots were visually inspected.
  Installed Agents/Codex details show Ready, policy 1 read/write Validated and zero active jobs.
  The preview now reads the actual installed state. Disposable QA Hosts, gateway and workers are closed.

## SIMULATED

Controlled fixture inputs cover scheduler, session, capability, browser and computer exceptions;
provider stdout/normalization/stream/exit failures; discovery and telemetry failures; HTTP/SSE;
timer backoff; SQLite rollback/fallback; scoped degradation; Stop/failure/late-completion races.
The 33 T3 application checks and six script checks supplement the unchanged T1/T2 regression floor.
Harmless native tunnel stand-ins test three bounded launches, output rejection and cancellation.
The copied-state fatal/recovery test uses real installed code and real OS processes with artificial
failure inputs; it is not a live model Mission or a production crash.

## STATIC VERIFIED

Final regression: **521/521** = 239 script + 261 application + 21 UI tests; 482 prior checks retained,
with no deletions or skips. Typecheck, lint, normal build and Windows desktop build pass.
Lint has zero errors and the same ten existing warnings. DATABASE_URL was removed for these gates.
An initial restricted-shell run could not perform Windows process inspection/cleanup; the native
Windows rerun passed fully, and its disposable leftovers were subsequently closed by exact identity.

Final package: `Bunny-A-Windows-v17-T3`, source
`d2088ae9e9121310c54aa58d231a8804075fc41f`, tooling/pin
`1fc19339d2926670c61731ffa46e99a7f3ddce60`.
ZIP SHA-256: `c3f74245dc692134c8089eeda4a3a3c9e243eb05e4add058bc7356f452604a78`.
Manifest SHA-256: `66fbcddf1e2678505b7ca2cf548c4dc1226b9a698e8fad86f70ea208c00bf9f0`.
All 146 inventory files and 69 exact Git blobs match; runtime import closure passes.
Layout/database/Codex/failure policy versions are 2/3/1/1.

Native entry source commit: `247c9d57805ac60bb883d0e82fd82c929cc3eeee`.
Source SHA-256: `085805674bebbf55074a6562804298d13f5a5812fdfd3009f0a9420cd54fef8f`.
Installed EXE SHA-256: `a2ac666fc9c3a32dc6918bc89b78dfe7c7a8d59eeff17616acf8d25ed41ee102`.
The Windows .NET x64 winexe compile, provenance and installed receipt are separate evidence.
Compiled native boundary checks also verify bounded append and refusal of Git paths, hard links
and directory links; neither the application Main nor production state is used for those fixtures.
Neither this entry nor this later handoff changes the pinned package's source/tooling identity.

Unknown globals cannot silently continue; fatal cleanup is 3 seconds by default, at most 5 seconds.
Installed startup has one launch attempt and no crash restart loop. Recovery requires a fresh launch.
Authentication, pairing, Mission authorization, grants, path checks and compatibility remain enforced.
The legacy writer chain proves which helpers could recreate retired credentials, not which historical
invocation caused the T1 observation. Production `<repo>/.bunny-a` contains only `state-retired.json`.

## NOT TESTED

Production fatal fault injection, new live model Missions, real public tunnel activation, physical
Android, arbitrary provider versions, actual logon/reboot and native desktop interaction fault injection.
The normal Vercel build was rendered and visually checked on both viewports, with a clean console.
Its local preview adapter cannot establish a trusted workstation TCP peer and correctly reports
Connection unavailable. Live Host integration was verified through the actual Windows node-middleware
package instead; authentication was not weakened to bypass the adapter difference.
The existing share-card placeholder is retained for this workstation/admin utility; no brand redesign occurred.

## BLOCKED

No known unresolved BLOCKER/HIGH within T3 after final candidate, installation and preservation checks.
Independent review remains pending and must assess this evidence; this builder checkpoint does not replace it.

## DEFERRED

T4–T10 and final independent operational review remain open. Updating the user's installed dashboard
as part of this T3 package is not a T5/T10 certification. Later release rollback, reboot, public
transport, sign-out/sign-in and desktop approval acceptance retain their own gate scope.

Evidence is under `test-results/ma2-gate3/`.
Read `package-evidence.json`, `candidate-acceptance.json`, `candidate-fatal.json`,
`candidate-gateway.json`, `candidate-processes-before.json`, `candidate-processes-after.json`,
`laptop-backup.json`, `laptop-activation.json`, `preservation-before-activation.json`,
`preservation-after-activation.json`, `windows-application.json`, `native-build.json`,
`native-installed.json`, `process-cleanup.json`, `full-tests-final.log`,
`native-evidence-boundaries.json`,
`ui-tests-final.log`, `typecheck-final.log`, `lint-final.log`, `build-final.log` and `package-final.log`.
`MA2_T3_FAILURE_INJECTION_MATRIX.md` maps each required failure area to its evidence.
`stage.json` and `candidate-acceptance.json` intentionally retain their pre-activation timestamps/status;
the later laptop activation and final package evidence record the authorized production cutover.

| T3 acceptance area | Builder result | Evidence |
| --- | --- | --- |
| Local async boundaries / classifications / serialization | IMPLEMENTED + controlled fixtures PASS | failure matrix; 39 added T3 checks |
| Unknown global rejection / uncaught exception | Real installed/source process PASS | candidate-fatal.json; full application tests |
| Fatal work refusal / bounded exit / process isolation | LIVE test-Host PASS | command/pairing 503; exit 70 in 3043 ms; owned tree proof |
| Honest restart / one terminal outcome | LIVE test-Host PASS | failed task; interrupted run; paused Mission; acknowledged marker |
| Gateway failure independent of Host | LIVE disposable gateway PASS | exit 71; local Host identity preserved |
| Real Windows application installation and rendering | LIVE installed PASS | native-installed.json; shortcuts; visible WPF readiness |
| T1 production preservation | LIVE after authorized cutover PASS | 54 tasks; 13 projects; nine device rows; schema 3; protected hashes |
| T2 provider policy | LIVE metadata + regression PASS | native 0.153.4 VALIDATED; unknown/swap refusal tests retained |
| Full gates / exact package | PASS | 521 tests; builds; 146 files; 69 Git blobs |
| Independent T3 review / full M-A-2 verdict | PENDING / NOT ISSUED | review packet; T4–T10 open |
