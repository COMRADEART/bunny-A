# Bunny-A M-A-0 — Security model

## Principles

1. One scoped approval per mission, never silent execution. A mission plans first and stops at `waiting_for_approval` showing its requested scope.
2. Mission-delegated approval is recorded as such (`approval.delegated`, `task.approval.kind = "mission"`), never as a user click.
3. Anything outside delegated authority stops and asks. Capability requests offer **Allow once** for an invocation or **Allow this skill run** for matching actions in that run.
4. Capability Bus external side effects and destructive actions ask by default, subject to the explicit grant rules below. Provider-internal actions use the separately displayed provider-session authority.
5. Unavailable, unconfigured or unsupported capabilities report exactly that; nothing is simulated.

## Authorization envelope (`mission_authorizations`)

Derived by `scopeFor()` from the planned steps (including the concrete steps inside skills) and persisted on approval:

| Field | Meaning |
|---|---|
| `projectRoots` | Mission root (+ the mission's worktree folder when a step uses `isolation: "worktree"`). |
| `riskClasses` | Subset of `READ, WRITE, EXECUTE, EXTERNAL_SIDE_EFFECT, DESTRUCTIVE` the plan needs. |
| `capabilities` | Action ids/prefixes the plan uses. |
| `providers` | `execution`, allowlist, `localOnly`; `sessions.steps` binds each model step id to `read`/`write`, `maxSessions` bounds all provider sessions including retries, and `writeIncludesShell` records the write-session command authority. |
| `filesystem.read/write` | Roots; `write` is empty unless a step writes. |
| `terminal` | Enabled + command names and canonical executable file/argv prefix captured with the displayed plan. Each invocation resolves once before the decision and launches that same identity. |
| `git.actions` | `status, diff, log, commit, worktree, merge` as planned. |
| `browser` / `network` / `computer` | Enabled only when planned. |
| `budget` | Max external model calls (Fast 2, Balanced 6, Deep 12), max runtime (30/60/120 min), max retries, optional token ceiling. |
| `alwaysAsk` | `EXTERNAL_SIDE_EFFECT`, `DESTRUCTIVE`. |
| `expiresAt` / `revokedAt` | Expired → ask; revoked (replan) → deny. |

## The decision function (`authorization.server.ts: decide`)

Order of evaluation:

1. Contract-only action (`implemented: false`) → **deny**.
2. Persistent grant `never_allow` → **deny**; `read_only` and the action is not READ → **deny**. (Most restrictive applicable grant wins; mission-scoped and global grants both apply.)
3. The user approved the pending invocation → **allow** for that action. For a skill, **Allow this skill run** covers matching actions throughout the current run, while different actions still ask and filesystem/runtime containment still applies. It clears when the run finishes; later runs ask again. A standalone capability path exception adds the approved path's parent as a containment root for that invocation.
4. Direct workstation invocation (`capability.run`, `skill.run`) → **allow**, except hard-approval, EXTERNAL_SIDE_EFFECT, DESTRUCTIVE and privacy-sensitive actions, which need `confirmed: true`.
5. No envelope → **ask**. Revoked → **deny**. Expired → **ask**.
6. `hardApproval` actions (calls, sending messages, PR creation, calendar changes) → **ask**, regardless of grants.
7. Grant `ask_every_time` → **ask**.
8. Action not in envelope capabilities / risk class not approved / parameter outside scope (path, command, cwd, git action, domain, browser/network/computer flags) → **ask** with the precise reason. Relative paths are judged against the step's working folder.
9. Risk in `alwaysAsk` → **ask**, unless a persistent `always_allow`/`allow_for_mission` grant covers it and the risk is not DESTRUCTIVE.
10. Privacy-sensitive (screen capture, UI control-tree read) without such a grant → **ask**.
11. Otherwise **allow**.

Grant policies stored in `capability_grants`: `always_allow, allow_for_mission, ask_every_time, read_only, never_allow` (workstation-only `capability.grant`; a blanket `*` allow is refused). M-A-0 has no UI for grants; the data model and enforcement exist.

Parameter-dependent escalation: `terminal.exec` of `git reset/clean/push/rebase/checkout/restore/branch/…`, `rm/del/format/reg/…` is DESTRUCTIVE; `npm publish/login/install/ci/…` is EXTERNAL_SIDE_EFFECT.

## Child model tasks

The authority chain is **user approval → mission envelope → step scope → immutable child execution scope → existing provider adapter**. Role names carry no authority. A custom role with `access: read` is restricted; a Research role explicitly approved with `access: write` can write.

`taskViolation()` checks revocation/expiry, provider execution/allowlist/locality, external-call and total-session ceilings, roots and **child ≤ step ≤ approved session scope**. `TaskManager` persists scope at creation, refuses authority/mission-link mutations, and gives adapters a frozen scope snapshot. Its shared launch path also validates pending mission children approved directly, so an additional `provider.execute` consent cannot upgrade read to write. Retry and provider reroute retain access; replan revokes the old envelope and requires a fresh displayed approval. Approval never silently re-derives a broader plan. Older records without session authority require replanning.

Codex read steps launch with `--sandbox read-only --ignore-user-config --ignore-rules`, plus (M-A-1) `--disable` for `apps, plugins, remote_plugin, multi_agent, multi_agent_v2, image_generation, browser_use, browser_use_external, computer_use, tool_suggest, hooks, skill_mcp_dependency_install` and `-c web_search="disabled"`. The first three flags omit the user's config-defined MCP servers, plugins/integrations and user/project execpolicy rules. The M-A-1 live read Mission showed they do not remove default-on account features: the session still registered the `codex_apps` MCP server with 228 ChatGPT connector tools (Gmail send, GitHub merge, deploys …) and a remotely installed plugin's MCP server. With the added flags, a live session registers no MCP server and no web search; its remaining tools are the sandboxed shell, `apply_patch`, `view_image`, goals, clock and Codex's own multi-agent v2 collaboration tools, which the installed model keeps and which inherit the same read-only sandbox and tool set (see [M-A-1 report](../MA1_ACCEPTANCE_REPORT.md)). On native Windows, the adapter explicitly adds the single trusted override `-c windows.sandbox="elevated"`; it does not re-load settings, profiles or extensions. The setting is a Host-owned literal, independent of user config. Authentication still uses the existing `CODEX_HOME`, as the installed help documents. Mission write steps (M-A-1) keep `--sandbox workspace-write` and get the same flags after it: a live write Mission with the previous argv launched the user's unsandboxed `node_repl` and computer-use REPL MCP servers and account connectors directly under `codex.exe`, which exceeds "edit files and run sandboxed shell commands in the approved folder". Unscoped legacy direct tasks retain their exact previous `workspace-write` argv and normal configuration behavior. These flags and the full generated read argv were checked with **Bunny-resolved codex-cli 0.153.4**; the earlier alpha-version evidence was from a different executable. Actual adapter/mission spawn tests use disposable Node stand-ins, including retarget, retry and read replan. See [MA0_R1_CLOSURE_REPORT.md](../MA0_R1_CLOSURE_REPORT.md).

Claude read steps expose only `Read` (`--tools Read`, explicit denial of Write/Edit/Bash/PowerShell, `dontAsk`, `--restricted`, no setting sources), retaining safe mode and strict MCP configuration, verified against Claude Code 2.1.288 help in Review 0R. Its launch implementation is unchanged by R1. Claude write/unscoped legacy tasks retain the previous tools and acceptEdits configuration. Ollama remains text-only.

Approval cards display roots, agent roles/access, shell authority on write steps, total sessions including retries, cloud-call/runtime limits and the provider permission boundary. Audit records distinguish `approval.accepted` (direct user task), `approval.mission_envelope`, `approval.delegated`, `approval.additional_capability` and `approval.remote_device`.

**M1 residual (MITIGATED):** provider-internal file/command/external actions do not pass through the Capability Bus. Read access is restricted by provider configuration; a write session explicitly delegates provider-managed shell/tool execution, whose external effects are governed by that CLI. Bunny cannot promise a separate Capability Bus approval for those internal operations or an OS-level write jail for Claude. The UI states this. Live provider acceptance remains M-A-1 work; CLI/tool enforcement itself is a trust boundary.

Direct capability/skill working directories must be plain absolute, existing directories inside registered/default roots after junction/symlink resolution. Relative, missing, file, control-character and unauthorized paths are refused; Windows UNC and alternate data stream syntax are refused. No folder is created by validation. This does not change legacy TaskManager submission.

Executable pinning prevents a different same-basename path or a changed PATH from inheriting an envelope's terminal trust. It does not hash installed binaries or their libraries; replacement at the same canonical path by a workstation-level actor is a residual limitation.

## Remote devices

Unchanged authentication (paired, hashed, revocable device token). Mission actions a device may call: `mission.create` (no explicit graphs), `mission.get`, `mission.approve`, `mission.start`, `mission.respond`, `mission.stop`, `inbox.ack`. Workstation-only: `mission.configure`, `mission.retry`, `mission.replan/plan`, all `capability.*`, `skill.*`, `trigger.*`. A phone approves exactly the persisted requested scope; caller-supplied roots/session authority are ignored. Serialized HTTP approvals and remote audit provenance are tested in `capabilities.test.ts`; no provider is started by that test.

## Browser Runtime isolation

* Separate persistent profile at `<data>/browser-profile`; the user's Chrome/Edge profiles, cookies and credentials are never opened. When no Playwright Chromium is installed it launches the installed Chrome or Edge **binary** with that separate profile.
* Only `http(s)` URLs; embedded credentials and local hostnames refused. Chromium uses a Bunny-owned loopback checking proxy with implicit loopback bypass disabled. Every HTTP/CONNECT/WebSocket upstream connection resolves all DNS answers, rejects any blocked answer, then connects to the checked literal IP. There is no second destination lookup. Host headers and end-to-end TLS/SNI are retained.
* Blocked addresses include loopback, unspecified, RFC1918, link-local, CGNAT, multicast, documentation/benchmark/reserved IPv4 and non-global IPv6 (including ULA, mapped IPv4, local and transitional ranges). Redirects, frames, fetches and other subresources traverse the same boundary. New connections re-check changed DNS answers.
* Service workers and QUIC are disabled; non-proxied WebRTC UDP is disabled; destination DNS cannot bypass the proxy. A real isolated-browser test attempts local/private DNS, redirects, IPv6, subresources and rebinding against a real disposable Bunny Host: **zero requests reach that Host**, before token authorization. Public HTTP succeeds through a deterministic fixture; HTTP/CONNECT checks verify literal-IP dialing.
* The loopback allowance and resolver/socket seams are in-process test options, never HTTP command fields. This is browser network isolation, not an OS network sandbox against a compromised browser or a malicious workstation process. Destination connection attempts from the browser itself are constrained; a public server's own server-side fetches are outside Bunny's control.
* Typed text and file bodies are recorded only as character counts.

## Computer Runtime limits

Window list (READ), control tree (READ, privacy-sensitive), focus, invoke/toggle/select/expand, set value through `ValuePattern`, screen capture (privacy-sensitive), open allowlisted apps (`notepad, calculator, paint, explorer, terminal`) optionally on a non-executable file inside the roots. No raw mouse coordinates and no synthetic keystrokes are offered. All non-READ actions are EXECUTE and need an envelope that enables computer control. The mission scope request adds the EXECUTE risk class only for model or `terminal.exec` steps, so in a capability-only Mission every non-READ computer action asks the user (M-A-1 Phase O; fail-closed, recorded as a LOW limitation).

## Git merge transaction and Stop

`git.merge` refuses pre-existing Git operations, index locks or tracked/index changes. It captures HEAD/target/status, takes an owned sidecar lock and stages a `--no-ff --no-commit` merge with a unique MERGE_MSG marker before committing. Only matching marker, MERGE_HEAD, ORIG_HEAD, unchanged original HEAD and owned sidecar prove an unfinished merge is Bunny's. Conflict, process failure and cancellation then use bounded `git merge --abort` with a fresh signal and verify HEAD/tree/index restoration. Untracked user files remain; no reset or unrelated merge abort occurs.

Capability cancellation and Mission Stop await adapter cleanup and run persistence; Stop blocks scheduling/finalization races and never retries. `cleanup: {attempted, ok, detail}` is persisted and returned, and failed cleanup appears in the mission Stop result. If ownership cannot be proven, inspection/abort fails or an early process interruption leaves changes/index.lock before ownership is established, the result reports manual attention instead of destructive cleanup. If commit wins a cancellation race, it stays committed and the result says so. A hard Host/process crash cannot guarantee cleanup; automatic destructive recovery is not added.

On Windows, Bunny launches the real `<Git>\mingw64\bin\git.exe` (or the clangarm64/mingw32 sibling) rather than Git for Windows' `<Git>\cmd\git.exe` launcher, which re-spawns git outside the Host's kill-on-close process job (M-A-1 Phase S: with the launcher, a Bunny merge interrupted by a Host crash was committed 27 s later by the orphaned git, after recovery had recorded it as not resumed). With the real binary, git ends with the Host and the repository keeps the interrupted merge (MERGE_HEAD with Bunny's marker plus `.git/bunny-merge.lock`); a later merge refuses and names that state and the manual cleanup. Git hook processes started by MSYS can still outlive a crash; without their git parent they cannot commit.

## Secrets

* `redact()` replaces values of keys matching token/secret/password/api key/cookie/authorization/credential in every capability run record; `text`/`content` parameters are stored as lengths.
* The gh token stays in gh's own store; health keeps only the verdict.
* No connector stores or requests credentials in M-A-0.

## Triggers

Created disabled; fire only if globally enabled **and** individually enabled; minimum interval 60 s, ≤12/hour; journaled (`trigger.fired`, `trigger.suppressed`). Actions cannot execute work: Inbox notification or a mission draft that waits for approval.

## Known security limitations (for M-A-1)

* Provider CLI actions inside a write session remain outside the Capability Bus; M1 is mitigated and disclosed, with live acceptance deferred.
* **Allow this skill run** deliberately covers matching actions within that run and approved runtime roots; it is not single-operation authorization.
* Executable identity is a canonical path plus launch prefix, not a binary/content integrity guarantee.
* Unproven Git ownership, failed cleanup or a hard Host crash require manual attention; committed merges are never reset by cancellation.
* Trigger `contains` matching is plain substring matching on event detail text.
* (M-A-1) Provider children inherit the Host's environment except `CLAUDECODE`. A Host started from a Claude Code terminal therefore passes that session's `CLAUDE_CODE_*` variables to provider sessions; start the Host from the logon shortcut or a normal shell.
* (M-A-1) The desktop package ships no `node_modules`; its browser capability reports Playwright unavailable.
