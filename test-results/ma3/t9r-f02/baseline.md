# T9R-F02 baseline verification (before any F02 change)

Recorded 2026-10-09, before the first F02 source edit.

| Check | Result |
|---|---|
| Branch | `claude/ma3-t9-phone-remote` |
| Checkout | `HEAD = 01c42332856e53fef9094b2e8aee5d3ff9cef647` (F01 evidence and closure commit) |
| F01 source commit `aacf3989ebaf67d27e8adbc112233ca2693c01c2` | present; ancestor of HEAD (`git merge-base --is-ancestor`) |
| Source delta `aacf398..01c4233` under `src/` | none (the evidence commit adds evidence and the report only) |
| F01 evidence seal | `node test-results/ma3/t9r-f01/seal-evidence.mjs --verify` → `{"result":"PASS","files":570,"failed":[]}`; 570 tracked files under `test-results/ma3/t9r-f01/` |
| Working tree | clean except the protected untracked user files listed below |

## Protected untracked files (preserved, never staged, never modified)

`BUNNY_OPENDOTS_ADOPTION_REPORT.md`, `MA1D_FINAL_INDEPENDENT_REVIEW.md`, `MA1_CLAUDE_FINAL_REVIEW.md`, `MA2_FINAL_INDEPENDENT_REVIEW.md`, `a.txt`, `memory/`.

## Actual test inventory at the baseline (executed, not copied from F01)

Commands: `npm test` (three node test runs) and `npm run test:ui`. Raw logs are in `baseline/baseline-npm-test.log` and `baseline/baseline-test-ui.log`.

| Suite | Tests | Pass | Fail | Skipped |
|---|---|---|---|---|
| Script tests (`scripts/*.test.mjs`) | 256 | 256 | 0 | 0 |
| Library tests (`src/lib/**` list in `package.json`) | 769 | 769 | 0 | 0 |
| Agent tests (`agent-runtime`, `agent-recovery`) | 24 | 24 | 0 | 0 |
| UI tests (`src/components/island/*.test.ts`) | 99 | 99 | 0 | 0 |
| **Total** | **1,148** | **1,148** | **0** | **0** |

This matches the accepted F01 floor of 1,148 distinct tests.

## Known side effect of the regression suite

As F01 documented, `npm test` rewrites 30 tracked, sealed evidence files under `test-results/ma3/{t5,t6,t7,t9r/remote-canonical}`. They are listed in `baseline/tests-rewrite-sealed-evidence.txt`. After every F02 run, the sealed originals were restored with `git checkout -- test-results/ma3`, and the run's rewritten copies were kept outside the repository. Sealed T5/T6/T7/T9R/F01 evidence is never modified by F02 commits.

## Production at the baseline (read-only)

See `production-before.json`, captured by `production-observe.mjs` before any F02 test ran:
- release `Bunny-A-Windows-v26-MA2-R1`, 161 files, manifest SHA-256 `81f83786…4729`;
- listeners `127.0.0.1:8084` (PID 23016) and `127.0.0.1:43119` (PID 13672), the same PIDs F01 recorded;
- database `C:\Users\allam\AppData\Local\Bunny-A\state\host.sqlite`, opened read-only.
