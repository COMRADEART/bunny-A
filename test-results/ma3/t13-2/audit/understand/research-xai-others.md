# research-xai-others: xAI / Grok Build, Google Gemini CLI + Antigravity CLI, GitHub Copilot CLI, OpenRouter, Ollama, OpenCode

Research date: 2026-10-13. Every web page below was fetched on 2026-10-13 through WebFetch, which returns a model-summarised view of the page. Text in quotation marks is the quoted text that view returned. Claims labelled **UNVERIFIED** were not confirmed on an official page. Claims labelled **3P** come only from third-party or press sources.
This was a read-only investigation. No repository file was edited, and no server, Host or CLI was run.
The user asked to cover "all provider like ollama, opencode, etc", so OpenCode is included. Laya is skipped because it is not a public product.

---

## 1. xAI (Grok API, Grok consumer subscription, Grok Build CLI)

### Sources fetched
- https://docs.x.ai/developers/faq/accounts (2026-10-13)
- https://docs.x.ai/developers/rest-api-reference/inference (2026-10-13)
- https://docs.x.ai/developers/rest-api-reference/inference/models (2026-10-13)
- https://docs.x.ai/developers/rest-api-reference/inference/other ("Inference API: Account", 2026-10-13)
- https://docs.x.ai/llms.txt (index, 2026-10-13)
- https://docs.x.ai/build/overview, /build/cli/reference, /build/cli/headless-scripting, /build/settings/reference (2026-10-13)
- https://docs.x.ai/x-subscription/overview, /x-subscription/usage-limits (2026-10-13)
- https://x.ai/cli returned **HTTP 403**, so it was not read.

### API key mode
- Inference base URL: "`https://api.x.ai`". Management base URL: "`https://management-api.x.ai`".
- Auth header: "`Authorization: Bearer <xAI API key>`". The management API uses a separate "`Authorization: Bearer <xAI Management API key>`".
- **Key-validation endpoint** (Inference API: Account page): `GET /v1/api-key`, described as "Get information about an API key, including name, status, permissions and users who created or modified this key."
  - Response fields: `acls`, `api_key_blocked`, `api_key_disabled`, `api_key_id`, `create_time`, `modified_by`, `modify_time`, `name`, `redacted_api_key`, `team_blocked`, `team_id`, `user_id`.
  - Billing: the page "says nothing about billing or pricing" for this endpoint. It does no inference, so it is almost certainly free, but that is **UNVERIFIED** as a documented promise.
- **Model listing** (also does no inference):
  - `GET /v1/models` lists "all models available to the authenticating API key, including model names (ID), creation times, and pricing."
  - `GET /v1/language-models` adds modalities, fingerprint and aliases.
  - Image and video model-list endpoints also exist.
- Also listed: `POST /v1/tokenize-text`. It returns only tokens, so it is not needed for validation.

### Consumer subscription vs API billing
- From the accounts FAQ: "Yes, the account is shared between Grok and xAI API." and "However, the billing is separate for Grok and xAI API."
- API billing is managed on the xAI Console (console.x.ai). Grok billing is managed at "grok.com -> Settings -> Billing, or directly with Apple/Google".
- "Please note the xAI account is different from the X account".
- The X Subscription docs describe "one subscription that brings Grok, Cursor, and X together" and say "Grok and Cursor usage draw from the same included pool". Each seat has "a weekly pool for eligible first-party usage only".
- Usage beyond the pool counts as "Additional Usage", which "is any third-party model usage in Cursor, plus any first-party usage beyond your included weekly usage". It is paid from prepaid credit and limited by spending caps.
- None of the fetched pages mention SuperGrok Heavy, X Premium+ or Grok Build inclusion by name.
- Press reports (**3P**: eweek, buildfastwithai, noqta) say Grok Build:
  - launched in beta on 2026-05-14 for SuperGrok Heavy;
  - expanded around 2026-05-25 to SuperGrok and X Premium+.

### Grok Build (official xAI coding CLI, binary `grok`)
- "Grok Build is a powerful and extensible coding agent." It runs as a TUI, headless, or through ACP (`grok agent stdio`).
- Install:
  - macOS/Linux: `curl -fsSL https://x.ai/cli/install.sh | bash`
  - Windows: `irm https://x.ai/cli/install.ps1 | iex`
  - Windows config file: `%USERPROFILE%\.grok\config.toml`. `GROK_HOME` defaults to `~/.grok`, "Home for config, auth, sessions, skills, plugins, and logs."
