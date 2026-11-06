# E6B — Phase record: native Windows island and client

Recorded 2026-11-04 on the E6A branch from `main` `9bdcdc5`. The block noted in E5D stands, with
one new fact: `dotnet.exe` is present at `C:\Program Files\dotnet` but it is the **runtime only**
(there is no `sdk/` directory and `dotnet --version` fails with "The command could not be loaded"),
so the JEV notch/WPF client binary cannot be compiled here.

## What ran green without the compiled client (already in this branch's suite run)

The 2144-check regression executed all `scripts/*.test.mjs` island suites against the PowerShell
island's real modules and the app's theme model — including:

- `island-theme.test.mjs` — **theme-token parity**: every UI theme and its high-contrast form
  reaches the Notch as validated tokens; the glass intensity/rim/sheen tokens carry the optional
  v2 glass block; the Notch material differs per theme (18+ distinct dark palettes at minimum).
- `island-placement.test.mjs`, `island-notch.test.mjs`, `island-motion.test.mjs`,
  `island-voice.test.mjs`, `island-ptask.test.mjs`, `island-team-chips.test.mjs` — the island's
  placement, notch, motion, voice, task and team-chip contracts.
- The WPF voice-surface strings: the T12 UI-01..UI-09 checks (hands-free, push-to-talk, barge-in,
  interrupts) all passed in this run — the WPF islands and the React surfaces speak the same
  state machine.
- Canonical art (`native/windows/BunnyA/Assets/characters/*`) is tracked with integrity through
  the release-manifest pipeline (M-A-1D byte-identity in the suite run).

## Blocked execution items (the compiled client is the only blocker)

`scripts/verify-ma5-s1-windows.mjs` and `scripts/ma5-s2/verify-notch-windows.mjs` run UI
Automation against the compiled WPF client (`BunnyA.exe`, net8.0-windows). The runtime-only dotnet
cannot build it. Both would run today otherwise — the local Ollama prerequisite is already
satisfied (`qwen2.5-coder:7b` is present on the local instance).

Owner path to unblock: install an actual .NET SDK (`winget install Microsoft.DotNet.SDK.8`), then

```powershell
dotnet build native/windows/BunnyA          # produces net8.0-windows/BunnyA.exe
node --experimental-strip-types scripts/verify-ma5-s1-windows.mjs
node --experimental-strip-types scripts/ma5-s2/verify-notch-windows.mjs
```

## Owner-attended checks to run with the real window (checklist, none simulated)

1. Screen-edge docking of the island/notch on the real display edges (snap behavior, no drift).
2. Cold restart of the installed client (state recovery, no duplicated windows).
3. Multiple monitors and mixed-DPI: placement correctness per monitor scale, no clipping.
4. Keyboard access across the island surfaces (Tab order, Escape contracts).
5. Windows Narrator walk (real screen reader; DOM checks are not Narrator evidence).
6. Real voice interruption (barge-in with a live microphone; E5A/E6 "voice interruption" gate).
7. Native performance and fallback behavior with the compiled client (the suite's static contracts
   stay green regardless).

## Rollback

Revert the E6B record commit only; nothing else changed in this phase.

🤖 Generated with [Claude Code](https://claude.com/claude-code)