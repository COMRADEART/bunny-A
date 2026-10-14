# adapters-env: provider adapters, native CLI launch, env inheritance, auth probing (read-only investigation)

Repo: C:/Users/allam/Documents/new/bun-router, branch claude/ma3-t9-phone-remote, HEAD e449456. Nothing was edited, and no Host or server was started or stopped.
Scope: covers ALL providers (codex, claude, ollama, opencode, cline, cursor), per the user's request "even for all provider like ollama, opencode, etc".

---

## 0. Provider set and adapter wiring

- `ProviderId = "codex" | "claude" | "ollama" | "opencode" | "cline" | "cursor"`: src/lib/orch/types.ts:5
- `AuthState = "authenticated" | "not_authenticated" | "unknown" | "not_required"`: types.ts:22
- `Availability` union: types.ts:11-19. `ProviderLive`: types.ts:145-182 (`authenticated: boolean`, `authenticatedState?: AuthState`, `executable`, `evidence`, `securityCompatibility`, `local_or_cloud`, `remoteModels`, `features`, `usageCapabilities`).
- `defaultAdapters(paths)`: adapters.server.ts:618-621 builds `[OllamaAdapter, CodexAdapter, ClaudeAdapter, DetectOnlyAdapter("opencode"|"cline"|"cursor")]`, each with `ctx = () => systemContext(paths())`.
- TaskManager constructs it at manager.server.ts:156 `this.adapters = adapters ?? defaultAdapters(() => this.providerPaths())`. `providerPaths()` (manager:416-425) reads settings key `provider_paths`. `configureProviderPath` (manager:455-474) realpaths the path, then forces `discover()`.
- `ProviderRegistry` (registry.server.ts:42-137) owns the `providers` SQLite table (`providers(id, record, probed_at)`, line 53). `run()` (73-103) calls `adapter.health(previous)` (cheap) or `adapter.detect()` (full). Full-probe interval is `fullMs` 10 min, or `detectOnlyFullMs` 30 min for opencode/cline/cursor (line 15, 77). Usage reads every `usageMs` 5 min, and only when `next.authenticated` (line 83). `withLimit` (132-136) turns ready/busy into `rate_limited` after a provider "rejected" verdict.
- `TaskManager.live()` (manager:476-499) is the ONLY provider view that routing and launch consume. It forces `availability:"unknown"` until `registry.probedThisRun(id)`, and adds `active_jobs`, `activeSessions`, `observed`.
- `FEATURES` (adapters:30-67) is the honest per-feature matrix. `detectOnly(name)` (68-71) marks every feature unsupported.
- `providerBase(id)` (adapters:73-83) is the default record: `authenticated:false, authenticatedState:"unknown", availability:"not_installed"`. `local_or_cloud` is `"local"` only for ollama. `extension: true` for cline/cursor/opencode.
- `NAMES` (adapters:20).

## 1. CRITICAL Q1: environment passed to child processes (ambient paid-API risk)

### 1a. Provider sessions (codex/claude): FULL ambient env, minus only CLAUDECODE

Legacy/non-Windows path, `spawnSession` (adapters.server.ts:212-260):
```ts
// adapters.server.ts:227-228
const env = { ...process.env }; delete env.CLAUDECODE;
child = trackOwnedChild(spawnChild(launch.command, [...launch.args, ...args], { cwd: task.cwd, windowsHide: true, shell: false, stdio: ["pipe", "pipe", "pipe"], env }));
```
Windows production path, `containedSession` (adapters.server.ts:270-409). `spawnSession` routes there on win32 at line 213:
```ts
// adapters.server.ts:351, 358
const env = { ...process.env }; delete env.CLAUDECODE;
group.spawn(launch.command, [...launch.args, ...args], task.cwd ?? process.cwd(), env, out.name, err.name, Buffer.from(task.prompt, "utf8"));
```
`OwnedProcessGroup.spawn` (owned-process-group.server.ts:171-175) serializes it with `windowsEnvironment(env)` (lines 65-73). That function dedupes keys case-insensitively, rejects keys containing `=` or NUL, and does NO filtering.

