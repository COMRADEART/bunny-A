# Widget registry

Schema: `bunny-a.widgets.v1`. Source: `WIDGET_REGISTRY` in `src/lib/bunny-host/widgets.ts`.

## Live widgets

| Id | Name | Data source | Privacy | Platforms |
| --- | --- | --- | --- | --- |
| mission | Mission Control | missions + personalAgents | projection | windows, phone, notch |
| agents | Personal Agents | personalAgents | projection | windows, phone, notch |
| usage | Session Usage | sessionLedger | workstation | windows |
| lotus | Lotus Memory | personalAgentContext metadata | agent-private | windows |
| reconciliation | Reconciliation | existing reconcile model | workstation | windows |
| voice | Bunny Voice | voice + foreground identity | workstation | windows |

Every live widget allows compact, standard, wide and tall. Refresh is the Host snapshot. None start their own timer.

## Declared, not installed

These ids are in the registry so a later build can add them without editing the six live widgets. Their controls are disabled. The preference parser rejects them.

project-explorer, file-activity, worker-graph, notifications, approval-queue, model-harness, resource-monitor, task-history, calendar, notes, research, browser-tasks, local-model-health.

## Third party

No third-party widget is registered. `widgetMayRender` is false unless the row is live and first-party.
