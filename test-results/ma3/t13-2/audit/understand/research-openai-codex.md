# research-openai-codex — OpenAI / Codex connection modes for MA3 T13.2

Research date: 2026-10-13. Read-only. Nothing in the repository was edited. No server, Host or CLI was started.
Codex source was read at openai/codex `main` @ `f6aca7dc461d6a9e0ae12828cd04845c31dd504e` (committed 2026-10-13T15:25:12Z). Copies were saved under `scratchpad/codexsrc/` for reference only.

Quotes come from WebFetch extractions, which return short verbatim fragments. Where the tool paraphrased, the text says so.
Note: `developers.openai.com/codex/*` now returns a 308 redirect to `learn.chatgpt.com/docs/*`. The redirect came from the server and I followed it by hand.

## 0. Sources fetched (all 2026-10-13)

| # | URL | Status |
|---|---|---|
| S1 | https://developers.openai.com/siwc/quickstart | fetched |
| S2 | https://developers.openai.com/siwc | fetched |
| S3 | https://developers.openai.com/siwc/request-client-id | fetched |
| S4 | https://developers.openai.com/siwc/token-sharing-open-source | fetched |
| S5 | https://developers.openai.com/siwc/token-sharing-open-source/sign-in | fetched |
| S6 | https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions | fetched |
| S7 | https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server | fetched |
| S8 | https://developers.openai.com/siwc/token-sharing-open-source/self-hosted-vms | fetched |
| S9 | https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations | fetched |
| S10 | https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference | fetched |
| S11 | https://developers.openai.com/siwc/token-sharing-open-source/errors-and-recovery | fetched |
| S12 | https://learn.chatgpt.com/docs/auth (+ `.md`) — redirected from developers.openai.com/codex/auth | fetched |
| S13 | https://learn.chatgpt.com/docs/app-server — redirected from developers.openai.com/codex/app-server | fetched (2 pages) |
| S14 | https://learn.chatgpt.com/docs/non-interactive-mode | fetched |
| S15 | https://learn.chatgpt.com/docs/pricing | fetched |
| S16 | https://raw.githubusercontent.com/openai/codex/main/LICENSE and README.md | fetched |
| S17 | openai/codex source: `codex-rs/login/src/auth/manager.rs`, `codex-rs/cli/src/login.rs`, `codex-rs/exec/src/lib.rs`, `codex-rs/app-server/src/lib.rs`, `codex-rs/tui/src/lib.rs`, `codex-rs/tui/src/onboarding/auth.rs`, `codex-rs/core/src/realtime_conversation.rs` (via `gh api`) | fetched |
| S18 | https://opencode.ai/docs/providers/ | fetched (other-provider note) |
| S19 | https://docs.ollama.com/cloud | fetched (other-provider note) |
| X1 | https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan | **UNVERIFIED — HTTP 403**. A search found only snippets from sibling help articles. |
| X2 | OpenAI Terms of Use / Service Terms on credential sharing and automated access | **UNVERIFIED — not fetched** |

## (a) What Sign in with ChatGPT (SIWC) gives a third-party app

SIWC has two separate grants:

1. **Identity only** (website/plugin sign-in):
   - Scopes: `openid profile email`.
   - S1: "Identity scopes don't grant access to ChatGPT conversations or OpenAI API resources."
   - **Availability is gated.** S1: "Sign in with ChatGPT is currently available to selected commercial partners through a limited trial."
   - S3: "Sign in with ChatGPT is currently offered to a select group of commercial partners." / "To join the waitlist, complete the Sign in with ChatGPT interest form."
   - A **pre-issued client ID from OpenAI** is needed. You get one through the waitlist or interest form.
