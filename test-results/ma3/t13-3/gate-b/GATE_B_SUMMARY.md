# T13.3 Gate B — Persistent Personal Agents: evidence

Source commit: `498822e` (parent `08e53df`, the sealed T13.2 evidence commit). The regression below ran on exactly the Gate B
files in that commit; `final-source-head.txt` is the working-tree status captured when the run started. Gate C files written
while it ran (`lotus*.ts`) were not referenced by any test script or import at the time.

| Check | Result | Log |
| --- | --- | --- |
| `npm test` — scripts | 440 / 440 pass | `npm-test.log` |
| `npm test` — library | 1,512 / 1,512 pass (T13.2: 1,501; +11 Gate B: 4 context, 6 real-Host HTTP, 1 voice) | `npm-test.log` |
| `npm test` — Agent | 58 / 58 pass | `npm-test.log` |
| `npm run test:ui` | 366 / 366 pass (T13.2: 365; +1 ownership attribution) | `npm-test-ui.log` |
| `npm run typecheck` | exit 0 | `typecheck.log` |
| `npm run lint` | 0 errors, 27 warnings (same as baseline) | `lint.log` |
| `npm run build` | exit 0 | `build.log` |
| Browser QA (isolated QA Host) | pass, with 3 defects found and fixed before the run | `browser-qa.md`, `*.png` |

Superseded run: `npm-test-superseded-mixed-source.log` was started before the last voice and Host edits, so it mixed two
source states. It was stopped and is kept only as a record; it is not counted.

Side effect handled: the full suite rewrites some committed T5/T6/T7/T9R evidence files with fresh timestamps. Those
rewrites were reverted with `git checkout` so earlier milestones' evidence is unchanged.

Production preservation: the installed production Host (port 43119) was not stopped, restarted or written. All QA used a
throwaway state directory under `%TEMP%`.

Not demonstrated: keyboard Enter submission with a trusted key event (see `browser-qa.md`); spoken addressing of an Agent
by weapon name (not implemented).
