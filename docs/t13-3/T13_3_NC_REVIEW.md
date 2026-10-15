# T13.3 N-C independent review: the write-retry boundary

**Reviewer.** A separate `code-reviewer` agent with no share in writing the patch. It worked read-only from
`git show` / `git diff` and ran no tests. It was told to examine the retry boundary in the source, not the updated
test expectations. This is an independent agent review, not an external release audit.

## Round 1: review of `b682f6f`

**Verdict:** "**Yes.** An uncertain write can replay automatically." The paths it named were F1 and F3 (Mission
capability exit/timeout), F2 (internal exception after the process ran) and F4 (verification carve-outs). It also
found bypasses of the reconcile gate (F5, F7) and an unreachable pre-dispatch retry (F10). Every finding was repaired
in `3a40957`, except where the table says documented.

| # | Severity | Finding (reviewer's words, shortened) | Resolution | Pinned by |
|---|---|---|---|---|
| F1 | BLOCKER | A Mission capability write is replayed after a non-zero exit. The bus marked `uncertain` only on a throw or timeout, so `terminal.exec` that wrote then exited 1 was retried. | The bus marks **every** run that started and failed as `uncertain`, unless the adapter certifies `noEffect` (a refusal before any effect) or the status is `denied` / `unavailable` / `unconfigured` / `unsupported`. Adapters cannot set `uncertain`. `filesystem.write` and `delete` refusals now carry `noEffect`. | `scheduler` "review F1/F3"; NC-M20, NC-M21 |
| F2 | HIGH | A Mission child write is replayed after an internal exception. `failOperation` set `failed` with no reconciliation, and the Mission retried and rerouted. | A central rule in `TaskManager.update()`: write work leaving a launched state as `stopped` / `failed` by any path other than the attempt loop gets `dispatch: may_have_started` and a reconciliation. The Mission reads `task.reconciliation`. | `t3-manager` "review F2/F9"; NC-M22 |
| F3 | HIGH | A `terminal.exec` process-level timeout is not marked uncertain. | Covered by the F1 rule: a `timeout` status from the adapter is a started failure without `noEffect`. | as F1 |
| F4 | HIGH | Verification carve-outs replay completed writes (direct escalate-effort, Mission verification repair, team rework). | Carve-outs removed. Direct: a failed check of write work gives `VERIFY_PAUSE`. Mission: `stepFailed(..., VERIFY_PAUSE)` when `writeCapable(step)`. Team: rework is not activated for an uncertain step. Read work keeps the T3 §24 escalation (R24 now declares read). | `t3-manager` "review F4", R24; `missions.test` repair; NC-M19, NC-M26 |
| F5 | HIGH | Restart sweep: a running write step holding a one-time approval is not marked for reconciliation. | That branch sets a reconciliation when the step was `running` / `verifying` and is `writeCapable`. A read or a Host-guarded write is not marked. | `remote-authority` "review F5"; NC-M27 |
| F6 | HIGH | Restart reconcile re-admits a write step after `resubmit`. Limited to reads today. | `resubmit` and the team requeue refuse a step whose reconciliation is required. | "review F5" (resubmit refusal); NC-M28 |
| F7 | HIGH | A direct-task reconcile retry bypasses the restart-survivor refusal. | `reconcile(..., "retry")` is refused while any process of the original (`${id}#…`, or a restart survivor owned by this task) may be alive. | `t3-manager` "review F7"; NC-M24 |
| F8 | MEDIUM | `dispatched:false` can be set for a started process (the post-handle code was outside the `launched` try). | `hostCodeRuns.set` and `trackOwnedGroup` moved inside the post-launch block that records `launched: true`. | `owned-process-group.test` 20/20 (no targeted test; native crash not reproduced, see limitations) |
| F9 | MEDIUM | Stopped write tasks record no "may have started" state. | The attempt loop records `STOP_WRITE_PAUSE`, and the central `update()` rule covers stops outside the loop. Every task records `dispatch`. | "review F2/F9", "N-C 10/11"; NC-M23 |
| F10 | MEDIUM | The one pre-dispatch retry is unreachable (the planner returns `fail` for the refusal text). | For write work the certified pre-dispatch case overrides the planner: one `retry-same`, then `fail`. | "N-C 6" (TaskManager and adapter, including the unwrapped spawn path); NC-M4, NC-M8, NC-M9, NC-M31 |
| F11 | LOW | Ollama pre-request failures are marked uncertain; a `beforeDispatch` throw bypasses certification. | A tool-free provider (`ADAPTER_TOOL_CONTRACTS[p] === false`) is never write work, in the loop, the central rule and the restart sweep. Its `beforeDispatch` throw goes to `failOperation`, which is then not uncertain. | "review F11"; NC-M25 |
| F12 | LOW | A refused reconcile leaves a "chose retry" event. | The event is emitted only after the authorised Retry is accepted. A refusal restores the step and emits nothing. | "review F12/replan"; NC-M30 |
| F13 | LOW | Stale `reconciliation.required: true` on steps that proceed. | Every path that settles a step from canonical truth clears it (`settled()`): the consume path, the cross-app consume path, the team verified-on-disk path and the guarded team requeue. Paths that would merely re-admit refuse instead (F6). | "review F5"; code reading |
| F14 | LOW | Dedup reports success when the pre-image guard is violated. | **Documented** (L-DEDUP-ATTRIBUTION). The wording now says "from an earlier attempt or another writer". The bytes are exactly the intended ones. | N-C 7 |
| F15 | INFO | The T3 §5 MANUAL test now declares read, so it no longer proves unscoped MANUAL is refused. | A new test proves exactly that. | "review F15" |
| (row) | PARTIAL | Replan drops non-completed steps. | `mission.replan` is refused while any step's reconciliation is required. | "review F12/replan"; NC-M29 |
| (row) | PARTIAL | Escalate-effort cross-provider path not checked for consent. | Every relaunch runs `beforeDispatch`, which re-evaluates `connections.evaluate` (switch allowlist, route, billing). Write work no longer escalates or reroutes at all. | N-C 1/2 (reroute only with the allowlist set); code reading |

