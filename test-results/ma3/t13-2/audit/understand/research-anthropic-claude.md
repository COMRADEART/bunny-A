# Research: Anthropic / Claude Code account and subscription bridge (MA3 T13.2)

Fetched 2026-10-13. Read-only work: no repo files edited, no servers or Hosts touched. Local probes I ran: `claude --version`, presence-only env checks, and `claude auth status` with identity fields redacted.

Quote fidelity: code.claude.com pages came back as raw markdown, so their quotes are verbatim. support.claude.com and anthropic.com/legal pages came back only as short quoted excerpts from the fetch summarizer. Those are marked (excerpt). Anything not fetched is marked UNVERIFIED.

User scope note: the relayed request says "even for all provider like ollama, opencode, etc". This report covers the Anthropic side only. §7 explains how the Anthropic rules apply when another harness (OpenCode, Cline, Cursor) tries to use a Claude account.

---

## 1. Sources fetched (all 2026-10-13)

| # | URL | Page date | Fidelity |
|---|---|---|---|
| S1 | https://support.claude.com/en/articles/13189465-log-in-to-your-claude-account | "Last updated: May 19, 2026" | excerpt |
| S2 | https://support.claude.com/en/articles/11145838-use-claude-code-with-your-pro-or-max-plan | "Updated this week" | excerpt |
| S3 | https://support.claude.com/en/articles/12304248-manage-api-key-environment-variables-in-claude-code | "Last updated: May 5, 2026" | excerpt |
| S4 | https://code.claude.com/docs/en/authentication | n/a | verbatim |
| S5 | https://code.claude.com/docs/en/cli-reference | n/a | verbatim |
| S6 | https://code.claude.com/docs/en/headless | n/a | verbatim |
| S7 | https://code.claude.com/docs/en/legal-and-compliance | n/a | verbatim |
| S8 | https://code.claude.com/docs/en/agent-sdk/overview | n/a | verbatim |
| S9 | https://code.claude.com/docs/en/agent-sdk/quickstart | n/a | verbatim |
| S10 | https://code.claude.com/docs/en/env-vars | n/a | verbatim (rows) |
| S11 | https://code.claude.com/docs/en/agent-sdk/typescript | n/a | verbatim (types) |
| S12 | https://code.claude.com/docs/en/costs | n/a | verbatim |
| S13 | https://www.anthropic.com/legal/consumer-terms | "Effective October 8, 2025" | excerpt |
| S14 | https://www.anthropic.com/legal/aup | "Effective November 12, 2026". That date is after today, so this is probably a pre-published version. The page links a "Previous Version", which I did not fetch, so the AUP text currently in force is UNVERIFIED. | excerpt |

UNVERIFIED (not fetched or not read in full):
- The full `apiKeyHelper` entry in settings-reference. The page was truncated at 100k chars.
- The Commercial Terms text: https://www.anthropic.com/legal/commercial-terms
- Whether `claude auth status` reports `api_key` when only an unapproved ambient key is present.
- Whether the `system/init` event is emitted before the first billable model request.

---

## 2. Key evidence (quotes)

### 2.1 Claude Code is a native app that subscription OAuth is meant for

- S1 (excerpt): included usage is for native Anthropic apps, named as "the Claude web, desktop, and mobile applications and Claude Code". Also: "Subscription plans can only be used by subscribers".
- S7 verbatim: "**OAuth authentication** is intended exclusively for purchasers of Claude Free, Pro, Max, Team, and Enterprise subscription plans and is designed to support ordinary use of Claude Code and other native Anthropic applications."
- S7 verbatim: "Advertised usage limits for Pro and Max plans assume ordinary, individual usage of Claude Code and the Agent SDK."

### 2.2 Headless and scripted use is documented