- Authentication:
  - "On first launch, Grok opens a browser for authentication."
  - `grok login [--device-auth]` and `grok logout`. The logout command "clears cached credentials".
  - `--oauth` flag.
  - For non-browser environments: `XAI_API_KEY`, described as "API key when not using browser/session login (CI and headless)".
- Base URL override: `GROK_XAI_API_BASE_URL`, which defaults to `https://api.x.ai/v1`.
- Status and info commands:
  - `grok inspect [--json]` exists; whether it shows auth or account state is **UNVERIFIED**.
  - `grok models` lists models. `grok version`.
  - No documented `status`, `whoami` or `usage` command.
- Headless: `grok -p "<prompt>"` (`--single`), with `--output-format plain|json|streaming-json`, `--always-approve`, and `--no-auto-update` for CI. The headless page throws "Run `grok login` first, or set XAI_API_KEY."
- Exit codes are not documented, and the page sets no terms on automated use.
- **Precedence risk:** the docs do not say whether an ambient `XAI_API_KEY` overrides a logged-in Grok subscription session (**UNVERIFIED**). This is the same class of risk as an ambient `ANTHROPIC_API_KEY`. A subscription-mode Grok Build spawn must therefore remove `XAI_API_KEY` from its environment.

### What Bunny may implement (xAI)
| Mode | Mechanism | Validation (no inference) |
|---|---|---|
| `api_key` | Bearer key to `https://api.x.ai/v1` (OpenAI-compatible); the Host keeps the key | `GET /v1/api-key`: block if `api_key_blocked`, `api_key_disabled` or `team_blocked`; show `redacted_api_key`, `team_id`, `acls`. Then `GET /v1/models` to list available models |
| `native_subscription_cli` | Spawn `grok -p ... --output-format json --no-auto-update` after `grok login`; strip `XAI_API_KEY` from the child environment | Check that the binary exists and `grok version` runs; `grok inspect --json` may help (**UNVERIFIED** fields). No documented auth-status command, so status is UNKNOWN until a run succeeds |
| `view_only` | Show the plan name the user enters; no live usage API for the consumer pool was found | n/a |

- API usage and subscription usage are separate bills. They must be separate connections in the registry with separate consent.
- The Management API (`management-api.x.ai`, Billing Management) could show spend. It needs a management key, which carries more power, so it should be out of scope or view-only.

---

## 2. Google: Gemini CLI, and Antigravity CLI (its replacement for consumer accounts)

### Sources fetched
- https://geminicli.com/docs/get-started/authentication/ (2026-10-13)
- https://geminicli.com/docs/resources/quota-and-pricing/ (2026-10-13)
- https://github.com/google-gemini/gemini-cli (README, 2026-10-13)
- https://antigravity.google/docs/cli/install (2026-10-13)
- https://ai.google.dev/api/models (2026-10-13)
- Press and blogs (**3P**): letsdatascience, inventivehq, shopifreaks, tembo, evezone.

### Critical change
- The official Gemini CLI auth and quota pages carry this banner: "Gemini CLI was replaced by Antigravity CLI on June 18th, 2026." It applies to "Unpaid tier and Google One users".
- **3P** sources add:
  - The change was announced 2026-05-19.
  - Enterprise Code Assist licences and paid API-key or Vertex users keep Gemini CLI.
  - Antigravity CLI is closed source, written in Go, and its binary is `agy`.
- Bunny therefore cannot assume that "Login with Google" in `gemini` works for a personal or free account after 2026-06-18.

### Gemini CLI (`@google/gemini-cli`)
- License: "Apache License 2.0". Install: `npm install -g @google/gemini-cli@latest`.
- Auth modes:
  1. **Sign in with Google**: run `gemini` and pick "Sign in with Google". Credentials "will be cached locally for future sessions"; the cache location is not stated on that page.
  2. **Gemini API key**: `GEMINI_API_KEY` from AI Studio, then "Use Gemini API key".
  3. **Vertex AI**: ADC through gcloud, a service-account JSON (`GOOGLE_APPLICATION_CREDENTIALS`), or a Google Cloud API key (`GOOGLE_API_KEY`), plus `GOOGLE_CLOUD_PROJECT`.
