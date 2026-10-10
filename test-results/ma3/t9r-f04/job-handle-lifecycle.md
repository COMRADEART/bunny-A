# Job handle ownership and lifetime (T9R-F04)

## Owner

The native helper is a **Node-API module loaded inside the Host process** (`native/bunny-owned-process.node`). It is not a separate, long-lived helper process. Each provider session owns exactly one unnamed job.
- The Host process holds the only handle to that job. The handle has reduced access (`ASSIGN | QUERY | TERMINATE`) and is not inheritable.
- The handle lives in a C `Group` that is reachable only through an opaque Node external. No export accepts a PID, an integer handle or a job name.
- A child is given only its stdio handles (`HANDLE_LIST`). It never receives the job handle, its own root handle or the stdin writer end.

## Lifetime cases

| Event | What closes the job | Evidence |
|---|---|---|
| Root exits normally | The session calls `terminate` (`TerminateJobObject`), polls `ActiveProcesses` to 0, then `close`. Descendants left behind are terminated with the job. | J11–J15 test; `terminatedAtEnd` in the records |
| Stop (user, Mission, runtime limit, thermal) | `stopContained` → `session.stop()` → the same `terminate`. The result reported is kernel accounting. | J29 test, live Stop scenario |
| Unconfirmed termination (accounting stays above 0 after 30 s) | The handle stays **open** and termination is retried every 5 s. The session counts as live code (`lingering`) until accounting reaches 0. | `containedSession` `terminateJob`; `watchContainedJob` |
| Graceful Host shutdown | `stopOwnedChildren` → `trackOwnedGroup` stop → session stop; `http.close` → `manager.stop` → `stopContained`. The N-API env-cleanup hook closes any remaining groups. | existing T4 shutdown path; J34 |
| Host crash, `process.exit`, `TerminateProcess` of the Host | The kernel closes every Host handle. The job loses its last handle, and `KILL_ON_JOB_CLOSE` ends every member. No JavaScript, finalizer or cleanup hook is involved. | J35 test (`taskkill /F` of a Host process); live abrupt scenario (about 0.9 s) |
| "Native helper crash" | The helper runs in-process, so a crash in it is a Host crash (row above). No helper can outlive the Host with an open handle. | architecture; J36 |
| IPC disconnect | There is no IPC between the Host and the helper, so this does not apply. | architecture |
| Restart | The handle died with the old process and is never reopened. Records are marked interrupted and corroborated by identity. | J37 test, live recovery |

## Finalizers

Correctness never depends on JavaScript finalizers. Sessions close their jobs explicitly. The Node external finalizer and the env-cleanup hook are backstops only. On an abnormal exit the kernel is the authority.

## Residual (disclosed)

A process holding another handle to the same job would keep the job alive after Host death. Bunny creates no such handle, and children inherit none. The only way to get one is to duplicate it out of the Host process. That requires code with `PROCESS_DUP_HANDLE` rights on the Host, which means deliberately hostile same-user or elevated code attacking the Host. That case is outside the containment contract (native README). Authorization (T5, F01–F03) remains the boundary against it.
