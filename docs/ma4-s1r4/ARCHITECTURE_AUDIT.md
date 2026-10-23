# MA4-S1R4 — Repository and architecture audit (R4-G1)

Audited 2026-10-22, before any S1R4 code change.

## Repository and PR stack

| PR | Branch | Head | State | Base |
|---|---|---|---|---|
| #9 | `ma4-s1r-live-qualification` | `673cfa6` | MERGED (`1d7de06`) | `ma4-s1-model-intelligence` |
| #10 | `ma4-s1r2-hybrid-qualification` | `472fd61` | CLOSED (content carried by #11 → #12) | `ma4-s1r-live-qualification` |
| #11 | `ma4-s1r2-deps-audit` | `67bb1f6` | CLOSED (carried by #12) | `ma4-s1r2-hybrid-qualification` |
| #12 | `ma4-s1r3-agent-reliability` | `101261a` | MERGED into `ma4-s1r2-deps-audit` (`67bb1f6`) | `ma4-s1r2-deps-audit` |
| #13 | `ma4-s1r3-ci2` | `19bbdec` | MERGED (`e93f5ae`) into `ma4-s1r3-agent-reliability` | `ma4-s1r3-agent-reliability` |

* The GitHub repository is `COMRADEART/bunny-A`; the local remote URL still names its former slug `router_agent` (GitHub redirects).
* **PR #13 is merged**, so S1R4 cannot be stacked on an open #13. The verified latest head is `e93f5ae` (merge of #13 on
  `ma4-s1r3-agent-reliability`); its tree is **identical** to the #13 head `19bbdec` (`4689482a…`).
* Hosted CI at the #13 head: run **39724249720** (`pull_request`, `19bbdec`) **success**; run 39724221788 (`push`) success.
  A push run for the merge commit `e93f5ae` (39802416971) was in progress at audit time.
* `main` is still at `bc0fbf0` (MA3 T14). The MA4 stack is not on `main`; S1R4 does not merge anything.

## Worktree

New worktree `../bun-router-s1r4`, branch `ma4-s1r4-intelligence-leap` from `e93f5ae`, with its **own** `node_modules`
(`npm ci`, lockfile unchanged) and native builds (`npm run pretest`). The main checkout (`ma4-s1-model-intelligence`,
with the user's uncommitted `test-results/` changes and untracked files) and the other worktrees (`bun-router-ci2`,
`-deps`, `-s1r`, `-s1r2`, `-s1r3`, `-t14`, `bun-sec-main`) were not modified. S1R4 evidence is written only under
`docs/ma4-s1r4/evidence/`; historical S1R2/S1R3 evidence is untouched.

## Interfaces S1R4 builds on

| Concern | Module | Notes |
|---|---|---|
| Task analysis | `ma4/analyzer.ts` `analyzeModelTask()` | category, complexity, sensitivity; never decomposes or grants tools |
| Agent workflow | `ma4/coding-workflow.server.ts` `runCodingWorkflow()` | Planner → Worker ∥ Tester → static → sandboxed tests → attribution → repair (≤ 2) → Reviewer → deterministic gate. Callers: G7 runner and tests only; not wired into the Host runtime |
| Fault attribution | same, `attributeAttempt()` | oracle = Tester tests run against the frozen reference (benchmark harness only) |
| Sandbox | `ma4/sandbox.server.ts` + `sandbox-launcher.py` | WSL2 user/mount/pid/net namespaces, pivot_root, cgroup, rlimits, seccomp deny-list; fails closed |
| Model execution | `orch/exec.server.ts` `execute()` | Ollama `/api/generate`, served-model receipt; S1R4 adds an optional `temperature` |
| Routing | `bunny-host/routing.server.ts` + `ma4/hybrid.ts` | hard eligibility filters, then soft score incl. Wilson-bounded category reliability |
| Permission broker | `bunny-missions/authorization.server.ts` `decide()` | used by the Ollama tool loop; S1R4 routes the workflow's deterministic tools through it |
| Native tool loop | `ma4/ollama-tools.server.ts` | model-proposed calls, schema + broker validated |
| Reliability store | `ma4/store.server.ts` `ma4_reliability` | bounded counts per provider/model/category, no prompts or code |
| Lotus memory | `bunny-host/lotus*.ts` | implemented (Personal Agent / Project scopes, trust layers) — see ENGINEERING_REPORT, Phase G |
| G7 | `scripts/ma4-s1r2/g7.mjs`, `g7-tasks.mjs` | frozen task set, blob SHA-256 `949d0193…3210` (unchanged in S1R4) |

## Existing G7 failure behaviour (measured from S1R3 run-2 evidence, not re-generated)

`docs/ma4-s1r3/evidence/g7-run2-qwen2.5-coder-7b.json`, read per attempt:

| Failure class | Trials affected | Where it comes from |
|---|---|---|
| Code inside a JSON string: `unterminated string literal` (a `\n` escape decoded into a real newline) | v2 t3 (att 0), i1-roman t2 (tests), **i2-kv t2 (all 3 attempts)** | transport, not reasoning |
| Tester reply not JSON (long test file inside JSON, output budget) | **v2 t1, v2 t2 (all attempts)** → `malformed_artifact` | transport |
| Worker semantic defect, repairs unproductive | s1-anagram t2, v2 t3, d1-flatten t2, i2-kv t1, i1-roman t2 | 7B capability; repair feedback often "acceptance failed (details withheld)" |
| Worker misreads the contract (demo code, wrong signature, forbidden import) | p2-bucket t1, t2 | 7B capability |

At least **5 of 10 failing trials** (both v2 malformed trials, i2-kv t2, and attempt-level losses in v2 t3/i1-roman t2)
lost budget to the JSON transport of code rather than to model reasoning. This drove the S1R4 design.
