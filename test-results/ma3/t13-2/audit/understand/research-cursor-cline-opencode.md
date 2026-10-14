# Research: Cursor CLI, Cline / ClinePass, OpenCode (+ Ollama, Anthropic policy) for MA3 T13.2

Fetched 2026-10-13. Read-only, web only. No repository files read or modified for this report.
Legend: FETCHED = official page fetched today (quotes are as the fetch tool returned them, which may lightly paraphrase); SEARCH = search-snippet or third-party only; UNVERIFIED = not confirmed from a primary source.

---

## 1. Cursor CLI ("Cursor Agent")

### Sources
- https://docs.cursor.com/en/cli/reference/authentication -> 308 redirect to https://cursor.com/docs; content FETCHED at https://cursor.com/docs/cli/reference/authentication (2026-10-13)
- https://cursor.com/docs/cli/reference/parameters FETCHED
- https://cursor.com/docs/cli/headless FETCHED
- https://cursor.com/docs/cli/reference/output-format FETCHED
- https://cursor.com/docs/cli/installation FETCHED
- https://cursor.com/terms-of-service FETCHED ("Last updated September 3, 2026")
- https://forum.cursor.com/t/inquiry-regarding-official-api-or-commercial-license-for-using-cursors-engine-as-a-backend-component/165063/5 FETCHED (forum post by "deanrie", 2026-07-10; staff role NOT confirmed on page)
- `.md` variants of these URLs return 404; help/integrations/cli.md 404; usage-limits.md 404.

### Binary name
- Current docs use **`agent`** (e.g. `agent --version`, `agent update`). Older docs/search results use `cursor-agent`. Bunny must probe both names (`agent` is a dangerously generic name on PATH; verify via `agent about --format json` that it is really Cursor).

### Auth (FETCHED, cursor.com/docs/cli/reference/authentication)
- `agent login` - "opens your browser to sign in with your Cursor account, and credentials are stored locally."
- `agent status` - "checks whether you're authenticated and shows account info and endpoint configuration."
- `agent logout` - "clears stored credentials."
- `NO_OPEN_BROWSER=1` - "prints the login URL instead of opening a browser."
- API key for automation: "Generate a user API key in the Cursor Dashboard under API Keys" (search results say it moved to Integrations > User API Keys) and supply via `CURSOR_API_KEY` env var ("recommended") or `--api-key`.
- Credential storage location: NOT documented (UNVERIFIED).

### Parameters (FETCHED, /cli/reference/parameters)
- `--api-key <key>`: "API key for authentication (can also use `CURSOR_API_KEY` env var)"
- `-H, --header <header>`: custom headers on agent requests
- `-p, --print`: "Print responses to console (for scripts or non-interactive use). Has access to all tools, including write and shell."
- `--output-format <format>`: "(only works with `--print`): `text`, `json`, or `stream-json` (default: `text`)"
- `--resume [chatId]`, `--continue`
- `--model <model>`
- `-f, --force`: "Force allow commands unless explicitly denied"; `--yolo` alias
- `--sandbox <mode>`: `enabled` | `disabled`
- `--trust`: "Trust the workspace without prompting (headless mode only)"
- `--workspace <path>`
- Commands: `login`, `logout`, `status | whoami` ("View authentication status"), `about` ("Display version, system, and account info"), `models` ("List available models for this account"), `mcp`, `ls`, `resume`, `update`.
- **`status`/`whoami` and `about` accept `--format text|json`** -> machine-readable auth status. Whether the JSON contains the email / token is UNVERIFIED (docs say "account info"; treat email as PII, never a token, but redact anyway).

### Headless (FETCHED, /cli/headless)
- "Use print mode (`-p, --print`) for non-interactive scripting and automation."
- "Combine `--print` with `--force` (or `--yolo`) to modify files in scripts." "The `--force` flag allows the agent to make direct file changes without confirmation." Without `--force`, changes are only proposed.
- `--output-format stream-json` "for message-level progress tracking", plus `--stream-partial-output`.

