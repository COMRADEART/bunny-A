# Bunny-A M-A-1 — Claude review packet

Review the M-A-1 live-acceptance repairs and the evidence behind the builder's claim **BUNNY_MA1_ACCEPTANCE_PASS_WITH_LIMITATIONS**. [MA1_ACCEPTANCE_REPORT.md](MA1_ACCEPTANCE_REPORT.md) and [MA1_ACCEPTANCE_MATRIX.md](MA1_ACCEPTANCE_MATRIX.md) are the implementer's account, not an independent verdict. Do not trust them: read the diff, run the gates, and re-derive what you can from the raw evidence files listed below.

## Identity and review diff

| Item | Value |
|---|---|
| Repository / branch | `COMRADEART/router_agent` / `ma1-live-acceptance` |
| Freeze (unchanged) | `180ab234b2e81e7745e7402c4eb9483586c36eab` (verdict BUNNY_MA0_FREEZE_APPROVED_WITH_NOTES) |
| Final code SHA | `f1934bda6b0d33f27bef198e8967a69f6eb329ff` |
| Branch head | the commit that adds this packet (docs only above `f1934bd`); confirm with `git rev-parse HEAD` |
| Push / merge / history rewrite | none |

Review `git diff 180ab234b2e81e7745e7402c4eb9483586c36eab HEAD`. Commits, oldest first:

| Commit | Change | Files |
|---|---|---|
| 95ed30f | Codex read sessions: `--disable` 12 default-on features + `web_search="disabled"` | `src/lib/bunny-host/adapters.server.ts`, `execution-scope.test.ts`, `docs/MA0_SECURITY_MODEL.md` |
| 88c3874 | same flags for Mission (scoped) write steps; unscoped direct tasks unchanged | adapters, `execution-scope.test.ts`, doc |
| 785d7ca | Mission children routed on the step objective (`routingPrompt`) | `bunny-host/contracts.ts`, `manager.server.ts`, `orch/types.ts`, `bunny-missions/manager.server.ts`, `missions.test.ts` |
| a60bc70 | Ollama locality per model (cloud-hosted tags are not local); launch guard | `orch/exec.server.ts`, `orch/types.ts`, `bunny-host/router.ts`, `adapters.server.ts`, `manager.server.ts`, `bunny-missions/manager.server.ts`, tests |
| 7e98d28 | non-local Mission steps keep the filesystem requirement | `bunny-missions/manager.server.ts`, `missions.test.ts` |
| d8cc7e2 | handled rejection for a refused/failed browser download | `capabilities/browser.server.ts`, `capabilities.test.ts` |
| 6eeff7b | desktop package copies `src/lib/bunny-missions` | `scripts/package-bunny-desktop.ps1`, `scripts/desktop-install.test.mjs` |
| 6f6095c | git resolves past Git for Windows' `cmd\git.exe` launcher | `capabilities/process.server.ts`, `capabilities.test.ts` |
| 9396c76 | refusal texts for an interrupted Bunny merge / stale lock | `capabilities/git-merge.server.ts`, `git-merge.test.ts` |
| 1db1c31 | stopped/skipped steps never read "Running" | `src/components/island/mission-model.ts`, its test |
| f1934bd | direct-task approval items leave the Inbox when approved or ended | `bunny-missions/inbox.server.ts`, `manager.server.ts`, `missions.test.ts` |
| df80e13 | security-model notes | `docs/MA0_SECURITY_MODEL.md` |
| (head) | these three reports | `MA1_*.md` |

## How to verify independently

1. Gates: `npm test`, `npm run test:ui`, `npm run typecheck`, `npm run lint`, `npm run build`. Expected: 206 + 185 + 21 = 412 passing, 0 failing, typecheck 0, lint 0 errors (10 pre-existing warnings), build 0.
2. Each new test should fail on its parent commit: for each repair commit `X`, `git checkout X~1 -- <prod files of X>` and run its test, then `git checkout HEAD -- <files>`. The builder did this for every repair.
3. Live evidence (local, git-ignored `test-results/ma1/`, same convention as M2/M3): raw transcripts (`*/…-transcript.jsonl`), OS process watches (`*proc*.jsonl`, `final/proc-watch-host-*.jsonl`), mission/task records (`*-final.json`), filesystem/git checks (`*-filesystem-evidence.txt`, `git/`, `recovery/`), screenshots (`production/x/`, `phone/shots/`). Provider statements are kept apart from Bunny's observations (`*-provider-claims.txt` vs `*-filesystem-evidence.txt`).
4. Installed Host: `installed/y-pre-upgrade.json`, `y-backup.json`, `y-rollback-probe.txt`, `y-upgrade.txt`, `y-post-*.json`, `ROLLBACK.md`, `z-*`, `z2-*`.

