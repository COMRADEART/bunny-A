# MA4-S1R3 release qualification — R3-G11 … R3-G14 (Phase H)

All local results come from the isolated worktree `bun-router-s1r3`: its own `npm ci`, native ownership module built from source with MinGW, and the pinned whisper runtime staged from the operator's already-fetched artifacts and verified by `stage-whisper.mjs` (ignored; not committed). Evidence is in `evidence/`.

| Check | Command | Result | Evidence |
|---|---|---|---|
| Full regression | `npm test` (the exact `package.json` command) | **2,216 passed, 0 failed, 1 skipped**: scripts 450/450, core 1,638/1,638, agent team 58/58, MA4 70 + 1 skipped (unauthorized cloud-live, by design) | `regression.log` |
| MA4 suite | part of the above (`test:ma4`, now with `ma4-repair.test.ts`) | 70 passed / 1 skipped (S1R2: 58 / 1) | `regression.log` |
| Sandbox adversarial (live WSL2) | `ma4-sandbox.test.ts` | 13/13, incl. new F5 seccomp; F5 fails against the previous launcher | `sandbox-adversarial.log`, `sandbox-f5-negative-control.log` |
| Routing policy | `routing*.test.ts` (in the core stage, and a separate CI step) | pass | `regression.log` |
| UI | `npm run test:ui` | **406/406** | `ui.log` |
| Typecheck | `npm run typecheck` | pass | — |
| Mobile-web build | `npm run build` | pass | `build-mobile-web.log` |
| Desktop build | `JEV_DESKTOP_BUILD=1 npm run build` | pass | `build-desktop.log` |
| Dependency audit | `npm audit --omit=dev --audit-level=high`; `npm audit` | 0 / 0 | `npm-audit-*.log` |
| Windows release tests under an 8.3 TEMP | see WINDOWS_CI_REMEDIATION.md | 7/7 failing before the fix, pass after | `ci-*.log` |

## H3 — MA3 compatibility and evidence hygiene

* No MA3 product code changed. The movable-notch UX and island tests (`scripts/island-notch.test.mjs`, …) pass within the 450/450 scripts stage.
* `npm test` no longer rewrites tracked historical evidence. `git status --short test-results` showed **0** changed files before and after the full regression (S1R2: 32). Writers now go through `evidenceDir()`, and deliberate regeneration uses `BUNNY_TEST_EVIDENCE_DIR=test-results`.
* Build-time regenerated files (`native/voice/bunny-voice-worker.{exe,json}` from `pretest`, `src/routeTree.gen.ts` line endings from `build`) were not committed.

## Hosted CI (branch push, run 39672749567 at `3724349`)

| Job | Result |
|---|---|
| static security checks | **success** |
| typecheck, MA4/routing/sandbox-contract tests, UI tests, builds | **success** |
| full MA3/MA4 regression (`npm test`) | see ENGINEERING_REPORT.md (final hosted status recorded there) |

Hosted runners have no WSL2 user namespaces, so the live sandbox/workflow fixtures report `SKIPPED (not passed)` there. Local success is not counted as hosted success.

## H1 — Windows installed application: **NOT TESTED**

The owner's installed Bunny A must not be overwritten without approval, and production deployment is not authorized. The release-packaging, launcher and installer tests (M-A-1D, MA2 T1) pass locally against disposable fixtures, including under an 8.3 temp root. That is fixture-level evidence, not installed-app qualification. Startup, Ollama connection, model selection and pins, agent status, streaming, cancellation, timeout labels, failure messages and recovery in a temporary installation remain a manual gate.

## H2 — Mobile

The shared mobile-web build passes, and the UI tests include the mobile layouts. **Physical Android and iOS: NOT TESTED.** Desktop-browser emulation is not claimed as device qualification.
