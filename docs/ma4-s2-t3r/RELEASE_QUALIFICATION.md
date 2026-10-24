# MA4-S2-T3R — Release qualification (Phase K)

Local results at `eb253a7` (2026-10-24 ~04:40 UTC), fresh worktree with the two git-ignored prerequisites staged from the
owner's checkout (whisper runtime, Node runtime notice); voice worker binaries restored after `pretest`.

| Suite | Command | Result |
|---|---|---|
| Typecheck | `npx tsc --noEmit -p .` | pass |
| Full MA3/MA4 regression (includes voice, connected actions, persistence/restart, WSL2 sandbox and seccomp contract, security and authorization suites) | `npm run pretest && npm test` | **2,404 tests: 2,403 pass, 0 fail, 1 skipped** (opt-in live free-model contract, never run without permission) |
| UI unit tests and MA4 suite incl. T3R (12 new T3R tests, 3 new form tests) | part of `npm test` above | 0 fail |
| Goal / schedule / monitor UI, Approval Center, accessibility (real browser) | `scripts/ma4-s2t3r/ui-evidence.mjs` | 45/45, 0 console errors |
| Windows notch | installed notch smoke + placement | pass (`INSTALLED_WINDOWS_QUALIFICATION.md`) |
| Mobile companion | physical phone round 2 | pass (`PHYSICAL_ANDROID_QUALIFICATION.md`) |
| Real pinned model | `scripts/ma4-s2t3r/model-smoke.mjs` | 10/10 |
| Mobile-web build | `npm run build` | pass |
| Desktop build | `JEV_DESKTOP_BUILD=1 npm run build` | pass |
| Release package | `scripts/package-bunny-desktop.ps1` (closure, verify, source-check) | pass (`S2T3R4-TEST`) |
| Dependency audit | `npm audit --omit=dev --audit-level=high` | 0 vulnerabilities |
| Hosted CI (final head) | GitHub Actions on the draft PR | see `ENGINEERING_REPORT.md` |

Logs of the run are in `test-results/t3r-*.log` (not committed); the Codex run's logs are in `evidence/release/`.

Known hosted-only flake carried from the base: `provider-containment.test.ts` F04 R1-BYPASS-1 python `ETIMEDOUT` (cold
Python start beyond the product's 10 s verification bound). Not loosened; if it recurs in final-head CI it is reported, not
suppressed.
