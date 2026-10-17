# M-A-3 T14 — Independent review

**Reviewer.** A separate `security-auditor` agent with a fresh context. It wrote none of the T14 code. It worked
read-only: no edits, no commits, and probes only in the session scratchpad.

**Scope.** `a40f2aa..77b8446` in round 1, then `77b8446..2eacbb7` in round 2. The reviewer was asked to break each of
these:
- child-worker privilege escalation (every envelope field)
- revocation
- duplicate-write and N-C regressions
- unbounded loops
- fabricated success
- cross-Agent leakage
- phone escalation
- the theme restore script
- regressions in T13.3, VE2 and Widget Studio

The reviewer's round 1 report is kept verbatim in `test-results/ma3-t14/review/round1.md`.

## Round 1 (`77b8446`) — one HIGH open

| Id | Severity | Status | Finding | Disposition (commit `2eacbb7`) | Pinned by |
| --- | --- | --- | --- | --- | --- |
| F1 | HIGH | CONFIRMED | Budget was not conserved across workers. Finished workers' spend was never charged to the parent, so up to 12 sequential workers could spend 12× the approved calls, retries and tokens. | Remaining budget = the parent's own use, plus the actual spend of every ended derived worker, plus the full allowance of every live one (`MissionStore.derivedAuthorizations`). | `T14 review F1` |
| F2 | MEDIUM | CONFIRMED | A derived grant was recorded as a verified `user_decision`. | Now recorded as `mission_state` with `bunny:derived-authorization:` provenance. | `T14 review F1` (F2 assertions) |
| F3 | MEDIUM | CONFIRMED | `providers.sessions.maxSessions` was not subset-checked. | Checked. | `T14 review F3/F4/F7` |
| F4 | LOW | CONFIRMED | `terminal.enabled` was not checked. `writeIncludesShell` was checked only when sessions were planned. | Both are always checked. | `T14 review F3/F4/F7` |
| F5 | MEDIUM | PLAUSIBLE | Model-written step summaries were stored as a verified worker fact. | The verified fact holds Host-written text only. Summaries are stored as an unverified `agent_conclusion`. | T14-B (F5 assertions) |
| F6 | MEDIUM | PLAUSIBLE | Workers could be derived while the parent was waiting for reconciliation. | The parent must be `ready`, `running` or `verifying`, with no `reconciliation.required`. | `T14 review F6` |
| F7 | LOW | CONFIRMED | A negative remaining token budget was passed through. | Clamped to 0. | `T14 review F3/F4/F7` |
| F8 | LOW | PLAUSIBLE | A start failure could leave an orphan child. | The worker record is saved before any grant, and Host acceptance is checked before granting. An error leaves the child waiting for the owner. | code |
| F9 | LOW | CONFIRMED | A parent held by a worker awaiting the owner was labelled WAITING_DEPENDENCY. | Now WAITING_AUTHORIZATION ("N worker(s) wait for your approval"). | `T14 review F9` |
| F10 | INFO | — | `liveAuthorizations()` returns raw rows. | No escalation. The sibling budget no longer uses it. | — |
| F11 | INFO | — | The theme restore script hides the shell for up to 1.5 s. | Accepted. The cached payload has `theme` (`storedPreference`). | built-app walk |

The reviewer checked these and found they held:
- phone authority
- ownership
- T5 Agentic refusal
- revocation read-through
- no unbounded loop
- no fabricated COMPLETE
- Lotus scope
- `mayReconcile`
- path containment

## Round 2 (`2eacbb7`)

The reviewer's report is kept verbatim in `test-results/ma3-t14/review/round2.md`. Results:

- F1, F2, F3, F4, F5, F7 and F9 were CONFIRMED FIXED. The probes now show, for example, worker budgets granted `[2,0,0,0]` against a parent budget of 2.
- F6 was PARTIALLY FIXED: a worker derived earlier kept admitting new work while its parent waited for reconciliation.
- F8 was fixed, but the reviewer found a LOW edge: the worker record was saved in `ELIGIBILITY_CHECK`.
- Two INFO items were raised and both are accepted. Zero-budget workers are granted, then routed locally or failed as `budget_exceeded`. A replan resets the worker pool, which `maxReplans` 2 bounds.

These were fixed in commit `ff2e45e`:

- **F6 residual.** `missionPauseGate` now also holds a worker child while its parent has an outcome waiting for reconciliation. The worker is rescheduled once the owner decides.
- **A pre-existing gap the F6 test exposed.** A step waiting for another Mission's workspace lock was never woken when that lock was released. The new `workspaceWaits` set is woken whenever any step leaves a live state.
- **F8 edge.** The worker record is now saved as ADMITTED before any grant.

The test `T14 review F6` covers this. It was mutation-checked: with the gate removed, the worker completes during reconciliation and the test fails (`test-results/ma3-t14/review/mutation-f6-gate-removed.log`).

## Round 3 (`ea6950c`)

The reviewer's report is kept verbatim in `test-results/ma3-t14/review/round3.md`.

- **F8 edge:** FIXED.
- **Workspace wake:** no storm and no lost wake. `tickOnce` ignores any Mission that is not running.
- **New UI caption:** display-only.
- **F6:** FIXED for new admissions. One MEDIUM (PLAUSIBLE) remains: a worker step that was **already running** when its parent entered reconciliation runs to its end.

**Disposition of the remaining MEDIUM: accepted by design, not repaired.** It is the same rule the parent follows for its
own steps. When one step becomes uncertain, steps already in flight finish and nothing new is admitted (T13.3). Stopping a running step part-way through would create a new uncertain outcome of its own, which N-C exists to avoid. The worker's result then follows the normal rules:

- it can never become a verified fact unless the Host verified it;
- the parent cannot complete while it is reconciling.

**Final verdict of the independent review:** no BLOCKER and no HIGH open. One MEDIUM was accepted with the rationale
above. One LOW was noted: a workspace lock released without a live-to-non-live step transition is not woken, which is the same
pattern as `admissionHolds`.
