# T14 independent review — round 2 (verbatim reviewer report, confirmation of `2eacbb7`)

## Confirmation pass: fix commit `2eacbb7`

Read-only. No edits or commits. Probes ran only in the scratchpad. I did not run `t14-autonomy-host.test.ts`.

### Per-finding status

**F1 (HIGH): CONFIRMED FIXED.**
- Probe `probe-budget.test.ts` now grants `[2,0,0,0]`, sum 2, against a parent budget of 2. Before the fix it granted `[2,2,2,2]`.
- Mechanism: `derivedAuthorizations` (store) plus the `delegated` sum in `manager.server.ts`. An ended child counts its actual `accounting()` spend. An active child counts its full allowance, which is conservative.
- Checked by reasoning: concurrent children are also bounded, because an active child reserves its full allowance.

**F2 (MEDIUM): CONFIRMED FIXED.**
- `probe-memory.test.ts` now records `mission_state` with provenance `bunny:derived-authorization:<id>`. No `user_decision` is written for a derived grant.
- `missionFacts` exposes only `verified_fact` and `user_decision`, so the derived entry does not reach Lotus or the agent context. Its agent context is now empty.

**F3 (MEDIUM): CONFIRMED FIXED.**
- Probe: child `maxSessions:999` vs parent `1` now reports "more provider sessions than the parent". The same check also covers a zero-step child.

**F4 (LOW): CONFIRMED FIXED.**
- Probe: child `terminal.enabled:true` vs parent `false` now reports "a terminal the parent does not have".
- `writeIncludesShell` is now checked outside the step-count guard.

**F5 (MEDIUM): CONFIRMED FIXED.**
- The `verified_fact` body is now Host-written (`judged.reason`, step count, child id). Model summaries go to `agent_conclusion` with `verified:false` and provenance `worker:<id>`.
- `missionFacts` and `context()` filter on `verified:true`, so the model text is not exposed.

**F6 (MEDIUM): PARTIALLY FIXED.**
- Fixed: new derivations are refused while the parent is `waiting_for_user`, and while any step has `reconciliation.required` (`manager.server.ts` around 1020-1025).
- Not fixed: a worker already derived keeps running while the parent enters reconciliation. Child admission checks only the child's own authorization, which reads through to the parent's expiry and revocation (`store.server.ts:157-170`). The only pause gate is `missionPauseGate`, which covers paused Personal Agents, not reconciliation (`manager.server.ts:1128`, `:1158`). Nothing stops or pauses children when the parent enters reconciliation.
- Status: PLAUSIBLE by code path. I did not reproduce it, because inducing an uncertain write in a worker test is expensive.

**F7 (LOW): CONFIRMED FIXED.**
- Probe: `maxTokens` with negative remaining now yields `0`.

**F8 (LOW): FIXED, with a new PLAUSIBLE edge.**
- The worker record is saved with `childMissionId` before the grant, and `assertAccepting` runs before `grant()`. The derive call is wrapped in try/catch.
- New edge (PLAUSIBLE, LOW): the record is saved in state `ELIGIBILITY_CHECK`. If the child reaches a terminal state synchronously during `start()`, the listener's `syncWorker` calls `move(ELIGIBILITY_CHECK → RESULT_REPORTED)`, which throws (`workers.ts:199-200`). The listener swallows it. The later `move` to `ADMITTED` then saves a terminal child with no further sync, so the parent would hold forever. I believe synchronous termination is unlikely, because `failMission` is awaited, but I did not verify it.

**F9 (LOW): CONFIRMED FIXED.**
- `awaitingOwner` is counted, and the autonomy phase is `WAITING_AUTHORIZATION` with "N worker(s) wait for your approval." The completion hold is unchanged, as intended.

### Newly introduced or unchanged concerns

- **Zero-budget workers are granted (INFO/LOW).** Probe children 1-3 are granted with budget 0. They will start and fail on budget instead of being refused. A refusal would be cleaner.
- **Replan resets the worker pool (INFO, pre-existing pattern).** `derivedAuthorizations(newEnvelope.id)` ignores children of the old, revoked envelope. A replan therefore grants a fresh worker allowance. The parent's own budget resets the same way, and replans are capped at 2, so this is bounded.
- **`derivedAuthorizations` uses a `LIKE %id%` scan.** It is then filtered exactly, so correctness holds. UUIDs contain no `_` or `%`. Performance is fine at this scale.
- **Tests.** `t14-scenarios.test.ts`: 10 of 10 pass.

### Verdict

**No BLOCKER and no HIGH remains open.** F1 is fixed and verified by probe.

Open items:
- F6 is PARTIALLY FIXED (MEDIUM, PLAUSIBLE). Already-derived workers still run during parent reconciliation.
- A LOW PLAUSIBLE edge in the F8 ordering (worker stuck in `ELIGIBILITY_CHECK`) needs a test.

Not done: the full regression and `t14-autonomy-host.test.ts`, which the coordinator is running. I also did not reproduce F6 or the F8 edge. The untracked `docs/t14/` directory in the worktree is not part of this review.
