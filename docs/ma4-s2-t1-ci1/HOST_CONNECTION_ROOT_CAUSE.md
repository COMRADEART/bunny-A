# MA4-S2-T1-CI1 — Host connection root cause

## Conclusion

**Test-harness defect, proven by trace and by deterministic reproduction. No Host API defect.**

T1-11/12 restarts the Host **in the same process, on the same port**. All its requests use the global `fetch` pool,
which keeps idle keep-alive sockets per origin (`127.0.0.1:<port>`). When the first Host closes, it destroys its
server-side sockets (`closeAllConnections()`). The client side of those sockets learns of the close only when the
event loop processes each socket's FIN. On hosted Windows, the restarted Host is listening and `startHost()` has
resolved **14–15 ms** later. The test's first request (`GET /state`) is then written to a pooled socket whose FIN the
client has not processed yet. The first Host's socket no longer exists, so Windows answers with RST, and the client
reports `read ECONNRESET`. **The request never reaches either Host.**

It is not a flaky test. On hosted runners it failed **10 of 10** isolated runs and **3 of 3** `test:ma4` runs, plus the
three original CI failures. It never failed on this PC, because here `startHost()` resolves about **600 ms** after
`listen()`. By then every FIN has been processed.

## Evidence

### 1. Exact failing request: client and server socket trace (hosted)

