# MA4-S3-T2R1 baseline

Worktree: isolated branch `ma4-s3-t2r1-live-voice-qualification`, cut from the merge that integrated PR #43. Existing worktrees, the installed Bunny A release, and the startup shortcut were left in place. Nothing was merged or deployed from this qualification.

| Item | Value |
| --- | --- |
| Repository | https://github.com/COMRADEART/bunny-A |
| Predecessor | PR #43, merged 2026-10-25T21:33:40Z |
| PR head | `c2e3d8d919d63db7424786e982a7b8701ae1766a` |
| Integrated source SHA | `4af7d9f313ee46b98698fe12662b11676b3391cd` |
| `main` at qualification start | that same SHA. Subject: Merge pull request #43 from COMRADEART/ma4-s3-t2-realtime-voice |
| Named hosted workflow | https://github.com/COMRADEART/bunny-A/actions/runs/40234165018 |
| That run | `pull_request`, head `c2e3d8d`, conclusion **success** (2026-10-25T21:32:19Z). Jobs: fast checks, full `npm test`, static security. All success. |
| Merge push on the integrated SHA | https://github.com/COMRADEART/bunny-A/actions/runs/40236068024 conclusion **success** |

The voice path under test is the MA3-T12 duplex session as left by PR #43. This qualification does not add a second engine.
