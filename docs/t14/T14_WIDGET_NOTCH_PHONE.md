# M-A-3 T14 — Widgets, Notch and phone

## Fixed in T14

| Issue (Widget Studio limitation) | Fix | Test |
| --- | --- | --- |
| `mayReconcile(null)` returned true, so a snapshot without a viewer could show decision controls | Controls only for `viewer.kind === "workstation"`; null, undefined and unknown kinds get the review without controls | `reconciliation-model.test.ts` |
| The Lotus widget ignored its Project filter | With a Project in focus (widget focus, else the Agent's Mission Project) other Projects' notes are left out; the Agent's own scope stays | `widget-model.test.ts` |
| A saved theme briefly showed the default on load | A head script marks the page `data-theme-restoring` when a non-default theme is cached; the shell (`.t8-app`) stays hidden until the store has hydrated the cached theme; a 1.5 s timeout always reveals it | built-app walk "restore" check |
| Agent progress had no loop phase | The Mission panel shows `MissionView.autonomy` as a caption ("Working", "Repairing a failed check", "Waiting for earlier work", "Done — verified by Bunny", "Outcome uncertain — reconciliation required"), with the Host's basis (for example "Waiting for 2 worker(s).") as its tooltip | `mission-model.test.ts`, built-app walk |

## Status is the Host's

Every surface reads the same Host snapshot. T14-I switches all 22 themes and every widget layout while a Personal Agent's
Mission runs and checks, after each switch, that the Mission, its step, its autonomy phase, its authorization and the
Agent state are unchanged and that nothing was dispatched. The built-app walk checks that the caption each theme renders
equals the Host's own `autonomy` for that Mission.

## Phone

The phone stays supervisory. T14-J pairs a device and tries every workstation action T14 touches (delegate, worker
propose and compose, Lotus recall and share, Personal Agent configuration, reconcile, Mission configuration, theme,
widget layout); all fail closed and nothing changes or dispatches.

## Still limited (unchanged from Widget Studio)

1. The native Notch does not render widgets; the Notch shows the existing chips.
2. "Personal Agents" is one widget with four rows.
3. The phone is read-only for widgets; Usage, Voice and Reconciliation render "withheld" cards.
4. Each widget subscribes to the whole store, so updates re-render broadly (a performance cost, not a correctness one).
5. Drag-resize is pointer-only.
