# Bunny-A M-A-1D Deployment Hardening

## Identity

| Item | Value |
|---|---|
| MA0_FREEZE_SHA | `180ab234b2e81e7745e7402c4eb9483586c36eab` (unchanged) |
| MA1_CODE_CANDIDATE | `f1934bda6b0d33f27bef198e8967a69f6eb329ff` (unchanged; the only production code in the release) |
| Deployment commit | `be6e2e56c627a8969b7ecc1c9d992737710d5c11` ("MA1D: pinned Bunny-A release, release launcher and installer"). It changes only `install/` and `scripts/` deployment tooling; `git diff --stat f1934bd be6e2e5 -- src` is empty |
| Branch HEAD | the documentation commit that adds this report and the review packet, above `be6e2e5` (`git rev-parse HEAD`) |
| Package | `Bunny-A-Windows-v16`, version `16.0.0`, `releases/Bunny-A-Windows-v16.zip` |
| Package sha256 | `f17023efd0cab2c0ed95ea6392d2a92fee7da1f4c9dcc2002ec5d3c314daae11` |
| Release manifest sha256 | `d22bc82eb4b5645c88570d8518ecff5de86d1f1831e70d407c93bcfcb0b8749c` |
| Date | 2026-10-03 (EDT) |
| Push / merge / history rewrite | none |

Evidence lives in `test-results/ma1d/`, which is git-ignored and local, the same convention as M-A-1. Paths below are relative to it.

## Original promotion blocker

The final M-A-1 review rated one deployment risk HIGH (`MA1_CLAUDE_FINAL_REVIEW.md`). The startup chain was:

`Bunny-A.lnk` → `<repo>\scripts\start-bunny-island.ps1` → `start-bunny-host.ps1` → `node <repo>\scripts\bunny-host.mjs`

