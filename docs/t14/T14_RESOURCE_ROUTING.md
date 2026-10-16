# M-A-3 T14 — Resource routing

T14 changes no routing code. BunnyRouter, the model-capability registry (T1), provider usage (T2), the dynamic router
(T3), unified accounts (T13.2) and the Laya/Jev advisory layer (T13.1) are used exactly as accepted.

## Who decides

- **BunnyRouter** picks the provider, model and harness for every model step and worker step at dispatch time, inside
  the step's constraints: the envelope's `providers.allow` and `localOnly`, the step's own allow/deny lists, the model
  pin, filesystem need, the session authority the envelope allows, and the external-call budget (exhausted → local only
  or `budget_exceeded`).
- **Laya** (planning advice) and **Jev** (quality advice) stay advisory. They never approve, grant, route or override a
  Host decision.
- **Account eligibility** comes from real probes and the T13.2 account bindings. A subscription is never assumed to
  include API access; an UNKNOWN capability stays UNKNOWN.

## What a worker may use

A worker's derived envelope copies the child's own provider request and then narrows it to the parent:

- `allow`: the child's list must be a subset of the parent's; an unset child list inherits the parent's list.
- `localOnly`: a local-only parent makes the worker local-only.
- Provider sessions: no more sessions than the parent's `maxSessions`, no write session unless the parent has one, no
  shell session unless the parent's sessions include shell.
- Budget: external calls, retries and tokens no larger than what the parent has left after its own use and the
  allowances already handed to its live sibling workers; runtime no later than the parent's expiry.

Built-in worker abilities run deterministic skills (`npm test`, `lint`, `typecheck`, `build`, git snapshot, page
capture) or a routed tool-free text step (research, documentation, review).

## Fallback

| Situation | Behaviour | Evidence |
| --- | --- | --- |
| Read step, provider disconnects or is rate-limited | Retry on another eligible provider within `maxRetries` | T14-D, `perf.json` `fallbackRerouteMs` |
| Read step, every attempt fails | Stops after the budget; Mission waits (WAITING_RESOURCE) | T14-D |
| Write step, quota runs out | No provider switch, no second write; paused for reconciliation | T14-D, T13.3 F |
| Write step, connection lost after dispatch | Never replayed; RECONCILIATION_REQUIRED | T14-E, T14-C |
| All four Agents busy | Per-Agent cap (default 2) and shared ceiling (default 4) hold new steps as `mission.step.held`, never failed | T14-B (`AGENT_CAP`) |
| System memory above the ceiling (95 %) | New steps held (`MEMORY_PRESSURE`) | T13.3 Gate F tests |

## Live providers

No real provider was called in T14 testing. All model I/O in the T14 scenarios is a scripted stand-in (labelled
SIMULATED); the T11 and T13 live receipts remain the evidence for real inference. This is recorded as a limitation.