- S6 verbatim: "To run Claude Code in non-interactive mode, pass `-p` with your prompt and the CLI options you need". The page is titled "Run Claude Code programmatically" and says this mode is "available as a CLI for scripts and CI/CD".
- S5 verbatim: "`claude -p "query"` | Query via SDK, then exit".
- S4 verbatim (setup-token): "For CI pipelines, scripts, or other environments where interactive browser login isn't available, generate a one-year OAuth token with `claude setup-token`" … "This token authenticates with your Claude subscription and requires a Pro, Max, Team, or Enterprise plan."
- S7 verbatim: "Nor does it prevent an end user from signing in to the unmodified Claude Code binary with their own Claude subscription, including where a platform hosts Claude Code".

### 2.3 Prohibitions

- S7 verbatim: "Anthropic does not permit third-party developers to offer Claude.ai login into their own applications, or to route requests through Free, Pro, or Max plan credentials on behalf of their users. Moreover, developers may not collect, store, or intermediate Claude.ai credentials or session tokens — sign-in to a Claude account must complete through Anthropic's own flow."
- S7 verbatim: "**The Claude Code binary must not be modified.** … customers may not remove, disable, or restrict any authentication method built into it". Also: "Customers may not pay for, resell, or intermediate Claude usage on their end users' behalf. Each end user must authenticate with their own Anthropic API key, Claude subscription plan credentials, or 3P inference provider credential".
- S7 verbatim: "Anthropic reserves the right to take measures to enforce these restrictions and may do so without prior notice."
- S8 and S9 verbatim (Note): "Unless previously approved, Anthropic does not allow third party developers to offer claude.ai login or rate limits for their products, including agents built on the Claude Agent SDK. Use the API key authentication methods described in the Quickstart instead."
- S1 (excerpt): prohibited uses include tools that "misrepresent their identity to Anthropic's servers" and attempts to "route third-party traffic against subscription limits". Such use "is prohibited and such use may be enforced against."
- S1 (excerpt): for third-party software, "The preferred way to access Anthropic services using third-party software, tools, or services" is API key authentication through the Console or a cloud provider. Anthropic "may" allow some third-party tools for paid subscribers but bill them to usage credits.
- S13 (excerpt, §3 item 7): users may not "access the Services through automated or non-human means, whether through a bot, script, or otherwise". The exception is: "Except when you are accessing our Services via an Anthropic API Key or where we otherwise explicitly permit it."
- S13 (excerpt, §2): "You may not share your Account login information, Anthropic API key, or Account credentials with anyone else", and you may not "make your Account available to anyone else".
- S14 (excerpt, "Do Not Abuse Our Platform"): "Resell, proxy, or otherwise provide access to Claude through unauthorized means", "including services that route requests through consumer subscriptions or misrepresent the product or client being used".

### 2.4 Licence

- S7 verbatim: Claude Code use is subject to the "Commercial Terms of Service - for Team, Enterprise, and Claude API users" and the "Consumer Terms of Service - for Free, Pro, and Max users".
- S8 verbatim: "Use of the Claude Agent SDK is governed by Anthropic's Commercial Terms of Service".

### 2.5 Authentication precedence (S4, verbatim and complete)

1. Cloud provider credentials, when `CLAUDE_CODE_USE_BEDROCK`, `CLAUDE_CODE_USE_VERTEX`, or `CLAUDE_CODE_USE_FOUNDRY` is set.
2. The `ANTHROPIC_AUTH_TOKEN` env var (Bearer).
3. The `ANTHROPIC_API_KEY` env var. "In interactive mode, you are prompted once to approve or decline the key … **In non-interactive mode (`-p`), the key is always used when present.**"
4. `apiKeyHelper` script output.
5. The `CLAUDE_CODE_OAUTH_TOKEN` env var, a long-lived token from `claude setup-token`.
6. Anthropic profile and federation credentials (`ANTHROPIC_PROFILE`, `ANTHROPIC_FEDERATION_RULE_ID` + `ANTHROPIC_ORGANIZATION_ID`).
7. "Subscription OAuth credentials from `/login`. This is the default for Claude Pro, Max, Team, and Enterprise users."

A signed-in Claude apps gateway session outranks all of the above.

### 2.6 Billing effect of an ambient API key

