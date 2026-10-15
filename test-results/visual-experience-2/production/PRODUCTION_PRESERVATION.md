# Production preservation (Visual Experience 2.0)

Installed production is `Bunny-A-Windows-MA3-T13-FINAL-TEST` (dashboard 127.0.0.1:8084, Host 127.0.0.1:43119,
`%LOCALAPPDATA%\Bunny-A`). It was **observed only**, with `production-observe.mjs`, which is copied unchanged from T13.3
and opens the database read-only.

- `production-before.json`: 2026-10-15T14:49:32Z.
- `production-after.json`: 2026-10-15T20:19:42Z.

## Unchanged

- Current release `Bunny-A-Windows-MA3-T13-FINAL-TEST`; the `install.json` hash and the release manifest are identical.
- Every database table has the same row counts and content hashes, except production's own activity:
  - `events`: 18,673 → 18,775. The Host's own journal kept running.
  - `providers`, `model_capabilities` and `sqlite_sequence`: hashes changed by the Host's background provider and capability refresh.
- No milestone tool addressed 8084 or 43119:
  - Every harness, test and end-to-end run refuses those ports.
  - The fixtures used 43850–43899, 8081, 8095 and 8096 with temporary state.
- Nothing was installed, published, pushed or deployed. No account was signed in and no paid inference ran.

## Changed, and why

**Process IDs** changed: dashboard 19896 → 24248, Host 13924 → 26300.

- **Cause:** Windows restarted the PC.
- **Event log:** System event 1074 at 2026-10-15 13:30:19 EDT reads: "The process C:\WINDOWS\servicing\TrustedInstaller.exe … has initiated the restart … Reason: Operating System: Upgrade (Planned)". Last boot was 13:30:47 EDT.
- **Restart:** the production processes started again at 15:23:42 and 15:23:49 EDT, through production's own startup path (`startupShortcutExists: true`).
- **Not this work:** the reboot also ended the milestone's working session, which resumed only at 15:35 EDT. Production's restart was not caused by this work.

**The audio-endpoint hash changed** across the same reboot, as Windows re-enumerated its devices. Audio settings were never touched.
