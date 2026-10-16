# M-A-3 T14 — Autonomy architecture

T14 makes the existing Mission machinery finish authorized work without asking the owner at every turn. It adds no new
Agent runtime, router, permission engine or Mission state machine. Every change sits on the accepted MA3 contracts
(T4 Agent runtime, T5 Agentic authorization, T9R remote authority, T11 Team Missions, T13.3 workers, Lotus and N-C).

## Who does what

| Component | Owns | T14 change |
| --- | --- | --- |
| Bunny (chat, voice, Notch) | Talks with the owner; starts Missions through the Host commands | Shows the T14 loop phase in the Mission panel |
| Personal Agents (Gada, Spear, Vishnu Chakra, Sword) | Four presentation slots; each owns the durable Agents (and so the Missions) recorded for it | Four can hold an active Mission each by default |
| AgentRuntime (`agent-runtime.server.ts`) | Agent identity, runs, checkpoints, pause, resume, stop, recovery | None |
| MissionManager (`bunny-missions/manager.server.ts`) | Step graph, scheduling, retries, verification, rework, reconciliation | Derived worker authority; completion hold for workers; `MissionView.autonomy` |
| Workers (`workers.ts`, `worker.propose`) | Temporary help: one child Mission per worker, closed by the Host's verdict | Run on a strict subset of the parent's approval; verdict reaches the parent |
| TaskManager + BunnyRouter | Child task lifecycle and model/harness choice | None |
| Capability Bus | Every effect, under `decide()` against the live envelope | None (derived envelopes go through the same `decide()`) |
| Laya / Jev | Advisory planning and evaluation | None; still advisory |
| Lotus | Scoped memory; verified Mission facts read in place | Host-verified worker verdicts become verified Mission facts |

## What T14 added

1. **Derived worker authority** (`deriveWorkerAuthorization`, `derivedScopeViolations`, `derivedEnvelope`). A worker
   whose requested scope fits inside its parent's live envelope runs on a derived envelope at once. Anything wider waits
   for the owner exactly as before. See [T14_MULTI_AGENT_ORCHESTRATION.md](T14_MULTI_AGENT_ORCHESTRATION.md) and
   [T14_SECURITY_AND_RECOVERY.md](T14_SECURITY_AND_RECOVERY.md).
2. **Parents wait for their workers** (`missionDelegated`, `holdForWorkers`). A parent whose own steps are done stays
   running until its workers report, so delegated results are integrated instead of being stopped with the parent.
3. **The loop phase** (`autonomy.ts`). `MissionView.autonomy` projects PLAN, DELEGATE, EXECUTE, OBSERVE, VERIFY, REPAIR,
   COMPLETE and the waiting states from canonical facts. Nothing reads it to decide what runs.
4. **Defaults and fixes.** `maxActiveMissions` 3 → 4; `mayReconcile` fails closed; the Lotus widget honours its Project
   filter; a cached theme no longer flashes the default on load.

## The loop on existing states

```
owner goal ──► Mission plan ──► one owner approval (envelope)
                                   │
       ┌───────────────────────────┴──────────────────────────────┐
       ▼                                                          ▼
  steps run in dependency order            workers: child Missions on a derived subset envelope
  (TaskManager → BunnyRouter → provider,   (skills / routed text), verified by the Host
   or Capability Bus)                                              │
       │ Host verification ◄────────────────────────────────────────┘ verdict → parent memory
       ├─ passed ──► next step / completion (held while workers are open)
       ├─ failed, read work ──► bounded retry with the failure in context (REPAIR)
       ├─ failed, Team delivery ──► reviewed rework replica under the pre-image guard (REPAIR)
       ├─ failed, raw write session ──► pause: Outcome uncertain — reconciliation required (N-C)
       └─ resource/provider loss ──► reroute read work; pause write work (WAITING_RESOURCE / RECONCILIATION_REQUIRED)
```

COMPLETE is reached only when MissionManager completed the Mission from graph state, and it is reported `verified` only
when every step and every worker passed Bunny's own checks. A model's final message never completes anything.

## What T14 deliberately did not add

- No fourth step-executor kind: delegation inside a plan stays with Team Missions (Planner + specialist members), and
  workers stay Host commands. Adding an executor would have touched 49 branch sites in the Mission manager.
- No co-owned Mission: a Mission always has exactly one owning Personal Agent. Collaboration crosses a Project boundary
  through explicit `lotus.share` (see orchestration doc).
- No change to N-C: autonomous repair of a raw write-capable provider session is still refused; repair of writes runs
  through Host-guarded paths only.
