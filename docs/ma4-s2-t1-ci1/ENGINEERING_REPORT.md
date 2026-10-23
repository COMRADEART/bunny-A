# BUNNY A — MA4-S2-T1-CI1 REPORT

```text
REPOSITORY
  Base SHA:   af6da789feb6dfd09b9a8c2febd734a908c14609 (PR #20 merge into ma4-s1r3-agent-reliability)
  Final SHA:  code 4f6be51 (last code commit, hosted CI 40017012304 all SUCCESS); docs commits after it change only docs/ma4-s2-t1-ci1/
  Branch:     ma4-s2-t1-ci1-host-recovery (worktree ../bun-router-ci1)
  Draft PR:   see HOSTED_CI_RESULTS.md (base: ma4-s1r3-agent-reliability; not merged)

ROOT CAUSE
  Original failing test:  T1-11/12 Host API (src/lib/bunny-host/ma4-s2t1-host.test.ts)
  Failure mechanism:      the test restarts the Host in-process on the same port; its first request after
                          the restart (GET /state) was written to a keep-alive socket the first Host had
                          already destroyed (fetch had not yet processed that socket's FIN). Windows answered
                          with RST -> read ECONNRESET. The request never reached either Host. Test-harness
                          defect; the Host's close/restart is correct.
  Reproduction:           hosted 10/10 isolated + 3/3 test:ma4 (run 40014200323), socket trace on all 10;
                          locally 10/10 with fixture telemetry (the PC's real hardware probes delay startHost
                          ~600 ms after listen(), which hid the race; hosted: 14-15 ms)
  Fix:                    connection: close on every request in the test (the MA4-S1R3-CI2 pattern);
                          fixture telemetry so the test keeps hosted timing locally; new CI1-F4
                          failure-injection test. No retry, sleep, suppression or force-exit.
  Files changed:          src/lib/bunny-host/ma4-s2t1-host.test.ts (+65/-5); docs/ma4-s2-t1-ci1/**

VALIDATION
  Targeted local tests:   fixed file 10/10 with fixture telemetry; negative control (fix removed) 0/10
  Targeted hosted tests:  run 40015670240: isolated 10/10 (2/2 tests each), test:ma4 3/3 (149: 125 pass,
                          0 fail, 24 env-gated skips)
  Host lifecycle:         10-case matrix PASS (HTTP_LIFECYCLE_ANALYSIS.md); finding F-CI1-1 disclosed
  Phone authorization:    6 workstation-only actions -> WORKSTATION_REQUIRED; dropped phone create refused
  No-duplicate execution: CI1-F4 + T1-11/12 + T1-4/5/18: no step re-run, no duplicate task
  Process cleanup:        26 hosted watchdog reports (13 failing, 13 passing): 0 orphans, 0 timeouts

RELEASE
  MA4:                    local 149: 148 pass, 0 fail, 1 skipped (opt-in live)
  Full regression:        local npm test 456/456, 1,653/1,653, 58/58, 148+1 skip (0 fail)
  UI:                     411/411
  Typecheck:              pass
  Desktop:                pass (JEV_DESKTOP_BUILD=1 npm run build)
  Mobile-web:             pass (npm run build)
  Security audit:         npm audit --omit=dev --audit-level=high: 0 vulnerabilities; static checks OK
  Sandbox:                WSL2 F4.1-F4.11 + F5 seccomp pass locally (hosted: SKIPPED, no WSL2)
  Hosted CI:              run 40017012304 on 4f6be51: static security, checks, full regression all SUCCESS

UNQUALIFIED SURFACES
  Installed Windows:            NOT TESTED (not authorized)
  Physical Android:             NOT TESTED (no hardware run)
  Browser-rendered phone UI:    NOT TESTED (see below)
  Windows startup integration:  NOT INSTALLED (kept disabled)
  OS notifications:             NOT IMPLEMENTED (in-app notifications only, unchanged)
```

## Notes

### Local regression, first attempt

