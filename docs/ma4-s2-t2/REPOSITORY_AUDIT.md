# MA4-S2-T2 — Repository audit (Phase 0)

## Integration baseline

| Fact | Value | How verified |
|---|---|---|
| PR #21 (MA4-S2-T1-CI1) | **MERGED** into `ma4-s1r3-agent-reliability` | `gh pr view 21` |
| Merge commit (S2-T2 base) | `c3bff8a4e5cddbef261a35f09d32b77b322b9ced` | `git log origin/ma4-s1r3-agent-reliability` |
| CI on the merge commit | push run 40020322592 **success**, pull_request run 40020351611 **success** | `gh run list --branch ma4-s1r3-agent-reliability` |
| CI on PR #21's final head `f28377c` | run 40019905769: typecheck/tests/builds, full regression, static security — all **success** | `gh run view 40019905769` |
| Last validated code commit before | `4f6be51` (CI1); `f28377c` changed docs only | CI1 report |

At the start of S2-T2 both merge-commit runs and the final-head full regression were still in progress; they were
re-checked before this gate was marked. Green CI on an earlier commit was not used for a later one.

## Worktree

`C:\Users\allam\Documents\new\bun-router-s2t2`, branch `ma4-s2-t2-connected-actions`, created from `c3bff8a`. No other
worktree or the main checkout (`ma4-s1-model-intelligence`, with uncommitted user changes) was modified. Fresh-worktree
setup per the S2-T1 note: `native/voice/vendor/` and `releases/installed/JEV-Windows-v1/runtime/LICENSE` copied from the
main checkout (both git-ignored), `npm ci`, `npm run pretest`. `pretest` rebuilds `native/voice/bunny-voice-worker.exe`
and `.json` (tracked); those rebuilt files are **not** committed.

## What existed (read before building)

| Area | Location | Reused for |
|---|---|---|
| Persistent task runtime (S2-T1) | `ma4/task-runtime*.ts`, `task-store.server.ts` | Every connected action runs as a task step: durable intent before effect, fenced leases, UNCERTAIN, reconciliation, hash-bound approvals |
| Host lifecycle | `http.server.ts` `startHost()` | F-CI1-1 fix; wiring |
| Paired-device authority | `device-authority.server.ts` (default-deny action allowlist, phone view sanitizer) | New actions stay workstation-only by default; phone view of pending actions |
| Isolated browser (MA3) | `bunny-missions/capabilities/browser*.server.ts` | Browser connector: profile isolation, origin allowlist on every request, DNS-checked proxy, private-network block, no downloads |
| Agent team (S2) | `ma4/coordinator.ts`, `collaboration.ts` | `composeTeam` for Planner/Worker/Reviewer; the data-fence format for untrusted material |
| Secret patterns | `agent-checkpoint.server.ts` | Broker redaction |
| Notch task cell (S2-T1) | `install/Bunny-Island.Placement.ps1` | Activity in the tooltip |

## Found while auditing and building (S2-T1 era defects, fixed here)

1. **F-CI1-1 was worse than disclosed.** A refused second Host on the same data directory ran MA3 recovery before
   `listen()` and marked the live Host's running MA3 tasks `failed` (evidence: `evidence/startup-before-fix.log`).
   See HOST_STARTUP_CLEANUP.md.
2. **Background tasks were not on the routed dashboard.** S2-T1 mounted `PersistentTasks` only in the legacy,
   unrouted `desktop.tsx` shell. The routed Tasks surface now shows it.
3. **`ptask.output` never returned its content to the dashboard**: the dashboard command boundary passes `data` only
   for an allowlist. The Approval Center reads (and `ptask.output`) are now on it.
