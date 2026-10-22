# MA4-S1R3-CI2 — hosted stage 2 diagnosis

Base: PR #12 head `101261a` (branch `ma4-s1r3-agent-reliability`). Diagnostic branch `ci-diag/ma4-s1r3-ci2`, workflow
`.github/workflows/ci-stage2-diagnostic.yml`. Runner image `windows-2025-vs2026`, Node `v24.21.0`, 4 vCPUs, 16 GiB,
`TEMP=C:\Users\RUNNER~1\AppData\Local\Temp` (8.3 form; real path `C:\Users\runneradmin\AppData\Local\Temp`), no git
identity. Locally: Node `v24.18.0`, Windows 11.

## Summary

There were two defects, and they had separate causes. The first caused the second.

| | Failure | Root cause | Class |
|---|---|---|---|
| 1 | `T13.3 H every weapon wears every style … survives a restart` fails on hosted runners only | The test restarts a Host **in the same process on the same port**. The first request to the restarted Host goes out on a keep-alive socket that `fetch` pooled while talking to the first Host. On hosted Windows that socket is still open, because the first Host's socket close is deferred. When the close lands, the unread request is reset: `read ECONNRESET` | **Test defect**, exposed by runner timing |
| 2 | Stage 2 hangs to the 90-minute job limit | The failing request is in the harness's `boot()`, after `startHost()` and before `boot()` returns the Host. Nothing owned that Host, so it was never closed. Its listening socket (`127.0.0.1:43910`) kept the test-file process alive, and the test runner waits for that process forever. Its open state files made the cleanup `rmSync` fail with `EPERM`, and that error replaced the original one | **Test defect** (harness resource leak on the failure path) |

No product code is defective. Production Host restarts are process restarts, so the operating system closes every
socket. Only a test can run two Hosts, one after the other, in one process on one port with a shared client pool.

## Why the original report showed no detail

* The spec reporter prints failure details only when the run ends, and the run never ended.
* The error that would have been printed was the cleanup `EPERM` from `rmSync`, not the real failure.
* The `Bunny-A Host ready` lines are written one test late. In the original log, the third "ready" line before `✖`
  belongs to the next test. Test 1 boots two Hosts, both on hosted runners and locally.
* Stage 2 runs its files in sorted path order, not in the order `package.json` lists them. After the appearance file
  comes `codex-compatibility.test.ts`. That file never started: the appearance file's process never exited.

## Reproduction (hosted)

| Run | Commit | Lane | Result |
|---|---|---|---|
| 39684601550 | `101261a` | PR #12 `npm test` | stage 2: `✖ T13.3 H every weapon …` (5.2 s), then no output for 86 min; cancelled at 90 min |
| 39700393706 | `b86c9c9` (test unchanged) | isolated | `not ok 1`: `EPERM, Permission denied: \\?\C:\Users\RUNNER~1\…\bunny-t13-3-appearance-FldqEj` from `rmSync` (`withHost`). Tests 2 and 3 pass. The process does not exit: **watchdog TIMEOUT at 300 s** |
| 39700393706 | `b86c9c9` | full stage 2 (original order, concurrency 1) | `not ok 52` (same test), then **watchdog TIMEOUT at 1800 s** |
| 39701335596 | `1a0edf6` (`boot()` closes on failure) | isolated | `not ok 1`: `TypeError: fetch failed` (2.6 s). **No EPERM, no hang**: the process exits with code 1 and leaves 0 orphans |
| 39701658336 | `6466cd6` (+ cause tracing) | isolated | `command mission.configure on Host … port 43910: fetch failed; cause ECONNRESET read ECONNRESET`. The stack goes through `boot` ← the reboot callback in `withHost` |
| 39702020237 | `b1fa317` (+ `connection: close`) | isolated | **3/3 pass**, exit 0, 0 orphans. Keep-alive probe without Host code: 0/200 and 0/40 failures |
| 39702421167 | `648259c` (no `connection: close`, socket trace) | isolated | Reproduced again. The socket trace shows the failing request on a pooled socket from the first Host (below) |

