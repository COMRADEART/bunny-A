# Bunny-A M-A-2 operational security

T1/T2 sections retain their historical checkpoint evidence. The T3 section below records the
current installed release and the completed T3 builder checks; independent review remains pending.

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

## IMPLEMENTED

Windows Git operations and terminal wrappers use independent creation-time Job Objects.
The Host owns the sole non-inheritable handle; kill-on-close is set and breakaway disabled.
The minimal x64 Node-API module is compiled from pinned C source, packaged and hashed.
Ownership records are history; restart never trusts saved PIDs/handles. Stop/timeout kill
only the live operation job. Merge markers/cleanup, workspace locks, T1/T2/T3 and provider
policy remain intact. See [process ownership](MA2_PROCESS_OWNERSHIP.md) and
[native architecture](native/README.md) for the API, OS boundary and build proof.

## LIVE VERIFIED

Disposable source Hosts/repositories prove cmd/bin/worker launchers, hooks/nested/detached
children, breakaway refusal, isolated Stop, timeout, merge cleanup, hard commit/merge crashes,
no delayed writes, honest restart and T3 fatal integration. Local SSH/credential/GPG stand-ins
are contained; editors fail noninteractively. Production identities/hashes/rows/settings remain
unchanged. See `test-results/ma2-gate4/source/gates.json` and preservation records.

All 546 local tests pass (240 scripts, 285 application, 21 UI): the 521 T3 floor plus 25 added
T4 tests, with none removed/skipped on this workstation. Typecheck/normal build pass; lint has
zero errors and ten preexisting warnings. Desktop/mobile renders are clean. Staged v17-T4
Windows build and packaged-runtime proof are PENDING at this source checkpoint; the final
candidate identity/result will be appended after its actual gates pass. No activation occurs.

## SIMULATED

PID reuse uses a historical record with an old creation identity and a currently live unrelated
PID. Recovery changes history only; that process survives. No forced OS PID-reuse cycle is claimed.

## STATIC VERIFIED

Only native live external objects authorize close. JOB_LIST assigns the root before its first
instruction; stdio-only inheritance prevents descendants retaining the job handle. Jobs are
per operation and unnamed. Canonical installed Git paths/hashes and absent usr/bin launcher
are recorded. Package closure checks include native resources; reproducibility passes.
The explicit Windows service-broker exception and unchanged provider authority boundary are
documented in the ownership/native documents; independently brokered processes are not captured.

## NOT TESTED

Other Windows architectures/older Windows, absent usr/bin Git, real credential/GPG/elevated
service/remote helpers, physical power loss/reboot, forced OS PID reuse or live Linux/macOS.
No production Git operation or production Host crash was performed.

## BLOCKED

Packaged acceptance and independent review are pending at this source checkpoint. No known
unresolved BLOCKER/HIGH is present in the completed local T4 gates. No final gate verdict yet.

## DEFERRED

T5-T10, production activation and final independent operational review. No full M-A-2 verdict.
