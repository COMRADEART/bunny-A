# Bunny-A M-A-2 independent review packet

Earlier sections retain the T1-T3 handoffs. Review the final staged T4 section below against its exact source/package identities. Production remains T3; independent review and T5-T10 remain open.

## Review scope

Review the T1 checkpoint first.
Do not issue final M-A-2 approval from T1 evidence.
The implementation owner cannot provide independent final approval.

## Candidate identities

| Item | Identity |
|---|---|
| Branch | `ma2-operational-hardening` |
| Release | `Bunny-A-Windows-v17-T1` |
| Source | `898c52cbb439cbaa738f6a44e89ca4c526591cc9` |
| Tooling | `e7f82de8f82fb427bc00fdb19a715b58df32fadf` |
| Manifest SHA-256 | `39db4865cf260e336e050e78a7a18fc221598d942169295ccb7540f451c52431` |
| ZIP SHA-256 | `8323557463ea6c02f21af265c4578ce451c23517fbd65aaf2d3ec22e2245b932` |
| Installed root | `C:\Users\allam\AppData\Local\Bunny-A\releases\Bunny-A-Windows-v17-T1` |
| Canonical state | `C:\Users\allam\AppData\Local\Bunny-A\state` |
| Recovery root | `C:\Users\allam\AppData\Local\Bunny-A\backups\state-migration-20261003-171730-e35e2c8b` |

The implementation owner reports T1 LIVE VERIFIED PASS.
The evidence includes all 23 user tables, SQLite sequence state and 54 original file hashes.
All 439 tests, typecheck and build passed. Lint had 0 errors and 10 existing warnings.
Review these claims independently.

## Check the source

1. Record the branch, HEAD and working tree.
2. Check the accepted baseline identities in `MA2_ARCHITECTURE.md`.
3. Read the release pin and installed manifest.
4. Check every runtime source blob against its recorded commit.
5. Check the complete installed inventory.
6. Check the Startup shortcut and live process identities.

## Check state

1. Check that active `host.sqlite` is outside Git.
2. Check that state is a real directory.
3. Check that no active state link points into the repository.
4. Check Host, gateway, Island and tunnel state paths.
5. Check the client hash and version.
6. Read the external migration report and final backup.
7. Check every preserved row.
8. Check the expected project path changes.
9. Check the expected provider telemetry changes and new events.
10. Check that Mission flags stay equal.
11. Check that the old repository path contains a retirement marker only.
12. Check the retained original directory in the external backup.

## Check recovery and tests

Read the Windows controller tests and injected failures.
Read the disposable cleanup test.
Run the full tests, UI tests, typecheck, lint and build.
Keep the M3 QA server outside all Stop operations.
Do not start a public tunnel solely for this T1 review.

## Open milestone gates

T2–T10 remain open at this checkpoint.
Real login, public tunnel, Android hardware and reboot require separate evidence.
Use `MA2_ACCEPTANCE_MATRIX.md` to distinguish real and simulated results.

## Evidence entry points

Read `MA2_IMPLEMENTATION_REPORT.md` for the complete record.
Read `evidence\production-verification.json` in the external recovery root.
Read `cutover\migration.json`, `preservation-live.json`, `transaction.json` and `RECOVERY.md` there.
Read the separate native Host result, duplicate startup result and regression logs under `evidence`.
Check that no stale credential copy has returned to the old repository path.
The copy found after cutover is retained in the external recovery root.
The origin of that stale copy is unknown.

# M-A-2 Gate T2

## IMPLEMENTED

Review only the Codex compatibility gate in this checkpoint.
Read `MA2_RUNTIME_COMPATIBILITY.md`, the T2 matrix and implementation section.
Policy is 1. It is independent of database schema 3.
Review the exact registry, safe metadata probes, file identity cache,
launch revalidation, and hard eligibility before scoring.
Check both Mission access modes and the existing MA1 connector, plugin and MCP controls.
Check old-child retarget and Mission approval without changing TaskManager.
Check direct argv and Claude/Ollama policy. Check that fixtures do not ship.

## LIVE VERIFIED

Native version: `codex-cli 0.153.4`.
Canonical executable:
`C:\Users\allam\.codex\packages\standalone\releases\0.153.4-x86_64-pc-windows-msvc\bin\codex.exe`.
Size: `295408944` bytes.
SHA-256: `444a3f0008050605cae73cd9b7a2dcac61294062dfaab56dd20430fd6498518b`.
Compatibility: `VALIDATED`, Bunny policy 1, read and write.
The registry path is relative to the current user's home and binds this exact release path and bytes.
Read `test-results/ma2-gate2/native-profile.json` for actual implemented-gate facts.
The trusted Windows setting parsed. An invalid enum was rejected.
No model session was needed. User config was not changed.
Read `preservation-final.json` for the T1 production checks after staging.

