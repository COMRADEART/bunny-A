# MA3 T13.3 Gate F: session routing, quota continuation and fairness (evidence summary)

- Base (Gate E evidence commit): `c2f4528` (`base-head.txt`)
- Gate F source commit: `e00f6bf` (`final-source-head.txt`)
- Design and test mapping: `docs/t13-3/SESSION_RESOURCE_SCHEDULER.md`

## Regression on the committed source tree (UTF-8 logs)

| Suite | Gate E | Gate F | Change |
| --- | --- | --- | --- |
| `npm test`, scripts | 440 / 440 | 440 / 440 | none |
| `npm test`, library | 1,533 / 1,533 | 1,543 / 1,543 | +10: `scheduler.test.ts` (6), `session-ledger-host.test.ts` (2), one new test each in `t3-manager.test.ts` and `routing.test.ts` |
| `npm test`, Agent runtime | 58 / 58 | 58 / 58 | none |
| `npm run test:ui` | 366 / 366 | 366 / 366 | none |
| typecheck | exit 0 | exit 0 | |
| lint | 0 errors, 27 warnings | 0 errors, 27 warnings | baseline unchanged |
| build | exit 0 | exit 0 | |

Logs:

- Typecheck, lint, build and test:ui come from attempt 2: `typecheck.log`, `lint.log`, `build.log`, `npm-test-ui.log`.
- `npm test` comes from attempt 3: `npm-test.log`.
- Exit codes: `exit-codes.txt`. Per-attempt exit codes are in `exit-codes-attempt1.txt`, `exit-codes-attempt2.txt` and `exit-codes-attempt3.txt`.

No existing test was edited or weakened, and no focused run is counted in these totals.

The `test` script lists `src/lib/bunny-missions/scheduler.test.ts` explicitly, and the existing `src/lib/bunny-missions/*.test.ts` glob also matches it. Node runs it once: the library total is exactly 1,533 + 10.

## Retained failed runs (explained)

All three runs used the same committed source, apart from the 16 px radio size fix noted under attempt 1. Each failed run had exactly one failure: a Windows file-system error in an older, unrelated test. None of the new Gate F tests failed in any run.

1. **Attempt 1.** Logs: `npm-test-attempt1-eperm-flake.log`, plus the `*-attempt1.log` files.
   - Library: 1,542 / 1,543. `T4: harmless gpg helper descendants are owned and timeout kills them` (`git-helpers-ownership.test.ts`) passed its assertions, then failed in cleanup: `rmSync` got `EPERM` on its own temp folder.
   - This is the known flake that predates T13.3. T2's acceptance doc already names it, and the T7 (`full-regression-attempt2.log`) and T12 regression logs show it too.
   - The Agent runtime suite did not run, because `npm test` stops at the first failing step.
   - This attempt also started before the radio size fix. Its typecheck, lint, build and test:ui logs passed but predate the committed source, so they are kept only as history.
2. **Attempt 2.** Log: `npm-test-attempt2-x10-write-flake.log`.
   - Library: 1,542 / 1,543. The T4 test passed this time. `T6 X10: exact owned Node assertion execution` (`cross-app.test.ts`) failed while writing its own evidence file, `test-results/ma3/t6/security/X10.json`. Node reported `UNKNOWN: unknown error, open`.
   - The file was not locked when checked straight afterwards. This error does not appear in any earlier log.
   - Typecheck, lint, build and test:ui all passed in this attempt.
3. **Attempt 3.** Log: `npm-test.log`. `npm test` passed: 440 + 1,543 + 58, 0 failures.

## What was shown live (QA Host 43190, `browser-qa.md`)

- Settings → AI & Models → Usage & limits renders three sections: the routing priority, this Host run's usage ("No model requests yet in this session."), and sharing between Agents.
- Changing the priority to Minimize cost, and Gada's priority to High, both went through the Host. Both values survived a full page reload.
- At 390×844 there is no horizontal overflow.
- One layout bug was found and fixed during QA: the radios inherited the 44 px input height.
- After QA, the QA Host was set back to the defaults: Balanced, with every Agent at Normal.

## Restored side effects

`npm test` rewrites committed evidence of earlier milestones. After each run,
`git checkout -- test-results/ma3/t5 test-results/ma3/t6 test-results/ma3/t7 test-results/ma3/t9r` restored it.

## Production preservation

The installed production Host (port 43119) was not stopped, restarted or written to. QA used the separate Host on port 43190, with a temporary data directory, and the Vite dev server on 8091.

No push, deployment, sign-in, installation or paid inference took place. No model request was sent from the QA Host.

## Credential check

A count-only scan checked common token shapes: GitHub, OpenAI-style, AWS, Slack, PEM private keys and bearer tokens. It covered the 18 changed or new source and doc files and every log in this folder, and found 0 matches. The screenshots show no credentials.

## Not demonstrated in Gate F

- **Fairness:** not exercised with four live Agents running real Missions at once. It is proven by the pure `admitStep` tests and the Mission-manager admission test.
- **CPU and GPU:** not used for admission. Memory pressure and step caps are what Bunny enforces, and the UI says so.
- **Cloud cost:** stays UNKNOWN. No provider reports per-request prices to Bunny, and no price table is assumed.
- **Provider concurrency cap:** there is no separate one. Provider concurrency is bounded by the shared step ceiling and the T13.2 reservations.
- **Quota exhaustion:** shown only with fixture adapters. No real provider quota was exhausted.
- **Browser console errors:** not recorded during QA.
