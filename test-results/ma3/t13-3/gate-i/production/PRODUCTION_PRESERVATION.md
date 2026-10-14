# T13.3 production preservation

Both receipts come from `production-observe.mjs`, which opens the production database read-only and writes nothing to production.

- Before: `production-before.json`, 2026-10-14T16:22:40Z, before any Gate I work.
- After: `production-after.json`, 2026-10-14T18:19:26Z, after the regression, the package build and both end-to-end runs.

## Unchanged

| Item | Before | After |
|---|---|---|
| Installed release | `Bunny-A-Windows-MA3-T13-FINAL-TEST` | same |
| Release folder manifest | 478 files, sha256 `3478588b…3ea19` | identical |
| `install.json` sha256 | — | identical |
| Listeners | 127.0.0.1:8084 (PID 19896), 127.0.0.1:43119 (PID 13924) | identical PIDs, so no restart |
| Process start times | 19896 and 13924 | unchanged (same processes) |
| Database tables | 45 | 45 (no table added or dropped) |
| Startup shortcut | present | present |
| Microphone privacy (user, user non-packaged, machine) | Allow / Allow / Allow | same |

## Changed, and why

- **Four tables changed: `events` (18,556 → 18,565), `providers`, `model_capabilities` and `sqlite_sequence`.** Only the types and times of the nine new events were read. All nine are the running production Host's own periodic provider refresh, between 16:36 and 18:13: `provider.usage_changed` ×5, `provider.usage_unavailable`, `provider.usage_refreshed` and `provider.status_changed` ×2. The `providers` and `model_capabilities` rows are rewritten by that same refresh, and `sqlite_sequence` follows the event ids. No Gate I process connected to port 43119 or 8084. The end-to-end script refuses those ports, and every disposable Host used its own `%TEMP%` data directory.
- **The audio endpoint list hash changed.** This is a hash of Windows' audio device list (instance, status, name), and it changes when a device connects or disconnects. Gate I opened no audio device, and no voice worker ran against production. The microphone privacy values are unchanged.

## Not done

Nothing was installed, updated or restarted. Nothing was pushed, deployed or published. There was no sign-in and no paid inference.
