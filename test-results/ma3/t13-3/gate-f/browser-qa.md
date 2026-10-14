# Gate F browser QA

Environment: the dev UI (Vite) on a loopback port against an isolated QA Host on port 43190, with its own data directory under `%TEMP%`. The production Host (port 43119) was not touched. No model requests were sent, and no account, credential or paid inference was used.

Path: Settings → AI & Models → Usage & limits.

| Check | Result | Screenshot |
| --- | --- | --- |
| The tab renders Routing priority, This session, and Sharing between Agents above the existing TypeSafe usage section. | Pass | `screenshots/t13-3-f-usage-desktop.png` |
| With no requests in this Host run, "This session" says "No model requests yet in this session." It does not show account totals as session usage. | Pass | `screenshots/t13-3-f-usage-desktop.png` |
| Selecting "Minimize cost" sends `scheduler.priority`. The Host applies it, the status reads "Saved.", and the radio stays checked after a full page reload. | Pass | `screenshots/t13-3-f-priority-set.png` (taken before the alignment fix below) |
| Setting Gada's priority to High sends `scheduler.fairness`, and the value stays after a full page reload. | Pass | `screenshots/t13-3-f-usage-desktop.png` (Gada: High priority) |
| The controls are disabled while a command is in flight and re-enabled once the Host answers. | Pass (observed in accessibility snapshots) | - |
| CPU and GPU limitation caption is shown. | Pass | `screenshots/t13-3-f-usage-desktop.png` |
| At a 390×844 mobile viewport: no horizontal overflow (`scrollWidth` equals `clientWidth`, both 390), and the per-Agent controls stack. | Pass | `screenshots/t13-3-f-usage-mobile.png`, `screenshots/t13-3-f-fairness-mobile.png` |

## Issue found and fixed during QA

The routing-priority radios inherited the app-wide 44 px input height, so each dot sat about one line below its label (visible in `t13-3-f-priority-set.png`). Fix in `src/components/island/session-usage.tsx`: the radio is given an explicit 16 px size. After a reload the dots align with their labels (`t13-3-f-usage-desktop.png`). The first regression run (`*-attempt1.log`) started before this edit. The second run (logs without the suffix) covers the committed source.

## Restored state

After QA, the QA Host was set back to the defaults: priority Balanced, and Gada at Normal priority.
