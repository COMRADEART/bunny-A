# T9R-F04 evidence index

- **Source pin:** `43ffee8` (branch `claude/ma3-t9-phone-remote`; nothing pushed).
- **Report:** `MA3_T9R_F04_PROVIDER_PROCESS_CONTAINMENT.md` (repository root).
- **Seal:** `INDEX.sha256` lists every file here except the `windows-package/` binaries (not committed, as in F03), plus the report. Verify the committed copy with `node test-results/ma3/t9r-f04/seal-evidence.mjs --verify-staged`. A fresh checkout may convert line endings, which affects `--verify` on the working copy.
- **Results are derived, not hand-asserted:** `assemble-evidence.mjs` builds `adversarial-matrix.json`, `regression-inventory.json`, `attempt-history.json` and the focused `*-results.json` files from the logs and live JSON. A missing source yields NOT TESTED or FAIL, never PASS.
- **Failed attempts are retained.** Every failed attempt is in `attempt-history.json`, with its diagnosis.

| File | What it shows |
|---|---|
| `baseline.md`, `baseline/` | starting point (F03 `b693167`/`9e64719`): 1,263/1,263 reproduced in an isolated worktree, plus the production snapshot |
| `discovery/` | launch-path, manager, harness and Windows API discovery before the change |
| `process-launch-inventory.md` | every process launch: contained, Host-owned, or out of contract |
| `process-ownership-threat-model.md` | threat model and claimed boundary |
| `windows-job-api-contract.md` | Job Object API contract: creation, JOB_LIST admission, membership check, accounting |
| `native-helper-design.md`, `job-handle-lifecycle.md` | helper design; handle owner, access, lifetime and crash behaviour |
| `provider-compatibility-matrix.json` | each provider path: owner, containment, termination provability |
| `nested-job-validation.json`, `nested-job-validation.mjs`, `nested-wrapper-output/` | nested-job topologies: none, plain, silent, limit1 (fail closed); no-parent NOT TESTED |
| `job-admission-results.json`, `child-inheritance-results.json`, `breakaway-test-results.json`, `process-identity-results.json`, `stop-termination-results.json`, `abrupt-host-exit-results.json`, `helper-crash-results.json`, `host-restart-recovery.json`, `process-isolation-results.json`, `provider-fallback-results.json`, `authorization-regression.json` | focused projections of the matrix, tests and live rounds |
| `adversarial-matrix.json` | J01–J60, 60/60 PASS (derived) |
| `stability-matrix.json`, `attempt-history.json` | live rounds, X53, nested jobs, concurrency, helper failure, and every attempt, including failed ones |
| `live-containment-acceptance.json`, `live-containment-run.log`, `live/` | final live acceptance on `43ffee8`: 30/30, with the per-round restart outcome |
| `calculator-x53-results.json`, `x53/`, `x53-stability.mjs` | X53 10/10 (`x53/x53-stability-matrix.json`, `x53/stability/`); attempts 1–3 (user's Chrome took the foreground) and 4 (stale ledger) retained; close-by-identity receipts; the full-suite timeout diagnosis |
| `independent-security-review.md`, `review/` | review rounds 1–6 (`round*.json`), the F03 follow-up and its four verification rounds (`f03-followup*.json`), the regression audit (`f03-regression-audit/`), and the final-live attempt-1 diagnosis. The `pre-*` files come from runs before the source was frozen. `pre-final-regression.log` was stopped before completion and is not used as evidence. |
| `full-regression.log`, `full-regression-attempt1.log`, `regression-inventory.json` | full regression on `43ffee8`: 1,295/1,295 (attempt 2). Attempt 1: 1,270/1,271 (X53 timeout from desktop contention); the agent suite did not run. |
| `typecheck.log`, `lint.log`, `build.log` | static checks and production build on `43ffee8` |
| `windows-package-results.json`, `windows-package-release-manifest.json`, `windows-package-build.log`, `package-boot.mjs`, `package-runtime.log` | `Bunny-A-Windows-MA3-T9R-F04-TEST`: build, packaged boot, packaged contained provider session (J60) |
| `production-before.json`, `production-final.json`, `production-comparison.json`, `production-observe.mjs` | read-only observation of installed v26; every table difference is attributed to production's own `provider.status_changed` events |
| `secret-scan.json`, `secret-scan.mjs` | static secret scan of this folder |
| `assemble-evidence.mjs`, `seal-evidence.mjs` | derivation and seal scripts |
