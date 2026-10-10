# T9R-F04 harness map (read-only, HEAD 9e64719, source b693167)

No files were edited and no processes were started or stopped. Production v26 was not touched. Lines not directly read are marked as inferred.

## 1. Test harness

**package.json scripts** (`package.json`)
- `build:ownership`: `node scripts/build-owned-process.mjs`
- `pretest`: runs `build:ownership` before every `npm test`.
- `test`: three chained runs.
  1. `node --test --test-concurrency=1 scripts/*.test.mjs` (256 tests).
  2. `node --experimental-strip-types --test ... src/lib/app-data/*.test.ts ... src/lib/bunny-host/*.test.ts ... src/lib/bunny-missions/*.test.ts`. This is the explicit file list, which includes `owned-process-group.test.ts`, `stop-ownership.test.ts`, `git-helpers-ownership.test.ts` and `failure.test.ts`. It gives 884 tests.
  3. `node --experimental-strip-types --test --test-force-exit --test-concurrency=1 src/lib/bunny-host/agent-runtime.test.ts src/lib/bunny-host/agent-recovery.test.ts` (24 tests).
- `test:ui`: `node --experimental-strip-types --test src/components/island/*.test.ts` (99 tests).
- `typecheck`: `tsc --noEmit`. `lint`: `eslint .`. `build`: vite build then `db:migrate`.
- `dev` / `preview:restart` use `scripts/with-app-env.mjs`. Do not start Vite directly.

**How the 1,263 is counted**
- `full-test-results.log` contains four `ℹ tests / pass / fail / ... ` summary blocks: 256 (line 280), 884 (line 1282), 24 (line 1316) and 99 (line 1430). The log is the concatenated output of the `npm test` and `npm run test:ui` runs.
- `assemble-evidence.mjs` counts the ✔ and ✖ result lines itself and derives the matrix from them.
- `regression-inventory.json` records the four suites with `noDoubleCounting` ("disjoint files") and the total of 1,263, 0 fail, 0 skipped.
- The `floor` field in that JSON is 1,235, which is the F02 floor, and `floorMet` is true. F03 added 28 tests (`f03NewTests.count`).

**Native helper tests**
- `src/lib/bunny-host/owned-process-group.test.ts`: about 13 tests, most gated `{skip: !windows}`. Examples include argv/env (line 31), native rejection of foreign PIDs (line 42), job-closing on hook failure (line 57), and `CREATE_BREAKAWAY_FROM_JOB` refused (line 84).
- `scripts/owned-process-build.test.mjs:7`: builds twice in independent directories and checks reproducibility. It skips on non-Windows.
- `src/lib/bunny-host/stop-ownership.test.ts:9` and `:14`: real TaskManager Stop, and PID identity.
- `src/lib/bunny-host/git-helpers-ownership.test.ts:22-36`: argv, editor refusal, and ssh, credential and gpg helper descendants owned by the job.

**Native build** (`scripts/build-owned-process.mjs`)
- Uses `C:\msys64\ucrt64\bin\gcc.exe` by default, or `BUNNY_NATIVE_CC` if set.
- Flags: `-std=c11 -O2 -Wall -Wextra -Werror -shared -s -static-libgcc`, with image-base and nxcompat/dynamicbase link flags.
- Writes `native/bunny-owned-process.node` and `.node.json` (`bunny-native-build/1`, with source and binary SHA-256).
- **MSYS2 check:** `/c/msys64/ucrt64/bin/gcc.exe` exists (3.3 MB, dated May 17).

## 2. spawnSession and test injection

**Production code** (`src/lib/bunny-host/adapters.server.ts`)
- Signature: line 193. Last parameter is `spawnChild: typeof spawn = spawn`.
- Child creation: line 208, `child = trackOwnedChild(spawnChild(launch.command, ...))`.
- Termination: `terminate()` uses `taskkill.exe /PID <pid> /T /F` (inside `spawnSession`, before line 210).
- Callers: lines 306, 326 (Codex, via `owned = spawnSession(...)`) and 375 (Claude). The Codex call at 306 has no executionScope or mission.
- Plain `execFile` at line 87 is wrapped in `trackOwnedChild`.
- `owned-processes.server.ts`: `trackOwnedChild` (line 11), `execOwnedFile` (line 20), `stopOwnedChildren` (line 34).

**Tests that call spawnSession directly** (`src/lib/bunny-host/failure.test.ts`)
- Line 433: T3 stdout hook throw. Real `spawn` through `process.execPath`.
- Line 477: T3 normalization throw. Real spawn.
- Line 513: T3 native stream error, the only test that passes a custom `spawnChild`. The wrapper is at lines 524-530. It emits a stream error on the first stdout data.
- Line 536: unexpected-exit test. Real spawn.