The first full `npm test` in the fresh worktree failed in stage 1 with 9 failures, so stages 2–4 did not run
(`evidence/npm-test-run1-unstaged.log`):

* 7 whisper tests: the git-ignored whisper runtime was not staged in the new worktree;
* M-A-1D release: the git-ignored `releases/installed/JEV-Windows-v1/runtime/LICENSE` was missing;
* the CI watchdog self-test: one process outlived the forced stop under full stage 1 load. It passed 3/3 alone and in
  the full rerun. It passes in every hosted run. This is load-timing sensitivity in that self-test, disclosed and not
  changed.

After the fresh-worktree setup recorded in S2-T1 (copy `native/voice/vendor/` and that LICENSE from the main checkout;
`npm run pretest`), the full rerun passed with 0 failures (`evidence/npm-test.log`, 1,278 s). Product code was the same
in both runs.

### Phone browser UI (Phase H)

Not rendered. A faithful smoke test needs the HTTPS companion origin. `/api/bunny-*` refuses local requests
(`authorizeBridge` → `access.local`), uses `Secure` device cookies and reads the live Host's credential file. Reaching
the phone path from a local browser would mean spoofing the remote classification, or pointing a tunnel at real Host
state. Neither is an isolated or safe smoke test. The Background Tasks rows remain logic-tested only
(`ptask-model.test.ts`: stale view offers no controls; the phone approves and resolves on the PC; corrupt rows offer no
controls).

### Other observations (not failures, not changed)

* **F-CI1-1**: a Host whose `listen()` fails keeps its state files open in-process (HTTP_LIFECYCLE_ANALYSIS.md).
  It has no known production impact, because startup failure is fatal and the process exits. Recommended follow-up.
* `ma4.test.ts` lines 255–256 (`MA4 actual Host API`) do not read two response bodies. After that test's Host closes,
  undici reports errors for those unread bodies (`evidence/hosted-after/test-ma4-unread-body-errors.txt`). The test
  passes; no request is re-sent to a Host. Cosmetic.
* Three hosted CI occurrences before CI1 (runs 40011975263 ×2 jobs, 40012505240) are preserved unedited in `evidence/`.

## Gates

| Gate | Requirement | Status |
|---|---|---|
| CI1-G1 | Actual integration baseline verified | PASS |
| CI1-G2 | Original hosted failure diagnosed with evidence | PASS |
| CI1-G3 | Minimum fix at the correct layer | PASS |
| CI1-G4 | T1-11/12 passes on hosted Windows | PASS |
| CI1-G5 | Phone authentication and role restrictions preserved | PASS |
| CI1-G6 | Host startup/shutdown and cleanup verified | PASS (F-CI1-1 disclosed) |
| CI1-G7 | No task replay or stale-worker regression | PASS |
| CI1-G8 | Persistent runtime tests pass | PASS |
| CI1-G9 | MA4 and full regression pass | PASS (local and hosted) |
| CI1-G10 | UI, typecheck, desktop/mobile-web builds pass | PASS |
| CI1-G11 | Security audit and supported sandbox tests pass | PASS |
| CI1-G12 | All mandatory hosted CI jobs SUCCESS | PASS (run 40017012304 on code commit 4f6be51) |
| CI1-G13 | Draft PR and evidence published | PASS (draft PR, this folder) |
| CI1-G14 | Hardware and installed-release gaps disclosed | PASS |

Passed: G1–G14 (14). Failed: none. Partial: none. Blocked: none.

```text
FINAL STATUS: PASS
  (for the CI1 qualification gate. MA4-S2-T1's own release surfaces remain unqualified: installed Windows,
   physical Android and the browser-rendered phone UI are NOT TESTED; startup integration is not installed;
   OS notifications are not implemented.)

NEXT RECOMMENDED ACTION:
  Owner review and merge of the CI1 draft PR into ma4-s1r3-agent-reliability; then MA4-S2-T2 Connected
  Actions may start. Separately, a small follow-up for F-CI1-1 (close startHost()'s state when listen() fails).
```
