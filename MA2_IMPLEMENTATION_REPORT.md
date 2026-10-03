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
