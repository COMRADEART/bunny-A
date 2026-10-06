> Current T9 status (2026-10-06): the duplicate Calculator incident was reopened and remediated in T9R. **BUNNY_MA2_T9R_PASS**, classification **MIXED**. Current staged candidate is v21-T9; production remains v17-T6. See [T9R closure](MA2_T9R_DUPLICATE_CALCULATOR_CLOSURE.md). Earlier T9 results below are historical. T10 was not started.

# Bunny-A M-A-2 implementation report

The earlier sections retain the T1-T3 reports. The final T4 section records the staged candidate and builder evidence. Production remains T3; no full M-A-2 approval is claimed.

## Scope

Gate T1 is LIVE VERIFIED. Production state is outside Git.
This checkpoint covers T1. The full M-A-2 milestone remains open.
No independent M-A-2 approval is claimed.

## IMPLEMENTED

State layout 2 uses a real application-data directory outside Git.
Host, gateway, Island and tunnel paths use explicit installed state.
The migration makes a verified backup before Stop.
It checks copied files and database rows before cutover.
It checks the restarted Host before it retires the old state directory.
The original directory remains in an external backup.

The launcher checks the full manifest and refuses runtime collisions.
The installed Host refuses legacy state fallback and invalid databases.
The tunnel client has a hash/version record.
Old logs remain in the installed log archive.

## LIVE VERIFIED

The controller completed migration at `2026-10-03T21:17:40Z`.
The final row and file check ran at `2026-10-03T21:25:45Z`.
The migration journal records `committed`.

| Item | Installed value |
|---|---|
| Release | `Bunny-A-Windows-v17-T1`, version `17.0.0-T1` |
| Source SHA | `898c52cbb439cbaa738f6a44e89ca4c526591cc9` |
| Tooling SHA | `e7f82de8f82fb427bc00fdb19a715b58df32fadf` |
| Manifest SHA-256 | `39db4865cf260e336e050e78a7a18fc221598d942169295ccb7540f451c52431` |
| ZIP SHA-256 | `8323557463ea6c02f21af265c4578ce451c23517fbd65aaf2d3ec22e2245b932` |
| Release root | `C:\Users\allam\AppData\Local\Bunny-A\releases\Bunny-A-Windows-v17-T1` |
| State root | `C:\Users\allam\AppData\Local\Bunny-A\state` |
| Database | `C:\Users\allam\AppData\Local\Bunny-A\state\host.sqlite` |
| Default workspace | `C:\Users\allam\Bunny-Workspace` |
| Host PID | `2200` |
| Host instance | `f2ff2ff7-f992-4da4-a9ad-d4846234b597` |
| Host start | `2026-10-03T21:17:36.8966720Z` |
| Gateway PID | `42156` |
| Dashboard | installed `Bunny-A-Windows-v10` |
| Mission flags | Missions OFF; triggers OFF |
| Tunnel | no worker started; public acceptance NOT TESTED |
| Island | closed before migration; left closed |

All 140 installed files match the manifest.
All 56 source files and 7 tooling files match their Git blobs.
The native import check found no required import outside the release.
The Startup shortcut selects the installed T1 launcher.
The state root and its files have no directory links or multiple file links.
The old repository path contains `state-retired.json` only.

All 23 user tables and `sqlite_sequence` passed the row check.
The database schema stays at version 3. `PRAGMA integrity_check` returns `ok`.
No task, outcome, device, Mission, skill or authorization row changed.
Nine project paths below the old state root changed to the new root.
Project IDs and all other project fields stayed equal.
Historical task paths and output stayed equal.

Provider discovery changed `probedAt`, `usageObservedAt` and `usageWindows` only.
All six provider IDs stayed equal. Other provider fields stayed equal.
The cutover had 2,002 events. All 2,002 remained at the final row check.
The Host token and paired-device records stayed equal.
Unpaired Host state access returned HTTP 401.

The dashboard displayed 54 tasks and 29 completed tasks.
It displayed three ready agents. The browser had no errors or warnings.
A repeated installed launch reused Host PID 2200 and the same instance.
A repeated migration returned `already-migrated`.

The unrelated M3 QA process, PID 11020, retained its executable, command line and start time.
No production process reads the retired repository credential path.
Old development QA scripts need an explicit state path before they can read production state again.

## Database counts

| Table | Before | After |
|---|---:|---:|
| capability_grants | 0 | 0 |
| capability_runs | 4 | 4 |
| devices | 9 | 9 |
| events | 2002 | 2002 |
| inbox_events | 6 | 6 |
| migrations | 1 | 1 |
| mission_artifacts | 1 | 1 |
| mission_authorizations | 3 | 3 |
| mission_dependencies | 0 | 0 |
| mission_memory | 7 | 7 |
| mission_steps | 3 | 3 |
| missions | 3 | 3 |
| outcomes | 39 | 39 |
| permission_requests | 0 | 0 |
| policies | 1 | 1 |
| projects | 13 | 13 |
| providers | 6 | 6 |
| settings | 2 | 2 |
| skill_versions | 12 | 12 |
| skills | 12 | 12 |
| tasks | 54 | 54 |
| triggers | 0 | 0 |
| workspace_locks | 0 | 0 |
| sqlite_sequence | 1 | 1 |

The verified cutover snapshot SHA-256 is `084992091d60e82196959778c6333a5f6db29fe5004b5bf976fe2a0cfd29511c`.
The schema fingerprint is `f92b3e1076a4e6884378426e21e53db39d04ffa88c865b58f8c7274bcb1aaa89`.
The live database hash can change with normal writes. Row checks establish preservation.

## Tool and provider identities

