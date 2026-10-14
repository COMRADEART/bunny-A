# T13.3 independent review

Status: the review's blocker and its medium findings are fixed in source commit `fd54c2b`. The remaining low and info items are fixed or listed below as limitations.

**Superseded in part by Gate J.** F4, F6, F11 and F12, documented here as limitations, are repaired. F7 is hardened, and F2 has its `mission.respond` test. A second review of those repairs, and its confirmation pass, are in `T13_3_REVIEW_2.md`. The final source is `fc915a0`.

## What this review is, and what it is not

The review was done by a separate reviewer agent. It had no authoring context and was asked to break the eight T13.3 invariants against the code at Gate H (`88c3413` plus evidence `4d2401b`). It read the code, ran all 67 focused T13.3 tests (all passed), and reproduced its findings against a real disposable Host. Its verdict was **REQUEST CHANGES**.

It is **not** an external, independent release audit. The reviewer is the same kind of system that wrote the code, it had the same tools, and no human security reviewer has signed off. The milestone verdict reflects that.

## Invariant verdicts (as reviewed, before the fixes)

| # | Invariant | Review verdict | After the fixes |
|---|---|---|---|
| 1 | One Host authority: no second router, Mission manager, task manager or Host | Holds | Holds |
| 2 | A paired phone stays supervisory; owner-only context never reaches it | **Violated** (F1, F2) | Holds (tests below) |
| 3 | Ownership is explicit and stable | Partial (F3, F10, F12) | Holds for the Studio and assign paths; F12 stays documented |
| 4 | Workers are bounded, Host-verified children | Holds | Holds |
| 5 | Harness Manager never runs installers, and claims nothing untested | Holds (nit F8) | Holds |
| 6 | Quota-safe failover and fairness | Partial (F4, F11) | Mission work holds; direct tasks and aging are documented limitations |
| 7 | Routing improvement is evaluation-gated, and a phone cannot change it | Holds | Holds |
| 8 | Styles and personalization are presentation only | Holds | Holds |

## Findings and resolutions

### F1 (BLOCKER): a model worker's Project memory reached the phone

**Finding.** `worker.propose` added the Lotus Project slice to a model worker's step objective. That text became the child Mission's `objective` and `request`. A paired device then saw it in `/state` and in device `mission.get` (reproduced). Memory shared with `lotus.share` leaked the same way.

**Fix.** The child Mission now carries the objective only. `MissionManager` has a new Host hook, `missionPromptFacts`. The Host wires it to the worker record (`workerStore.byChild(id).context`), and the hook adds the labelled memory **only** when the model prompt is built. The memory is never stored on the Mission, its steps or the task's `routingPrompt`.

**Test.** `workers-host.test.ts`, "a model worker's Project memory reaches only its model prompt". A real Host, a recording provider fixture and a paired phone are used. The test checks that the Project note is absent from device `/state` and device `mission.get`, both before and after the run. The child objective is exactly the user's objective. The launched model prompt does contain the labelled memory.

**Mutations.** Appending the memory to the objective again (F1-M1) is caught. Dropping the hook from the prompt (F1-M2) is caught.

### F2 (MEDIUM): a phone could approve a worker's child Mission

**Finding.** `mission.approve` with `start:true` from a device released a worker child Mission (reproduced).

**Fix.** The Host dispatch refuses `mission.approve`, `mission.start`, `mission.retry` and `mission.respond` (mapped through the request to its Mission) from any device for worker Missions. They return `WORKSTATION_REQUIRED`. A device may still read and stop a worker Mission.

**Test.** The same Host test checks that `approve`, `start` and `retry` from the phone return `WORKSTATION_REQUIRED` and change nothing. `mission.respond` uses the same check, but there is no dedicated test for it. A model worker raises no permission request that a device could answer, and a skill worker's request is for code execution, which T9R-F01 already refuses from devices.

**Mutation.** F2-M1 is caught.

### F3 (MEDIUM): a Studio save could undo `personal_agent.assign`

**Finding.** `personal_agents.configure` re-recorded the owner for every slot's focused Agent. After `assign` moved an Agent, any later Studio save moved it back (reproduced).

**Fix.** `configure` records ownership only for slots whose bound Agent changed. `assign` also clears the old slot's focus, so a slot only ever focuses an Agent it owns.

