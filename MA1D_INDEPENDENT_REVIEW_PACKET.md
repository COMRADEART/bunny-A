# Bunny-A M-A-1D: independent review packet

This packet asks for a review of the claim **BUNNY_MA1D_DEPLOYMENT_PASS** (`MA1D_DEPLOYMENT_HARDENING_REPORT.md`). The report is the implementer's own account; this Claude Code session built and tested the deployment, so it cannot certify it as independent. Re-derive every claim below from the repository, the installed files and the live processes. The evidence under `test-results/ma1d/` (git-ignored, local) is supporting material, not proof.

## Identity to verify

| Item | Expected |
|---|---|
| MA0 freeze | `180ab234b2e81e7745e7402c4eb9483586c36eab` |
| M-A-1 code candidate (the only production code in the release) | `f1934bda6b0d33f27bef198e8967a69f6eb329ff` |
| Deployment tooling commit | `be6e2e56c627a8969b7ecc1c9d992737710d5c11` |
| Branch / head | `ma1-live-acceptance`; head = this packet's docs commit above `be6e2e5`; not pushed, not merged |
| Release | `Bunny-A-Windows-v16` 16.0.0 |
| Package | `releases\Bunny-A-Windows-v16.zip`, sha256 `f17023efd0cab2c0ed95ea6392d2a92fee7da1f4c9dcc2002ec5d3c314daae11` |
| Release manifest sha256 | `d22bc82eb4b5645c88570d8518ecff5de86d1f1831e70d407c93bcfcb0b8749c` |
| Install path | `C:\Users\allam\AppData\Local\Bunny-A\releases\Bunny-A-Windows-v16` |

## What to review in code

Run `git diff 786bdeb be6e2e5` (deployment tooling only) and confirm `git diff --stat f1934bd be6e2e5 -- src` is empty.