### stream-json events (FETCHED, /cli/reference/output-format)
- `system/init`: fields `"apiKeySource": "env|flag|login"`, `cwd`, `session_id`, `model`, `permissionMode`.
  - **Key for T13.2:** `apiKeySource` lets Bunny verify AFTER spawn which credential source Cursor actually used. If the connection mode is "native subscription login" and init reports `env` or `flag`, abort the run (ambient `CURSOR_API_KEY` leaked in).
- `assistant`, `tool_call` (started/completed, `call_id`), `result` (`duration_ms`, `duration_api_ms`, `session_id`).
- Doc shows no usage/token field (forum says the json usage object reports token counts only, no dollars - SEARCH).

### Platform (FETCHED, /cli/installation)
- "macOS, Linux and Windows (WSL)" and "Windows (native)" both listed.
- Windows native: `irm 'https://cursor.com/install?win32=true' | iex`. Auto-updates by default; `agent update`.

### Billing / terms
- Forum (2026-07-10, deanrie): "Billing is usage based under the plan and limits of the account tied to the API key." "There's no separate engine license SKU." Headless print mode: "This is exactly what it's built for, scripts, CI, automation." Limits: "you can't resell Cursor itself as a standalone service", "you can't give third parties access to Cursor or usage under your account", "you can't use Cursor outputs to train a competing model".
- ToS (Sept 3, 2026): no API-key clause; s.1.5(iii) no "rent, lease, lend, or sell the Service"; s.1.5(xi) no "knowingly permit any third party to do any of the foregoing"; s.3 account confidentiality.
- **Important:** a Cursor user API key (`CURSOR_API_KEY`) bills against the SAME Cursor plan/account as browser login - it is not a separate pay-per-token API product. So the billing distinction is "which Cursor account", not "subscription vs paid API". (Plan included-usage then on-demand overage; usage-limits page 404 - plan amounts SEARCH only: Pro $20, Pro+ $70, Ultra $400 of included API usage.)
- BYOK provider keys (OpenAI/Anthropic keys inside Cursor) reportedly NOT supported in CLI (OpenAI help article, SEARCH) - UNVERIFIED from Cursor.

### Connection modes Bunny may implement (Cursor)
| Mode | How | Status probe (no secrets) | Billing |
|---|---|---|---|
| native-subscription-cli | user runs `agent login` themselves; Bunny spawns `agent -p --output-format stream-json` with CURSOR_API_KEY **scrubbed** from env | `agent status --format json` (redact email); verify `apiKeySource=="login"` in init | user's Cursor plan |
| api-key (Cursor user key) | key held by Host credential store, injected as env `CURSOR_API_KEY` only into the child | init `apiKeySource=="env"` | same Cursor account plan/on-demand |
| view-only | detect install + `status` only | as above | none |
- Do NOT: pass `--api-key` on the command line (visible in process list - prefer env); default `--force`/`--yolo`; let phone or Agents trigger `agent login`; serve Cursor to other people (ToS 1.5(xi)).

---

## 2. Cline / ClinePass

### Sources
- https://github.com/cline/cline/blob/main/docs/getting-started/clinepass.mdx FETCHED
- https://github.com/cline/cline/blob/main/docs/getting-started/authorizing-with-cline.mdx FETCHED
- https://docs.cline.bot/cline-cli/installation FETCHED
- https://docs.cline.bot/usage/cli-overview FETCHED
- https://docs.cline.bot/cli/cli-reference FETCHED
- https://docs.cline.bot/api/overview FETCHED
- https://github.com/cline/cline FETCHED (license Apache-2.0)