**Test.** `personal-agent-context-host.test.ts`, "rebinding a slot ...", now runs assign, then an unrelated Studio rename. It checks that ownership stays with the new slot and that the old slot no longer focuses the Agent.

**Mutations.** F3-M2 (assign keeps the old focus) is caught. F3-M1 (the save re-records every owner) **survives**. With the assign fix in place, every focused Agent is already owned by its slot, so re-recording changes nothing. The changed-binding check is kept as defence in depth.

### F4 (MEDIUM): quota pause applied only to declared write scope

**Finding.** The Host's quota pause (`QUOTA_WRITE_PAUSE`) runs only when `executionScope.access === "write"`. A task without a scope reroutes.

**Resolution: no code change. The reachable cases are documented here and in the acceptance limitations.**

- Mission work cannot reach the gap. `TaskManager.submit` throws on any Mission-delegated task without an execution scope. `MissionStep.scope` is a required field, and the Mission retry path passes it to `retryVerdict`. So Mission write work always pauses on quota.
- A directly submitted task (Chat or `/submit`) has no scope and keeps the bounded single reroute. Baseline T3 requirement R22 demands this ("a quota-constrained attempt reroutes to the next candidate within the bounded recovery"). I tried treating unscoped tasks as write, and that baseline test failed. Baseline tests are not weakened, so the change was reverted. The user approves such a task and its execution root interactively, and the reroute stays within the cloud-vendor switch allowlist the user set.

### F5 (LOW): `lotus.share` was not atomic

**Fix.** The Host validates every chosen memory first. `LotusStore.writeAll` then admits every copy before writing any, and writes them all in a single SQLite transaction.

**Test.** `lotus.test.ts`, "writeAll stores every memory or none". A batch containing a credential-shaped value writes nothing.

**Mutation.** F5-M1 is caught.

### F6 (LOW): compaction bypasses admission, and folded replies get host trust

**Not changed. Documented limitation.** When conversation turns leave retention, the Host folds them into the Agent's private "Earlier conversation" summary (`compactTurns`).

- The user's turns enter at user trust.
- The Agent's replies enter at host trust. Those replies are Host-generated status text (`basis: "host-facts"`), not model output.
- The summary is capped at host trust.

None of this text goes through `admit()`'s steering check, which would hold instruction-like text as an untrusted bud. The summary stays in the Agent's own private scope and is labelled as memory when recalled. Follow-up: run `admit()` over the folded turns, and keep any steering-shaped text at untrusted trust.

### F7 (LOW): `harness.enable` resumed routes the owner had paused

**Fix.** `harness.disable` pauses only routes that are not already paused, and records them (`harness_paused`). `harness.enable` resumes only those. `harness.remove` clears the record.

**Test.** `harnesses-host.test.ts`. A route the owner paused separately stays paused through disable and then enable.

**Mutation.** F7-M1 is caught.

### F8 (LOW): the install note overclaimed

**Fix.** The guided-install note now says npm checks the download against the registry's own record, not the pinned hash. It also gives the `npm view <pkg>@<version> dist.integrity` command to compare.

### F9 (LOW): `worker.cancel` could return 500

**Fix.** A pruned child Mission no longer throws. `syncWorker` already settles that worker as stopped.

### F10 (LOW): `personal_agent.delegate` diffed snapshots across an `await`

**Fix.** `agent.create` admits synchronously inside `agentCommand`. The Host now diffs the snapshot before awaiting the result, so no other create can run in between. A follow-up would return the created id from `AgentRuntime.create`.

### F11 (INFO): fairness has no aging

**Not changed. Documented limitation.** Fairness orders eligible work by owner priority and recent use. A long-waiting low-priority Agent is not boosted over time.

### F12 (INFO): worker slot attribution after reassignment

**Not changed. Documented limitation.** A worker records the slot that proposed it. If its parent Agent is later reassigned, the worker's history still names the original slot. Authority is unaffected: the cancel and approve paths are workstation-only and act by worker id.

## Re-verification

- Focused T13.3 suites after the fixes: 132/132 (16 files, including T3 manager and routing).
- Mutation checks: `test-results/ma3/t13-3/gate-i/review-fixes/mutation-checks.{cjs,json,log}`. Six of seven caught. The survivor is F3-M1, explained above.
- Full regression at the final commit, in a clean detached checkout: see `MA3_T13_3_ACCEPTANCE.md`.
