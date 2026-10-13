# T11 independent handoff and concurrency review

Date: 2026-10-11. Scope: cross-Agent artifact handoffs, dependency satisfaction, conflicting writes, role scope,
workspace isolation, and verified-content revalidation. Production repairs were implemented by the parent agent;
this reviewer added only disposable probes and the assigned permanent `agent-team-handoff.test.ts` file.
All model outputs in this review are scripted/SIMULATED; MissionManager, AgentRuntime, CapabilityBus, database,
filesystem operations and workspace locks are real fixture code. No production state, running production process,
credential, network service, or repository history was modified.

## Findings and final disposition

### HANDOFF-01 — High — refused write provenance bypassed by requirements verifier — FIXED

Reproduction: pause the Tester, allow the delivered HTML and Reviewer to complete, corrupt the HTML generator's
inline artifact body without changing its recorded hash, and change the delivered HTML while keeping all content
requirements satisfied. `verifiedSource` returned `HASH_MISMATCH`, but the previous `team_requirements` branch
ignored its refusal and allowed the Tester and Mission to complete successfully. Original evidence: `probes.log`.

Root cause: the saved-file check only compared hashes when `verifiedSource` succeeded; missing/refused sources
implicitly bypassed that check. The parent added an unconditional refusal before checking requirements when the
subject or verified source is unavailable. Independent regressions now pass for changed source bytes, a deleted
artifact, foreign producer provenance, and an unverified producer. The delivered foreign disk bytes are preserved.
Evidence: `revalidation.log`, `regressions.log`.

### HANDOFF-03 — Medium — rework forwarded corrupt advisory Reviewer bytes — FIXED

Reproduction: seed an initial HTML postcondition failure, pause the Tester until the Reviewer completes, replace
the Reviewer artifact body while leaving its recorded hash intact, then resume the Tester. `verifiedSource`
refused the Reviewer artifact, but `activateRework` used its body directly; the forged marker reached the rework
model prompt and the Mission completed. Original evidence: `revalidation.log`.

Root cause: rework's advisory findings bypassed the verified handoff helper and journal. The parent now revalidates
each Reviewer source, records a REFUSED handoff and declines rework activation for invalid sources, and records
successful handoff provenance and consumption for valid sources. Independent regression confirms corrupt bytes
do not reach a model and the refusal is recorded. Evidence: `regressions.log`, `scope-final.log`.
No authority expansion was reproduced: findings remain fenced advisory data and the model remains tool-free.

## Boundary attempts that held

* A native Windows junction replacing the output folder with a folder outside the Project root resulted in the
  affected write step waiting for approval; no file was written through the junction. The initial sandbox blocked
  junction creation itself, so this boundary was verified with an approved native fixture run. `junction-final.log`.
* Body/hash mismatch, unverified dependencies and missing artifacts hold model consumers. `boundaries.log`.
* A changed delivered file is not verified stale or overwritten; a foreign file appearing before a write is
  preserved as a conflict. `boundaries.log`.
* Another member cannot access a sibling Agent's scratch; plans reject multiple writers for one file. `boundaries.log`.
* Readers share locks, writers hold exclusive locks, nested paths conflict, concurrent ready tasks obey capacity,
  dependent tasks wait, and parallel writers serialize. `concurrency.log`.
* Explicit direct-approval and one-time flags cannot widen a Researcher, Documenter, Implementer, Reviewer or
  Tester's planned operation/path scope. Six attempted operations receive hard TEAM_SCOPE denials. `scope-final.log`.

## Verification inventory

* New permanent handoff suite: seven distinct tests. First six passed together in `regressions.log`; the strengthened
  Reviewer refusal assertion and seventh role-scope test passed in `scope-final.log`.
* Seven existing selected handoff/write/workspace tests passed in `boundaries.log`.
* Four existing dependency/concurrency/lock tests passed in `concurrency.log`.

No unresolved finding remains within this review's assigned scope. This is a fixture security review; it does not
claim live-model, visual browser, deployment, full-suite or production-preservation acceptance performed by others.