### Auth methods (FETCHED, authorizing-with-cline.mdx)
- "Cline (usage-billing), recommended: sign in with Google/GitHub/email, no API key setup"; credits at app.cline.bot/dashboard.
- "ClinePass: a $9.99/month subscription provider" with "2-5x the usage on popular open coding models".
- "Bring Your Own Key (BYOK): use your own provider credentials (cloud or local runtimes)"; Ollama / LM Studio need no key.
- CLI: `cline auth` / `cline a` - "Runs the same auth flow as IDE setup."

### ClinePass (FETCHED, clinepass.mdx)
- "$9.99/month"; "a flat monthly subscription, so you are not charged the individual API prices below" (per-token rates shown only to explain quota use).
- Limits: "5-hour rolling window", "Weekly", "Monthly" - numeric caps not stated; dashboard shows usage.
- Interfaces: IDE ("set API Provider to ClinePass, and sign in"); CLI ("Go to `/settings` and select ClinePass as your provider"); **outside Cline: "You can use ClinePass models from your own scripts, apps, or automation through the Cline API."** "the same OpenAI-compatible Chat Completions format"; key from app.cline.bot Settings > API Keys. "You can use both independently" (with usage-billing).
- No stated restriction on outside-Cline use. => ClinePass IS officially usable outside Cline's own interfaces via the Cline API.
- Model IDs: `cline-pass/glm-5.3`, `cline-pass/glm-5.3-flash`, `cline-pass/kimi-k3`, `cline-pass/deepseek-v4-pro`, `cline-pass/deepseek-v4.1-flash`, `cline-pass/mimo-v2.5`, `cline-pass/mimo-v2.5-pro`, `cline-pass/minimax-m3`, `cline-pass/muse-spark-1.3-contributor`, `cline-pass/qwen3.8-max`, `cline-pass/qwen3.7-max`, `cline-pass/qwen3.7-plus`. Removed: GLM-5.2, Kimi K2.6, Kimi K2.7 Code, DeepSeek V4 Flash (recommend DeepSeek V4.1 Flash, GLM-5.3, Kimi K3).
  - NOTE for this machine: user CLAUDE.md profile guidance (`kimi-k2.7-code`, `deepseek-v4-flash`, `glm-5.2`, `kimi-k2.6`) names models the official page now says were REMOVED. Bunny must read models live, never hard-code.

### Cline API (FETCHED, docs.cline.bot/api/overview)
- `POST https://api.cline.bot/api/v1/chat/completions`, header `Authorization: Bearer <key>`, model ids `provider/model` (e.g. `anthropic/claude-sonnet-4-6`).
- Billing/rate limits/usage-balance endpoint: not covered on page. Whether a given key draws from ClinePass quota vs usage credits is selected by the `cline-pass/` model prefix (inferred from clinepass.mdx + third-party Mastra page; UNVERIFIED explicitly). `CLINE_API_KEY` env name is third-party only (Mastra, pi-clinepass-provider) - UNVERIFIED.

