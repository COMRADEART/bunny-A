# MA4-S2-T3 — Windows notch (T3-G11)

No redesign: the movable glass notch, its placement and the agent characters are unchanged. The one task cell from
S2-T1 (`Get-BunnyTaskStrip`, `install/Bunny-Island.Placement.ps1`) now also receives the Host's `proactive` snapshot.

## Rules

| Lead (most urgent first) | Tone | Headline |
|---|---|---|
| Needs attention (task, goal or corrupt record) | warning | `Needs attention` |
| Waiting for approval (task, schedule, monitor, goal) | warning | `Waiting for approval` |
| Recovering / Working / Paused / Queued (S2-T1 tasks; a scheduled run is a task) | as before | `2 working` … |
| **Monitoring** | **muted** | `Monitoring 2` |
| **Scheduled** | **muted** | `Next run 18:00` (local) |

* Monitoring and Scheduled rank below every task state and never take the accent colour: an idle monitor is not shown
  as an agent generating. When a scheduled run starts, it is an S2-T1 task, so the cell shows `Working` with its title
  and step in the tooltip, and the schedule line reads `Schedule: <title> - Working`.
* Tooltip lines: open tasks (as S2-T1/T2), then `Goal:`, `Schedule:` (next run), `Monitor:` (last check time).
* **While you were away**: when the Host has an unread away summary and only monitoring/scheduling leads, the status
  line reads `While you were away` and the tooltip gives the durable summary (counts, changes, missed runs, and
  "Bunny-A was not running / asleep for N; nothing ran then"). Never shown offline.
* Offline: `Tasks: last known`, muted, tooltip prefixed `Host unavailable. Last known task states:`.
* Placement unchanged: the cell lives in the agent strip → left of a horizontal notch, above a side notch.
* Scripts stay ASCII (Windows PowerShell 5.1).

## Evidence

`evidence/ui/` — the real WPF Island (`-SmokeTest -CollapsedView`) against a real Host:
`notch-horizontal.png` / `notch-side.png` (a scheduled run working, a monitor watching, a schedule and a suggested goal
waiting → lead `Waiting for approval`, count 6) and `notch-monitoring-only.png` (run finished, nothing waiting, away
summary read → `Monitoring 1`, muted). Facts at each capture are in `ui-evidence.json`.
`scripts/island-ptask.test.mjs` "S2-T3 notch": muted Monitoring/Scheduled, approvals lead, real work outranks
monitoring, away line, offline wording; wiring test pins all three call sites.
