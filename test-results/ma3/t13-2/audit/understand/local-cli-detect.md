# local-cli-detect: live read-only AI CLI detection (MA3 T13.2 input)

Run at 2026-10-13T11:31:26-04:00 on this Windows 11 Pro 10.0.26300 PC, from the scratchpad directory (not the repo).
Method: `where.exe <name>` plus `Get-Command -All <name>`, then each command run through a PowerShell
`System.Diagnostics.Process` wrapper. The wrapper closed stdin, set a 15 s timeout (20 s for cursor-agent and
opencode), killed the process tree on timeout, set env `NO_COLOR=1 BROWSER=none GH_PROMPT_DISABLED=1
GH_NO_UPDATE_NOTIFIER=1 WSL_UTF8=1`, and masked output before writing it to disk.
- Masking: emails become the first 2 chars + `***@domain`. UUIDs become `[REDACTED-UUID]`. Token-shaped strings
  (sk-, gho_, xai-, AIza, JWT, opaque strings of 32+ characters) and gh `Token:` lines become `[REDACTED]`.
  gh account names become the first 2 chars + `***`.
- Scripts and raw masked output are in `scratchpad/understand/detect/run.ps1` and `scratchpad/understand/detect/results.txt`.
- No command timed out and none exited non-zero.
- I did not run any login, logout, signin or setup-token command. I did not open a browser. I did not read
  any credential file (path checks used Test-Path only). I did not edit the repo, and I did not start or stop
  any server. Before running `ollama list` I confirmed that the Ollama server was already listening on
  127.0.0.1:11434 (PID 34660). This matters because `ollama list` auto-launches `ollama app.exe` through
  `checkServerHeartbeat` when the server is down. I did not run `gh copilot`, because it downloads the
  Copilot CLI when it is missing; I ran only `gh help copilot`.

## 1. Binary resolution (where / Get-Command)

All `where` calls exited 0 in about 70-90 ms, except copilot, which exited 1.

| name | resolved path(s) (PATH order) | notes |
|---|---|---|
| claude | `C:\Users\allam\.local\bin\claude.exe` | native installer |
| codex | `C:\Users\allam\AppData\Local\Programs\OpenAI\Codex\bin\codex.exe` | native |
| cursor-agent | `C:\Users\allam\AppData\Local\cursor-agent\cursor-agent.cmd` (+ `.ps1` ExternalScript) | cmd shim |
| agent | **1st: `C:\Users\allam\.grok\bin\agent.exe` (this is GROK)**; 2nd: `...\cursor-agent\agent.cmd` (+ .ps1) | **Name collision: a bare `agent` on PATH resolves to the Grok CLI, not Cursor** |
| cline | `C:\Users\allam\AppData\Roaming\npm\cline` / `cline.cmd` / `cline.ps1` | npm global |
| opencode | `C:\Users\allam\AppData\Roaming\npm\opencode(.cmd/.ps1)` | npm global `opencode-ai@1.18.34` |
| gemini | `C:\Users\allam\AppData\Roaming\npm\gemini(.cmd/.ps1)` | npm global `@google/gemini-cli@0.52.0` |
| gh | `C:\Program Files\GitHub CLI\gh.exe` | |
| copilot | **NOT FOUND** (`INFO: Could not find files for the given pattern(s).`, exit 1) | no WinGet link, no `%LOCALAPPDATA%\GitHub CLI\copilot`; `~\.copilot\config.json` EXISTS (prior Copilot CLI use or config only) |
| ollama | `C:\Users\allam\AppData\Local\Programs\Ollama\ollama.exe` | server already running on 127.0.0.1:11434 |
| grok | `C:\Users\allam\.grok\bin\grok.exe` | |
| wsl | `C:\Windows\System32\wsl.exe` | |