**Code coupling.** The installed Host ran whatever was checked out, including uncommitted edits. The Island (`<repo>\install\Bunny-Island.ps1`) and the tunnel worker (`<repo>\scripts\bunny-tunnel.mjs`) also ran from the repo. The gateway package sat in `<repo>\releases\`. `main` (`ea0e803`) predates M-A-0, and `ma0-mission-architecture` contains the M-A-1 B1 BLOCKER code.

**Default task folder.** The Host's working directory, which is also the default task folder (`defaultRoot = process.cwd()`), was the repo itself. 33 of the 53 recorded tasks had run there.

## Pinned build procedure

`scripts/package-bunny-desktop.ps1`, as of be6e2e5, reads `install/release-pin.json` at the tooling commit: release `Bunny-A-Windows-v16`, source `f1934bd`. The build then runs in this order:

1. **Export source.** `git -c core.autocrlf=false archive f1934bd`, extracted with `tar`. Files keep their exact committed bytes; the working tree is never read for runtime files.
2. **Export tooling.** The release launcher, release-info tool and pin come from the tooling commit the same way.
3. **Build the dashboard.** The Vite/Nitro build (`JEV_DESKTOP_BUILD=1`) runs inside the exported tree. `node_modules` is linked from the build workspace; the native Host imports no npm packages.
4. **Assemble the package.**
   - From the f1934bd export: `install/*` runtime files, the tunnel worker (`scripts/bunny-tunnel*.mjs`), and every non-test `.ts` under `src/lib/{bunny-host,orch,bunny-missions}`.
   - `.output`.
   - `runtime/node.exe` (v24.18.0) and its licence.
5. **Write the manifest.** `scripts/bunny-release.mjs manifest` writes `release-manifest.json`: every file's sha256, size and origin (`source`, `tooling`, `build`, `runtime` or `generated`), source and tooling commits, build timestamp, Node version, package-lock sha256, and `hostSchemaUserVersion` (3).
6. **Gate the build.** The build fails unless all three checks pass:
   - `verify`: files on disk are exactly the manifest.
   - `closure`: every runtime import from `Bunny-Host.mjs` and the tunnel worker resolves inside the release, and no npm package is required. Only the guarded optional `playwright` is allowed.
   - `source-check`: each source file equals `git cat-file blob f1934bd:<path>` and each tooling file equals its blob at be6e2e5.
7. **Zip.** Zip with retry, and a `.zip.sha256` sidecar.

**Build results** (`build/package.log`, the manifest itself):
- built 2026-10-03T17:52:27Z;
- 134 files: 54 source, 3 tooling, 74 build, 2 runtime, 1 generated;
- `source-check` passed for 57 files, `verify` for 134, `closure` ok.

The v15 artifact was not reused.

## Installed runtime location

`C:\Users\allam\AppData\Local\Bunny-A\releases\Bunny-A-Windows-v16\`

- **No `.git`.** `git rev-parse` there reports "not a git repository", and the release-info `insideGitCheckout` is empty.
- **Read-only files.** All 135 files carry the read-only attribute.
- **Integrity checks.** The launcher refuses to start if any source, tooling or runtime file differs from the manifest. `Bunny-Release-Info.ps1` checks all files.
- **Module trace** (`install/module-trace-summary.json`). The installed release's Host ran with a resolve-hook trace, a fresh throwaway data folder and port 43229. It resolved 39 files, all inside the release, plus 11 `node:` built-ins, including all 22 Mission modules. Nothing came from outside the release, and nothing referenced the development repo.

## Release manifest

`<release>\release-manifest.json` (schema `bunny-release-manifest/1`) records:
- `release`, `version`, `sourceCommit` = f1934bd, `toolingCommit` = be6e2e5, `builtAt`;
- `build`: node, os, `dashboardBuild`, package-lock sha256;
- `compatibility`: `hostSchemaUserVersion` 3, host entry, launcher, default port;
- per-file sha256 and origin.

`install.json` records the package sha256 and the manifest sha256.

**How to read the running identity without Git.** `Bunny-Release-Info.ps1` reports:
- the Host's actual executable and command line, taken from the live process;
- whether both are inside this release;
- the manifest identity and an integrity result.

Host `/health` was not changed. That would have required editing f1934bd Host code, so the identity comes from process paths plus the manifest.

## Startup target before

`pre/shortcut-before.json`:
- target: `powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "C:\Users\allam\Documents\new\bun-router\scripts\start-bunny-island.ps1"`
- working directory: the repo
- shortcut sha256 `ACC7CD72…B225`

## Startup target after

`install/shortcut-after.json`, `final/release-info.json`:
- target: `powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "C:\Users\allam\AppData\Local\Bunny-A\releases\Bunny-A-Windows-v16\Start-Bunny-Release.ps1"`
- working directory: the release folder
- shortcut sha256 `9AB719AF…CBD1`

`Start-Bunny-Release.ps1` takes every path from `%LOCALAPPDATA%\Bunny-A\install.json` and the release folder. It starts:
- the Host on the release runtime (`<release>\runtime\node.exe <release>\Bunny-Host.mjs`), with data in `state\.bunny-a` and the workspace as working directory;
- the dashboard gateway, on the release runtime, from the package in `deployment.json`;
- the tunnel worker from `<release>\scripts\bunny-tunnel.mjs`;
- the Island from `<release>\Bunny-Island.ps1 -Root state`.

It refuses a gateway package that sits inside a Git checkout. It does not call npm, git, or anything under the development repo.

## Default task workspace before

The Host's working directory was the repo (`C:\Users\allam\Documents\new\bun-router`), so `defaultRoot` was the repo.

## Default task workspace after

The Host's working directory is `C:\Users\allam\Bunny-Workspace`. It is:
- outside the repo, the release folder and the install root;
- not inside any Git checkout (the installer refuses one);
- writable.

Proved live (`smoke/direct-final.json`): a direct task submitted with no project got `cwd = C:\Users\allam\Bunny-Workspace`.

**Effects of the change:**
- The release folder is never a default folder, project or workspace.
- Working on Bunny's own source now requires registering the repo as a project explicitly; nothing prevents doing that.
- Historical task records keep the folder they ran in.

## Checkout-independence test

Each restart stopped the Host after checking its identity (`/health` instanceId and PID against `credentials.json`, and no active jobs). It then started the Host again with `explorer.exe "<Startup>\Bunny-A.lnk"`, the same way logon does. Records are in `checkout/*/record.json` and `checkout/summary.json`.

| Step | Repository | Host PID after | Executable | Release / manifest | Integrity |
|---|---|---|---|---|---|
| baseline | `ma1-live-acceptance` be6e2e5, clean | 3128 | `…\Bunny-A-Windows-v16\runtime\node.exe` | v16 / `d22bc82e…`, source f1934bd | ok |
| `git switch main` | `main` ea0e803 (pre-M-A-0) | 15748 | same | same | ok |
| `git switch ma0-mission-architecture` | b04f479 (= MA0 freeze + one docs commit; its `adapters.server.ts` has **0** `CODEX_READ_DISABLED_FEATURES`, i.e. the B1 BLOCKER code) | 20152 | same | same (the installed release's `adapters.server.ts` has the fix) | ok |

In every case the restarted Host ran the identical installed release built from f1934bd. The process path stayed inside the pinned folder.

## Dirty-tree-independence test

**Probe.** On `ma1-live-acceptance` I appended probe code to the repo's `scripts/bunny-host.mjs` and `src/lib/bunny-host/http.server.ts`. Each probe writes a marker file to `C:\Users\allam\bunny-ma1d\markers\` when loaded.

**Production restart** (`checkout/3-dirty-tree/record.json`):
- Host PID 9984, same release runtime, entry, manifest and integrity;
- **no marker written**.

**Positive control.** Importing the dirty `http.server.ts` directly with Node wrote `DIRTY_HTTP_SERVER_LOADED.txt`, containing the control process's PID (18852, not the Host's). This proves the probe fires whenever that code loads.

**Restore.** The probe edits were reverted with `git checkout -- <2 files>`. `git status` now shows only the user's untracked `MA1_CLAUDE_FINAL_REVIEW.md`, which was preserved throughout. The user's branch, `ma1-live-acceptance`, is restored.

**Also covered by regression test.** `scripts/bunny-release.test.mjs` builds a release from a clone carrying uncommitted edits and an untracked file. No dirty bytes reach the package, and every source file equals its f1934bd blob.

## Package completeness test

| Check | Result | Evidence |
|---|---|---|
| Host starts from the installed package (not source) | PASS: Host 31836, later 3128 / 15748 / 20152 / 9984, all on `<release>\runtime\node.exe <release>\Bunny-Host.mjs` | `switch/release-info-after-switch.json`, `checkout/` |
| Mission modules load | PASS: 22 `bunny-missions` modules in the module trace; Mission smoke completed | `install/module-trace-summary.json`, `smoke/mission-final.json` |
| Persistence opens | PASS: `/state` 53 tasks, 13 projects; DB integrity ok | `completeness/host-state.json` |
| Provider discovery | PASS: Ollama 0.35.0 ready (local), Codex `codex-cli 0.153.4` ready, Claude `2.1.288` ready | `completeness/host-state.json` |
| Dashboard connects | PASS: `http://127.0.0.1:8084/` desktop 1440×900 and phone 390×844 load with status 200; 0 console errors, 0 page errors, 0 failed requests, no horizontal overflow; shows "3 agents ready", "Completed 28". Screenshots inspected | `completeness/dashboard.json`, `dashboard-*.png` |
| Island connects | PASS: the Island window "Bunny Island" (launcher PID 42796, release launcher) reads via UI Automation "Bunny idle", Codex/Claude/Ollama "ready", "Reported 10/3/2026 2:04 PM" (after the restarts) | `completeness/island-uia-text.txt` |
| Direct task mode | PASS (below) | `smoke/` |
| Missions feature state preserved | PASS: `enabled:false` before, after the switch, and after the Mission smoke (config JSON identical) | `pre/db-state-live.json`, `final/db-state-final.json` |

