# Bunny-A M-A-0 Claude Review 0R

Narrow re-review of the Review 0 remediation. Review-only: no production source was
modified, nothing was committed or pushed, no Codex/Claude/Ollama session or Mission was
run, no provider quota was spent, and the installed Host was not touched. Gate logs and
harnesses live in the session scratchpad; DB checks ran only on `VACUUM INTO` copies.

## Review identity

| | |
|---|---|
| Repository | `COMRADEART/router_agent` (local `C:\Users\allam\Documents\new\bun-router`) |
| Branch | `ma0-mission-architecture` |
| Base SHA | `ea0e803b8186ac777ba67f4c47db58ccd6b4407d` (`main` / `origin/main`) |
| Pre-remediation SHA | `33723ee0d3992203bc4951cee76d32ff6df3935a` (= `origin/ma0-mission-architecture`, Review 0 target) |
| Reviewed SHA | `284249353a5b6ae7105d40f1f3a17f135b5d878b` |
| Date | 2026-10-02 |

Confirmed from the local repo:

- The 4 original commits are intact ancestors: `32ce245 → dbab79e → 60d54e0 → 33723ee`.
- The 3 remediation commits sit on top: `02d6a7e`, `b975026`, `2842493`.
- The branch is 3 ahead of `origin/ma0-mission-architecture`, so the remediation is **unpushed**. It isn't merged into `main`.
- The working tree is clean apart from the untracked `MA0_CLAUDE_REVIEW_0.md` and this report. `npm run build` leaves no changes in the tree.
- The full diff from base is 55 files, +7,089/−60. The remediation alone (`33723ee..HEAD`) is 31 files, +1,202/−220.
- Every remediation file is inside the H1/M1/M2/M3/L1–L3 surface or its docs and tests. No unrelated production files changed.
- These files are **byte-identical to `ea0e803`**: `router.ts`, `learning.server.ts`, `registry.server.ts`, `verification.server.ts`, `discovery.server.ts`, `events.ts`, `process-tree.server.ts` and `orch/host-bridge.server.ts`.
- `persistence.server.ts`, `use-island.ts` and `install/` are unchanged since `33723ee`.

## Independent gate results