**Found while repairing (not in the review).** Requiring `npm test` exit 1 to pause changed what a failing worker
reports. `verdict()` now counts a step whose own work failed as REJECTED after a reconciliation stop. An interruption
stays INDETERMINATE.

## Round 2: confirmation pass on `3a40957`

**Verdict:** "**NOT CONFIRMED**: skill multi-run path (N1), team rework path (N2)."

| Round-1 item | Round-2 status |
|---|---|
| F1, F2, F3, F5, F6, F8, F9, F11, F12 | RESOLVED |
| F14 | RESOLVED (documented) |
| F4 | PARTIAL: team rework (N2) |
| F7 | PARTIAL: unreadable records |
| F10 | PARTIAL: N5 |
| F13 | PARTIAL: N3 |

New findings, all repaired in `b4ada18` unless the table says documented:

| # | Severity | Finding | Resolution | Pinned by |
|---|---|---|---|---|
| N1 | HIGH | A failed skill was judged by its last run only. A write that succeeded before a later failing step, or before failed validations, was repeated by the step's retry. | `uncertainSkillRuns()` checks every run of the failed skill. An uncertain run, or a succeeded non-READ write without Host-enforced dedup, makes the step wait for the owner. | `scheduler` "round 2 N1" (both shapes); NC-M32, NC-M33 |
| N2 | HIGH | Team rework replicates a write whose result failed the check (the check was read on the read-only verifier step). | **Resolved by the guard; the basis is corrected in round 3.** The reviewer rejected my first basis ("verified idempotent") and accepted the safety conclusion: the replica write is safe because the pre-image guard refuses it (FILE_CONFLICT) unless the file holds this Mission's own last verified bytes. In the primary rework case the replica is therefore held, not written (P4, functional). Original analysis: Every team `write_file` runs through `teamWrite` (`manager.server.ts`, capability path). It always carries `expectBeforeSha256`, returns `already` for identical bytes, and returns FILE_CONFLICT unless the file holds this Mission's own last verified bytes. ~~That is the policy's "verified idempotent with enforced duplicate protection" row.~~ (rejected in round 3). The rework chain is the dormant replica set from the owner-reviewed plan. It writes new reviewed content, so it is not a replay of the same operation. `writeCapable` now returns false for team writes, so every check agrees with the guard. | NC-M36; existing T11 team tests (FILE_CONFLICT, verified-on-disk) |
| N3 | MEDIUM | The Host auto-cleared an owner's reconciliation on the team write requeue. | `settled()` is removed from both team paths. The team restart branch refuses any step whose reconciliation is required. With N2's `writeCapable`, a guarded team write never receives an owner flag. | code; NC-M36 |
| N4 | LOW | A launch that threw before any process was marked "may have started". | The synchronous launch-failure path records `dispatch: "not_started"`. | "round 2 N4"; NC-M34 |
| N5 | LOW | The pre-dispatch override could exceed the T3 attempt bound by one. | It also stops at `RECOVERY_BOUNDS.maxAttempts`. | code (no targeted test) |
| N6 | LOW | Mission `writeCapable` ignored tool-free providers. | A model step whose task ran on a tool-free provider is not write-capable, the same rule as direct tasks. | "round 2 N6"; NC-M35 |
| N7 | INFO | A write-scoped task that first ran on Ollama may reroute to a tool-capable provider. | **Documented.** That attempt could not have written, so this is not a replay. The reroute passes `connections.evaluate` consent at dispatch. | N-C 1/2 |
| N8 | LOW | `verified_terminal` was set whenever a verification object existed. | It is set only for a completed attempt. | "review F4"; NC-M37 |
| N9 | INFO | The bus trusts an adapter's `noEffect`. | **Documented.** The only `noEffect` sites are pre-effect refusals in `local.server.ts`, which the reviewer verified. | "review F1/F3"; NC-M21 |
| N10 | LOW | A missing executable inside `terminal.exec` is marked uncertain. | **Documented** as the safe direction: over-pausing, never replay. | none |
| F7 gap | (round 2) | An unreadable provider-session record names no task, so it did not hold a reconcile retry. | It now holds the retry (fail closed). | "review F7"; NC-M38 |