- S10 verbatim (`ANTHROPIC_API_KEY`): "When set, this key is used instead of your Claude Pro, Max, Team, or Enterprise subscription even if you are logged in. In non-interactive mode (`-p`), the key is always used when present. … To use your subscription instead, run `unset ANTHROPIC_API_KEY`".
- S2 (excerpt): if the variable is set, "Claude Code will use this API key for authentication instead of your Claude subscription", "resulting in API usage charges rather than using your subscription's included usage."
- S3 (excerpt): "Claude Code prioritizes environment variable API keys over authenticated subscriptions." With a key set, "you'll be charged via API pay-as-you-go rates using the API account associated with that key." Removal on Windows: PowerShell "Remove-Item Env:ANTHROPIC_API_KEY", or delete it from System Environment Variables.
- S4 verbatim: "Run `unset ANTHROPIC_API_KEY` to fall back to your subscription, and check `/status` to confirm which method is active."
- S6 verbatim (bare mode): "In bare mode, Claude Code never reads OAuth credentials or the system keychain." Bare mode therefore forces API-key billing. S4 adds: "Bare mode does not read `CLAUDE_CODE_OAUTH_TOKEN`."
- S12 verbatim: "Claude Max and Pro subscribers have usage included in their subscription, so the session cost figure isn't relevant for billing purposes." S11 says `total_cost_usd` "is an estimate, not a billing statement".

### 2.7 Reading auth state with supported commands

- S5 verbatim: "`claude auth status` | Show authentication status as JSON. Use `--text` for human-readable output. Exits with code 0 if logged in, 1 if not. The JSON includes a `configDirectory` field … The JSON's `authMethod` field is one of `none`, `claude.ai`, `oauth_token`, `api_key`, `api_key_helper`, or `third_party`".
- S5 verbatim: "`claude auth login` | Sign in to your Anthropic account. Use `--email` …, `--sso` …, and `--console` to sign in with Anthropic Console for API usage billing instead of a Claude subscription". Also: "`claude auth logout` | Log out from your Anthropic account".
- S11 verbatim: the `system/init` stream event carries `apiKeySource: ApiKeySource`, which is one of:
  - `"ANTHROPIC_API_KEY"`
  - `"apiKeyHelper"`
  - `"/login managed key"`
  - `"none"`: "No API key. The session authenticates another way, such as a claude.ai login, a bearer token, or a cloud provider".
- S11 verbatim: `SDKRateLimitEvent.rate_limit_info.errorCode?: "credits_required"`. "When `errorCode` is `"credits_required"`, the rejection is from a claude.ai subscription whose included usage is exhausted".
- S4 verbatim (credential storage): "On Windows, credentials are stored in `%USERPROFILE%\.claude\.credentials.json`" and "Claude Code manages `.credentials.json` through `/login` and `/logout`."

