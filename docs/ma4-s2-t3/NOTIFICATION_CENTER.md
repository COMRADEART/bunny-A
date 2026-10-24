# MA4-S2-T3 — Proactive notification center (T3-G9, T3-G10)

Code: `ma4_proactive_notifications` (`proactive-store.server.ts`), `deliverAt`/`sanitize`/`PrefsSchema`
(`proactive.ts`), panel `src/components/island/proactive.tsx`. In-app only: Windows toast and Android push are separate
integration gates and are **not** part of this milestone.

## Categories

`reminder_due`, `goal_milestone`, `source_changed`, `task_completed`, `task_failed`, `approval_required`,
`schedule_missed`, `recovery_blocked`, `permission_expired`.

## Each notification carries

| Field | Source |
|---|---|
| source goal/schedule/monitor/task | `sourceKind`, `sourceId` |
| reason | Host-written sentence, `sanitize()`d (≤ 200 chars) |
| timestamp | `at` (made), `deliverAt` (shown) |
| verified state | the Host state it reports (`COMPLETED`, `CHANGED`, `UNCERTAIN`…) |
| priority | `low` / `normal` / `high` (from the record, never from a model) |
| relevant action | `open`, `approve`, `resume`, `reconcile` |
| deduplication id | the PRIMARY KEY: `<category>:<event identity>`, e.g. `source_changed:<monitor>:change:<n>`, `task_completed:<schedule>:<slot>` |
| sanitized summary | paths → `[path]`, credential shapes → `[redacted]`, stack frames removed |

Notifications are inserted in the **same transaction** as the decision that caused them (`INSERT OR IGNORE` on the
key), so a crash either leaves both or neither (T3-A2) and a recovered Host re-deriving the event inserts nothing (T3-A4).

## Owner controls

| Control | Where | Behaviour |
|---|---|---|
| Category on/off | `proactive.prefs` (PC) | a disabled category is recorded (history) but never shown or emitted (T3-S1) |
| Quiet hours | PC panel checkbox / `proactive.prefs` | delivery waits until quiet hours end in their own zone; the panel says how many are held (T3-S1, T3-TZ3) |
| Snooze | PC and phone | hidden until the snooze ends, then shown again (T3-S1) |
| Dismiss | PC and phone | gone from the list, kept in history; an answered approval request is dismissed automatically |
| View details | the panel row, and the Approval Center for actions | |
| Pause goal or schedule | PC and phone | |
| Disable monitor | PC and phone (`monitor.disable`, final) | |

## Privacy

The phone receives the same sanitized fields; no paths, prompts, file contents, recipients, tokens or stack traces
(E2E-A/B/D assert this on the device snapshot; `phone-live.png` shows it rendered). The away summary is counts and
durations only.