2. **ChatGPT plan usage ("token sharing")**:
   - S1: "Using a ChatGPT plan requires separate Responses API scopes that the user must authorize."
   - S1: "ChatGPT plan usage is available to all open-source partners and selected private clients."
   - S1: plan usage "doesn't grant access to the user's API key or conversations."
   - S4: "These docs explain ChatGPT plan usage for open-source and locally hosted apps." / "If you're interested in offering it in a paid or remotely hosted app, complete the interest form."
   - **Registration is dynamic. No pre-registered client ID is needed** (S5):
     - The first authorize call sends `client_id=dynamic_agent_client`, and the callback returns an issued `client_id`.
     - "This direct flow needs neither a client secret nor a partner API key."
     - S4: "The OAuth flow for OSS clients registers a user-defined agent during Sign in with ChatGPT"; "each issued `client_id` is bound to the authenticated user and the workspace selected during registration."
   - Endpoints (S5):
     - authorize `https://auth.openai.com/api/accounts/authorize`
     - token `https://auth.openai.com/api/accounts/oauth/token`
     - resource `https://api.openai.com/v1`
   - Plan scopes (S5): `offline_access resource.invoke chatgpt.tokens.use.direct`.
     - "A valid ID token alone does not authorize ChatGPT plan usage."
     - The app must check that the grant includes `chatgpt.tokens.use.direct`.
   - Mechanics (S5):
     - PKCE S256, `state`, `nonce`.
     - Loopback `http://127.0.0.1:<port>/auth/callback`. The docs say not to use `localhost`.
     - `ext_agent_host_id` is opaque and unique per host. S4: "Use an opaque value, not an email, user ID, or other user-identifying value."
     - `agent_name_hint` is the app name.
     - The user "reviews the requested permissions" and can rename the agent.
   - Token rules (S5/S6):
     - Owner-only atomic files ("`0600` on Unix"); "never commit or log them".
     - "Keep tokens out of browser storage, source control, logs, analytics, and support transcripts."
     - "Never put access or refresh tokens in URLs."
     - "Never combine one registration's client ID with another registration's tokens."
     - Serialize refreshes, because the refresh token rotates.
     - Revoke at the `revocation_endpoint` on sign-out. If revocation can't be confirmed, tell the user.
   - Limits (S6, paraphrased by the tool):
     - Users can set per-app limits in ChatGPT Settings → Usage.
     - For Plus users, the five-hour limit is shared across all apps, including open-source clients.
   - Branding (S1): "Continue with ChatGPT" and "approved OpenAI branding".
   - Preview limits (S9):
     - Must send `store:false`, `stream:true`.
     - No `previous_response_id` over HTTP.
     - These tools are unsupported: image gen, file search, Code Interpreter, computer use, hosted MCP, `tool_search`.
     - Audio/video input and transcription are unsupported.

**How this applies to Bunny:**
- `package.json:3` has `"private": true` and the repo root has no LICENSE file. Bunny does not appear to be open source.
- S4 scopes the dynamic path to "open-source and locally hosted apps". It sends "paid or remotely hosted" apps to the interest form. Whether a private, locally hosted, unlicensed app qualifies is **AMBIGUOUS / UNVERIFIED**.
- The safe position is that Bunny may **not** assume eligibility for SIWC token sharing without either:
  - publishing under an OSS license, or
  - OpenAI confirming eligibility through the interest form.
- Identity-only SIWC needs a partner client ID. Bunny cannot implement it without registration.

## (b) May a local app drive the user's installed Codex CLI / app-server under the user's ChatGPT plan?

**Officially documented as an integration surface:**
- S13: app-server is "the interface Codex uses to power rich clients"; "Use it when you want a deep integration inside your own product."
- S14: "`codex exec` reuses saved CLI authentication by default."
- The user signs in to Codex themselves (`codex login`, `codex login --device-auth`, or app-server `account/login/start`). Bunny then spawns the user's own binary.
- I found no OpenAI text that forbids this. I also found no text that explicitly blesses third-party orchestration of a subscription-authenticated CLI. ToS (X2) is UNVERIFIED.

**Documented constraints:**
- S13: "The app-server command and WebSocket transport are experimental and aren't supported for production workloads."
- stdio is the default transport.
- Non-loopback WebSocket listeners allow unauthenticated connections by default.
- S13: "Clients must send a single `initialize` request per transport connection"; "Set `clientInfo` to identify your integration"; "Use `clientInfo.name` to identify your client for the OpenAI Compliance Logs Platform."
- S14: "Treat `~/.codex/auth.json` like a password: it contains access tokens." / ChatGPT-managed auth in CI: "Do not use this workflow for public or open-source repositories." API keys are the recommended default for automation.
- S12: under ChatGPT sign-in, "Codex usage follows your ChatGPT workspace permissions" (RBAC and retention). Codex cloud requires ChatGPT sign-in.

**Alternative (SIWC + app-server, S7):**
- Bunny would own the OAuth token and launch:

```
codex app-server --listen stdio:// -c 'model_provider="openai_chatgpt_plan"' \
  -c 'model_providers.openai_chatgpt_plan.base_url="https://api.openai.com/v1"' \
  -c 'model_providers.openai_chatgpt_plan.env_key="ACCESS_TOKEN"' \
  -c 'model_providers.openai_chatgpt_plan.wire_api="responses"' \
  -c 'model_providers.openai_chatgpt_plan.requires_openai_auth=false' \
  -c 'model_providers.openai_chatgpt_plan.supports_websockets=false'
```

