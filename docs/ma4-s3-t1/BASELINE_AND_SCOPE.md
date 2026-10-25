# MA4-S3-T1 baseline and scope

Recorded before the T1 diff. The dirty trees and the running soak were left alone.

## Repository

| Item | Value |
| --- | --- |
| GitHub | https://github.com/COMRADEART/bunny-A |
| Qualified tree | `85061161e195402f06fd8194ac317ff6b9ebf74f` |
| T0R1 head | `6c65165585db655dc64fb9a39139ba58edec96c8` |
| T0R1 merge into the S3 foundation (PR #37) | `43eaa3b4cc71548d0a14c3e48a9d2807b543a494` |
| `main` after PR #38 | `bc1c82df8f765e39b1bbb64191a08f3e09f00d95` |

Those three commits share one tree. T1 started from `main` at `bc1c82d`.

## Pull requests

| PR | State | Merge |
| --- | --- | --- |
| #35 MA4-S3-T0 unified foundation | MERGED | `a8622c74fc896852562a189fa780c638d30c60b0` |
| #36 MA4-S3-T0R product wiring | MERGED | `97d188e86ba733dcb94525ac08a5a2639012d857` |
| #37 MA4-S3-T0R1 acceptance evidence | MERGED | `43eaa3b4cc71548d0a14c3e48a9d2807b543a494` |
| #38 foundation into `main` | MERGED | `bc1c82df8f765e39b1bbb64191a08f3e09f00d95` |

## Hosted CI on the closure head

Both runs are the same candidate, `6c65165`.

| Run | Event | Finished | Conclusion |
| --- | --- | --- | --- |
| [40151445420](https://github.com/COMRADEART/bunny-A/actions/runs/40151445420) | push | 2026-10-25T02:02:10Z | success |
| [40151461863](https://github.com/COMRADEART/bunny-A/actions/runs/40151461863) | pull_request | 2026-10-25T02:00:17Z | success |

The push run finished later. It is the latest completion for that SHA. The earlier gate matrix that called run `40151412133` BLOCKED was written before these two runs finished. That older statement is stale.

`main` push [40152910433](https://github.com/COMRADEART/bunny-A/actions/runs/40152910433) for `bc1c82d` had static security and the fast job green. The full regression job was still running when T1 started. It is not marked PASS here.

## Worktrees and local changes kept

- `bun-router` is on `ma4-s1-model-intelligence` with uncommitted edits. Not used and not cleaned.
- `bun-router-s3t0` is on `ma4-s3-t0r1-acceptance-closure` with local voice-worker and `routeTree.gen.ts` edits. Not used and not cleaned.
- A 24-hour soak is still running from `bun-router-soak-r1` (`scripts/ma4-s2t3r/soak.mjs`, host pid under that tree). It was not stopped.
- T1 worktree: `bun-router-s3t1`, branch `ma4-s3-t1-adaptive-intelligence`, started at `bc1c82d`.

## Predecessor limits that T1 inherits

From `docs/ma4-s3-t0r1/`:

| Limit | T1 treatment |
| --- | --- |
| Onboarding model was not the routed model | Addressed. Preference is not a hard pin. |
| Completed chat task was not independently verified | Addressed. Completion and verification stay separate. |
| Diagnostics health unavailable in the installed UI | Inherited. Not claimed fixed. |
| Windows background toasts unsupported | Inherited. |
| Physical Android qualification incomplete | Inherited. Android stays a companion. No on-device LLM. |
| `scripts/voice-worker.test.mjs` omitted from the prior chain | Inherited until this session runs that file. |
| Public beta not approved | Still NO-GO. |

The closure-head regression is green. T1 tests can proceed. T1 is not complete while `main` full regression is unfinished, and it is not complete without final-head CI for the T1 branch.