**Conclusion:** every variable in the Host process environment reaches Codex and Claude Code. That includes `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL`, `CLAUDE_CODE_USE_BEDROCK`, `CLAUDE_CODE_USE_VERTEX`, `AWS_*`, `GOOGLE_*`/`CLOUD_ML_REGION`, `ANTHROPIC_MODEL`, `OPENAI_API_KEY`, `CODEX_API_KEY`, `OPENAI_BASE_URL`, `CODEX_HOME`, `HTTPS_PROXY` and so on. There is no allowlist, no denylist (except CLAUDECODE), and no detection or warning. In `claude --print` mode, Claude Code uses `ANTHROPIC_API_KEY` from the environment when present, with no interactive confirmation. That silently switches subscription work to paid API billing. `CLAUDE_CODE_USE_BEDROCK`/`VERTEX` similarly redirect billing to a cloud account. Codex `exec` honors `CODEX_API_KEY` (and an API-key login in `~/.codex/auth.json`). Bunny records neither.

### 1b. Probes: also full ambient env (CLAUDECODE NOT removed)
- `probe()` (adapters:87-103). On Windows: `runWindowsOwnedProcess(launch.command, [...], {cwd, signal, timeoutMs, maxOutput, owner})` with no `env`. Inside, `options.env ?? process.env` (owned-process-group.server.ts:238). On non-Windows: `execFile` with no `env`, which inherits. Used for `codex --version`, `codex login status`, `claude --version`, `claude auth status`, `opencode --version`, `opencode auth list`, `cursor-agent status`, and the CodexCompatibilityGate metadata probes (`exec --help`, `features list`).
- `probeCodexCatalog` (codex-probe.server.ts:51-86). Windows: `containedTransport` → `group.spawn(command,args,process.cwd(),process.env,...)` (line 43). Non-Windows: `spawn(...)` with no env (line 63). So `codex app-server --stdio` runs with the ambient env too.
- Ollama and Laya: HTTP only (`fetch http://127.0.0.1:11434/...`), with no child process. `OLLAMA_HOST` is ignored because the address is hardcoded (exec.server.ts:25, 93; laya.server.ts:38, 53, 64; model-capability.server.ts:71, 77; adapters:156, 160).

### 1c. Existing precedent for an allowlist (reuse for T13.2)
- `workerEnvironment(source)` (voice/voice-worker.server.ts:238-249) is an allowlist (`WORKER_ENV_ALLOWLIST`) plus a fixed System32 PATH, used at voice-worker:504.
- bunny-missions/capabilities/local.server.ts:223 and bus.server.ts:351 build bounded envs (`SystemRoot, WINDIR, TEMP, TMP, PATH/LANG`).
- `safeError` (failure.server.ts:70-90) redacts values of env keys that match `SECRET_KEY = /token|secret|password|passwd|api.?key|cookie|authorization|credential/i` (line 51). That covers log redaction only. It does not stop the variables from being passed.

