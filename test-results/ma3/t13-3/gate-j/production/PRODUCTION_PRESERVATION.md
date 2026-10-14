# T13.3 Gate J production preservation

Both receipts come from `production-observe.mjs`. It is a copy of the Gate I script, which opens the production database read-only and writes nothing to production.

- Before: `production-before.json`, 2026-10-14T18:50:34Z, before any Gate J regression, package or end-to-end run.
- After: `production-after.json`, 2026-10-14T20:45:44Z, after both regressions, the package build, both end-to-end runs and the native Notch run.

## Unchanged

| Item | Before and after |
|---|---|
| Installed release | `Bunny-A-Windows-MA3-T13-FINAL-TEST` |
| Release folder manifest | 478 files, sha256 `3478588b…3ea19`, identical |
| `install.json` sha256 | identical |
| Listeners | 127.0.0.1:8084 (PID 19896), 127.0.0.1:43119 (PID 13924), the same PIDs and start times, so no restart |
| Database tables | 45 |
| Startup shortcut | present |
| Microphone privacy (user, user non-packaged, machine) | Allow / Allow / Allow |
| Audio endpoint list hash | identical |

## Changed, and why

Four tables changed: `events` (18,572 → 18,585), `providers`, `model_capabilities` and `sqlite_sequence`.

Only the types and times of the 13 newest events were read, read-only (`new-event-types.json`). All 13 are `provider.usage_changed`, between 18:58 and 20:39. They are the running production Host's own periodic provider refresh, which also rewrites the `providers` and `model_capabilities` rows.

No Gate J process connected to port 43119 or 8084:

- the end-to-end runs used 43894 and 43895;
- the Notch fixture Hosts used 43920–43959;
- the regressions used each test's own ports and `%TEMP%` data directories.

## Not done

Nothing was installed, updated, restarted, pushed, deployed or published. There was no sign-in and no paid inference.
