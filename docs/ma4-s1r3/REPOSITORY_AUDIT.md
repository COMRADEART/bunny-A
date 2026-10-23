# MA4-S1R3 repository audit — R3-G1

Audited 2026-10-21 before any S1R3 file change. All facts below were read from git/GitHub at that time.

## Repository and remotes

* GitHub repository: `COMRADEART/bunny-A` (`gh repo view`). The local `origin` URL still names `COMRADEART/router_agent`; GitHub redirects it to `bunny-A`.
* Main checkout `C:\Users\allam\Documents\new\bun-router` on `ma4-s1-model-intelligence` at `f5d3f90`, with 32 modified tracked MA3 evidence files under `test-results/ma3/` plus untracked owner files. **Not modified by S1R3** (no checkout, reset, stash, add or commit there).

## Worktrees

| Path | Branch | HEAD |
|---|---|---|
| `bun-router` (main checkout) | `ma4-s1-model-intelligence` | `f5d3f90` (origin has since advanced to `1d7de06`, the PR #9 merge) |
| `bun-router-s1r` | `ma4-s1r-live-qualification` | `673cfa6` |
| `bun-router-s1r2` | `ma4-s1r2-hybrid-qualification` | `472fd61` |
| `bun-router-deps` | `ma4-s1r2-deps-audit` | `5d92fea` |
| `bun-router-t14` | `ma3-t14-autonomy` | `b25150f` |
| `%TEMP%\claude\f04-baseline-wt` | detached | `b693167` |
| **`bun-router-s1r3` (new)** | **`ma4-s1r3-agent-reliability`** | branched from **`5d92fea`** |

The S1R3 worktree has its own `npm ci` `node_modules`, its own native builds and its own evidence output. Nothing writable is shared with another worktree. The only file copied in is the ignored, locally staged Node runtime `LICENSE` (SHA-256 `148eacf7…a5ca5`), which the release-packaging test needs and which is never committed.

## Pull requests at audit time

| PR | Head → base | State | CI |
|---|---|---|---|
| #9 | `ma4-s1r-live-qualification` (`673cfa6`) → `ma4-s1-model-intelligence` | **MERGED** (`1d7de06`) | — |
| #10 | `ma4-s1r2-hybrid-qualification` (`472fd61`) → `ma4-s1r-live-qualification` | open, MERGEABLE, UNSTABLE | checks SUCCESS; regression FAILURE (the 7 Windows tests); security FAILURE (pre-fix advisories) |
| #11 | `ma4-s1r2-deps-audit` (`5d92fea`) → `ma4-s1r2-hybrid-qualification` | open, MERGEABLE | checks SUCCESS; **security SUCCESS**; regression in progress (same 7 tests expected) |

## Dependency-fix commit

`5d92fea` "fix(deps): resolve npm audit advisories via lockfile-only updates" changes exactly one file, `package-lock.json` (224+/225−). See [DEPENDENCY_SECURITY](DEPENDENCY_SECURITY.md).

## Stack and main-branch integration

* `git merge-base --is-ancestor`: S1R (`673cfa6`) and S1R2 (`472fd61`) are ancestors of the S1R3 base. The base is 34 commits ahead of `origin/main`.
* `git merge-tree --write-tree origin/ma4-s1-model-intelligence HEAD`: **clean**.
* `git merge-tree --write-tree origin/main HEAD`: **one conflict, `package.json`** (the `test` script list). `http.server.ts`, `bunny-missions/authorization.server.ts` and `manager.server.ts` auto-merge. This matches the S1R2 finding. S1R3 also adds `ma4-repair.test.ts` to `test:ma4`, which does not touch the conflicting `test` line.
* Proposed integration (not executed): merge #10 → `ma4-s1r-live-qualification` is moot, because that branch is already merged into `ma4-s1-model-intelligence`. Instead, **retarget #10 to `ma4-s1-model-intelligence`**, then merge #10, #11 and S1R3 in order. Then open one `ma4-s1-model-intelligence → main` PR that resolves `package.json` as the union (main's `t14-autonomy-host.test.ts` inserted into the MA4 `test` command), and run the full `npm test` on the merge result before merging, since T14 and MA4 have never been tested together. No force-push, no automatic merge.

## Inspected inputs

S1, S1R and S1R2 reports (`docs/ma4-s1*/`), the frozen G7 task set (`scripts/ma4-s1r2/g7-tasks.mjs`, git blob SHA-256 `949d0193…3210`, unchanged), S1R2 G7 evidence (`docs/ma4-s1r2/evidence/g7.json`, all 23 trials, per-attempt), the WSL2 sandbox (`sandbox.server.ts`, `sandbox-launcher.py`), the coding workflow, the routing, tool and cloud modules, the CI workflow and the hosted CI logs of run 39663570776.