## Live tests performed (real vs simulated)

REAL (live provider/OS/browser): Codex read (as frozen and repaired), repo `.codex/config.toml` attack, Codex write (as found and repaired), Claude read and write, local Ollama, routing/retarget/reroute/retry, multi-agent Mission, parallel DAG, deterministic Mission, skill lifecycle, isolated browser with local canaries, Computer Runtime (fixture + Calculator), computer risk approval, git worktree/merge/conflict/Stop, Stop isolation with an unrelated process, UI close/reconnect, test-Host crash/restart (as found and repaired), phone authorization at the Host layer, budgets, failure propagation, Mission Bar live state, production-runtime browser matrix, desktop package from a clean location, installed-Host upgrade, installed-Host Mission smoke (deterministic and local model).

SIMULATED: phone UI over HTTPS (local TLS front emulating the tunnel; Chrome Pixel 7 emulation); completion-then-collapse (unit test).

NOT TESTED / BLOCKED: actual approved remote transport (quick-tunnel hostname ENOTFOUND, BLOCKED), physical Android, boot/logon persistence (no reboot), Codex `require_escalated`.

## Defects and repairs to scrutinise

1. **95ed30f / 88c3874** — Are the disabled feature names the right contract for codex-cli 0.153.4, and is there any remaining path to account connectors, plugins or unsandboxed MCP in scoped sessions? Do unscoped direct tasks keep their exact previous argv? Evidence: `codex-read/b-tool-registry-before-fix.json` vs `b-retest-*`; `codex-write/c-proc-summary.txt` vs `c2-proc-summary.txt`.
2. **a60bc70** — `runsLocally` treats `:cloud`/`-cloud` suffixes and `remote_host`/`remote_model` tags as non-local. Can a local-only task or Mission still reach cloud inference (stale task, retarget, retry)? Evidence: `ollama/f0-*`, `ollama/f2-*`.
3. **785d7ca / 7e98d28** — routing on `routingPrompt` must not weaken any hard constraint or envelope check; `taskViolation` still governs launches.
4. **6f6095c** — `realGit` only rewrites a `…\cmd\git.exe` path that has a real sibling binary. Confirm envelope executable identities (resolved at scope time and at exec time) stay consistent, and that the S crash retest really had the launcher first on PATH (`recovery/s-retest-path.txt`). Root-cause probe: `recovery/s-job-escape-probe.txt`.
5. **6eeff7b** — the import-graph test parses the script's folder list; check it would catch a new top-level folder the Host imports.
6. **d8cc7e2, 9396c76, 1db1c31, f1934bd** — small; check `resolveTask` cannot acknowledge items of other tasks or missions.
7. Unrepaired LOW: computer EXECUTE always asks in capability-only Missions (fail-closed). Decide whether the scope request should list EXECUTE for EXECUTE-risk computer actions.

## Security boundary results claimed

Provider authority ≤ step ≤ envelope held after repairs (violated as frozen by B1/C1/F0); capability authority ≤ grant ≤ envelope held (asks, denials without effect, allow-once only intended effect, device limits, browser proxy blocks); Stop and crash process handling bounded to Bunny's own trees except MSYS hook grandchildren after a crash. See report section "Security invariant results".

## Installed Host state at handoff

PID 41264, instanceId `1c7dec9d-4194-43a3-90d1-83d10624449a`, code `f1934bd` from the working tree, schema v3, 13 projects, 53 tasks (51 previous + 2 smoke), missions disabled, remote configuration unchanged; v10 dashboard, Island, tunnel worker and cloudflared are the original processes; the 8085 M3 package server was restarted by me after an accidental stop (disclosed). Rollback: `test-results/ma1/installed/ROLLBACK.md`. The logon shortcut starts whatever branch is checked out.

## Remaining limitations

See the report's "Known limitations" and "Not tested". Requested from the reviewer: an independent verdict on whether any repair is incomplete or introduces a regression, and whether the PASS_WITH_LIMITATIONS classification is justified by the evidence.