Cloudflared is `state\cloudflared\cloudflared.exe`.
Its version is `2026.9.3`, built `2026-09-24T08:31 UTC`.
Its size is 55,366,080 bytes.
Its SHA-256 is `f096265ec2fcbe9bb6e2d64268db167ced3fcbb83d894bdb9e2fcdb26f2ea7e2`.
The actual binary hash matches the tool record and install configuration.

| Provider | Observed version |
|---|---|
| Ollama | `0.35.0` |
| Codex | `codex-cli 0.153.4` |
| Claude Code | `2.1.288` |
| OpenCode | `1.18.34` |
| Cline | `3.0.67` |
| Cursor | `2026.09.10-fd3934a` |

These observations do not provide T2 compatibility approval.

## Backup and recovery

The external recovery root is:

`C:\Users\allam\AppData\Local\Bunny-A\backups\state-migration-20261003-171730-e35e2c8b`

`host-before-stop.sqlite` is the verified online backup.
`cutover\host.sqlite` is the verified final snapshot.
`cutover\original-state` is the complete file copy.
`retired-original-state` is the complete original directory.
All 54 original files match the recorded hashes in both retained trees.
The root also holds before/after configuration, the old shortcut and `RECOVERY.md`.
Do not restore `install-before.json` alone. It describes the retired layout.
Use the controlled external recovery procedure.

A stale credential copy appeared at the retired repository path after cutover.
It held an old PID and instance. It did not identify the current Host.
Its origin is unknown. The copy was retained as `post-cutover-stale-credentials.json` in the external recovery root.
The final checks found the retirement marker only at the old path.
The live Host and dashboard worked after this copy was removed from the repository.

## Regression gates

Tests ran against HEAD `e7f82de8f82fb427bc00fdb19a715b58df32fadf`.
All 439 tests passed: 233 script tests, 185 application tests and 21 UI tests.
No tests failed or skipped.
Typecheck and build passed.
Lint had 0 errors and 10 existing warnings.
The test and build processes did not receive `DATABASE_URL`.
Later changes update evidence documents only.

## SIMULATED

The real installed candidate also passed a separate production-snapshot test.
That test used a temporary database, workspace, port and Host token.
It did not start a production task.
The migration tests cover all tables and committed WAL records.
Windows controller tests cover successful cutover and idempotent retry.
They cover failure after copy, configuration switch and Host restart.
Recovery uses a pinned prior release and external data.
Disposable cleanup cannot remove migrated state.

## STATIC VERIFIED

MissionManager, TaskManager, router and capability authority policies stay unchanged.
T1 changes state paths and deployment checks only.
Installed startup does not select source from the development checkout.

## NOT TESTED

Real public tunnel, real Windows sign-in, reboot and physical Android.
Full T2–T10 acceptance remains open.

## BLOCKED

None at this checkpoint.

## DEFERRED

T2–T10 remain separate gates.
The v10 dashboard stays configured until T5.
Fresh independent review must precede final M-A-2 approval.

## Evidence files

The local evidence root is `test-results\ma2-gate1`.
Key records are `production-verification.json`, `release-info-live.log`, `live-processes.json`,
`duplicate-startup-live.json`, `migration-idempotent-live.json`, `native-host.json` and `gates\summary.json`.
The external recovery root holds a copy under `evidence`.
The authoritative cutover reports are `cutover\migration.json`, `preservation-live.json` and `transaction.json`.
No full M-A-2 verdict is issued at this checkpoint.

# M-A-2 Gate T2

## IMPLEMENTED

T2 adds a structured Codex profile and an exact runtime registry.
Bunny policy version is **1**. Database schema stays at **3**.
Only the observed Windows native `codex-cli 0.153.4` has an approved entry.
Unknown versions and different bytes do not inherit approval.

Discovery uses safe version, help and local parser probes.
It verifies both sandbox modes, both ignore flags, config overrides, the trusted Windows enum,
and all 12 existing MA1 tool and extension controls.
It streams SHA-256 and caches it by file identity for ordinary discovery.
Before every scoped launch, the adapter resolves again, bypasses the hash cache,
repeats safe probes, resolves again, and hashes immediately before canonical spawn.
The final check and spawn have no intervening asynchronous wait.
Validated metadata expires after 10 minutes.

Both Mission access modes use a hard constraint before ranking.
Retarget checks current facts, including old children without that constraint.
Retry and replan route fresh children. Direct child approval also uses the Mission check.
The existing provider JSON stores observed facts. A new Host must probe them again.
Material compatibility changes use the existing status-change event.
Launch refusal emits `provider.compatibility_rejected`. Routine check times do not emit changes.
TaskManager and scoring were not changed.
Unscoped direct tasks keep their exact MA1 arguments and existing readiness checks.
Claude and Ollama retain their current behavior.
The UI shows direct readiness and Mission compatibility as separate facts.

The desktop build found generated client files in Tailwind's server scan.
Adding `.output/` to `.gitignore` excludes them.
Client and server then use the same CSS asset. Source CSS was not changed.

## LIVE VERIFIED

| Current Codex fact | Result |
|---|---|
| Requested path | `C:\Users\allam\AppData\Local\Programs\OpenAI\Codex\bin\codex.exe` |
| Canonical path | `C:\Users\allam\.codex\packages\standalone\releases\0.153.4-x86_64-pc-windows-msvc\bin\codex.exe` |
| Version | `codex-cli 0.153.4` |
| Size | `295408944` bytes |
| SHA-256 | `444a3f0008050605cae73cd9b7a2dcac61294062dfaab56dd20430fd6498518b` |
| Compatibility | `VALIDATED` |
| Bunny security policy | `1` |
| Read / write exclusion | neither access mode was excluded |