Count: 5 of 5 hosted runs of the unchanged test failed. Locally, 0 failures (`docs/ma4-s1r3/evidence/appearance-*.log` and
this session).

### Hang evidence (run 39700393706)

Watchdog `isolated.watchdog.json` at timeout:

```
bash (5568) → node --test … character-appearance-host.test.ts (5952) → node <test file> (4328)
listeners: 127.0.0.1:43910 owned by 4328
```

`handles-4328.json`, the report the test-file process kept writing every 20 s until the watchdog stopped it:
`resources: [PipeWrap, PipeWrap, TCPServerWrap]` and `handles: [stdout pipe, stderr pipe, Server 127.0.0.1:43910]`.
Nothing else was running: no child process, no timer. The listening socket of a Host on test 1's port was the only
thing keeping the process alive. The graceful stop did not end the tree, and the forced stop did (`survivedForced: []`).
No orphan processes remained.

The full stage 2 lane shows the same thing: `listeners: 127.0.0.1:43910 owned by 6308`, which is the test-file process.

### Failure evidence (run 39702421167, `http-trace-10080.log`)

```
00:55:37.916Z server-accepted {"peer":53504,"local":43910}      first Host accepts the pooled connection
00:55:37.918Z connected       {"local":53504,"remote":43910}
…              send on 53504 / 53505 …                            the test's style changes and /state reads
00:55:38.650Z send            {"local":53505,"method":"GET","path":"/state"}      last request to the first Host
00:55:38.769Z socket-end      {"local":53505}                    first Host's close reaches 53505 only
00:55:38.769Z send            {"local":53504,"method":"POST","path":"/command"}   restarted Host's mission.configure
00:55:38.771Z error           {"path":"/command","code":"ECONNRESET","message":"read ECONNRESET"}
00:55:39.401Z server-socket-close {"peer":53504}                  first Host's side of 53504 finally closes
```

The restarted Host never accepted a connection. Its first request travelled on socket 53504, which belonged to the
first Host. The client had never seen a FIN on that socket, and the first Host's side of it was closed only 0.6 s later.
Closing a socket with unread received data makes Windows send RST, which the client reports as `read ECONNRESET`.

The keep-alive probe (`scripts/ci/keepalive-probe.mjs`) runs a plain `http` server through the same close/re-listen
cycle on the same runner, and it never fails (0/240). The deferral therefore depends on the Host's own close-and-restart
path. It is not generic `fetch` behaviour. Which part of that path delays the socket close was not isolated. The
inference, not measured, is the synchronous shutdown and startup work the two Hosts run on the shared event loop. The
fix does not depend on that detail: no request reuses a socket, so no request can meet a stale one.

## What the failure and the hang share

The failure did not need the hang, and the hang did not need this particular failure. **Any** failure inside `boot()`
after `startHost()` would leak the Host and hang stage 2. The `ECONNRESET` was simply the first such failure on hosted
runners. These are two separate defects, fixed separately (see CI_HOST_LIFECYCLE.md).

## Hypotheses ruled out

| Hypothesis | Evidence |
|---|---|
| 8.3 short `TEMP` | Passes locally under an 8.3 `TEMP` (S1R3 `evidence/appearance-short-temp.log`). On CI, the fixed test passes on the same short `TEMP` |
| No git identity | Passes locally without a git identity (S1R3 `evidence/appearance-no-git-identity.log`) |
| A leaked child process (git, worker, provider) | The process tree at timeout holds only bash → node → node. The test-file process has no `ChildProcess` handle, and the watchdog found 0 orphans |
| Cross-file contamination or ordering | The failure reproduces with the file alone (isolated lane), so stage ordering is not needed |
| A product race in character appearance or restart persistence | The failing request is the harness's `mission.configure` and never reached the restarted Host. With fresh connections, every appearance assertion, including the after-restart checks, passes on hosted runners |

## What the hang had been hiding

