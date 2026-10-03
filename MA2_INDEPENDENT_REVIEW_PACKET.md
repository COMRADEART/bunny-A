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