`npm ls -g --depth=0` exited 0 in 3774 ms. Output: `@comradeart/bun@npm:@comradeart/bunny@0.2.0 -> bun-main`,
`@comradeart/bunny@0.2.0 -> bun-main`, `@google/gemini-cli@0.52.0`, `@origin/cli@0.20260913.106`, `cline@` (no version
shown; the CLI itself reports 3.0.67), `opencode-ai@1.18.34`.

## 2. Versions (`<exe> --version`, all exit 0)

| CLI | command | output | ms |
|---|---|---|---|
| Claude Code | `claude.exe --version` | `2.1.296 (Claude Code)` | 74 |
| Codex | `codex.exe --version` | `codex-cli 0.162.1` | 54 |
| Cursor Agent | `cursor-agent.cmd --version` | `2026.09.10-fd3934a` | 2901 |
| agent (PATH-first, Grok) | `.grok\bin\agent.exe --version` | `grok 1.0.30 (04b7ffed98c6) [stable]` | 1668 |
| agent (Cursor) | `cursor-agent\agent.cmd --version` | `2026.09.10-fd3934a` | 1522 |
| Cline | `cline.cmd --version` | `3.0.67` | 3217 |
| OpenCode | `opencode.cmd --version` | `1.18.34` | 2456 |
| Gemini CLI | `gemini.cmd --version` | `0.52.0` | 5373 (slowest) |
| GitHub CLI | `gh.exe --version` | `gh version 2.96.0 (2026-07-02)` | 115 |
| Ollama | `ollama.exe --version` | `ollama version is 0.40.3` (no client/server mismatch warning) | 164 |
| Grok | `grok.exe --version` | `grok 1.0.30 (04b7ffed98c6) [stable]` | 1962 |
| WSL | `wsl.exe --version` | `WSL version: 2.7.11.0`, kernel `6.18.33.2-2`, WSLg `1.0.73.2`, Windows `10.0.26300.9550` | 101 |

## 3. Auth / status probes (documented read-only commands)

| provider | command | exit | ms | masked result | account id printed? |
|---|---|---|---|---|---|
| Codex (OpenAI) | `codex login status` | 0 | 95 | **stderr** (stdout empty): `Logged in using ChatGPT` | No. Says ChatGPT subscription mode only; no email or plan |
| Claude Code | `claude auth status` | 0 | 406 | stdout JSON: `loggedIn:true, authMethod:"claude.ai", apiProvider:"firstParty", analyticsDisabled:false, projectsDirectory/configDirectory:C:\Users\allam\.claude..., email:"al***@gmail.com", orgId:[REDACTED-UUID], orgName:"al***@gmail.com's Organization", subscriptionType:"pro"` | **YES: email, orgId (UUID), orgName (contains email)** |
| Cursor | `cursor-agent status` | 0 | 1936 | `Not logged in` | No |
| Cursor | `agent.cmd status` (Cursor shim, called by explicit path) | 0 | 1895 | `Not logged in` | No |
| Cursor | bare `agent status` | NOT RUN | - | bare `agent` resolves to Grok's agent.exe, which has unknown `status` semantics | - |
| Cline | `cline --help` | 0 | 2273 | Help text only. Relevant: `auth [provider]`, `config`, `-P/--provider <id>` (default `cline`), `-k/--key <api-key>`, `-m/--model`, `--config` (default `~/.cline`), `--data-dir` (default `~/.cline/data`), `hub` daemon, `doctor`, `--json`, `--acp`, `-p/--plan`, `--auto-approve` (default **true**), `-t/--timeout` (default 0 = none) | No |
| OpenCode | `opencode auth list` | 0 | 2828 | `Credentials ~\.local\share\opencode\auth.json`: `Nvidia api`, `Google api`, `Ollama Cloud api`; `3 credentials` | No (provider names + type only; the auth file path is printed) |
| Gemini | `gemini --version` only | 0 | 5373 | `0.52.0` (auth not probed, per scope) | No |
| GitHub | `gh auth status` | 0 | 523 | `github.com ✓ Logged in to github.com account CO*** (keyring)`, `Active account: true`, `Git operations protocol: https`, `Token: [REDACTED]` (gh prints a masked `gho_****` form by default), `Token scopes: 'gist','read:org','repo','workflow','write:packages'` | **YES: GitHub username**. Also a partially masked token prefix, which we redacted entirely |
| GitHub Copilot | `gh extension list` | 0 | 118 | empty (no gh extensions; the legacy `gh-copilot` extension is NOT installed) | No |
| GitHub Copilot | `gh help copilot` | 0 | 430 | gh 2.96 has a **built-in** `gh copilot` (preview) that runs `copilot` from PATH, or **downloads it to `%LOCALAPPDATA%\GitHub CLI\copilot` if missing** (that dir does not exist) | No |
| Ollama | `ollama list` | 0 | 190 | 5 models: `deepseek-v4.1-flash:cloud` (cloud, size `-`, 11 days ago), `huihui_ai/qwen2.5-abliterate:7b` 4.7 GB, `huihui_ai/Qwen3.8-abliterated:27b` 17 GB, `huihui_ai/qwen3-abliterated:30b` 18 GB, `qwen2.5-coder:7b` 4.7 GB | No |
| Grok | `grok --version` only | 0 | 1962 | `grok 1.0.30` | No |

