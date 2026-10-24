# MA4-S2-T3R — Product UX architecture

## Principle

The UI shapes a request; the Host decides. Every creation form builds a specification, the Host validates it with the
same schema it enforces at creation, and the owner approves exactly what the Host previewed. Nothing in the browser grants
authority.

```text
form (proactive-forms.ts, pure)  ──spec──▶  *.preview (Host, owner-only, stores nothing)
        ▲                                            │ next runs, will-do, reads, model use,
        │ field messages                             ▼ approvals, expiry, problems
   owner edits  ◀── Back ──  review card  ── Approve and start ──▶ *.create + *.approve(id, version)
                                         └─ Save for later ─────▶ *.create  (waits: Approve / Reject)
```

## Pieces

| Piece | File | Role |
|---|---|---|
| Form builders | `src/components/island/proactive-forms.ts` | draft → Host spec or field errors; templates "Remind me", "Check files (no model)", "Summarize files" (reads + Worker + optional Reviewer), read-only file grants, `providers:["ollama"]`, `localOnly`, `sideEffects:false` |
| Creation UI | `src/components/island/proactive-create.tsx` | goal / schedule / monitor forms, review card, accessible errors; workstation only |
| Host previews | `ProactiveEngine.previewGoal/Schedule/Monitor` (`proactive.server.ts`) | owner-only, no writes; DST notes via `slotNote()`; real-date validation via `realDate()` |
| Approval Center context | `actionContext()` (`task-commands.server.ts`) | requester role and step, task, origin schedule/goal, operation, effect class, exact scope, expected outcome, recovery, expiry |
| Rows | `proactive-model.ts` / `proactive.tsx` | states, last check / last change / next check, "Cannot read source", Reject |
| Command boundary | `presentation.ts` `DASHBOARD_DATA_ACTIONS`, `connection-model.ts` `READ_ACTIONS` | previews and create/approve results reach the dashboard; phones get no new commands |

## Authority boundaries kept

- Approve stays workstation-only; the phone may pause, resume, cancel, turn off, reject and dismiss — never approve.
- A schedule's start date (`startsAt`) is part of the approved specification hash; changing it re-requires approval like
  any other material change.
- Model choice in forms lists only local Ollama models (hosted tags such as `…:cloud` are filtered), and the Host pins the
  exact model; a different served model fails the task (`PIN_VIOLATION`).
- Monitoring is never shown as work: idle monitors are muted, only a running task uses the accent colour, and nothing in
  the panel animates while monitoring (checked in the browser).
