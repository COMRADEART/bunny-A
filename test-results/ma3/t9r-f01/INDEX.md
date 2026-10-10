# T9R-F01 evidence index

Source `aacf398`; closure document `MA3_T9R_F01_SECURITY_CLOSURE.md`; seal `INDEX.sha256` (`node test-results/ma3/t9r-f01/seal-evidence.mjs --verify`).

| Path | Content |
|---|---|
| `regression/` | Full regression on `aacf398`: npm test (1,049), UI tests (99), typecheck, lint, build, `source.txt` |
| `x53/`, `x53-stability.log`, `x53-stability.mjs` | 10/10 live X53 runs (cold/warm/minimized) with owned-target ledger copy and per-run receipts |
| `review/` | 13 independent review rounds: workflow journals and two-skeptic verdicts (`round*-verified.json`) |
| `audit/` | Indirect-pathway audit journal |
| `prelim/` | Copies of sealed T5/T6 files rewritten by intermediate test runs (originals restored each time) |
| `production-before.json`, `production-after.json`, `production-observe.mjs`, `production-change-attribution.txt` | Read-only production v26 observation and attribution |
| `secret-scan.json`, `secret-scan.mjs` | Static secret scan (552 files, 0 findings) |
| `seal-evidence.mjs`, `INDEX.sha256` | Seal tooling and seal |
