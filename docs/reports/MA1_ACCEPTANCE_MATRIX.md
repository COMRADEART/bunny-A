# Bunny-A M-A-1 Acceptance Matrix

Freeze: `180ab234b2e81e7745e7402c4eb9483586c36eab` · branch `ma1-live-acceptance` · final code SHA `f1934bd` (later commits are documentation only).

Status vocabulary: REAL PASS / REAL FAIL / SIMULATED PASS / NOT TESTED / BLOCKED / NOT APPLICABLE.
Kind: REAL (live process, provider, OS or browser), SIMULATED (emulated environment or stand-in), STATIC (code or file inspection only), NOT TESTED.
Evidence paths are relative to `test-results/ma1/` (git-ignored, local to this workstation, as in earlier milestones). Running notes for every row: `final/phase-results.md`.

| ID | Scenario | Required evidence | Status | Kind | Evidence path |
|---|---|---|---|---|---|
| A1 | Frozen baseline gates (tests, UI tests, typecheck, lint, build) | exact counts, exit codes | REAL PASS (399/399) | REAL | `baseline/gates-summary.txt`, `baseline/*.log` |
| A2 | Migration + legacy compatibility on the frozen code | live DB untouched, copies migrated twice, legacy reader | REAL PASS | REAL | `baseline/migration.log`, `baseline/migration/` |
| B1 | Live Codex read Mission at freeze | OS argv, sentinel absent, non-model tool inventory | REAL FAIL (BLOCKER: 228 connector tools + plugin MCP registered) | REAL | `codex-read/b-tool-registry-before-fix.json`, `b-proc-watch.jsonl`, `b-provider-claims.txt` |
| B2 | Live Codex read Mission after 95ed30f | 0 MCP servers, writes denied by OS/sandbox | REAL PASS | REAL | `codex-read/b-retest-*`, `b-postfix-rollout-facts.jsonl` |
| B3 | Codex read: `require_escalated` path | live attempt | NOT TESTED (model declined under approval=never; policy-declared only) | NOT TESTED | `codex-read/b-retest-transcript-summary.txt` |
| B4 | Repo `.codex/config.toml` attack (MCP, sandbox, instructions) | positive control, adversarial control, Bunny run | REAL PASS | REAL | `codex-read/b2-*` |
| C1 | Live Codex write Mission (as found, 95ed30f) | exact diff, outside-root hashes, processes | REAL FAIL (HIGH: node_repl, computer-use REPL, plugin MCP outside sandbox) | REAL | `codex-write/c-*` |
| C2 | Live Codex write Mission after 88c3874 | hardened argv, exact diff, verify, outside-root identical | REAL PASS | REAL | `codex-write/c2-*` |
| D1 | Live Claude read Mission | init tools/mcp, sentinels absent | REAL PASS | REAL | `claude-read/d-*` |
| E1 | Live Claude write Mission | exact diff, outside-root identical, verify | REAL PASS (+NOTE M1) | REAL | `claude-write/e-*` |
| F0 | Ollama local-only routing at freeze | routed model locality | REAL FAIL (HIGH: cloud-hosted tag chosen as "local") — no launch | REAL | `ollama/f0-localonly-routing-task.json`, `ollama/ollama-tags-evidence.txt` |
| F1 | Live local Ollama Mission after a60bc70 | server.log local generate, accounting, no cloud | REAL PASS | REAL | `ollama/f2-*` |
| G1 | Auto routing + provider failure + reroute | kill evidence, same step, second provider | REAL PASS | REAL | `routing/g1-*` |
| G2 | Manual retarget of a pending child | same step/task, approval | REAL PASS | REAL | `routing/g2-*` |
| G3 | Provider unavailable: no unapproved substitution | step waits, no task | REAL PASS | REAL | `routing/g3-*` |
| G4 | Mission child routing on step objective (R-D / R-D2) | routed providers | REAL FAIL → repaired 785d7ca/7e98d28 → REAL PASS | REAL | `routing/g2-pending.json`, `final/phase-results.md` |
| H1 | Retry preserves read/write authority across providers | attempt scopes, diff | REAL PASS | REAL | `routing/g1-*`, `routing/h2-*` |
| I1 | Multi-agent Mission (Research ∥ Architect → Coding → Reviewer) | order, artifacts handoff, verify | REAL PASS | REAL | `mixed-mission/i-*` |
| J1 | Parallel DAG, failed prerequisite blocks dependents, siblings finish | step states, concurrency | REAL PASS | REAL | `mixed-mission/j-*` |
| K1 | Deterministic zero-external-provider Mission | scope (no execution), 0 sessions, accounting | REAL PASS | REAL | `deterministic/k-*` |
| L1 | Skill record/verify/replay/invalidate/repair/retire | versions, stop at failing step | REAL PASS | REAL | `deterministic/l-skill.log`, `l1-*.json` |
| M1 | Isolated browser: public capture, private targets blocked | Chrome argv, proxy 403s, canary | REAL PASS (+NOTE: subresource blocking not Bunny-attributable) | REAL | `browser/*` |
| M2 | Refused browser download crashes Host (found during M) | Host exit, stderr | REAL FAIL (HIGH) → repaired d8cc7e2 → REAL PASS | REAL | `security/host-crash-*` |
| N1 | Computer Runtime on a UIA fixture | type/invoke/postcondition, sensitive asks | REAL PASS | REAL | `computer/n-*`, `n2-*` |
| N2 | Calculator 2+3=5 via UIA, close only Bunny's instance | before/after window+process counts | REAL PASS | REAL | `computer/n3-*` |
| O1 | Computer risk approval: in-envelope runs, out-of-envelope pauses, deny = no effect, allow = only intended effect | runs, files, artifacts, independent UIA read | REAL PASS (+LOW: computer EXECUTE always asks) | REAL | `computer/o-*` |
| P1 | Worktree + clean merge | merge commit parents + marker | REAL PASS | REAL | `git/p1-*` |
| P2 | Conflicting merge aborted, only Bunny's | HEAD/tree/hash identical | REAL PASS | REAL | `git/p2-*` |
| P3 | User merge in progress never aborted; dirty tree refused | MERGE_HEAD/hash identical | REAL PASS | REAL | `git/p3-*` |
| P4 | Stale `index.lock` / stale Bunny lock | refused, locks untouched | REAL PASS (message improved 9396c76) | REAL | `final/phase-results.md` (P4), `recovery/s5-leftover-message.txt` |
| P5 | Stop during Bunny merge commit | taskkill tree, HEAD restored, hook ended | REAL PASS | REAL | `git/p5-*` |
| Q1 | Stop isolation: Mission A stops; Mission B, direct task, unrelated process continue | heartbeats, process watch, Ollama log | REAL PASS | REAL | `stop/*` |
| R1 | UI close + UI server kill + reconnect | mission continues, reconnect state, no duplicates | REAL PASS | REAL | `recovery/r-*`, `production/shots/r*` |
| S1 | Test-Host crash/restart honesty (as found d8cc7e2) | recovery text, run states, repo state | REAL FAIL (HIGH: merge committed by orphaned git after "not resumed") | REAL | `recovery/s-*`, `recovery/s-job-escape-probe.txt` |
| S2 | Crash retest after 6f6095c (Git\cmd first on PATH) | git dies with Host, no post-crash commit | REAL PASS | REAL | `recovery/s4-*`, `s-retest-*` |
| S3 | Leftover/stale merge refusal messages after 9396c76 | live messages, cleanup then merge | REAL PASS | REAL | `recovery/s5-leftover-message.txt` |
| T1 | Unpaired denied; pairing; workstation-only actions refused; revoke (Host layer) | HTTP status/errors, events | REAL PASS | REAL | `phone/t-device-layer.json` |
| T2 | Remote lifecycle: create, approve, answer approval (deny), stop (Host layer) | mission states, artifacts delta, heartbeat | REAL PASS | REAL | `phone/t-device-lifecycle.json` |
| T3 | Phone UI over HTTPS gateway: unpaired → pair → plan → approve → stop → revoke | UI text, cookie flags, device-attributed events | SIMULATED PASS (local TLS front emulating the tunnel; Chrome Pixel 7 emulation) | SIMULATED | `phone/t-mobile-*.json`, `phone/shots/` |
| T4 | Actual approved remote transport (Cloudflare quick tunnel) | public path | BLOCKED (approved quick-tunnel hostname ENOTFOUND; no new public tunnel created) | NOT TESTED | `final/phase-results.md` (T notes) |
| T5 | Physical Android device | device run | NOT TESTED (no device available) | NOT TESTED | — |
| U1 | Max steps, active missions, concurrency | refusals, counts | REAL PASS | REAL | `budget/u-steps13-result.txt`, `git/u-active-mission-limit.json`, `mixed-mission/j-concurrency.txt` |
| U2 | Mission runtime limit | failure time, process cancelled | REAL PASS | REAL | `budget/u-runtime-*` |
| U3 | Retry clamp/ceiling | stored maxRetries, attempt count | REAL PASS | REAL | `budget/u-retries-*` |
| U4 | External model call budget | third call not launched, no substitution | REAL PASS | REAL | `budget/u-external2-*` (and `u-external-*`, TEST error noted) |
| V1 | Failure propagation (dependency, verification, sibling, permission, stop, budget, provider unavailable) | step states, no retry loops | REAL PASS | REAL | `budget/v-*`, `computer/o-final.json`, `stop/*`, `routing/g3-*` |
| W1 | Bunny Bar roles, step-count progress, no fabricated %, approval/failed/blocked/stopped states | screenshots + text | REAL PASS (after LOW repairs 1db1c31, f1934bd) | REAL | `production/x/*`, `production/w/*` |
| W2 | Completion briefly shown then collapses | timing | SIMULATED PASS (unit test only) | SIMULATED | `src/components/island/mission-model.test.ts` |
| X1 | Production build/runtime: desktop + mobile, light + dark, mission/approval/direct | console/page/request errors, overflow, screenshots | REAL PASS | REAL | `production/x/*.json`, `production/x/*.png` |
| X2 | Desktop package Host starts from a clean location (found while preparing X/Y) | ERR_MODULE_NOT_FOUND, then start | REAL FAIL (HIGH) → repaired 6eeff7b → REAL PASS | REAL | `production/pkg-installed-*`, `production/package-v14.log` |
| Y1 | Staged installed-Host upgrade with rollback materials | identity, backups, rollback boot, migration, data preserved, dashboard/Island reconnect, direct task | REAL PASS | REAL | `installed/y-*`, `installed/ROLLBACK.md` |
| Y2 | Boot/logon persistence after upgrade | reboot/logout | NOT TESTED (no reboot performed) | NOT TESTED | — |
| Z1 | Installed-Host deterministic Mission smoke | completion, accounting | REAL PASS | REAL | `installed/z-*` |
| Z2 | Installed-Host provider-backed (local) Mission smoke | completion, accounting | REAL PASS | REAL | `installed/z2-*` |
| FR | Final full regression on f1934bd | exact counts | REAL PASS (412/412, typecheck 0, lint 0 errors, build 0, migration PASS) | REAL | `final/gates/`, `final/migration.log` |
| SEC | Invariant: provider authority ≤ step ≤ envelope; capability authority ≤ grant ≤ envelope | per-phase observations | REAL PASS after repairs (B1/C1/F0 were violations before repair) | REAL | see report "Security invariant results" |
