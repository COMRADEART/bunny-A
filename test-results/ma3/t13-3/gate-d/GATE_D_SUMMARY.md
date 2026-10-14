# MA3 T13.3 Gate D — bounded worker delegation: evidence summary

- Base (Gate C evidence commit): `4852b0a`
- Gate D source commit: `6d7c60e` (`final-source-head.txt`)
- Contract: `docs/t13-3/AGENT_WORKER_DELEGATION.md`

## Regression (one full run on the committed source tree, UTF-8 logs)

| Suite | Gate C | Gate D | Change |
| --- | --- | --- | --- |
| `npm test`, scripts | 440 / 440 | 440 / 440 | — |
| `npm test`, library | 1,522 / 1,522 | 1,530 / 1,530 | +8: `workers.test.ts` (4), `workers-host.test.ts` (4) |
| `npm test`, Agent runtime | 58 / 58 | 58 / 58 | — |
| `npm run test:ui` | 366 / 366 | 366 / 366 | — |
| typecheck | exit 0 | exit 0 | |
| lint | 0 errors, 27 warnings | 0 errors, 27 warnings | baseline unchanged |
| build | exit 0 | exit 0 | |

Exit codes: `exit-codes.txt`. Logs: `npm-test.log`, `npm-test-ui.log`, `typecheck.log`, `lint.log`, `build.log`.
No existing test was edited or weakened, and no focused run is counted in these totals.

## Retained exploratory failure (explained)

During development one focused run of `workers-host.test.ts` reported the passing worker as INDETERMINATE
(`verified: null`). The run had started in parallel with the edit that adds the Host verification criteria
(the skill's command re-run with `expectExit: 0`) to each worker step, so it executed the previous source. The
next focused run, and the full regression above, ran the edited source and pass. The behaviour the failure showed
is intended: a step with no Host verification never becomes VERIFIED. The run's console output was not saved to a
file; this note is its record.

## Restored side effects

`npm test` rewrites committed evidence of earlier milestones. After the run,
`git checkout -- test-results/ma3/t5 test-results/ma3/t6 test-results/ma3/t7 test-results/ma3/t9r` restored it.

## Production preservation

The installed production Host (port 43119) was not stopped, restarted or written to. QA used the separate Host on
port 43190 (temporary data directory) and the Vite dev server on 8091. Only that QA Host was restarted, to load the
Gate D wiring. No push, deployment, sign-in, installation or paid inference took place. Every worker in tests ran
local `node -e "process.exit(N)"` fixture scripts; the fixture provider refuses to launch.

## Credential check

A count-only scan of the new source files, the contract and these logs for common token shapes (GitHub, OpenAI-style,
AWS, Slack, PEM private keys, bearer tokens, quoted API keys) found 0 matches, and 0 in the diff of the edited files.

## Not demonstrated in Gate D

- Model-backed abilities (Research notes, Documentation draft, Review) were not run against a live provider.
- A browser-run worker reaching VERIFIED was not shown: Gada's QA Missions have no Project, and approving a child
  Mission in the browser was not attempted. VERIFIED and REJECTED outcomes through real child Missions are evidenced
  by `workers-host.test.ts`.
- Part F planning additions (plan revisions, replan triggers, Laya/Jev advice for workers) are not implemented.
- Browser console errors were not recorded during QA.