## Round 3: confirmation pass on `b4ada18`

**Verdict:** "**NOT CONFIRMED**: skill permission-ask re-run after approval (P1), and skill cleanup writes outside
`runs` (P2)."

| Item | Round-3 status |
|---|---|
| N3, N4, N5, N6, N8 | RESOLVED |
| N7, N9, N10 | accepted as documented |
| N1 | PARTIAL (P1, P2) |
| N2 | safe through the FILE_CONFLICT guard; basis corrected |
| F7 | RESOLVED for the reconcile path; PARTIAL at launch time |

Findings and resolutions, all in `e6240c2`:

| # | Severity | Finding | Resolution | Pinned by |
|---|---|---|---|---|
| P1 | MEDIUM | An approved permission ask re-ran a skill from step one, repeating a write that had already landed, and the approver was not told. | `CapabilityBus.preflight()` runs the same decision (and executable resolution) as `request()`, with no side effect. Before any step runs, the skill checks every step's permission, so the ask comes before the first write and the re-run lands each write once. An ask that still arrives after a landed write (authority changed mid-run) pauses for reconciliation instead of asking. | `scheduler` "round 3 P1/P2"; NC-M39 |
| P2 | MEDIUM | A failing skill's cleanup runs were not counted, so a retry repeated cleanup writes. | Cleanup runs are returned and counted by `uncertainSkillRuns`. | "round 3 P1/P2"; NC-M40 |
| F7 (Mission) | (note) | Launch-time `restartSurvivorRefusal` does not match unreadable records. | The Mission reconcile retry now waits while an unreadable record is held, as the direct-task one does (NC-M41). The launch-time per-owner design is T9R-F04's and is unchanged; documented. | "review F12/replan"; NC-M41 |
| P3 | note | After a restart, a guarded team write is retried by `teamWrite` without a visible reconcile prompt. | **Documented.** `teamWrite` decides each time: `already` verifies without writing, FILE_CONFLICT refuses, and anything else writes under the guard. | — |
| P4 | functional | Team rework is refused by FILE_CONFLICT in the primary failed-verification case. | **Documented.** `teamWrite` is unchanged by N-C. This is a T11 functional limit, not a replay. | — |