The implemented gate performed this check. No model session was started.
The positive Windows parser probe returned 0. The invalid enum returned 1.
The exact MA1 isolation arguments remain pinned by the existing tests.

T1 preservation passed. The same production Host instance and PID 2200 remained active.
The gateway stayed at PID 42156. M3 QA PID 11020 was preserved.
State root and database remain outside Git. Schema is 3 and integrity is `ok`.
Historical rows were preserved. The comparison allows only normal telemetry and appended events.
All protected hashes matched: install config, Startup shortcut, migration journal,
cutover report and database, T1 manifest, cloudflared binary, and user Codex config.
The repository `.bunny-a` contains only `state-retired.json`.
Missions and triggers remain off in production.

## SIMULATED

43 new regression tests cover T2. All 439 baseline tests remain.
Harmless executable contents can report the same version without sharing approval.
A replacement after discovery, even with restored size and mtime, starts no model.
Other cases cover future and old versions, malformed output, timeout, failed probes,
missing flags, parser contradictions, stale metadata, path changes and Host restart.
Mission tests cover read/write exclusion, manual override, old and new retarget,
direct child approval, automatic/explicit retry, and replan after replacement.
Existing isolation tests still use real owned processes with harmless stand-ins.
Their metadata approval is explicit and test only. Test helpers do not ship in the release.

A source Host used a disposable production snapshot copy on port 43120.
Its installed Codex profile was validated. The UI showed Mission execution as validated.
It then used a harmless `codex-cli 0.999.0` stand-in for the restricted state.
The stand-in remained ready for direct tasks and refused all model launches.
The UI showed **Direct tasks ready**, **Restricted**, and the concrete reason.
Desktop and mobile views were inspected. Production settings were not changed.

## STATIC VERIFIED

482/482 tests passed: 233 script, 228 application and 21 UI tests.
Typecheck passed. Lint passed with 0 errors and the same 10 warnings.
Normal and Windows desktop builds passed. Migration compatibility and T1 tests passed.
Dev and desktop middleware UI checks have content, no errors and no horizontal overflow.
Live temperature changed the baseline text. Both built viewports were inspected.
Standard Vite preview does not serve the existing desktop middleware preset.
The built check used the desktop gateway's middleware and manifest contract on an isolated port.

## NOT TESTED

No new live Codex model Mission. No future binary was certified.
T2 was not selected for production startup. No production Host restart was performed.
This checkpoint does not prove immunity to a compromised Host or privileged concurrent tampering.

## BLOCKED

None for the T2 implementation and local acceptance checkpoint.

## DEFERRED

T3–T10 remain open. Production startup stays pinned to v17-T1.
The v10 dashboard stays configured until T5.
Full M-A-2 approval and independent final review remain pending.

## T2 evidence entry points

Read `test-results/ma2-gate2/baseline.json`, `native-profile.json`, `preservation-final.json`,
`ui-future-runtime.json`, `full-tests-final.log`, `focused-final.log`, `ui-tests.log`,
`typecheck.log`, `lint.log`, `build.log`, `build-desktop.log`, `browser-dev.log` and `browser-built.log`.
Rendered screenshots are under `screenshots/ma2-gate2-*`.

## T2 candidate identity and final acceptance

| Candidate fact | Exact value |
|---|---|
| Release | `Bunny-A-Windows-v17-T2` |
| Source commit | `e483f95dd329322d7846b73483fae7aa015d3bce` |
| Tooling and candidate pin commit | `c39d3b76734b6c8a466bfbece1cdb0c0f5152719` |
| Installed folder | `C:\Users\allam\AppData\Local\Bunny-A\releases\Bunny-A-Windows-v17-T2` |
| ZIP SHA-256 | `08baef54a765663b0fa5ca107c0e7d7e890403ad755a5a299647b66607d93e7e` |
| Manifest SHA-256 | `5cb4d701ccfc9668114438a1a2420970e2bed5a07bf39eaf205655fe3f1f391e` |
| Inventory | 142 files; no missing, extra or changed files |
| Exact Git blobs | 58 source + 7 tooling = 65; all matched |
| Host and tunnel import closure | complete; no required npm package or path outside the release |
| State layout / database schema | 2 / 3 |
| Installation mode | `StageOnly`; `activated: false` |

The installed candidate passed a separate Host check with a disposable database copy.
It used the packaged Node runtime and Host entry point outside Git.
Fresh provider discovery validated the real native Codex under policy 1.
All 54 tasks and 13 projects were present. Missions and triggers stayed off.
No model session ran. The owned candidate Host stopped after the check.
This is a simulated state test with real installed code and a real native provider.

The staged dashboard used its own packaged middleware and manifest on the test server.
Desktop and mobile rendered with no console errors, page errors or horizontal overflow.
Both screenshots were inspected. Body lengths matched the dev baseline.
Live temperature changed the text prefix, so the automated baseline flag remained true.
The staged Codex detail view also showed direct readiness, Mission restriction and the reason
for the harmless future-version fixture. Its browser warning/error log was empty.

The final T1 audit ran after staging and test-process cleanup.
Host PID 2200 and gateway PID 42156 retained their original identities.
M3 QA PID 11020 remained running. All eight protected hash checks passed.
The database comparison had no mismatches. Production still has 54 tasks and schema 3.
Production state, workspace, startup pin and v10 dashboard remain unchanged.
The candidate has not been activated in production.

Read `test-results/ma2-gate2/package-evidence.json`, `stage.json`, `candidate-host.json`,
`candidate-ui.json`, `browser-candidate.log`, `process-cleanup.json` and `preservation-final.json`.
The final full regression record is `full-tests-final.log` plus `ui-tests.log`: 482/482.
The package binds the source and tooling commits above. The final report update is a later docs-only commit.

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

