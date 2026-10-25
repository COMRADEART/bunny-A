# Holdout results

The sets live in `src/lib/bunny-host/ma4-s3-t1.test.ts`. `s3t1.ts` does not import them.

| Set | Cases | Kind | Result |
| --- | --- | --- | --- |
| Development | 55 | Synthetic class labels | pass, `classifyTask` matched every expected class |
| Frozen holdout | 45 | Synthetic class labels, different wording | pass |
| Combined | 100 | Stratified C0–C3, holdout has at least 8 of each | pass |

These cases check the classifier. They are not evidence of operating-system integration, file edits, or builds. They contain no production secrets.

Functional correctness of tool execution, and verified end-to-end completion on a frozen task set with real tools, were **not** run. Do not read the 100/100 class match as a task-completion rate.

The latency target is unmeasured against a baseline, so there is no holdout latency delta.
