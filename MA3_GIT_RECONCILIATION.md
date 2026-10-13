# MA3_GIT_RECONCILIATION — M-A-3 T0 §27: Safe Synchronization Plan

**Produced:** 2026-10-07 · by the T0 inspection session · **NOT EXECUTED — no push, no merge, no reset has been performed.** Every step below requires separate explicit authorization.

## 1. Established facts (LIVE VERIFIED this session)

| Fact | Value |
|---|---|
| Repo | `C:\Users\allam\Documents\new\bun-router` — branch `ma2-operational-hardening`, HEAD `e0735d489d43c74955cf0370777c34b2339358a4` |
| Remote | `origin = https://github.com/COMRADEART/router_agent.git` |
| `origin/main` | `15881638935d58a3e7b3abee81bbef5bebc26319` — publicly contains merged PR #2 from ma0 (`b04f4795…`) |
| Local `main` | `ea0e803b8186ac777ba67f4c47db58ccd6b4407d` — 11 behind origin/main, 0 ahead; **origin/main is a proven descendant** (merge-base of local main and origin/main is local main itself → strict fast-forward) |
| Local `ma1-live-acceptance` | `2a8a9eac98acddb6b1b660ba7e59d923c849e358` — **not on remote**; verified **ancestor of HEAD** (its 15 unique commits are all inside the 103-commit unpushed range) |
| Unpushed | `origin/main..HEAD` = **103 commits** (all of MA1 + MA2 acceptance history and both production release pins `8001d51d…` (v26 runtime source) and `0d3f96db…` (v26 packaged tooling)) |
| Tracked tree | clean; 5 untracked paths (4 independent/user-authored review reports + `memory/`) — all deliberately left uncommitted |

## 2. What the two histories are

- **Remote (`origin/main`) today holds:** the M3-era baseline, PR #1 / PR #2 (the MA0 mission-architecture branch merged during this session), and nothing of MA1/MA2 acceptance work. The public repo reflects a pre-MA1 world.
- **Local production lineage (`ma2-operational-hardening`) holds:** MA0 freeze → MA1 live-acceptance (incl. the v15→v16 pinned-deployment hardening) → MA2 T1–T10 staged acceptance → R1 fail → R1.1 completed production activation/acceptance (v26-MA2-R1). This is the only complete, evidence-pinned line and is the **canonical history**.

## 3. Proposed safe sync plan (in order; each step independent, stop-on-error)

1. **Reposition local `main` to the remote tip** — `git checkout main && git merge --ff-only origin/main` (clean fast-forward `ea0e803` → `1588163`; zero divergence, no conflicts possible, no history rewritten). Then return to `ma2-operational-hardening`.
2. **Publish the production lineage as a normal branch** — `git push -u origin ma2-operational-hardening`. No force, no history change: this only *adds* the branch (103 commits) to the remote. It makes the MA2 acceptance history and both v26 pins publicly inspectable.
3. **Open a PR** `ma2-operational-hardening` → `main` on GitHub (base = fast-forwarded `origin/main`; GitHub will see it as additive). Merging then moves `origin/main` forward through the normal PR review path rather than by direct push.
4. **(Optional, provenance only)** push `ma1-live-acceptance` too — it is fully contained in step 2's history, so this adds only a named marker for the milestone boundary. No merge needed.
5. **Leave untracked material untracked.** The four independent/user-authored review reports (`MA1_CLAUDE_FINAL_REVIEW.md`, `MA1D_FINAL_INDEPENDENT_REVIEW.md`, `MA2_FINAL_INDEPENDENT_REVIEW.md`, `BUNNY_OPENDOTS_ADOPTION_REPORT.md`) and `memory/` are **deliberately excluded** from any commit; in particular the immutable MA2 FAIL review must stay byte-identical (`2ac061dd…`). Pushing a branch does not include them (they are untracked), so no `.gitignore` change is required or wanted for the reports; adding `.gitignore` entries is a separate editorial decision.
6. **M-A-3 work continues on `ma2-operational-hardening`** (or a successor branch created from it after the PR merges) — never on `main` directly, per the MA1 rule.

**Explicitly forbidden in this plan** (MA2/T0 rules): force-push, history rewrite, `git reset`/`clean`/`checkout` to "tidy" the tree, deleting or rewriting untracked material, and pushing without explicit authorization.

## 4. Status

Proposed only. Steps 1–2 are the minimal fix producing one public, complete system history; they were chosen because they are additive-only and conflict-free by construction. **Nothing has been executed.** No push of any kind occurred during T0.