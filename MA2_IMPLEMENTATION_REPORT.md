# Bunny-A M-A-2 implementation report

## Scope

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

Pending full gates and the isolated installed Host test.

## SIMULATED

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
