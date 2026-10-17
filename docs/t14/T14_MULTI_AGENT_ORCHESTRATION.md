# M-A-3 T14 — Multi-Agent orchestration

## Four Personal Agents

Gada, Spear, Vishnu Chakra and Sword are four presentation slots (`personal-agents.ts`). A slot owns the durable Agents
recorded for it (`personal_agent.delegate`, `personal_agent.assign`); each Agent has one Mission. None has a fixed
profession: the responsibility tags in the Studio are descriptive and grant nothing. All four run independently:

- One active Mission each by default (`maxActiveMissions` 4, configurable to 10).
- Per-Agent fairness (T13.3 Gate F): 2 live steps per Agent, 4 shared, priority aging, memory ceiling. A held step stays
  ready (`mission.step.held`), it is never failed.
- Separate context: an Agent's prompts carry its own Mission facts and, for workers, the one-Project Lotus slice.

T14-C runs four Missions owned by the four Agents at once, shows them all RUNNING, shows one Agent unable to add a worker
to another's Mission or read its private memory, then pauses one for reconciliation while the other three complete.

## Workers (temporary specialists)

A worker is a child Mission an Agent adds to one of its own Missions (`worker.propose`, workstation only). Abilities are
Host-verified skills (test, build, typecheck, lint, git snapshot, page capture) or routed text (research,
documentation, review), or an owner-approved composition of skills. Limits: 3 open per parent, 12 per parent's life,
6 open per Agent, no worker may create workers, a worker's Project is its parent's.

### Derived authority (T14)

`MissionManager.deriveWorkerAuthorization(child, parent)` grants the child an envelope at once when **all** of these hold;
otherwise the child waits for the owner exactly as before and the refusal reasons are recorded on the worker:

- the child is a plain Mission waiting for approval (no Team, no Agentic consent of its own, no worktree);
- the parent is `ready`, `running` or `verifying` (not waiting for the owner, and with no outcome waiting for
  reconciliation), with an envelope that is not revoked or expired, was granted by the workstation (never a paired
  device), and carries no T5 Agentic consent;
- `derivedScopeViolations(child, parent)` is empty: roots, risk classes, capabilities (pattern-matched), file read and
  write roots, model execution, provider allow list, local-only, provider sessions (count, write, shell), browser and
  domains, terminal on/off, commands **and** executable identities, git actions, network, computer control, provider
  sessions (planned count, `maxSessions`, write, shell), and at least the parent's always-ask classes;
- the active-Mission limit has room.

The derived envelope is built from the child's own request, takes the parent's authority, expires no later than the
parent, and gets at most the budget the parent has left: the parent's own use, the actual spend of every worker derived
from it that has ended, and the full allowance of every derived worker still live (never negative). The grant is recorded
as Host bookkeeping (`bunny:derived-authorization:…`), never as a new owner decision. The store
reads it through the parent: if the parent's envelope is revoked or expires, so is the child's. A replanned parent stops
its derived workers; a parent that ends stops all its workers (T13.3).

A worker shares its parent's workspace: read work runs beside the parent's read steps, and anything that needs the
folder exclusively waits for the lock. T14 makes a step waiting for another Mission's lock wake as soon as that lock is
released (before T14 it waited until something else rescheduled its Mission). While the parent has an outcome waiting
for reconciliation, its workers admit nothing new.

### Integration

A parent whose own steps are done waits for its open workers (`mission.waiting_workers`, phase WAITING_DEPENDENCY)
before Mission-level verification. Each closed worker's verdict is written to the parent's memory: a verified
fact with Host-written text only when the Host verified it, and the steps' own reported summaries as an unverified
conclusion. A parent held only by a worker that still waits for the owner's approval shows WAITING_AUTHORIZATION.
Each worker is also counted in the parent's result ("Workers: 3 verified by Bunny."). Later parent steps get the
verified results in their prompt. T14-B shows three workers overlapping in time, a dependent parent step waiting for its
prerequisite, and its prompt carrying the workers' verified results.

## Specialist teams

For decomposition into roles (Planner, Researcher, Implementer, Reviewer, Tester, Documenter) the T11 Team Mission is
the delegation mechanism: a Coordinator Agent owns it, the Planner proposes, the Host validates, the owner approves the
exact reviewed plan once, members run in parallel with verified handoffs, and a failed Tester check activates the
reviewed rework chain. T14-A runs this with zero owner prompts after the plan approval.

## Collaboration between Personal Agents

There is no co-owned Mission: a Mission has exactly one owning Agent, and only that Agent can add workers to it.
Two Agents collaborate through a shared Project:

1. Both own Missions in the same Project.
2. The owner of a memory explicitly shares chosen entries into the Project (`lotus.share`, workstation only); they become
   Project notes with `handoff:agent:<slot>` provenance.
3. The other Agent recalls the Project notes; it never reads the first Agent's private scope.

T14-K proves the shared note crosses, an unshared private note does not, and a cross-Agent worker request is refused
while each Agent's own worker runs.