### 1d. Other env-driven redirections
- discovery.server.ts:94 `BUNNY_${ID}_PATH` env var overrides the executable (after the user-configured path, before PATH). discovery:156 handles `BUNNY_CURSOR_PATH`.
- `systemContext()` (discovery:30-41) hands `env: process.env` to discovery (PATH, APPDATA, LOCALAPPDATA, ProgramFiles).
- (Observed in this investigation shell only, not the Host: `CLAUDECODE` is set. `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `CODEX_API_KEY`, `CLAUDE_CODE_USE_BEDROCK/VERTEX`, `ANTHROPIC_BASE_URL/AUTH_TOKEN` and `CURSOR_API_KEY` are unset. The real Host env was not inspected.)

### 1e. Recommendation (plug point)
Replace both `const env = { ...process.env }; delete env.CLAUDECODE;` sites (adapters:227, 351), the probe env (adapters:89 → pass `env`; codex-probe:43, 63) and the compatibility-gate probes with one `providerEnvironment(id, connection)` builder:
- Default deny for billing and credential variables per provider: Claude gets `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL`, `CLAUDE_CODE_USE_BEDROCK`, `CLAUDE_CODE_USE_VERTEX`, `ANTHROPIC_BEDROCK_BASE_URL`, `ANTHROPIC_VERTEX_PROJECT_ID`, `AWS_*`, `CLAUDE_CODE_OAUTH_TOKEN`, `CLAUDECODE`. Codex gets `OPENAI_API_KEY`, `CODEX_API_KEY`, `OPENAI_BASE_URL`, `CODEX_HOME` overrides. Cursor gets `CURSOR_API_KEY`.
- The ConnectionRegistry injects an API key only when the connection mode is `api_key` and consent covers it.
- Emit `provider.ambient_credential_ignored` (name only, never value) when one is stripped.

## 2. CRITICAL Q2: unsafe flags

No `--dangerously-skip-permissions`, `--dangerously-bypass-approvals-and-sandbox`, `--full-auto`, `--yolo` or `danger-full-access` exists anywhere in src/lib (grep confirmed). The real authority surfaces:

### Exact current Codex argv: `codexLaunchArgs(task, platform)` (adapters.server.ts:561-570)
```ts
const read = task.executionScope?.access === "read";
const isolation = task.executionScope ? ["--ignore-user-config", "--ignore-rules", ...(platform === "win32" ? ["-c", 'windows.sandbox="elevated"'] : []), ...CODEX_READ_DISABLED_FEATURES.flatMap((feature) => ["--disable", feature]), "-c", 'web_search="disabled"'] : [];
const effort = task.executionScope || !task.effort ? [] : ["-c", `model_reasoning_effort="${task.effort}"`];
return ["exec", "--json", "--sandbox", read ? "read-only" : "workspace-write", ...isolation, ...effort, "--skip-git-repo-check", "--cd", task.cwd!, "--model", task.model, "-"];
```
`CODEX_READ_DISABLED_FEATURES` (codex-compatibility.server.ts:9) = apps, plugins, remote_plugin, multi_agent, multi_agent_v2, image_generation, browser_use, browser_use_external, computer_use, tool_suggest, hooks, skill_mcp_dependency_install.

- Scoped (Mission) Windows write: `codex exec --json --sandbox workspace-write --ignore-user-config --ignore-rules -c windows.sandbox="elevated" --disable apps --disable plugins ... --disable skill_mcp_dependency_install -c web_search="disabled" --skip-git-repo-check --cd <cwd> --model <model> -`. Read uses `--sandbox read-only`. The prompt arrives on stdin (`-`).
- **Unscoped direct task (no `executionScope`, no `mission`):** `codex exec --json --sandbox workspace-write [-c model_reasoning_effort="<effort>"] --skip-git-repo-check --cd <cwd> --model <model> -`. It has NO `--ignore-user-config` and NO `--disable`, so the user's `~/.codex/config.toml` (MCP servers, connectors/apps, plugins, profiles, `model_provider`, `preferred_auth_method`) and default-on connector features remain active. This is the widest Codex authority. Codex config can also select a different `model_provider` and API base.
- `--skip-git-repo-check` is always present. It is mild.
- Mission launches are additionally gated: `codexMissionExclusion` (orch/compatibility.ts:47-59) requires VALIDATED. `CodexCompatibilityGate.inspect/authorize` (codex-compatibility.server.ts:86-152) pins the exact binary sha256 in `validatedCodexRuntimes` (lines 28-38: codex-cli 0.153.4 at `~/.codex/packages/standalone/releases/0.153.4-x86_64-pc-windows-msvc/bin/codex.exe`, sha256 444a3f00…518b). The executable is re-resolved and re-hashed immediately before spawn (adapters:480-495).

### Exact current Claude argv: `claudeLaunchArgs(task, sessionId, platform)` (adapters.server.ts:572-578)
```ts
const read = task.executionScope?.access === "read";
const tools = read ? "Read" : platform === "win32" ? "Read,Write,Edit,Bash,PowerShell" : "Read,Write,Edit,Bash";
return ["--print", "--verbose", "--output-format", "stream-json", "--session-id", sessionId, "--safe-mode", "--strict-mcp-config",
  ...(read ? ["--restricted", "--tools", "Read", "--disallowedTools", "Write,Edit,Bash,PowerShell", "--setting-sources", ""] : []),
  "--permission-mode", read ? "dontAsk" : "acceptEdits", "--permission-prompts", "none", "--allowedTools", tools, "--"];
```
- Write (Windows): `claude --print --verbose --output-format stream-json --session-id <uuid> --safe-mode --strict-mcp-config --permission-mode acceptEdits --permission-prompts none --allowedTools Read,Write,Edit,Bash,PowerShell --`, with the prompt on stdin.
- Read: adds `--restricted --tools Read --disallowedTools Write,Edit,Bash,PowerShell --setting-sources ""` and `--permission-mode dontAsk`.
- Risk notes: (a) write mode pre-authorizes unrestricted `Bash` and `PowerShell`. That is shell execution with no sandbox (only the Windows Job Object containment of process lifetime, not of filesystem or network). It is effectively equivalent to "skip permissions" for shell. (b) In write mode, `--setting-sources` is NOT cleared, so user/project `settings.json` (including `env`, `apiKeyHelper`, hooks, model) still loads. A `settings.json` `env` block or `apiKeyHelper` is another non-ambient path to API billing. (c) No `--model` is passed (FEATURES.claude.modelSelection is unsupported), so the account default applies. (d) Same argv for direct and Mission tasks (no scope split except read/write).
- Comment at adapters:571 says the flags were "verified with installed Claude Code 2.1.288 help". `--safe-mode`, `--restricted` and `--permission-prompts` are version-specific, and there is no runtime parser gate like Codex has.

### Ollama
HTTP `POST /api/generate` only (exec.server.ts:93-98). There are no tools. `localOnly` refuses hosted tags (exec:81-82).

## 3. CRITICAL Q3: how "authenticated" is determined today (honesty review)

| Provider | Probe | `authenticated` / `authenticatedState` | Honest? |
|---|---|---|---|
| Codex | `codex login status` exit code (adapters:437-445) | exit 0 → `true`/"authenticated"; exit≠0 → "not_authenticated" + `authentication_required`; null (timeout/spawn fail) → "unknown" | Partly. Exit 0 is true for BOTH ChatGPT-subscription and API-key login, and the stdout text ("Logged in using ChatGPT" vs "…API key") is not parsed. With `CODEX_API_KEY`/`OPENAI_API_KEY` in env, exec may bill the API regardless. Identity/plan is never read. `account/rateLimits/read` success (`usageRead`) is used only for usage, not auth mode. The app-server `account/read` method (account type/plan) is not called; verify it against the installed 0.153.4 schema before relying on it. |
| Claude Code | `claude auth status` JSON `{loggedIn, authMethod}` (adapters:519-535) | non-boolean/unparseable → "unknown"; `loggedIn:false` → "not_authenticated"; `true` → "authenticated"/ready | Partly. `authMethod` is only appended to `detail` (line 535), never classified. API-key, Bedrock/Vertex and claude.ai subscription all collapse to "authenticated". The probe runs with ambient env, so an ambient `ANTHROPIC_API_KEY` can make it report logged-in via API key. The stream-json `system/init` event's `apiKeySource` field is NOT read by `ClaudeNormalizer` (events.ts:194-229 reads only session_id, model, content, rate_limit_event, result), so the run's billing source is never verified. |
| Ollama | `probeOllama()` GET /api/tags (exec.server.ts:23-33) | `authenticated = found.up`; `authenticatedState = "not_required"` (adapters:149) | Mostly honest for local. But `:cloud`/remote tags (ollama.com, `isRemoteOllamaTag` exec:19-20) need an ollama.com sign-in that is never probed, and the provider-level `local_or_cloud:"local"` is guarded per model by `runsLocally` (router.ts:16-18) only. |
| OpenCode | `opencode auth list` regex `/(\d+)\s+credentials?/` (adapters:596-599) | stays `false`/"unknown" | Honest (it says "not validated"). Count only; provider names are not captured. The probe runs with ambient env, so OpenCode may also count env-sourced keys. |
| Cursor Agent | `cursor-agent status` text regex `/not logged in/i` then `/logged in/i` (adapters:601-606) | "authenticated"/"not_authenticated"/"unknown" | Heuristic text match. `CURSOR_API_KEY` in env is not distinguished. Never routed anyway. |
| Cline | NOT executed (self-updates on launch); version from npm `package.json` (discovery:144-153) | stays `false`/"unknown" | Honest. |

Detect-only providers always end with `availability = "unavailable"` (adapters:610), so they are never routed.

Hard gate: `eligibility()` (router.ts:24-41) requires `availability ∈ {ready,busy}`, `installed`, `authenticated`. There is no notion of connection mode, billing source, account or consent.

`deriveProviderUsage` (provider-usage.server.ts:146-219) uses `authenticatedState` only for a note (line 191). `ACCOUNT_SCOPES` (98-102) are opaque strings ("signed-in Codex account").

Usage surfaces today:
- Codex: `probeCodexCatalog` JSON-RPC `initialize` → `model/list {includeHidden:false}` + `account/rateLimits/read {}` (codex-probe:73-78). `rateLimitsByLimitId.codex ?? rateLimits` → `codexUsageWindows` (9-19). `ordinaryUsageAllowed === false` → `limited` → availability `rate_limited` (adapters:455). Re-read via `CodexAdapter.usage()` (466-470) through `ProviderRegistry.refreshUsage` and `run`.
- Claude: `rate_limit_event.rate_limit_info.unifiedWindows {five_hour, seven_day}` (events.ts:210-214, `claudeRateLimits` ~233+). Session-only. `registry.recordSessionUsage` (registry:120-130); a "rejected" status holds the provider out until reset.
- Ollama: no quota. Receipts come from the final `/api/generate` message (adapters:176-182).

## 4. CRITICAL Q4: OpenCode/Cline/Cursor detection (`DetectOnlyAdapter`, adapters:581-615; `locate`, discovery:124-173)

Resolution order (`first()`, discovery:87-109): user-configured `provider_paths[id]` → env `BUNNY_<ID>_PATH` → PATH search (`searchPath`, 49-58: `.exe` before `.cmd` per directory, no shell) → known locations. A `.cmd` is accepted only if it is an npm cmd-shim (`parseNpmShim`, 64-69), and it resolves either to the native exe or to `node <script>` with `nodePath = process.execPath` (the Host's own node/bun runtime).

- **OpenCode:** PATH name `opencode`. Known locations on Windows are `%APPDATA%\npm\opencode.cmd` and `~\.opencode\bin\opencode.exe`; on POSIX, `~/.opencode/bin/opencode`. Probes: `--version`, `auth list`.
- **Cline:** PATH name `cline`. Known location on Windows is `%APPDATA%\npm\cline.cmd`. It is never executed; version comes from `dir(dir(launch.path))/package.json`, the package root of the resolved node script.
- **Cursor Agent:** a special case. Roots are `dir(provider_paths.cursor ?? BUNNY_CURSOR_PATH)` and `%LOCALAPPDATA%\cursor-agent`. Inside a root it requires `<root>\node.exe` + `<root>\index.js`, or the newest `<root>\versions\<YYYY.MM.DD[-hh-mm-ss]-hash>\{node.exe,index.js}` (`newestVersionFolder`, 115-122). Launch = `{command: node.exe, args:[index.js], kind:"node-script"}`. PATH names `cursor-agent` and `agent` are noted only ("launcher present but no runnable install"). Probe: `status`.
- **Ollama:** PATH name `ollama`. Known locations: `%LOCALAPPDATA%\Programs\Ollama\ollama.exe`, `%ProgramFiles%\Ollama\ollama.exe`, `/usr/local/bin`, `/usr/bin`, `/opt/homebrew/bin`. The executable is informational. Liveness comes from HTTP.
- **Codex:** PATH name `codex`. Known locations: `%LOCALAPPDATA%\Programs\OpenAI\Codex\bin\codex.exe`, `%APPDATA%\npm\codex.cmd`, `~/.local/bin/codex`, and others.
- **Claude:** PATH name `claude`. Known locations: `~\.local\bin\claude.exe`, `%APPDATA%\npm\claude.cmd`, `~/.claude/local/claude`.
- **WSL: there is NO WSL handling anywhere** (grep of src/scripts finds no real match). Linux-side installs inside WSL are invisible, and `\\wsl$` paths are not considered.
- `CliBase.health` (adapters:119-123) reuses the previous probe while the path and size:mtime fingerprint are unchanged. `CodexAdapter.health` (420-426) additionally requires a fresh compatibility profile.

## 5. CRITICAL Q5: where a ConnectionRegistry plugs in

Current chain: `adapter.detect()` → `ProviderRegistry.run()` persists `ProviderLive` → `TaskManager.live()` → `routingPipeline/buildCandidates` (routing.server.ts:177 `eligibility(provider, constraints)`; 473 `provider_readiness`) → `submit` (advice applied at manager:1081-1113) → `launch` preflight (manager:1438-1446 `eligibility` + `runsLocally`; 1451-1503 `revalidateCandidate`/reroute; 1505-1506 adapter lookup) → `adapter.launch` (manager:1745). Retries and reroutes go through `startSession` (manager:1646-1735: `eligibility` at 1657, mission checks 1667-1681, `targetAdapter.launch` at 1723).

Recommended insertion points:
1. **Detection-time enrichment (registry):** after `adapter.detect()`/`health()` in `ProviderRegistry.run` (registry:81-90), merge `connectionRegistry.project(id)`. That adds `connectionMode` (identity | native_subscription_cli | delegated_plan | api_key | local_runtime | view_only), `billingSource` (subscription | api | local | unknown), an opaque `accountLabel` (no email or handle), and `consented`. Alternatively, do it in `TaskManager.live()` (manager:476-499), which is already the single projection consumed by routing, launch and snapshots. live() is preferable because consent can change without a re-probe.
2. **Hard eligibility:** extend `eligibility()` (router.ts:24-41) with `if (!connection?.dispatchAllowed) return "<Provider> has no consented connection for this project/account."`, and `view_only` → never eligible. Because `eligibility` is reused at routing (routing.server.ts:177, 324), at launch preflight (manager:1439) and at retry/reroute (manager:1657), one check covers all three.
3. **FINAL dispatch (closes T13.1 limitation 7):** immediately before `adapter.launch(adapterTask, …)` at manager:1745 and `targetAdapter.launch` at manager:1723, assert `connectionRegistry.authorize({provider, accountId, projectId, taskId, origin: assistance?.adopted ? "jev" : router|manual})`, and refuse when the provider differs from a consented one. Jev's accepted switch (manager:1096-1108, which sets `routed.provider` to `chosen.provider_id`) must re-check consent for the NEW provider. Today `applyDecisionAdvice` checks only locality/tools (`ADAPTER_TOOL_CONTRACTS`, routing.server.ts:79), not consent.
4. **Adapter-level (defense in depth):** inside `CodexAdapter.launch` (adapters:471-504) and `ClaudeAdapter.launch` (538-545), take a `connection` from the frozen task snapshot and build the env from it (section 1e). Refuse if `connection.mode === "native_subscription_cli"` and a billing variable would be needed, or if the observed billing source (Claude `system/init.apiKeySource`, Codex login-status text or `account/read`) differs from the consented one. Add `apiKeySource` capture to `ClaudeNormalizer` (events.ts:194+) and abort on mismatch.
5. **Detect probes:** classify `claude auth status.authMethod` and the `codex login status` text into `billingSource` in `ClaudeAdapter.detect` (adapters:519-535) and `CodexAdapter.detect` (437-445). Run these probes with the sanitized env so that ambient keys do not pollute the answer.
6. **Phone redaction:** `deviceSnapshot` (device-authority.server.ts:369-416) nulls `executable` and `evidence` and strips session ids and pids. It does NOT strip `provider.detail` (contains paths like "Codex found at C:\…", and Claude's `authMethod`) or `provider.securityCompatibility.executable` (`executablePath`, `requestedPath`, `sha256`, `stamp` with path). Connected-account fields must be projected to a redacted status here (mode, state, consented) and never to a credential handle. `intelligence` is already `undefined` for devices (line 413).
7. **Credential storage precedent:** `JevSecretStore` + `DpapiProtector` (jev-secrets.server.ts:36-110; DPAPI CurrentUser, secret over stdin, never argv/env; `API_KEY_SHAPE` line 72). Reuse it for api_key connections, so the registry holds an opaque handle and adapters receive the value only at spawn.
8. **Agents never see handles:** adapters already get `structuredClone(...)`, frozen (manager:1714-1719, 1740-1744). Keep credential values out of `OrchTask` and resolve them from the registry inside the adapter at spawn.

## 6. Other observations
- `OllamaAdapter.launch` (adapters:172-187) → `execute()` (exec.server.ts:68-124). `NOT_CONFIGURED` (exec:5-10) is a stale fallback for non-ollama providers.
- `ModelCapabilityRegistry` (model-capability.server.ts:111-296): only `MODEL_SOURCE_PROVIDERS = ["ollama","codex"]` (line 62). It uses its own `locate(systemContext(providerPaths))` + `probeCodexCatalog`, so a second app-server spawn also runs with the ambient env. It persists to the `model_capabilities` table.
- `LayaRegistry` (laya.server.ts:94-229): Laya = Ollama-local models named Laya. Runtime is HTTP to 127.0.0.1:11434, `apiKeyRequired:false`, with digest-pinned benchmarks (`laya_benchmarks` table). In a ConnectionRegistry it maps to `local_runtime` mode.
- `system-tools.server.ts`: `systemTool()` gives absolute System32 paths for powershell/taskkill. `pathTool()` does a PATH lookup that excludes the cwd. Neither is relevant to provider env.
- `CODEX_COMPATIBILITY_MAX_AGE_MS = 10 min` (compatibility.ts:5).
- `codexMissionExclusion` returns null for non-codex providers (compatibility.ts:48). Claude Missions have no equivalent binary or flag validation gate.