## SIMULATED

Read `codex-compatibility.test.ts` and the new T2 Mission tests.
The stand-ins are harmless Node executables with explicit injected test entries.
The production registry accepts only the pinned native binary with no prefix arguments.
Tests cover unknown versions, control loss, parser contradiction, same-version byte changes,
replacement before launch, metadata expiry, path changes, cancellation and restart.
Retarget, direct child approval, automatic/explicit retry and replan cannot grant Codex access.
The future-version UI fixture is a separate test Host and refuses every model launch.

## STATIC VERIFIED

482 tests passed. All 439 baseline tests remain.
Typecheck, lint, normal build, desktop build, migration compatibility and T1 tests passed.
Lint has 0 errors and 10 existing warnings.
Dev and built desktop/mobile render checks passed with clean consoles and no overflow.
Baseline text drift came from live temperature and was inspected visually.
TaskManager, schema, production startup config and user Codex config were not changed.

## NOT TESTED

No new live model Mission. No production T2 activation.
No approval for other versions, binaries or platforms.
No protection claim against a compromised Host or privileged concurrent tampering.
Native launch relies on the operating system between the final synchronous hash and process creation.

## BLOCKED

None for the builder's T2 checkpoint. Independent review is pending.

## DEFERRED

T3–T10, physical device tests, sign-in/reboot and final operational review remain open.
Do not infer full M-A-2 operational approval from T2.
Production stays v17-T1 with the v10 dashboard.
Check the exact candidate identity and staging record below before any future promotion.

## T2 candidate and evidence handoff

Candidate: `Bunny-A-Windows-v17-T2`, staged with `activated: false`.
Installed folder: `C:\Users\allam\AppData\Local\Bunny-A\releases\Bunny-A-Windows-v17-T2`.
Source: `e483f95dd329322d7846b73483fae7aa015d3bce`.
Tooling: `c39d3b76734b6c8a466bfbece1cdb0c0f5152719`.
ZIP SHA-256: `08baef54a765663b0fa5ca107c0e7d7e890403ad755a5a299647b66607d93e7e`.
Manifest SHA-256: `5cb4d701ccfc9668114438a1a2420970e2bed5a07bf39eaf205655fe3f1f391e`.
Inventory: 142 exact files. Git source check: 65 matching blobs, 58 source and 7 tooling.
Host and tunnel import closure passed.

Read `test-results/ma2-gate2/package-evidence.json` and `stage.json`.
Check the manifest against the installed files and both exact Git commits.
The separate installed Host used copied state. `candidate-host.json` records fresh native
Codex validation under policy 1, 54 tasks, 13 projects, Missions off, triggers off and no model session.
Do not classify this disposable state check as production T2 activation.

The staged dashboard passed desktop and mobile render checks.
Read `browser-candidate.log` and `screenshots/ma2-gate2-candidate.json`.
Both screenshots were inspected. The baseline text flag is true because live temperature changed.
The staged diagnostics showed the future fixture as direct-ready and Mission restricted.
The three owned T2 test servers were stopped. Read `process-cleanup.json`.

The final audit in `preservation-final.json` passed after cleanup.
Production Host 2200, gateway 42156 and unrelated M3 QA 11020 were preserved.
Protected hashes matched; database comparison had no mismatches.
Production stays v17-T1. No new model Mission was run.
Read `full-tests-final.log` and `ui-tests.log` for 482/482 passing tests.
The final handoff report is newer than the candidate's fixed source and tooling commits.
Independent review remains pending.

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

Review the exact d2088/1fc193 package and the separate 247c9d5 native entry; do not substitute the
earlier superseded 9032/274d artifact or certify from this final docs commit alone.
Check all 146 manifest paths/hash values, the 69 exact source/tooling blobs and import closure.
The real installed fatal test imports `Bunny-Host.mjs`; its harness attaches no process-level
exception/rejection handler. Only controlled inputs and disposable adapters differ.
Inspect the saved SQLite records, safe fatal marker, redacted local diagnostics and process identity
proof together, including the intentionally hung cleanup and truthful restart reconciliation.
The gateway fixture changes only the listening port and retains the actual installed containment.