### Cline CLI (FETCHED, cli-overview + cli-reference)
- Install `npm install -g cline`, Node 20+ (22 recommended); Windows supported per installation page summary (SEARCH snippet; fetched page did not explicitly list Windows for CLI - treat as PLAUSIBLE).
- Synopsis `cline [options] [command] [prompt]`. Headless "triggered when using flags like `--json`, when stdin is piped, or when output is redirected."
- `--json`: NDJSON, each line has `type` and `ts`; types `agent_event`, `hook_event`, `team_event`, `run_result` (final `text`), `run_aborted`; errors on stderr `{"type":"error","message":...}`.
- `--auto-approve <boolean>` "default `true`" (default `false` in ACP mode) - **dangerous default; Bunny must pass `--auto-approve false` unless policy allows.**
- `-p, --plan` (Plan mode), `-m, --model`, `-P, --provider`, `-c, --cwd`, `-t, --timeout <seconds>`, `--acp` (Agent Client Protocol for editors), `--config <path>` (default `~/.cline`), `--data-dir` (default `~/.cline/data`).
- `auth [options] [provider]` flags: `-p, --provider <id>`, `-k, --apikey <key>`, `-m, --modelid <id>`, `-b, --baseurl <url>`, `--azure-api-version`.
- Commands: `config [target]`, `mcp`, `doctor` ("Diagnose and fix configuration issues" - closest to a status check), `history|h`, `hook`, `plugin`, `schedule`, `skill`, `connect`, `hub`, `update`, `version`, `kanban`.
- **No documented auth-status/whoami command.** `cline config` "Show the current configuration" - may print provider config; whether it masks keys is UNVERIFIED -> Bunny must not surface its raw output.
- Credentials: "API keys and provider config are in `~/.cline/data/settings/providers.json`" (plaintext file, per reference). Env: `CLINE_DIR`, `CLINE_DATA_DIR`, `CLINE_HUB_PORT`, `CLINE_LOG_PATH`, `CLINE_SANDBOX`.
- `-y/--yolo`: appears in search snippets of an older docs page but NOT in current CLI reference - UNVERIFIED/possibly removed. `cline task ...`, gRPC, `cline-core`: NOT in current docs - UNVERIFIED (older Cline CLI 1.x had cline-core gRPC; current docs do not).
- SDK: repo lists `sdk/` - "Node.js programmatic agent API", `npm install @cline/sdk` (FETCHED from repo README). License Apache-2.0.

### Connection modes Bunny may implement (Cline)
| Mode | How | Status probe | Billing |
|---|---|---|---|
| native-subscription-cli (ClinePass via Cline CLI) | user authenticates with `cline auth` themselves; Bunny spawns `cline --json --auto-approve false -P <provider> -m cline-pass/<id> -c <cwd> -t <s>` | Bunny-side: parse `providers.json` for *presence/provider id only* (never values) or `cline doctor`; UNVERIFIED structured status | ClinePass flat or Cline credits depending on model/provider |
| delegated-plan via Cline API | Host holds a Cline API key; Bunny's own OpenAI-compatible adapter calls api.cline.bot with `cline-pass/*` models | GET models list (UNVERIFIED endpoint) / test call | ClinePass quota (officially allowed: "your own scripts, apps, or automation") |
| api-key BYOK through Cline | not needed - Bunny should call the provider directly instead | - | provider |
| view-only | detect `cline version` + config presence | - | none |
- Must: scrub ambient provider env keys from the child; force `--auto-approve false` by default; treat `providers.json` as a secret file (never read values into Agent context); read model lists live.

---

## 3. OpenCode (opencode.ai; repo now anomalyco/opencode)

### Sources
- https://opencode.ai/docs/cli/ FETCHED
- https://opencode.ai/docs/providers/ FETCHED
- https://opencode.ai/docs/server/ FETCHED
- https://opencode.ai/docs/go/ FETCHED
- https://opencode.ai/docs/zen/ FETCHED
- https://github.com/sst/opencode FETCHED (resolves to anomalyco/opencode; "MIT license")
- auth.ts source: 404 at tried paths - UNVERIFIED.

### Auth (FETCHED, /docs/cli)
- `opencode auth login` "configures API keys for providers"; "This is stored in `~/.local/share/opencode/auth.json`". Flags `--provider/-p`, `--method/-m`.
- `opencode auth list` / `ls`: "Lists all the authenticated providers as stored in the credentials file." (Prints provider names + credential type; that it never prints key material is UNVERIFIED from source - from memory it prints name and type such as `oauth`/`api` plus env-detected providers. Bunny should still redact.)
- `opencode auth logout` removes a provider's entry.
- TUI `/connect` does the same; OAuth options include "ChatGPT Plus/Pro", "GitHub Copilot" (device code at github.com/login/device), "Claude Pro/Max" (see below).

