# MA4-S1R2 architecture and repository audit

Audit date: 2026-10-21. Repository: https://github.com/COMRADEART/bunny-A (the `origin` URL `COMRADEART/router_agent` redirects there).

## Repository state — R2-G1

| Fact | Verified value |
|---|---|
| Expected starting commit | `673cfa6` = `673cfa60886a292d0bf6ed282c87537d90ea3eac` (local branch and `origin/ma4-s1r-live-qualification` agree) |
| S1R base | `f5d3f90` (`ma4-s1-model-intelligence`) |
| PR #9 | OPEN, `ma4-s1r-live-qualification` → `ma4-s1-model-intelligence`, MERGEABLE |
| `main` | `bc0fbf0` (merge of PR #8, MA3 T14). `f5d3f90` is **not** an ancestor of `main`; MA4-S1 has never been PR'd to `main`. |
| Implementation branch | `ma4-s1r2-hybrid-qualification`, created from `673cfa6` in a new worktree `../bun-router-s1r2` |
| Main checkout | `C:\Users\allam\Documents\new\bun-router` on `ma4-s1-model-intelligence` with 32 modified MA3 evidence files and untracked user material. **Untouched** by this phase (not staged, restored, moved or deleted). Its `node_modules` is reused through a directory junction, exactly as the S1R worktree did. |
| Other worktrees | `bun-router-s1r` (S1R, clean), `bun-router-t14`, a detached temp worktree — untouched |
| CI | none before this phase (`.github/` absent) |

No discrepancy with the brief was found. The stacked relationship is kept: the S1R2 PR targets `ma4-s1r-live-qualification` (PR #9's head).

## Historical evidence inspected (not altered)

`docs/ma4-s1r/` reports and `evidence/` were read. Historical results confirmed from evidence files, not just prose:

* `evidence/python-workflow.json` (G7 v2): gate `>=2 of 3 trials pass hidden and generated tests`, `g7: FAIL`, `passed: 0`, 11 generation requests. Per-trial checks match the S1R report (see [G7_ROOT_CAUSE.md](G7_ROOT_CAUSE.md)).
* `evidence/benchmarks.json` / `qualified-benchmarks.json`: 36 scored generations; paired auto 4/9 vs fixed 6/9 (S1R report). S1R2 does not reuse these samples; it runs a new frozen suite.
* `evidence/recheck.json`: 2,168 passed / 0 failed / 1 skipped at `673cfa6`.

S1R2 writes only under `docs/ma4-s1r2/`. The S1R G7 v2 script writes to `docs/ma4-s1r/evidence/` and was therefore **not** re-executed; its unchanged task specification and hidden tests were copied verbatim into `scripts/ma4-s1r2/g7-tasks.mjs` and run through the new workflow.

## Components inspected and how S1R2 extends them

| Area | Existing component | S1R2 change (additive) |
|---|---|---|
| Routing engine | `bunny-host/routing.server.ts` filter-then-score, `ROUTING_POLICY` weights, hard pins in `hardExclusions` | new `reliability` score component (measured task-category correctness, Wilson lower bound); pins stay hard filters |
| Task analysis | `orch/router-requirements.ts`, `ma4/analyzer.ts` | unchanged (finding: categories are coarse — see benchmarks) |
| Host pipeline | `TaskManager.routingPipeline` | applies routing modes; feeds reliability; external MA4 API models additionally need a scoped approval |
| Constraints | `orch/types.ts` `TaskConstraints`, HTTP `validateConstraints` | `routingMode`, `dataCategory` (validated enums) |
| Provider adapters | `OllamaAdapter` (text-only), `ma4/adapter.server.ts` OpenRouter, `ma4/transport.server.ts` | SSE streaming with interruption detection; OpenAI tool-call shim; disabled cloud candidates |
| Tool execution | none for Ollama (`ADAPTER_TOOL_CONTRACTS.ollama = false`) | `ma4/ollama-tools.server.ts` native `/api/chat` tool loop through the existing permission broker `decide()` |
| Permission broker | `bunny-missions/authorization.server.ts` `decide()` | reused, not modified |
| Scheduler | MA3 `MissionManager` (dependency graph, scoped delegation) | unchanged; the G7 workflow is a bounded host-side orchestrator over the same `execute()` Ollama path |
| Quotas | `ma4/store.server.ts` reservations, cooldowns | approvals + reliability tables; spend-since-approval query |
| Cancellation | `AbortSignal` through adapters, `stopTask` | reused in the tool loop, workflow and sandbox |
| Code execution | S1R harness: AST import gate + Windows job (not a security boundary) | `ma4/sandbox.server.ts` + `sandbox-launcher.py`: OS-enforced WSL2 namespace sandbox |

## MA3 integration contracts preserved

Exact model pins (`modelExact`, `applySelection` per-agent pins) remain eligibility filters with audit reasons; MA3 recovery bounds (`RECOVERY_BOUNDS`) still own retries/fallback; `ownerDirective` still only reads a leading owner directive. No MA3 acceptance document, visual design, installed release, startup contract or production Host was changed or restarted.