## Round 4: confirmation pass on `e6240c2`

**Verdict:** "**NOT CONFIRMED**: the Mission reconcile retry does not check live survivor watches of the uncertain
child, and a skill exception after landed writes is retried without `uncertain` (pre-existing)."

| Item | Round-4 status |
|---|---|
| P1 (ask before any write; ask after a landed write) | RESOLVED |
| P2 | RESOLVED |
| F7, direct reconcile | RESOLVED |
| F7, Mission reconcile (unreadable records) | RESOLVED |
| F7, Mission reconcile (live child survivors) | NOT RESOLVED |
| N2 basis | ACCEPTED |
| Launch-time unreadable gap | "Not an N-C blocker by itself" |

Findings and resolutions, all in `4b6e919`:

| # | Severity | Finding | Resolution | Pinned by |
|---|---|---|---|---|
| F7-M | (blocker) | The Mission reconcile retry ignored live watches of the step's child tasks. | The retry waits while any child task of the step (current or earlier attempt) has a live watch, a restart survivor of the Mission is held, or an unreadable record is held. | "review F12/replan"; NC-M41, NC-M42 |
| Q2 | (blocker, pre-existing) | A skill step that throws after earlier writes landed (or a throw from the check after a write) was retried as an ordinary failure. | The exception path judges the step by the runs its current attempt recorded (`uncertainSkillRuns`). A landed write makes the step wait for the owner. | "round 4 Q2"; NC-M43 |
| Q1 | none | Preflight and `request()` differ only where the result is an ask, not a write: preflight skips the cancelled check and batch expiry. | Documented. | — |
| Q3 | LOW | A preflight deny is ignored, and a preflight ask can reach a cancelled Mission. | **Documented**, safe direction: both produce a failure or an ask, never a write. | — |
| Q4 | LOW | A read-like `terminal.exec` that succeeded before a mid-run ask triggers a reconciliation pause. | **Documented**, safe direction (over-pausing, never replay). | — |

## Round 5: confirmation pass on `4b6e919`

**Verdict:** "**NOT CONFIRMED**: post-start throw inside `TaskManager.launch` after the adapter started, caught by the
Mission model and team-model `approveDelegated` catches, which mark the step `provider_unavailable` and reroute.
Rare (it needs a DB or containment throw in a synchronous window). The Q2 residual (500-run limit) is a LOW false
negative."

The Mission reconcile survivor checks (child watches, Mission restart survivors, unreadable records) and Q2 were
RESOLVED. The reviewer's final sweep found no other replay in the direct loop, the restart sweep,
`reconcileInterrupted` or the retry gates.

Findings and resolutions, both in `6f7beb8`:

