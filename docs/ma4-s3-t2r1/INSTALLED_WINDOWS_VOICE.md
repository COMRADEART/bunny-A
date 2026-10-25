# Installed Windows voice journey

The installed product at `%LOCALAPPDATA%\Bunny-A` was not replaced. Before and after this work, `install.json` and the Startup shortcut `Bunny-A.lnk` both had mtime `2026-10-18T02:52:57Z`. The installed release name remains `Bunny-A-Windows-MA3-T13-UPDATE-TEST` at source `2f2c54c629d67746fb0eba34aecb69aeb8eb738b`.

An isolated candidate was built from `4af7d9f313ee46b98698fe12662b11676b3391cd` with `scripts/package-bunny-desktop.ps1`:

- Package name `Bunny-A-T2R1-TEST`, version `9.9.9-t2r1`
- Output directory outside the installed tree
- Runtime `node.exe` is the verified v24.18.0 distribution, and `runtime/LICENSE` contains the Node.js copyright notice
- `whisper.dll`, `bunny-whisper-shim.dll`, and `bunny-voice-worker.exe` are in the package
- Package command exit 0

That candidate was started with its own `install.json`, port 43991, and `-NoIsland -NoGateway -NoRemote`. `/health` returned `app: Bunny-A` (pid 40004). The process was then stopped. The microphone was not opened. Hands-free, the live microphone indicator, a spoken correction, interruption, Host-status speech, and coexistence with a background task were not exercised through the Island.

Android microphone permissions were not added.

The voice journey through the installed interface is **BLOCKED** until the muted endpoint is unmuted by hand and the acoustic test is explicitly authorized.
