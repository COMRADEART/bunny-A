# MA4-S2-T1-CI1 — HTTP lifecycle analysis

## Host listener lifecycle (as traced)

`startHost()` (`src/lib/bunny-host/http.server.ts`):

1. It opens state (`HostDatabase`, containment marker), builds the managers and the persistent task runtime
   (`exclusive: true`).
2. It runs `server.listen(port, "127.0.0.1")` and awaits `listening`. A port in use rejects with `EADDRINUSE`.
3. It writes the credential file, then calls `ptasks.start()`. Persistent tasks start **only after this Host holds its
   port**, so a lease left by any other instance belongs to a dead Host.
4. It runs `manager.discover()` and one telemetry `poll()`, starts the supervised loops, prints `Bunny-A Host ready…`
   and resolves.

`close()`, which is idempotent and returns one shared promise: loops stop, Missions deactivate, voice closes,
`ptasks.close()` hands running steps to recovery with their durable state, sessions stop, agents and Missions close,
owned children are cleaned up and stops settle. Then `server.closeAllConnections()` and `server.close(cb)`, then
`db.close()`.

Measured with the socket trace (hosted and local, the same order every time):

| Event | Hosted (run 40014200323) | Local |
|---|---|---|
| `closeAllConnections()` destroys each server socket | before `listener-close-called`; `connections: 0`, all `destroyed: true` | same |
| Listener closed | +1 ms | +1 ms |
| Restarted Host's `listen()` | +70 ms (synchronous startup work blocks the loop) | +30 ms |
| Client processes the old sockets' FINs | 14 ms after the restarted `listen()`, **some only after the first new request** | 7–10 ms after `listen()` |
| Test's first request after `startHost()` resolves | **14–15 ms** after `listen()` | **615–637 ms** after `listen()` |
| Old server sockets' `close` callbacks | up to +100 ms | +10 ms |

The Host's own lifecycle is correct and deterministic. The only defect was the test client keeping keep-alive
sockets across two Host instances in one process (HOST_CONNECTION_ROOT_CAUSE.md).

## Lifecycle and concurrency matrix (brief §5)

| # | Case | How it was exercised | Result |
|---|---|---|---|
| 1 | Fresh Host startup and first request | Every Host test. Trace: the first request after `listen()` is accepted and served (200) | PASS |
| 2 | Repeated requests to the same Host | T1-11/12 + CI1-F4. Hosted after the fix: 37 client requests per process, 37 new connections, **0 errors**, 10/10 processes | PASS |
| 3 | Host close and restart | T1-11/12 (paused task survives, resumes, nothing re-runs) and CI1-F4 (completed task, no re-run) | PASS (hosted 10/10 + 3/3, local) |
| 4 | Rebinding the same port | Both tests restart on the same port. No `EADDRINUSE`; listener sequence 1→2→3 in every trace | PASS |
| 5 | Multiple Host instances when prohibited | Scratch test (`evidence/lifecycle-second-host.*`). A second `startHost()` on the **same data directory and port** while the first runs a task is refused with `EADDRINUSE`. The running task is unchanged (state RUNNING, version 5, before and after), it completes, and each step ran once | PASS for refusal and task safety. **Finding F-CI1-1** below |
| 6 | Abrupt client disconnect | CI1-F4. The raw socket is destroyed right after a complete request: exactly one task is created and run once. Destroyed mid-body: nothing is created | PASS |
| 7 | Cancellation while requests are outstanding | CI1-F4 (client drops a request the Host is still processing) and existing T1-3 (cancel an active task: the step stops, its child is terminated, nothing further runs) | PASS |
| 8 | Cleanup after an assertion failure | Hosted **before** the fix: all 10 failing runs and 3 failing `test:ma4` runs exited with code 1 (trace `process-exit {"code":1}`), watchdog `result: EXITED`, **0 orphans**, no timeout. The test's `finally` closes the Host, and `close()` is idempotent | PASS |
| 9 | Paired-phone authorization requests | T1-11/12: `ptask.create/approve/reconcile/revoke/policy/output` from the phone → 400 `WORKSTATION_REQUIRED` each. CI1-F4: a phone's create whose connection drops is still refused, and nothing is created | PASS |
| 10 | Workstation creates, phone supervises | T1-11/12: workstation creates; the phone pauses; the Host restarts; the task is still PAUSED; the phone resumes within the envelope; it completes; the paused step is not re-run | PASS |

## Finding F-CI1-1 (disclosed, not fixed): a Host whose `listen()` fails keeps its state files open

When `startHost()` rejects at `listen()` (`EADDRINUSE`), the objects it opened before `listen()` (at least the
`HostDatabase` files) are not closed. The test process does **not** hang: no listener, timer or child stays alive, and
the scratch test exits 0. But removing that Host's data directory afterwards fails with `EPERM`. This is the
same class of leak as the MA4-S1R3-CI2 `boot()` leak, but on the product side of `startHost()`.

* **Not the cause of this CI failure**, and not introduced by S2-T1.
* **Production impact: none known.** `runHostEntry()` hands a startup failure to `containment.fatal()`. The installed
  policy drains and exits the process, so the OS releases every handle. A second Host also cannot touch persistent
  tasks, because their runtime starts only after `listen()`.
* **Not verified:** whether the pre-`listen()` MA3 Mission recovery of a refused second Host can change a running
  Host's Mission rows when both share one data directory. That path predates S2-T1 and is outside this milestone.
* Recommended follow-up (separate change): close what `startHost()` opened when `listen()` fails, with a regression
  test that removes the data directory after a refused start.
