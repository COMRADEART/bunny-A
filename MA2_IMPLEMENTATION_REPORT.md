# Bunny-A M-A-2 implementation report

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
