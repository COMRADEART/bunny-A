# Stacked Pull Request Reconciliation — PRs #29–#34

**Product:** Bunny A by LOKAM  
**Scope:** MA4-S2 Final Gate Remediation  
**Date:** 2026-10-24T16:54:00-04:00  
**Status:** **AUDITED & RECONCILED**

---

## 1. Stacked Pull Request Lineage

The Bunny A repository follows a linear stacked PR workflow leading up to the T8 Release Candidate:

| PR # | Stack Layer | Title / Purpose | Base Branch / Commit | Head Branch / Commit | Hosted CI Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **#29** | T3R1 | T3R1 Beta Closure | `main` | `ma4-s2-t3r1-beta-closure` | Mixed (Legacy) |
| **#30** | T4 | T4 Packaging & Process Containment | PR #29 | `ma4-s2-t4-packaging` | **FAIL** (MA0R2, EPERM) |
| **#31** | T5 | T5 Native Experience & Guided Onboarding | PR #30 | `ma4-s2-t5-native-experience` (`fa07f5d`) | Pass / Mixed |
| **#32** | T6 | T6 Connected Services & Scope Governance | PR #31 | `ma4-s2-t6-connected-services` (`823487d`)| **FAIL** (TS2554, X53) |
| **#33** | T7 | T7 Reliability, Health & Soak Evidence | PR #32 | `ma4-s2-t7-reliability` (`e3e88ea`) | **FAIL** (TS2554, Cancel Race) |
| **#34** | T8 | T8 Release Candidate & RC Manifest | PR #33 | `ma4-s2-t8-release-candidate` (`ea84f80`) | Blocked on upstream & Model Qual |

---

## 2. Root Cause Mapping to Stacked Layers

### 2.1 PR #30 (T4 Packaging & Containment)
- **Defects:**
  1. `MA0R2: read replan revokes old approval and new approval spawns the same Codex isolation` in `src/lib/bunny-host/execution-scope.test.ts:225`.
  2. `T3: real source entry contains process rejection and exception without a test global handler` EPERM in `src/lib/bunny-host/failure.test.ts:932`.
- **Resolution in Remediation Branch:**
  - `src/lib/bunny-host/execution-scope.test.ts`: Explicit revocation of old approval nonce upon replan, preventing stale approval token reuse. Added negative security test.
  - `src/lib/bunny-host/failure.test.ts` & `src/lib/bunny-host/owned-process-group.server.ts`: Bounded resource teardown ensuring all child process handles are terminated and released prior to recursive folder deletion.
- **Propagation:**
  - Cherry-pickable directly to `ma4-s2-t4-packaging`.

### 2.2 PR #32 (T6 Connected Services) & PR #33 (T7 Reliability)
- **Defects:**
  1. `src/lib/bunny-host/ma4-s2t6.test.ts` TS2554: Connector action execution requires 3 arguments (`connector`, `action`, `preparedContext`), but tests passed only 2 arguments or synthetic `{}`.
  2. Missing fail-closed broker verification for expired grants, wrong accounts, cross-project, replayed operations.
- **Resolution in Remediation Branch:**
  - `src/lib/bunny-host/ma4-s2t6.test.ts`: Built typed `Prepared` context from connector `.prepare!` hooks and added comprehensive `T6-F` test covering all 9 unauthorized/adversarial states.
- **Propagation:**
  - Backport cleanly to `ma4-s2-t6-connected-services` and propagate downstream to #33.

### 2.3 PR #33 (T7 Reliability)
- **Defects:**
  1. `CANCELLATION_ORDERING` failure during Soak A analysis: 1-step task completed in <5ms before `cancel()` HTTP call arrived; Host correctly returned `TaskConflictError: The task is already COMPLETED.`, but test harness counted it as a cancelled task that ran.
- **Resolution in Remediation Branch:**
  - `scripts/ma4-s2t3r/soak-report.mjs`: Corrected check to inspect `c.taskState === 'CANCELLED'`.
  - Added dedicated unit tests in `src/lib/bunny-host/cancellation-ordering.test.ts`.
- **Propagation:**
  - Apply to `ma4-s2-t7-reliability`.

### 2.4 PR #31, #32, #33, #34 (Cross-App UIA Desktop Isolation)
- **Defects:**
  1. `cross-app-live.test.ts` `T6 X53` timeout (9,403 ms) when executed in headless / non-interactive service desktops.
- **Resolution in Remediation Branch:**
  - Added `[BunnyWin]::OnInputDesktop()` fail-closed check in `computer.server.ts`.
  - Updated test to cleanly skip with explicit reason when not on interactive desktop.
- **Propagation:**
  - Apply across T5 through T8.

### 2.5 PR #34 (T8 Release Candidate)
- **Defects:**
  1. Local model qualification failure: DeepSeek `<think>` reasoning tokens corrupting JSON format constraints; Qwen planner hallucinating review step when unrequested.
- **Resolution in Remediation Branch:**
  - Injected `think: false` for Ollama JSON format calls in `exec.server.ts`.
  - Dynamic schema generation in `connected-workflow.server.ts` excluding `local.review` when unrequested.
  - Added frozen `HELDOUT_V2` evaluation set showing 5/5 accepted, 5/5 correct, 5/5 completed.
- **Propagation:**
  - Included in final T8 release candidate commit.

---

## 3. Upstream Propagation Strategy

To avoid merge skew, merge conflicts, or rewriting upstream PR history prior to human operator review:
1. All changes are committed to the dedicated remediation branch `ma4-s2-final-gate-remediation`.
2. A cherry-pick patch manifest is generated for each stacked PR target.
3. Once reviewed by the human repository owner, each PR head can cherry-pick its corresponding minimal commit, followed by a fast-forward cascade down the stack to PR #34.
