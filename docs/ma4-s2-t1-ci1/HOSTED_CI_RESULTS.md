# MA4-S2-T1-CI1 — Hosted CI results

## Gating `ci` workflow on the final code commit

Run [40017012304](https://github.com/COMRADEART/bunny-A/actions/runs/40017012304): push of
`ma4-s2-t1-ci1-host-recovery` at **`4f6be51`** (the last code commit). **Conclusion: success.**

| Job | Result | Per-test counts |
|---|---|---|
| static security checks | **SUCCESS** | prod audit high+ clean; no committed secrets or env files; external inference disabled by default |
| typecheck, MA4/routing/sandbox-contract tests, UI tests, builds | **SUCCESS** | typecheck pass; `test:ma4` 149: **125 pass, 0 fail**, 24 skipped; routing 69/69; UI 411/411; mobile-web and desktop builds pass |
| full MA3/MA4 regression (npm test) | **SUCCESS** | stage 1 380/380; stage 2 1,653: **1,651 pass, 0 fail**, 2 skipped; stage 3 58/58; stage 4 (`test:ma4`, native helpers built) 149: **126 pass, 0 fail**, 23 skipped |

T1-11/12 and CI1-F4 are `✔` in both jobs (`evidence/ci-40017012304-counts.log`). The skips are the unchanged
environment gates (no WSL2 sandbox on hosted runners: `SKIPPED (not passed)`; the native helper is not built in the
checks job; the opt-in live test). Stage 2's 2 skips also predate CI1: `T10-whisper … # SKIP whisper not selected: runtime
not staged`, and `T6 X53 … # SKIP NOT TESTED: no verified Microsoft Calculator package`.

## Before / after on hosted Windows

| | Before (`af6da78`) | After (`4f6be51`) |
|---|---|---|
| CI checks job | failure (runs 40011975263, 40012505240) | **success** (40017012304) |
| CI regression job | failure, stage 4 T1-11/12 (40011975263) | **success** (40017012304) |
| Diagnostic: T1-11/12 isolated | 0/10 (40014200323) | **10/10** (40015670240) |
| Diagnostic: `test:ma4` | 0/3 (40014200323) | **3/3** (40015670240) |

## Documentation commits

The commits after `4f6be51` change only `docs/ma4-s2-t1-ci1/**`. **`4f6be51` is the last validated code-identical
commit.** The CI runs triggered by the docs commit and the draft PR run the same code. Their results are recorded on
the PR, and they do not replace the result above.

## Draft PR

Opened against `ma4-s1r3-agent-reliability` (the branch PR #20 merged into), as a draft. Not merged. Merging needs the
owner's approval.
