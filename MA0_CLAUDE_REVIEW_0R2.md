# Bunny-A M-A-0 Claude Review 0R2

Final R1 closure and freeze review. Review-only: no production source modified, nothing
committed, pushed or merged, installed Host untouched. No Codex/Claude/Ollama model session,
Mission or MCP server was started. Codex was invoked only for `--version`/`--help` and for
`mcp list` under a throwaway, credential-less `CODEX_HOME` (no auth, so no model reachable).
Database checks used read-only `VACUUM INTO` copies only.

## Review identity

| | |
|---|---|
| Branch | `ma0-mission-architecture` (4 ahead of `origin/ma0-mission-architecture`; unpushed, unmerged) |
| PRE_R1_SHA | `284249353a5b6ae7105d40f1f3a17f135b5d878b` |
| Reviewed SHA | `180ab234b2e81e7745e7402c4eb9483586c36eab` (`MA0R2: isolate Codex read mission sessions`) |
| Date | 2026-10-02 |

History is `ea0e803` → 4 M-A-0 commits → 3 M-A-0R commits → **exactly one** new commit, `180ab23`.
`git diff 2842493...HEAD` touches 6 files:

| File | Kind of change |
|---|---|
| `src/lib/bunny-host/adapters.server.ts` | Production: the only source change (+10/−3 lines) |
| `src/lib/bunny-host/execution-scope.test.ts` | Tests |
| `MA0_R1_CLOSURE_REPORT.md` | New report |
| `MA0_REMEDIATION_REPORT.md` | Docs |
| `MA0_CLAUDE_REVIEW_PACKET.md` | Docs |
| `docs/MA0_SECURITY_MODEL.md` | Docs |

Mission, TaskManager, persistence, HTTP, router, discovery and UI files show **no diff**
since `2842493`. The only untracked files are the two earlier review reports.

## Exact Codex executable evidence

| Item | Evidence |
|---|---|
| Resolved by Bunny | `C:\Users\allam\AppData\Local\Programs\OpenAI\Codex\bin\codex.exe`. Obtained by calling the Host's own `locate(systemContext(),"codex")` (filesystem only): `kind:"native"`, `source:"PATH"`, `args:[]`. `where.exe codex` agrees. |
| Version | `codex-cli 0.153.4`, matching the closure report. It corrects the earlier `0.159.0-alpha` claim, which was Review 0R note N1. |
| `exec --help` | `--sandbox <read-only\|workspace-write\|danger-full-access>`. `--ignore-user-config`: "Do not load `$CODEX_HOME/config.toml`; auth still uses `CODEX_HOME`". `--ignore-rules`: "Do not load user or project execpolicy `.rules` files". `-c key=value` takes a dotted path and the value is parsed as TOML. |
| `windows.sandbox` value | The key is strictly typed. Passing `-c windows.sandbox="bogus"` fails with *"unknown variant `bogus`, expected `elevated` or `unelevated` in `windows.sandbox`"*. Passing `-c windows.sandbox="elevated"`, spawned from Node with `shell:false` exactly as `spawnSession` does, loads cleanly (exit 0). |

## R1 launch-contract verification

**R1: CLOSED at the launch-contract level.**

`CodexAdapter.launch` calls `codexLaunchArgs(task)`, with the platform defaulting to
`process.platform`, then `spawnSession` (`shell:false`, native target).
This is the generated argv for a Mission read child on this host (win32):

```text
exec --json --sandbox read-only --ignore-user-config --ignore-rules
-c windows.sandbox="elevated" --skip-git-repo-check --cd <approved cwd> --model <routed model> -
```