- Code Assist subscriptions: "Gemini Code Assist for individuals", paid AI Pro and Ultra, and organisation licences.
- Precedence notes:
  - "If you have previously set `GOOGLE_API_KEY` or `GEMINI_API_KEY`, you must unset them to use ADC." This is the same ambient-key hazard as `ANTHROPIC_API_KEY`.
  - `.env` files: "Variables are loaded from the first file found, not merged."
- Headless: `gemini -p "..." --output-format json`. It uses the cached credential if there is one; otherwise it needs env-var auth (API key or Vertex).
- Quotas (quota-and-pricing page):
  - Google account (Code Assist individuals): "1000 maximum model requests / user / day". The README also says 60 req/min.
  - Unpaid API key: "250 maximum model requests / user / day", Flash models only.
  - AI Pro: 1,500 per day. AI Ultra: 2,000 per day.
  - Vertex Express: 90 days without billing.
  - "when using an API key, you pay per token/call".
- Status command: "You can check your current token usage and applicable limits using the `/stats model` command". This is an interactive slash command, not a CLI subcommand.

### Antigravity CLI (`agy`)
- Windows install: `irm https://antigravity.google/cli/install.ps1 | iex`.
- Sign-in:
  - Browser sign-in with a personal Google Account or "Business account" (Gemini Enterprise).
  - Over SSH, it prints a URL and asks for a code to be pasted back.
  - Enterprise: "Google Cloud SSO, Workforce Identity Federation (BYOID/WIF), or Application Default Credentials (ADC)".
- Credential storage: "native secure keyring (such as Apple Keychain, Linux Secret Service/D-Bus, or Windows Credential Manager)". `/logout` removes profiles.
- Headless / API key:
  - Set `"modelProvider": "gemini"` in `~/.gemini/antigravity-cli/settings.json` and export `GEMINI_API_KEY`. "setting `GEMINI_API_KEY` alone has no effect".
  - "Model requests go directly to the Gemini API, and the CLI never establishes an account session."
  - `GOOGLE_GEMINI_BASE_URL` overrides the endpoint. The key is read only from the environment, never from `.env`.
- Status: the page lists "Model quotas (/usage)". There is no `/status` or `/whoami`.
- License: not stated on the page; **3P** says closed source.

### Non-billable validation (Gemini API key)
- `GET https://generativelanguage.googleapis.com/v1beta/models?key=$GEMINI_API_KEY` (models.list), from ai.google.dev/api/models. The page makes no billing statement; list calls do no inference, but "free" is **UNVERIFIED** as a documented promise.
- Prefer sending the key in the `x-goog-api-key` header rather than the URL so it does not land in logs. The header form is standard Google API practice but **UNVERIFIED** on that page.

### What Bunny may implement (Google)
- **`api_key`** (Gemini API): the Host keeps the key, validates with models.list, and calls the Gemini API or its OpenAI-compatible endpoint directly. This is metered per token once billing is enabled; otherwise it uses the unpaid tier (250 req/day, Flash only).
- **`native_subscription_cli`**:
  - Detect `gemini` and `agy` on PATH. Run `gemini -p ... --output-format json` only for accounts that still qualify: paid Code Assist, AI Pro/Ultra if still supported on Gemini CLI (**UNVERIFIED** after 2026-06-18), or enterprise.
  - For consumer accounts, `agy` is the CLI. Its headless subscription mode is not documented (API-key mode only), so subscription-mode `agy` work is **UNVERIFIED**. Treat it as `view_only` until proven.
  - The child environment must remove `GEMINI_API_KEY`, `GOOGLE_API_KEY` and `GOOGLE_GENAI_USE_VERTEXAI` unless the connection is explicitly API or Vertex mode. Otherwise subscription work silently becomes paid API work.
- **`vertex`** (delegated cloud billing): ADC or a service account, with an explicit project id. Treat it as paid.
- Status: there is no machine-readable status subcommand for either CLI. `/stats model` and `/usage` are interactive only, so usage stays UNKNOWN.

---

## 3. GitHub Copilot CLI

### Sources fetched
- https://docs.github.com/en/copilot/how-tos/set-up/install-copilot-cli (2026-10-13)
- https://docs.github.com/en/copilot/concepts/agents/about-copilot-cli (2026-10-13)
- https://docs.github.com/en/copilot/reference/copilot-billing/request-based-billing-legacy/copilot-requests (2026-10-13)
- https://github.blog/changelog/2026/04/27/github-copilot-is-moving-to-usage-based-billing/ (2026-10-13)
- Search results (not fetched) for the `gh copilot` retirement: github.blog changelog 2025-09-25 and 2026-01-21.

