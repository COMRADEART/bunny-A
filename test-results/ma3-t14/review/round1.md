# T14 independent review — round 1 (verbatim reviewer report, `a40f2aa..77b8446`)

Reviewer: separate `security-auditor` agent, fresh context, read-only. Probes were in the session scratchpad and are not in the repository.

## Adversarial review: MA3 T14 (`a40f2aa..77b8446`)

I did not edit files, commit, or push. Probe scripts are in the scratchpad, not the repo.

### Findings

**F1: HIGH, CONFIRMED. Worker budgets are not conserved across a parent's workers.**
- Location: `src/lib/bunny-missions/manager.server.ts:1034-1041`. `siblings` reserves only ACTIVE children, and `used = this.accounting(parentId)` (line 1035, defined at 1377) counts only the parent's own steps. A finished or stopped child's spend is never subtracted from the parent.
- Scenario: the parent is approved in `fast` mode (`maxExternalModelCalls: 2`). Each worker child is derived in turn. Child 0 spends its 2 calls and finishes. Child 1 then gets `remaining = 2 - 0 - 0`, and so on. The Host allows up to 12 workers per parent (`WORKER_LIMITS.totalPerParent`, `workers.ts:31-36`), so spend can reach 12x the approved budget for `maxExternalModelCalls`, `maxRetries` and `maxTokens`.
- Evidence: `scratchpad/probe-budget.test.ts`. Output: `parent budget {"maxExternalModelCalls":2,...}`, `child budgets granted: [2,2,2,2] sum = 8`. The probe simulates each child's spend by writing its accounting directly and then stopping it. A real run increments the same field.
- Fix: derive from cumulative delegated spend (sum the accounting of every worker child of the parent, including closed ones), or reserve each child's budget until it closes and then subtract its actual usage.

**F2: MEDIUM, CONFIRMED. A derived grant is recorded as a verified owner decision.**
- Location: `manager.server.ts:975-984` (`grant()` writes `user_decision`, "Mission approved", provenance `user:${by}`, verified `true`) and `:1044` (`by` is `"workstation (covered by parent authorization …)"`).
- Evidence: `scratchpad/probe-memory.test.ts`. The child's memory holds `kind:"user_decision"`, `provenance:"user:workstation (covered by parent authorization …)"`, `verified:true`. `memory.context()` renders it as "(user decision)". `http.server.ts:435` maps `user_decision` to Lotus trust `"user"`.
- Impact: this contradicts the claim that derived authority is not fresher owner consent.
- Fix: do not write `user_decision` for a derived grant. Record it as a Host-generated `bunny:` fact, or skip it.

**F3: MEDIUM, CONFIRMED. `providers.sessions.maxSessions` is not subset-checked.**
- Location: `authorization.server.ts:121` checks only `sessions.length` against the parent's `maxSessions`. Enforcement at `:572` uses the envelope's own `maxSessions`, which `derivedEnvelope` copies from the child.
- Evidence: `scratchpad/probe-scope.test.ts`. Child `maxSessions:999` vs parent `1` returns no violations.
- Fix: add `if (c.sessions && c.sessions.maxSessions > (p.sessions?.maxSessions ?? 0)) out.push(...)`.

**F4: LOW, CONFIRMED. Two more fields are not checked.**
- `terminal.enabled` is never compared. Child `true` vs parent `false` passes (probe). It gates `authorization.server.ts:397` and `manager.server.ts:2632`. Impact is limited because child commands must still be a subset.
- `writeIncludesShell` is compared only inside `if (sessions.length)` (`authorization.server.ts:118-123`). A zero-step child with `writeIncludesShell:true` against a parent with `false` passes (probe).
- Fix: add `if (child.terminal.enabled && !parent.terminal.enabled)`, and move the `writeIncludesShell` check out of the length guard.

**F5: MEDIUM, PLAUSIBLE (code path). Model-authored worker text is stored as a verified Host fact.**
- Location: `http.server.ts:525` builds `summary` from child step `result.summary`, which is model output. Lines 540-541 store it as `verified_fact` with provenance `bunny:verification:worker:<id>` and `verified=true` whenever the verdict is VERIFIED.
- The verdict certifies the step checks, not the summary text. For example, a `file_exists` check passes and the model summary says "deployed to production". That text is then exposed by `missionFacts` (`http.server.ts:423-436`) as trust `"host"` in `project:<id>` scope, visible to any Agent with a Mission in that Project.
- Fix: store only Host-generated text (step names, verdict reason) as a verified fact. Keep model text as an unverified `agent_conclusion`.

