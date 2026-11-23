# Bunny-A M-A-0R — Review 0 remediation report

October 2, 2026 · `COMRADEART/router_agent` · branch `ma0-mission-architecture`.

**BUNNY_MA0_REMEDIATION_COMPLETE**

Original independent verdict: **BUNNY_MA0_REVIEW_PASS_WITH_REMEDIATION** — 0 BLOCKER, 1 HIGH, 3 MEDIUM, 3 LOW. This closes the supplied Review 0 scope; it is not M-A-1 or a redesign. M1 is **MITIGATED**, rather than claiming that provider-internal operations have become Capability Bus calls.

## M-A-0R2 / R1 follow-up

Claude Review 0R independently returned **BUNNY_MA0_FREEZE_APPROVED_WITH_NOTES** for `284249353a5b6ae7105d40f1f3a17f135b5d878b`: no BLOCKER/HIGH, with **R1 (MEDIUM)** required before accepting a Codex read step in M-A-1. The earlier H1 work enforced child ≤ step ≤ envelope, but Codex still inherited user-configured MCP/plugin tools. **R1 launch-contract remediation is complete**; independent Claude Review 0R2 is still required before treating its commit as a final freeze candidate.

Read-scoped Codex launches now use `--sandbox read-only --ignore-user-config --ignore-rules`, plus the sole explicit Windows override `-c windows.sandbox="elevated"`. Bunny's actual resolved executable is `C:\Users\<user>\AppData\Local\Programs\OpenAI\Codex\bin\codex.exe`, **codex-cli 0.153.4**. Its `exec --help` confirms both isolation flags and dotted TOML `-c` syntax; a help-only invocation accepts the actual generated argv. The running Host reports the same path/version. This corrects the earlier documentation's evidence from a different alpha executable. User config/auth and both untracked Claude reports were not edited.

Only the Codex argument helper changes production behavior. Explicit read scope controls isolation, independent of role; direct and write argv are identical to pre-R1. Claude launch code, provider discovery/routing, Mission architecture, persistence and installed Host remain unchanged. New tests exercise real MissionManager → TaskManager → CodexAdapter → spawnSession with disposable CLI stand-ins, covering Research/CustomAgent, Claude → Codex retarget, automatic/explicit retry, read replan and missing-authority refusal. Existing tests now assert the exact direct/write argv and minimal config restoration.

| R1 gate | Result | Ignored local evidence under `test-results/ma0r2/` |
|---|---|---|
| Focused adapter/scope tests | **14/14** | `focused-test.log` |
| Full tests | **205 script + 174 app/Host/Mission + 20 UI = 399/399**, 0 failures/skips/cancellations; all 391 prior tests retained, 8 added | `full-test.log`, `ui-test.log` |
| Typecheck / build | **exit 0 / exit 0** | `typecheck.log`, `build.log` |
| Lint | **0 errors / same 10 warnings**; diagnostic output byte-identical to M-A-0R | `lint.log` |
| Migration / legacy compatibility | **PASS**, source DB/WAL unchanged; two snapshot opens and actual `ea0e803` reads | `migration-evidence.json`, `migration.log` |
| Missions disabled / direct behavior | **PASS**, retained full-suite tests plus exact legacy adapter argv | full tests |
| Dev / built render | Desktop/mobile content, clean console, no overflow; all four screenshots inspected. Built output does not diverge from the prior reviewed built baseline. The existing built-preview Host connection limitation still differs from connected dev. | `dev-smoke.log`, `built-smoke.log`, `prior-built-comparison.json`; `screenshots/ma0r2-*.png` |

The complete current evidence, exact CLI syntax, changed-file list and residual acceptance boundaries are in [MA0_R1_CLOSURE_REPORT.md](MA0_R1_CLOSURE_REPORT.md). No live provider session, M-A-1 acceptance, configured MCP invocation, user-profile browser/computer action, push, merge or history rewrite was performed. The following sections retain the historical Review 0 remediation evidence and counts.

## Preserved baseline

Before edits, `git status --short` showed only the user-supplied untracked `MA0_CLAUDE_REVIEW_0.md`; it was read fully and remains unchanged/untracked. Branch was `ma0-mission-architecture`, HEAD `33723ee0d3992203bc4951cee76d32ff6df3935a`. Diff `ea0e803...HEAD`: 48 files, +6,098/−51. No unrelated production edits were present.

