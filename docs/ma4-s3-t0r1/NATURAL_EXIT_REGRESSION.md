# Natural-exit regression

Fresh chain started 2026-10-24T20:47:26-04:00. Summary file: `evidence/natural-exit-summary.txt`.
Every stage below exited 0. No stage command included `--test-force-exit`.

| Stage | Exit | tests | pass | fail | skipped |
| --- | --- | --- | --- | --- | --- |
| pretest | 0 | — | — | — | — |
| shutdown resource probe | 0 | — | — | — | — |
| 0 CI script list | 0 | 387 | 387 | 0 | 0 |
| 1 host, mission, and voice suites | 0 | 1656 | 1656 | 0 | 0 |
| 2 agent runtime / team files | 0 | 58 | 58 | 0 | 0 |
| 3 `npm run test:ma4` | 0 | 261 | 260 | 0 | 1 |

Chain exit: 0.

Stage 0 is the CI file list in the summary. It includes `scripts/bunny-sbom-provenance.test.mjs` and does not include `scripts/voice-worker.test.mjs`. `npm test` still expands `scripts/*.test.mjs`, so a literal `npm test` would also run the voice-worker file. That file was not part of this chain. Its result is **NOT TESTED**.

Stage 1 includes `agent-store.test.ts`. Stage 2 is the seven other agent files named in the acceptance request (`agent-runtime`, `agent-recovery`, `agent-team`, `agent-team-matrix`, `agent-team-lifecycle`, `agent-team-handoff`, `agent-team-surfaces`) plus `personal-agents-team.test.ts`.

A separate eight-suite log, `evidence/agent-suites.log`, recorded 67 pass, 0 fail, 0 skipped, duration about 262s. That log is the eight agent files together. The natural-exit proof for the npm-test agent stage is the 58/58 stage 2 row, with `agent-store` already inside the 1656/1656 stage 1 row.

Stage 3 skip, quoted from the log: `MA4 live free-model Host contract (opt-in; never paid) # SKIP`. It is an opt-in live test. It is not counted as a pass.

## Force-exit removal

`package.json` `test` previously passed `--test-force-exit` only on the agent stage. That flag was removed after this chain exited 0. The edited `npm test` script was not started again as one process. The proof is the stripped stage commands in the summary, which match the edited agent stage.

## Shutdown resources

Probe result `evidence/shutdown-resources.json`:

- timers before close: 1
- timers after close: 0
- `shutdownState`: `complete`
- sessions: 0
- task state left `running`
- `stopReason`: null
- remaining handle: one `PipeWrap` (the probe's own stdio)

`beginShutdown` clears runtime and tree timers, bounds `session.stop()` at 5 seconds, deletes the session, and does not write a user Stop. The task row stays `running` for the next process's restart walk.

Live deadline behavior remains in `armRuntimeLimit`: while `shutdownState` is `open`, the timer calls `stopInBackground` with `Runtime limit reached.` After shutdown starts, the same timer returns without stopping.

## Installed shutdown, observed later

The installed-product shutdown is recorded in `GOLDEN_JOURNEYS.md` journey E. SIGTERM during `running` left `stopReason` null. After the replacement Host started, the row was `failed` with the restart-walk error beginning `Host process restarted`. That is the recovery record, not a user Stop.
