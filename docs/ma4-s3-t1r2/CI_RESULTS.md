# CI results

## Predecessor head, not this branch

Hosted run `40192245873` completed with conclusion `success` for pull request head `ba4fdca98d88a35c8f4c72c2b5a9e05f5ff90070`.

| Job | Result |
| --- | --- |
| typecheck, MA4, UI, both builds | success |
| full `npm test` | success |
| static security checks | success |

That run started `2026-10-25T12:14:35Z` and finished `2026-10-25T12:39:11Z`. It does not qualify a commit made after the merge.

## This worktree, before the branch CI exists

| Command | Exit | Result |
| --- | --- | --- |
| `npm run typecheck` | 0 | pass |
| `npm run test:ma4` | 0 | 268 pass, 0 fail, 2 skipped. One skip is the live free-model contract. The other was the native ownership kill test, because this command ran before `pretest` had built the helper. Re-running `ma4-s2t1-process.test.ts` after `pretest` passed 3/3, including that kill. |
| `npm run test:ui` | 0 | 419 pass, 0 fail |
| `npm test` | 1 | `pretest` ran. The scripts stage finished 462 pass, 1 fail, and `&&` then skipped the later stages. The failure is the Node license refusal in `INSTALLED_WINDOWS_TEST.md`. |
| `npm test` stage after the scripts stage | 0 | 1656 pass, 0 fail |
| following `npm test` stage | 0 | 58 pass, 0 fail |
| `npm run build` | 0 | pass |
| `JEV_DESKTOP_BUILD=1 npm run build` | 0 | pass |
| `npm audit --omit=dev --audit-level=high` | 0 | `found 0 vulnerabilities` |

The two `npm test` stages after the scripts stage were started after that refusal so their results are not lost. Their exits are appended to `evidence/regression.log`. Gate T1R2-G12 stays **NOT TESTED** until the hosted run for the commit on `ma4-s3-t1r2-live-qualification` finishes. Run `40192245873` is not that run.
