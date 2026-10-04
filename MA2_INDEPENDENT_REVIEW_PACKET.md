# Bunny-A M-A-2 independent review packet

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