The diagnostic branch `ci-diag/ma4-s2-t1-ci1` (commit `7573e80`, test file unchanged) runs T1-11/12 with a preload
(`scripts/ci/host-trace.mjs` on that branch). The preload records each listener (by sequence number), every
accepted and destroyed server socket, every client connection and send, and every request error. It records method and
path only: no headers, tokens or bodies. Run
[40014200323](https://github.com/COMRADEART/bunny-A/actions/runs/40014200323), lane `isolated-x10`, run 1
(`evidence/hosted-before/host-trace-run1.log`):

```
19:49:12.373Z listener-close-called {"server":2,"connections":0,"open":[{"peer":57781,"destroyed":true},{"peer":57782,"destroyed":true}]}
19:49:12.374Z listener-closed       {"server":2}                       first Host fully closed; its 2 sockets destroyed
19:49:12.444Z listener-open         {"server":3,…}                     restarted Host listening (same port)
19:49:12.458Z socket-end            {"local":57781}                    client processes the FIN of one pooled socket…
19:49:12.459Z send                  {"local":57782,"method":"GET","path":"/state"}   …but sends on the other one
19:49:12.461Z error                 {"path":"/state","code":"ECONNRESET","message":"read ECONNRESET"}
19:49:12.474Z server-socket-close   {"server":2,"peer":57782}          the old socket's close callback finally runs
```

The restarted Host (listener 3) **accepted no connection at all** before the error.
`evidence/hosted-before/trace-analysis.txt` (from `evidence/analyze-trace.mjs`) shows the same in **all 10 runs**:

| Measure (10 hosted runs) | Value |
|---|---|
| Failing request | `GET /state`, the first request after the restart (`const after = await state()`) |
| Error | `ECONNRESET` (10/10) |
| Socket it went out on | accepted by the **first** Host (listener 2), 10/10 |
| Connections the restarted Host accepted before the error | **0**, 10/10 |
| Server destroyed that socket before the send | 69–100 ms |
| Send after the restarted Host's `listen()` | 14–15 ms |

The diagnostic origin capture (commit `7cb1fc2`) attributes each failed request to the code that created it. Locally, on
the unchanged test with fixture telemetry, it names `ma4-s2t1-host.test.ts:35` (the `state()` helper), called from
`:75` (`const after = await state()`).

### 2. Where the reset happened

| Possibility in the brief | Finding |
|---|---|
| Before the request reached the Host | **Yes.** The request was written to a socket the first Host had already destroyed. The restarted Host never accepted it |
| While the Host processed it | No. No `server-request` for it on any listener |
| During response delivery | No. No response was started |
| A permission failure | No. Transport only. No Host classified the request, so no authorization decision was made or bypassed |
| Host startup/shutdown race in the product | No. Shutdown completed (`listener-closed`, every socket `destroyed: true`, `connections: 0`) before the restart, and the restarted Host served every later request with 200 |
| Concurrent tests sharing a port or fixture | No. Reproduced with the file alone (`isolated-x10`, `--test` on one file) |
| Cleanup terminating the Host early | No. The first Host is closed by the test itself, as designed. The failing request targets the restarted Host |

### 3. Why it passed locally: the 600 ms window

On this PC, with the unchanged test and the trace on, 3 runs gave these gaps between the restarted `listen()` and the
first request: **637, 624 and 615 ms**. The old sockets' FINs were processed 7–10 ms after `listen()`, long before
the first send. After `listen()`, `startHost()` still awaits `ptasks.start()`, `manager.discover()` and one telemetry
`poll()` (`sampleHost()`). On this workstation the real hardware/CLI probes take about 600 ms. On a clean hosted
runner they return almost at once. The CI2 notes recorded the same class of difference: no Ollama, Codex or GPU tools
on hosted runners.

### 4. Deterministic local reproduction

Give the unchanged test a fixture telemetry sampler (`startHost({ sample })`, an existing seam used by
`remote-device` and `remote-remediation`) and startup timing matches the hosted runner:

| Variant (this PC, 10 runs each) | Result |
|---|---|
| Unchanged test + fixture telemetry | **0 pass / 10 fail**, 20× `ECONNRESET` in the output |
| Fixed test (connection: close) + fixture telemetry | **10 pass / 0 fail** |
| Final test with `connection: close` removed from `command`, `state` and `pair` (negative control 2) | **0 pass / 10 fail**, `read ECONNRESET` in all 10 (`evidence/negative-control.log`) |
| Final test with it removed from `state` only (negative control 1) | 5 pass / 0 fail. With `command` still closing its connections, at most one idle socket is pooled, and its FIN is processed first. The race needs a second idle pooled socket, as in the trace (57781/57782) |

### 5. Hypotheses ruled out

| Hypothesis | Evidence |
|---|---|
| Flaky / random | 10/10 and 3/3 hosted failures before the fix; 0/10 and 0/3 after it |
| Host listener leak or late close | The first Host's `close()` had destroyed every socket and closed its listener before the restart began |
| Startup readiness (request before the Host is ready) | The restarted Host was listening and `startHost()` had resolved. The request went to the *old* Host's socket, not to a half-started Host |
| `freePort()` race (another process on the port) | The restarted listener is the test's own (same sequence of listeners in every trace). No `EADDRINUSE` |
| 8.3 temp paths, git identity | Not involved: the failure is at the transport layer, before any Host code runs |
| Plain `fetch` + `http.createServer` restart | The CI2 keep-alive probe (no Host code) never failed on hosted runners (0/240). A local probe that blocks the event loop for 50 ms between close and the first request also passed 50/50. The race needs a pooled socket whose FIN the client has not yet processed when the test resumes, which this Host restart produces and the probe did not |

## Fix (minimum, at the failing layer)

Test client connection lifecycle, in `src/lib/bunny-host/ma4-s2t1-host.test.ts` only:

1. Every request sends `connection: close` (the established MA4-S1R3-CI2 pattern), so no request can travel on a
   socket an earlier Host accepted.
2. Fixture telemetry (`sample`), so this PC runs the test with the hosted startup timing and the test keeps guarding
   the race locally. Negative control 2 shows that removing the fix then fails locally 10/10.
3. A new failure-injection test (CI1-F4; see SECURITY_REGRESSION.md).

Not done, deliberately:

* no retry, no sleep, no longer timeout, no `ECONNRESET` suppression, no `--test-force-exit`;
* no change to the Host: production restarts are process restarts, where the OS closes every socket, and a client
  never shares one connection pool across two Host instances in one process;
* no different port for the restarted Host. That would weaken the same-port restart the test exists to prove.

## Why the CI2 open question no longer matters

CI2 recorded that "which part of [the Host's] path delays the socket close was not isolated". The CI1 trace answers it
for this test. The server-side close is **not** delayed: every socket is destroyed before the listener closes. What
is delayed is the client's processing of those FINs, by synchronous Host startup work on the shared event loop. For a
same-process restart, the safe client behaviour is the same either way: never reuse a connection across Host
instances.
