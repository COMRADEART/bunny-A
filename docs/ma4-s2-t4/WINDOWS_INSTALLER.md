# MA4-S2-T4 — Windows Installer & Packaging Qualification (`WINDOWS_INSTALLER.md`)

- **Gate T4-A Verdict:** **`PASS`** (Controlled local & non-admin user installation qualified; Authenticode signing tracked in `T4-C` as `BLOCKED`)

---

## 1. Windows Release Structure & Runtime Closure

[`scripts/package-bunny-desktop.ps1`](../../scripts/package-bunny-desktop.ps1) and [`scripts/bunny-release.mjs`](../../scripts/bunny-release.mjs) construct a self-contained release folder `<InstallRoot>\releases\<ReleaseId>\` verified by `release-manifest.json` (`schema: "bunny-release-manifest/1"`):

1. **Host Executable & Entry Points:**
   - `Bunny-Host.mjs` (trusted local HTTP/SSE Host on `127.0.0.1:43180` + TLS pairing listener when enabled)
   - `scripts/bunny-tunnel.mjs` (local reverse proxy / TLS companion relay)
   - `runtime/node/node.exe` (bundled Node.js `v24.14.1` binary — requires zero system Node installation)
   - `node_modules/zod` (the sole runtime npm package imported by the standalone Host; verified by `importClosure()` in [`scripts/bunny-release.mjs`](../../scripts/bunny-release.mjs))
   - `src/lib/bunny-host/native/bin/bunny_proc.exe` (compiled from reviewed C source `src/lib/bunny-host/native/bunny_proc.c` with `gcc -Wall -Wextra -Werror -O2`, verifying Windows process ownership & creation time before termination)
2. **Dashboard Build Assets:**
   - `.output/public/` and `.output/server/` built with `JEV_DESKTOP_BUILD=1 npm run build`, hashed into `dashboard.assetManifestSha256` inside `release-manifest.json`.
3. **Optional Voice Runtime Inclusion:**
   - [`scripts/stage-voice-runtime.ps1`](../../scripts/stage-voice-runtime.ps1) stages the hash-pinned `whisper.cpp` `v1.8.3` runtime (`whisper-cli.exe` `sha256:de5b8ac6be6fbffe9bfca1fb6db4fb7fb1bfcead74decffbe9eb50da95bbd2c5`, `ggml-base.en.bin` `sha256:a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002`) under `%LOCALAPPDATA%\Bunny-A\voice-runtime\`. If absent, voice STT reports `unavailable` cleanly without crashing the Host.
4. **Local Model Configuration:**
   - Connects exclusively to local Ollama (`127.0.0.1:11434`) with hard-pinned `sha256` model digests (`src/lib/bunny-host/ma4/model-pins.ts`). External cloud LLM providers remain disabled (`enabled: false, models: []`).

---

## 2. Non-Administrator Installation, Data Ownership & Uninstall Verification

[`scripts/install-bunny-release.ps1`](../../scripts/install-bunny-release.ps1) installs under `%LOCALAPPDATA%\Bunny-A` (or an isolated `-InstallRoot` in `-TestStageOnly` mode) under standard non-administrator user privileges:

| Check | Result on `Bunny-A-Windows-S2T3R1-6-TEST` (`448ca6b`) | Evidence |
|---|---|---|
| **No developer checkout dependency** | `importClosure()` verified `454` files (`extra: 0, missing: 0, changed: 0`); runs with repo unmounted | [`../ma4-s2-t3r1/evidence/installed/lifecycle.json`](../ma4-s2-t3r1/evidence/installed/lifecycle.json) |
| **Non-administrator user scope** | Installed under `C:\Users\allam\AppData\Local\Bunny-S2T3R-Install\r1\Bunny-A` without UAC elevation | `lifecycle.json` (`steps[0].install`) |
| **Data directory ownership** | State stored in `<InstallRoot>\data\host-state.sqlite` + `ma4-tasks.sqlite`, separated from immutable `<InstallRoot>\releases\<ReleaseId>\` | [`install/Bunny-State.ps1`](../../install/Bunny-State.ps1) |
| **No automatic Windows startup** | Startup folder items and `HKCU:\Software\Microsoft\Windows\CurrentVersion\Run` verified unchanged (`startupItemsUnchanged: true`, `runKeysUnchanged: true`) | [`../ma4-s2-t3r1/evidence/installed/cleanup.json`](../ma4-s2-t3r1/evidence/installed/cleanup.json) |
| **Repeated installation & upgrade** | Upgraded across `S2T3R1-1-TEST` -> `S2T3R1-6-TEST` while preserving `host-state.sqlite` and `ma4-tasks.sqlite` | [`../ma4-s2-t3r1/INSTALLED_RELEASE_RECHECK.md`](../ma4-s2-t3r1/INSTALLED_RELEASE_RECHECK.md) |
| **Clean uninstallation** | Stopped via `Stop-Bunny-A.ps1`, removed release root, verified `r1DirectoryRemoved: true`, `testProcessesLeft: 0`, `ports43193and8084Listening: false` | [`../ma4-s2-t3r1/evidence/installed/cleanup.json`](../ma4-s2-t3r1/evidence/installed/cleanup.json) |