- S7: "Your app should read its own token file and supply the access token to the child process."
- S9: "Your app must refresh the OAuth token." After a refresh, restart app-server and call `thread/resume`.
- S7: `model/list` is "a catalog, not an entitlement check"; only `turn.status=="completed"` means success.
- This mode depends on SIWC eligibility from (a), so for Bunny it is blocked until that is clarified.

## (c) Detecting the auth mode without reading `~/.codex/auth.json`

1. **`codex login status`** (S12: "Run `codex login status` to see the active authentication method"). Source `codex-rs/cli/src/login.rs` `run_login_status`:
   - Writes to **stderr**.
   - Exit 0, with one of:
     - `"Logged in using ChatGPT"` (Chatgpt | ChatgptAuthTokens)
     - `"Logged in using an API key - <safe_format_key masked>"`
     - `"Logged in using access token"`
     - `"Logged in using personal access token"`
     - `"Logged in using Amazon Bedrock API key"`
     - `"Logged in using Amazon Bedrock AWS access keys"`
     - `"Logged in using workload identity"`
   - Exit 1 with `"Not logged in"` or `"Error checking login status: …"`.
   - **Caveat:** it calls `load_auth(/*enable_codex_api_key_env*/ false)`, so it **ignores `CODEX_API_KEY`**. It can print "ChatGPT" while `codex exec` would actually bill an API key (see below).
2. **app-server `account/read`** (S13). This is the preferred, structured option:
   - Request `{ "method":"account/read","id":1,"params":{"refreshToken":false} }`.
   - Result `account` is `null` (signed out) or `{type:"apiKey"|"chatgpt"|"amazonBedrock", email, planType}`, plus `requiresOpenaiAuth`.
   - "`requiresOpenaiAuth` reflects the active provider; when `false`, Codex can run without OpenAI credentials."
   - The `account/updated` notification carries `authMode` (`"apikey"`/`"chatgpt"`/null) and `planType`.
   - Bunny must redact `email` before it reaches the phone or Agents.
3. **`account/rateLimits/read`** (S13):
   - Returns `rateLimits` (legacy single bucket), `rateLimitsByLimitId` (e.g. `codex`), and `{primary,secondary}:{usedPercent,windowDurationMins,resetsAt(sec)}`.
   - Also `rateLimitResetCredits.availableCount` and `credits` when present.
   - The `account/rateLimits/updated` notification pushes changes.
   - Bunny already uses this at `src/lib/bunny-host/codex-probe.server.ts:77`.
4. Other app-server account methods (S13):
   - `account/login/start` with `type: "apiKey" | "chatgpt" | "chatgptDeviceCode" | "chatgptAuthTokens"` (the last one is experimental and needs `experimentalApi`).
   - `account/logout`.

**Credential precedence, verified in source (S17 `manager.rs` `load_auth`).** The order is:
1. `CODEX_API_KEY` env, when `enable_codex_api_key_env` and API key mode is allowed. Comment in the source: "API key via env var takes precedence over any other auth method."
2. Ephemeral external ChatGPT tokens.
3. `CODEX_ACCESS_TOKEN` env (agent identity / PAT).
4. The persisted store (file/keyring/auto).

Where `enable_codex_api_key_env` is set:
- **true** for `codex exec` (`exec/src/lib.rs:745`). Per S14 it also applies to `codex review`, the TS SDK and `exec-server --remote`.
- **false** for app-server (`app-server/src/lib.rs:551,585`), the TUI (`tui/src/lib.rs:726`), and `login status`.

How `OPENAI_API_KEY` is used:
- It is **not** an auth source for exec or app-server.
- It is used for TUI onboarding prefill (`tui/src/onboarding/auth.rs:852`).
- It is a **silent fallback for realtime conversation even under ChatGPT/SIWC sessions** (`core/src/realtime_conversation.rs:1939-1944`, the "TODO… Remove this temporary fallback").

**Hazard: `forced_login_method`.**
- S12: "If the active credentials don't match the configured restrictions, Codex logs the user out and exits."
- In source, `enforce_login_restrictions…` loads with the env key enabled. With `forced_login_method="chatgpt"` and `CODEX_API_KEY` set, it calls `logout_with_message(...)`, which **deletes the user's stored credentials**.
- Bunny must not use this as a guard.

## (d) Billing separation