The original four commits remain ancestors: `32ce245` → `dbab79e` → `60d54e0` → `33723ee`. No reset, clean, history rewrite, push or merge was performed.

Remediation code commits:

* **`02d6a7efe2423d3cca6ab6c466f509e22da2aedd`** — `MA0R: enforce mission authority and safe Git cancellation`.
* **`b97502638a1304a004376a06170d33f520196327`** — `MA0R: isolate browser connections from private networks`.
* **`284249353a5b6ae7105d40f1f3a17f135b5d878b`** — `MA0R: close review findings and document regression evidence` (original documentation/handoff, independently reviewed in Review 0R).

## Finding closure

| Finding | Disposition | Exact change and evidence |
|---|---|---|
| **H1 HIGH** | **FIXED** | Persisted `executionScope` goes from the step through the existing TaskManager child path into the actual adapters. Envelope binds step ids/access and launch validates child ≤ step ≤ envelope. Scope and mission link are immutable; provider receives a frozen snapshot. Codex read uses `read-only`; Claude read exposes only Read with explicit Write/Edit/Bash/PowerShell denial, restricted mode, dontAsk and no setting sources. Write/unscoped direct argv retain previous defaults. Tests cover custom read roles, explicitly writable Research, both real adapter launch functions with argv stand-ins, direct behavior, retarget/reroute, automatic and explicit retry, replan approval and mutation attempts. |
| **M1 MEDIUM** | **MITIGATED** | Envelope records per-step provider authority, finite total sessions including retries, and write-session shell authority. Approval UI displays roots, read/write agent steps, sessions, cloud/runtime budgets and provider-internal effects. Direct task, envelope, delegated child, extra capability and remote-device approval audit events are distinct. Paired-phone HTTP approval grants exactly the persisted displayed provider scope and ignores forged caller roots/budget fields. UI fixture checks pass on dev/built desktop/mobile. Provider-internal actions remain under CLI permissions, outside the Bus; disclosed residual below. |
| **M2 MEDIUM** | **FIXED** | An owned proxy resolves every new HTTP/CONNECT/WebSocket destination, rejects any prohibited DNS answer, and dials the checked literal IP. Redirects and subresources share the boundary; no second DNS lookup or implicit loopback bypass. Service workers, QUIC and non-proxied WebRTC UDP are disabled. Address checks cover IPv4 and IPv6 local/reserved forms. Unit/integration tests prove public fixture browsing and zero requests to a real disposable Bunny Host through local/private DNS, redirects, subresources and rebinding. |
| **M3 MEDIUM** | **FIXED** | Clean tracked/index precondition; existing operations refused; captured HEAD/target/status plus owned lock and unique merge marker. Stage native merge without commit, then commit. Only provably owned unfinished merges are aborted, using a fresh bounded cleanup signal. Verify original HEAD/tree/index, preserve untracked work, never reset or abort an unrelated merge. Capability cancellation and Stop wait for cleanup/persistence and prevent retries. Real repository tests cover success, conflict, native Git Stop, process failure, capability/mission cancellation, pre-existing user merge and explicit cleanup failure. |
| **L1 LOW** | **FIXED** | Terminal envelope binds canonical executable path and launch prefix. The Bus resolves once before authorization and passes that identity to execution, avoiding another PATH lookup. Legitimate PATH commands remain supported. A copied rogue same-basename executable and a changed Git PATH cannot inherit trusted identity; explicit approval of another path still works. Same-path binary replacement is a residual limitation. |
| **L2 LOW** | **FIXED** | Chosen solution A: skill approval says **Allow this skill run**, describes repeated matching actions within that run/approved folders, and has accurate domain/audit wording. Other actions still ask; allowance clears after the run. Standalone capability/provider requests retain **Allow once**. Tests perform two matching writes, check later-run approval and out-of-root refusal, and check UI labels. |
| **L3 LOW** | **FIXED** | Direct capability/skill cwd must be plain absolute, existing, canonical and inside registered/default roots. Reject relative/malformed/control-character/missing/file/outside/Windows UNC/ADS values and junction escape; accept approved subdirectories. No arbitrary folder creation or expanded project access. Original TaskManager task submission validation stays intact. |