### Modes
- Install: `npm install -g @github/copilot` or `winget install GitHub.Copilot`. The binary is `copilot`.
- It requires "An active GitHub Copilot subscription".
- `gh copilot`: the old gh extension was retired (stop date 2025-10-25, per the 2025-09-25 changelog in search results). Since 2026-01-21, running `gh copilot` offers to install Copilot CLI and then runs it (search-result summary, **UNVERIFIED** by fetch).
- Auth:
  - Interactive "`/login` slash command".
  - A fine-grained PAT with the "Copilot Requests" permission.
  - Env vars: "Use the `COPILOT_GITHUB_TOKEN`, `GH_TOKEN`, or `GITHUB_TOKEN` environment variable (in order of precedence)."
  - **Ambient-token hazard:** a `GH_TOKEN` or `GITHUB_TOKEN` already set for git or CI would be picked up silently. Bunny must scrub these from the child environment unless the connection explicitly uses them.
  - Whether `gh auth` credentials are reused was not stated on the fetched page (**UNVERIFIED**).
- Programmatic use: "include the `-p` or `--prompt` command-line option". `--allow-all-tools` "Allows Copilot to use any tool without asking for your approval."
- Models: `/model` or `--model`. Custom providers use `COPILOT_MODEL` (BYOK).
- Usage view: `/context` shows a token breakdown. No `/usage` or `status` command is documented.

### Billing
- From 2026-06-01: "all GitHub Copilot plans will transition to usage-based billing". PRUs are "replaced by GitHub AI Credits".
- "Credits will be consumed based on token usage, including input, output, and cached tokens" at API rates.
- Monthly AI Credits included: Pro $10, Pro+ $39, Business $19/user, Enterprise $39/user.
- "Code completions and Next Edit suggestions remain included."
- Legacy: "Each prompt to Copilot CLI uses one premium request with the default model". This now applies only to Pro and Pro+ subscribers on an existing annual plan who "remained on legacy premium request-based billing after June 1, 2026".
- Consequence: every `copilot -p` run consumes metered credits. It is never "free subscription usage", and overage can be paid.
- Usage viewing: the Billing Overview page on github.com. A per-user billing REST API is **UNVERIFIED**.
- Terms on automating Copilot CLI: not found on the fetched pages (**UNVERIFIED**).

### Non-billable validation
- No documented Copilot entitlement endpoint was found. `GET https://api.github.com/user` with the token validates the GitHub identity only, not the Copilot seat (**UNVERIFIED** for seat checks).
- `copilot_internal/*` endpoints are undocumented; do not use them.
- `gh auth status` reports gh login state (standard gh behaviour, not re-fetched).

### What Bunny may implement (Copilot)
- **`native_subscription_cli`**: spawn `copilot -p ... --model X`. Do not pass `--allow-all-tools` by default; tool approval should stay in Bunny's own approval policy. Scrub `GH_TOKEN`, `GITHUB_TOKEN` and `COPILOT_GITHUB_TOKEN` unless the connection is "PAT mode".
- Each run spends AI Credits, so consent must state that it is metered.
- **`identity`**: GitHub login (useful for repo access) is separate from Copilot model access.
- Status: binary presence plus version. Auth state is UNKNOWN until a run succeeds. Usage is UNKNOWN; link to the billing page.

---

## 4. OpenRouter

### Sources fetched
- https://openrouter.ai/docs/api/reference/limits (2026-10-13)
- https://openrouter.ai/docs/api/reference/authentication (2026-10-13)
- https://openrouter.ai/docs/api/api-reference/credits/get-credits (2026-10-13)
- https://openrouter.ai/docs/guides/overview/auth/byok (2026-10-13)
- https://openrouter.ai/docs/guides/overview/auth/oauth (2026-10-13)

### Modes
- **API key**: "`Authorization: Bearer <OPENROUTER_API_KEY>`". Base URL "`https://openrouter.ai/api/v1`" (OpenAI-compatible).
  - Optional headers: `HTTP-Referer` and `X-OpenRouter-Title`.
  - "OpenRouter is a GitHub secret scanning partner".
