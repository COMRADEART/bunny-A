# T9R-F04 baseline verification

Verified on 2026-10-10, before any F04 change.

| Fact claimed in the F04 brief | Observed | Source |
|---|---|---|
| Accepted milestone `BUNNY_MA3_T9R_F03_PASS_WITH_LIMITATIONS` | Yes. The F03 report and memory record agree. | `MA3_T9R_F03_CONSUMER_CLASSIFICATION_HARDENING.md` |
| Executable source `b693167` | `git log` shows `b693167 fix(t9r-f03): harden paired-device consumer classification and close F02 round-5 LOWs` | git |
| Evidence and report commit `9e64719` | HEAD was `9e647196824b2a0c41cf8424f47e4614cea3343c` | git |
| Branch `claude/ma3-t9-phone-remote` | Yes | git |
| Evidence root `test-results/ma3/t9r-f03/` | Present (`INDEX.sha256`, live/, x53/, windows-package results) | filesystem |
| Full regression 1,263/1,263 (256 + 884 + 24 + 99) | **Reproduced**: an isolated `git worktree` at `b693167` ran `npm test` and `npm run test:ui` with 256 + 884 + 24 + 99 = 1,263 pass, 0 fail, 0 skipped. | `baseline/baseline-test.log`, `baseline/baseline-ui.log` |
| Production v26 unchanged | Production observed read-only: `Bunny-A-Windows-v26-MA2-R1`, manifest `81f83786…` (161 files), 25 tables, listeners 127.0.0.1:8084 and 127.0.0.1:43119 | `production-before.json` |

## Notes

- The baseline worktree needed an untracked runtime licence notice, which the M-A-1D packaging test reads from `releases/installed/JEV-Windows-v1/runtime/LICENSE`. It was copied in read-only. The first worktree run failed only on that missing file.
- One earlier baseline attempt in the main checkout was abandoned, because the F04 native rebuild started during it. Its log was discarded and replaced by the isolated worktree run above. Some existing tests rewrite tracked T5/T6/T7/T9R evidence when they run. Every F04 regression run is followed by `git checkout -- test-results/ma3`, so historical evidence stays byte-identical.
- Production listener PIDs differ from the F03 snapshot (8084: 25292, 43119: 20128, against 23016 and 13672 in F03). Nothing in this gate started, stopped or signalled production. The difference comes from a production restart outside this session, not from F04 testing.
- The test environment itself runs inside an enclosing Windows job. This is recorded in `nested-job-validation.json`.

## Pre-F04 containment state (F03 reassessment, confirmed by discovery)

- Codex and Claude sessions ran as plain `spawn` children with `taskkill /T` Stop and 15 s process-table sampling. Orphaned descendants were invisible to Stop and to the F01/F02 hold.
- A Host crash left provider trees running.
- Git, `gh` and Mission `terminal.exec` already used the T4 job helper.

The full discovery is in `discovery/`.