**Direct task smoke.**
- Task `b3857d9a-4baf-494f-bee9-2f091ad811c4`, prompt "Reply with exactly this text and nothing else: MA1D-READY", `localOnly`, no project.
- On submit: `waiting_for_approval`, routed to local `huihui_ai/qwen2.5-abliterate:7b` (not the cloud tag), cwd `C:\Users\allam\Bunny-Workspace`.
- Workstation approval moved it to `running`, then `completed` with output `MA1D-READY`. It persisted (task count 53 → 54).

**Mission smoke.** Missions were enabled temporarily and a disposable git fixture (`C:\Users\allam\bunny-ma1d\repos\mission-smoke`) was registered as a project.
- Mission `c69d86c9-060b-4b48-9616-2855a96b4b90` ("git status") went `waiting_for_approval` → approved → `completed`.
- One step, `Git/completed/skill:git.snapshot`; accounting: deterministic 1, external 0, local 0, `tokensReported:false`.
- Afterwards Missions were disabled and the project removed. The Missions config JSON is identical to before, and the project count is back to 13.

## Database preservation

| | |
|---|---|
| Database | `C:\Users\allam\Documents\new\bun-router\.bunny-a\host.sqlite`. Not moved and not copied for use. The release reaches it through `%LOCALAPPDATA%\Bunny-A\state\.bunny-a`, a junction to `<repo>\.bunny-a` |
| Backup (before switch) | `.bunny-a\backups\pre-ma1d-20261003-135333\host.sqlite`, sha256 `cd3de30a05533e9872bcfef725986a4ac74bc9c2419f81ff1584900d7bf7f9fc`. Made with a read-only `VACUUM INTO`; the live main file and WAL were unchanged by it (`pre/db-backup.json`). Integrity ok; counts and ID digests equal the live DB at that moment |
| After switch | integrity ok, `user_version` 3. Only change: `events` +1. Every ID digest identical (tasks, projects, devices, missions, settings, skills, policies, …) (`switch/db-state-after.json`) |
| Final | integrity ok, v3. Every pre-switch row is still present. All 53 tasks, 38 outcomes and 1,949 events are byte-identical (`final/db-rows-preserved.json`). Additions come only from the smokes and Host events: tasks +1, outcomes +1, missions +1, mission steps +1, authorizations +1, memory +2, capability runs +2, inbox +2, events +46. Projects, devices, settings, skills and policies have unchanged ID sets |
| Migration / legacy compatibility | PASS, read-only, run from a scratch export of f1934bd (`migration/`). Live DB snapshot (v3, 54 tasks) opened twice: original columns identical, 0 changed tables, pre-M-A-0 reader OK. Pre-M2 backup v1 → v3 twice |
| Ad-hoc DB writes | none (all writes went through the Host API) |

