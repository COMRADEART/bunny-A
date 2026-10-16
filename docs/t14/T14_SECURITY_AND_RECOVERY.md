# M-A-3 T14 — Security and recovery

The owner's instruction to work autonomously does not widen what Bunny may do at runtime. T14's one new authority path
is derived worker authority; everything else is unchanged and re-proven.

## Derived worker authority: invariants

| Invariant | Enforced by | Test |
| --- | --- | --- |
| A worker never gets more than its parent's live envelope, field by field | `derivedScopeViolations` (roots, risk, capabilities, file roots, providers, local-only, sessions incl. `maxSessions`/write/shell, browser and domains, terminal on/off, commands and executable identities, git, network, computer, always-ask) | T14 host test (browser worker waits), review F3/F4 test |
| Budget is conserved across all of a parent's workers | finished workers charged at actual spend, live ones at full allowance; never negative | review F1 test |
| Same authority kind, never fresher consent | derived envelope copies the parent's `authority`/`grantedBy`; recorded as `bunny:derived-authorization:…`, not `user_decision` | review F1/F2 test |
| No derivation from a paired-device parent | `isRemoteEnvelope(parent)` refused | code + review "held" list |
| T5 finite Agentic consent cannot be shared | parent `agentic` refused | code + review "held" list |
| No derivation while the parent waits for the owner or for reconciliation | parent must be `ready`/`running`/`verifying` with no `reconciliation.required` | review F6 test (Mission level) |
| A live worker admits nothing new while its parent reconciles; it resumes after the owner decides | `missionPauseGate` also holds a worker child while its parent has `reconciliation.required`; a step already running finishes (same rule as the parent's own in-flight steps) | "T14 review F6" Host test, mutation-checked |
| Ends with the parent's authority | `MissionStore.authorization()` reads through the parent (revoke, expiry); replan stops derived workers; parent end stops all workers | "derived authority ends with the parent's" test |
| Only the workstation | `worker.propose` is workstation-only; a phone is refused | T14-J |
| A grant never leaves an unlinked or half-started child | worker record saved before the grant; Host acceptance checked before `grant()`; errors become "waits for the owner" | review F8 fix (code) |

## N-C (T13.3) is unchanged

- Raw write-capable provider sessions are never automatically replayed after they may have started: T14-A (failed
  check), T14-E (lost connection), T14-D (quota mid-write), T14-C (one Agent paused, three continue).
- Read work retries within bounds and reroutes (T14-D).
- Only the owner reconciles (`mission.reconcile`, workstation only); the Host never invents a result.
- A replan or ordinary retry is refused while an outcome is uncertain (T14-E).

## Fabricated success

COMPLETE requires a completed Mission from graph state; `verified` requires every step and every worker to have passed
Bunny's own checks. A worker becomes VERIFIED only from the Host's step verification; only then is a verified fact
written, with Host-written text. A provider's "it works" never completes a step (T14-A N-C test).

## Recovery

| Event | Behaviour | Test |
| --- | --- | --- |
| Host restart mid-step (graceful close + reboot) | Parent and worker held in `waiting_for_user`; nothing re-dispatched; interrupted runs not left running | T14-F |
| Crash at a checkpoint (database snapshot reopened) | Completed steps kept; the in-flight step is `interrupted`; owner retry continues; every step completed exactly once | T14-L |
| Runtime limit reached (accelerated clock) | Mission fails `budget_exceeded`; no further step starts | T14-L |
| Voice session closed | Missions keep running (Host process still running) | T14-H |

## Phone

T14-J: a paired device is refused delegation, worker proposal and composition, Lotus recall and share, Personal Agent
configuration, reconciliation, Mission configuration, theme and widget layout. Nothing changes, nothing is dispatched.

## Production

Nothing was installed, deployed, pushed or published. See the acceptance report for the read-only production check.