- **Delegated plan (OAuth PKCE)**:
  - Send the user to `https://openrouter.ai/auth?callback_url=<URL>` with an optional (but "recommended") `code_challenge`.
  - Exchange with `POST https://openrouter.ai/api/v1/auth/keys`, sending the code and `code_verifier`.
  - "Localhost callbacks are supported on **any port**."
  - The result is a "user-controlled API key".
  - This fits a Host-owned connect flow: no copy-paste of keys, and the user can revoke it on OpenRouter.
- **BYOK** (provider keys stored inside OpenRouter):
  - Costs "5% of what the same model/provider would cost normally on OpenRouter", with a free allowance of $25,000 per month (pay-as-you-go).
  - Fallback: if BYOK keys hit limits, OpenRouter "fall[s] back to its shared endpoints by default". "Shared capacity spends OpenRouter credits." There is a per-key "Shared capacity fallback" setting.
  - This is another silent-paid-switch hazard; Bunny should tell the user about it.

### Non-billable validation and status
- "To check the rate limit or credits left on an API key, make a GET request to `https://openrouter.ai/api/v1/key`."
- Fields under `data`: `limit`, `limit_remaining`, `limit_reset`, `include_byok_in_limit`, `usage`, `usage_daily`, `usage_weekly`, `usage_monthly`, `byok_usage*`, `is_free_tier`, `free_model_daily_requests{used,limit,remaining}`, `budgets`, `effective_budget`, and `rate_limit` (deprecated).
- The page does not say whether the call costs credits. It does no inference.
- `/api/v1/auth/key` is not mentioned on the current page; use `/api/v1/key`.
- `GET /api/v1/credits` returns `total_credits` and `total_usage`, but "Only management keys can perform this operation". Not for normal user keys.
- Free models (IDs ending `:free`): 20 req/min. 50 per day with fewer than 10 credits purchased all time; 1,000 per day with at least 10.

### What Bunny may implement (OpenRouter)
- An `api_key` connection, preferably created through PKCE. Validate with `GET /api/v1/key`.
- Show `limit_remaining`, `usage_daily` and `is_free_tier` as real numbers. These are real data, not estimates, so a "KNOWN" usage state is allowed.
- Models: `GET /api/v1/models` (standard; not re-fetched).
- Consent should be per model or per tier: `:free` models versus paid models.

---

## 5. Ollama (local runtime plus Ollama Cloud)

### Sources fetched
- https://docs.ollama.com/cloud (2026-10-13, two passes)
- https://docs.ollama.com/faq (2026-10-13)
- https://docs.ollama.com/api/tags (2026-10-13)
- https://ollama.com/pricing (2026-10-13)
- Search results (3P) for signin and signout: mintlify, markaicode.

### Modes
- **Local runtime, no account needed**:
  - "Ollama binds 127.0.0.1 port 11434 by default"; `OLLAMA_HOST` changes it.
  - "Ollama runs locally. We don't see your prompts or data when you run locally."
- **Cloud through the local daemon, account required**:
  - Cloud models "do not need to be downloaded". The doc example uses the tag `gemma4:cloud`.
  - Sign-in: "the Settings page in the Mac and Windows apps, or the CLI command `ollama signin`". The account key is needed to "run Ollama Cloud models".
  - `ollama signout` exists according to 3P sources (**UNVERIFIED** by an official fetch).
  - No `whoami` command was found.
- **Cloud API key, no install needed**:
  - Set `OLLAMA_API_KEY`. Calls go to `https://ollama.com/api/chat` with `Authorization: Bearer $OLLAMA_API_KEY`.
  - The cloud model list is `curl https://ollama.com/api/tags`.
- **Disable cloud (local-only mode)**:
  - Set `OLLAMA_NO_CLOUD=1`, or `disable_ollama_cloud: true` in `~/.ollama/server.json`.
  - Restart Ollama afterwards. The log then shows "Ollama cloud disabled: true".

### Detecting cloud models (critical for "local" claims)
- `GET http://127.0.0.1:11434/api/tags`: each `ModelSummary` can carry:
  - `remote_model`: "Name of the upstream model, if the model is remote";
  - `remote_host`: "URL of the upstream Ollama host, if the model is remote".
- "remote_model and remote_host are the only fields that mark a model as remote." There is no boolean flag.
- **Rule for Bunny:** classify a model as CLOUD (data leaves the device) if `remote_host` or `remote_model` is present, or if the name/tag ends in `:cloud` or `-cloud`. The `-cloud` suffix is a historical naming form, **UNVERIFIED** on the current page. A model is LOCAL only if neither field is present and `size > 0`.
- Never label an Ollama model "local / private" just because it comes from Ollama.

