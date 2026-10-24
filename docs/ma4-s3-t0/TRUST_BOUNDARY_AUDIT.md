# MA4-S3-T0 — Trust Boundary Audit

## Trust root

- `isTrustedLocalActor(actor) === (actor === "workstation")`
- Workstation = Host bearer token attached by local gateway
- Device principals: `assertDeviceAction` default-deny; `ptask.cancel/pause/resume` allowed for supervise

## Findings and T0 disposition

| Finding | Severity | T0 action |
|---|---|---|
| Phone could `ptask.cancel` an `UNCERTAIN` task, settling schedules | High | **Fixed:** cancel refused in UNCERTAIN; UI removes Cancel; transition table drops CANCELLED exit |
| `emit` dropped `taskId` for ptask events | Medium | **Fixed:** wrapper passes taskId |
| Frontend builds authorization envelopes | Medium (accepted) | Host re-validates via `validateTask`; owner approves Host preview — document, no rewrite |
| Owner attestation `reconcile('happened')` labelled verified | Medium | Documented; not renamed this turn (schema compat) — T1 follow-up |
| Model output never authorizes | OK | Planner proposal-only |
| No Host bypass for task commands | OK | All via `/command` |
| Session Notification vs OS tray | Medium | Policy wired to browser Notification; OS tray marked NOT IMPLEMENTED |

## Negative cases to keep green

- Cross-project roots refused
- Hash-bound action approvals
- Device revoked/expired → pairing state
- localOnly / model pins
- No blind replay of irreversible ops
