# Bunny-A M-A-2 state migration

## Scope

Gate T1 moves active production state outside Git.
The old repository path will retain a retirement marker only.
The complete old directory will remain in an external backup.

## Controlled procedure

1. Check the installed Host process, credential and instance ID.
2. Refuse migration if a task or Mission has active work.
3. Check the candidate manifest against its expected SHA-256.
4. Make a read-only SQLite `VACUUM INTO` backup.
5. Check the backup with `PRAGMA integrity_check`.
6. Record the schema, table counts and row fingerprints.
7. Stop only the recorded Bunny processes.
8. Check each PID, executable, command line and creation time before Stop.
9. Copy the complete state into an external backup.
10. Make the final database snapshot with the writer stopped.
11. Copy state into a separate stage directory.
12. Check every copied file hash.
13. Change project paths that point below the old state root.
14. Check every database row against the final snapshot.
15. Remove only the recorded legacy junction.
16. Move the stage into the canonical state root.
17. Replace `install.json` with an atomic file operation.
18. Change the Startup shortcut to the pinned candidate.
19. Start Host and gateway from installed files.
20. Check the live database and Mission flags.
21. Move the old directory into the external recovery records.
22. Write the retirement marker at the old repository path.

The controller uses a migration lock. Duplicate installed startup refuses this lock.
A failed cutover restores a separate legacy data copy outside Git.
The recovery Host uses the pinned prior release. It does not require a branch change.

## Preservation rules

All user tables and the SQLite sequence table are checked.
No old task, outcome, event, device, setting, Mission, skill or capability row may disappear.
All fields must stay equal except the listed project path changes.
The project IDs and all other project fields stay equal.

At restart, provider discovery can change provider records.
The live comparison records the changed provider field names.
Provider IDs and the stored executable settings must stay equal.
New events can be added. Old events must stay equal.
The event sequence counter can advance.

Old log files move into `state\logs\archive` before new logs start.
The local Host token stays equal. Device token hashes stay equal.
The stale tunnel PID record remains in the backup. It is not copied into active runtime state.

## Tests

The test suite covers committed WAL data, all tables, hard links and empty directories.
It rejects active work, unknown schemas, occupied stages and directory links.
It checks a complete Windows cutover and three injected failures.
It runs `git clean -fdx` only in a disposable checkout.

Named-tunnel credentials need an explicit inventory.
The current installation uses a quick tunnel. T1 does not start a new public tunnel.

## Live evidence

Live migration is pending the full regression gates and the installed candidate test.
The final result will be recorded in `MA2_IMPLEMENTATION_REPORT.md`.
