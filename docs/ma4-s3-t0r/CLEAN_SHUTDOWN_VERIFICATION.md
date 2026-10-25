# Clean shutdown verification

Command (no `--test-force-exit`):

```text
node --experimental-strip-types --test --test-concurrency=1 src/lib/bunny-host/ma4-s3-t0r.test.ts
```

`T0R shutdown clears the runtime deadline and refuses another task` passed. After `missions.close()` the runtime timer map was empty, `shutdownState` was `complete`, the session map was empty, `submit` threw, and the task row was still `running`.

`T0R a short runtime deadline still stops the live task` passed in 93ms. A 30ms `maxRuntimeMs` moved the task to `stopped` with reason `Runtime limit`.

Eight agent suites, also without `--test-force-exit`:

```text
agent-runtime agent-recovery agent-store agent-team agent-team-lifecycle
agent-team-matrix agent-team-handoff agent-team-surfaces
```

First combined run exited on its own in 363s: 62 passed, 5 failed, all five in `agent-recovery.test.ts`. Those failures were this change calling `TaskManager.stop()` during close, which wrote `stopped` and hid the restart walk (`A19` expected `failed` and `Host process restarted`).

After close was changed to detach without writing `stopped`, `agent-recovery.test.ts` was run again: 11 passed, 0 failed, process exit 0, 21s. The other seven files had already passed in the combined run. They were not re-run as one process after the detach fix. `npm test` still contains `--test-force-exit` for the full script. It was not removed, because the full script was not re-run.
