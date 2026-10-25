# Regression results

Commands ran in the qualification worktree on branch `ma4-s3-t1r-intelligence-qualification`, based on merge `22b55a4`. None used `--test-force-exit`. The 24-hour soak was left running.

## Final exits

| Command | Exit | Result |
| --- | --- | --- |
| CI stage 0 (`scripts/*.test.mjs` except `voice-worker.test.mjs`) | 0 | 387 passed. This run was before the voice-worker rebuild. |
| CI stage 1 (Host and Mission suites), after the worker rebuild | 0 | 1655 passed, 1 skipped |
| CI stage 2 (agent runtime and teams) | 0 | 58 passed |
| `npm run test:ma4` | 0 | 269 passed, 1 skipped (live free-model contract is opt-in) |
| `npm run test:ui` | 0 | 419 passed |
| `npm run typecheck` | 0 | `tsc --noEmit` |
| Web production build | 0 | `evidence/build-summary.txt` |
| Windows desktop production build | 0 | `evidence/build-summary.txt` |
| `scripts/voice-worker.test.mjs` | 1 | 69 passed, 7 failed |

Stage durations after the worker rebuild: stage 1 about 873 s, stage 2 about 220 s, `test:ma4` about 40 s. Stage 0 was about 150 s.

## Stage 3 wrapper

`node scripts/ci/test-stage.mjs 3 --test-timeout=300000` exits 1 before any test. Stage 3 is `npm run test:ma4`, and the helper refuses extra `--test` flags on a command that is not `node --test`. Hosted CI calls `node scripts/ci/test-stage.mjs 3` with no extra flags. The direct `npm run test:ma4` above is that command, and it exited 0. `evidence/regression-summary.txt` still shows `STAGE_3_EXIT=1` for the bad wrapper invocation.

`npm test` was not launched as one process. Its pretest runs `build:voice`. On this machine that rebuild skips the whisper shim because the runtime is not staged. The build script now keeps a prior `whisperShim` record instead of deleting it. The four stages above are the same commands CI runs.

## Voice worker

The committed exe did not emit `turnFramesKeepsNewestBeforeRead`. Aligning only `sourceSha256` made the hash check pass and left that behavior missing. `node scripts/build-voice-worker.mjs` recompiled the worker. The record now binds LF source `663628d0a8bcc1e71d73be80b7bea92bcf6ece916ad2872c5f7e0a48f1e5e27d` and binary `823b2d0b38975e811ce250d9265131b1807e5d5c22c42a194f0d8b14e3d49306`. The previous `whisperShim` block was kept. The two duplex tests that failed before the rebuild passed after it, and they are inside the green stage 1 run.

`scripts/voice-worker.test.mjs`: the build-record check passed. The 7 failures are `requireWhisperRuntime`: `whisper.dll`, `ggml.dll`, `ggml-base.dll`, `bunny-whisper-shim.dll`, and `ggml-base.en.bin` are not staged. Those tests fail closed. The pin in this tree was not replaced from another checkout. Hosted CI does not run this file.
