# MA4-S2-T3 — Persistent goal engine (T3-G2)

Code: `src/lib/bunny-host/ma4/proactive.ts` (`GoalSpecSchema`, `GOAL_NEXT`), `proactive.server.ts` (`goal*`, `trackGoals`),
`proactive-store.server.ts` (`ma4_proactive` rows of kind `goal`).

## Contract (`ma4.goal.v1`)

| Field | Meaning |
|---|---|
| `title`, `description`, `projectId`, `parentId` | What and where. A parent must exist and be in the same project |
| `successCriteria[]` (1–16, unique ids) | The only thing progress is measured against |
| `permittedActions[]` | Capabilities a schedule serving this goal may use (a schedule needing more is refused) |
| `priority`, `budget.maxTasks` | Notification priority; at most this many tasks may be linked or created for it |
| `deadlineAt`, `expiresAt` (≤ 1 year) | Deadline → NEEDS_ATTENTION if unmet; expiry → EXPIRED (authority ends) |
| `notify.milestones` | Whether met criteria raise a notification |
| `origin` | `owner` or `suggested` — a suggestion is labelled as such everywhere |
| `approval` | Owner approval bound to the spec hash, ending at `expiresAt` |
| `links[]`, `met[]` | Task ↔ criterion links; met criteria with the task id and its step receipt hashes |

## States

```
PROPOSED → AWAITING_APPROVAL → ACTIVE ⇄ PAUSED
                                  ↘ NEEDS_ATTENTION ⇄ ACTIVE
ACTIVE/NEEDS_ATTENTION → COMPLETED | FAILED | CANCELLED | EXPIRED      (terminal states never exit)
```

Every goal is stored PROPOSED first (owner-written and Bunny-suggested alike) and moves to AWAITING_APPROVAL after
validation. Nothing about a goal is ACTIVE until `goal.approve` from the workstation (a phone gets
`WORKSTATION_REQUIRED`). Transitions are checked against `GOAL_NEXT` inside the store transaction.

## Progress is receipts, not claims

A criterion is met only when a **linked task is COMPLETED and has step receipts** (`evidence[]` = the S2-T1 step
output hashes). The engine copies those hashes into `met[]`, so the goal keeps its own evidence even after the task is
pruned. A model saying "done" has no path into this: in E2E-C the Worker answers "All release criteria are complete"
for every task; the Reviewer rejects the unsupported one, that task FAILS, and its criterion stays unmet while the goal
moves to NEEDS_ATTENTION ("Work for "Release notes drafted" failed"). Linking a new, honest task clears the attention.

Links come from the owner (`goal.link`, workstation-only, same project, within `budget.maxTasks`) or automatically from
a schedule that names `goal: { id, criterionId }`. Every met criterion and the completion raise one `goal_milestone`
notification each, keyed `goal:<id>:met:<criterion>` / `goal:<id>:completed`, so restarts never repeat them.

## Tests

`ma4-s2t3.test.ts` T3-G1 (lifecycle, phone refusals, receipts-only progress, attention, completion, dedup), T3-G2
(expiry, phone pause/resume, cross-project link refused); `ma4-s2t3-scenarios.test.ts` T3-E2E-C.

## Limits

* No goal-creation form in the dashboard; goals are created through `goal.create` (Bunny/Planner or a Host command)
  and approved in the panel. Same limitation S2-T2 recorded for folder registration.
* No model suggests goals on its own initiative in this milestone; `suggested: true` marks a proposal that came from
  Bunny when the user asked for one.
