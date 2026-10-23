# MA4-S2-T1-CI1 — Baseline audit

Recorded 2026-10-23, before any change.

## Integration baseline

| Item | Verified value |
|---|---|
| PR #20 (`ma4-s2-t1-persistent-runtime`) | **MERGED** into `ma4-s1r3-agent-reliability` |
| Merge commit (= start of CI1) | `af6da789feb6dfd09b9a8c2febd734a908c14609` |
| Merge parents | `d46a9dc` (integration branch before S2-T1) and `f984657` (S2-T1 head) |
| `origin/ma4-s1r3-agent-reliability` head at audit | `af6da78`, the merge commit itself |
| CI1 branch / worktree | `ma4-s2-t1-ci1-host-recovery` at `C:\Users\allam\Documents\new\bun-router-ci1`, created from `af6da78` |
| Diagnostic branch / worktree | `ci-diag/ma4-s2-t1-ci1` at `C:\Users\allam\Documents\new\bun-router-ci1-diag`. Diagnostics only, never merged |

The main checkout (`bun-router`, branch `ma4-s1-model-intelligence`, with uncommitted user changes) and the other 12
worktrees were not touched.

## Hosted CI at the baseline

| Run | Event / commit | static security | checks (typecheck, MA4, UI, builds) | full regression |
|---|---|---|---|---|
| [40011975263](https://github.com/COMRADEART/bunny-A/actions/runs/40011975263) | PR #20 / `f984657` | success | **failure**: `npm run test:ma4`, T1-11/12 | **failure**: stage 4 (`test:ma4`), T1-11/12 |
| [40012505240](https://github.com/COMRADEART/bunny-A/actions/runs/40012505240) | push / `af6da78` | success | **failure**: T1-11/12 | in progress at audit |
| [40012299178](https://github.com/COMRADEART/bunny-A/actions/runs/40012299178) | PR / `d46a9dc` (before S2-T1) | success | success | in progress at audit |

### Run 40011975263 in detail

* Checks job `120614366068`, step `npm run test:ma4`: 148 tests, **123 pass, 1 fail, 24 skipped**. The failure is
  `✖ T1-11/12 Host API: workstation creates and runs; …` (6,724 ms) with
  `TypeError: fetch failed` / `[cause]: Error: read ECONNRESET … syscall: 'read'`, at
  `src\lib\bunny-host\ma4-s2t1-host.test.ts:25:1`. Log: `evidence/ci-40011975263-checks-job.log`.
* Regression job `120614366070`: stage 1 380/380; stage 2 1,641 pass / 0 fail / 2 skipped; stage 3 58/58;
  stage 4 (`test:ma4` with native helpers) 148 tests, **124 pass, 1 fail (T1-11/12, same `read ECONNRESET`),
  23 skipped**. So the regression job's failure is the same single defect. The `WATCHDOG TIMEOUT … hang exceeded 3s`
  line in stage 1 is the watchdog's own self-test (`ok 134`), not a failure. Excerpt:
  `evidence/ci-40011975263-regression-excerpt.log`.
* Run 40012505240 (merge commit): the same test fails (11,540 ms), with the same error. Log: `evidence/ci-40012505240-checks-job.log`.

The 24 (or 23) skips are environment-gated and existed before S2-T1: the WSL2 sandbox is unavailable on hosted
runners (`SKIPPED (not passed)`), the native ownership helper is absent in the checks job, and the live test is opt-in.

## Failing request, as far as the CI log shows

The spec reporter prints no stack frame from the test, only `TCP.onStreamRead`. The `Bunny-A Host ready` lines are not
reliable for timing (CI2 showed they print late). The CI logs therefore show only that **some** `fetch` in T1-11/12
got a TCP reset. The socket trace pinned it to the exact request (see HOST_CONNECTION_ROOT_CAUSE.md).

## Prior work reviewed

* MA4-S1R3-CI2 (`docs/ma4-s1r3/CI_STAGE2_DIAGNOSIS.md`, `CI_HOST_LIFECYCLE.md`, commits `a66c207`, `b1fa317`,
  `648259c`). Seven Host harnesses that restart a Host **in-process on the same port** sent a request that went out
  on a keep-alive socket pooled from the first Host, and got `read ECONNRESET` on hosted runners only. The fix there
  was `connection: close` on every harness request, plus close-on-failure in `boot()`. CI2 left one question open:
  which part of the close/restart path delays the socket close.
* T1-11/12 was written in S2-T1 after CI2 had merged, but it does not use that pattern. It is the only test file in
  `src/lib/bunny-host` that starts two Hosts on one port in one process without `connection: close`. The ten other
  Host test files without it start one Host per process: eight on a free port, and `failure`/`host` on a fixed port
  that no other Host in that process uses. `ma4-s2t1-process.test.ts` uses no HTTP.
* Host shutdown (`http.server.ts` `close()`): it stops loops, voice, persistent tasks (`ptasks.close()`), sessions,
  agents and missions, then calls `server.closeAllConnections()` and `server.close(cb)`, then `db.close()`.
  `startHost()` resolves after `listen()`, `ptasks.start()`, `manager.discover()` and one telemetry `poll()`.