**Tests that mock adapter launch without injecting spawnChild**
- These use `launchTarget = { command: process.execPath, args: [script] }` with fixture scripts. Examples are `execution-scope.test.ts:43` and `:137`. They run real child processes.
- Other files that exercise adapters: `agent-recovery`, `agent-runtime`, `codex-compatibility`, `host`, `m2`, `ma2-t10`, `project-workspace`, `provider-usage`, `remote-device`, `remote-remediation`, `routing*`, `t3-manager`, and in missions `agentic-authorization`, `approval-batches`, `f02-*`, `f03-hardening`, `missions`, `remote-authority`.
- Conclusion: only one test (`failure.test.ts:513`) passes a custom `spawnChild`. For F04, the job-containment check should run through real `spawnSession` with a real `node` fixture, and need not depend on fake spawn.
- Survivor tracking is `manager.server.ts:1714` (`watchSurvivors`). Its 15 s sampling is at lines 1694 and 1889. `remote-authority.test.ts:1296-1301` calls it directly with PID 4242.

## 3. Live acceptance (17/17)

**Harness:** `test-results/ma3/t9r-f03/live/live-staging-acceptance.test.ts`. Run it from the repo root:
```
node --experimental-strip-types --test test-results/ma3/t9r-f03/live/live-staging-acceptance.test.ts
```
- Writes `test-results/ma3/t9r-f03/live-staging-acceptance.json`. Verified: 17 steps, `result: PASS`, `hostEpoch` b2a66f56-950e-4daa-82b1-6358d71478d6.
- Disposable Host: `mkdtempSync(join(tmpdir(), "bunny-f02-live-"))` (line 34). Port comes from `createServer().listen(0)` on loopback (lines 39-41).
- `startHost({dataDirectory, root, workspaceRoot, port, adapters: [], missions: {adapters: [new FilesystemCapability()]}, sample})` at line 43. `adapters: []` means no provider CLI is launched, so this does not exercise spawnSession.
- Only instrumentation: `missions.missionPauseGate` is replaced in step 15 (lines 169-177).
- Base URL `http://127.0.0.1:${port}`. Real pairing and bearer auth are used, with no mocked authorization.
- Identity source: `manager.instanceId` is the epoch. `http.server.ts:310` builds `hostIdentity`. `/health` (line 397) returns `instanceId` and containment `snapshot()`.
- Note: the `live/` folder contains only this `.test.ts`. The JSON result is one level up. The sealing script treats `live/` as text.

## 4. Evidence pipeline

- **INDEX.md** (22 lines): lists each file. It names `seal-evidence.mjs --verify-staged` as the verification command.
- **assemble-evidence.mjs**: `node test-results/ma3/t9r-f03/assemble-evidence.mjs`. Regenerates `finding-matrix.json` and `regression-inventory.json` from `full-test-results.log` and the live JSON. Results come only from ✔/✖ lines and evidence files.
- **seal-evidence.mjs**:
  - Seal: `node test-results/ma3/t9r-f03/seal-evidence.mjs`. Writes `INDEX.sha256` over all files except `windows-package*` directories. It also seals the report `MA3_T9R_F03_CONSUMER_CLASSIFICATION_HARDENING.md` at the repo root.
  - Verify: `--verify` uses the working copy. `--verify-staged` reads `git show :<path>` (the index).
- **secret-scan.mjs**: `node --experimental-strip-types test-results/ma3/t9r-f03/secret-scan.mjs`. Writes `secret-scan.json`. Scans text extensions under the evidence folder and excludes `windows-package*`. Reported 0 findings.
- **production-observe.mjs**: `node --experimental-strip-types test-results/ma3/t9r-f03/production-observe.mjs <out.json>`. Read-only. Reads `%LOCALAPPDATA%\Bunny-A\install.json`, opens `host.sqlite` with `node:sqlite`, and records table counts and SHA-256s, the release manifest hash, listeners and processes.
  - `production-before.json` and `production-final.json` both report release `Bunny-A-Windows-v26-MA2-R1`, manifest `81f83786…` (161 files), listeners 127.0.0.1:8084 (PID 23016) and 127.0.0.1:43119 (PID 13672), 25 tables, and the same counts. Example: `tasks` 62 rows, `approval_batches` 19. Unchanged.
- **x53-stability.mjs**: `node --experimental-strip-types test-results/ma3/t9r-f03/x53-stability.mjs`. Drives Calculator via PowerShell tools in `test-results/ma3/t9r/`. Output in `x53/`. Verified 10 runs.

## 5. Windows package