## REVIEW 0 REMEDIATION MAP

Paths in this table are repository-relative. Detailed authority/limitations are in [docs/MA0_SECURITY_MODEL.md](../MA0_SECURITY_MODEL.md).

| ID → commit | Production files | Regression tests |
|---|---|---|
| H1 → `02d6a7e` | `src/lib/orch/types.ts`; `src/lib/bunny-host/{contracts,manager.server,adapters.server}.ts`; `src/lib/bunny-missions/{types,authorization.server,manager.server}.ts` | `src/lib/bunny-host/execution-scope.test.ts` (6 actual adapter launches with Node argv stand-ins); `src/lib/bunny-missions/missions.test.ts` scope/role/retry/reroute/replan/mutation/invariant cases |
| M1 → `02d6a7e` | Scope files above; `src/lib/bunny-host/http.server.ts`; `src/components/island/{mission-model.ts,mission.tsx}` | `missions.test.ts` bounded phone/envelope serialization; `capabilities.test.ts` paired HTTP scope/actor/override assertions; `mission-model.test.ts`; dev/built approval fixture QA |
| M2 → `b975026` | `src/lib/bunny-missions/capabilities/{browser.server,browser-network.server}.ts` | `src/lib/bunny-missions/browser-network.test.ts` (4); original real-browser capability regression retained |
| M3 → `02d6a7e` | `src/lib/bunny-missions/capabilities/{git-merge.server,local.server,bus.server}.ts`; `src/lib/bunny-missions/{manager.server,types}.ts` | `src/lib/bunny-missions/git-merge.test.ts` (6 real repository cases); existing Git/worktree/conflict tests retained |
| L1 → `02d6a7e` | `src/lib/bunny-missions/{authorization.server,types}.ts`; `capabilities/{bus.server,process.server,local.server}.ts` | `capabilities.test.ts` rogue executable identity/PATH case; existing structured terminal and skill command tests |
| L2 → `02d6a7e` | `src/components/island/{mission-model.ts,mission.tsx}`; mission types/manager/authorization and Bus comments/reasons | `missions.test.ts` multi-action skill approval; `mission-model.test.ts` labels; desktop/mobile fixture clicks |
| L3 → `02d6a7e` | `src/lib/bunny-missions/commands.server.ts` | `missions.test.ts` direct cwd malformed/unauthorized/junction negatives and valid approved subfolder |

## Test gates

All results were run on the final code now committed at `b975026`; later changes are documentation only. Logs below are local ignored evidence under `test-results/ma0r/`.

| Gate | Reviewed baseline | M-A-0R result | Evidence |
|---|---|---|---|
| Full script tests | 205/205 | **205/205**, 0 failed/skipped | `full-test.log` |
| Full app/Host/mission tests | 139/139 | **166/166**, 0 failed/skipped | `full-test.log` |
| UI tests | 18/18 | **20/20**, 0 failed/skipped | `ui-test.log` |
| Typecheck | exit 0 | **exit 0** | `typecheck.log` |
| Lint | 0 errors / 10 warnings | **0 errors / same 10 existing warnings** | `lint.log` |
| Production build | clean | **exit 0**, existing dependency directive notices | `build.log` |
| Migration compatibility | additive, old rows preserved | **PASS**, two populated snapshots and old-JSON unit regression | `migration-evidence.json`, `migration.log`, full tests |
| Legacy direct path | pass | **PASS**, all original Host/routing/verification/pairing tests and exact feature-off direct event sequence | full tests and adapter legacy argv cases |

Total **391**, up **29** from 362: +6 Host adapter tests, +10 mission tests, +1 capability test, +4 browser-network tests, +6 merge tests, +2 UI tests. No test was deleted; existing assertions were extended for additive envelope fields.

The full test run required normal Windows process permissions so native Git Stop fixtures could terminate their own children. Restricted-shell `taskkill` initially returned access denied; the native Stop test was rerun successfully, and the entire final suite passed with owned fixture process termination permitted. This was not a production behavior change or a reason to hide cleanup failures.

## Migration and untouched legacy contracts