**F6: MEDIUM, PLAUSIBLE. Workers can be derived while the parent awaits reconciliation.**
- Location: `manager.server.ts:1020` allows `waiting_for_user`. `autonomy.ts` maps `waiting_for_user` plus `reconciliation.required` to RECONCILIATION_REQUIRED.
- A new worker can write to paths the uncertain step may already have changed, before the owner has reconciled. Replay does not occur, so N-C holds, but the pause's intent is bypassed. Nothing checks the worker's paths against the uncertain step's.
- Fix: refuse derivation when any step has `reconciliation.required`, or when the parent is not `running`/`ready`.

**F7: LOW, CONFIRMED. Negative remaining budget is passed through.**
- Location: `authorization.server.ts:149` (`Math.min(..., remaining.maxTokens)`) with no clamp. Probe output: `maxTokens: -40`.
- Effect is fail-closed, but the envelope carries an invalid budget. Fix: `Math.max(0, …)`.

**F8: LOW, PLAUSIBLE. A partial failure leaves an orphan child.**
- Location: `manager.server.ts:972` and `:1044`. `grant()` saves the envelope and sets the child to `ready` before `start()`. `start()` can throw through `containment.assertAccepting`.
- `http.server.ts:1643-1647` throws before `workerStore.save`, so the child is not linked to any worker record. Fix: start only after the worker record is saved, or revoke the envelope on failure.

**F9: LOW, CONFIRMED by code. A worker waiting for owner approval holds the parent with a misleading label.**
- Location: `manager.server.ts:1240-1248` holds completion for any open worker. `autonomy.ts` (last branch) reports `WAITING_DEPENDENCY: "Waiting for N worker(s)"`, which does not say the owner must approve the child.
- The parent also occupies an active slot. Fix: when an open worker's child is `waiting_for_approval`, return WAITING_AUTHORIZATION.

**F10: INFO. `liveAuthorizations()` returns raw rows.**
- Location: `store.server.ts:196-197`. Derived children of a revoked parent keep `revoked_at IS NULL`. The only consumers are the sibling budget (`manager.server.ts:1034`, which overcounts conservatively) and the remote-only restart sweep. No escalation.

**F11: INFO. Theme restore script.**
- `styles.css:651` hides `.t8-app` only under `html[data-theme-restoring]`. The 1.5 s timer in `__root.tsx:8` always removes it, so nothing is hidden permanently. On slow hydration the default-theme flash returns after 1.5 s, and AT users lose the shell for up to 1.5 s.
- I did not verify that the cached payload's shape matches `p.theme`.

### Checked and held

- **Phone authority:** `worker.propose` requires the workstation bearer token (`http.server.ts:1008`, `:1562`). `deriveWorkerAuthorization` has no device path.
- **Ownership:** `workers.ts:131-136` requires the parent be owned by the slot, not a worker, live, and in the same Project.
- **T5 Agentic:** a parent with `agentic` is refused (`authorization.server.ts` derivation checks). `approve()` sets `agentic` before `grant()`, so a parent cannot gain consent after children exist.
- **Revocation:** `store.server.ts:157-170` reads through to the parent for revoke and expiry. Replan revokes the parent (`manager.server.ts:4912-4915`) and `stopWorkersOf(onlyStale)` stops stale children (`http.server.ts:556-566`). The restart sweep (`manager.server.ts:5178`) covers only remote envelopes, and derived children are never remote.
- **Loops:** parent events never call `syncWorker`, and `schedule` is a single hop. No unbounded loop found.
- **Fabricated COMPLETE:** `autonomy.ts` requires `result.unverifiedSteps === 0` and zero unverified workers. INDETERMINATE workers count as unverified.
- **Lotus scope:** recall is restricted to the slot's own missions (`http.server.ts:447-456`), and worker context is project-scope only.
- **`mayReconcile`:** fails closed to `viewer.kind === "workstation"`.
- **Path containment:** `C:/p/../q` is refused (probe). `filesystem.*` vs `filesystem.read` is handled correctly.

### Tests run

- `t14-autonomy-host.test.ts`: 9 of 10 pass. The failure is T14-H, which needs `npm run build:voice` (`WORKER_INTEGRITY`), as expected.
- Not run: the full suite, `t14-scenarios.test.ts`, and the T13.3 / VE2 / Widget Studio regressions.

### Verdict

**One HIGH is open (F1), so this change should not be accepted yet.** No BLOCKER was found. Fix F1 and F2, and F3 with it, before acceptance; F5 and F6 need a decision on their intended behaviour.

Things I did not check: the actual `storedPreference` payload shape (F11), and whether a real provider run increments `externalModelCalls` the way the probe simulates it (F1).
