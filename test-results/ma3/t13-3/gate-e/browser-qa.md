# Gate E browser QA — Settings → AI & Models → Harness Manager

Stack: QA Host on 43190 (temporary data directory, restarted once to load Gate E), Vite dev server on 8091,
Cursor's embedded browser. The QA Host detects the real harnesses on this PC; nothing was installed, signed in or sent
a Task.

| Step | Observed |
| --- | --- |
| Settings → AI & Models | Tabs: Connected Accounts, **Harness Manager**, Local & advice, Routing & Privacy, Routing preferences, Usage & limits |
| Harness Manager | Intro ("not a model and not a subscription … Bunny never installs anything") and 9 cards: ChatGPT / Codex, Claude / Claude Code, Cursor, Cline, Grok / xAI, Ollama, OpenCode, Google Gemini, GitHub Copilot. Codex, Claude and Ollama show "Can run Tasks"; the others "Detected only". Every card shows "Not tested yet." |
| Card contents | Version and path, each route with can run / detected only / not supported, sign-in and billing, reported models, warnings ("installed version differs from the pinned 2.1.299" on Claude Code, 1.19.0 on OpenCode; "unpinned script" on Cursor; "does not send Tasks through it in this release" on detect-only harnesses), and a collapsed "Update or uninstall" / "How to install" section with the pinned command, integrity hash, uninstall command and official-source link |
| Grok / xAI, Gemini, Copilot before a test | First render: "Not found (grok)". The T13.2 registry has no detection adapter for these, so only Test probes them; "Not found" before any probe was misleading (the probe finds Grok and Gemini on this PC). Now: "Not detected yet. Test looks for grok." (see fix below) |
| Test Grok / xAI | Header "grok 1.0.30 (04b7ffed98c6) [stable] · …\.grok\bin\grok.exe", result "Runs; inference not yet shown…", pill stays "Detected only" (Bunny does not route Tasks through it) |
| Test ChatGPT / Codex | "Runs; inference not yet shown. Runs (codex-cli 0.162.1). No Task has completed through it yet, so model inference is not demonstrated." Status "Tested." The test ran only `codex --version` |
| Disable ChatGPT / Codex | Pill "Disabled by you", warning "You disabled this harness; Tasks are refused until you enable it.", status "Disabled. Tasks are refused until you enable it.", the button becomes Enable |
| Enable ChatGPT / Codex | Pill "Can run Tasks", status "Enabled.", the button becomes Disable |
| Reload page | The Codex test result is still shown (stored by the Host) |
| Mobile 390×844 | No horizontal overflow (`scrollWidth - innerWidth = 0`); every pill inside its card |

Screenshots: `t13-3-gate-e-harness-desktop.png` (Codex disabled), `t13-3-gate-e-harness-mobile.png` (after the fix
below). Both show this PC's harness install paths, which contain the Windows user folder name; no credentials,
account identifiers or transcripts are visible.

Fixed during QA: on mobile the Codex card's long path did not wrap and pushed the "Can run Tasks" pill outside the
card. The header text column now has `min-width: 0` and the path wraps anywhere. Hot reload did not apply the edit, so
the page was reloaded before the mobile check. Also fixed: a harness with no detection adapter and no test now reads
"Not detected yet. Test looks for …" instead of "Not found"; "Not found" is shown only after a test. Both fixes precede
the regression run.

A coordinate click on Enable missed (the tool maps screenshot coordinates, not page coordinates); the snapshot-ref
click was used instead. No page script clicked anything.