| # | Severity | Finding | Resolution | Pinned by |
|---|---|---|---|---|
| R5-1 | (blocker, pre-existing) | A delegated launch that threw after the adapter started the child was rerouted, so the same write could run twice at once. | Both catches go through `delegatedLaunchFailed`. A child whose session exists, or that is in a launched state, makes write-capable work wait for the owner. A reconcile retry also waits while any child task of the step is unfinished. | `scheduler` "round 5"; NC-M44, NC-M45 |
| R5-2 | LOW | The exception path's run lookup could miss runs in a Mission with more than 500 newer runs. | `MissionStore.runs` filters by `step_id` in SQL. | NC-M43 (anchor) |

## Round 6: confirmation pass on `6f7beb8`

**Verdict:** "**CONFIRMED: no automatic replay of an uncertain write found**."

The reviewer's final sweep covered:

- the direct TaskManager loop;
- the Mission model, capability, skill and team paths;
- the restart sweep and `reconcileInterrupted`;
- the reconcile and retry gates.

It found no replay path. One LOW was noted: the unfinished-child gate treated an unreadable child as finished, which
is theoretical. The pass also left an item unchecked: an earlier child stuck in `waiting_for_approval` would block a
reconcile retry forever (over-blocking).

## Follow-up checks on stale children (owner-initiated, not automatic)

After round 6 confirmed the automatic-replay boundary, short read-only checks followed each repair. They looked at a
related, owner-initiated path: a stale Mission child, belonging to an earlier attempt of a step, being launched by a
direct approve beside the current attempt.

| Commit | Reviewer result | Finding | Repair in the next commit |
|---|---|---|---|
| `2e78bd9` | CONFIRMED AT HEAD | The unfinished-child gate is narrowed to launched states, so a never-launched child no longer blocks the owner. Not checked: whether a direct approve of an older child is refused. | It was not. In `2db90fc`, `missionScopeCheck` refuses any launch for a step whose reconciliation is required (NC-M47). |
| `2db90fc` | NOT CONFIRMED | After a reconcile retry clears the flag, a stale `waiting_for_approval` child could be approved beside the retry. | `72eab2b`: STALE_CHILD for children recorded in the step's attempts. |
| `72eab2b` | NOT CONFIRMED | A child created on the permission path is not recorded in attempts. | `23c8c85`: Retry withdraws the step's never-launched child. |
| `23c8c85` | NOT CONFIRMED | A child displaced from `taskId` by a later child, without a Retry, was not covered. | `8411305`: structural rule. Only a step's newest child may launch (NC-M48). |
| `8411305` | NOT CONFIRMED | (a) In the window between a re-arm and the next tick, the newest child was not the step's `taskId`. (b) Children created in the same millisecond tied. | `3e75135`: every re-arm (`failed` → `ready`, in `setStep`) withdraws all never-launched children of the step (NC-M49); id tie-break. |
| `3e75135` | NOT CONFIRMED | The id tie-break is arbitrary rather than creation order. | `5376fdf`: the newest child is decided by SQLite `rowid`. Task rows are upserted in place, so rowid is the exact creation order (NC-M50). |
| `5376fdf` | **CONFIRMED AT HEAD** | (The packaged end-to-end run then found the skill preflight did not record `authorization.required`.) | `c43fad3`: preflight records the ask, as `request()` does. |
| `c43fad3` | **CONFIRMED AT HEAD** | The event grants, consumes and launches nothing; its only listeners relay or display it. Note: a failed audit write during preflight reaches the Host's fatal containment, as it already does in `request()` (L-AUDIT-COUPLING). | — |

Residuals the reviewer accepted at `5376fdf`:

- **Accepted earlier.** The launch-time unreadable-record gap (T9R-F04 design).
- **Safe direction.** A legacy import receives higher rowids and can only make a live child stale. A missing row
  (`rowid > NULL`) fails open only in a state the launch path cannot reach.
- **Outside the source.** An external `VACUUM` of the Host database could renumber rowids.

## Final status

The independent reviewer confirmed the N-C automatic-replay boundary in round 6, and the stale-child launch path at
`5376fdf`. Both still hold at the final source `c43fad3`, which adds only the preflight audit event.