- S12: "Sign in with ChatGPT for subscription access" vs "Sign in with an API key for usage-based access".
- S12: "When you sign in with an API key, Codex uses standard API pricing instead of included ChatGPT plan credits." / "OpenAI bills API key usage through your OpenAI Platform account at standard API rates." / "With an API key, usage follows your API organization's retention and data-sharing settings instead."
- S15: "API token prices are separate from subscription usage; don't use them to estimate included tasks."
- S15: plans that include Codex: "ChatGPT Free, Go, Plus, Pro, Business, Edu, or Enterprise".
- S15: "Pro plans currently have no five-hour limit"; "Weekly limits may also apply."
- S15: credits are "the unit used to pay for eligible usage on credit-based plans". Extra local usage via an API key is billed at API rates (tool paraphrase).
- S11 (SIWC): "OpenAI does not silently switch the request to another billing path."
  - Errors: `subscription_sharing_usage_limit_exceeded` (429): "Pause new requests…". `subscription_sharing_user_not_eligible` (403): "do not repeat the same request or loop through OAuth". `chatpass_v2_scope_not_authorized` (403).
  - Switching to the user's own API key must be an explicit, user-facing choice.
  - This supports the T13.2 rule that ambient keys must not silently move subscription work to paid API.

## Table: connection mode → officially supported → what Bunny may implement without a registered client → evidence

| Mode | Officially supported? | Bunny may implement (no registered client) | Evidence |
|---|---|---|---|
| Native subscription CLI: user runs `codex login` (browser) / `--device-auth`; Bunny spawns `codex exec --json` / `codex app-server --stdio` | Yes (documented auth and integration surfaces). App-server is "experimental". Third-party orchestration ToS is UNVERIFIED | Yes. Detect via `account/read` (+ `login status` as a cross-check). Usage via `account/rateLimits/read`. Scrub `CODEX_API_KEY`, `OPENAI_API_KEY` and `CODEX_ACCESS_TOKEN` from the child env. Never read `auth.json` | S12 "Run `codex login`, then complete the browser flow."; S13 "Use it when you want a deep integration inside your own product."; S14 "`codex exec` reuses saved CLI authentication by default." |
| Login initiated by Bunny through app-server `account/login/start` (`chatgpt` / `chatgptDeviceCode`) | Yes (documented RPC). The credential stays in Codex's store | Yes. Show `authUrl` or `verificationUrl`+`userCode` on the desktop only. Device code must be enabled in ChatGPT security settings | S13 "`account/login/start` - begin login (`apiKey`, `chatgpt`, `chatgptDeviceCode`, or experimental `chatgptAuthTokens`)." |
| API key (OpenAI Platform) via `codex login --with-api-key` or `CODEX_API_KEY` | Yes | Only on explicit per-provider/account/project consent, labelled "paid API". Pass the key only to that dispatch's env (S14: "set `CODEX_API_KEY` only for the Codex invocation that needs it") | S12 "Codex uses standard API pricing instead of included ChatGPT plan credits." |
| SIWC plan usage (token sharing) + Bunny-owned OAuth token → app-server `ACCESS_TOKEN` | Yes for "open-source and locally hosted apps", with dynamic registration. Paid/remote apps → interest form | Technically no client ID is needed (`dynamic_agent_client`). Eligibility for a private (`"private": true`, unlicensed) Bunny is AMBIGUOUS. Defer, or ship behind a flag after confirmation | S5 "This direct flow needs neither a client secret nor a partner API key."; S4 "If you're interested in offering it in a paid or remotely hosted app, complete the interest form." |
| SIWC identity-only ("Continue with ChatGPT" sign-in) | Limited trial for selected commercial partners | No. A partner client ID is required | S1 "currently available to selected commercial partners through a limited trial"; S3 "To join the waitlist, complete the Sign in with ChatGPT interest form." |
| `chatgptAuthTokens` (externally supplied ChatGPT tokens into app-server) | Experimental (`experimentalApi`) | No. There is no legitimate token source without SIWC, and copying Codex tokens is not documented | S13 "Externally managed tokens (experimental, requires `experimentalApi`)" |
| Copy or read `~/.codex/auth.json` | Documented only as a CI/headless fallback the user does themselves | No. Treat the file as a password and never read it | S14 "Treat `~/.codex/auth.json` like a password: it contains access tokens." |
| View-only (phone) | n/a | Yes. Redacted plan type, auth mode, usage % and reset times. No email, no token, no masked key | S6 (show the active account in settings); T13.2 rule |
| Remote/self-hosted transfer | Documented for SIWC only; "Host-specific usage attribution and revocation … are not yet available" | No for T13.2 | S8 |