Separately compare the live production snapshot to both the T1 baseline and the pre-update backup.
Expected changes are the T3 pin/deployment, one deliberate Host/gateway cutover, canonical Host
credentials, diagnostics/readiness, native EXE and its two shortcuts. Historical rows and protected
files must remain equal. The preexisting remote consent file is preserved, but new launches are
explicitly NoRemote and no public worker was created for T3.
`candidate-cleanup.json` records the disposable Host/worker cleanup; `process-cleanup.json`
also covers source/candidate UI, build preview and the earlier restricted-shell migration fixtures.

Review status is pending. Issue an independent T3 result after examining these records; leave
T4–T10 open. The builder result is not an independent milestone certification.

# M-A-2 Gate T4

Final builder checkpoint: 2026-10-04T08:24:01.508Z. T4 candidate is staged/tested only; production
remains the accepted installed T3 release. Earlier sections retain their checkpoint history.

## IMPLEMENTED

Each Windows Git capability, terminal wrapper and GitHub connector operation has its own
kernel-backed OwnedProcessGroup. The minimal x64 Node-API v8 C module creates an unnamed job,
associates the root at kernel creation, checks membership before resume and keeps the sole
non-inheritable job handle in the Host. Stop, timeout and completion terminate remaining members
and close handles; T3 graceful/fatal drain uses the live registry. A hard Host kill closes the
handle in Windows without callbacks. Gateway, Island, provider authority, TaskManager and
MissionManager architecture are unchanged. No executable-name-wide termination was introduced.

Safe state records under runtime/git-operations track operation/Mission/step/capability-run IDs,
logical container ID, canonical launcher path, PID/creation time, observed member images/IDs,
start/end, repo/cwd, action, terminal state and exit code. They contain no argv/environment
secrets or live handles. Restart marks history interrupted without PID lookup or killing.
Actual Windows owned cancellation reports stopped; accepted injected/non-Windows behavior is
retained. Merge ownership markers, write locks, cleanup and user/stale-merge refusal stay intact.
Git and indirect wrapper roots receive noninteractive Git environment controls and bounded I/O.

Review the live native external API, creation-time assignment, stdio-only inheritance and last
job-handle closure first. Review the resolver, terminal and GitHub connector call sites, then
the existing merge markers/cleanup/write locks. Check native integrity/provenance and Git blob
closure against the exact source/tooling commits below. History must never become PID authority.
Do not use production for process-tree/crash review and do not activate the candidate.

## LIVE VERIFIED

| Item | Final staged value |
|---|---|
| Release | `Bunny-A-Windows-v17-T4`, version `17.0.0-T4` |
| Source commit | `21684ff60ee53e07937194838f1356a18ac158f5` |
| Tooling commit | `2e8a21cb3168d08ed1adb08544149d3f33ed05af` |
| Manifest SHA-256 | `db649b05552c1a91232336b4ad52afe3cfc8f7fbf9849700422c065fbfc2fe1d` |
| ZIP SHA-256 | `6d72a578f456f9fd2bd8ebd7fe2db68e14c0f980033c14bdd242cbbd0dfb1df7` |
| Native module SHA-256 | `1f1e8e28d80ed346602d0d0e227bf465187750eea6c6513f077634e013761e2b` |
| Native C source SHA-256 | `da794168deed12b37a0f0e090f2566e0dc1894037de9a9142a4f48f4430a239c` |
| Inventory / Git blobs | 152 files / 73 exact blobs (66 source, 7 tooling) |
| Bundled Node / build OS | `v24.18.0` / `Microsoft Windows NT 10.0.26300.0` |
| Runtime compatibility | layout 2, schema 3, Codex policy 1, fatal policy 1, Git ownership policy 1 |
| Activation | FALSE; production remains v17-T3 |
| ZIP | `test-results/ma2-gate4/candidate-final/Bunny-A-Windows-v17-T4.zip` |
| Disposable staged directory | `C:\Users\allam\AppData\Local\Temp\bunny-t4-final-stage-e0040c1786804a949dbdb4a0f60116de\install\releases\Bunny-A-Windows-v17-T4` |