### Billing and data
- Plans: Free $0 ("starter usage credits"), Pro $20/mo ("$60 of usage credits per month"), Max $100/mo ("$300 of usage credits per month").
- "Usage is measured in tokens at each model's rates." "Pay as you go with usage credits." "Every plan, including Free, can buy usage credits."
- "the session and weekly limits of the old plans no longer apply."
- Data: "Prompt or response data is never logged or trained on." Hosting partners must have "no logging, no training, and zero data retention policies". The FAQ says Ollama does process cloud prompts "to provide the service".

### What Bunny may implement (Ollama)
- **`local_runtime`**: probe `127.0.0.1:11434/api/tags` (non-billable), then split local from cloud models using the rule above.
- **Cloud models** are a separate connection, `ollama_cloud`. They need explicit consent because they are off-device and metered.
- Optionally offer a "local only" badge when the log line or the `OLLAMA_NO_CLOUD` env is detected. Bunny must not change user settings itself.
- An Ollama Cloud API key is the `api_key` mode, validated with `GET https://ollama.com/api/tags` plus Bearer. Whether that endpoint checks the key is **UNVERIFIED**, because it may be public.

---

## 6. OpenCode (multi-provider coding CLI; user asked explicitly)

### Sources fetched
- https://opencode.ai/docs/providers/ (2026-10-13)
- https://opencode.ai/docs/cli/ (2026-10-13)
- https://github.com/anomalyco/opencode (2026-10-13)

### Facts
- Repo `anomalyco/opencode`, "MIT license".
- Windows install: `scoop install opencode` or `choco install opencode`.
- Credentials: provider keys added with `/connect` "are stored in `~/.local/share/opencode/auth.json`". This is plaintext JSON in the user profile; encryption is **UNVERIFIED**.
- Auth commands: `opencode auth login`, `opencode auth list` / `ls` ("Lists all the authenticated providers as stored in the credentials file"), and `opencode auth logout`.
- Headless and status commands:
  - `opencode run` with `--format json` (raw JSON events) and `-m provider/model`;
  - `opencode models` lists available models;
  - `opencode serve --port N`, with `OPENCODE_SERVER_PASSWORD` for HTTP basic auth;
  - `opencode stats` shows "token usage and cost statistics for your OpenCode sessions".
- Subscription logins inside OpenCode:
  - GitHub Copilot device login;
  - "ChatGPT Plus/Pro" browser auth;
  - OpenCode Zen (curated pay-per-use models) and OpenCode Go ("a low cost subscription plan").
- **Anthropic warning (verbatim):** "There are plugins that allow you to use your Claude Pro/Max models with OpenCode. Anthropic explicitly prohibits this."
  - Bundled plugins were removed "as of 1.3.0".
  - Bunny must never route Claude subscription credentials through OpenCode, and must block an OpenCode connection whose provider is `anthropic` in OAuth/subscription mode.
- Local providers: Ollama, LM Studio, llama.cpp and Atomic Chat, through an OpenAI-compatible `baseURL` in `opencode.json`.

### What Bunny may implement (OpenCode)
- **`native_cli`** adapter: spawn `opencode run --format json -m <provider/model>`.
  - The billing owner depends on the inner provider: Zen/Go, Copilot credits, ChatGPT plan, an API key, or local.
  - So consent must be keyed by the pair (opencode, inner provider). It must never be keyed by "opencode" alone.
- Status: `opencode auth list` gives provider names only. Bunny must never read `auth.json` contents. `opencode models` gives the model list.
- `opencode stats` reads usage from local sessions only. It is an estimate and must not be shown as an authoritative quota.
- Never start `opencode serve` on a LAN-reachable interface.

---

## 7. Cross-provider summary table