Stage 2 had never finished on hosted runners. Once the hang was fixed (run 39704318771, `a66c207`), stage 2 completed in
20 min: **1,600 of 1,638 passed, 37 failed**. Each failure was traced to a cause and reproduced locally or on hosted.
None needed a weaker test.

| Class | Tests | Root cause | Reproduction | Fix | Class |
|---|---|---|---|---|---|
| A. Pooled socket across a Host restart | 2 (`harnesses-host`, `ma2-t10`) | Same mechanism as the T13.3 failure: a later Host on an earlier Host's port gets a stale keep-alive socket | hosted only | `connection: close` in those harnesses (`ma2-t10` boots a fresh Host per test on fixed port 45139) | test |
| B. 8.3 short temp paths | 10 (`m2`, `project-workspace` ×6, the two fsmonitor tests, `git-merge`) | Hosted `TEMP` is `C:\Users\RUNNER~1\…`. Project registration stores native long paths (`realpathSync.native`), while the manager's working-directory check and `within()` used `realpathSync`, which keeps short names. Git reports long paths | locally, with an 8.3 `TEMP` alias: the same 10 fail | **product**: the working-directory check matches a project by native identity, and `within()` also accepts containment between the OS's final (native) paths. **test**: two fixtures that compare path strings are rooted at `realpathSync.native(tmpdir())` | product + test |
| C. Git for Windows UCRT64 layout | 21 (`owned-process-group` ×17, `git-helpers-ownership` ×4) | Git 2.56 on the runner ships `ucrt64\bin\git.exe`; there is no `mingw64`. Tests hard-coded `mingw64`, and `realGit()` searched only `mingw64`/`clangarm64`/`mingw32` | hosted `git-layout.txt` | **product**: `realGit()` checks `ucrt64` first (new test case). **test**: the binary is derived through `realGit()` | product + test |
| D. Local-only priority on a Host without model facts | 1 (`session-ledger-host`) | The `local_only` priority was applied only inside the routing pipeline. With no model facts, the legacy BunnyRouter decision stands, and it got raw constraints, so a ready cloud provider took a local-only Task. `assistDecision()` checked the same raw constraints | locally, with a preload that makes `127.0.0.1:11434` unreachable | **product (privacy)**: one `taskConstraints()` applies the priority before every route and before the hosted-advice gate. New regression test on a fact-less Host | product |
| E. Host tests reading the PC's own tools | 2 (`connections-host`, `intelligence-host`) | Codex model facts came from the developer's installed Codex CLI. On a clean runner Codex had no candidates, so fewer than 2 were eligible and assistance was skipped | locally, simulating a clean runner (empty profile, minimal PATH, no Ollama) | **test**: fixture model catalogs via a test-only `startHost({ modelProbes })` seam, which HTTP cannot reach | test |
| F. Live Calculator UIA | 1 (X53, `cross-app-live`) | The runner image has no Microsoft Calculator package (`computer.open_app failed: Verified installed Microsoft Calculator package unavailable`) | hosted `integrated-attempt.json` | **product**: acquisition verified the package *after* launching `calc.exe`, which left `win32calc.exe` running (the watchdog's one orphan). It now verifies first (ordering test). **test**: X53 reports `SKIPPED (NOT TESTED)` where the package is absent and still runs wherever it is installed | product + test |

Ruled out: DPAPI key protection (it round-trips on the runner: `dpapi-probe.txt`); test ordering (all classes reproduce
with a file run alone); leaked child processes (0 orphans in every run, except the Calculator one in class F).

### An overreach, caught and corrected

The first class-B fix made `canonical()` itself native (`3f40d7f`). On hosted runners it broke 63 staging and remote
authority tests (gating run 39712293880). `DeviceStaging.root()` rejects a staging folder when
`canonical(root) !== resolve(root)`, and an 8.3 data directory then looked like an alias. That change was reverted.
`canonical()` behaves exactly as in `101261a` (it only gained an optional resolver argument, defaulting to `realpathSync`), and the fix is now confined to the two comparison points above. The
staging alias check is untouched.