Only read-only source SQLite connections and disposable `VACUUM INTO` snapshots were used. Current Host: **51 tasks, 13 projects, 1,836 events, 36 outcomes, 9 devices**. Pre-M2 backup: **13 tasks, 1 project, 890 events, 5 outcomes, 4 devices**. Every original column value/record byte/count was compared after **two** new-code opens; only the additive migration key is new. The actual `ea0e803` persistence module then read both migrated snapshots, including tasks/projects/events/performance. Both source main files and WAL SHA-256 values were unchanged before/after. Original-row digests: current `d42e114945dcb52ae686ed3e8d4ce95c6488439c5aa092b17c3cf1f7e7cef609`; backup `a93c240606196bfc855219f5c6ff331d788676adc6a90ee7d9bec7c57a28840d`.

M-A-0R adds optional JSON fields, no SQL migration and no legacy rewrite. Old mission authority stays absent and fails closed pending explicit replan/approval. Direct unscoped records keep their previous adapter defaults. Live installed Host was not restarted or upgraded during remediation.

Verified empty diff against `33723ee` for BunnyRouter, ProviderRegistry, learning policy, TaskManager process-tree implementation, verification, Host bridge, UI store and `install/`. Provider detection/usage/event parsing are unchanged; only launch authority flags changed. No second router or mission-specific provider adapter exists. MissionManager still launches models only through TaskManager.

## Browser/UI verification and limits

Standard dev and fresh production-output smoke runs show real content on desktop and 390×844 mobile, no module/hydration/console/page errors and no horizontal overflow. Both sets of screenshots were inspected. The production preview cannot obtain workstation Host access in this existing preview setup and settles to Host offline; the connected-dev comparison therefore reports shorter body text, not a blank app. The Host bridge remains unchanged. `render-probe.mjs` records the distinction.

Additional `approval-ui-check.mjs` intercepts **every** server-function request with isolated snapshots derived from the real MissionManager. It verifies access/session/root/side-effect wording, skill-run labels, correct approval/respond payloads, clean console and no overflow on dev/built desktop/mobile. All eight approval/skill screenshots were inspected; no fixture click could reach the running Host. Evidence: `approval-ui-evidence.json`, `approval-ui.log`, `screenshots/ma0r-*-approval.png` / `*-skill.png`. Playwright used the installed isolated Edge binary; `agent-browser` was unavailable. Dev remains running.

The first restricted browser smoke could not load the platform branding script; the ordinary-permission rerun passed without removing it. The pre-existing optional share-card placeholder notice remains; brand assets/redesign are outside this targeted utility remediation.

## Residual limitations / M-A-1 handoff

* **M1:** provider-internal write/shell/external actions remain governed by CLI permissions, not Capability Bus mediation. Approval delegates this explicitly. Claude tool restrictions are a CLI trust boundary, not an OS write jail for writable sessions. No claim of per-operation external-effect gating inside provider sessions is made.
* Review 0's Codex help evidence came from a different 0.159.0-alpha.12.1 executable. R1 corrects this with Bunny-resolved **codex-cli 0.153.4**, supported isolation flags and actual adapter argv stand-ins; Claude Code 2.1.288 launch code is unchanged. **No live Codex/Claude/Ollama mission acceptance was run and no mission quota was spent.** M-A-1 must run the authorized live read/write acceptance against installed providers, including Codex tool-availability and native Windows write-refusal probes.
* Terminal trust pins canonical file + argv prefix; same-path binary/library replacement by a workstation actor is outside this fix.
* Git cleanup is truthful, not unconditional: if ownership cannot be proven, inspection/abort fails, an early interruption leaves an unowned index lock, or commit wins cancellation, preserve work and report it. Hard Host/process crashes are not automatically repaired. No destructive reset or cleanup of a user-created merge is added.
* Browser defense governs its destination connections, not an exploited browser/native workstation process or remote public server's own fetches. Public fixture HTTP and CONNECT pinning are tested; broad live internet browsing and actual phone/public tunnel acceptance remain M-A-1 work.
* Released v10/v13 binaries, native WPF mission UI and Windows action automation were not exercised. No destructive Windows automation was performed.

Nothing remains **NOT FIXED** within the requested Review 0 scope. The rereview packet asks for finding closure and regressions, not repetition of the original full architecture review.
