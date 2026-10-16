# Widget security

Widgets are not an authority. The Host commands they can send already existed, and each command still checks the workstation.

## Preserved boundaries

- `widgets.layout` and `widgets.reset` throw `WorkstationRequiredError` for a paired device. The phone still receives `snapshot.widgets` so it can draw the layout.
- A phone snapshot still omits `personalAgentContext`, `sessionLedger` and `voice`. The lotus, usage and voice projections return withheld even if a caller passes those objects in.
- Reconciliation on a phone sets `canDecide` false, renders no owner buttons and no row text (only that something waits). The widget never calls `task.reconcile` or `mission.reconcile`.
- Escape closes the drawer only when focus is inside it, so Escape in the composer or another dialog never writes the layout.
- Packaged end-to-end on the package runtime (`test-results/widget-design-studio/e2e/package-widget-e2e.json`, 8/8): device write and reset refused, `__proto__`/markup/library/incomplete/malformed/stale writes refused, forged `widgets.execute` refused, no Mission, Task or ledger row created.
- Preference validation is an allowlist. Markup, `javascript:` project ids, unknown keys, disabled library ids and a second copy of a widget are refused. Theme and layout JSON are not evaluated.
- A stale `expectRevision` writes nothing.
- A forged action name (`widgets.execute`) is not a command. The Host returns 400 and does not change the layout.
- The Host test delegates four Personal Agents, saves a layout, switches the theme to Wabi-sabi, and checks the mission ids and states are unchanged.

## What this does not add

No new router, TaskManager, AgentRuntime, database authority or permission service. No phone path that approves a write. No automatic replay of an uncertain task.