Commands that printed account identifiers: **`claude auth status`** (email, orgId UUID, orgName) and **`gh auth status`**
(GitHub login name and a masked token prefix). `opencode auth list` printed only the credential-store path and provider
names. None of the others printed any identifier.

## 4. Credential-store presence (Test-Path only; contents NEVER read)

| path | exists |
|---|---|
| `~\.codex\auth.json` | file |
| `~\.codex\config.toml` | file |
| `~\.claude\.credentials.json` | file |
| `~\.claude.json` | file |
| `~\.cursor\` (dir) / `~\.cursor\cli-config.json` | dir / file (but `status` = Not logged in) |
| `%APPDATA%\GitHub CLI\hosts.yml` | file (the token itself lives in the OS keyring, per `(keyring)`) |
| `~\.config\gh\hosts.yml` | absent |
| `~\.local\share\opencode\auth.json` | file (the Windows location opencode actually uses, as its own output confirms) |
| `%LOCALAPPDATA%\opencode\auth.json` | absent |
| `~\.config\opencode\` | dir |
| `~\.ollama\`, `~\.ollama\id_ed25519`, `~\.ollama\id_ed25519.pub` | dir, file, file (keypair present, and the `:cloud` model is listed, so Ollama cloud signin is likely) |
| `~\.gemini\`, `~\.gemini\oauth_creds.json`, `~\.gemini\settings.json` | dir, file, file (Google OAuth login likely; not verified by any command) |
| `~\.cline\` | dir |
| `~\.grok\`, `~\.grok\auth.json` | dir, file (Grok login likely; not verified by any command) |
| `~\.copilot\`, `~\.copilot\config.json` | dir, file; `~\.copilot\pkg` absent; no copilot binary anywhere |
| `%LOCALAPPDATA%\github-copilot` | absent |

## 5. Environment variables (presence only; value never printed)

I checked the Process, User (HKCU) and Machine (HKLM) scopes. **All are unset in all three scopes**:
`ANTHROPIC_API_KEY, OPENAI_API_KEY, CURSOR_API_KEY, XAI_API_KEY, GEMINI_API_KEY, GOOGLE_API_KEY, OPENROUTER_API_KEY,
CLAUDE_CODE_OAUTH_TOKEN, ANTHROPIC_AUTH_TOKEN, ANTHROPIC_BASE_URL, GH_TOKEN, GITHUB_TOKEN, OLLAMA_HOST, CLINE_API_KEY`.
Caveat: the Process scope is this subagent's own environment. The installed Host process could have a different
inherited environment, so the Host must re-check at runtime.

## 6. Implications for MA3 T13.2 (Connection Registry / Provider Capability Adapters)

1. **Live connection-mode map for this PC:**
   - Claude: native subscription CLI, claude.ai **Pro**, logged in.
   - Codex: native subscription CLI, ChatGPT login.
   - GitHub: identity (gh, keyring, `repo`/`workflow` scopes).
   - Ollama: local runtime (4 local models), plus one Ollama Cloud model (`:cloud`). This is a delegated/remote
     plan running through the local daemon, so it must not be classed as "local" for consent.
   - OpenCode: API keys held in OpenCode's own store (Nvidia, Google, Ollama Cloud). These are API-key mode, and
     the credentials are owned by OpenCode, not by Bunny.
   - Cline: installed (3.0.67); auth state not probed. Its default provider `cline` is a ClinePass-style
     delegated plan; per-run `-k` key override exists.
   - Gemini and Grok: installed, credential files present, auth state unverified. A dedicated read-only probe is
     needed. Grok has no documented status command known here; Gemini has no `auth status` subcommand in 0.52
     as far as checked.
   - Cursor: installed but **not logged in**, so it should show as "installed / disconnected".
   - Copilot: **not installed**. `gh copilot` would auto-download, so an adapter must never call it as a probe;
     use `gh extension list` and PATH lookup only.
   - WSL: present (2.7.11), relevant only as a runtime.
2. **Name collision:** a bare `agent` resolves to Grok's `agent.exe` ahead of Cursor's `agent.cmd`. Adapters must
   resolve Cursor only by `cursor-agent`, or by an absolute path, and never by `agent`.
3. **Shim types:** cursor-agent, cline, opencode and gemini are `.cmd`/`.ps1` shims (npm or vendor). Spawning them
   needs `cmd.exe /d /c` (or the bundled node entry), with careful argument quoting. claude, codex, gh, ollama and
   grok are native `.exe` files.
4. **Probe costs:** native CLIs return in under 0.5 s. Node/Bun shims take 1.5 to 5.4 s (gemini 5.4 s, cline 3.2 s,
   cursor-agent 2.9 s). Probe caching and a timeout of at least 15 s per probe are warranted. Probes should run
   off the hot dispatch path.
5. **Output channels differ:** `codex login status` writes to **stderr**, so parsers must read both streams.
   `claude auth status` is JSON on stdout (machine-parseable: `loggedIn`, `authMethod`, `apiProvider`,
   `subscriptionType`, `email`, `orgId`). `gh auth status` is human text on stdout.
6. **Redaction requirements for the registry and the phone view:** the Claude probe returns email, orgId and
   orgName, which must be masked or hashed before storage or display. The gh probe returns a login and a token
   prefix, so `--show-token` must be forbidden and `Token:` lines dropped. OpenCode prints the credential-file
   path. Agents must never receive any of these values (only a connection id or label).
7. **Ambient paid-API risk:** today no `ANTHROPIC_API_KEY` or `ANTHROPIC_AUTH_TOKEN` is set at any scope, and Claude
   reports `authMethod:"claude.ai"` / `apiProvider:"firstParty"`, which is subscription mode. The T13.2 guard should
   still strip or deny `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `CLAUDE_CODE_OAUTH_TOKEN` and
   `ANTHROPIC_BASE_URL` from the child environment for subscription-mode connections. It should also verify
   `claude auth status`.authMethod before dispatch, because Claude Code prefers an env API key when one is set.
   The same applies to `OPENAI_API_KEY` for Codex. Codex uses ChatGPT login, but an env key or `codex login --api-key`
   would switch it to paid API.
8. **Unsafe "probe" commands to forbid in adapters:**
   - `ollama list`/`ps`/`show` when the server is down, because they auto-start `ollama app.exe` on Windows. Probe
     `GET http://127.0.0.1:11434/api/version` (or check the TCP listen state) first.
   - `gh copilot` (auto-download).
   - `cline dashboard` (opens a browser).
   - `cline auth`, `opencode auth login`, `codex login`, `claude setup-token`/`login` (interactive or browser).
   - `cline --update`.
   - Bare `agent`.