## Current Bunny code that T13.2 must change (evidence)

- `src/lib/bunny-host/adapters.server.ts:227` and `:351` — `const env = { ...process.env }; delete env.CLAUDECODE;`.
  - The Codex dispatch inherits ambient `CODEX_API_KEY` / `OPENAI_API_KEY`.
  - `codex exec` (args at `:569`: `["exec","--json",…,"--model",task.model,"-"]`) gives `CODEX_API_KEY` **top precedence**. That silently moves subscription work to paid API, which is the OpenAI-side equivalent of the ambient `ANTHROPIC_API_KEY` concern.
- `src/lib/bunny-host/adapters.server.ts:437-447` (`CodexAdapter.detect`) — sign-in is judged only from the `codex login status` **exit code**.
  - It never separates ChatGPT from API key.
  - The status check ignores `CODEX_API_KEY`, so the label can be wrong.
  - Test fixture `m2.test.ts:70` already models the "Logged in using ChatGPT" stderr.
- `src/lib/bunny-host/codex-probe.server.ts:43` (Windows `group.spawn(..., process.env, ...)`) and `:63` (POSIX spawn, inherited env) — the app-server probe inherits the full env. Under app-server this is harmless for `CODEX_API_KEY` (its env flag is false), but it should still be scrubbed for consistency.
  - `:73` `initialize` with `clientInfo:{name:"bunny_a_host",version:"0.2.0"}` — keep it stable, because S13 says it identifies the client in Compliance Logs.
  - `:75-84` reads `model/list` and `account/rateLimits/read`. `account/read` is **not** called yet. Adding it (with `email` redacted) is the documented way to get auth mode and `planType`.

## Recommended adapter facts for the Connection Registry (OpenAI/Codex)

- `connectionMode`: one of `native_subscription_cli` | `api_key` | `siwc_plan` (deferred) | `view_only`.
  - Derive it from `account/read.account.type` plus whether Bunny injected a consented key. Never infer it from the ambient env.
- Final-dispatch gate:
  - Build the child env from an allow-list, stripping `CODEX_API_KEY`, `OPENAI_API_KEY`, `CODEX_ACCESS_TOKEN` and `OPENAI_BASE_URL`.
  - Re-read `account/read` (or use cached recent evidence). If `type !== "chatgpt"` for a subscription-consented task, refuse. Do not fall back (S11 principle).
  - Run the same gate on retries and on any Jev-advised provider move (T13.1 limitation 7).
- Never pass `-c forced_login_method=...`, because it can log the user out (source above).
- Realtime/voice: Codex realtime silently uses `OPENAI_API_KEY` under ChatGPT auth (`realtime_conversation.rs:1939`). Keep the key out of the env unless API consent exists.

## Other providers (user asked "even for all provider like ollama, opencode, etc") — brief, OpenAI-adjacent only

- **opencode** (S18):
  - Credentials from `/connect` are "stored in `~/.local/share/opencode/auth.json`". `opencode auth list` lists them.
  - Offers a "ChatGPT Plus/Pro" browser login.
  - For Claude Pro/Max plugins, the page says "Anthropic explicitly prohibits this", and they have not been bundled since 1.3.0.
  - Ollama is configured as an OpenAI-compatible provider with `"baseURL": "http://localhost:11434/v1"`.
  - Implication: a Bunny opencode adapter should show auth state via `opencode auth list` (names/types only, never file contents). It must not offer Claude subscription routing through opencode.
- **Ollama** (S19):
  - Cloud API access uses `OLLAMA_API_KEY`; the app/CLI must "sign in to use cloud models" (e.g. `gemma4:cloud`).
  - Users can "disable cloud features" to "use only local models".
  - Implication: split modes into `local_runtime` (no account) and `cloud` (account/plan, consent required). An ambient `OLLAMA_API_KEY` should be treated like the other ambient keys.
- Plan limits for Ollama cloud: UNVERIFIED (the page only links to usage/pricing).

## UNVERIFIED items

- The help article X1 (403).
- OpenAI ToS on third-party automation of a subscription CLI (X2).
- Whether a private/unlicensed but locally hosted app qualifies for SIWC dynamic registration.
- Whether `OPENAI_API_KEY` affects any Codex path other than TUI prefill and realtime. Checked only via a code search of current `main`; the installed CLI version may differ.
- `CODEX_API_KEY` precedence was verified on `main` only. Re-verify on the installed CLI version before relying on it.