| Gate | Command | Result |
|---|---|---|
| Script tests | `npm test` (part 1) | **205 / 205** pass, 0 fail / skip / cancel |
| App/Host/Mission tests | `npm test` (part 2) | **166 / 166** pass, 0 fail / skip / cancel |
| UI tests | `npm run test:ui` | **20 / 20** pass |
| **Total** | | **391 / 391** (matches the builder's figure) |
| Typecheck | `npm run typecheck` | exit 0 |
| Lint | `npm run lint` | **0 errors / 10 warnings**. All are in pre-existing island/quorum/auth files (`task.tsx`, `telemetry.tsx`, `ui.tsx`, `voice.tsx`, `quorum/ui.tsx`, `use-current-user.ts`); none is in `bunny-missions/**` |
| Build | `npm run build` | exit 0; `db:migrate` skipped (no `DATABASE_URL`, as before); tree clean afterwards |
| Migration (independent harness) | disposable copies of the live DB and the pre-M2 backup | PASS, see below |
| Legacy compatibility | as above, plus `ea0e803` persistence reading the migrated copies | PASS |

## Finding closure matrix

| Finding | Previous Severity | Status | Evidence |
|---|---|---|---|
| H1 | HIGH | **MITIGATED / ACCEPTED**: fixed for Claude; fixed for Codex shell/file; Codex config/MCP surface remains (R1) | Step → child → adapter chain traced and enforced (see Authority-chain). The real adapter spawn yields Codex `--sandbox read-only` and Claude `--tools Read --allowedTools Read --disallowedTools Write,Edit,Bash,PowerShell --restricted --safe-mode --strict-mcp-config --setting-sources "" --permission-mode dontAsk`. Flags were checked against installed `claude --help` (2.1.288) and `codex exec --help`. The Codex read session still loads the user's `~/.codex/config.toml` (MCP servers/plugins), which Bunny does not isolate. That is R1. |
| M1 | MEDIUM | **MITIGATED / ACCEPTED** | The envelope persists per-step provider authority, `maxSessions` (including retries) and `writeIncludesShell`. Phone and desktop render the same `ApprovalCard`. The server-side approve path uses only Host-owned `requestedScope`; a test proves a forged client scope is ignored. Approval events are distinct: `approval.mission_envelope`, `approval.delegated`, `approval.additional_capability`, `approval.remote_device`. The residual provider-internal boundary is disclosed on the card. |
| M2 | MEDIUM | **FIXED** | An owned checking proxy resolves DNS, checks **all** answers and dials the checked literal IP, with no second lookup. Chromium runs with `bypass: "<-loopback>"`, `--host-resolver-rules=MAP * ~NOTFOUND`, QUIC off, non-proxied WebRTC UDP off and service workers blocked. A real-Chromium test against a real Bunny Host records `hostHits === 0`. |
| M3 | MEDIUM | **FIXED** | `mergeTransaction` checks a clean precondition, takes a sidecar lock, and stages with a marker. It aborts only on proven ownership and uses a fresh cleanup signal. There is no reset. Tests use real repositories, including a real Stop during a hook-blocked `git commit`. |
| L1 | LOW | **FIXED** | The envelope pins the `realpath`'d file plus its argv prefix. The Bus resolves the command once, before authorization, and passes that identity to execution. There is no implicit cwd search. Tests cover a rogue copied `node.exe` and a hijacked PATH for `git`. |
| L2 | LOW | **FIXED** (option A) | The button reads **"Allow this skill run"**, with a caption explaining the scope. The audit text matches. The allowance clears after the run and `scopedPath` roots still apply; tests show a second write inside the run is allowed and an out-of-root write is refused. |
| L3 | LOW | **FIXED** | Direct `cwd` must be absolute, free of control characters, not UNC/ADS/drive-relative, canonical (realpath + inside roots) and an existing directory. Junction escape is rejected, all before any Bus call (`runs().length === 0`). `TaskManager.submit` is untouched. |

## Authority-chain assessment

Invariant: **actual child ≤ step ≤ Mission envelope**. It holds in Bunny's own code.

| Layer | Evidence |
|---|---|
| Planner → step | `access` defaults to `"read"`; explicit graphs get `"write"` only when the literal is `"write"`. Remote devices cannot submit explicit graphs (unchanged). |
| Step → envelope | `scopeFor` records `providers.sessions.steps[{stepId, access}]`. `approve()` refuses if the persisted request no longer equals the current non-completed model steps. |
| Envelope → child | `submit(…, delegated)` *requires* `executionScope` and copies only `{access}`. HTTP `validateSubmit` drops any client `executionScope`, so direct tasks stay unscoped. |
| Child immutability | `TaskManager.update()` rejects any change to `executionScope` or `mission` against the DB copy, which blocks the retarget path. Adapters receive a `structuredClone` with frozen scope. |
| Launch gate | Every `launch()` of a mission child runs `missionScopeCheck` → `providerScopeViolation`, including direct user and phone approval of a pending child. Write requires step = write, envelope = write, and cwd ∈ write roots. Missing authority, a legacy envelope, or an unavailable validator all **fail closed**. |
| Retry / reroute | Mission retry and automatic retry create a fresh child from `step.scope`. Retarget cannot alter the scope. A test covers Codex→Claude reroute plus automatic and explicit retry, all staying `read`. |
| Replan | Replan revokes the envelope, a new approval is required, and retry is refused meanwhile (tested). |
| Capabilities | `decide()` order is unchanged; L1 identity is now part of `scopeViolation`. Cancelled missions get a `deny` decision before any execution. |

I found no path where a lower layer becomes more powerful than the approved upper layer
**inside Bunny's model**. By design (as accepted in Review 0), a user's direct approval of a
pending child can change the provider or budget consent, but never its access level.

## Provider-scope assessment

**Claude read sessions:** credible. The tool set is reduced to `Read`; mutation and shell tools are
explicitly disallowed; `--restricted` confines file tools to the working directory;
`--safe-mode`, `--strict-mcp-config` and `--setting-sources ""` remove plugins, hooks, MCP servers and user settings;
`dontAsk` with `--permission-prompts none` denies anything else. I confirmed that the empty `""` value
survives the real `spawnSession` (`shell:false`, native or node-script target only).

**Codex read sessions:** `--sandbox read-only` is mapped correctly. However, Codex's `-s` flag
governs *model-generated shell commands*. `codex exec` still loads `~/.codex/config.toml`. On
this workstation that file defines `mcp_servers.node_repl` (a Node REPL), plugins
(`computer-use`, `browser`, `chrome`, `slack`, `google-calendar`, `documents`…),
`approval_policy = "on-request"` and `[windows] sandbox = "elevated"`.
MCP servers run outside Codex's sandbox. Upstream reports conflict by version:
[openai/codex#4152](https://github.com/openai/codex/issues/4152) says read-only exec ran MCP edit
tools, while [openai/codex#24135](https://github.com/openai/codex/issues/24135) says current exec auto-cancels MCP calls.
So for Codex, whether a read step is truly read-only depends on the provider version and the user's
config, not on Bunny. Codex supports `--ignore-user-config`; Bunny's read argv does not use it. → **R1**.

**Write sessions:** unchanged from `ea0e803` (Codex `workspace-write`; Claude
`Read,Write,Edit,Bash,PowerShell` + `acceptEdits`). Direct unscoped tasks keep exactly these
defaults, which is verified both by test and by argv echo. H1 did **not** make direct coding tasks read-only.

**Ollama:** text generation over HTTP only, with no tool authority, so scope does not apply. Unchanged.

**M1 residual verdict:** this is an **ACCEPTABLE KNOWN LIMITATION FOR M-A-1**. The approval card
now states truthfully that write steps can edit files and run shell commands, that sessions
are bounded, and that effects inside a provider session are governed by the provider. The one
over-absolute phrase, "Read steps cannot write", is accurate for Claude but depends on R1 for Codex.

## Browser isolation assessment

**FIXED.**

- **Literal addresses:** IPv4 uses a `BlockList` covering 0/8, 10/8, 100.64/10, 127/8, 169.254/16, 172.16/12, 192.168/16, 198.18/15, the doc/test ranges, multicast and 240/4. IPv6 must be global unicast (2000::/3) and not Teredo, 6to4 or documentation; anything zone-qualified is refused. This rejects `::1`, `fc00::/7`, `fe80::/10`, `::ffff:127.0.0.1` and NAT64 `64:ff9b::`. Alternate IPv4 spellings (`2130706433`, hex, short forms) are normalized by WHATWG URL parsing before the check.
- **DNS:** every answer is checked, and the connection goes to the checked literal IP with no second lookup. That closes the rebinding time-of-check/time-of-use gap per connection (`keepAlive:false`).
- **Redirects and subresources:** each new request re-enters the proxy and is re-checked, and the Playwright route check plus final-URL `safeUrl` remain. Blocked CONNECT fails the navigation, and a blocked HTTP request returns 403 with `x-bunny-browser-blocked`, which `browser.*` turns into a failure.
- **Reaching Bunny Host:** not possible. Removing the implicit loopback bypass sends `127.0.0.1:*` through the proxy, where it is refused. The test proves 0 requests reached a real Host over private DNS, both redirect types, an iframe, `fetch`, a WebSocket and a rebind.
- **Residual (not a bypass):** the proxy is an unauthenticated loopback listener that will forward to *public* destinations for any local process. It cannot reach private ranges. Public HTTPS/CONNECT against the live internet still needs M-A-1 testing.

## Git cancellation assessment

**FIXED.**

- **Preconditions:** the transaction refuses to start if MERGE_HEAD, cherry-pick, revert, rebase or `index.lock` is present, or if tracked files are dirty. A pre-existing user merge is left byte-identical (tested).
- **Ownership:** a merge is treated as Bunny's only when all of these hold: MERGE_HEAD == target, ORIG_HEAD == HEAD-before, HEAD unchanged, the MERGE_MSG marker matches, and the sidecar lock marker matches. Only then does Bunny run `merge --abort`, under a fresh 15 s signal, and verify that HEAD, the tracked tree and the index were restored. Untracked user files are preserved.
- **No destructive cleanup:** there is no `reset` anywhere. Cleanup failure is reported (`cleanup.ok:false` → `permission_required`, and Stop's detail says "Cleanup needs attention"), and MERGE_HEAD is left in place.
- **Cancellation ordering:** `bus.cancel` awaits each run's settling, Mission `stop()` awaits `cancelChildren`, and after Stop the cancelled Mission's Bus requests are denied, so there is no retry. All of this is tested against real Git; the Stop test kills a real `git commit` that is blocked in a pre-commit hook.
- **Documented limits:** a hard Host crash can leave `.git/bunny-merge.lock`, after which future Bunny merges are refused truthfully until it is removed (N3). A commit that wins the race against cancellation is reported as merged, which is honest.

## Legacy regression assessment

**PASS.**

- **Direct submit, approve, routing, retarget, Stop, project-root validation:** code paths are unchanged apart from the immutability guard and the scope check that applies only to mission children. The original Host/routing/verification/pairing tests pass.
- **Direct `approve(id)`:** still emits `approval.accepted`. When a paired device approves, it now also emits an additive `approval.remote_device` event, even with missions off (N2, intended audit).
- **Codex/Claude normal write config:** argv is identical to `ea0e803` for unscoped tasks (Claude's `tools` string is unchanged for win32 and non-win32).
- **Provider discovery, snapshot, pairing, learning, verification, event normalization:** the files are byte-identical to base, or unchanged since `33723ee` where Review 0 verified them.

**Independent migration harness** (read-only `VACUUM INTO` snapshots; SHA-256 of the source DB and WAL unchanged before and after):

| Source | user_version | Legacy rows (pre-migration columns) after two opens | Tasks with scope/mission | Legacy `update()` through the guard | `ea0e803` reads migrated DB |
|---|---|---|---|---|---|
| Live Host DB | 2 → 3 | identical, events included | 0 / 51 | OK | 51 / 51 |
| Pre-M2 backup | 1 → 3 | identical under both M-A-0R and `ea0e803` code | 0 / 13 | OK | 13 / 13 |

- The remediation adds **no SQL migration**, only optional JSON fields.
- A pre-remediation envelope that lacks `providers.sessions` or `terminal.executables` **fails closed** (the child or command asks or is refused; replan required). It never falls back to unrestricted.
- With missions off, `missionScopeCheck` can only affect tasks that carry `mission`, so direct tasks keep their behavior.

## Test-quality assessment

**Good.** The new tests exercise real mechanisms rather than mock fields:

| Claim | Test proves it via |
|---|---|
| Actual provider launch config | `execution-scope.test.ts` runs the **real** `CodexAdapter`/`ClaudeAdapter.launch` → `spawnSession`, with a node argv-echo executable, for legacy, read and write. |
| Scope reaches the adapter through the real TaskManager | `missions.test.ts` uses the real TaskManager and MissionManager with a fake adapter that captures the frozen task. Argv is derived with the same `codexLaunchArgs`/`claudeLaunchArgs` that the real adapters call. |
| Reroute, retry and replan cannot escalate | Codex→Claude retarget, automatic and explicit retry, replan-to-write needing a new approval, and forged write child / mutated step both refused on direct approval. |
| Browser resolves network targets | Injected `lookup` and `connect` seams, plus real Chromium and a real Host, with a `hostHits` counter. |
| Git cleanup on real repositories | `git init` fixtures; a native hook-blocked commit Stop; a pre-existing conflict preserved; cleanup failure kept honest. |
| Remote approval = desktop approval | `missionCommand(..., {local:false, actor:"device:…"})` with a forged `scope` produces an envelope equal to `requestedScope`. |
| Same-basename executable | A real copy of `node.exe` in a rogue directory, plus a PATH-prepended fake `git`. |
| CWD rejection before launch | Eleven invalid forms plus Windows UNC, drive-relative and ADS forms, and a junction escape; `runs().length === 0`; no directory created. |

Gaps:

- No test asserts that Codex read sessions are isolated from the user's config/MCP (R1). The adapter test cannot see this, because it only echoes argv.
- `--setting-sources ""` is not asserted by the suite; I verified it manually.
- Live provider behavior under these flags is not tested, which is expected for M-A-1.

## Remaining findings

### R1: Codex read sessions inherit the user's Codex config (MCP servers and plugins); read-only is not isolated as it is for Claude
- **Severity:** MEDIUM
- **Relation:** H1 residual, the "equivalent execution tools" clause. Same class as the M1 provider boundary.
- **Files:** `src/lib/bunny-host/adapters.server.ts` `codexLaunchArgs` (327–329); approval wording in `src/components/island/mission-model.ts` (103).
- **Issue:** a read step maps only to `--sandbox read-only`, which constrains Codex's own shell and file writes. `codex exec` still loads `~/.codex/config.toml`. Here that file enables a `node_repl` MCP server (a code-execution tool outside the Codex sandbox) and side-effecting plugins (computer-use, browser, Slack, Calendar). Claude's read path strips the equivalent surface; Codex's does not.
- **Evidence:**
  - Static argv.
  - `codex exec --help` lists `--ignore-user-config` and `--ignore-rules`, which are unused.
  - The config sections listed above, read without exposing their values.
  - Upstream #4152 vs #24135: whether MCP calls are cancelled in exec mode depends on the Codex version.
  - Not live-tested; live provider sessions were out of scope.
- **Impact:** a Codex-routed "read only" step may be able to execute code or external actions through user-configured MCP servers or plugins, depending on the installed Codex version. The card's "Read steps cannot write" is then over-stated for Codex. No regression from `ea0e803`, where every session was write+shell anyway.
- **Required before M-A-1:** **YES, as an entry gate for the Codex read-acceptance case only**, not a freeze blocker.
- **Recommended action:**
  - For `access:"read"`, launch Codex with `--ignore-user-config` (and `--ignore-rules`). Then re-supply only what is needed, especially `-c windows.sandbox=…`, because dropping `[windows] sandbox = "elevated"` could weaken read-only enforcement on native Windows.
  - Or explicitly empty `mcp_servers` and disable plugins via `-c`.
  - Make M-A-1's first live Codex read test probe MCP and plugin availability and attempt a file write, so that read-only is shown by evidence.

### N1: Report's Codex version does not match this workstation
- **Severity:** NOTE. **Relation:** H1 evidence. **Files:** `MA0_REMEDIATION_REPORT.md`; `adapters.server.ts:326` comment.
- The report says flags were checked against Codex `0.159.0-alpha.12.1`. The binary that Bunny's discovery resolves first (`%LOCALAPPDATA%\Programs\OpenAI\Codex\bin\codex.exe`) reports `codex-cli 0.153.4`. Both expose `--sandbox read-only`, so there is no functional impact.
- **Required before M-A-1:** NO. Record the actual version during M-A-1.

### N2: Direct-task phone approval now emits an extra audit event
- **Severity:** NOTE. **Relation:** M1. **File:** `manager.server.ts` `approve()`.
- `approval.remote_device` is added after `approval.accepted` when a device approves, independent of the missions flag. This is additive and intended, and existing consumers and tests are unaffected. **Required before M-A-1:** NO.

### N3: Stale `bunny-merge.lock` after a hard crash
- **Severity:** NOTE. **Relation:** M3. **File:** `git-merge.server.ts`.
- After a Host or process crash mid-transaction, the sidecar lock persists and later Bunny merges are refused truthfully until it is removed. This is documented and safe-by-refusal. **Required before M-A-1:** NO. Consider surfacing a remediation hint in the refusal text.

### N4: `CapabilityBus.cancelledSteps` is never cleared, and cancelled mission ids accumulate
- **Severity:** NOTE. **File:** `bus.server.ts` 66–67, 113.
- No production caller passes a `stepId` filter, so `cancelledSteps` is dead code. `cancelledMissions` for stopped missions persists for the process lifetime, which is tiny. If a step-level cancel is ever wired, that step's id would be denied forever. **Required before M-A-1:** NO.

## M-A-1 evidence still required

These are expected evidence gaps, not defects. Source inspection found none of these paths structurally impossible or unsafe, except R1 as noted.

- A real Mission → Codex read step (must include the R1 probe) and write step.
- A real Mission → Claude read step (attempt a Write/Bash and confirm refusal) and write step.
- A real Mission → Ollama.
- Live provider reroute within a Mission.
- Native-Windows enforcement of Codex `read-only` under the configured Windows sandbox.
- Real Windows mutating computer actions.
- A public phone Mission flow (tunnel/HTTPS), approving a write+shell plan from the phone.
- A production installed-Host restart with the migrated DB.
- The real GitHub API path.
- A real web-research path over public HTTPS through the checking proxy (CONNECT pinning live).
- A concurrency soak of `setImmediate` finalization against ticks, carried over from Review 0.

## Candidate freeze SHA

**`284249353a5b6ae7105d40f1f3a17f135b5d878b`** (`2842493`, branch `ma0-mission-architecture`, unpushed).

## Final verdict

All seven Review 0 findings are closed or mitigated in code, and I verified that independently:

- M2, M3, L1, L2 and L3 are **FIXED**, with tests that exercise real mechanisms: real Chromium against a real Host, and real Git with a native Stop.
- H1's authority chain (child ≤ step ≤ envelope) is enforced at every launch, including direct and phone approval, retarget, retry and replan. It fails closed for legacy data.
- Claude read sessions are tightly confined.
- M1's residual provider boundary is truthfully disclosed and is acceptable for M-A-1.
- No protected legacy behavior regressed: the gates match (391/391, typecheck, build, lint 0 errors / 10 pre-existing warnings), and the migration was re-verified on live and backup copies.

The one substantive residual is **R1** (MEDIUM): Codex read sessions are not isolated from the
user's Codex config, MCP servers and plugins. It is not an escalation beyond `ea0e803` and not a
defect in Bunny's authority model. It does mean "read only" for Codex currently rests on provider
version and config, so it must be closed or disproved by a live probe before M-A-1 accepts a
Codex read step.

**BUNNY_MA0_FREEZE_APPROVED_WITH_NOTES**
