# Bunny A — native Windows client (WPF, .NET 8)

`BunnyA.exe` is the workstation interface to the existing Bunny A Host. It reads the Host credentials file
(`BUNNY_HOST_CREDENTIALS_FILE`, else `%APPDATA%\bunny-a\host-credentials.json`, else `~\.bunny\host-credentials.json`),
talks only to `127.0.0.1`, and never starts, installs or replaces the Host. It does not open a browser.

Ten screens: Chat, Agent Dashboard (personal-agent states and each Mission's Host-reported steps), Projects, Approval
Center, Voice Studio, Task History (reconciliation of uncertain tasks), Lotus Memory, Models, Device Pairing, Settings
(notch edge, the Host's thermal auto-stop and resume-on-restart policies). Ctrl+1…Ctrl+0 switch screens; F5 refreshes.

Host connection: every command carries the observed Host id and epoch and a fresh operation id; nothing is retried
automatically. A dropped connection after sending is reported as an uncertain outcome and resolved with
`operation.status` while the epoch is unchanged. Failures are classified (not running, credential rejected, timeout,
unreadable data). The authenticated `/events` stream wakes refreshes; `/state` stays the source of truth and is polled
every 3 s without the stream, every 15 s with it, with backoff to 30 s while the Host is down. A newer snapshot is never
overwritten by an older response, and one unreadable section does not blank the others.

Approval Center: selection follows the request's identity (a changed digest is a different request). Persistent-task
actions show the Host's exact grants, side effect and recovery rule from `action.inspect`, and cannot be approved
without them. Mission plans are approved by their plan reference. Before approving, the client re-reads the Host and
refuses locally if the request changed, ended or the Host restarted; after a restart every approval must be reviewed
again. Each decision is logged with the Host's operation receipt.

Chat starts a task without review only when the Host routed it to a local Ollama model, tool-free and without a folder
(the Host's own rule for an unreviewed launch); anything else waits in the Approval Center. Local only hides hosted and
Ollama cloud models and is enforced by the Host. The answer shows the served model digest when the Host reports one.

The glass notch is a separate top-most window that does not take focus. It docks to any edge of the monitor it is on
(per-monitor DPI aware; work area follows display, DPI and taskbar changes), snaps to the nearest edge after a drag,
remembers edge, offset and position, collapses and expands (fade skipped when Windows animations are off or
`ReducedMotion` is set), and shows the Host's per-agent state. Closing the main window hides it; the notch stays.
Quit exits.

## Build and candidates

- `build.ps1` — Debug build with the pinned SDK (`global.json`, 8.0.408) and no package feeds.
- `package-dev-candidate.ps1` — two clean Release builds in different folders; packages only if every file is
  byte-identical, writing `releases/BunnyA-Windows-dev-<version>.zip` with per-file SHA-256. Unsigned.
- `install-dev-candidate.ps1` — per-user install (default `%LOCALAPPDATA%\Programs\BunnyA-DevCandidate`), verified
  replacement and `-Uninstall`. It refuses the owner's Bunny-A install, settings and Host credential folders, refuses
  while the candidate runs, and removes only what it installed.

`scripts/verify-ma5-s1-windows.mjs` and `scripts/verify-ma5-s1-candidate.mjs` drive the compiled client through UI
Automation against an isolated Host. Development artifacts only; public release gates remain open.
