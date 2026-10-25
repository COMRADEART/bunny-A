# Security and regression

No model identity, approval, pin, or resource check was weakened. A hard pin still fails closed when the served digest is missing or different. A preference with a null digest is not treated as verified. Classification does not grant tools. The SQL and file prompts produced model text only. Stop settled to `stopped` and output stopped growing. The uncertain-write replan does not retry. A process exit of 3 stays a failed deterministic check.

Local regression on this worktree, with the licensed Node bin first on PATH so the packager test can see the authentic LICENSE. The system Node directory was not modified.

| Step | Result |
| --- | --- |
| `npm run typecheck` | exit 0 |
| `npm run test:ma4` | 272 tests, 270 pass, 0 fail, 2 skip |
| `npm run test:ui` | 419 pass, 0 fail |
| `npm test` scripts stage | 463 tests, 462 pass, 1 fail |
| `npm run build` | exit 0 |
| `JEV_DESKTOP_BUILD=1` build | exit 0 |
| `npm audit --omit=dev --audit-level=high` | 0 vulnerabilities |

The two `test:ma4` skips are the opt-in live free-model contract and the native ownership helper. That helper skip is because `npm run test:ma4` does not run `pretest`. The `npm test` pretest did build ownership and voice, and the scripts stage passed the ownership reproducibility test.

The scripts-stage failure is `scripts/bunny-state-migration.test.mjs`: `stat` could not find `runtime/node.exe` inside that test's own temp release (`bunny-state-test-pRGa9Q`). The package build was copying the same Node exe at the same time. The license throw did not recur. A rerun of that file after the package build finished passed 23 tests and 0 failures.

`npm test` stage 1 then reported 1,656 tests, 1,649 pass, 7 fail. Six of those look up `npm` beside `node`. They were run with the isolated license bin first on PATH, and that bin has no npm. Rerun with `C:\Program Files\nodejs\node.exe` (the same v24.18.0 binary, which has npm) passed all six. The seventh expected the direct-task event list from before `execution.classified`. That assertion now includes the new event, and the rerun passed. Stage 2 passed 58 tests and 0 failures. The other 1,649 stage-1 tests were not repeated after that one-line expectation change.

| Rerun | Result |
| --- | --- |
| `bunny-state-migration.test.mjs` | 23 pass, 0 fail |
| the 7 stage-1 failures, system Node | 7 pass, 0 fail |
| npm test stage 2 | 58 pass, 0 fail |

Voice worker tests run inside the scripts stage. Pretest built the worker before that stage.
