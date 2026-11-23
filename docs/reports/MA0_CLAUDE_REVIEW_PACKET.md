# Bunny-A M-A-0R2 — Narrow Claude Review 0R2 packet

Review **R1 Codex read-step configuration isolation and regressions only**. Claude Review 0R returned **BUNNY_MA0_FREEZE_APPROVED_WITH_NOTES** for `284249353a5b6ae7105d40f1f3a17f135b5d878b`, with no BLOCKER/HIGH. R1 (MEDIUM) is the single condition before M-A-1 accepts a Codex read step. Do not repeat the full architecture review or run M-A-1 live-provider acceptance.

The builder claims **BUNNY_MA0_R1_CLOSED**. Read the code/tests independently; [MA0_R1_CLOSURE_REPORT.md](MA0_R1_CLOSURE_REPORT.md) and [MA0_REMEDIATION_REPORT.md](MA0_REMEDIATION_REPORT.md) contain implementer evidence, not an independent verdict.

## Identity and review diff

| Item | Value |
|---|---|
| Repository / branch | `COMRADEART/router_agent` / `ma0-mission-architecture` |
| Pre-R1 reviewed SHA | `284249353a5b6ae7105d40f1f3a17f135b5d878b` |
| Post-R1 candidate | The single commit containing this packet: `MA0R2: isolate Codex read mission sessions`; verify exact SHA with `git rev-parse HEAD` / final handoff. **Not final freeze approval.** |
| Seven preserved commits | `32ce245`, `dbab79e`, `60d54e0`, `33723ee`, `02d6a7e`, `b975026`, `2842493` |
| Push / merge / history rewrite | None |
| Supplied reviews | `MA0_CLAUDE_REVIEW_0.md`, `MA0_CLAUDE_REVIEW_0R.md` remain untouched and untracked. |

Review `git diff 284249353a5b6ae7105d40f1f3a17f135b5d878b HEAD`. Only production behavior changed: `codexLaunchArgs` in `src/lib/bunny-host/adapters.server.ts`. Other changed files: its `execution-scope.test.ts`, the two reports/this packet, and the affected paragraph in `docs/MA0_SECURITY_MODEL.md`. Claude launch code, Mission architecture, TaskManager, discovery, routing, usage probes, persistence, bridge, UI, Stop/process-tree and `install/` are unchanged.

## Actual CLI evidence and R1 contract

Bunny discovery with saved Host executable settings resolves **`C:\Users\<user>\AppData\Local\Programs\OpenAI\Codex\bin\codex.exe`**, reporting **`codex-cli 0.153.4`**. A read-only running-Host snapshot confirms the same path/version. Previous alpha-version documentation referred to another executable and is corrected here.

The resolved binary's `exec --help` supports `--ignore-user-config`, `--ignore-rules`, `--sandbox read-only`, and dotted TOML `-c key=value`. Its help says ignoring config omits `$CODEX_HOME/config.toml` while retaining auth there, and ignoring rules omits user/project execpolicy rules. The complete generated read argv plus `--help` was accepted by that executable (exit 0, identical help); no provider session was launched.

Read scope now yields:

```text
exec --json --sandbox read-only --ignore-user-config --ignore-rules
-c windows.sandbox="elevated"                    (native Windows only)
--skip-git-repo-check --cd <cwd> --model <model> -
```

The Windows setting is a fixed trusted Host literal, supplied as a single TOML argv value. It preserves this workstation's existing elevated sandbox selection after dropping user config. No user setting/profile/MCP/plugin definition is re-imported. Other platforms omit only the Windows override. Unscoped direct and explicit write launches keep their **exact pre-R1 argv**. Scope is authoritative, independent of role.

## Focused review questions

1. Does the actual adapter spawn retain `read-only` and both supported isolation flags? Is the only restored config the explicit native Windows sandbox setting, with no profile/tool/plugin re-enable or bypass? Check the installed binary evidence, not the earlier alpha executable.
2. Do Research/read and CustomAgent/read launch the same hardened configuration, while Research/write and direct tasks remain writable with unchanged argv? Does Claude's reviewed configuration remain untouched?
3. Trace **MissionManager → TaskManager → immutable child → actual CodexAdapter → spawnSession** for a normal read step, Claude → Codex retarget, automatic/explicit retry and read replan requiring fresh approval. Challenge scope mutation/removal and missing legacy child/envelope metadata; they must fail before spawn.
4. Confirm no removed tests, schema change, DB rewrite, second provider launch path, weakening of the bridge or change to disabled-Missions/direct behavior. Do not infer live provider/native Windows acceptance from stand-ins or help-only parser checks.

Tests to inspect: `src/lib/bunny-host/execution-scope.test.ts` (**14**, including **8 new**). Six retained real-adapter stand-ins now assert read isolation and literal entire pre-R1 direct/write argv. New platform/read/retarget/retry/replan/legacy tests use real managers and actual Codex adapter process launch with disposable Node CLI IO. `src/lib/bunny-missions/missions.test.ts` retains explicit write Research, immutability, child ≤ step ≤ envelope, migration/old-JSON and feature-off/direct regressions.

## Gates and reproducible evidence

```text
npm test
npm run test:ui
npm run typecheck
npm run lint
npm run build
```

Expected and observed: **205 script + 174 app/Host/Mission + 20 UI = 399/399**, all prior 391 retained, 8 added; 0 failures/skips/cancellations. Typecheck/build exit 0. Lint: 0 errors / same 10 warnings, output byte-identical to M-A-0R. Full-suite Git Stop fixtures need permission to terminate their own disposable native processes; never broadly terminate production processes.

Local ignored evidence under `test-results/ma0r2/`: `codex-cli-evidence.json`, installed CLI help files, `focused-test.log`, `full-test.log`, `ui-test.log`, `typecheck.log`, `lint.log`, `build.log`, `migration-evidence.json`, `migration.log`, `dev-smoke.log`, `built-smoke.log`, `prior-built-comparison.json`.

Migration compatibility rechecked on **read-only source / disposable snapshots** of live Host and pre-M2 backup: source DB/WAL unchanged, every original column/row/JSON byte unchanged after two opens, and actual `ea0e803` persistence reads both migrated copies. No production migration or installed-Host restart. Desktop/mobile dev and fresh built renders show content, clean console and no overflow; screenshots inspected. Built versus connected dev still reports the reviewed Host connection difference; current built versus the prior reviewed built verdict has no divergence.

## Boundaries and requested verdict

No normal Codex/Claude/Ollama Mission, configured MCP invocation, provider quota use or M-A-1 acceptance. Config-wide isolation is the launch contract; runtime tool availability and native Windows read-only enforcement still require authorized M-A-1 live evidence. M1's accepted provider-internal permission boundary and other Review 0R notes remain unchanged.

Please independently state whether **R1 is CLOSED**, whether the required regression evidence holds, and whether this post-R1 candidate is approved for freeze with the existing notes. If not, identify the exact remaining R1 defect with code/test evidence. Only Claude Review 0R2 can approve the new candidate as the final freeze SHA.