Production application path: `C:\Users\allam\AppData\Local\Bunny-A\Bunny-A.exe`.
The release remains in `C:\Users\allam\AppData\Local\Bunny-A\releases\Bunny-A-Windows-v17-T3`.
State remains `C:\Users\allam\AppData\Local\Bunny-A\state` and workspace remains
`C:\Users\allam\Bunny-Workspace`. The full pre-update backup is
`C:\Users\allam\AppData\Local\Bunny-A\backups\t3-laptop-update-2026-10-04T03-22-58-813Z-120e6ab3`;
the installer rollback record is
`C:\Users\allam\AppData\Local\Bunny-A\rollback\20261003-232526-6fb5f5c9`.
No rollback or reboot was performed as a T3 test.

The native entry was compiled with the installed Windows .NET Framework64 v4 compiler as an x64
winexe, referencing the OS PowerShell assembly, Forms, Web.Extensions, Xaml, PresentationFramework,
PresentationCore and WindowsBase. It runs the existing WPF script in-process, so PowerShell stdin/
outer-shell lifetime does not decide the native window's lifetime. The tool window deliberately
has no taskbar MainWindowHandle; its own loaded/visible WPF source is the readiness authority.
Earlier shell-only interface attempts and the waiting one-shot outer helper were replaced/closed
without restarting production Host 33068 or gateway 33116. No name-based process termination was used.

The first package from source `9032f3783401e9f8c9a7a1d7dcf8d8d54277a602` and tooling
`274dcb2b04aa8faf22937bd7e4421cf06bf6a332` was superseded and never activated.
The final d2088/1fc193 package above is the accepted/installed release.
Earlier disposable fatal-harness identity enumeration failures are preserved in
`candidate-fatal-superseded-harness-failure.json`; the corrected final query uses a single PID OR
filter. The final proof observes each unrelated process with its original creation identity.
These were harness observation failures, not production Host crashes.

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

| Packaged test | Host PID | Exit | Callbacks | Observed owned members | Recovery |
|---|---:|---:|---|---:|---|
| hard-host-crash | 6492 | 1 | NO | 6, all terminated | interrupted; waiting_for_user |
| merge-hard-host-crash | 17456 | 1 | NO | 5, all terminated | interrupted; waiting_for_user |
| fatal-host-crash | 18272 | 70 | yes | 6, all terminated | stopped; waiting_for_user |

The hard kills use taskkill /PID <test Host> /F without /T. No callback could supply the
descendant termination. The full raw trees/creation times and unchanged file hashes are in
packaged/gates.json; package-evidence.json includes a compact crash-proof inventory.

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

**BUNNY_MA2_T5_PASS.** The proper Windows application was promoted to
`Bunny-A-Windows-v17-T5` after all candidate checks, a verified rollback backup and explicit
user authorization. The measured prior installation was v17-T3, rather than v10. Both
older release directories remain preserved. Host and current dashboard share immutable
source `eb96c053c238ec0bd385187e0f4dad6777a0a4bc`; tooling is
`ec81f9b9dbab4236b735f917a89cf3e8393024f4`.

Read-only Host projection now distinguishes provider turns, Tasks, capability runs,
Mission steps and independent verification. Stable activity IDs group existing records;
sequence/revision checks and canonical reconnect refresh prevent duplicate or stale UI
state. Public projection excludes secret-bearing payloads, transcripts and private
reasoning. Dashboard/phone/native Island show honest interrupted, degraded, restricted
provider, Produced/Verified and unknown-progress states. Task/Mission modes and existing
authenticated approval/Stop commands remain available. TaskManager, MissionManager,
provider authority, T3 failure containment and T4 process ownership are unchanged.

585 tests passed, above the actual T4 floor of 547 with 38 added. Typecheck, lint
(0 errors, 10 existing warnings), normal build and Windows desktop build passed.
The exact packaged runtime passed all 18 live T4 ownership gates and T3 fatal/recovery
containment. Harmless local execution proved an independently verified direct Task,
approved six-step Mission and phone UI Stop. Four candidate and four production
desktop/mobile dark/light views were rendered and visually inspected. Packaged WPF state
renders and the installed EXE readiness verify native Island functionality.

`production-smoke.json` verifies coherent Host/dashboard provenance, all installed files,
source blobs, 10 live JS/CSS hashes, preserved history and T1 hashes. Production retains
54 Tasks, 13 projects and 9 historical devices, Missions/triggers OFF and external state
root/workspace. No paid model call or public tunnel was started. Windows later restarted
independently; fresh live executable/creation-time identities were verified without using
saved PIDs as authority. Personal Codex config changed later and was left as found;
unchanged Mission isolation ignores user config and actual CLI 0.153.4 remains validated.

Rollback has a 67-file verified backup, consistent schema-3 database, old install/startup
configuration, two native EXE shortcuts and retained v10/T3 releases. The prepared script
requires fresh scoped identity checks and never automatically replaces the live database.
Physical remote transport, paid provider turns, production crash testing and executing
production rollback are not claimed. The normal Nitro adapter's missing trusted peer
renders Offline; the installed Windows gateway is online without weakening authentication.

Full required report categories, OD-1 traceability, rollback and immutable hashes:
[MA2_T5_DASHBOARD_PROMOTION.md](MA2_T5_DASHBOARD_PROMOTION.md). Evidence is in
`test-results/ma2-gate5/`. T6–T10 remain open; no full operational verdict is issued.

# M-A-2 Gate T6