| Required T4 case | Classification / result | Evidence |
|---|---|---|
| Canonical resolution; cmd/bin/installed worker | LIVE PASS | git-installation.json; source/packaged launcher gates |
| Real worker and hook shell membership | LIVE PASS | native member list + independent Windows process trees |
| Hooks A normal, B sleep, C wait, D child/exit, E nested, F fail | LIVE PASS | owned-process-group tests; hook gates; Stop-isolation |
| Detached/background and explicit breakaway attempts | LIVE PASS | hook-detached; breakaway-denied (Win32 error 5) |
| Stop kills exactly the owned operation | LIVE PASS | capability/step/Mission stopped; every member gone |
| Unrelated user Git/shell/sleeper and Mission B survive | LIVE PASS | stop-isolation before/after PID + creation identity |
| Concurrent independent jobs | LIVE PASS | different container IDs; B stays alive after A Stop |
| Same-repository conflicting writers | REGRESSION PASS | existing workspace reader/writer/nested and serialized writer tests |
| Local gh -> shell -> Git -> hooks wrapper | LIVE PASS | offline-github-wrapper; local alias/config, no token/network |
| Timeout and pipe closure/output | LIVE PASS | timeout-output + four Stop hook variants |
| status/diff/add/commit/checkout/switch/worktree add/remove | LIVE PASS | direct-actions-and-clean-merge; add inside commit action |
| Clean merge; conflict; Stop cleanup | LIVE PASS | success/conflict/merge-stop gates; truthful cleanup state |
| Host hard kill during commit and merge | LIVE PASS | callback-free hard-host-crash + merge-hard-host-crash |
| No delayed commit/merge/file mutation | LIVE PASS | HEAD and all repo file hashes unchanged beyond hook deadline |
| Restart interruption, stale markers and no PID adoption | LIVE PASS / STATIC | recovered capability/step/Mission; no restored handles |
| Pre-existing user merge preserved | LIVE PASS | read/refused write leave MERGE_HEAD/status unchanged |
| PID reuse not trusted | SIMULATED PASS | unrelated live PID with old creation identity; recovery only |
| T3 controlled fatal exit; graceful drain | LIVE PASS | fatal-host-crash exit 70; owned-child drain regression |
| Local SSH/credential/GPG; editor refusal | LIVE PASS | git-helpers-ownership tests, synthetic local stand-ins only |
| Native API/flags/handle lifetime/integrity/reproducibility | STATIC + LIVE PASS | C/TS source; native build proof; two-directory reproducibility |
| Staged packaged runtime | LIVE PASS | 18 final packaged gates; real bundled Node/Host/native module |
| Full/T1/T2/T3/UI/build/state preservation | PASS | 547 tests; final preservation; 152 candidate / 146 production files |
| usr/bin launcher unavailable | NOT APPLICABLE | installation audit records absent path |
| Independent review and T5-T10 | PENDING / DEFERRED | not a full M-A-2 acceptance |

Source and staged-runtime live gates both pass: 18 each. The packaged entry is the real
`Bunny-Host.mjs`, launched by bundled Node against a disposable production-state snapshot,
workspace, port and token. No test-level global exception/rejection handler replaces T3.
Evidence is in `test-results/ma2-gate4/source/gates.json`, `packaged/gates.json` and
`package-evidence.json`. PIDs, creation times, exact images, job membership and repository
states are recorded. Tests use disposable repositories only.

Stop ends Mission A's launcher, worker, hook and nested children. Its capability, step and
Mission all report stopped. Mission B, raw user Git, unrelated shell/sleeper, installed Host,
gateway, native application and M3 QA retain their exact creation identities. Each operation
has a different container ID. Normal completion closes the job and kills orphan/background
children. Hooks A-F, explicit breakaway refusal, output during termination and timeout pass.

Real status/diff/add/commit/checkout/switch/worktree add/remove and a clean merge pass. A
controlled owned conflict reports conflict and runs the accepted cleanup; Stop during a
slow merge restores clean HEAD and removes only Bunny-owned markers. A pre-existing user
merge survives a read and refused write untouched. Existing same-workspace writer serialization
and stale-lock refusal regressions pass.

Hard termination of the test Host during both commit and merge runs no shutdown callback.
The kernel closes its sole job handle and all observed members disappear. Independent
observation beyond the hook deadline finds unchanged HEAD, no delayed completion marker and
identical whole-repository file hashes. Restart never resumes the old operation: running
history becomes interrupted; capability interrupted, step failed with host_restart, Mission
waiting_for_user. A hard-interrupted merge retains MERGE_HEAD and its Bunny marker/lock;
the next merge is refused without deleting that state. This requires review/recovery, not
silent cleanup. T3 controlled fatal exit drains the operation as stopped and exits 70.

