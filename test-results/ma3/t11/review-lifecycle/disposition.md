# T11 lifecycle security review

Reviewed 2026-10-11. Scope: durable team identities, owning member admission, Coordinator pause/stop, member stop, authorization revocation, direct child approval, and interrupted write recovery. No installed process, production state, credential, Git state, or live provider was touched.

## Findings and disposition

| ID | Severity | Original reproduction and root cause | Repair disposition |
| --- | --- | --- | --- |
| LC-01 | P2 | Approve an ordinary team plan without Agentic consent. Start `tickOnce`, then pause its Coordinator while the first deterministic read yields. The paused flag was durable, but the next documenter generation still launched. The scheduler checked Coordinator pause only at entry, and the later model admission checked only its member owner. | CLOSED. Fresh Coordinator gates at each scheduler iteration, launch entry, and after asynchronous team prompt construction. Permanent test confirms the admitted read finishes while the later model receives no attempt. |
| LC-03 | P1 | Under shared active team consent with researcher and documenter sessions in flight, revoke using the idle reviewer's member ID. Consent became REVOKED, but the Mission and Coordinator remained running and both other sessions continued. The command mutated shared consent then called member-scoped Stop. | CLOSED. Every member `agent.authorization.*` command refuses before mutation. Permanent test covers propose, approve, adjust, deny, revoke; consent and work remain unchanged on refusal. Coordinator revoke then stops both sessions and the Mission. |
| LC-04 | P2 | A real pending team provider child could be directly approved while its member was paused. Provider admission and direct-child synchronization intentionally ignored the owner pause and omitted Coordinator pause. | CLOSED. Provider admission checks current member and Coordinator pause; direct child approval honors the same hold. Permanent test obtains a real `provider.execute` request by reducing the canonical session budget, then confirms direct approval is refused for both member and Coordinator pause. |

## Boundaries independently exercised

- LC-02: member Stop recorded during a scheduler yield admits no new documenter work; the Coordinator remains live and the already admitted researcher read completes. Resume cannot resurrect the stopped member.
- LC-05: interrupt after an actual guarded `filesystem.write` succeeded on disk, before the Mission consumed the result. Reopen the entire disposable stack on the same SQLite database. Recovery completes the team through one Coordinator reconciliation, retains exactly the same destination bytes, and leaves the count of dashboard write operations at **one before and one after**. Members receive continuity recovery events only.

## Verification

`src/lib/bunny-host/agent-team-lifecycle.test.ts`: **5 passed, 0 failed** in 18.05 seconds after repairs. Command:

```powershell
$reviewTmp = Join-Path (Get-Location) 'test-results/ma3/t11/review-lifecycle/tmp'
$env:TEMP = $reviewTmp
$env:TMP = $reviewTmp
node --experimental-strip-types --test --test-force-exit --test-concurrency=1 src/lib/bunny-host/agent-team-lifecycle.test.ts
```

Provider responses and sessions are **SIMULATED** local adapter fixtures. AgentRuntime, MissionManager, TaskManager, routing, SQLite records, artifact checks, filesystem effects, and recovery are real code. Native installed-provider process ownership and actual local model behavior remain outside this independent lifecycle review.

Typecheck at this review point reported no lifecycle-test errors. It reported five errors on other concurrently edited surfaces, communicated to the parent for repair: `agent-team-handoff.test.ts:66`, `agent-team-matrix.test.ts:8/64`, and `team-coordination.server.ts:372/379`.

No unresolved finding remains within this review scope.
