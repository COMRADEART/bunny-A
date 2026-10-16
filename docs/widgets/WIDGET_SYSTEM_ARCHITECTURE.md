# Widget system architecture

Bunny A has one widget layer. It is presentation. It does not own Missions, Tasks, Agents, Lotus memory, routing, voice grants or reconciliation.

## Modules

| Module | File | Role |
| --- | --- | --- |
| WidgetRegistry | `src/lib/bunny-host/widgets.ts` | Six live widgets and thirteen declared library ids. Each row names capability, data source, permissions, platforms, sizes, refresh, offline behaviour, privacy and interaction. |
| Layout operations | same file | Reorder, move, resize, hide. Sizes snap to compact, standard, wide and tall. No free coordinates. |
| WidgetStore | `src/lib/bunny-host/widgets.server.ts` | One row, `widget_preference`, revision counter. Same stale-write rule as the theme store. |
| Host commands | `src/lib/bunny-host/http.server.ts` | `widgets.layout` and `widgets.reset`. Workstation only. The snapshot field is `widgets`. |
| Projections | `src/components/island/widget-model.ts` | Turns Host facts the window already has into widget models. Unknown cost stays unknown. Phone projections drop usage, voice and memory. |
| Studio | `src/components/island/widgets.tsx` | Board, sidebar, drawer, inspector, phone stack, Notch cue. |
| Theme | existing VE2 registry | Widgets read the themed root. There is no second theme engine. |

## What a widget may do

A widget may navigate to a surface that already exists, or send a Host command that already exists (`personal_agent.foreground`, `voice.session.open`, `voice.mute`, `voice.session.close`). The Host still authorizes the command. Visibility of a widget does not add a right.

Layout preferences are saved apart from execution tables. They hold enums, booleans and a project id filter. They do not hold credentials or memory text.

## Revision

`expectRevision` must match the stored revision or the write is refused and nothing is stored. A damaged row reads back as the default board. A paired phone receives the workstation layout on the snapshot and cannot write it. A phone may keep its own layout in `bunny-a.widgets.device.v1` on that device.
