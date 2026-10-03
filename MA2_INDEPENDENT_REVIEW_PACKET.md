# Bunny-A M-A-2 independent review packet

## Review scope

Review the T1 checkpoint first.
Do not issue final M-A-2 approval from T1 evidence.
The implementation owner cannot provide independent final approval.

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