Harmless local SSH, credential and GPG stand-ins are contained; the editor fails noninteractively.
The offline GitHub CLI alias proves gh -> shell -> Git -> hook/child ownership, with its own
temporary config, no token, no API request and no user-config change. Real GitHub API use is
not claimed. The connector's operation roots also use the same ownership mechanism because
[the official CLI Git client](https://github.com/cli/cli/blob/trunk/git/client.go) starts Git
for repository inspection. Provider process authority remains unchanged.

All 547 tests pass: 240 scripts + 286 application + 21 UI. All 521 T3 tests are retained,
26 T4 tests are added, none removed/skipped on this workstation. Typecheck passes; lint has
zero errors and the same ten pre-existing warnings. Normal build and Windows desktop build
pass; DATABASE_URL is unset. Dev, final normal build and final packaged desktop/mobile renders
were visually inspected with clean browser consoles, no page errors and no horizontal overflow.
The unchanged Vercel preview TCP-peer limitation truthfully renders Connection unavailable;
the Windows standalone package connects to its disposable Host and renders Host online.

Production preservation passes: v17-T3 Host 33068, instance
`37ee7306-9511-4115-b261-307f28247efe`, gateway 33116, native application 41220 and M3 QA 11020
retain their creation identities. State root/layout/schema, 54 tasks, 13 projects, nine device
rows, all historical rows and protected T1/native/T2/config/tunnel hashes remain intact.
All 146 installed T3 files and 69 exact source/tooling blobs still verify. Missions/triggers
remain OFF; no production Git operation, model session, Host restart or public-tunnel change.
See `final-preservation.json`, `production-release-verification.json` and `production-source-check.json`.

## SIMULATED

PID reuse is simulated with an old recorded creation identity/handle field and a currently
live unrelated PID. Recovery changes history only; that process survives. No forced Windows
PID-reuse cycle is claimed. Existing controlled T2/T3 injections remain in the full suite.

## STATIC VERIFIED

The native module has three exports: launch, inspect and close. They accept a newly created
root or the module's own live Node external. No restore-by-PID, integer-handle or job-name API
exists. JOB_LIST assigns the root atomically during CreateProcess; it is suspended until
membership is verified. HANDLE_LIST inherits stdio only. Jobs are unnamed, per operation,
with KILL_ON_JOB_CLOSE (0x2000) only; BREAKAWAY_OK and SILENT_BREAKAWAY_OK are absent. Membership
inspection rejects changed limits and rechecks the opened process handle's membership before
recording diagnostic PID/creation time/image. Closing a job never authorizes a kill by saved PID.

Pinned C source, architecture/readme, build script, locally generated module and build/hash proof
are in the release manifest. Two independent builds produce identical module bytes. The
compiler is reviewed local MinGW-w64 GCC 16.1.0; no dependency or opaque prebuilt helper was
downloaded. Imported native libraries are Windows Kernel32/UCRT, with no broad process privilege.
Module/source/proof/manifest checks fail closed before Git starts. Windows x64 and Windows 10+
job-list support are required. Linux/macOS retain the previous path behind the platform guard.

[Windows jobs](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects) contain
ordinary CreateProcess descendants. Independently brokered WMI/elevation/service/remote
processes are a documented Windows exception, not captured or advertised as contained. Jobs
are not a sandbox against arbitrary same-user code attacking the Host. Supported Bunny Git
roots do not request these brokered paths; helpers requesting breakaway fail. External IDE
processes and long-lived user helpers are not adopted. See `native/README.md` for this boundary
and [creation-time job assignment](https://devblogs.microsoft.com/oldnewthing/20230209-00/?p=107812).

## NOT TESTED

Windows ARM64/x86 or pre-Windows-10, absent usr/bin Git, real credential/GPG/SSH services,
real GitHub API operations, elevated/service-broker/remote helpers, physical power loss/reboot,
forced OS PID reuse and live Linux/macOS. Production Git/Host-crash tests were expressly excluded.

## BLOCKED

None in the completed T4 builder gates. There is no known unresolved BLOCKER/HIGH within
the supported T4 process-tree scope. Independent review is pending and is not claimed by the builder.

## DEFERRED

T5-T10, production activation and independent final operational review. The T4 instruction
expressly forbids automatic activation. No BUNNY_MA2_OPERATIONAL_PASS or full M-A-2 verdict is issued.
Builder gate result: **BUNNY_MA2_T4_PASS**.

# M-A-2 Gate T5

The implementing gate verdict is **BUNNY_MA2_T5_PASS**. This packet is review input;
it does not claim that an independent reviewer has accepted T5 or the full M-A-2 system.
T6–T10 remain open. No new authority system, scheduler or activity database was introduced.

| Identity | Exact reviewed/build value |
| --- | --- |
| Starting HEAD | `53120f3f81bf762f45f242f05838ff8262087988` |
| Host/dashboard source | `eb96c053c238ec0bd385187e0f4dad6777a0a4bc` |
| Tooling | `ec81f9b9dbab4236b735f917a89cf3e8393024f4` |
| Release/version | `Bunny-A-Windows-v17-T5` / `17.0.0-T5` |
| Package SHA-256 | `fe07fd6f8c3415d38e202a73b3c2ebbed8022f1e48cc1c813c92ab15c83cadb1` |
| Manifest SHA-256 | `f0531f8d2a02ed3302c3b4ade5e28859e39ec1dba380cf3f8596866ac4a18a4e` |
| Asset inventory SHA-256 | `c78fc00a559726ed8f2c513319f28df541f260883b41959fcda055210312656d` |

Review `src/lib/bunny-host/presentation.ts` and its tests for default-deny public fields,
actual secret-bearing projection output and provider turn/Task/verification distinctions.
Review the additive HTTP/gateway snapshot projection, `src/components/island/activity-model.ts`
and tests for sequence deduplication, stale snapshot rejection and canonical gap/reconnect
refresh. Inspect task/Mission/phone presentation, logical role stability, finite progress,
approval/Stop authority and artifact Produced/Verified distinction. Native presentation is
in `install/Bunny-Island.Presentation.ps1`; private provider reasoning is never a public
activity summary. Compare package provenance with live gateway assets and Settings.

Evidence under `test-results/ma2-gate5/` is classified in
[MA2_T5_DASHBOARD_PROMOTION.md](MA2_T5_DASHBOARD_PROMOTION.md):

- `candidate-acceptance.json`, `candidate-identity.json`: immutable input, 585 passing
  tests against floor 547, build and source/manifest closure checks, prerequisite acceptance.
- `ui-live-proof.json`, `ui-stop-action.json`: actual harmless local direct Task, independent
  file verification, approved deterministic six-step Mission and phone UI Stop; no paid
  provider turn. The Mission's lack of independent verification is shown truthfully.
- `ui-privacy-health.json`, `ui-provider-compatibility.json`, `ui-task-terminal-proof.json`,
  `ui-accessibility-motion.json`: privacy, actual disposable Host degradation, simulated
  future Codex restriction, truthful terminal Task, focus and motion preferences.
- `screenshots/promotion-*.png`, `screenshots/production-*.png` and render JSON: real
  packaged candidate and production desktop/mobile dark/light, zero console/page errors
  and horizontal overflow. Visual review was by the implementing agent.
- `native-*-promotion.json`, `native-installed.json`: packaged WPF state renders and
  proper installed EXE loaded/visible/responding; installed-script render against real Host.
- `candidate-fatal.json`, `t4-preservation/packaged/result.json`: exact-package T3
  fatal/interruption recovery and all 18 live Windows T4 ownership gates; disposable Hosts
  and repositories only. Preserved authority/ownership source hashes are in candidate acceptance.
- `laptop-backup.json`, `laptop-activation.json`, `production-smoke.json`,
  `production-ui-identity.json`: actual authorized promotion, 67-file backup, coherent
  installed source/manifest, 10 live asset hashes and unchanged protected history/settings.
- `post-activation-restart.json`, `post-activation-identities.json`,
  `codex-config-observation.json`: later independent Windows boot and fresh process
  identities; personal config changed later, left as found, no T5 write. Actual 0.153.4
  remains validated and Mission isolation still ignores user configuration.

Rollback preserves v10 and the measured pre-T5 v17-T3 release, native EXE/startup
configuration, two existing shortcuts and consistent database snapshot. Inspect
`rollback-laptop.ps1`: exact manifest/backup guards, idle-work requirement, fresh live
process identity, scoped termination, no automatic live DB overwrite and no Git checkout.
Its preparation is verified; executing production rollback is not claimed.

No physical remote transport, paid model turn, production Git/crash test or full independent
acceptance is claimed. The normal Nitro adapter lacks trusted-peer data and renders Offline;
the accepted installed Windows gateway remains authenticated and online. OD-1 was limited
to presentation lessons; excluded AgentWorkspace, takeover, revocation/publication runtime,
Slack/calls and AG-UI/core framework imports are listed in the detailed report.