Local observation (2026-10-13, Claude Code 2.1.296):
- `claude auth status` returned keys `loggedIn, authMethod, apiProvider, analyticsDisabled, projectsDirectory, configDirectory, email, orgId?, orgName?, subscriptionType`, with values `authMethod:"claude.ai"`, `apiProvider:"firstParty"`, `subscriptionType:"pro"`. The identity fields were redacted in the probe. `subscriptionType` is not in the documented field list, and community issues report it can be null or wrong for Max subscribers, so treat it as advisory.
- `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `CLAUDE_CODE_OAUTH_TOKEN` and `ANTHROPIC_BASE_URL` are unset in the session environment and in the persistent User and Machine environment.

---

## 3. Answers

### (a) Running your own Claude Code CLI headlessly from a local orchestrator

**Verdict: documented and permitted, with conditions.** This is my reading of the documents, not legal advice. Evidence:
- Claude Code is named as a native app that subscription OAuth is for (S1, S7).
- `-p` is documented for "scripts and CI/CD" (S6).
- `setup-token` is a subscription credential "for CI pipelines and scripts" (S4).
- S7 explicitly does not prevent "an end user from signing in to the unmodified Claude Code binary with their own Claude subscription, including where a platform hosts Claude Code".
- The Consumer Terms ban on automated access has a "where we otherwise explicitly permit it" exception (S13), and the documented `-p` path is the strongest such explicit permission available.

Conditions that follow from the evidence:
1. Run the unmodified binary as published. Bunny spawns the real `claude` and does not strip its auth methods.
2. Use only the user's own subscription, for that same user. Bunny must not let another person's Tasks or devices spend this account. That would be "make your Account available to anyone else" (S13) and "on behalf of their users" (S7). Phone access by the same owner viewing their own Host is not a third party.
3. Sign-in happens only through Anthropic's flow. The user runs `claude` or `claude auth login` themselves. Bunny never hosts a login UI, never proxies OAuth, and never reads or stores `.credentials.json` or session tokens (S7).
4. "Ordinary, individual usage" (S7). Heavy fan-out or 24/7 automation on a Pro/Max plan risks crossing that line. The documents set no number, so this is UNQUANTIFIED. Bunny should surface it rather than hide it.
5. If Bunny is ever distributed to other people, the S8/S9 Note applies: a third-party product may not offer claude.ai login or subscription rate limits "unless previously approved". The safe stance is that Bunny never offers Claude login. It only detects a login the user made in the official CLI.

### (b) What is explicitly prohibited

- Reusing subscription OAuth credentials or session tokens in another app, SDK, proxy or harness. S7 bans collecting, storing or intermediating them. S14 bans services that "route requests through consumer subscriptions or misrepresent the product or client being used". S1 bans tools that "misrepresent their identity to Anthropic's servers".
- Offering claude.ai login inside a third-party app or Agent SDK product without approval (S7, S8, S9).
- Paying for, reselling or intermediating Claude usage for end users (S7, S14).
- Modifying the binary or removing its auth methods (S7).
- Sharing account credentials or API keys, or making the account available to others (S13).

### (c) Reading auth state without touching `~/.claude/.credentials.json`

1. Preflight: `claude auth status`, with the same env, config dir and settings the dispatch will use. It prints JSON and exits 0 or 1 (S5). Gate on `loggedIn===true`, plus an `authMethod` that matches the consented mode (§4).
2. Per run: read `apiKeySource` from the `system/init` event in the stream-json output (S11). The subscription mode requires `"none"`, together with an `authMethod` of `claude.ai` from preflight.
3. In the stream: `rate_limit_event` carries utilization, `resetsAt`, and `errorCode:"credits_required"` (S11).

The interactive `/status` command is not available in `-p` mode (S6: "Built-in commands that only run in the terminal interface, such as `/login`, aren't available"). The credentials file is managed only by `/login` and `/logout` (S4), and Bunny must never read it.

### (d) How an ambient `ANTHROPIC_API_KEY` changes billing, and the guard

With `-p`, any `ANTHROPIC_API_KEY` in the child's environment is "always used when present". There is no prompt, and it takes precedence over the subscription login (S4, S10). Usage is then billed at API pay-as-you-go rates to the key's account (S3). `ANTHROPIC_AUTH_TOKEN` (rank 2), `apiKeyHelper` (rank 4) and the `CLAUDE_CODE_USE_*` cloud vars (rank 1) also outrank `/login`. `--bare` never reads OAuth (S6).

Current Bunny code is exposed:
- `src/lib/bunny-host/adapters.server.ts:227` (`spawnSession`, non-Windows) and `:351` (Windows `OwnedProcessGroup` path) both build `const env = { ...process.env }; delete env.CLAUDECODE;`. Every ambient Anthropic auth variable is passed through to `claude -p`.
- `ClaudeAdapter.detect()` (`adapters.server.ts:511-537`) parses `authMethod` but only displays it (`:535`). It sets `authenticated=true` for any `loggedIn:true`, including `api_key`.
- `ClaudeNormalizer.normalize` (`src/lib/bunny-host/events.ts:193-228`) ignores `apiKeySource` on init.
- `claudeLaunchArgs` (`adapters.server.ts:572-578`) uses `--safe-mode`. Per S5, under `--safe-mode` "Authentication, model selection, built-in tools, and permissions work normally", so `apiKeyHelper` from user settings still applies on write runs. Read runs pass `--setting-sources ""` and `--restricted`.
- Precedent for an allowlist environment: `workerEnvironment()` and `WORKER_ENV_ALLOWLIST` in `src/lib/bunny-host/voice/voice-worker.server.ts:236-249`, tested in `voice-worker-env.test.ts:9`.
- Today the machine is not exposed: all of these variables are unset.

Recommended guard (fail closed, enforced at FINAL dispatch and on every retry):
1. **Env scrub per connection mode.** For `claude.subscription`, remove `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL`, `CLAUDE_CODE_USE_BEDROCK`, `CLAUDE_CODE_USE_VERTEX`, `CLAUDE_CODE_USE_FOUNDRY`, `CLAUDE_CODE_USE_ANTHROPIC_AWS`, `ANTHROPIC_PROFILE`, `ANTHROPIC_FEDERATION_RULE_ID`, `ANTHROPIC_ORGANIZATION_ID`, `CLAUDE_CODE_OAUTH_TOKEN` and `CLAUDE_CONFIG_DIR` (unless the registry pins it). Matching should be case-insensitive on Windows, as `workerEnvironment` already does. Better still, build an allowlist environment.
2. **Preflight `claude auth status` in that same scrubbed env.** Require `authMethod==="claude.ai"` and `apiProvider==="firstParty"`. If it reports `api_key` or `api_key_helper`, the cause is settings (apiKeyHelper) or a stored Console key. Refuse with "would bill API", and never silently downgrade to API billing.
3. **Runtime tripwire.** On `system/init`, if `apiKeySource !== "none"` in subscription mode, terminate the process group and mark the run `billing_mode_mismatch`. Whether init precedes the first billable request is UNVERIFIED, which is why the preflight (step 2) is the primary gate.
4. **Never add `--bare` to subscription runs** (S6).
5. **API-key mode is a separate, explicit, consented connection.** Bunny injects the key from its own vault (DPAPI, like `jev-secrets.server.ts`) only into that child process. Show "billed at API rates to the key owner" (S3). Optionally pass `--max-budget-usd`. Note that this cap uses a client-side estimate (S5).

---

## 4. Mode table (Anthropic / Claude)

| Mode | How it authenticates | Billing | Status | Bunny may | Bunny must not | Evidence |
|---|---|---|---|---|---|---|
| `claude.subscription` (native CLI login) | The user ran `claude` or `claude auth login` in the official CLI. Bunny spawns `claude -p`. | Plan usage (5-hour and weekly windows, shared with claude.ai, S2). Usage credits only if the user enabled them. | **Permitted**, own use, unmodified binary | Run `claude auth status`. Read `authMethod`, `apiKeySource`, `rate_limit_event`. Scrub env. | Read or store `.credentials.json`. Run its own OAuth UI. Let other users or devices dispatch on this account. Add `--bare`. | S1, S4 #7, S6, S7 |
| `claude.subscription-token` (`CLAUDE_CODE_OAUTH_TOKEN` from `claude setup-token`) | One-year subscription OAuth token in env | Plan usage | Documented for "CI pipelines and scripts" when the user puts it in their own env | Detect `authMethod:"oauth_token"`. Show it as a subscription. | Prompt for, store or forward the token. "developers may not collect, store, or intermediate … session tokens" (S7). Recommend view-only plus a user-managed env. | S4, S5, S7 |
| `claude.console-login` (`claude auth login --console`, keyless profile or `/login managed key`) | Console OAuth or a managed key | API pay-as-you-go | Permitted | Detect `apiKeySource:"/login managed key"`. Label it "API billing". | Treat it as a subscription. | S4, S5, S11 |
| `anthropic.api-key` (user's own Console key) | `ANTHROPIC_API_KEY` injected by Bunny from its vault into one child, or the user's `apiKeyHelper` | API rates to the key owner | **Preferred path for third-party software** (S1, S7, S9) | Use it with explicit per-project consent, a budget cap, and the key never shown to Agents. | Inherit it ambiently into subscription runs. Share keys across users (S13). | S1, S3, S7, S9, S10, S13 |
| `anthropic.cloud` (Bedrock, Vertex, Foundry, Claude Platform on AWS) | `CLAUDE_CODE_USE_*` plus the cloud's credentials | Cloud account | Permitted | Use it as a separate consented connection | Let it activate accidentally (it ranks #1) | S4, S9 |
| `anthropic.gateway` (`ANTHROPIC_BASE_URL` or `ANTHROPIC_AUTH_TOKEN`) | Bearer token to a proxy | Depends on the proxy | Permitted only for API or cloud credentials | Disclose it | Route subscription credentials through a proxy (S14) | S4, S10, S14 |
| `claude.identity` / view-only (phone) | No credentials. Redacted status only. | n/a | Safe | Show provider, mode, loggedIn, plan label, windows and reset times | Show email, org IDs, tokens or credential handles | S7 (no intermediation) |
| Third-party harness using Claude login (OpenCode, Cline, Cursor with Claude Pro/Max OAuth) | That harness's own Claude OAuth | Subscription, or usage credits if Anthropic allows it | **Prohibited**, or at best "may" be billed to usage credits (S1) | Detect it and show it as "not supported by Anthropic terms" | Route or dispatch through it | S1, S7, S14 |
| `claude-agent-sdk` with claude.ai login inside Bunny | The SDK binary using claude.ai login | Subscription | **Not allowed for third-party products** "unless previously approved" | — | Offer it | S8, S9 |

---

## 5. Consent and dispatch implications (T13.1 limitation 7)

- When accepted Jev advice moves a Task from Claude to Codex, that is a change of account and billing. The Connection Registry should record consent per (provider, account fingerprint without PII, connection mode, project). The final dispatch must re-check consent against the actual adapter and mode, and so must every retry and fallback.
- Claude's own `--fallback-model` stays inside the same account, so it is not a cross-vendor move.
- Account identity for consent can use a hash of `orgId` or `email` from `claude auth status` that is never displayed. Changing `CLAUDE_CONFIG_DIR` changes the account (S4: "Each directory has its own settings, session history, and claude.ai login or API key").

## 6. Usage data and retention notes (for `jev_usage` and the usage UI)

- For subscription runs, store `rate_limit_event` utilization and `resetsAt`, and token counts from `modelUsage`. Store `total_cost_usd` labelled as an estimate. Do not show it as spend for subscription users (S11, S12).
- `credits_required` means the plan is exhausted. Bunny must not auto-purchase or auto-switch to API mode (S11).

## 7. Cross-provider note (user request "even for all provider")

- OpenCode: `adapters.server.ts` `DetectOnlyAdapter` runs `opencode auth list`. If OpenCode's stored credential for Anthropic is a Claude Pro/Max OAuth login, routing work through it falls under S14 ("route requests through consumer subscriptions or misrepresent the product or client being used") and S1. Bunny should classify OpenCode+Anthropic as API-key-only.
- OpenCode with non-Anthropic providers, Ollama (local) and Laya (local) are outside Anthropic's terms. Each needs its own vendor research, which is not covered here.
- Cline and Cursor: the same rule applies. Anthropic access through them should use API-key billing.

## 8. Open items (UNVERIFIED)

1. Whether `claude auth status` reports `api_key` when an unapproved ambient key exists and no interactive approval was given. Verify live in an isolated config dir with a dummy key, which incurs no billing because the key is invalid.
2. Whether a `--settings '{"apiKeyHelper":null}'` override neutralises a user-settings helper on write runs.
3. The ordering of `system/init` relative to the first model request.
4. The AUP version currently in force: the fetched version is effective November 12, 2026.
5. The Commercial Terms wording.
6. Any numeric threshold for "ordinary, individual usage".
