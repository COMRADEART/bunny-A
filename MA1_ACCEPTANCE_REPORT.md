# Bunny-A M-A-1 Acceptance Report

## Identity

- MA0_FREEZE_SHA: `180ab234b2e81e7745e7402c4eb9483586c36eab` (unchanged; all repairs are commits above it)
- MA1 branch: `ma1-live-acceptance` (not merged, not pushed)
- MA1 final code SHA: `f1934bda6b0d33f27bef198e8967a69f6eb329ff`; later commits on the branch are documentation only (security-model notes and these three reports)
- Date: 2026-10-02 (local, EDT) / 2026-10-03 UTC

## Environment

- Windows 11 Pro 10.0.26300, interactive desktop session of the workstation owner; Node v24.18.0; Git for Windows (`<Git>\cmd\git.exe` launcher and `<Git>\mingw64\bin\git.exe`); Google Chrome (Playwright channel `chrome`).
- Providers as resolved by the Host: codex-cli 0.153.4, Claude Code 2.1.288, Ollama 0.35.0 (local `huihui_ai/qwen2.5-abliterate:7b`, cloud-hosted `deepseek-v4.1-flash:cloud` listed first).
- Test Host: `scripts/bunny-host.mjs` from the checkout, data `C:\Users\allam\bunny-ma1\host-data`, port 43219, restarted per code change (PIDs in `final/phase-results.md`). Disposable fixtures under `C:\Users\allam\bunny-ma1\repos\`.
- Installed Host: `scripts/bunny-host.mjs` from the same checkout, started at logon by the Startup shortcut, data `<repo>\.bunny-a`, port 43119. Left untouched until Phase Y.
- Production UI under test: desktop package middleware (node-middleware preset) extracted from `releases/Bunny-A-Windows-v14-MA1-Stage.zip` and `v15-MA1-Final.zip` to `C:\Users\allam\bunny-ma1\pkg-install` (outside the workspace), served on loopback 8094/8095 by a harness with `Bunny-Server.mjs`'s request gate (the user's v10 dashboard owns 8084).
- Test-environment caveat: the test Host was started from this Claude Code terminal, so it and its provider children inherited this session's `CLAUDE_CODE_*` variables (Bunny removes only `CLAUDECODE`). The installed Host was relaunched through the logon shortcut via Explorer, i.e. with the logon environment.
- Evidence: `test-results/ma1/` (git-ignored, local). Every phase's running notes are in `test-results/ma1/final/phase-results.md`.

## Baseline gates

At the freeze: 205/205 script tests + 174/174 app tests + 20/20 UI tests = **399/399**; typecheck exit 0; lint 0 errors / 10 warnings; build exit 0. Migration harness: the live installed DB (v2, 51 tasks) was read only through `VACUUM INTO`; copies of it and of the pre-M2 backup (v1, 13 tasks) migrated to v3 twice with original columns and rows identical (only an additive `migrations` row), and the pre-M-A-0 (`ea0e803`) persistence code read both. Evidence: `baseline/`.

## Live provider results

### Codex read

As frozen (REAL FAIL, BLOCKER). OS-observed argv: `exec --json --sandbox read-only --ignore-user-config --ignore-rules -c windows.sandbox="elevated" … -`.
- Provider claimed: read the secret word and sum correctly; the write command failed with `UnauthorizedAccessException`.
- Bunny independently observed: sentinel `MA1_CODEX_READ_WRITE_SHOULD_FAIL.txt` absent, repo clean; **but** the session registered the `codex_apps` MCP server with 228 ChatGPT connector tools (GitHub write/merge, Gmail send/delete, Calendar delete, Vercel/Sites deploy, parental controls) and a remotely installed plugin's MCP server (`node ./mcp/server.mjs` spawned by `codex.exe`). Non-model evidence: `RUST_LOG` tool-registration trace, process watch, Codex rollout. None was invoked.

After 95ed30f (REAL PASS). Argv adds `--disable` for 12 default-on features and `-c web_search="disabled"` (observed by the OS).
- Provider claimed: reads correct; three write paths failed.
- Bunny observed: `mcp_server_count=0`, no plugin process, shell write OS-denied, `apply_patch` "patch rejected: writing is blocked by read-only sandbox" in Codex's own log, all three sentinels absent, git status empty, rollout `read-only / never / network restricted`. `require_escalated` was not attempted (the model refused under approval=never) — policy-declared only (B3 NOT TESTED). NOTE: Codex's own multi-agent v2 collaboration tools remain; they inherit the same sandbox and tool set.

### Codex repo-config read

REAL PASS. Model-free positive control: with simulated project trust the fixture's repo `.codex/config.toml` MCP server is listed; untrusted it is not. Adversarial direct-CLI control with trust: repo config loads (marker server spawned, developer instructions applied) but the sandbox stays read-only. Bunny's live read run: no marker spawn or log, no token from the repo instructions, write OS-denied. NOTE: project trust is the only gate on a repo MCP table; Bunny drops the only trust source (user config).

### Codex write

As found at 95ed30f (REAL FAIL, HIGH): exact one-line diff and Bunny verification passed, but `codex.exe` spawned the user's unsandboxed `node_repl`, computer-use REPL and plugin MCP servers. After 88c3874 (REAL PASS):
- Provider claimed: edited `src/greet.mjs` and the test passes.
- Bunny observed: `apply_patch` ran via `--run-as-windows-sandbox`; no `node_repl`/computer-use/plugin process; git diff exactly `Hello, ${name}` → `Hello, ${name}!` (sha256 80e2b575…); outside-root manifest identical; Bunny verification exit 0; independent `node --test` 1/1.

### Claude read

REAL PASS. OS argv includes `--safe-mode --strict-mcp-config --restricted --tools Read --disallowedTools Write,Edit,Bash,PowerShell --setting-sources "" --permission-mode dontAsk --permission-prompts none`.
- Provider claimed: reads correct; Write/shell/Edit "simply missing from the session's tool list".
- Bunny observed: init event tools `["Read"]`, `mcp_servers []`; both sentinels absent; git status empty; README sha256 unchanged.

### Claude write

REAL PASS (+NOTE M1).
- Provider claimed: fixed `src/sum.mjs`, test passes.
- Bunny observed: diff exactly `a - b` → `a + b`; outside-root manifest identical; Bunny verification exit 0; independent test 1/1; init `permissionMode acceptEdits` (overrides the user's `bypassPermissions`), `mcp_servers []`. NOTE: init still lists extra built-ins and user plugins under `--safe-mode`; Claude Bash/PowerShell is unsandboxed user authority (accepted M1 in M-A-0).

### Ollama

As frozen (REAL FAIL, HIGH, no launch): a local-only task was routed to `deepseek-v4.1-flash:cloud` (remote host ollama.com) with "Hard requirements met: local only". After a60bc70 (+785d7ca/7e98d28 routing fixes) REAL PASS: the local-only Mission child ran `huihui_ai/qwen2.5-abliterate:7b`; Ollama `server.log` shows a local llama-server load and `POST /api/generate` from 127.0.0.1 with no remote call; `/api/ps` shows the local model; accounting external 0 / local 1; `tokensReported false` (no token claim). First attempt failed closed because the legacy keyword heuristic read "Write … test" as needing a filesystem (NOTE).

## Routing / retarget / retry

REAL PASS. G1: auto routing chose Codex; the provider process was killed (identity-verified) → `provider_failed` → retry with `deny[codex]` rerouted to Claude on the same step/role, both attempts read-only. G2: a pending child outside a Claude-only envelope was retargeted to Claude, allowed once, ran on the same step and task. G3: Claude made unavailable → Claude-only step `provider_unavailable`, no child task, ready-but-unapproved Codex not substituted; path restored. H: retry kept read scope (Codex read → Claude read) and write scope/root (Codex write → Claude write, exact diff, npm verify). Findings R-D (MEDIUM, agent boilerplate made every Mission step "need filesystem") and R-D2 (non-local read step routed to text-only Ollama) repaired in 785d7ca and 7e98d28.

## Multi-agent Mission

REAL PASS. Research (Codex, read) ∥ Architect (Claude, read) started together; Coding (Codex, write) after both; Bunny ran `npm test` (exit 0); Reviewer (Claude) with `deny[codex]`. Artifacts flowed research note + specification → Coding, patch + test report → Reviewer; prompts carried dependency summaries only. Bunny observed the exact one-line fix and 3/3 tests independently.

## Parallel DAG

REAL PASS. A (Codex) killed with maxRetries 0 → Integrator `dependency_failed`; B and C completed; C waited `ready` until a slot freed; never more than 2 concurrent child tasks; mission failed with "ResearchA failed: Process exited 1".

## Deterministic zero-external-provider Mission

REAL PASS. "git status and then run the tests" → `git.snapshot` → `project.test`; requested scope `providers.execution=false`, `maxSessions 0`; npm resolved to node + npm-cli.js; process window shows only `npm-cli test → node --test`; accounting "external 0 / local 0 / deterministic 2", `tokensReported false`. Bunny never claims "0 tokens"; it reports tokens as not reported.

## Skill replay/repair

REAL PASS. Recorded from two successful runs → candidate v1 (run refused while candidate) → verified/promoted → replayed; input invalidated → stops at step 1 (step 2 not run), `repairNeeded`, v1 stays active; workstation repair → candidate v2 → verified → promoted, v1 retired → replay OK; a built-in skill precondition blocks before any step.

## Browser

REAL PASS (+NOTE). "open https://nodejs.org/…/assert.html" → `web.capture_page`: 200, title, 20 000 chars, screenshot + evidence artifacts with sha256, 0 model calls. OS-observed Chrome argv: isolated `--user-data-dir`, `--proxy-server` owned by the test Host, `--proxy-bypass-list=<-loopback>`, resolver `MAP * ~NOTFOUND`, QUIC off, WebRTC non-proxied UDP off. Navigations to localhost, 127.0.0.1, [::1], RFC1918, link-local/metadata, private-resolving names (nip.io, localtest.me) and a public redirect to 127.0.0.1 were blocked before connection. Proxy level (Bunny-attributable): private HTTP/CONNECT/WebSocket/DNS → 403 `x-bunny-browser-blocked`; public → 200; local canary hit 0 times until a no-proxy control reached it. NOTE: subresource blocking on a public page was also blocked in the no-proxy control (Chrome Local Network Access), so it is not attributed to Bunny. Download landed in Host artifacts with sha256; a private download was refused. Found during M: a refused download crashed the Host (HIGH, d8cc7e2, see repairs).

## Computer Runtime

REAL PASS. Fixture (disposable WinForms window): list windows; control tree and screen capture asked first (privacy-sensitive); focus; value set through `ValuePattern` with read-back; "MA1 Apply" invoked → postcondition "Result: HELLO-MA1" via UIA; capture 3413×1497 (sha256 recorded, file deleted for privacy); `open_app cmd` refused (not allow-listed). Calculator: 0 windows/processes before → opened (PID 39012) → Two, Plus, Three, Equals via UIA → display "5" → closed only that instance through its own Close control → 0 after. 0 provider sessions.

Risk approval (Phase O) REAL PASS: inside an envelope with computer enabled, `list_windows` (READ) ran without a prompt; `computer.type` paused ("EXECUTE actions were not approved") → allow once → only the fixture edit changed (independent UIA read "risk-ok"); `computer.capture` → deny → step `permission_denied`, no PNG; an out-of-root write → allow once → exactly one 13-byte file; another → deny → absent. LOW (not repaired, fail-closed): the mission scope request never asks for EXECUTE for computer actions, so in a capability-only Mission each non-READ computer action asks. NOTE: one fixture label change after the mission's type step has no Bunny capability record and did not reproduce in a controlled re-run; most likely input on the shared live desktop.

## Git/worktree

REAL PASS (disposable repo). Clean worktree merge → merge commit with both parents and Bunny's transaction marker, no locks left. Conflicting merge → "Bunny's merge aborted; original HEAD, tracked tree and index restored" (HEAD, file sha256 identical). A user's own conflicted merge in progress and a dirty tree were refused with HEAD, MERGE_HEAD, file hash and status unchanged. Stale `index.lock` and stale Bunny lock refused and left in place. Stop during a slow pre-commit hook → `taskkill /T /F` of the git tree (process watch), HEAD unchanged, MERGE_HEAD gone, hook never finished.

## Stop isolation

REAL PASS. Mission A stopped at 02:48:32.821Z: its sleeper's last heartbeat 02:48:32.953Z and `taskkill` of exactly that PID; its Ollama request closed (server.log 499 after 6.36 s). Mission B's sleeper ran to "done" and the mission completed; an unrelated direct Ollama task kept streaming and ended later at its own 120 s runtime limit; an unrelated OS process (started outside Bunny) kept beating.

## UI reconnect

REAL PASS. With a Mission running, the browser was closed and the UI server killed (port refused). The Host kept running; the Mission completed while the UI was down; the restarted UI showed "Completed · 2 / 2 steps", one attempt per step, no re-approval, no duplicate runs. The Host never restarted (contrast with Host restart).

## Host restart/recovery

As found (REAL FAIL, HIGH). The test Host was force-killed during a Bunny merge's pre-commit hook. Restart recovery was truthful about Bunny's state ("interrupted by a Host restart and were not resumed"; runs "interrupted"; pending approval kept; direct task "session recovery unsupported"), but 8 s after recovery and 27.5 s after the crash the repository's `main` advanced to Bunny's marked merge commit and the lock stayed behind. Root cause, reproduced outside Bunny: Git for Windows' `cmd\git.exe` launcher re-spawns the real git outside the Host's kill-on-close job. After 6f6095c (REAL PASS, Git `cmd` deliberately first on the Host's PATH): health reports `mingw64\bin\git.exe`, Bunny's git died with the Host, no commit appeared after the orphaned hook finished, and the repository shows the interrupted merge. After 9396c76 a later merge names that state ("An interrupted Bunny merge transaction <id> … git merge --abort and delete <lock>") and a stale lock alone; following the instructions, the next merge succeeded.

## Phone

- Host layer (REAL PASS): unpaired bearer → 401; wrong and replayed pairing codes → 403; paired device reads state; device cannot submit explicit graphs or call workstation-only actions (project.add, pairing.create, device.revoke, remote.configure, capability.run, mission.configure, provider.configure_path); from the device: "take a screenshot" approved, the privacy-sensitive capture denied (0 artifacts), "run the tests" approved then stopped (heartbeat frozen); revoke → 401.
- Gateway + phone UI (SIMULATED PASS): extracted v14 package in remote mode behind a local TLS front that forwards like the tunnel, Chrome with the Pixel 7 profile at `/?companion=1`: "Not paired" → pairing (cookie `bunny_device` HttpOnly/Secure/SameSite=Strict, token never visible to page script) → plan → approval card → Approve → running → Stop → revoke → "This device's access was revoked." Host events attribute create/approve/stop to `device:<id>` and log `approval.remote_device` ("same scope as workstation").
- Actual approved transport: BLOCKED — the approved Cloudflare quick-tunnel hostname no longer resolves (ENOTFOUND; control domain resolves); no new public tunnel was created. Physical Android: NOT TESTED.

## Budget/failure propagation

Budgets (REAL PASS): 13-step plan → `invalid_plan` "limit is 12"; 4th active mission refused (limit 3); ≤2 concurrent child tasks observed; mission runtime limit set to 60 s → failed `budget_exceeded` at 64 s with the step's process cancelled; per-step maxRetries 5 stored as 2 and exactly 3 attempts made; manual retry beyond the ceiling refused; fast-mode external-call budget 2 → third Claude-only step failed "External model budget exhausted and no local provider can do this step" with no third launch and no substitution (a first attempt with a mistyped allow-list key let the third step fall back to local Ollama — TEST error, and a NOTE that unknown graph keys are ignored silently).

Failure propagation (REAL PASS): failed step → dependent `dependency_failed`; independent sibling completed; verification failure → `verification_failed`, mission paused for the user, dependent left pending; permission denied → no retry; user Stop → "nothing will be retried"; budget exhaustion → explicit reason; provider unavailable → no unapproved reroute.

## UI/production rendering

REAL PASS after two LOW repairs. Bunny Bar shows role chips ("Researcher · Summarizer · Editor"), not providers; progress "0 / 3 steps" from step counts; the only percentages are measured CPU/GPU/RAM telemetry. Repaired: a stopped step read "Running skill project.test" (1db1c31); a direct task's "Task waiting for approval" stayed in the Inbox after approval or end (f1934bd). Production matrix on the extracted package: desktop 1440×900 and phone 390×844 (mobile, DPR 3), light and dark, with a running Mission, an approval card and a waiting direct task, plus the direct-task decision page: 0 console errors, 0 page errors, 0 failed requests, no horizontal overflow; screenshots inspected. `vite preview` (vercel preset) refuses workstation auth because it exposes no loopback peer; the desktop middleware is the shipped runtime. Completion-then-collapse is covered by a unit test only (SIMULATED).

## Installed-Host staged upgrade

REAL PASS (boot/logon persistence NOT TESTED). Before: PID 14188 (started 12:39:27 by the logon shortcut), instanceId 5b8d70f2, schema v2, 51 tasks (0 active), 13 projects; code = clone `eae148b` plus uncommitted M3 work (nearest commit `ea0e803`). Rollback materials: read-only `VACUUM INTO` backup (sha256 6a5eb71f…), config copies kept locally, `ea0e803` Host extracted and proven to boot on a backup copy; instructions in `installed/ROLLBACK.md`. Upgrade: identity and no-active-jobs guards, stop PID 14188, relaunch through the Startup shortcut via Explorer → PID 41264, instanceId 1c7dec9d, code f1934bd. After: `host-error.log` empty; schema v3 with `ma0.missions.v1`; tasks, projects, outcomes and devices preserved; providers detected; missions disabled by default; gateway, tunnel worker, cloudflared and Island untouched and not duplicated; the user's v10 dashboard showed agents and tasks with 0 errors; the Island showed provider data "Reported 11:47 PM" (after the restart); a direct local task completed ("READY"). Phase Z: missions enabled intentionally, a deterministic Mission ("git status") and a local-model Mission ("MA1-Z-OK") completed in a disposable project; then missions were disabled again and the project removed.

Disclosed operator incident: while stopping my own helpers after Phase Z, an over-broad process pattern also stopped the pre-existing M3 package server on 8085 (`test-results/m3/serve-package.mjs`, started by the earlier M3 milestone). I restarted it about a minute later with the identical command line and working directory (new PID 11020, `/m3-qa-health` OK; `installed/m3-serve-restore.txt`). The tunnel worker and cloudflared were not affected; no other pre-existing process was touched.

## Security invariant results

- Provider authority ≤ step authority ≤ Mission envelope: violated as frozen by B1 (account connectors and plugin MCP in a read step), C1 (unsandboxed REPL/MCP servers in a write step) and F0 (cloud inference for a local-only task); each repaired and retested live. After repairs every observed provider session matched its step: read sessions had no write path (OS/sandbox/tool-list evidence), write sessions stayed in their root (outside-root manifests identical), retries/reroutes kept the step's access and root, budget-exhausted steps never launched or substituted a provider outside the allow list.
- Capability authority ≤ grant ≤ envelope: out-of-envelope paths, sensitive actions and risk classes asked; denials had no effect; allow-once produced only the intended effect; remote devices could not reach workstation-only actions; the browser never reached a private target through Bunny's proxy.
- Process authority: Stop killed only the target Mission's process trees; after 6f6095c a Host crash no longer leaves Bunny's git running (MSYS hook grandchildren can still outlive a crash but cannot commit).

## Defects discovered

| # | Finding | Class | Severity | State |
|---|---|---|---|---|
| 1 | Codex read sessions registered 228 account connector tools and a plugin MCP server | SECURITY | BLOCKER | repaired 95ed30f |
| 2 | Codex Mission write sessions spawned unsandboxed node_repl / computer-use / plugin MCP | SECURITY | HIGH | repaired 88c3874 |
| 3 | Local-only routing chose an Ollama cloud-hosted tag | SECURITY | HIGH | repaired a60bc70 |
| 4 | Mission step boilerplate inferred a filesystem requirement for every step (R-D) | PRODUCT | MEDIUM | repaired 785d7ca |
| 5 | After 4, a non-local read step routed to text-only Ollama (R-D2) | PRODUCT | MEDIUM | repaired 7e98d28 |
| 6 | Refused browser download crashed the Host (unhandled rejection) | PRODUCT | HIGH | repaired d8cc7e2 |
| 7 | Desktop package omitted `src/lib/bunny-missions`; packaged Host could not start | PRODUCT | HIGH | repaired 6eeff7b |
| 8 | Host crash left Bunny's git running; merge committed after "not resumed" | PRODUCT | HIGH | repaired 6f6095c |
| 9 | Interrupted-merge / stale-lock refusals unclear | PRODUCT | LOW | repaired 9396c76 |
| 10 | Stopped steps labelled "Running …" | PRODUCT | LOW | repaired 1db1c31 |
| 11 | Direct-task approval items never left the Inbox | PRODUCT | LOW | repaired f1934bd |
| 12 | Computer EXECUTE actions always ask in capability-only Missions | PRODUCT | LOW | not repaired (fail-closed; product decision) |
| 13 | Unknown explicit-graph keys silently ignored | PRODUCT | NOTE | open |
| 14 | Runtime-limit cancellation labels the step `user_stopped` | PRODUCT | NOTE | open |
| 15 | Packaged browser capability unavailable (no Playwright in package) | KNOWN LIMITATION | NOTE | documented |
| 16 | Local 7B Ollama generation slow on this workstation | PROVIDER LIMITATION | NOTE | — |
| 17 | Wrong allow-list key in my U fixture | TEST | NOTE | rerun with correct key |
| 18 | `Compress-Archive` transient lock during packaging | ENVIRONMENT | NOTE | retried |

## Repairs made

| Commit | Finding (severity) | Root cause | Test | Retest evidence |
|---|---|---|---|---|
| 95ed30f | #1 BLOCKER | `--ignore-user-config` does not disable Codex's default-on account features (apps, plugins, remote plugins, …) | `execution-scope.test.ts` exact read argv | live read: 0 MCP servers, writes denied (`codex-read/b-retest-*`) |
| 88c3874 | #2 HIGH | Mission write argv kept default features; extensions spawned outside the sandbox | `execution-scope.test.ts` write argv; direct tasks unchanged | live write: no REPL/plugin processes, exact diff (`codex-write/c2-*`) |
| 785d7ca | #4 MEDIUM | routing used the full agent prompt (boilerplate mentions files) | `missions.test.ts` routes on the step objective | live G/F missions route as expected |
| a60bc70 | #3 HIGH | locality was per provider; cloud-hosted tags (`:cloud`, `remote_host`) treated as local | `exec.server.test.ts`, `m2.test.ts`, `missions.test.ts` locality tests | live F: local model, server.log local only (`ollama/f2-*`) |
| 7e98d28 | #5 MEDIUM | 785d7ca dropped the filesystem requirement for non-local steps | `missions.test.ts` | live G2/F routing |
| d8cc7e2 | #6 HIGH | `waitForEvent("download")` promise rejected without a handler | `capabilities.test.ts` (fails without fix) | Host alive 75 s after the same sequence (`security/host-crash-retest.txt`) |
| 6eeff7b | #7 HIGH | package script copied only bunny-host and orch | `desktop-install.test.mjs` import-graph walk (fails on old script) | extracted v14 package starts outside the workspace (`production/pkg-installed-*`) |
| 6f6095c | #8 HIGH | git resolved to Git for Windows' launcher, whose child escapes the Host's job | `capabilities.test.ts` launcher resolution (fails without) | crash retest: git dies with Host, no post-crash commit (`recovery/s4-*`) |
| 9396c76 | #9 LOW | generic refusal texts | `git-merge.test.ts` (fails without) | live messages (`recovery/s5-leftover-message.txt`) |
| 1db1c31 | #10 LOW | `stepActivity` had no stopped/skipped branch | `mission-model.test.ts` (fails without) | stopped mission detail "Stopped" (`production/w/`) |
| f1934bd | #11 LOW | Inbox resolved approval items per mission only | `missions.test.ts` (fails without) | live: approve → item acknowledged |

## Known limitations

- Codex sessions keep Codex's own multi-agent v2 collaboration tools (same sandbox and tool set). Project trust is the only gate on a repo `.codex/config.toml` MCP table.
- Claude write sessions expose additional built-ins and list user plugins under `--safe-mode`; Bash/PowerShell there is user-level authority (M1).
- Computer EXECUTE actions ask per action in capability-only Missions; `list_windows` returns every window title without a sensitivity flag; window targeting is by title substring.
- A Host crash cannot clean up an interrupted merge; the repository keeps it and Bunny explains the manual cleanup. MSYS hook processes can outlive a crash.
- The desktop package has no Playwright (browser capability unavailable there); the package script can hit a transient `Compress-Archive` lock.
- Provider children inherit the Host environment except `CLAUDECODE`.
- The expanded Bunny Bar overlays the dashboard navigation; the phone header says "Idle" while only Missions run.
- An installed-Host restart loads whatever branch is checked out in the repository, because the logon shortcut runs `scripts/bunny-host.mjs` from the working tree.

## Not tested

- Codex `require_escalated` (model declined; policy-declared only).
- Actual approved remote transport (BLOCKED: quick-tunnel hostname no longer resolves) and a physical Android device.
- Boot/logon persistence after the upgrade (no reboot or logout was performed).
- Completion-then-collapse timing in a live UI (unit test only).

## Final regression gates

On `f1934bd`: `npm test` 206/206 + 185/185, `npm run test:ui` 21/21 → **412/412** (399 baseline + 13 M-A-1 tests, none removed); typecheck exit 0; lint 0 errors / 10 warnings (unchanged); build exit 0; migration and legacy compatibility PASS (live installed DB snapshot and pre-M2 backup → v3 twice, originals identical, `ea0e803` reader OK). Evidence: `final/gates/`, `final/migration.log`.

## Final verdict

**BUNNY_MA1_ACCEPTANCE_PASS_WITH_LIMITATIONS**

Live Codex read/write, Claude read/write and local Ollama Missions, routing/retarget/retry, deterministic and multi-agent Missions, DAG scheduling, Stop isolation, truthful Host recovery, browser isolation, Computer Runtime safe actions, the direct task path and the full regression gates pass, and every BLOCKER/HIGH found was repaired and retested live. The limitation is environment-dependent: the actual remote transport (BLOCKED), a physical Android device and boot/logon persistence remain NOT TESTED. Nothing was merged or pushed.
