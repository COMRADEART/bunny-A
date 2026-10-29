# MA5-S2 Baseline (S2-G1)

| Item | Value |
|---|---|
| Recorded | 2026-10-28 |
| Base | protected `main` at `f6c51ea` (merge of PR #60) |
| PR #59 (MA5-S1/S1R1) | merged 2026-10-28 17:11 UTC, head `cd13801`, merge `dad2433` |
| PR #60 (MA5-S1R2) | merged 2026-10-28 22:17 UTC, head `3401007`, merge `f6c51ea` |
| Branch | `ma5-s2-native-agents-voice`, isolated worktree `bun-router-ma5s2` |
| Node | v24.22.1 (local) |

## CI baseline

Required checks on `main` (branch protection): `typecheck, MA4/routing/sandbox-contract tests, UI tests, builds`,
`full MA3/MA4 regression (npm test)`, `static security checks`. The two native jobs (Windows WPF, Android preview)
run on pull requests when their paths change.

| Run | SHA | Result |
|---|---|---|
| push `main` | `dad2433` (PR #59 merge) | success |
| PR #60, final head | `3401007` | success (incl. native Android preview) |
| push `main` 40778848500 | `f6c51ea` | typecheck/UI/builds success, static security success, `npm test` job still running when recorded; see FULL_REGRESSION_AND_CI.md for the final value |

## Starting limitations carried in (MA5-S1 RELEASE_GO_NO_GO.md, S1R2_FINAL_MERGE_ACCEPTANCE.md)

- Physical voice, screen readers, live display changes, cross-machine Windows builds: not tested.
- Connected-task authoring on Windows: absent (this milestone's Phase 1A).
- Phone chat cannot show model answers (`publicTask` blanks output for devices): owner privacy decision.
- No re-pair path after a gateway address change on Android.
- MA4 G7 model-quality findings stand; skills/memory gains unproven.
- Public beta: NO-GO.
