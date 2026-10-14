# Harness compatibility matrix (M-A-3 T13.3 Gate E)

A harness is the client program a model runs through. It is not a model and not a subscription, and an installed,
signed-in harness authorizes nothing: every Task still passes the T13.2 dispatch gate (`evaluateDispatch`) with the
owner's per-account consent. The Harness Manager (Settings → AI & Models → Harness Manager) describes harnesses, tests
them and lets the owner switch them off. It adds no second router and no new dispatch path.

Code: `src/lib/bunny-host/harnesses.ts` (pure views, test ladder, pinned install guidance),
`harnesses.server.ts` (probe, `harness_tests` store), commands in `http.server.ts`, UI in
`src/components/island/harness-manager.tsx`.

## Matrix

Live probe: `<harness> --version` on this Windows 11 workstation on 2026-10-13
(`test-results/ma3/t13-3/gate-e/live-version-probe-2.txt`). "Routes Tasks" is the T13.2 support level, unchanged by
Gate E.

| Harness | Executables | Live probe | Pinned guided install | Routes Tasks | Other routes | Billing |
| --- | --- | --- | --- | --- | --- | --- |
| ChatGPT / Codex | `codex` | codex-cli 0.162.1 (matches pin) | npm `@openai/codex@0.162.1`, SHA-512 | ChatGPT plan through Codex CLI | API key: detect only; plan sharing, identity: not supported | plan included / API billed |
| Claude / Claude Code | `claude` | 2.1.296 (pin 2.1.299; drift warning shown) | npm `@anthropic-ai/claude-code@2.1.299`, SHA-512 | Claude subscription through Claude Code | Console API key: detect only; sign-in inside Bunny: not supported | plan included / API billed |
| Ollama | `ollama` | 0.40.3 (matches pin) | winget `Ollama.Ollama` 0.40.3, manifest SHA-256 | Local models on this PC | Ollama cloud models: detect only | local device / metered credits |
| Cursor | `cursor-agent` | 2026.09.10-fd3934a | none: official installer is an unpinned script; link only, with a warning | no | Cursor plan through Cursor CLI: detect only | plan included |
| Cline / ClinePass | `cline` | 3.0.71 (matches pin) | npm `cline@3.0.71`, SHA-512 | no | Cline account: detect only; Cline API: not supported | plan included |
| Grok / xAI | `grok` | grok 1.0.30 | none: no pinnable package; link only | no | Grok Build, xAI API key: detect only | plan included / API billed |
| OpenCode | `opencode` | 1.18.34 (pin 1.19.0; drift warning shown) | npm `opencode-ai@1.19.0`, SHA-512 | no | providers inside OpenCode: detect only | unknown |
| Google Gemini | `gemini`, `agy` | 0.52.0 (pin 0.64.0) | npm `@google/gemini-cli@0.64.0`, SHA-512 | no | Google account, Gemini API key: detect only | unknown / API billed |
| GitHub Copilot | `copilot` | not found | npm `@github/copilot@1.0.97`, SHA-512 | no | `gh` sign-in, Copilot CLI: detect only | metered credits |

OpenRouter is in the T13.2 catalogue but is an API, not a harness, and is not listed; `harness.*` commands refuse it.

Pins and integrity hashes were read from the npm registry and the winget manifest on 2026-10-13 and live in
`GUIDED_INSTALL`. They go stale: the matrix shows drift as a warning, never as a block.

## Detection

- Codex, Claude, Ollama, Cursor, Cline and OpenCode come from the T13.2 registry and provider detection (path, version,
  Authenticode signature, sign-in state, reported models). Viewing the Harness Manager never starts a process.
- Grok, Gemini and Copilot have no T13.2 detection adapter. Until the owner presses Test their cards say
  "Not detected yet. Test looks for …".
- Copilot is looked for only as `copilot`. GitHub's `gh` is an identity CLI; the first live probe matched `gh` and
  reported a false positive (kept as `live-version-probe-1-gh-false-positive.txt`).

## Capability test

Test runs only the harness's own `--version`: contained, with a scrubbed environment and a 15-second limit. It never
sends a prompt. The verdict is a ladder:

| Verdict | Meaning |
| --- | --- |
| `not_found` | No executable on PATH or at a configured path |
| `found_not_running` | Found, but `--version` failed |
| `runs_not_signed_in` | Runs, and a Task route reports signed out |
| `runs` | Runs; no Task has completed through it, so model inference is not demonstrated |
| `task_completed` | At least one Task routed through it was recorded as completed in the T13.2 usage ledger on this Host |

Presence of a binary or a version string is never treated as evidence of inference. Only the usage ledger, written by
the real dispatch path, can move a harness to `task_completed`. Results persist in `harness_tests` and survive a Host
restart.

## Disable, enable, remove

- **Disable** pauses every route of the harness (`connections.pause`). The dispatch gate then refuses Tasks with
  `CONNECTION_PAUSED`.
- **Enable** resumes paused routes only.
- **Remove** disconnects the routes (`CONNECTION_DISCONNECTED`) and deletes the stored test. It does not uninstall
  anything; the card shows the uninstall command for the owner to run.
- Each action emits `harness.tested`, `harness.disabled`, `harness.enabled` or `harness.removed`.
- All `harness.*` commands are workstation-only. A paired device gets `WORKSTATION_REQUIRED`, and its snapshot carries
  no `harnesses` field.

## Install (guided only)

Bunny never runs an installer, downloads a script or elevates privileges. Each card shows:
- the exact pinned command, its integrity hash, the uninstall command and the official source;
- for Cursor and xAI, only the official page and why no command is offered.

The owner runs the command in their own terminal, then presses Test. No guided command pipes a script into a shell
(asserted in `harnesses.test.ts`).

## Limits

- No live model inference was run for Gate E (no paid inference, no Tasks sent). On this workstation the ladder reaches
  `runs` at most; `task_completed` is proven only with the fixture adapter in `harnesses-host.test.ts`.
- Pressing Test runs a real local binary. That is the owner's explicit click, and only `--version`.
- Routing support is unchanged from T13.2: only Codex, Claude Code and local Ollama can run Tasks. The other six
  harnesses are detect-only, and Gate E does not widen that.
- Signature checks come from T13.2 and cover only harnesses it detects. npm shims cannot carry an Authenticode
  signature; the package's registry integrity is the check.