**BUNNY_MA2_T6_FAIL.** The installed `Bunny-A-Windows-v17-T5` was tested through a
real Cloudflare quick tunnel using its normal installed launcher, application-owned
cloudflared 2026.9.3 and existing gateway/pairing boundary. Live pairing, authorized state,
local direct Task completion, device-correlated mobile approval, deterministic Git Mission,
isolated remote Stop and canonical reconnect worked. Unexpected tunnel child termination
was contained; the installed supervisor restarted its own child with a new temporary URL
while local Host/gateway/Island retained their original identities and health.

Real public transport subsequently returned repeated HTTP 530 / Cloudflare Error 1033,
including an actual browser reload after restart. This prevents acceptance of remaining
public stale-session/revocation checks and final Mission rendering. Canonical supported
revocation returned Host 401 without restart; immediate enforcement latency was not retained
across harness retries and is not claimed. All three temporary test devices
are revoked. External-Wi-Fi Android availability is user-reported, but physical installation,
pairing and traffic remain unverified. Direct browser storage inspection was unavailable
in the computer-use read-only scope and is documented as NOT TESTED.

The requested signed Android APK was rebuilt from the unchanged existing companion source:
`releases/Bunny-A-Android-v2.apk`, SHA-256
`c2345d32af1b157fdad137bd64a038ac93ea0616b6695b9060cfa3717fb8c168`, API 26+
and target 35. V2/V3 signatures and 21 connection policy checks passed. The app uses existing
HTTPS/pairing, embeds no server address/master credential and adds no remote authority layer.
Signing/desktop rendering are not represented as physical Android runtime acceptance.

Full 585/585 regression, typecheck, lint (0 errors/10 existing warnings), normal build and
exact-pinned T5 Windows desktop rebuild pass. All original 54 Tasks, 3 Missions, 13 projects
and 9 historical device rows remain intact. Final database totals include only the two test
Tasks and three test Missions; temporary project registrations were removed and devices
revoked, retaining truthful history. Git snapshot reliability observations changed only by
the expected test runs; reviewed skill definitions/authority remain unchanged. Production
Missions/triggers are OFF. Database integrity/schema, external state/workspace, protected
T1 hashes, consent, all 156 installed files, Host identity and install configuration pass.

No Host/dashboard/process ownership/authorization runtime source was changed, so T6 did
not manufacture or activate a new Windows release. Public HTML/assets/API projections and
decompressed APK entries were inspected without exposing master credentials. The current
blocker remains the unreliable actual public connector route, rather than an accepted repair.

Detailed categories, endpoint/credential boundaries, test attempts/limits, identities and
evidence: [MA2_T6_REMOTE_ACCEPTANCE.md](MA2_T6_REMOTE_ACCEPTANCE.md). T7–T10 remain open.

# M-A-2 Gate T6R — REMEDIATION (final: BUNNY_MA2_T6_PASS)

Gate T6R repairs only the failures that blocked T6, per the failure ledger
produced from recorded T6 evidence before any repair
([T6_FAILURE_LEDGER.md](T6_FAILURE_LEDGER.md)): F1 BLOCKER (sustained 530/1033
with a live-but-degraded tunnel child), F2 HIGH (stale `settings/remote.json`
after a hard kill) and F5 HIGH (exit-only supervisor blindness). F3/F6/F7/F8
are procedure consequences of F1; F9–F13 require no repair. The gate closed
**PASS**: v17-T6 was installed and activated under §45 user authorization and
the full §22 A–Q sequence plus the §38–§41 security suite passed LIVE against
the installed remediated runtime.

Root cause was refined with a LIVE 15-minute dual-protocol probe on this same
network (`test-results/ma2-gate6r/probe/summary.json`): http2 and quic both
sustained 90/90 public 200s with `cloudflared_tunnel_ha_connections` constant
at 1 and exactly 1 register/0 unregister events each. A single registered
edge connection is this network's normal steady state; the T6 BLOCKER was
edge-registration churn (7 register/6 unregister in ~10 minutes with
`Unauthorized: Tunnel not found` invalidation windows, archived tunnel log)
leaving intermittent 530/1033 while the child stayed alive. Protocols are
statistically equivalent, so production keeps `--protocol http2` (§28 minimum
repair; §16 no named-tunnel migration; §18 no auto-download).

The repair is confined to the installed release's tunnel transport surface
(`scripts/bunny-tunnel-worker.mjs`, `scripts/bunny-tunnel.mjs`,
`scripts/bunny-tunnel-state.mjs`), explicitly permitted by §28, and adds:
(1) a supervised sustained-degradation watchdog — zero active registered
connections ≥ 60 s, ≥ 7 registration events with < 2 active in 15 min (the
recorded T6 signature), or a public `bunny-health` probe failure streak
≥ 6 samples / ≥ 75% over ≥ 8 — restarting only the owned child inside the
existing 3-attempt/10–20 s backoff budget, with an origin-fault outcome that is
never attributed to the child (§19 local independence); (2) startup
reconciliation clearing a dead worker's stale `settings/remote.json` and
refusing a live foreign worker; (3) truthful degradation logging. Host
authority, credentials, auth envelope, dashboard and Android companion source
are unchanged.

Verification (final): 13 tunnel tests (6 existing + 7 new) pass with no hang;
247 script + 311 application = 558 pass/0 fail plus 34/34 UI = **592/592
against the 585 floor**; typecheck, lint (0 errors/10 existing warnings) and
normal build pass. The exact-source candidate is committed, pinned and was
installed/activated under §45 authorization: `Bunny-A-Windows-v17-T6`
(17.0.0-T6) built by `package-bunny-desktop.ps1` from source
`cb005ef75bf86d4d9e722b5214612fe115db5c6b` (the T6R repair commit) with
committed pin `90a6e8da11e77bd1d3d402c166456f0d816fb4c4`; dashboard built,
manifest 156 entries SHA-256
`f5bf648c92711baba3fe4a24ea46c449fd8f226c0afa018f8f9cf93da52fde88`
(all re-verified byte-identical at gate close); verify/closure/source-check
(76 files byte-identical) pass. Activation corrections (install.json
restoration per T5 semantics, deployment.json promotion, shortcut rewrite,
EXE-owned process shape) are recorded in `activation-final.json`.

