# MA4-S3-T0 — Model Performance Baseline

## Status: CARRIED / TO RE-RUN ON CANDIDATE SHA

Pinned local primary for MA4 planner/worker work: **`qwen2.5-coder:7b`** (digest recorded in prior `docs/ma4-s2-t3r1/evidence/model-qualify-run3-*.json`).

Prior remediation run3 (on `e7d3bf2`, not yet re-sealed on post-fix tip):

| Set | Accepted | Correct | Completed | Injection refusals |
|---|---|---|---|---|
| DEV | 5/5 | 5/5 | 5/5 | 8/8 |
| HELDOUT | 5/5 | 5/5 | 4/5 | 8/8 |
| HELDOUT_V2 | 5/5 | 5/5 | 5/5 | 8/8 |

**Gate S3T0-G8:** PARTIAL until `scripts/ma4-s2t3r1/model-qualify.mjs` re-run against the exact candidate SHA with digest freeze.

Do not train/tune against sealed answers.