- **Build script:** `scripts/package-bunny-desktop.ps1`. Parameters:
  - `-PackageName` (must match `-TEST$` for test packages)
  - `-TestVersion` (format `\d+\.\d+\.\d+-…`)
  - `-SourceCommit`, `-ToolingCommit` (default HEAD), `-Repository`, `-OutputDirectory`
  - `-SkipDashboardBuild` (tests only)
  - `-NoArchive`
  - The exact invocation used for F03 is not recorded in the log. Inferred from the parameters: `-PackageName Bunny-A-Windows-MA3-T9R-F03-TEST -TestVersion 1.0.0-MA3-T9R-F03-TEST -SourceCommit b6931677… -SkipDashboardBuild`, with output in `test-results/ma3/t9r-f03/windows-package`.
- **Native bytes into the manifest:**
  - Line 75-80: if `native/bunny-owned-process.c` exists, the script runs `node scripts/build-owned-process.mjs $bunnyBuild`. It then adds `.c`, `README.md` and the build script as `source`. It adds `.node` and `.node.json` as `generated`, with no repo path.
  - Line 126: sets `compatibility.gitProcessOwnershipPolicyVersion = 1` when the `.c` exists.
  - Line 130: `bunny-release.mjs manifest` writes `release-manifest.json` (SHA-256 per file, origin, bytes).
  - `scripts/bunny-release.mjs:112`: the closure check adds the four native files to the required list when `owned-process-group.server.ts` is in the import graph.
  - `src/lib/bunny-host/owned-process-group.server.ts:30` loads `native/bunny-owned-process.node`. Line 40 checks `gitProcessOwnershipPolicyVersion !== 1`.
- **Results:** `windows-package-results.json` reports `PASS`, manifest 358 files with no missing or changed entries, closure OK, and `sourceCommit`/`toolingCommit` b693167. `windows-package-release-manifest.json` is the copy of `release-manifest.json`.
- **Packaged boot:** `package-boot.mjs` checks the manifest and closure, then starts `runtime/node.exe` on the packaged `Bunny-Host.mjs` with a disposable state directory. Its log is `package-runtime.log` ("Bunny-A Host ready on loopback"). I did not read the whole script.

## 6. The F03 report

`MA3_T9R_F03_CONSUMER_CLASSIFICATION_HARDENING.md` sections:
1. Scope and result (line 10)
2. What changed, source b693167 (line 25)
3. Verification (line 62). Includes a checks table: 1,263 regression, typecheck/lint/build, live 17/17, finding matrix 19/19, X53 10/10, package and boot, production unchanged, secret scan 0.
4. Process containment reassessment (line 77). Says provider sessions are not job-contained and recommends a dedicated gate.
5. Open items (line 89). Includes the containment deferral (MEDIUM), D1 residual, and phone/LAN/internet NOT TESTED.
6. Evidence index (line 101).

Production preservation: `production-observe.mjs` before and after, compared in `production-before.json` and `production-final.json`. Both show the same release, manifest hash, listener PIDs and table counts.

## 7. Commands to run each harness

From `C:\Users\allam\Documents\new\bun-router`, using Git Bash:
- Build native helper: `npm run build:ownership`
- Full suite: `npm test` (runs `pretest` first)
- UI tests: `npm run test:ui`
- Typecheck and lint: `npm run typecheck`, `npm run lint`
- Live acceptance: `node --experimental-strip-types --test test-results/ma3/t9r-f03/live/live-staging-acceptance.test.ts`
- Single native-ownership suite: `node --experimental-strip-types --test src/lib/bunny-host/owned-process-group.test.ts`
- Provider-session failure tests: `node --experimental-strip-types --test src/lib/bunny-host/failure.test.ts`
- Rebuild evidence: `node test-results/ma3/t9r-f03/assemble-evidence.mjs`, then `node test-results/ma3/t9r-f03/seal-evidence.mjs`
- Verify seal: `node test-results/ma3/t9r-f03/seal-evidence.mjs --verify-staged`
- Secret scan: `node --experimental-strip-types test-results/ma3/t9r-f03/secret-scan.mjs`
- Read-only production check: `node --experimental-strip-types test-results/ma3/t9r-f03/production-observe.mjs <out.json>`
- Windows package: `powershell -File scripts/package-bunny-desktop.ps1 -PackageName <name>-TEST -TestVersion <x.y.z-tag> -SourceCommit <sha> -OutputDirectory <dir> -SkipDashboardBuild`. Check the parameter set against the script before running; this was not executed.
- Packaged boot: `node --experimental-strip-types test-results/ma3/t9r-f03/package-boot.mjs` (inferred from its header; not executed).

## Caveats for F04

- `terminate()` in `adapters.server.ts` still uses `taskkill /T /F` and the survivor sampler, so F04 changes both the spawn path and the stop path.
- `spawnChild` is the only injection seam, and only `failure.test.ts:513` uses it. Adding a job-based spawn helper would need its own seam or the real-process fixture pattern.
- The live acceptance uses `adapters: []`, so it does not cover provider-session containment. An F04 live check would need a provider-session fixture or the x53 path.