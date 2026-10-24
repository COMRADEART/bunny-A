# MA4-S2-T3R — Installed Windows release qualification (Phase E)

**Gate T3R-G7: PASS for an isolated TEST installation** (not the owner's production installation, which was observe-only).
**Gate T3R-G14 (notch reflects execution): PASS.**

## Artifact and isolation

| Item | Value |
|---|---|
| Package | `Bunny-A-Windows-S2T3R4-TEST`, built by `scripts/package-bunny-desktop.ps1` from `8802e0c` (git-archived source, dashboard build, pinned Node, zod and Playwright runtimes, whisper runtime hash-checked) |
| Installer | `scripts/install-bunny-release.ps1` into `%LOCALAPPDATA%\Bunny-S2T3R-Install\installation-fixed`, Host port 43191 |
| Startup | the installer's logon shortcut was pointed at a scratch folder (`startup-disabled-fixed`); the owner's Startup folder, scheduled tasks and services were never changed (verified after cleanup) |
| Environment | launched with an isolated profile (`USERPROFILE`/`APPDATA`/`LOCALAPPDATA` under the test root) and a minimal `PATH`, so no provider CLI or account was probed; Ollama reached over loopback only |
| Workspace | synthetic project outside Git (`bunny-t3r-installed-project`), removed afterwards |

Two release defects were found only by installing, and fixed before the final package:
`6992dee` — the release did not ship `zod`, so an installed MA4 Host could not start; `f1bbf85` — the installed-state marker
was written before the presentation stores added their tables, so the **second** launch refused a healthy database. Earlier,
`f29e530` fixed the closure check misreading `Pick<…, "from" | …>` as an import (it blocked every package from this line).

## The 18 scenarios

| # | Scenario | Result | Evidence |
|---|---|---|---|
| 1 | Install from the produced artifact | PASS | `release/install-final.log` |
| 2 | Launch normally (installed launcher) | PASS | `installed/release-launch.log` |
| 3 | Host startup verified (identity, pid, installed runtime path) | PASS | `lifecycle-final.json`, `gaps.json` |
| 4 | Open and reposition the notch | PASS — top edge x=252 → 1411 by placement preference | `notch-move.json`, `notch-move-top-*.png` |
| 5 | Horizontal and side layouts | PASS — 470×82 on top, 78×328 on the left | `notch-move-left-0.5.png`, `notch-horizontal.png`, `notch-side.png` |
| 6–8 | Goal, one-time schedule, condition monitor created in the actual UI | PASS — persisted across restart | `lifecycle-final.json` |
| 9 | Workstation-only approvals | PASS — the phone shows "Approve this on your PC" and no Approve control | `android/round2.json` |
| 10 | Windows closed, background off | PASS — task stays QUEUED, no receipt | `lifecycle-final.json` |
| 11 | Background explicitly on | PASS — authorized file task completes with no UI | `lifecycle-final.json` |
| 12 | Runs only while the authorized Host is alive | PASS — killed Host: no progress; phone shows last known, controls paused | `lifecycle-final.json`, `android/round2.json` |
| 13 | Restart and durable recovery | PASS — new pid in 6.1 s; pending approval preserved; completed task not replayed | `lifecycle-final.json` |
| 14 | Cancel a running task | PASS — pinned-model generation cancelled mid-step in 2.7 s, no draft receipt | `gaps.json` |
| 15 | Task and children terminate | PASS — Host descendants unchanged (`conhost.exe` only); the Host calls Ollama over HTTP and starts no model process | `gaps.json` |
| 16 | Reopen the interface; current state | PASS — dashboard re-rendered at 1280 and 390 px, no console errors | `release/installed-smoke-final.log` |
| 17 | No duplicate tasks or notifications | PASS — none by occurrence, title-in-5 s, or notification identity | `gaps.json` |
| 18 | Clean up safely | PASS — test processes stopped, install root and workspace removed, production and startup untouched | `cleanup.json` |

Failure and recovery paths exercised: crash kill of the Host, relaunch while the gateway kept running
(`gateway.already-running`), first lifecycle attempt failing (`lifecycle.exit` = 1, "fetch failed" before the marker fix),
background-off blocking, wrong pairing code, Host outage seen from the phone.

## Limits

- Not the owner's production installation; a production install is a separate, owner-authorized step.
- Physical mouse dragging of the notch was not performed; placement was driven through the notch's own preference and
  measured from its window.
- The installed qualification ran partly in a concurrent Codex session (stopped by the owner) and was completed and
  re-verified here; attribution is in the commit messages.