The installed-runtime gate then ran LIVE: the §22 A–Q sequence (all 17
properties), the §38–§41 security suite (9/9 header cases, CSRF/origin,
forwarded-header spoof, client isolation, token-leak audit, live web-storage
read, phone-layout render), F6 single-clean-sample revocation/stale
measurements and bounded F7 pairing abuse all pass; a real ~90 s transient 530
window was contained with self-recovery and watchdog restraint; the deliberate
identity-checked child kill proved the bounded owned restart (worker pid
unchanged, fresh hostname) with fresh pairing + authenticated read on the new
endpoint. Physical phone rows are honestly NOT TESTED (no user participation;
mobile-browser equivalence live-verified; the production "Phone companion"
device untouched). Final verdict **BUNNY_MA2_T6_PASS** (§50). Full report:
[MA2_T6_REMOTE_ACCEPTANCE.md §M-A-2 Gate T6R — REMEDIATION](MA2_T6_REMOTE_ACCEPTANCE.md).
No authentication was weakened and no test was weakened, skipped or
reclassified (§1). No OCT-1/OD-1 features and no T7 work (§26/§27/§51).
T7–T10 remain open.

# M-A-2 Gate T7 (final: BUNNY_MA2_T7_PASS)

Gate T7 was an acceptance-only gate: **no product code was changed**, no release was
manufactured or activated (the "do NOT manufacture v17-T7" rule is fully honored), and the
regression floor therefore stands unchanged at 592 (§48). The gate exercised the T6R
installed runtime against a real Windows session boundary and recorded LIVE evidence that
the existing implementation's installed startup chain does exactly what it claims.

What T7 verified of the implementation (all LIVE VERIFIED, evidence
`test-results/ma2-gate7/`, report
[MA2_T7_WINDOWS_SIGNIN_ACCEPTANCE.md](MA2_T7_WINDOWS_SIGNIN_ACCEPTANCE.md)):

- **Real sign-out then natural restart**: explicit user authorization recorded
  (`signin-authorization.json`, digest `d037f76a78ce9892`), `logoff.exe` at
  2026-10-06T04:11:32.800Z ended the session (and, as expected, every Bunny process and the
  gate harness shell). After the user's normal sign-back-in (new session id 2, Explorer
  36072 at 04:11:54.312Z), the per-user `Bunny-A.lnk` → install-root bootstrap
  `Bunny-A.exe` (pid 34004) chain started the application completely on its own — Host
  17956 at T0+3.65 s, gateway 5348 at T0+6.31 s, readiness record at T0+9.86 s
  (`startup-performance.json`, Windows actual timestamps per §36). No manual start (§12),
  no repo/dev parentage anywhere (§53), zero repo path references in any process.
- **Startup authority held**: the same shortcut (unchanged SHA-256), the same bootstrap exe
  (unchanged SHA-256), the same `install.json` currentRelease → `deployment.json` package
  pin → release-manifest SHA-256 `f5bf648c…` verification ran post-signin and booted
  release `17.0.0-T6` / source `cb005ef7…` (§57 mismatch condition absent).
- **Duplicate startup refused twice LIVE (§19)**: two deliberate competitor launches of the
  same shortcut target each walked the pinned launcher's refusal chain
  (`host.already-running` → `gateway.already-running` → `island.already-running`) and
  exited within ~160 ms with zero new persistent processes, zero disappeared processes and
  zero log-archive moves; nothing was ever killed by name (§55/§28).
- **State preserved exactly (§21–§23, §56)**: canonical `bunny-state/2` state, no empty
  database; order-independent normalized preservation sweep of all user tables vs the
  pre-signin `VACUUM INTO` backup found 0 problems; events sequences continuous
  (2303 → present) with only fresh-probe telemetry deltas on the 6 provider rows; missions
  OFF and triggers OFF preserved, never enabled by startup.
- **Providers recovered freshly (§24/§25)**: the restarted Host re-probed all six providers
  at 04:12:22Z on its own; fresh direct tasks with fresh post-restart approvals completed
  for codex (real file write + Bunny independent on-disk verify `Exact match`) and ollama
  (exact `T7_LOCAL_OK` marker). One honest failure-ledger entry: the first ollama probe
  sent a verify spec that adds a filesystem hard constraint a text-only model executor
  cannot satisfy; the Host **refused rather than falling back to a wrong executor**
  (correct hard-constraint enforcement) and the corrected retry completed — the probe
  defect is retained in evidence (`provider-recovery-ollama-retry.json`); the same file
  records the §26 external claude CLI upgrade (`2.1.290 → 2.1.291`) as a reported external
  change, never overwritten.
- **Security preservation (§31–§35, §38–§40, §58)**: unpaired public `/state` still 404,
  token-leak scan clean, hostname changed (expected; stale hostname withdrawn from the
  edge — 530) after the user-initiated pinned-launcher remote start, cloudflared binary
  byte-identical, production "Phone companion" untouched and active, T6R test devices still
  revoked with unchanged DB timestamps, missions/triggers never enabled at startup, no
  Windows Service/SYSTEM/scheduled-task elevation, children hidden. One residual mechanism
  question is recorded honestly in the gate report: bootstrap-invoked launcher runs
  (03:14Z, 04:12Z, both 04:23Z race competitors) log no `remote.*` line even with a live
  worker, while direct pinned-launcher runs do (03:04Z, 04:17Z); the sign-in startup leaves
  the remote path OFF either way and a live worker is never duplicated — the mechanism
  (likely a `-NoRemote` flag from the bootstrap; partial binary string dumps) stays
  unresolved and is tracked in the T7 failure ledger, not silently explained away.