| Provider | Modes | Non-billable validation | Status command | Billing separation |
|---|---|---|---|---|
| xAI API | api_key | `GET https://api.x.ai/v1/api-key` (blocked/disabled flags), `GET /v1/models` | n/a | API credits on the Console are separate from the Grok/X subscription ("billing is separate") |
| Grok Build | subscription CLI (browser/device login) or `XAI_API_KEY` | none documented; `grok models`, `grok inspect --json` (fields UNVERIFIED) | none (`grok version`) | subscription pool vs API key; precedence of `XAI_API_KEY` UNVERIFIED, so scrub it |
| Gemini API | api_key / Vertex | `GET .../v1beta/models` | n/a | unpaid tier (250/day Flash) vs pay per token |
| Gemini CLI | Google login (paid/enterprise only after 2026-06-18) / API key / Vertex | none | `/stats model` (interactive) | subscription quota vs API; `GEMINI_API_KEY`/`GOOGLE_API_KEY` must be unset for ADC |
| Antigravity `agy` | Google login (keyring) / API key (needs `modelProvider:gemini`) | none | `/usage` (interactive) | consumer quota vs Gemini API |
| Copilot CLI | `/login`, PAT, `COPILOT_GITHUB_TOKEN` > `GH_TOKEN` > `GITHUB_TOKEN` | none documented for the seat | `/context` | AI Credits (metered tokens) since 2026-06-01; every `-p` run is metered |
| OpenRouter | api_key, OAuth PKCE key, BYOK | `GET /api/v1/key` (limit_remaining, usage, is_free_tier) | n/a | credits; BYOK 5% fee; BYOK falls back to paid shared capacity by default |
| Ollama local | local_runtime | `GET 127.0.0.1:11434/api/tags` | n/a | free, on-device |
| Ollama Cloud | `ollama signin` via daemon, or `OLLAMA_API_KEY` | `GET https://ollama.com/api/tags` (key check UNVERIFIED) | none (`signout` 3P) | usage credits, token-metered; data off-device |
| OpenCode | native CLI wrapping many providers | `opencode auth list`, `opencode models` | `opencode stats` (local estimate) | depends on inner provider; the Claude subscription route is prohibited by Anthropic |

## 8. Design implications for T13.2

1. **Ambient-credential scrub list.** For every native-subscription spawn, remove the variables below unless the connection mode is explicitly API:
   - `ANTHROPIC_API_KEY`
   - `XAI_API_KEY`
   - `GEMINI_API_KEY`, `GOOGLE_API_KEY`, `GOOGLE_APPLICATION_CREDENTIALS`, `GOOGLE_GENAI_USE_VERTEXAI`
   - `COPILOT_GITHUB_TOKEN`, `GH_TOKEN`, `GITHUB_TOKEN`
   - `OPENROUTER_API_KEY`
   - `OLLAMA_API_KEY`
   - `OPENAI_API_KEY`

   Record a redacted note that "ambient key present, suppressed" in Host-only status. Never pass the value to Agents or the phone.
2. **Billing class per connection.** Each connection carries one billing class: `included_subscription`, `metered_subscription_credits` (Copilot AI Credits, Ollama Cloud credits, Grok pool overage), `paid_api`, `free_tier_api`, `local_free` or `unknown`. Consent and final-dispatch checks are keyed by provider, account, billing class and project. Moving to a different class (for example Ollama local to Ollama `:cloud`, OpenRouter BYOK to shared, or Grok subscription to `XAI_API_KEY`) is a provider change that needs fresh consent. This closes the Jev-advice Claude-to-Codex hole in the general case.
3. **Usage truthfulness.** Only OpenRouter (`/api/v1/key`) and xAI key status (`/v1/api-key`, status only, not spend) give real machine-readable data. Everything else (Gemini `/stats`, agy `/usage`, Copilot billing page, Ollama plans, Grok pool) stays UNKNOWN, which matches the T2 rule "UNKNOWN never numeric".
4. **Data-locality labelling.** Ollama cloud detection uses `remote_host`, `remote_model` and the `:cloud` suffix. Any CLI wrapper (OpenCode, Copilot, Grok, agy) is off-device unless it points at local Ollama or LM Studio.
5. **The phone shows view-only, redacted data.** Examples: `redacted_api_key` from xAI and `limit_remaining` from OpenRouter are safe to show; `auth.json`, tokens and key ids are not.
6. **Prohibited route.** Claude Pro/Max credentials through OpenCode or any third-party harness are prohibited (quoted from the OpenCode docs). Bunny must refuse to configure this.
7. **Gemini consumer gap.** Since 2026-06-18, a free or Google One user's `gemini` login no longer works for model calls. The adapter must report `deprecated_for_account_type`, not "auth failed", and offer `agy` (view-only) or a Gemini API key.
