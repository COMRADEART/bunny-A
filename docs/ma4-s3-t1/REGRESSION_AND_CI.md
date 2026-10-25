# Regression and CI

## Commands this session

| Command | Result |
| --- | --- |
| `node --experimental-strip-types --test src/lib/bunny-host/ma4-s3-t1.test.ts` | 7 passed |
| `npx tsc --noEmit` | exit 0 |
| `npm run test:ma4` | 266 passed, 0 failed, 2 skipped (the live free-model contract is opt-in). Duration about 27 s |
| `npm test` | NOT TESTED. A soak from `bun-router-soak-r1` is still running. Starting the full chain beside it would contend with that qualification |
| `scripts/voice-worker.test.mjs` | NOT TESTED this session |
| Installed Windows smoke | NOT TESTED |
| `npm audit` | NOT TESTED this session |

`m2.test.ts` routing cases that do not launch fake CLIs passed, including local-only model selection. Four Windows shim detection tests in that file failed with a null CLI version. Those tests do not call the T1 router. The discovery sources were not edited. Treat them as an environment failure of the fake shim, and re-run them on a clean hosted CI job rather than as a T1 logic regression.

## Predecessor CI

See `BASELINE_AND_SCOPE.md`. Closure head CI is success. `main` full regression was in progress.

## T1 hosted CI

Not started until this branch is pushed. An in-progress run is not PASS.
