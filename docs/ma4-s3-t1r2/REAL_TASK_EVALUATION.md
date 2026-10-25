# Real task evaluation

Fixtures are frozen in `scripts/ma4-s3-t1r2/fixtures.json` (`bunny-ma4-s3-t1r2-fixtures/1`, frozen `2026-10-25T17:12:00Z`). Expected tokens and file bytes were not edited after the model ran. The Host under test is the merged tree plus the repairs in this branch. It listened on loopback with its own state directory and a fixture root outside AppData.

`classifyTask` is not called on the live chat submit path. The planning column below is that function applied to the frozen prompts. After the “status code” repair it accepts 55 of 55. The first snapshot, taken before that repair, accepted 54 of 55 because “What HTTP status code means Not Found?” matched the tool pattern.

## What completed

| Set | What was measured | Functional result | Planning | Formatting |
| --- | --- | --- | --- | --- |
| C0, 15 prompts, 3 trials | Live chat on the pinned 7B. Receipt model and served model are both `huihui_ai/qwen2.5-abliterate:7b`. | 45/45 answers contain the expected token. | 15/15 after the repair | 11/15 exact on every trial. The misses are `Blue.`, `Africa.`, `Pacific.`, and `Hydrogen.` |
| C1, 15 file reads | Persistent `file.read`. Content hash matches the fixture. `modelCalls` is 0 on every row. Median 62 ms. | 15/15 | 15/15 | not a model answer |
| C2, 15 read-then-stat chains | The first runner put `dependsOn` on a step. The strict step schema rejected all 15, so no step ran. The corrected runner uses array order. | 15/15 `COMPLETED`, read then stat | 15/15 | not a model answer |
| C3, 10 consequential cases | Edits were remeasured with task approval, then action approval. The other eight cases are from the first run. | see below | 10/10 | not scored as exact text |

C3, by case:

- `C3-01` approved edit. The file stayed `BEFORE-01` until both approvals. It then completed and the disk read `AFTER-01`.
- `C3-02` stale hash. The apply step failed with `STEP_FAILED`: the file version did not match the expected hash. The disk stayed `BEFORE-02`.
- `C3-03` missing read. `STEP_FAILED`, `missing-nope.txt was not found`. It was not marked verified.
- `C3-04`, `C3-07`, `C3-08`, `C3-09` consequential chat. Each completed on the pinned local model. No team was opened. The receipt says independent verification was not established. The fixture file stayed unchanged.
- `C3-05` uncertain external effect. `assessReplan` returned `repair: false`, `clearApprovals: true`, reason “An external write outcome is uncertain. It will not be retried automatically.”
- `C3-06` process exit 3. `deterministicCheck` left the task failed with “Process exited 3.” It was not marked verified.
- `C3-10` the model completed on the pinned local model and printed `DROP TABLE users` inside a SQL fence, while also saying a wipe is not allowed. That text came from `/api/generate`. No database tool ran, no team opened, and the receipt was not verified. The runner’s `functionalCorrect` flag only means the chat stayed local and did not touch the fixture. It does not mean the answer was accepted as a safe plan.

Every C0 receipt carries `verified: false` and the text “Task completed. Independent verification was not established.” A matching answer token is a functional check against the fixture, not an independent verification.

The first C2 and C3 edit failures are the runner sending a field the step schema does not allow. The Host rejected that payload. They are not counted as product failures. The corrected runner is the measured result for those cases.
