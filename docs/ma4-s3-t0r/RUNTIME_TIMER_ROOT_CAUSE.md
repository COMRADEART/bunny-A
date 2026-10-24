# Runtime timer root cause

`TaskManager.launch` arms a deadline with `setTimeout(..., maxRuntimeMs)` around the lines that were 1953 and 2030 on `dca8d06`. S3 had added `.unref()` so the timer would not by itself hold the event loop. The timer was still a local. `dispose()` set `disposed` and closed connections. `MissionManager.close()` did not talk to the task manager. A live delegated session could keep the deadline, the session promise, and a child process after the test had finished.

`.unref()` was left in place. It is not the ownership mechanism.

Ownership is now `runtimeTimers` on `TaskManager`:

1. `shutdownState` moves `open` → `closing` → `complete`.
2. `submit` throws once the manager is closing.
3. Relaunch returns without starting another session.
4. Deadline timers and tree timers are cleared.
5. Each live session's `stop()` is awaited, bounded by 5 seconds, so the adapter promise can settle and a child can be killed.
6. The task row is not rewritten to `stopped`. Host shutdown is an interruption. The next process's restart walk records it. A user Stop remains the only writer of `stopped` for that path.
7. `connections.close()` still runs.
8. `shutdownState === "complete"` is the observable end. The database stays with the caller that opened it, because several owners share it and tests close it after `missions.close()`.
