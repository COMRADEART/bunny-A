# T14 independent review — round 3 (verbatim reviewer report, `2eacbb7..ea6950c`)

## Round 3 confirmation: `2eacbb7..HEAD`

Scope was `2eacbb7..HEAD`, which is `ff2e45e` plus the UI caption commit `ea6950c`. I made no edits or commits. Probes are in the scratchpad only. I ran the new "T14 review F6" test by name before your latest correction, and I have not run `t14-autonomy-host.test.ts` since.

### Per-item status

**F6 residual (parent reconciling): FIXED for new admissions, PARTIAL for in-flight work.**
- Fixed: `missionPauseGate` (`http.server.ts`, the `parentReconciling` helper) holds a worker child's tick while its parent has any step with `reconciliation.required`. Running children are rescheduled from the parent's events once the hold clears, and only when `!parentReconciling`. The "T14 review F6" test passes (1/1).
- Release paths traced: the owner's retry clears `required` (`manager.server.ts` around 4816) and then emits `mission.step.reconciled` (around 4822). Stop emits after the parent state is saved, so the listener sees a terminal state and stops the children through `stopWorkersOf`. A restart re-sets `required` (around 5271 and 5314), and the gate reads it live.
- Not fixed: a child step already past admission keeps running during the parent's reconciliation. The gate only blocks new ticks. `setStep` emits no event without a `type`, so this residual is not covered by the new reschedule hook. Status: PLAUSIBLE, MEDIUM. Fix: stop or pause the worker's running steps when the parent enters reconciliation.

**F8 edge (ADMITTED before derive): FIXED.**
- The worker is saved as ADMITTED before the derive call. A child that completes synchronously then moves ADMITTED to RESULT_REPORTED, which is a valid transition, so the old ELIGIBILITY_CHECK failure no longer occurs.
- The final note patch reads `workerStore.get` and changes only the ADMITTED row, so it does not overwrite a later state.

**Workspace-wake side effects: no storm, no lost wake.**
- Storm: a waiter wakes only on a live-to-non-live transition by another Mission. A still-conflicting launch sets no state change and re-adds the waiter, so there is no self-amplifying cascade. The cost is waiters times transitions.
- Lost wake: a wake that arrives during a tick sets `again` through the `ticking` path, so the tick re-runs.
- Paused or stopped missions: `schedule()` has no state guard, but `tickOnce` returns for any mission that is not `running`. The entry is removed at the start of `tick`, so no entry persists.
- Residual, PLAUSIBLE, LOW: a lock released without a live-to-non-live `setStep` would not wake the waiter. This is the same pattern as `admissionHolds`.

**New or changed behaviour: nothing blocking.**
- The UI caption is display-only and reads `mission.autonomy`.
- `t14-scenarios.test.ts`: 10 of 10 pass.

### Verdict

**No BLOCKER and no HIGH remains open.** One MEDIUM remains open and PLAUSIBLE: a worker step already running when its parent enters reconciliation is not paused. Everything else checked is FIXED.

Not done: a probe of stop-while-reconciling. I verified that path by code trace only.
