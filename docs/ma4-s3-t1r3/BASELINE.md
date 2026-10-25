# MA4-S3-T1R3 baseline

Predecessor is PR #41, still OPEN, not merged. Head is exactly `199cf3a20b39ddfd61e228aee1eaffd6c0a676f3`.

Both hosted workflows on that SHA succeeded:

- push run 40220086981
- pull_request run 40220106304

Each run completed typecheck/builds, full `npm test`, and static security with conclusion SUCCESS. Run 40192245873 qualified PR #40 only and is not this baseline.

This branch `ma4-s3-t1r3-production-closure` was created from that SHA in `C:\Users\allam\Documents\new\bun-router-s3t1r3`. The T1R2 worktree was left at `199cf3a`. No merge, no deploy, no publish.

T1R2 findings this milestone closes:

- `classifyTask` was not on the live chat submit path.
- The Windows packager threw `Node runtime license unavailable` because `C:\Program Files\nodejs\node.exe` (v24.18.0) has no sibling LICENSE.
- Cold chat on the T1R2 machine was 14,093 ms versus the predecessor's 7,902 ms, measured sequentially, with model load about 12,760 ms.
- Warm median was 1,095 ms versus 1,273 ms (14.0%), short of the 15% goal. That goal stays an honest reported outcome. No new latency target was added.

Public beta stays NO-GO. MA4-S3-T2 was not started.
