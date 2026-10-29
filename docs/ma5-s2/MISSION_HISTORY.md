# MA5-S2 Phase 1C: Native Mission History (S2-G6)

The Windows History screen now shows, next to the list, the selected item's record **as the Host reports it**, read
on selection with workstation-only commands (`mission.get`, `ptask.get`, `action.receipts`). Nothing is estimated:
no progress percentages and no verdicts the Host did not record.

| Shown | Source |
|---|---|
| Objective, state, created/started/finished and duration, Planner, result or failure, recovery | `mission.get` → Mission |
| Team: Coordinator, members (working/idle rule from Phase 1B), handoffs with artifact digests, requirement verdicts from Bunny's Tester checks | `teamView` + Agent runtime |
| Each step: team role and kind, state, dependencies ("after t1, t2"), Host verification, and **every attempt** with served provider·model (from its child task), start time, duration, outcome and failure category/detail | Mission steps + attempts |
| Permission decisions: action, risk, resolution, who and when, or PENDING | Mission requests |
| Approvals logged by the Host (router approval, delegation under the Mission authorization, mission envelope, team plan `approved=team-plan`) | `mission.get` events |
| Latest 60 Host events, with agent ids shown as team roles | `mission.get` events (Host keeps the last 200) |
| Persistent task: state, created/last change, steps done of total, pinned models, approval, failure, block, uncertain operation, output digests per completed step | `ptask.get` |
| Execution receipts and whether the receipt ledger's hash chain verifies | `action.receipts` (workstation-only) |

## Evidence

`scripts/ma5-s2/verify-history-windows.mjs` → `evidence/windows-history.json`: **Real UI-tested** (compiled WPF, UI
Automation, disposable Host, real local model). Fixtures are real Host runs:

| Stage | Result |
|---|---|
| h1 completed team Mission | All fields present; shows a real Reviewer retry (attempt 1 failed Host verification: `review.findings[0].requirement must be a requirement`; attempt 2 completed); R1/R2 PASSED; plan approval chain listed; no `%` anywhere |
| h2 completed connected task | Two output digests, receipts, ledger chain verified |
| h3 connected task that really fails (missing file) | `Failure: STEP_FAILED — Step read failed 2 time(s): missing.txt was not found in "probe"`, both dispatches and failures in the receipts |

## Findings

- **Foreground tasks need an attached workstation client.** A foreground persistent task stays `QUEUED` (no block
  reason) while no Windows client is attached (`mayRun` → `uiAttached()`). That is the documented foreground
  semantics, not a fault. The History shows `QUEUED` truthfully, but nothing explains the wait. A "waiting for the
  workstation app" block reason would help: recorded, **not changed**.
- Mission events are capped at the last 200 by the Host; long Missions lose early events in this view.

## Not covered

- Reconciliation of an UNCERTAIN task from the new detail pane uses the existing MA5-S1 buttons; it was not re-run here.
- Direct (non-Mission) chat tasks show only what the Host's recent task list still holds.