## Rollback

Rollback materials are in `%LOCALAPPDATA%\Bunny-A\rollback\<stamp>\`:
- the original `Bunny-A.lnk`, plus `shortcut.json` (target, arguments, working directory, sha256);
- the original `deployment.json`;
- `rollback.json` (data directory, gateway before/after);
- `ROLLBACK.md` with exact steps.

**Command:** `scripts\install-bunny-release.ps1 -Rollback [-RollbackDirectory <dir>]`. Copying the saved `.lnk` and `deployment.json` back by hand also works. No Git checkout is involved.

**Exercised live** (`rollback/rollback-evidence.json`):
1. `-Rollback` restored the shortcut byte-identical to the original (sha256 `ACC7CD72…`) and `deployment.json` to the repo v10 path.
2. Re-running the installer re-pinned it, with a shortcut sha256 identical to the first pin.

The running Host was not touched. The newest rollback folder (`20261003-140816`) again records the original repo startup as "previous".

**Kept as they were:**
- previous release locations: `<repo>\releases\Bunny-A-Windows-v10` (the original gateway) and all v2–v15 packages;
- the M-A-1 rollback (`test-results/ma1/installed/ROLLBACK.md`, `ea0e803` Host);
- the database backup above.

Rollback needs one manual step: stop the running v16 Host (identity-checked) before running the restored shortcut.

## Installed Host final state

`final/installed-host-final.json`, `final/release-info.json`:

| Item | Value |
|---|---|
| Host PID / instance | 9984 / `9ebf4197-3ae1-4d64-b2e3-45c488113e51` |
| Startup target | `Bunny-A.lnk` → `powershell.exe … -File "C:\Users\allam\AppData\Local\Bunny-A\releases\Bunny-A-Windows-v16\Start-Bunny-Release.ps1"` |
| Runtime path | `C:\Users\allam\AppData\Local\Bunny-A\releases\Bunny-A-Windows-v16\runtime\node.exe` running `…\Bunny-A-Windows-v16\Bunny-Host.mjs` |
| Package version | Bunny-A-Windows-v16 (16.0.0) |
| Source SHA | f1934bda6b0d33f27bef198e8967a69f6eb329ff (tooling be6e2e5) |
| Package sha256 | f17023efd0cab2c0ed95ea6392d2a92fee7da1f4c9dcc2002ec5d3c314daae11 |
| Integrity | 134/134 files match the manifest; 0 changed, missing or extra |
| DB path | `C:\Users\allam\Documents\new\bun-router\.bunny-a\host.sqlite` (via `%LOCALAPPDATA%\Bunny-A\state\.bunny-a`) |
| Missions | disabled (unchanged) |
| Default task workspace | `C:\Users\allam\Bunny-Workspace` |
| Provider discovery | Ollama, Codex and Claude ready; OpenCode, Cline and Cursor unavailable (no adapters; unchanged) |
| Dashboard | PID 14532 on the release runtime, serving the user's configured v10 package. That package was copied byte-for-byte to `%LOCALAPPDATA%\Bunny-A\releases\Bunny-A-Windows-v10` and `deployment.json` updated (original saved for rollback). `/bunny-health` root = state root |
| Island | launcher PID 42796, running `<release>\Start-Bunny-Release.ps1` |
| Remote | configuration unchanged (`remoteConfigured` true, consent enabled) |

**Processes deliberately left untouched:**
- the pre-existing tunnel worker (PID 27924, `<repo>\scripts\bunny-tunnel.mjs`) and its `cloudflared` (7352). Both have been failing with "Unauthorized: Tunnel not found" since 2026-10-02 18:29Z. They were not restarted, because restarting would create a new public quick tunnel. The launcher recognises the running worker and does not start a duplicate.
- the M3 QA package server on 8085 (`test-results/m3/serve-package.mjs`), which is not part of startup.

All of these end at the next sign-out. From the next logon, the tunnel worker starts from the release.

**Startup status (not conflated):**

| Item | Status |
|---|---|
| STARTUP SHORTCUT INVOCATION | **TESTED / PASS.** Five launches through `explorer.exe Bunny-A.lnk`: the switch plus four restarts |
| WINDOWS LOGOUT/LOGIN | **NOT TESTED** |
| WINDOWS REBOOT | **NOT TESTED** |

## Tests/gates

**New tests** (`scripts/bunny-release.test.mjs`, 4). They exercise the real scripts and fail if the deployment logic regresses.

1. **Release pin.** The pin is f1934bd (full SHA), the commit exists, and the release name is new (≥ v16).
2. **Pinned build** (packager, run for real against a clone).
   - **Setup:** a shared clone carrying uncommitted and untracked edits.
   - **Checks:** the manifest's source and tooling commits; every source and tooling file byte-identical to its git blob; no dirty bytes in any file; no test files or `.git`.
   - **Mission runtime:** every M-A-1 repaired module is present, and the import closure stays inside the release.
3. **Launcher** (run for real against a stand-in Host).
   - **Start:** the Host starts on `<release>\runtime\node.exe <release>\Bunny-Host.mjs` with working directory = workspace and data = `state\.bunny-a`.
   - **Second launch:** detects the already-running release Host.
   - **Tampering:** an edited release file stops the launch with "release file changed".
4. **Installer** (run for real in temp folders).
   - **Shortcut:** points to the release launcher, outside any Git checkout.
   - **Release and data:** release files are read-only and verified, and existing data is linked in place (same bytes).
   - **Workspace and gateway:** the workspace is created outside the repo and the install; the dashboard package is relocated out of a checkout with `deployment.json` following it.
   - **Refusals:** a workspace inside a checkout or inside the install is refused, and a refused install leaves the shortcut untouched.
   - **Rollback:** restores the original shortcut and `deployment.json` and keeps the releases.

Existing tests are unchanged and none were removed. The desktop-package import-graph test still parses the unchanged folder list.

**Full regression** on `be6e2e5` (`gates/summary.txt`, rerun after the live work):

| Gate | Result |
|---|---|
| `npm test` | exit 0: 210/210 + 185/185 |
| `npm run test:ui` | exit 0: 21/21 |
| Total | **416/416** (412 floor + 4 new) |
| typecheck | exit 0 |
| lint | exit 0: 0 errors, 10 warnings (legacy, unchanged: 9 × `react-refresh/only-export-components`, 1 unused `eslint-disable`) |
| build | exit 0 |
| migration compatibility | PASS (above) |

A pre-commit run of the same gates on the identical tree also passed (`gates-pre-commit/`).

## Remaining M-A-2 notes

Recorded, deliberately not fixed here because they would change reviewed M-A-1 code:
- Codex version gate or tool-registry check (the denylist is verified only for 0.153.4).
- A process-level `unhandledRejection` guard, or catches on the fire-and-forget async calls in `bunny-missions/manager.server.ts`.
- `realGit` should also map Git for Windows' `<Git>\bin\git.exe` launcher.
- Git hook (MSYS) grandchildren can outlive a Host crash.
- Desktop-control approval batching (EXECUTE asks per action; conservative, fail-closed).

New notes from M-A-1D:
1. **Host data still physically lives in the development repo** (`<repo>\.bunny-a`, git-ignored, linked from the state root). A checkout cannot change it. But `git clean -x`, deleting the repo, or a task with the repo registered as a project can damage production data. The bundled `cloudflared.exe` lives there too. Recommendation: a planned, backed-up migration of the data to `%LOCALAPPDATA%\Bunny-A\data`.
2. **Remote transport.** The release's tunnel-worker start path has not run live, because the old worker was alive and starting a new one would create a public quick tunnel. Its first live run will be at the next logon, where consent is enabled, so a **new quick-tunnel hostname will be created then**, as the previous startup chain would also have done. The old worker targets 8085, the M3 QA server, set manually during M3; the logon default is 8084, the gateway.
3. **The dashboard gateway is still the user's configured v10 package** (relocated byte-for-byte). The v16 release contains the f1934bd dashboard build; switching `deployment.json` to it is a separate, user-visible decision.
4. **Host `/health` exposes no build identity**, because adding it would change f1934bd code. Identity comes from `Bunny-Release-Info.ps1` (process path plus manifest). Add version and commit to `/health` in the next code milestone.
5. **The launcher's integrity check covers source, tooling and runtime files.** The dashboard build output is checked by `Bunny-Release-Info.ps1` only. A changed release fails closed at logon (no Host), and recovery is reinstalling or rolling back.
6. **The read-only attribute and the integrity check are tamper detection, not a security boundary.** Claude write steps keep user-level shell authority (M-A-0 M1).
7. **Dashboard build dependencies** came from the build workspace's installed `node_modules`, not `npm ci`. The lockfile sha256 is recorded. The native Host imports no npm packages; `playwright` stays an optional guarded import, so the packaged browser capability is unavailable, as in M-A-1.
8. **The launcher test's cleanup is best-effort.** Antivirus can briefly hold the copied `node.exe` it executes, leaving a temp folder behind.
9. **Old entry points remain in the repo** (`scripts/start-bunny-*.ps1`, `scripts/bunny-host.mjs`) for development and for rollback. Nothing at logon references them any more.

## Final result

**BUNNY_MA1D_DEPLOYMENT_PASS**

Each PASS criterion is met:
- The Host runs from a fixed, read-only, manifest-verified package outside any Git checkout.
- The package is built from the exact f1934bd source; every source file is byte-identical to its git blob.
- The logon shortcut points to the release launcher.
- `git switch main`, `git switch ma0-mission-architecture` and a dirty development tree each left the next-start Host on the identical v16 build. The positive control proved the dirty-tree probe works.
- The default task workspace is `C:\Users\allam\Bunny-Workspace`, separate from both the repo and the release.
- The database and all prior state are preserved, with Missions still disabled.
- Rollback exists and was exercised live.
- The packaged Host, dashboard and Island run, and direct-task and Mission smokes pass.
- 416/416 regressions pass, along with migration compatibility.

Not covered by this PASS: Windows logout/login and reboot (NOT TESTED), and the release tunnel worker's first live start (next logon).

Nothing was merged or pushed.
