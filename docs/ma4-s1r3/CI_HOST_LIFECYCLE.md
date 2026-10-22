# MA4-S1R3-CI2 — Host lifecycle in the Host HTTP tests

## Owner

Seven stage 2 files exercise the Host over real HTTP through the same copied harness:
`character-appearance-host`, `lotus-host`, `personal-agent-context-host`, `personal-agents-host`, `ui-theme-host`,
`widgets-host` and `workers-host` (`src/lib/bunny-host/*.test.ts`).

* `boot(directory, port)` calls `startHost()`, enables Missions with `mission.configure`, and returns the Host.
* `withHost(port, work)` owns the Host that `boot()` returns. It closes the current Host in `finally` and removes the
  disposable state directory. Its `reboot()` closes the current Host and boots a new one on the **same directory and
  port**, which is how the tests prove that state persists across a restart.

Each Host runs **inside the test-file process**. It has no child Host process. Its resources are a listening socket on
the test's port, accepted sockets, the SQLite state files in the disposable directory, and any Mission or worker children
it starts. `host.close()` releases them all (`http.server.ts`: owned children, sessions, Agents, Missions, then the HTTP
server, then the database).

## Defect 1 — a Host was leaked when `boot()` failed

`startHost()` succeeded, but if `mission.configure` then failed, `boot()` threw before returning the Host. `withHost`
never received it, so nobody closed it:

* its listener kept the test-file process alive, and `node --test` waits for every file process to exit: **the hang**;
* its open state files made `rmSync` fail with `EPERM` in `withHost`'s `finally`, and that error **replaced the real
  one**.

**Fix:** `boot()` owns the Host until it returns it. If setup fails, it closes the Host and rethrows the original error:

```ts
try {
  const enabled = await command("mission.configure", { enabled: true });
  assert.equal(enabled.status, 200, JSON.stringify(enabled.body));
} catch (error) {
  await host.close();
  throw error;
}
```

On success and on failure, every Host is now closed exactly once by the code that owns it. Hosted evidence: with only
this fix, the failing test reports its real error (`fetch failed`) and the process exits with 0 orphans (run
39701335596).

## Defect 2 — a pooled socket crossed a Host restart

All requests used global `fetch`, which pools keep-alive sockets per origin. After `reboot()` the origin is the same
(`127.0.0.1:<port>`), so the restarted Host's first request could use a socket the first Host had accepted. On hosted
Windows that socket was still open, because the first Host's socket close is deferred, and it was reset when the close
landed (CI_STAGE2_DIAGNOSIS.md, run 39702421167).

**Fix:** every harness request sends `connection: close`, so each request uses a fresh connection and closes it after
the response. No request can reach a Host other than the one listening when it was sent. Nothing about the Host, the
restart, the port, or what the tests assert changed.

Rejected alternatives:

* a sleep or a retry after the restart, which would hide the race and leave it timing-dependent;
* a different port for the restarted Host, which weakens the same-port restart the tests mean to prove;
* a per-Host `undici` dispatcher, which needs the `undici` package (not a dependency).

## Watchdog cleanup (CI)

`scripts/ci/watchdog.mjs` runs each `npm test` stage in CI and in the diagnostic workflow:

1. It records every process before the stage starts.
2. If the stage overruns its budget, it records the process tree under the stage and the TCP listeners owned by that
   tree. It runs `taskkill /T` (graceful), waits 15 s, runs `taskkill /T /F` for anything left, and checks the tree again.
3. Whatever the outcome, it reports every process the run started that is still alive and either descends from the stage
   or lost its parent. It stops those processes and checks again. Transient `conhost.exe`/`WerFault.exe` are ignored.
4. It writes `<stage>.watchdog.json`, fails with `::error title=WATCHDOG TIMEOUT::<stage> exceeded <n>s; still running:
   <test files>` and exits 124. An uploaded artifact keeps the logs even when the job is cancelled.

Self-tests (`scripts/ci-watchdog.test.mjs`, part of stage 1): a hung parent with a hung child becomes a named timeout
and nothing in the tree survives; a command that exits keeps its exit code; malformed arguments are refused.

`--test-force-exit` was **not** added to stage 2. It would have exited past the leaked Host and hidden defect 1.
