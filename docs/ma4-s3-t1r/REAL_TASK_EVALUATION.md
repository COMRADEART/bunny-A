# Real task evaluation

Classification is recorded and is not the success bit. `src/lib/bunny-host/ma4/s3t1.ts` does not contain the holdout ids. The frozen files are `scripts/ma4-s3-t1r/development.json` and `scripts/ma4-s3-t1r/holdout.json`.

## Sets

Each set has 12 C0, 12 C1, 12 C2, and 8 C3 tasks. C1–C3 run in a temporary directory. The bytes and the expected SHA-256 live in the JSON. C0 offline rows are `not-tested-offline`.

| Set | verified | refused (file kept) | failed on purpose | uncertain | C0 not run offline |
| --- | ---: | ---: | ---: | ---: | ---: |
| development | 26 | 4 | 1 | 1 | 12 |
| holdout | 26 | 4 | 1 | 1 | 12 |

Verified rows are C1 reads, C2 copy-then-hash, and approved process exits of 0. The failed row is a process that exits 3. The uncertain row is an external write with no observation. Unapproved deletes do not remove the fixture. `verifiedCompletion` for the non-C3 rows is 1. Evidence: `evidence/offline.json`.

## Live C0 holdout

One pinned local model, temperature 0, `num_predict` 24. Success means the reply contains the frozen token. The harness checks the token. The model does not grade itself.

| Measure | Result |
| --- | --- |
| Answered | 14 (1 cold, 2 warm repeats of H-C0-01, 11 other holdout prompts) |
| Token check passed | 14 |
| Cold | 4466 ms |
| Warm median / min / max | 293 ms / 159 ms / 448 ms |
| Digest checked before the first call | yes, mismatch would have exited without a substitute |

This is direct Ollama, not a Host task with tools, approvals, and a receipt. It does not show that the product completes more real work than the predecessor.

## What was not counted

- A class label matching `classifyTask`
- Reviewer confidence
- The development C0 prompts (they were not sent to a model)
