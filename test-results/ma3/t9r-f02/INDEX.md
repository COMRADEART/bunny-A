# T9R-F02 evidence index

- **Source commit:** `02a3c1d` (branch `claude/ma3-t9-phone-remote`; nothing pushed).
- **Report:** `MA3_T9R_F02_AUTHORIZATION_EDGE_CLOSURE.md` (repository root).
- **Seal:** `INDEX.sha256` lists the SHA-256 of every file here except the `windows-package/` binaries. Verify with `node test-results/ma3/t9r-f02/seal-evidence.mjs --verify`.

| File | What it shows |
|---|---|
| `baseline.md`, `baseline/` | starting point: F01 commits, baseline test logs, rewritten-test list |
| `file-classification-contract.md` | D1 classes, order of judgement, enforcement points, what is not claimed |
| `staging-ownership-contract.md` | D2 staging location, record fields, ownership, states |
| `staging-promotion-review.md` | D2 promotion checklist and the review shown to the workstation |
| `workstation-identity-audit.md` | D4 identity sources and impersonation attempts |
| `previous-review-findings.md` | F01 round-13 MEDIUMs and F01 §7 limitations: status after F02 |
| `adversarial-matrix.json` | E01–E55. Each row: initial conditions, operation, expected, observed, evidence type, supporting tests or live artifacts, PASS/FAIL. Derived from `full-test-results.log` and the live files. |
| `watcher-execution-boundary.json`, `scope-intersection-matrix.json`, `device-signout-invalidation.json`, `revocation-race-results.json`, `concurrent-admission-results.json`, `host-restart-recovery.json`, `provider-routing-authority.json` | topic views of the matrix rows |
| `one-time-approval-regression.json` | D3: the nine T9/T9R narrowed-consent tests (original requirement → new contract, rationale) |
| `changed-assertions-ledger.json` | every changed legacy assertion (F01 suite, T4 agent tests, later F02 updates) with rationale |
| `test-author-findings.json` | issues the test-writing agents raised, with dispositions |
| `independent-review.md` / `.json`, `review/` | §19 re-review: rounds 1–5, every finding with severity, reproduction, boundary, repair, regression, reviewer, verdict; raw round records; repair map |
| `live-staging-acceptance.json`, `live/` | §18 live acceptance (17 steps) on a real disposable Host |
| `full-test-results.log`, `regression-inventory.json` | full regression: 1,235 / 1,235 pass, 0 skipped |
| `typecheck.log`, `lint.log`, `build.log` | static checks and production build |
| `calculator-x53-regression.json`, `x53/`, `x53-stability.mjs` | T6 Calculator X53, 10/10 live |
| `windows-package-results.json`, `package-boot.mjs`, `package-runtime.log` | Windows package build and packaged-Host boot |
| `production-before.json`, `production-final.json`, `production-observe.mjs` | read-only observation of installed v26 (unchanged) |
| `secret-scan.json`, `secret-scan.mjs` | no credentials in the evidence |
| `assemble-evidence.mjs`, `seal-evidence.mjs` | generators for the derived JSON and the seal |
