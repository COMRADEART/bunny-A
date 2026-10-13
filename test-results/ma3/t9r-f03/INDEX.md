# T9R-F03 evidence index

- **Source pin:** `b693167` (branch `claude/ma3-t9-phone-remote`; nothing pushed).
- **Report:** `MA3_T9R_F03_CONSUMER_CLASSIFICATION_HARDENING.md` (repository root).
- **Seal:** `INDEX.sha256` lists every file here except the `windows-package/` binaries. Verify the committed copy with `node test-results/ma3/t9r-f03/seal-evidence.mjs --verify-staged`. A fresh checkout may convert line endings, which affects `--verify` on the working copy.

| File | What it shows |
|---|---|
| `baseline.md` | starting point (F02 `e08edb0`), scope, floor 1,235 |
| `consumer-classification-contract.md` | the D1 consumer scan after F03: consumers, reference forms, content rules, fail-closed cases, backstop scope, documented residuals |
| `containment-reassessment.md` | process containment: what is contained, the precise residual, why it is not repaired here, the recommended gate |
| `changed-assertions-ledger.json` | changed legacy assertions (F01-R6, F01-R27) with original requirement and rationale |
| `independent-review.md`, `review/` | review summary; `round1.json` (4 lenses + skeptics), `round2.md` (2 reviewers), `round3.md` (scoped verification) |
| `finding-matrix.json` | each F02 round-5 item and F03 review finding mapped to passing tests and live artifacts (derived from the logs) |
| `full-test-results.log`, `regression-inventory.json` | full regression on `b693167`: 1,263 / 1,263, 0 skipped |
| `typecheck.log`, `lint.log`, `build.log` | static checks and production build |
| `live-staging-acceptance.json`, `live/` | F02 §18 live acceptance re-run on the F03 source (17/17) |
| `x53/`, `x53-stability.mjs` | T6 Calculator X53, 10/10 live |
| `windows-package-results.json`, `windows-package-release-manifest.json`, `windows-package-build.log`, `package-boot.mjs`, `package-runtime.log` | Windows package build and packaged-Host boot |
| `production-before.json`, `production-final.json`, `production-observe.mjs` | read-only observation of installed v26 (unchanged) |
| `secret-scan.json`, `secret-scan.mjs` | no credentials in the evidence |
| `assemble-evidence.mjs`, `seal-evidence.mjs` | generators |