### Headless / automation (FETCHED)
- `opencode run [message..]` - "Run opencode in non-interactive mode by passing a prompt directly." Flags: `--format default|json` ("raw JSON events"), `--model/-m provider/model`, `--attach http://localhost:4096`, `--continue`, `--session`, `--file`, `--dir`, `--port`, `--variant`, `--thinking`, `--auto`.
- `opencode serve` - "a headless OpenCode server for API access." Defaults: port `4096`, hostname `127.0.0.1`; `--mdns`, `--cors`. `OPENCODE_SERVER_PASSWORD` enables HTTP basic auth (user `opencode`, override `OPENCODE_SERVER_USERNAME`). OpenAPI at `/doc`.
  - Endpoints: `GET /provider`, `GET /provider/auth`, OAuth routes `/provider/{id}/oauth/...`, `GET /config/providers`, `GET/POST /session`, `POST /session/:id/message` ("Send a message and wait for response"), `GET /event` SSE (first `server.connected`), and **`PUT /auth/:id` "Set authentication credentials"**.
  - => An unauthenticated opencode server on loopback lets any local process overwrite credentials. If Bunny ever runs `opencode serve`, it MUST set a random `OPENCODE_SERVER_PASSWORD`, bind 127.0.0.1 only, never `--mdns`, and never expose to phone/LAN.
- `opencode models [provider]` (`--refresh`, `--verbose` adds costs), `opencode stats` (token usage and cost; `--days --models --project`), `opencode export [sessionID] --sanitize`, `opencode acp` (ACP over stdio nd-JSON), `opencode mcp ...`, `opencode github install|run`.

### Providers (FETCHED, /docs/providers)
- "75+ LLM providers" via AI SDK + Models.dev; local Ollama, LM Studio, llama.cpp.
- **Anthropic: "There are plugins that allow you to use your Claude Pro/Max models with OpenCode. Anthropic explicitly prohibits this." "Previous versions of OpenCode came bundled with these plugins but that is no longer the case as of 1.3.0."** (page still describes a /connect "Claude Pro/Max" browser option - Bunny must never use it).
- OpenAI: "We recommend signing up for ChatGPT Plus or Pro"; ChatGPT Plus/Pro OAuth in /connect, or manual API key. (Whether OpenAI permits this for third-party apps: UNVERIFIED here - see the Codex research lane.)
- GitHub Copilot: device-code login; "Some models might need a Pro+ subscription."
- Credentials: `~/.local/share/opencode/auth.json` (on Windows path mapping UNVERIFIED; likely `%USERPROFILE%\.local\share\opencode\auth.json`).

### OpenCode's own plans (FETCHED)
- Zen (pay-as-you-go): "You are charged per request and can add credits"; endpoints `https://opencode.ai/inference/v1/chat/completions` / `/messages`; usable "with OpenCode or another coding agent"; providers zero-retention except OpenAI/Anthropic 30 days.
- Go: "$10/month"; Go Plus "$40/month"; limits 5-hour 20%, weekly 50%, monthly 100% of monthly dollar limit; endpoints `https://opencode.ai/inference/go/v1/` (`/chat/completions`, `/responses`, `/messages`), models list `/inference/go/v1/models`; "designed for OpenCode and other coding agents"; clients should send own user agent and a stable `x-opencode-session` header; single-member workspaces only; optional "Use balance" fallback to pay-as-you-go (=> silent paid overflow if enabled; Bunny should display, not toggle).

### Install / license
- MIT. Windows: `scoop install opencode`, `choco install opencode`; npm package name reported by fetch as `@opencode/cli` (historically `opencode-ai`) - UNVERIFIED.

### Connection modes Bunny may implement (OpenCode)
| Mode | How | Status probe | Billing |
|---|---|---|---|
| native-cli (any provider already logged into opencode by the user) | spawn `opencode run --format json -m <provider/model> --dir <cwd>` with scrubbed env | `opencode auth list` -> parse provider names + type only | per provider entry |
| delegated-plan (OpenCode Go/Zen key) | Bunny's own OpenAI/Anthropic-compatible adapter to opencode.ai/inference/... with own UA + `x-opencode-session` | `/inference/go/v1/models` | Go flat with caps; Zen credits |
| local-runtime | opencode -> Ollama; or Bunny -> Ollama directly (preferred) | - | free |
| view-only | `opencode --version`, `auth list`, `stats` | - | none |
- MUST NOT: use OpenCode's "Claude Pro/Max" option or plugins; run `opencode serve` without password; call `PUT /auth/:id`; read auth.json values.