- **Error surface clean (§37)**: all runtime logs scanned post-signin; the single finding
  is the labeled harness-probe refusal above; host/gateway/tunnel error logs are empty and
  there is no unresolved BLOCKER/HIGH.

Final verdict **BUNNY_MA2_T7_PASS** (§61); the full M-A-2 operational verdict is still NOT
claimed (§62) and **NEXT = T8 pinned rollback, not begun** (§63).

# Gate T8 — pinned rollback / real recovery (2026-10-06, BUNNY_MA2_T8_PASS)

T8 was acceptance-only again: **no product code, release, or test-suite file changed** (the
regression floor therefore stands unchanged at 592, §52 — no full-suite re-run was required
and none was needed), no release was manufactured ("do NOT manufacture v17-T8" honored), and
the gate exercised the existing installed rollback/recovery machinery for real in both
directions (report:
[MA2_T8_ROLLBACK_RECOVERY_ACCEPTANCE.md](MA2_T8_ROLLBACK_RECOVERY_ACCEPTANCE.md), evidence
`test-results/ma2-gate8/`).

What T8 verified of the implementation (all LIVE VERIFIED; full-run authorization by the
workspace owner recorded before §22):

- **Real rollback to the pinned prior release (§22–§33)**: the nearest previously accepted
  ACTIVATED release was T5 (its T5-pin bundle — the `install.json`/`deployment.json`/Startup
  shortcut bytes the installer saved at T6R activation — carried the entire switch). The
  controller validated both targets against live config + the accepted-release ledger
  (manifest SHA + identity + outside-git ancestor walk + reparse-point check), idle-checked
  the live instance, spawned a protected sentinel that survived every stop/switch/boot of
  the whole gate, owned-stopped the production chain child-first (gateway → host →
  bootstrap, fresh CIM identities, never by name), and committed the T5 switch atomically
  (shortcut → deployment.json → install.json LAST). T5 booted with its accepted identity
  proven in the gateway release block, the same canonical state (devices 15/14 revoked/1
  active, tasks 59, token accepted, no re-onboarding), one launcher restart while rolled
  back, a passed local §34 smoke task (`T8_T5_LOCAL_OK` on ollama, fresh approval), and the
  remote truth recorded (no tunnel while unattended — consent-first chain).
- **Protected state PRESERVED in both directions (§9/§10/§11/§39/§40)**: B0→B1 and B0→B2
  diffs over the 23-table protected-row ledger are verdict **PRESERVED** (only T8's own
  acceptance records appended — 1 task + 1 outcome + 20 events, enumerated per row; 0
  unexpected/modified/missing). NO database rollback was performed in either direction; the
  §49 emergency DB restore was never invoked.
- **§48 emergency machinery exercised for real**: a mid-gate crash trail left the config on
  T5 with the chain stopped; the emergency restoration (immutable recovery bundle →
  `install.json` LAST → boot v17-T6 → health) was live-executed and byte-verified
  (`rollback/boot-t6-pre70.json`) before the authorized forward run resumed.
- **Real forward recovery (§36–§38)**: T6 integrity was re-proven on the installed folder
  (156 files, 0 missing/changed/extra — not assumed unchanged), the T5 chain was
  owned-stopped again, and the T6 switch completed with **byte parity** — final config
  bytes identical to the pre-rollback production bytes. T6 re-booted with the full accepted
  identity (release/source/manifest + dashboard asset manifest) verified on the live
  endpoints.
- **Remote surface reconciled (§45/§47)**: the release's own consented launcher invocation
  produced `remote.started` for a fresh worker (executable inside the T6 release folder)
  with NO duplicate host/gateway/island spawned, a fresh public hostname serving 200 on
  `/bunny-health`, unpaired denial 403, and a recorded hostname trail
  (preRollback → null-while-rolled-back → postRecovery). Windows sign-in was NOT left
  pinned to the rollback target — the Startup shortcut finished on the exact pre-rollback
  T6 bytes (§46).
- **T7 residual L-T7-2 resolved**: T8's every bootstrap-chain boot (T5 and T6) emitted no
  remote event while both direct launcher invocations produced `remote.started` — the
  bootstrap chain runs the launcher remote-disabled (`-NoRemote`); unattended boots publish
  no public URL by installed design; consent-first behavior preserved, nothing weakened,
  no product change needed.
- **Security refusal suite live (§54–§58, §15/§51)**: target validations refused
  not-in-config / SHA-mismatch / missing-folder / inside-git targets; saved-pid authority
  refused dead/reused/role-mismatched/entry-mismatched identities; the installed launcher
  itself refused tampered content and manifests; and the installed
  `install-bunny-release.ps1 -Rollback` fail-safe refused at its guard when executed
  verbatim against disposable roots (restoredNothing). Zero git
  checkout/switch/reset/restore anywhere; zero by-name kills; zero privilege expansion.

Final verdict **BUNNY_MA2_T8_PASS** (§66); BUNNY_MA2_OPERATIONAL_PASS still NOT claimed
(§67); **NEXT = T9 (desktop approval policy), not begun** (§68).

# M-A-2 Gate T9 — current staged acceptance

