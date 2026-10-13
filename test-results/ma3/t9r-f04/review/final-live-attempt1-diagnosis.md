# Final live run, attempt 1 (source 43ffee8): 25 PASS, 5 FAIL

All five failures are the even-numbered abrupt-host-exit rounds (2, 4, 6, 8, 10), which send an authenticated Stop and then kill the Host with `taskkill /F` 5 ms later.

In every failed round the containment results were correct:

- 0 owned fixture processes remained;
- the provider root was gone;
- cleanup was observed after about 0.9–1.1 s;
- both unrelated processes (the same-image fixture and the provider-like process) were still alive.

Each round failed at the harness step that waits for Host B to reconcile the job record to `absent_after_restart` / `interrupted`.

A diagnostic rerun (`diag-abrupt-2.json`, round 2) recorded the stored record:

```
state "stopped", closed true, containment "empty", activeProcesses 0, terminatedAtEnd 26
```

Host A had finished the Stop before the kill landed. Kernel accounting reached 0, and the record was closed as kernel-verified empty. A closed, kernel-empty record must not be "reconciled" on restart, so Host B was correct and the harness expectation was wrong for this interleaving.

Before review round 1 (NATIVE-1), native terminate blocked, so Stop was slower than `taskkill` and the pre-final run always saw death during cleanup. With the non-blocking terminate, Stop usually wins the race.

The harness was corrected to accept exactly these two truthful outcomes and to record which one occurred per round ("restart outcome"):

- `stopped`/`empty`/0;
- `absent_after_restart`/`interrupted`.

Any other end state still fails the round. Rounds 2, 6 and 10 now start the kill and the Stop together, so death lands mid-cleanup. The full 10-round run was then repeated on the same source.