---

## 4. Anthropic policy (relevant to every adapter) - FETCHED https://code.claude.com/docs/en/legal-and-compliance
- "OAuth authentication is intended exclusively for purchasers of Claude Free, Pro, Max, Team, and Enterprise subscription plans and is designed to support ordinary use of Claude Code and other native Anthropic applications."
- "Anthropic does not permit third-party developers to offer Claude.ai login into their own applications, or to route requests through Free, Pro, or Max plan credentials on behalf of their users. Moreover, developers may not collect, store, or intermediate Claude.ai credentials or session tokens — sign-in to a Claude account must complete through Anthropic's own flow."
- Allowed: "Nor does it prevent an end user from signing in to the unmodified Claude Code binary with their own Claude subscription". Hosting Claude Code: "The Claude Code binary must not be modified" and "Customers may not pay for, resell, or intermediate Claude usage on their end users' behalf."
- "Advertised usage limits for Pro and Max plans assume ordinary, individual usage of Claude Code and the Agent SDK."
- News (SEARCH): Jan 9 2026 server-side blocks on subscription OAuth outside Claude Code; Feb 19 2026 docs clarification (VentureBeat, alternativeto.net, gigazine). OpenCode commit "Anthropic's legal request removes Claude OAuth support" - UNVERIFIED primary.
- => Bunny: Claude subscription ONLY via the unmodified `claude` binary the user logged into; never read/copy `~/.claude/.credentials.json`; never route Claude via OpenCode/Cline subscription paths. Ambient `ANTHROPIC_API_KEY` must be scrubbed from child env in subscription mode (Claude Code prefers the API key when set - see Claude lane).

---

## 5. Ollama (user asked "all providers like ollama")
- FETCHED https://docs.ollama.com/cloud: "sign in to use cloud models"; cloud model names like `gemma4:cloud`; "Cloud models do not need to be downloaded"; direct API via `OLLAMA_API_KEY` against `https://ollama.com/api/chat`, `/api/tags`; usage at ollama.com/settings/usage, plans at ollama.com/pricing.
- `ollama signin/signout` command names not on page - UNVERIFIED. Local API 127.0.0.1:11434 not on page (well known; UNVERIFIED here).
- Implication: an Ollama "local runtime" connection can silently be a CLOUD model (`:cloud` tag) billed to an ollama.com account. Registry must classify model tags `*:cloud` / `-cloud` as hosted (data leaves machine, plan-billed), and consent must cover that.

---

## 6. Cross-cutting recommendations for T13.2
1. Per-adapter env allowlist for child processes: start from an empty env + PATH/HOME/SystemRoot etc.; strip `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `CURSOR_API_KEY`, `CLINE_*` keys, `OPENCODE_*`, `OLLAMA_API_KEY` unless that adapter's selected connection mode is that key.
2. Post-spawn verification where the tool reports it: Cursor `system/init.apiKeySource`; (Claude Code `apiKeySource` in its init similarly - other lane).
3. Status probes surface only {installed, version, authenticated: bool, provider ids, credential type, plan label if any}; emails redacted to the phone; tokens never leave the Host process.
4. Dangerous defaults to override: Cline `--auto-approve` default true; Cursor `--force` off; OpenCode serve unauthenticated + `PUT /auth/:id`; OpenCode Go "Use balance" overflow; Ollama `:cloud`.
5. Never automate login flows from Agents/phone: login is user-initiated in the vendor's own flow (Anthropic requires it; good practice for all).
6. Model lists must be read live (ClinePass model removals already invalidate this machine's documented profiles).
