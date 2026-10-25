# Installed Windows test

No package was installed. The user’s existing Bunny A install, its state directory, and the Startup shortcut were not changed.

`scripts/package-bunny-desktop.ps1` refuses to build a package unless a Node license file is available. It looks beside `node.exe`, then at `releases/installed/JEV-Windows-v1/runtime/LICENSE`. On this machine `node` is `C:\Program Files\nodejs\node.exe`, that folder has no `LICENSE`, and the fallback path is absent. The release test in `scripts/bunny-release.test.mjs` hit that refusal:

`Node runtime license unavailable; package must not ship without it.`

A license file was not invented and nothing was downloaded. Gate T1R2-G10 is **BLOCKED** on this machine.

The C0–C3 measurements in this folder come from `startHost` in the qualification worktree, not from an installed release.
