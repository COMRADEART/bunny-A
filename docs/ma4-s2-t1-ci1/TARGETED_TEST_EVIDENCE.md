# MA4-S2-T1-CI1 — Targeted test evidence

Per-test results, not just exit codes. Hosted runs use `windows-latest` (Node 24.22.1, 4 vCPUs, 16 GiB,
`TEMP=C:\Users\RUNNER~1\…`) on the diagnostic workflow `ci-ci1-diagnostic` (branch `ci-diag/ma4-s2-t1-ci1`). Its
lanes run the file or suite exactly as CI does, under the CI2 process watchdog, with the socket trace preload.
Local runs use this PC (Windows 11, Node 24.18.0).

## Before the fix (code `af6da78`, diagnostic commit `7573e80`, run 40014200323)

| Lane | Runs | Result per run |
|---|---|---|
| `isolated-x10`: `node --test src/lib/bunny-host/ma4-s2t1-host.test.ts` | 10 | **10 × `not ok 1 - T1-11/12`**, `fetch failed` / `read ECONNRESET` (`evidence/hosted-before/isolated-x10-summary.txt`) |
| `test-ma4-x3`: the `test:ma4` command | 3 | **3 × (148 tests, 123 pass, 1 fail, 24 skipped)**; the failure is `not ok 72 - T1-11/12` each time (`evidence/hosted-before/test-ma4-x3-counts.txt`) |

## After the fix (code `4f6be51` cherry-picked as `4826136`, plus diagnostic `7cb1fc2`, run 40015670240)

| Lane | Runs | Result per run |
|---|---|---|
| `isolated-x10` | 10 | **10 × (2 tests, 2 pass, 0 fail)**: T1-11/12 and CI1-F4 (`evidence/hosted-after/isolated-x10-summary.txt`) |
| `test-ma4-x3` | 3 | **3 × (149 tests, 125 pass, 0 fail, 24 skipped)** (`evidence/hosted-after/test-ma4-x3-counts.txt`) |

The 24 hosted skips are unchanged environment gates: WSL2 sandbox fixtures (`SKIPPED (not passed)`), the native
ownership helper (not built in that lane, as in the CI checks job) and the opt-in live test. They are reported as
skipped, never as passed. No CI1 test is skipped.

Trace after the fix: in all 10 test-file processes, **37 requests over 37 new connections, 0 client errors**. The
first request after each restart is accepted by the restarted Host (`evidence/hosted-after/host-trace-run.log`).

## Gates

### F1: original failing test passes repeatedly on hosted Windows, no unauthorized skips — **PASS**

T1-11/12: hosted 10/10 isolated + 3/3 within `test:ma4` after the fix, against 10/10 + 3/3 failures before it. Local, final
code: every run passes (the file 6×, with fixture telemetry 10×, `test:ma4` 2×, full `npm test`). The unchanged code
also passed locally every time it ran with real telemetry (3 single runs + 12 under 4-way parallel contention), which is
why the defect reached CI.

### F2: adjacent Host tests, no regression in authentication, pairing, lifecycle or persistent tasks — **PASS**

* `test:ma4`, local: 149 tests, 148 pass, 0 fail, 1 skipped (opt-in live) (`evidence/test-ma4.log`), including
  every T1-x test, the WSL2 sandbox F4.x/F5 tests and the MA4 Host API test.
* Full `npm test` (includes the stage 2 pairing, remote-device, Host-lifecycle and failure suites): see
  `evidence/npm-test.log` and ENGINEERING_REPORT.md.
* Routing 69/69, UI 411/411.

### F3: process cleanup, no orphaned Host or worker processes — **PASS**

Hosted: 26 watchdog reports (13 before, 13 after), all `EXITED`, **0 orphans, 0 timeouts**. That includes the 13
*failing* runs: a failure inside T1-11/12 leaves nothing behind. The test file exits on its own; no
`--test-force-exit` is used.

### F4: failure injection, no double execution — **PASS**

New test CI1-F4 (SECURITY_REGRESSION.md): a client drops after a complete create → one task, each step once; dropped
mid-body → nothing; a phone's dropped create → refused, nothing created; a same-port restart → no re-run, no duplicate.
Existing T1-11/12 covers the paused step not re-run across a restart; T1-4/T1-5/T1-18 cover real process kills.
Lifecycle #5 (local scratch test): a second Host on the same data and port is refused and changes no running task.

### F5: security boundary, unpaired and unauthorized clients denied — **PASS**

T1-11/12: the paired phone gets `WORKSTATION_REQUIRED` for create/approve/reconcile/revoke/policy/output. MA4 actual
Host API test: an invalid token → 401/403; the paired client is denied `ma4.configure/discover/evaluate`. CI1-F4: a
dropped phone create stays refused. Stage 2 pairing suites in `npm test`.

### F6: CI stability under representative hosted conditions — **PASS**

The hosted diagnostic ran the exact CI commands on the same runner image, before and after the fix (above). Final
confirmation is the gating `ci` workflow on the PR head (HOSTED_CI_RESULTS.md).

## Local reproduction and negative controls (`evidence/negative-control.log`)

| Variant (this PC) | Runs | Pass | Fail |
|---|---|---|---|
| Unchanged test + fixture telemetry (hosted startup timing) | 10 | 0 | **10** (`ECONNRESET`) |
| Fixed test + fixture telemetry | 10 | **10** | 0 |
| Final test, `connection: close` removed from `state()` only | 5 | 5 | 0 |
| Final test, `connection: close` removed from `command`, `state` and `pair` | 10 | 0 | **10** (`read ECONNRESET`) |
| Unchanged test, real telemetry (as before CI1) | 3 + 12 parallel | 15 | 0 (the 600 ms window hides the race) |

## What was not used

No sleeps were lengthened, no retries were added, `ECONNRESET` is not suppressed, and `--test-force-exit` is not used.
The whole multi-stage CI was not re-run while the failure was unexplained. The targeted diagnostic workflow was
used instead (2 runs, about 10 minutes each).