| File | Look for |
|---|---|
| `scripts/package-bunny-desktop.ps1` | Runtime files come only from `git archive <SourceCommit>` and tooling from `git archive <ToolingCommit>`, never from the working tree. The build fails unless `verify`, `closure` and `source-check` pass. |
| `scripts/bunny-release.mjs` | The manifest classifies every file. The closure check ignores `import type` lines (erased at runtime), anchors static imports to statements, fails on any npm package, and allows only the guarded optional `playwright`. Source-check compares sha256 with `git cat-file blob`. |
| `install/Start-Bunny-Release.ps1` | Every path comes from `install.json` or the release folder; there is no npm, git or repo path. It checks integrity before starting anything. The Host runs on `runtime\node.exe` with working directory = workspace. It refuses a gateway package inside a checkout and does not start a duplicate tunnel worker. |
| `install/Bunny-Release-Info.ps1` | Read-only. It reports the running Host's executable and command line from the live process and checks the manifest. |
| `scripts/install-bunny-release.ps1` | Guards: the install root and workspace are not inside a checkout, and the workspace is separate from the install root and the data folder. The data folder is linked, not copied. Rollback materials are saved before anything changes; the shortcut is rewritten last. `-Rollback` restores the shortcut without Git. |
| `scripts/bunny-release.test.mjs` | Four tests that exercise the real scripts (see the report's "Tests/gates"). |

## Independent verification commands

The commands below are PowerShell from the repository root unless noted. All of them are read-only except where marked.

**1. Pinned source identity**
```powershell
git rev-parse 'f1934bd^{commit}'; git log --oneline -1 be6e2e5
git diff --stat f1934bd be6e2e5 -- src            # expect empty
git show be6e2e5:install/release-pin.json         # sourceCommit f1934bd…
```

**2. Package hash and content**
```powershell
(Get-FileHash releases\Bunny-A-Windows-v16.zip -Algorithm SHA256).Hash   # F17023EF…AE11
$rel="$env:LOCALAPPDATA\Bunny-A\releases\Bunny-A-Windows-v16"
node scripts\bunny-release.mjs verify $rel             # ok, 134 files
node scripts\bunny-release.mjs closure $rel            # ok; optionalPackages [playwright]
node scripts\bunny-release.mjs source-check . $rel     # ok, 57 files equal git blobs at f1934bd / be6e2e5
(Get-FileHash "$rel\release-manifest.json").Hash       # D22BC82E…
```
To check one file by hand:
```bash
git cat-file blob f1934bd:src/lib/bunny-missions/inbox.server.ts | sha256sum
sha256sum "$LOCALAPPDATA/Bunny-A/releases/Bunny-A-Windows-v16/src/lib/bunny-missions/inbox.server.ts"
```

**3. Install path outside any checkout**
```powershell
git -C $rel rev-parse --show-toplevel                  # expect "not a git repository"
(Get-ChildItem $rel -Recurse -File | Where-Object { -not $_.IsReadOnly }).Count   # expect 0
```

**4. Startup shortcut**
```powershell
$l=(New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path ([Environment]::GetFolderPath('Startup')) 'Bunny-A.lnk'))
$l.TargetPath; $l.Arguments; $l.WorkingDirectory      # -File "...\Bunny-A-Windows-v16\Start-Bunny-Release.ps1"
```

**5. Runtime process path and release identity**
```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "$rel\Bunny-Release-Info.ps1"
# host.process.executable = <rel>\runtime\node.exe, entryFromThisRelease true, integrity.ok true
$h=Invoke-RestMethod http://127.0.0.1:43119/health; (Get-CimInstance Win32_Process -Filter "ProcessId=$($h.pid)").CommandLine
```

**6. Default task workspace**
```powershell
Get-Content "$env:LOCALAPPDATA\Bunny-A\install.json"  # workspace C:\Users\allam\Bunny-Workspace
git -C C:\Users\allam\Bunny-Workspace rev-parse 2>&1    # not a git repository
```
Optional live check (adds a task record). Submit a direct task with no project through the dashboard or `POST /command {"action":"submit",…}` using the workstation token in `state\.bunny-a\credentials.json`. Before approving it, confirm its `cwd` is `C:\Users\allam\Bunny-Workspace`. Stop it if you don't want it to run.

**7. Branch independence** (mutating; do only when no task is running and the tree is clean)
```powershell
git switch main                 # or ma0-mission-architecture, or make an uncommitted edit
# Stop the Host after checking its identity (health pid == credentials.pid), then start it the way logon does:
Start-Process explorer.exe ('"'+(Join-Path ([Environment]::GetFolderPath('Startup')) 'Bunny-A.lnk')+'"')
powershell -NoProfile -ExecutionPolicy Bypass -File "$rel\Bunny-Release-Info.ps1" -Quick   # same exe, manifest, source
git switch ma1-live-acceptance  # restore; keep the untracked MA1_CLAUDE_FINAL_REVIEW.md
```
The implementer's records for the same steps are in `test-results/ma1d/checkout/*/record.json`, including the dirty-tree probe and its positive control.

**8. Database preservation**
```powershell
$d=Get-Item "$env:LOCALAPPDATA\Bunny-A\state\.bunny-a" -Force; $d.LinkType; $d.Target   # Junction -> <repo>\.bunny-a
node test-results\ma1d\tools\db-state.mjs .bunny-a\backups\pre-ma1d-20261003-135333\host.sqlite
node test-results\ma1d\tools\db-state.mjs .bunny-a\host.sqlite
```
`db-state.mjs` opens the database read-only. Compare integrity, `user_version` 3, and ID digests. Projects, devices, settings, skills and policies should be unchanged. The only additions should be the documented smoke records.

**9. Rollback**
```powershell
Get-ChildItem "$env:LOCALAPPDATA\Bunny-A\rollback" ; Get-Content "$env:LOCALAPPDATA\Bunny-A\rollback\20261003-140816\ROLLBACK.md"
Get-Content "$env:LOCALAPPDATA\Bunny-A\rollback\20261003-140816\shortcut.json"   # the original repo startup, sha256 acc7cd72…
```
A non-destructive round trip, which leaves the running Host alone:
```powershell
scripts\install-bunny-release.ps1 -Rollback
scripts\install-bunny-release.ps1 -Package releases\Bunny-A-Windows-v16.zip -DataDirectory C:\Users\allam\Documents\new\bun-router\.bunny-a
```

**10. Gates**
```powershell
npm test; npm run test:ui; npm run typecheck; npm run lint; npm run build
```
Expected: 210 + 185 + 21 = 416 passing, 0 failing; lint 0 errors and 10 legacy warnings; typecheck and build exit 0.

## Things to scrutinise

1. **Data location.** The Host database still lives in the development repo (`<repo>\.bunny-a`, git-ignored), reached through a junction. Is that acceptable for this milestone? Checkouts cannot change it, but `git clean -x` or deleting the repo can.
2. **Tunnel worker.** The pre-existing worker (repo script, PID 27924) and its `cloudflared` were left running and are failing with "Tunnel not found". The release tunnel worker's start path has not run live, because that would create a public quick tunnel; it will first run at the next logon.
3. **Dashboard.** The gateway still serves the user's configured v10 dashboard (copied byte-for-byte out of the repo). It runs on the v16 runtime, but its UI is not built from f1934bd.
4. **Identity.** No Host `/health` build identity, by design (no Host code change). Is process path plus manifest sufficient?
5. **Logon/reboot not tested.** Only shortcut invocation through Explorer was tested.
6. **Integrity check vs. M1.** The launcher's integrity check covers source, tooling and runtime files only; the read-only attribute is tamper detection, not a boundary.
7. **Default-folder change.** Working on Bunny's own source now requires registering the repo as a project explicitly.

Requested from the reviewer:
- an independent verdict on BUNNY_MA1D_DEPLOYMENT_PASS;
- whether the M-A-1 promotion blocker (mutable working-tree startup) is closed;
- whether anything in be6e2e5 changes M-A-1 Mission, provider or security behavior.
