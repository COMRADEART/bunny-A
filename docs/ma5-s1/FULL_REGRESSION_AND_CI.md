# MA5-S1 — Full regression and CI

## Local regression

`npm test` on the code head `394f4d1`, with only `docs/ma5-s1/` uncommitted (documentation only). Exit code 0.

| Stage | Tests | Pass | Fail | Skipped |
|---|---|---|---|---|
| `scripts/*.test.mjs` | 468 | 468 | 0 | 0 |
| Host, orch, routing, missions, voice, agents (TypeScript suites) | 1 679 | 1 679 | 0 | 0 |
| Agent runtime, team suites, `tests/native-companion.test.ts` | 62 | 62 | 0 | 0 |
| `npm run test:ma4` | 318 | 317 | 0 | 1 |
| **Total** | **2 527** | **2 526** | **0** | **1** |

The one skip is "MA4 live free-model Host contract (opt-in; never paid)". It is opt-in by design and was skipped in
earlier milestones too.

Other local checks on the same tree:

| Check | Result |
|---|---|
| `npm run typecheck` | 0 errors |
| `npm run test:ui` | 421 / 421 pass |
| `npm run build` | pass (the regenerated `src/routeTree.gen.ts`, line endings only, was reverted) |
| `npm audit --omit=dev --audit-level=high` | 0 vulnerabilities |
| `scripts/build-android.ps1` (Java 21.0.12) | pass: connection policy 21, Keystore erasure 5, cookie policy, PollPolicyTest 22, ManifestLauncherTest, no `android.webkit` |
| `native/windows/package-dev-candidate.ps1` | pass: 4/4 files identical across two Release builds |
| Windows E2E (`scripts/verify-ma5-s1-windows.mjs`) | 9/9 stages pass |
| Candidate lifecycle (`scripts/verify-ma5-s1-candidate.mjs`) | pass |

`npm test` regenerates `native/voice/bunny-voice-worker.json`; that file was restored and is not part of the
change.

## Hosted CI

Required checks on protected main (all in `ci.yml`):
- `typecheck, MA4/routing/sandbox-contract tests, UI tests, builds`;
- `static security checks`;
- `full MA3/MA4 regression (npm test)`.

The native workflows (`native-windows-preview.yml`, `native-android-preview.yml`) run on pull requests that touch
their paths. They are not required checks.

Intermediate head `394f4d1` (code complete, before these documents):

| Workflow / job | Run | Conclusion |
|---|---|---|
| ci / typecheck, MA4/routing/sandbox-contract tests, UI tests, builds | 40644157496 | success |
| ci / static security checks | 40644157496 | success |
| ci / full MA3/MA4 regression (npm test) | 40644157496 | in progress when this was written |
| Native Windows preview / Build WPF preview | 40644157467 | success |
| Native Android preview / Build native Android preview | 40644157461 | success |

**These runs do not cover the final PR commit.** This document is part of the final commit, so it cannot record
the CI runs of that same commit. The run IDs and conclusions for the exact final head are recorded in the PR #59
description and in the final report. S1-G18 is decided from those runs only.
