# Baseline and CI

Qualification date: 2026-10-24 (local) / 2026-10-25 UTC.
Repository: [COMRADEART/bunny-A](https://github.com/COMRADEART/bunny-A).
Work branch: `ma4-s3-t0r1-acceptance-closure`, created at the PR #36 merge commit.

## Source identity

| Item | Value |
| --- | --- |
| PR | https://github.com/COMRADEART/bunny-A/pull/36 (MERGED) |
| PR base | `ma4-s3-t0-unified-foundation` |
| PR head before merge | `319697b` (`ma4-s3-t0r-product-wiring`) |
| Merge commit | `97d188e86ba733dcb94525ac08a5a2639012d857` |
| Merge subject | Merge pull request #36 from COMRADEART/ma4-s3-t0r-product-wiring |
| Installed candidate | the git archive of `97d188e`, release `Bunny-A-Windows-S3T0R1-1-TEST` |

The installed package does not contain the closure-branch edits (Android permission allowlist assertion, removal of `--test-force-exit`). Those edits are in the review branch only.

## Hosted CI for the merge commit

Run: https://github.com/COMRADEART/bunny-A/actions/runs/40142924080
Event: push of `97d188e` to `ma4-s3-t0-unified-foundation` on 2026-10-24 23:29 UTC.
Workflow conclusion: **failure**.

| Job | Conclusion |
| --- | --- |
| typecheck, MA4/routing/sandbox-contract tests, UI tests, builds | success |
| static security checks | success |
| full MA3/MA4 regression (`npm test`) | failure |

The regression job's failing subtest is `T4-ANDROID-1`. Node reported `Expected values to be strictly equal`, expected `true`, actual `false`, on `leastPrivilegeInternetOnly`. The manifest declares `POST_NOTIFICATIONS` as well as `INTERNET`, so the internet-only flag is false. Later subtests in that job still ran. Artifact `regression-diagnostics` digest `sha256:1221d63d0ed539da72b21e1edb4124de5c89625bc012a982dc1a2be904c6b2e3`.

Runner notes on that run (not product failures): actions targeting Node.js 20 were forced onto Node.js 24, and `ubuntu-latest` is scheduled to move to Ubuntu 26.

## Closure-head hosted CI

Not started at the time this file was first written. The closure commit is local until the branch is pushed. The gate stays **BLOCKED** until a hosted run exists for the closure head. A push run URL, when one exists, belongs in `FINAL_GATE_MATRIX.md`.

## Local builds on the closure tree

Both commands exited 0 on 2026-10-25:

- `npm run build` (shared / mobile Vite build, no `JEV_DESKTOP_BUILD`) — about 35s, migrate skipped because `DATABASE_URL` is unset.
- `JEV_DESKTOP_BUILD=1 npm run build` — about 7s, same migrate skip.

These builds are the dirty closure tree. They are separate from the installed archive, which was packaged from `97d188e`.

## Local regression

The natural-exit chain in `NATURAL_EXIT_REGRESSION.md` is the fresh local regression. It is not a reuse of an older targeted run. Stage 0 used the CI script list, which omits `scripts/voice-worker.test.mjs`. That voice-worker file was not executed in this qualification.
