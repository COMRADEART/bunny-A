# T13.1 regression / package / evidence tooling — reuse map for T13.2

Repo: C:/Users/allam/Documents/new/bun-router, branch claude/ma3-t9-phone-remote, HEAD e449456.
T13.1 accepted source aa134f5efb6748f21ec9a5fe4eae83f4c2d8d86f (parent c8c46c9). T13.1 evidence commits 7f1c921 + e449456.
Read-only investigation. The only command executed against the repo was `node test-results/ma3/t13-1/seal-evidence.mjs --verify`,
which only reads -> `{"result":"PASS","checked":107,"sourceCommit":"aa134f5..."}` (the seal still holds after e449456).

All paths below are relative to the repo root unless absolute.

---------------------------------------------------------------------------------------------------------------------------
## 1. End-to-end pipeline T13.1 ran (order reconstructed from file mtimes, local time UTC-4, 2026-10-12/13)

| Time | Step | Command (exact where recorded; INFERRED where the log does not carry it) | Output |
|---|---|---|---|
| 23:52-23:57 | lane scripts written | screenshot-host.mjs, shots.mjs, key-form-probe.mjs | — |
| 23:59 | counting tooling | count-regression.mjs, baseline-retention-map.json (`[]`) | — |
| 00:05 | pin + worktree | `node test-results/ma3/t13-1/pin-source.mjs aa134f5efb6748f21ec9a5fe4eae83f4c2d8d86f C:/Users/allam/.codex/worktrees/t131-final-checks/bun-router` (worktree path recorded in source-provenance.json / regression-final/source.txt) | source-provenance.json (00:35, re-pinned after c8c46c9 superseded; later hand-augmented) |
| 00:35:21Z+ | complete regression | `node test-results/ma3/t13-1/run-regression.mjs C:/Users/allam/.codex/worktrees/t131-final-checks/bun-router regression-final` run from the MAIN checkout, stdout tee'd by PowerShell into `regression-run.log` (UTF-16LE, so it shows as spaced text) | regression-final/{pretest,scripts,library,agent,ui,typecheck,lint,build}.log, exits.txt, source.txt (00:52:41) |
| 00:52:47 | count | `node test-results/ma3/t13-1/count-regression.mjs test-results/ma3/t13-1/regression-final aa134f5efb6748f21ec9a5fe4eae83f4c2d8d86f` | regression-summary.json, regression-inventory.json |
| 00:53:35 | eval | `node --experimental-strip-types test-results/ma3/t13-1/run-evaluation.mts` (T13.1-specific Jev/Laya eval) | eval/* |
| 00:53:55-00:55:01 | package build | `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/package-bunny-desktop.ps1 ...` (prefix recorded at package-build.log:4; args INFERRED from the manifest: `-PackageName Bunny-A-Windows-MA3-T13-1-TEST -TestVersion 0.0.0-ma3-t13.1.1 -SourceCommit aa134f5... -ToolingCommit aa134f5... -OutputDirectory test-results/ma3/t13-1/windows-package`), output redirected `*>` to package-build.log | windows-package/Bunny-A-Windows-MA3-T13-1-TEST{,/,.zip,.zip.sha256}; build dir test-results/bunny-release-build-20261013-005355{,-tooling} left behind |
| 00:54:38 | manifest copy | copy `<pkg>/release-manifest.json` -> package-release-manifest.json | |
| 00:55:30-36 | re-run checks to log (the .ps1 pipes them to Out-Null) | `node scripts/bunny-release.mjs verify <pkg>` > package-verify.log; `... closure <pkg>` > package-closure.log; `... source-check . <pkg>` > package-source-check.log | |
| 00:57:58 | production before | `node test-results/ma3/t13-1/production/production-observe.mjs test-results/ma3/t13-1/production/production-before.json` | |
| 00:57:58-00:58:56 | package acceptance | `node test-results/ma3/t13-1/package-acceptance.mjs` (spawns package-host.mjs with packaged node.exe, package-preview.mjs, shots.mjs package) | package-acceptance.json/.log, shots-package.json, shots/ai-models-package-*.png |
| 00:59:14 | production after | same observe -> production-after.json | |
| 00:59:23 | hand-assembled | production/production-comparison.json and package-results.json (NO script produced either) | |
| 01:01-01:02 | dev screenshot lane | `node --experimental-strip-types test-results/ma3/t13-1/screenshot-host.mjs saved` + dashboard dev server on 127.0.0.1:8093 with `BUNNY_HOST_CREDENTIALS_FILE=%TEMP%\bunny-t131-screenshot-host\credentials.json` (dev-server command NOT recorded; INFERRED `node scripts/with-app-env.mjs node node_modules/vite/bin/vite.js dev --host 127.0.0.1 --port 8093`) + `node test-results/ma3/t13-1/shots.mjs saved`, `node test-results/ma3/t13-1/key-form-probe.mjs`; then phase `fresh` | shots-saved.json, key-form-probe.json, shots-fresh.json, screenshot-host.json, screenshots-record.json (hand-written) |
| 01:05 | scan + seal | `node test-results/ma3/t13-1/secret-scan.mjs`; `node test-results/ma3/t13-1/seal-evidence.mjs --write`; `--verify` | secret-scan.json (77 scanned / 0 findings), INDEX.md, INDEX.sha256 |
| commit | evidence | test-results/ is gitignored (.gitignore:8 `test-results/`), so evidence was force-added (`git add -f`). 107 files tracked under test-results/ma3/t13-1 (106 sealed artifacts there + INDEX.sha256) | 7f1c921, then e449456 re-ran secret-scan + seal --write after report edits |

---------------------------------------------------------------------------------------------------------------------------
## 2. Regression tooling

### 2.1 pin-source.mjs (test-results/ma3/t13-1/pin-source.mjs)
Usage (l.5): `node test-results/ma3/t13-1/pin-source.mjs <sourceCommit> <worktreePath>`.
- l.10 `root = resolve(import.meta.dirname, "../../..")` — must run from the main checkout copy.
- l.14 `git worktree add --detach <worktree> <commit>`.
- Staged ignored inputs (never committed), l.15-19:
  - l.15 `cmd.exe /c mklink /J <wt>/node_modules <root>/node_modules` (junction).
  - l.16 `cpSync(native/voice/vendor -> wt)` recursive (whisper runtime DLLs, models, whisper-src-v1.9.4 headers, whisper-bin-b5130). Needed by `build:voice` (whisper shim compile) and 7 whisper tests.
  - l.17 copies `native/bunny-owned-process.node` + `.node.json` (pretest rebuilds it anyway with MSYS2 gcc `C:\msys64\ucrt64\bin\gcc.exe` — scripts/build-owned-process.mjs:10 — and writes only if the hash differs; the copy is a safety net).
  - l.18-19 `releases/installed/JEV-Windows-v1/runtime/LICENSE` (READ from the repo's releases/ folder, not %LOCALAPPDATA%). Needed because scripts/bunny-release.test.mjs:58 runs `package-bunny-desktop.ps1 -SkipDashboardBuild -NoArchive` inside the worktree, and package-bunny-desktop.ps1:176-179 falls back to `<repo>/releases/installed/JEV-Windows-v1/runtime/LICENSE` when the node install dir has no LICENSE; otherwise it throws "Node runtime license unavailable".
- l.20 HARD-CODED diff base `426357ac...` (T13 evidence) for `sourceFiles`.
- l.21-31 writes source-provenance.json next to itself; HARD-CODED fields `t13Evidence`, `t13Source` (8145377), `preservedUnrelated` text.
- The committed source-provenance.json was later hand-augmented (implementationCommits, supersedes, concrete regressionRoot path) — the script does not emit those.
- Does NOT remove the worktree. It was removed after the run (dir C:/Users/allam/.codex/worktrees/t131-final-checks/ is now empty; `git worktree list` shows only the main checkout and an unrelated f04-baseline-wt). CAUTION for T13.2: delete the junction first (`cmd /c rmdir <wt>\node_modules`) before `git worktree remove --force`, otherwise a recursive delete can follow the junction into the main node_modules.
- Lesson recorded in regression-aborted-archive-attempt/NOT_COUNTED.md: a `git archive` checkout fails 8 environmental tests (1 release test needs a real git repository, 7 whisper tests need native/voice/vendor) — hence worktree, not archive.

### 2.2 run-regression.mjs (test-results/ma3/t13-1/run-regression.mjs)
Usage (l.3): `node test-results/ma3/t13-1/run-regression.mjs <repoRoot> [outName]` (outName default `regression-final`).
- l.9 output dir = `<this script's dir>/<outName>` (so logs land in the main checkout evidence folder even though tests run in the worktree).
- l.11-13 guard: `git rev-parse HEAD` in repoRoot must equal `source-provenance.json.sourceCommit` (read from the script's own dir) else throws "Worktree is at X, not the pinned Y".
- l.14-15 source.txt records commit, root and "clean tracked tree at start" (`git status --porcelain --untracked-files=no`).
- l.17-19 splits `package.json scripts.test` on `" && "` into 3 parts named `scripts`, `library`, `agent` (`names` array; a 4th part would be `part4`).
- l.21-28 `run(name, command)`: `spawnSync(command, {shell:true, cwd: root, maxBuffer 512MB, env FORCE_COLOR=0})`, writes `<name>.log` (stdout+stderr), appends `<name> exit=<status> ms=<elapsed>` to exits.txt.
- l.29-34 order: `npm run pretest`, the 3 test parts, `npm run test:ui`, `npm run typecheck`, `npm run lint`, `npm run build`.
- Side effect: `npm run build` in the worktree writes `node_modules/.nitro/last-build.json` THROUGH the junction into the main node_modules (package-bunny-desktop.ps1:45-46,214 saves/restores that file; run-regression does not).
- Parameterized; only the comment header and the provenance-file lookup are T13.1-local. Copy unchanged.

package.json facts the runner depends on:
- `pretest`: `npm run build:ownership && npm run build:voice` (needs MSYS2 gcc + .NET Framework csc + staged whisper headers/runtime).
- `test` part 1 `node --test --test-concurrency=1 scripts/*.test.mjs` (glob).
- part 2 (library) is an EXPLICIT file list for src/lib/bunny-host/*.test.ts (plus globs for src/lib/orch/*.test.ts, src/lib/bunny-host/voice/*.test.ts, src/lib/bunny-missions/*.test.ts). A new `src/lib/bunny-host/<x>.test.ts` for T13.2 MUST be appended to this list or it is silently not run. T13.1 added intelligence.test.ts and intelligence-host.test.ts there.
- part 3 (agent) `--test-force-exit` explicit list of agent-*.test.ts + personal-agents-team.test.ts.
- `test:ui`: `node --experimental-strip-types --test src/components/island/*.test.ts` (glob — new UI tests are picked up automatically).
- Working-tree package.json has an UNSTAGED user change (`test:session-evidence`) that must not be committed; the worktree at the pin does not carry it.

### 2.3 count-regression.mjs (test-results/ma3/t13-1/count-regression.mjs)
Usage (l.3): `node test-results/ma3/t13-1/count-regression.mjs <runFolder> <sourceCommit>` (40-hex required, l.10).
How counts are derived:
- l.11 `PARTS = ["scripts","library","agent","ui"]`.
- l.17-21 for each `<part>.log`, exactly one line each of `ℹ tests N`, `ℹ pass N`, `ℹ fail N`, `ℹ cancelled N`, `ℹ skipped N`, `ℹ todo N` (node:test spec reporter summary) — else throws.
- l.22 case names = lines matching `/^\s*✔ (.+?) \([\d.]+m?s\)$/` (minus ones starting `▶ `).
- l.23-24 suite names = `/^\s*▶ (.+)$/`; passing lines whose name equals a suite name are dropped (describe blocks also print ✔).
- l.25 the number of case lines must equal `ℹ tests` for that part.
- l.27 inventory row `{suite: part, test: name, result: "PASS"}`.
- l.31 distinct key = `${part}:${testName}`. l.60 result FAIL if `distinct.size !== total` — i.e. two tests with the SAME NAME in the same part (even in different files) fail the gate. T13.2 test names must be unique per part.
- l.30 a part is bad if any fail/cancelled/skipped/todo or pass != tests.
Baseline mapping:
- l.32 HARD-CODED baseline `../t13/regression-inventory.json` (T13: sourceCommit 8145377, distinctSuiteNames 2264).
- l.33 `baseline-retention-map.json` = array of `{suite, from, to}` renames.
- l.36-41 every baseline `{suite,test}` must exist exactly in the new run, or via a map entry whose `to` exists; else `baselineMissing`.
- l.42 replacements must be one-to-one (`to` unique).
- l.43 `baselineParts` per-part baseline counts.
- l.53 `newDistinct = distinct - (baselineDistinct - missing)`; l.54 `newCases` = new rows not in baseline and not a replacement target.
- l.55-58 `baselineRetained`, `baselineRetainedExact`, `baselineRevised`, `baselineMissing`.
- l.60 PASS needs: no bad part, no missing, distinct == total, every exits.txt line `exit=0`.
- l.62-63 writes regression-summary.json and regression-inventory.json INTO the script's dir (`{sourceCommit, baselineDistinctTests, total, distinctSuiteNames, parts, tests[]}`).
- l.65 exit 1 unless PASS.
T13.2 adaptation: change l.32 to `../t13-1/regression-inventory.json` (sourceCommit aa134f5, 2322 distinct) and the l.10 message; otherwise identical (diff vs t13 copy is only the baseline path, `baselineParts`, `newCases`).

### 2.4 T13.1 counted results (regression-summary.json)
- sourceCommit aa134f5; runFolder test-results/ma3/t13-1/regression-final; result PASS.
- Baseline (T13, 8145377): scripts 440 / library 1408 / agent 58 / ui 358 = 2264.
- T13.1: scripts 440 / library 1462 / agent 58 / ui 362 = **2322 total = 2322 distinct**; npmTestTotal 1960 (total minus ui); every part 0 fail / 0 cancelled / 0 skipped / 0 todo.
- baselineRetained 2264, baselineRetainedExact 2264, baselineRevised [], baselineMissing []; baseline-retention-map.json = `[]`.
- newDistinct 58 = 54 library (K01-K20, R01-R20, R04b, R13b, RV-B1..B4, RV-S1/S2/S3/S6/S7, R07/R16, K04/K20, K05/K06, "T13.1 contract ...") + 4 ui ("T13.1 UI: ...").
- Library log summary also prints `ℹ suites 16` (suites are not counted).
- Lint: `✖ 27 problems (0 errors, 27 warnings)` — same 27 warnings as the T13 baseline (the acceptance claims parity; T13.2 should hold 0 errors / <=27 warnings).
- Timings (exits.txt / regression-summary.exits): pretest 3,060 ms; scripts 207,626 ms (3.5 min); library 619,243 ms (10.3 min); agent 185,414 ms (3.1 min); ui 919 ms; typecheck 11,057 ms; lint 9,615 ms; build 4,857 ms. Total 1,041,791 ms ≈ **17.4 min** wall (sequential).
- NOT COUNTED folders kept with NOT_COUNTED.md: regression-superseded-c8c46c9/ (library 1450/1451; F04 R3-BYPASS-CWD-1 failed because jev-secrets.server.ts launched powershell.exe by bare name), regression-aborted-archive-attempt/ (git-archive checkout), dev-runs/ (focused runs, UTF-16 PowerShell redirects).

---------------------------------------------------------------------------------------------------------------------------
## 3. Evidence sealing / scanning

### 3.1 seal-evidence.mjs
Usage: `node test-results/ma3/t13-1/seal-evidence.mjs --write | --verify`.
- l.11 HARD-CODED `allowedRootFiles = {"MA3_T13_1_LAYA_JEV_INTEGRATION_ACCEPTANCE.md"}` (the only file outside the folder allowed in the seal).
- l.12 sourceCommit read from regression-summary.json (so count-regression must run first).
- l.13-17 `checked(rel)`: refuses any path outside the evidence dir except allowedRootFiles.
- l.19-26 `--verify`: parses `^([0-9a-f]{64})  (.+)$` lines (two spaces, sha256sum format), re-hashes, prints `{"result":"PASS","checked":N,sourceCommit}`.
- l.29-37 `--write` walk: skips dirs matching `/^(?:windows-package|source-checkout$|node_modules$|temp$|tmp-)/`; skips names matching `/credentials|\.sqlite(?:-|$)|\.wav$/i`; includes only `.md .mjs .mts .ps1 .json .jsonl .log .txt .png`; excludes INDEX.md/INDEX.sha256 themselves.
- INDEX.md format (l.41-57): `# MA3 T13.1 retained evidence index`, "Final executable source: <sha>. The local evidence commit is separate.", seal statement, a HARD-CODED T13.1 paragraph (evidence categories LIVE VERIFIED / SIMULATED / STATIC VERIFIED / NOT TESTED; fixture-key, no TypeSafe, no Laya, package exclusion, production untouched), "Verify from the repository with node test-results/ma3/t13-1/seal-evidence.mjs --verify.", `Retained artifacts: N.`, then one `- [<repo-relative path>](<path relative to evidence dir>)` per artifact, sorted.
- INDEX.sha256 (l.58-59): `<sha256>  <repo-relative path>` for every artifact plus INDEX.md, sorted, trailing newline. T13.1: 106 artifacts + INDEX.md = 107 lines.
- Adapt for T13.2: allowedRootFiles (new acceptance report name), the INDEX header paragraph, the comment/usage path. Logic unchanged.

### 3.2 secret-scan.mjs
Usage: `node test-results/ma3/t13-1/secret-scan.mjs` (no args). Writes secret-scan.json `{scanned, patterns, findings, details[{file,line,pattern}]}`; never prints the matched value; exit 1 on any finding.
- PATTERNS (l.9-20): bearer-header `Bearer\s+[A-Za-z0-9._~+/-]{20,}`; json-token-field (`token|accessToken|refreshToken|secret|password|apiKey|api_key` with a >=16-char value); openai-style-key `\bsk-[A-Za-z0-9_-]{20,}`; typesafe-style-key `\bts[-_](?!FIXTURE)[A-Za-z0-9]{24,}`; github-token; google-api-key; slack-token; aws-access-key; private-key-block; dpapi-blob `[DPAPI ciphertext prefix omitted from retained research]`.
- l.21-24 user email matched only by SHA-256 constant `1855e3bb...35dc` (the file never contains the address).
- l.26-33 walk: same dir exclusions as the seal; skips files >= 20 MB and `.exe .dll .node .bin .wav .png .jpg .zip`.
- l.35-36 HARD-CODED report `MA3_T13_1_LAYA_JEV_INTEGRATION_ACCEPTANCE.md`.
- T13.1 result: scanned 77, findings 0.
- T13.2 NOTE: the openai-style-key pattern has NO FIXTURE exemption. An ANTHROPIC/OpenAI fixture such as `sk-ant-FIXTURE...` or `sk-FIXTURE...` in tests' evidence output will be flagged. Add a negative lookahead like the TypeSafe one (`\bsk-(?!(?:ant-)?FIXTURE)...`) or use fixtures that avoid the `sk-` prefix; consider adding an `anthropic-key` pattern (`\bsk-ant-[A-Za-z0-9_-]{20,}`) since T13.2 is about ANTHROPIC_API_KEY handling. Run order: secret-scan BEFORE seal --write (secret-scan.json is itself sealed).

---------------------------------------------------------------------------------------------------------------------------
## 4. Windows TEST package

### 4.1 scripts/package-bunny-desktop.ps1 (214 lines)
Params l.1-15: `-PackageName`, `-TestVersion`, `-SourceCommit`, `-ToolingCommit` (default 'HEAD'), `-Repository` (default repo), `-OutputDirectory` (default `<repo>/releases`), `-SkipDashboardBuild`, `-NoArchive`.
- l.33-36 tooling SHA resolved; reads `install/release-pin.json` AT the tooling commit; PackageName/SourceCommit default to the pin (release-pin.json currently Bunny-A-Windows-v26-MA2-R1 / 8001d51 — so an explicit `-SourceCommit` is mandatory for a T13.2 test package).
- l.37-41 name `^[A-Za-z0-9-]+$`; `-TestVersion` requires name ending `-TEST` and version `^\d+\.\d+\.\d+-[A-Za-z0-9.-]+$`. History: T13 used 0.0.0-ma3-t13.1 (Bunny-A-Windows-MA3-T13-FINAL-TEST), T13.1 used 0.0.0-ma3-t13.1.1 (Bunny-A-Windows-MA3-T13-1-TEST). Suggest `Bunny-A-Windows-MA3-T13-2-TEST` / `0.0.0-ma3-t13.2.1`.
- l.47-50 build dir `test-results/bunny-release-build-<yyyyMMdd-HHmmss>` (+`-tooling`); package dir must NOT already exist ("Package exists. Use a new name").
- l.22-32 `Export-Commit`: `git -c core.autocrlf=false archive --format=tar` + `%WINDIR%\System32\tar.exe -xf` (exact committed bytes, so working-tree edits cannot leak in).
- l.51-53 tooling files from ToolingCommit: install/Start-Bunny-Release.ps1, Bunny-Release-Info.ps1, Bunny-State.ps1, release-pin.json, scripts/migrate-bunny-state.ps1, bunny-state-migration.mjs, install-bunny-release.ps1 (+ bunny-rollback-preflight.mjs if present).
- l.64-71 node_modules junction into the build dir, `JEV_DESKTOP_BUILD=1`, `npm run build --prefix <build>`.
- l.75-80 native ownership module rebuilt from the pinned C source (origin `generated`).
- l.83-116 voice worker compiled from pinned .cs; whisper runtime DLLs/model/headers copied from the workspace's staged `native/voice/vendor` after SHA-256 check against `native/voice/whisper-pin.json` (throws "Whisper runtime is not staged ... run scripts/stage-whisper.mjs first").
- l.120-138 pinned whisper runtime + shim added as origin `vendor`.
- l.139-154 `.output`, install/* launchers, characters art, tunnel scripts, tooling files.
- l.156-162 **Host import-graph folders: only `src/lib/bunny-host`, `src/lib/orch`, `src/lib/bunny-missions`** (all non-test .ts, recursive). If T13.2 puts the Connection Registry / adapters anywhere else under src/lib (e.g. src/lib/connections/), the package closure check fails AND scripts/desktop-install.test.mjs:28-50 ("MA1: the desktop package copies every source folder the native Host imports") fails. Either keep new Host code under src/lib/bunny-host/ or add the folder to this list (the test parses this exact `foreach($directory in @(...))` line).
- l.165-169 playwright browser runtime via scripts/package-browser-runtime.mjs.
- l.171-179 package.json `{"type":"module"}`, `runtime/node.exe` copied from `Get-Command node` (v24.18.0), LICENSE fallback.
- l.181-197 `.release-build.json` record (release, version, sourceCommit, toolingCommit, build, compatibility {stateLayoutVersion 2, databaseSchemaVersion 3, ...}, origins).
- l.198-203 `bunny-release.mjs manifest`, then `verify`, `closure`, `source-check <repo> <pkg>` (outputs piped to Out-Null — hence T13.1 re-ran them to logs).
- l.204-212 Compress-Archive (3 attempts) + `<zip>.sha256` file; l.214 restores node_modules/.nitro/last-build.json.
- Build dirs are NOT cleaned (test-results/bunny-release-build-20261013-005355 from T13.1 still present; it contains a node_modules junction — do not `rm -rf` it naively).
- Timing T13.1: ~66 s from build-dir creation (00:53:55) to log close (00:55:01) incl. vite client+ssr build (~18 s client) and 180 MB zip.

### 4.2 scripts/bunny-release.mjs (170 lines) — CLI and exported functions
- `node scripts/bunny-release.mjs manifest <release>` -> `writeManifest` (l.50-66): reads/deletes `.release-build.json`, classifies every file via `origin()` (l.34-40; unclassified throws), writes `release-manifest.json` schema `bunny-release-manifest/1` with `dashboard.assetManifestSha256` and `compatibility.hostSchemaUserVersion = hostSchemaVersion()` (l.43-48: max `user_version = N` in packaged src/lib/bunny-host/persistence.server.ts — a T13.2 schema bump shows up here).
- `verify <release>` -> `verifyRelease` (l.68-76): extra/missing/changed vs manifest. T13.1: 482 checked, 0/0/0.
- `closure <release>` -> `importClosure` (l.86-143): walks static/side-effect/dynamic imports from `ENTRY_POINTS = ["Bunny-Host.mjs","scripts/bunny-tunnel.mjs"]` (l.16); `node:` ignored; any bare npm specifier fails unless dynamic and in `OPTIONAL_PACKAGES = ["playwright"]` (l.84); relative imports must stay inside the release (`outside`). Adds native ownership files (l.111-115), voice worker (l.117-121), whisper pin files (l.124-136), playwright files for cross-app (l.138-141). T13.1: 126 files, 0 missing, 0 outside, optional [playwright]. T13.2 must not add a non-optional npm import to Host code.
- `source-check <repo> <release>` -> `sourceCheck` (l.146-158): every `source`/`tooling` origin file must equal `git cat-file blob <commit>:<repoPath>` byte-for-byte. T13.1: 172 checked, 0 mismatched.

### 4.3 scripts/package-desktop.ps1 (42 lines) — legacy, DO NOT use for T13.2
Old JEV-Windows packager: copies the WORKING TREE (`git ls-files --cached --others --exclude-standard`), downloads the Node LICENSE from GitHub, no source pin, no manifest/closure/source-check. Not used by T13/T13.1.

### 4.4 package-results.json (hand-assembled, T13.1)
release Bunny-A-Windows-MA3-T13-1-TEST, version 0.0.0-ma3-t13.1.1, source/tooling aa134f5, archive path test-results/ma3/t13-1/windows-package/Bunny-A-Windows-MA3-T13-1-TEST.zip, 179,661,566 bytes, sha256 04e5f27f...b1c96f; verification.files {ok, checked 482, extra 0, missing 0, changed 0}; closure {ok, files 126, missing 0, outside 0, optionalPackages [playwright]}; source {ok, checked 172, mismatched 0}; disposableHostAcceptance {PASS, 12/12, typesafeCalls 0}; installed false; published false. Package folder/zip are excluded from the seal (windows-package/ skipped) and pinned only by this file.

---------------------------------------------------------------------------------------------------------------------------
## 5. Disposable-Host acceptance tooling

### 5.1 package-host.mjs (generic)
Usage: `<package>/runtime/node.exe package-host.mjs <packageRoot> <scratch> <port>`; refuses port <=1024, 43119, 8084 (l.12); deletes BUNNY_STATE_LAYOUT, BUNNY_RELEASE_ROOT, BUNNY_HOST_WORKSPACE, BUNNY_HOST_DATA_DIRECTORY, BUNNY_HOST_PORT (l.13); imports the PACKAGED `src/lib/bunny-host/entry.server.ts` and calls `runHostEntry({dataDirectory, root, workspaceRoot, port})` (l.18-19) with development layout; writes `<scratch>/credentials.json` {token, port} and host.json {pid, node, version, entry}; stops when `<scratch>/close` appears. Reusable unchanged.

### 5.2 package-preview.mjs
Loads packaged `.output/server/index.mjs` `middleware` into a node:http server on 127.0.0.1:8081; requires BUNNY_HOST_CREDENTIALS_FILE (read by src/lib/orch/host-bridge.server.ts:66-70 `hostCredentials()`). HARD-CODED package dir name (l.8). Adapt name only.

### 5.3 package-acceptance.mjs (T13.1-specific checks, reusable skeleton)
Usage: `node test-results/ma3/t13-1/package-acceptance.mjs`. HARD-CODED: package path (l.16), scratch `%TEMP%\bunny-t131-package-host` (l.18), port 43892 (l.19), FIXTURE_KEY (l.20). Spawns the packaged node.exe on package-host.mjs (l.33); polls /state until Laya probed/offline (l.53); HTTP helpers `command(action,data,bearer)` POST /command and `state(bearer)` GET /state (l.43-52); pairs a phone via `pairing.create` + POST /pair (l.67-70) to test phone projection (P07) and default-deny `WORKSTATION_REQUIRED` (P08); starts package-preview and runs `shots.mjs package` with `T131_BASE=http://127.0.0.1:8081`, `PLAYWRIGHT_BROWSERS_PATH=%LOCALAPPDATA%\ms-playwright` (l.77-84); at rest scans every state file + process output for the key (P11) and opens `<scratch>/state/host.sqlite` read-only to assert `SELECT COUNT(*) FROM jev_usage` = 0 (P12). Writes package-acceptance.json `{classification, package, layoutNote, typesafeCalls, checks[{id,ok,detail}], result}`. Runtime ~1 min. For T13.2 keep the skeleton (P01 packaged runtime, phone pairing, at-rest scan, sqlite read-only counts) and replace P02-P12 with Connected Accounts checks (redacted phone view, no credential handle in any Agent/phone projection, ambient ANTHROPIC_API_KEY not switching modes, jev_usage retention). Note: P11 must also scan for any fixture env key injected into the spawned Host env.

### 5.4 screenshot-host.mjs (dev-source disposable Host)
Usage: `node --experimental-strip-types test-results/ma3/t13-1/screenshot-host.mjs <fresh|saved>`. Imports repo `startHost` from src/lib/bunny-host/http.server.ts (l.11); port 43891; scratch `%TEMP%\bunny-t131-screenshot-host`; `host.manager.discover?.()`; phase `saved` performs `intelligence.credential.save` + `intelligence.configure` with a fixture policy; writes screenshot-host.json; stop via `test-results/ma3/t13-1/close` file. T13.1-specific phases; adapt.

### 5.5 shots.mjs
Usage: `node test-results/ma3/t13-1/shots.mjs <phase>`; base `T131_BASE` env (default http://127.0.0.1:8093). Playwright chromium headless; sizes desktop 1366x900 and phone 390x844 (isMobile/hasTouch); themes light only for `fresh`, light+dark otherwise; navigates `/?view=settings&theme=<t>`, clicks nav "Settings groups" -> button "AI & Models", focuses first tab and ArrowRight through TABS `["connections","routing","privacy"]`; per render records scrollWidth vs innerWidth (overflowX), focusedTab, aria-selected, `[role=tabpanel][aria-labelledby]`, key in DOM / local+sessionStorage, console + pageerror; screenshots `test-results/ma3/t13-1/shots/ai-models-<phase>-<tab>-<device>-<theme>.png`; report `shots-<phase>.json`. Paths resolved relative to CWD = repo root. HARD-CODED output dir, tab list, fixture key. For T13.2 add a "Connected Accounts" tab/section to TABS and change the output paths/env name.

### 5.6 key-form-probe.mjs, run-evaluation.mts — T13.1-only (TypeSafe key form; Jev/Laya evaluation). Not reusable except as patterns.

---------------------------------------------------------------------------------------------------------------------------
## 6. Production observation (read-only)
production/production-observe.mjs — copied unchanged T9R-F03 -> T10 -> T11 -> T12 -> T13 -> T13.1 (header l.1-4). Usage: `node test-results/ma3/t13-1/production/production-observe.mjs <out.json>` (comment says `--experimental-strip-types`, not needed).
- Reads `%LOCALAPPDATA%\Bunny-A\install.json`; opens `<dataDirectory>/host.sqlite` with `DatabaseSync(..., {readOnly:true})`; per table row count + sha256 of JSON rows (no row content).
- Release folder manifest: file count + sha of sorted `path:sha` list.
- `netstat -ano -p TCP` LISTENING on 8084/43119, PIDs, `Get-Process` Id/ProcessName/StartTime.
- Startup shortcut exists; audio receipt (mic privacy registry reads + AudioEndpoint list sha).
- Comparison (production-comparison.json) was HAND-ASSEMBLED: fields classification, before/after timestamps, installedRelease {before, after, unchanged}, installJsonUnchanged, releaseManifestUnchanged, listenersUnchanged, processesUnchanged, startupShortcutUnchanged, audioUnchanged, tablesWithChangedRows ["events","providers","sqlite_sequence"] + tableNote (running Host's own activity), discrepancy note (installed = Bunny-A-Windows-MA3-T13-FINAL-TEST from 8145377, not MA2-R1; 478 manifest files; listeners 43119 PID 13924, 8084 PID 19896). A small compare script would make T13.2 reproducible.

---------------------------------------------------------------------------------------------------------------------------
## 7. Parameterized vs hard-coded (copy plan to test-results/ma3/t13-2/)

| File | Parameterized | Hard-coded to t13-1 / T13.1 | T13.2 action |
|---|---|---|---|
| run-regression.mjs | repoRoot, outName; provenance from own dir | comments only | copy as-is |
| count-regression.mjs | runFolder, sourceCommit | baseline `../t13/regression-inventory.json` (l.32), message (l.10) | baseline -> `../t13-1/regression-inventory.json` (aa134f5, 2322: 440/1462/58/362) |
| baseline-retention-map.json | data | `[]` | start `[]`; add `{suite,from,to}` only for genuinely renamed T13.1 tests (e.g. if R06 cross-vendor wording changes when limitation 7 is closed) |
| pin-source.mjs | sourceCommit, worktreePath | diff base 426357a (l.20), t13Evidence/t13Source fields, preservedUnrelated text | diff base -> e449456 (T13.1 evidence) or aa134f5; rename fields t131Evidence/t131Source |
| seal-evidence.mjs | --write/--verify | allowedRootFiles report name (l.11), INDEX header text (l.42-52) | new report name + T13.2 categories text |
| secret-scan.mjs | none | report name (l.35) | new report name; add sk-/sk-ant- FIXTURE exemption + anthropic pattern |
| package-host.mjs | packageRoot, scratch, port | none | copy as-is |
| package-preview.mjs | creds env | package dir name (l.8) | rename |
| package-acceptance.mjs | none | package path, scratch, port 43892, fixture, P02-P12 checks, shots count 12 | rewrite checks; keep skeleton |
| screenshot-host.mjs | phase | port 43891, scratch, T13.1 flows | rewrite phases for Connected Accounts |
| shots.mjs | phase, T131_BASE | out dir, TABS, fixture key | adapt tabs + env name |
| production/production-observe.mjs | out path | none | copy as-is |
| package-results.json, production-comparison.json, source-provenance.json extras, screenshots-record.json | — | hand-written | re-author |
| scripts/package-bunny-desktop.ps1, scripts/bunny-release.mjs | fully | — | use as-is with `-SourceCommit <T13.2 pin> -ToolingCommit <same> -PackageName Bunny-A-Windows-MA3-T13-2-TEST -TestVersion 0.0.0-ma3-t13.2.1 -OutputDirectory test-results/ma3/t13-2/windows-package` |

## 8. Prerequisites checklist on this PC (all present for T13.1)
- node v24.18.0 on PATH (packaged as runtime/node.exe); npm (emits harmless `Unknown env config "devdir"` warnings).
- MSYS2 gcc at C:\msys64\ucrt64\bin\gcc.exe (or BUNNY_NATIVE_CC) for build:ownership and whisper shim.
- .NET Framework csc.exe C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe + System.Speech for build:voice.
- Staged native/voice/vendor (runtime/*.dll pinned in native/voice/whisper-pin.json, models/ggml-base.en.bin, whisper-src-v1.9.4 headers) via scripts/stage-whisper.mjs.
- releases/installed/JEV-Windows-v1/runtime/LICENSE (read-only copy source).
- Playwright browsers at %LOCALAPPDATA%\ms-playwright.
- Disposable ports used: 43891 (dev screenshot Host), 43892 (package Host), 8093 (dev dashboard), 8081 (package preview). Production 43119 / 8084 never touched.