**BUNNY_MA2_T9_PASS (2026-10-06).** Full report:
[MA2_T9_APPROVAL_BATCHING_ACCEPTANCE.md](MA2_T9_APPROVAL_BATCHING_ACCEPTANCE.md).
Evidence: `test-results/ma2-gate9/evidence/index.json`. Production remains the accepted
**Bunny-A-Windows-v17-T6**; T9 is installed only in the disposable staged root. T10 remains
open and was not started. No full M-A-2 operational verdict is issued.

| T9 check | Result | Classification / evidence |
|---|---|---|
| Explicit Calculator workflow | Result 5; seven mutations + one free result read; prompts 7 → 1 | LIVE VERIFIED, v20-A/B-live.json |
| App/risk/sensitive boundary | Other application, destructive filesystem probe and typing ask; no broader mutation | LIVE VERIFIED, v20-C/D/S-live.json |
| Exact operations and pre-admission identity | Concrete step/digest, envelope and Microsoft Calculator package/window/process lifetime; no title-only authority | IMPLEMENTED + SIMULATED, 26 focused tests |
| Bounds | Two-slot test stops at two; one-second TTL expires on Host time | LIVE VERIFIED, v20-E/F-live.json |
| Task/Mission isolation | Concurrent unrelated mission does not inherit authority | LIVE VERIFIED, v20-H-live.json |
| Stop and restart | Running owned invocation aborted, no future admissions, unrelated mission survives; restart clears grant, no GUI replay; old approval refuses | LIVE VERIFIED, v20-G/G2/R-live.json |
| UI and companion | Allow once primary; exact bounds; canonical 2/6 after reload; UI Stop ends grant | LIVE VERIFIED, v20-ui-live.json and screenshots |
| Paired-device authority | Same envelope/limits; clamping, actor, explicit revoke and revoked-token refusal | LIVE VERIFIED over loopback, v20-J-live.json; physical phone/tunnel NOT TESTED |
| Privacy | Renderer/detail inputs redacted; journal/run/request/batch scans clear; private Host execution input preserved | LIVE VERIFIED + SIMULATED, v20-privacy.json |
| Regression | 624 = 247 script + 340 app + 37 UI pass, no skipped/deleted tests; typecheck/build/lint pass (11 existing lint warnings) | STATIC VERIFIED, t9-v20-full-sequential.log and related logs |
| Production preservation | 156/156 installed files; protected config/credential hashes identical; no T9 schema or desktop-approval writes; state/workspace outside Git unchanged | LIVE VERIFIED read-only, final-production.json |

Final candidate **Bunny-A-Windows-v20-T9**, source
`445beebf8c9d951066dd0bddb1b066820762a912`, tooling
`824a5531ff6c04936f9511ba63c1120e65695d42`. ZIP SHA-256
`3fdbad67b21ed9bccbabad514756f0d0cb9ca8363c00f38bb61850c29b922a44`;
manifest `92c60012cca09d95f1c85b7a2373caf52297fc7cc3a50c30a3d49b979e44148a`;
dashboard assets `93183a204a27a0ecec1f4f34444231039d9c1512efc7390f02271ca31ce95171`.
Exact committed archive and installed-copy verification are in v20-candidate-package.json.
All earlier candidates remain immutable.

Prompt reduction is 85.7%; observed automated elapsed time was 8,143 ms for Allow once
versus 15,836 ms for batching. Package/window checks add overhead; no speed gain is claimed.
Two default concurrent test runs hit an existing T4 temporary cleanup EPERM after ownership
assertions passed. Its unchanged isolated test and the unchanged complete sequential inventory
pass. No assertion was weakened. This low harness limitation is retained in the failure ledger.
No unresolved BLOCKER/HIGH. Activation, physical phone, real dialogs/vision/provider reroute
and broader desktop profiles are not claimed; activation requires separate authorization/backup.


# M-A-2 Gate T9R — duplicate Calculator closure

**BUNNY_MA2_T9R_PASS (2026-10-06), classification MIXED.** The original 68 launch calls came from 60 independent Missions and eight direct probes; final historical harness cleanup was omitted. A separate pre-change live reproduction proved two acquisitions under one v20 workflow/grant could create two visible windows. The current Runtime validates and reuses a per-workflow native Calculator target, serializes acquisition and refuses blind spawning after an uncertain launch. Persisted identity carries no permission or cleanup authority.

Live repeated acquisition, postcondition retry, concurrency, fresh second-Task approval, result **402**, stale replacement, focus pause/recovery, Stop, expiry/budget, restart/replan, dashboard reload and pre-existing-window preservation pass. Final inventory is one intentionally retained manually prepared external fixture and zero unexplained windows. Independent Tasks may intentionally share the verified physical application only after separate authorization.

**645 tests pass (251 script + 357 app + 37 UI), focused 47; typecheck/lint/build/Windows package checks pass.** All existing T1–T9 tests remain; eleven existing lint warnings. Candidate **Bunny-A-Windows-v21-T9**, source `b6caa93d0b4d80417c8adb690ce3e85a140909c4`, tooling `97f48e137610e36649624cf63f178dda04db394f`, manifest `f168a7b4f4ca62f546b7aa3410264953dd1776144cbfceb6fd96e257e75e4fcb`; 159/159 installed files and exact archive/import closure verified. Production remains healthy **v17-T6**, 156/156 integrity, protected files/Startup unchanged, no T9 schema or desktop approval writes. No activation or T10 work.

Full scope, limits, ownership rules and evidence: [T9R closure](MA2_T9R_DUPLICATE_CALCULATOR_CLOSURE.md), `test-results/ma2-gate9r/final-verdict.json`, `candidate-package.json` and `evidence/index.json`. Historical exact 10–12 HWND lineage is unavailable and is not invented. This is the implementer's review packet; no new independent-review verdict is claimed.
