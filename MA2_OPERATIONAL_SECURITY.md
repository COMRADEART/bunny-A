# Bunny-A M-A-2 operational security

Earlier sections retain T1-T3 checkpoint evidence. The final T4 section records staged process ownership and preservation checks. Production remains T3; independent review remains pending.

## T1 controls

The installed launcher checks the manifest hash against `install.json`.
It checks the complete installed file inventory.
It checks the shared state helper before it executes that helper.
Missing, changed or unexpected release files cause refusal.

The launcher refuses an existing Host with a different runtime path.
It does not kill that Host.
State cannot use a directory link or a critical file link.
The Host refuses a missing database, damaged database or unknown schema.

Cloudflared has a recorded binary hash.
Both launcher and worker check the client.
The migration preserves local credentials and paired-device records.
The reports contain row fingerprints and file hashes. They do not contain bearer tokens.

Mission and capability authority checks stay unchanged.
Missions and triggers must retain their pre-migration flags.

The live migration preserved the Host token and all nine paired-device records.
Unpaired state access returned HTTP 401.
Missions and triggers stayed OFF.
The final state tree had no links to the repository.
The installed manifest matched its configuration hash and all 140 file hashes.
No new public tunnel or provider task started during T1 acceptance.

## Open gates

T3 must add fatal-error containment.
T4 must complete Windows Git process ownership.
T9 must define bounded desktop approval policy.
T10 must test the completed operational architecture.
This T1 change does not certify those gates.

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

Security review focus: global ownership must come from the trusted callback registry, diagnostics must
remain redacted and bounded when SQLite fails, and fatal cleanup must never acquire authority from a
stored PID. Verify the unchanged T1/T2 refusal suites, canonical application-data state, no newly
created public worker and zero production model requests. The native entry logs only an error type
on bootstrap failure; it checks the pinned manifest before invoking the inventory-validating launcher.

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

## LIVE VERIFIED

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
