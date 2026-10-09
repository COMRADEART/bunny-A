# T9R evidence index

Final executable source: `395d1c0a246d8f2b0c85c236e11a9a0437ad6456` (branch `claude/ma3-t9-phone-remote`). Report: `MA3_T9R_REMEDIATION_ACCEPTANCE.md` (repository root). Verdict: `BUNNY_MA3_T9R_PASS_WITH_LIMITATIONS`.

## Required files

| File | Content |
|---|---|
| `baseline.md` | Protected starting state, ancestry, protected files, production observation start |
| `baseline-failure.md` | Unchanged X53 failure reproduced (minimized owned target) before repair |
| `root-cause-analysis.md` | Native root cause and preserved stability failures with causes |
| `source-diff-analysis.md` | Per-commit source delta `0a5988c` → `395d1c0` |
| `calculator-uia-tree-safe.json` | Before / minimized-failure / after UIA trees (structure only) |
| `calculator-target-identity.json` | Signed package, AppUserModelID, owned ledger, per-run identities, native adversarial validators |
| `calculator-readiness-results.json` | Live readiness receipts and bounded adapter boundary tests |
| `x53-full-reacceptance.json` | Unchanged original X53 in the final complete regression (receipts in `x53-final-run/`) |
| `x53-stability-matrix.json` | 10/10 consecutive clean on `395d1c0`, plus every prior attempt with its cause |
| `process-ownership-verification.json` | IR-H1 / owned-process test results and exact-HWND Calculator ownership |
| `remote-security-matrix.json` | §9 scenarios and T9R fixes, mapped to real-admission tests and records (`remote-canonical/`) |
| `phone-offline-replay.json` | Offline approval replay and phone-only network loss |
| `revocation-live-sse.json` | Revocation of live SSE and revocation ending device grants |
| `multi-device-race.json` | 2-way and 4-way races, plus the live gateway race |
| `host-restart-recovery.json` | In-process restart test and OS-process restart (`protocol/host-restart-recovery.json`) |
| `physical-phone-results.json` | NOT TESTED, with blocker (`device-inventory.json`) |
| `network-validation.json` | Loopback TLS LIVE; LAN and internet NOT TESTED |
| `t9r-adversarial-matrix.json` | Four review rounds (raw output in `review/`), with dispositions |
| `complete-test-inventory.json` | 1,070 tests = 1,043 accepted + 27 new; 0 prior names missing |
| `complete-regression.log` / `ui-regression.log` | Final committed source runs |
| `typecheck.log` / `lint.log` / `build.log` | Final source gates |
| `windows-package-results.json` | Disposable T9R test package validation and boot (`windows-package-release-manifest.json`) |
| `production-final.json` | Read-only production before/after (`production-before.json`, `production-after.json`, `production-change-attribution.txt`) |
| `limitations.md` | NOT TESTED items, owner policy decisions, residual LOW findings |
| `secret-scan.json` | Static and exact-value secret scan |
| `INDEX.sha256` | SHA-256 seal of this evidence (package binaries excluded) |

## Supporting material

- **Live fixtures:** `protocol/` (final build) and `continuity/` (phone-only network on the final build; UI closure on the ea48c40 build).
- **Preserved earlier runs:** `protocol-ea48c40/`, `protocol-attempt-order/` (out-of-order run), `protocol-first-source/`, `stability-ea48c40/`, `stability-attempt-*`, `windows-package-*-ea48c40.*`, and `prelim/`.
- **`prelim/`** holds preliminary regressions for `ea48c40`, `b345aa3` and `0904132`, plus copies of the sealed T5–T7 evidence files that test runs rewrote. Those files were restored to their sealed versions in Git.
- **`review/`** holds the four adversarial workflows and the DEV-01 pre-fix reproduction.
- **Scripts** (`assemble-evidence.mjs`, `build-matrix.mjs`, `secret-scan.mjs`, `stability.mjs`, `network-acceptance.mjs`, `package-boot.mjs`, `audit.mjs`, `seal-evidence.mjs`) regenerate every derived file from the raw artifacts.
