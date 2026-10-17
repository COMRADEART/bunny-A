# T13 final full-suite report

Full pipeline: **PASS, exit 0**. Executed unchanged source `b23005136c48036968036475e841dcf67a38a794` on branch `ma3-t13-product` in an isolated validation checkout. The evidence-only commit does not change executable source.

| Pipeline lane | Tests | Passed | Failed | Skipped |
|---|---:|---:|---:|---:|
| scripts | 450 | 450 | 0 | 0 |
| library | 1637 | 1637 | 0 | 0 |
| agent runtime | 58 | 58 | 0 | 0 |
| Total within npm test | 2145 | 2145 | 0 | 0 |

Separate UI suite: 405/405, exit 0; not added to the npm-test pipeline count. OAuth PKCE's eight tests are included once in the library lane. No assertions changed, tests skipped, failures suppressed, or npm-test flags changed.

## Prior file-write investigation

The preserved source record `test-results/ma3/t13-final-hw/ACCEPTANCE.md` identifies the failure as the test declared at `src/lib/bunny-host/remote-remediation.test.ts:391` (cross-Project artifact). Its receipt call is at line 410; `record()` at lines 20–23 resolves a fixed historical evidence directory and calls `writeFileSync(join(directory, name + '.json'), JSON.stringify(value, null, 2) + '\n')`. The default open mode is `w` (create/truncate).

Affected absolute path: `C:\Users\allam\Documents\new\bun-router\test-results\ma3\t9r\remote-canonical\cross-project-artifact.json`.

The retained record quotes `UNKNOWN ... open cross-project-artifact.json`; it does not retain the full original stderr or an OS handle trace. This session therefore does **not** claim a proven lock owner, stale handle, concurrency event, permissions failure, or exact Windows errno. The current file has Archive attributes, not ReadOnly. Its starting dirty content was hashed and preserved.

Evidence of a shared-fixture hazard is direct: every invocation uses the same receipt path, overwrites historical records and can collide with another run. Within the configured full pipeline test-file concurrency is already 1; that does not isolate separate processes or external readers. The independently passing historical 15-test rerun is not full-suite evidence.

This session reproduced the actual test inside the complete pipeline against independent source/receipt files. The historical open error did not recur. No production or test code repair was justified by the available evidence. The operational isolation remedy is the separate validation checkout, not an asserted filesystem-root-cause fix. A future recurrence should retain the full stderr and capture Windows file-I/O/handle telemetry during the failing run before assigning a cause.

## Attempts and reproducibility

First command: `node test-results/ma3/t13-gate-closure/run-gates.mjs test` → actual nested `npm test` **exit 1**; script lane 449/450. Error: `Node runtime license unavailable; package must not ship without it.`, `scripts/bunny-release.test.mjs:44`, assertion at :59. The library/runtime chain did not execute in that attempt. Full output: `test.log`; receipt: `test-result.json`.

Preparation initially omitted the ignored local runtime LICENSE. It was copied byte-for-byte into the validation checkout at the packaging script's existing fallback path; hash and correction are in `environment-correction.json`. No source fix was made for this setup error.

Final command: `node test-results/ma3/t13-gate-closure/run-gates.mjs test test-final` → actual nested `npm test`, **exit 0**, 1077015 ms, 2026-10-17T21:54:04.628Z to 2026-10-17T22:12:01.644Z. Full output: `test-final.log`; receipt and log SHA-256: `test-final-result.json`.

Reproduce in a fresh evidence directory using `run-gates.mjs prepare`, which clones the starting Git source, links existing installed npm dependencies, copies the pinned ignored voice runtime/model/headers and local Node license, then runs the unchanged `npm test`. Runtime: v24.18.0, npm 11.16.0, Windows x64. This is source-isolated, not a claim of a hermetic dependency installation. Compiler/native-worker provenance is emitted by pretest in the full log; generated worker binaries/manifests differ from historical builds because local source checkout line endings/toolchain are reflected in their hashes. They were not copied back or committed. Generated route-tree status has no semantic diff.

Additional commands: `npm run test:ui`, `npm run typecheck`, `npm run build`, `npm run check:auth` all exit 0. An initial unprivileged auth observation exited 2 because it could not read the dev server; the permitted rerun observed matching sign-in-off values. See `command-results.json` for exact commands and all exit codes. Build's migration hook reports DATABASE_URL unset and skips external migration.

All 66 original dirty/untracked entries retain their hashes: `workspace-before.json` and `workspace-preservation.json`. Fresh remote security receipts are copied only into `receipts/`.