| Requirement | Result |
|---|---|
| Flags supported by the Bunny-resolved binary | Yes: all four flags appear in its `exec --help`. |
| Windows override is a fixed trusted literal | Yes: a string constant in source, emitted only on `win32`. No task, user or config input reaches it. |
| Nothing copied back from user config | Confirmed. No `-p`/`--profile`, `--enable`, `--add-dir`, MCP or plugin tables, or other `-c` keys. The test asserts that the **only** `-c` value is that one literal on win32, and that there are none on Linux or macOS. |
| No permissive execpolicy reintroduced | Confirmed. `--ignore-rules` drops user and project `.rules` files, and no rules are passed. No `--approve-for-me` or `--dangerously-bypass-*` flag is present (asserted). |
| No fallback without isolation | Confirmed. `spawnSession` has no retry. Mission retries build a fresh child through the same `codexLaunchArgs`, and none of them strips flags. |
| What config isolation removes on this workstation | The user `config.toml` holds `mcp_servers.node_repl` and `mcp_servers.openaiDeveloperDocs`; plugins `computer-use`, `browser`, `chrome`, `slack`, `google-calendar`, `documents` and others, each enabled by an explicit `[plugins."…"] enabled = true` entry with marketplaces declared there too; a `notify` hook; and `approval_policy`. All of it lives in the file `--ignore-user-config` skips. `~/.codex/plugins/` contains only `cache/`. |
| Project-level `.codex/config.toml` | I ran a contained probe with a throwaway `CODEX_HOME` and a throwaway project defining an MCP server. `codex mcp list --json` returns `[]` when the project is untrusted; the positive control (the same project marked trusted in the throwaway home's `config.toml`) returns the server. Project trust is stored in `$CODEX_HOME/config.toml`, which is ignored, so a repository's own `.codex/config.toml` should not be loaded in a read session. This is inferred from `mcp list` rather than observed in `exec`; see N1. |

## Windows sandbox preservation

Ignoring `config.toml` would have dropped the user's `[windows] sandbox = "elevated"`. The
adapter restores **only** that setting, as one argv element (`windows.sandbox="elevated"`, TOML
quotes included):

- I spawned it through `shell:false` and Codex accepted the parsed value.
- Codex's strict variant check means a malformed value fails loudly rather than being silently ignored.
- I confirmed earlier this session that Node quotes argv elements carrying special characters correctly through the same spawn path.
- On non-Windows platforms the flag is omitted.
- No other user setting is reintroduced through any path.
- Whether the elevated sandbox actually refuses writes on native Windows is CLI-enforced and is deferred to M-A-1.

## Authority-chain assessment

**PASS, unchanged.** R1 touched only argv construction, so the chain reviewed in 0R stands as it was:

- Planner default is read.
- `requestedScope` ↔ steps are checked at approval.
- `submit` requires a scope for delegated children.
- `update()` rejects any change to scope or mission link.
- Adapters receive a frozen copy of the task.
- `launch()` runs `providerScopeViolation` on every mission-child launch, including direct and phone approvals.

The isolation is chosen purely by `executionScope.access === "read"`, never by role. Research/read and
CustomAgent/read each get the hardened launch, proven through the real spawn path.
Research/write keeps `workspace-write` with normal configuration, so an explicitly authorized write step
remains write-capable. Actual child authority ≤ step authority ≤ approved envelope.

## Retarget/retry/replan assessment

**PASS.** These were executed in the gate run through the real chain, with argv captured from the spawned process:

| Scenario | Result |
|---|---|
| Pending child retargeted Claude → Codex | `executionScope` stays `read`. Claude is then made unavailable, so the retry routes to Codex. The first, automatic-retry and explicit-retry launches are **3 distinct child ids**, all `provider: codex`, all with the full isolation contract. |
| Replan that keeps read access | The old envelope is `revokedAt`. `tick()` before re-approval launches nothing; after a new approval, a new step id spawns with the isolation contract. |
| Scope mutation or removal | Refused both on the frozen adapter copy (`TypeError`) and through `TaskManager.update` (`/immutable/`). |

No path rebuilds a child without `executionScope`. Mission retry and replan go through
`submit(…, {executionScope: step.scope.access})`, and retarget is subject to the immutability guard.

## Direct/write regression assessment

**PASS.** I generated the full argv myself for each case:

| Case | Generated argv | vs pre-R1 (`2842493` source literal) |
|---|---|---|
| A. Direct legacy Codex task (no scope) | `exec --json --sandbox workspace-write --skip-git-repo-check --cd <cwd> --model <m> -` | identical |
| B. Mission write Codex task | same as A | identical |
| C. Mission read Codex task (win32) | the hardened contract above | intended change |
| C. Mission read Codex task (linux) | the same, without `-c` | intended change |

- **Claude:** the diff is one comment line; the `claudeLaunchArgs` body is unchanged. Real-spawn tests for legacy, read and write still pass.
- **Ollama, router, discovery:** no diff.
- **Feature-off and direct-task tests:** retained and passing.
- **Normal coding tasks:** not made read-only.

## Test-quality assessment

**Good. The tests exercise the real path, not only a helper.**

- `missionFixture` builds a real `HostDatabase` + `TaskManager` + `MissionManager` + **real `CodexAdapter`**. Only `launchTarget` (a Node argv-echo script), `detect`/`health`/`usage` (so no CLI or account probe) and a Claude stand-in are substituted.
- Argv is captured from the spawned child's stdout through the real `spawnSession` raw hook.
- **Direct and write cases compare the entire spawned argv against a hard-coded pre-R1 literal**, independent of the production helper.
- The Linux and macOS contracts are helper-level, using the `platform` parameter. That is acceptable: production calls the same helper, and the Windows branch is also exercised by real spawn on this host.

| Scenario | Coverage |
|---|---|
| Windows / Linux / macOS contracts | ✔ |
| Research/read and CustomAgent/read | ✔ real spawn |
| Claude → Codex retarget | ✔ |
| Automatic and explicit retries | ✔ |
| Replan | ✔ |
| Stale approval rejection | ✔ (revoked envelope; expired envelope before retarget) |
| Child scope mutation and removal | ✔ |
| Legacy child or envelope metadata fails before spawn | ✔ `launches.length === 0`; state stays `waiting_for_approval` |

**8 tests added and 0 removed:** no `test(` lines were deleted in any test file.
Not provable by an argv stand-in, and correctly not claimed: live tool registration, and OS write refusal.

## Independent gate results

| Gate | Result |
|---|---|
| `npm test`, scripts | **205/205** pass, 0 fail / skip / cancel |
| `npm test`, app/Host/Mission | **174/174** pass, 0 fail / skip / cancel (all 8 `MA0R2:` tests among them) |
| `npm run test:ui` | **20/20** pass |
| **Total** | **399/399** |
| `npm run typecheck` | exit 0 |
| `npm run lint` | exit 0. **0 errors / 10 warnings**: the same set and files as Review 0R; no new warnings |
| `npm run build` | exit 0; tree clean afterwards |

## Migration/legacy result

**PASS.** R1 changes no schema, persistence or migration code (empty diff for `persistence.server.ts`
and every mission/store file). I re-ran my own harness on read-only snapshots:

- **Live Host DB:** `user_version` 2→3; legacy rows and events identical after two opens; 0 of 51 tasks carry scope or mission data; a legacy `update()` passes the immutability guard; `ea0e803` persistence reads all 51.
- **Pre-M2 backup:** behaves the same, with 13 tasks. Its pre-migration column values are identical under both new and base code; I showed this in 0R.
- **Source files:** main and WAL hashes are unchanged in both cases.
- **Legacy mission data:** stale children or envelopes still fail closed and require a replan. Ordinary legacy direct tasks are unaffected.

## Residual M-A-1 evidence requirements

These are deferred to M-A-1 and are not grounds to refuse the freeze:

- A live Codex read Mission: enumerate the tools the session exposes (no `node_repl`, plugins or integrations), and attempt a write that native Windows must refuse under `read-only` + `elevated`.
- The same live read Mission run against a repository that contains its own `.codex/config.toml` (N1).
- Live Codex write Mission, live Claude read and write, live Ollama, and live in-Mission reroute.
- The remaining 0R items: phone public flow, installed-Host restart with the migrated DB, mutating Windows computer actions, real GitHub, and live browser research over HTTPS.

## Remaining findings

No BLOCKER, HIGH or MEDIUM. R1 is closed.

### N1: Project-level Codex config exclusion is inferred, not observed in `exec`
- **Severity:** NOTE. **Relation:** R1. **File:** `adapters.server.ts` `codexLaunchArgs`.
- `--ignore-user-config` is documented as skipping `$CODEX_HOME/config.toml` only.
- My controlled probe shows a project's `.codex/config.toml` is loaded only for trusted projects, and trust is stored in the ignored file. So no project MCP servers should load, but this was observed via `mcp list`, not `exec`.
- **Required before M-A-1:** NO. Include it in the M-A-1 live read probe.

### N2: Non-authority Codex inputs still load
- **Severity:** NOTE. **Relation:** R1 / M1.
- Admin-managed or system Codex configuration, `AGENTS.md` and `$CODEX_HOME/skills` (instructions) still apply. None of these adds tools beyond the read-only sandboxed shell.
- Managed config is the workstation owner's policy, analogous to Claude's managed settings.
- **Required before M-A-1:** NO.

### N3: The hard-coded elevated Windows sandbox may block read sessions on unprepared workstations
- **Severity:** NOTE.
- On a workstation where Codex's elevated Windows sandbox is not set up, read sessions may fail to start. That is fail-closed and only a functional issue; there is no unsandboxed fallback.
- **Required before M-A-1:** NO. Record the sandbox setup state during M-A-1.

**Carried from 0R (unchanged and still NOTE):**
- `approval.remote_device` is an additive audit event on direct tasks.
- A stale `bunny-merge.lock` after a hard crash makes later Bunny merges refuse.
- `CapabilityBus.cancelledSteps` is never cleared and is unused in production.

0R's N1 (version discrepancy) is **resolved** by the corrected `0.153.4` evidence.

## Freeze decision

R1 is now a real property of the Codex read Mission launch contract:

- Scope-driven `read-only` + `--ignore-user-config` + `--ignore-rules`.
- Only a fixed, validated `windows.sandbox="elevated"` override.
- Exercised through the actual MissionManager → TaskManager → CodexAdapter → spawnSession path, including retarget, retry, replan and fail-closed legacy metadata.

Direct and write Codex argv is byte-identical to pre-R1, Claude, Ollama, router and discovery are unchanged, all 399 tests pass, gates are clean, and persistence is untouched. What remains is live provider-side enforcement, which is correctly deferred to M-A-1.

**BUNNY_MA0_FREEZE_APPROVED_WITH_NOTES**

## MA0_FREEZE_SHA

```text
MA0_FREEZE_SHA=180ab234b2e81e7745e7402c4eb9483586c36eab
```
