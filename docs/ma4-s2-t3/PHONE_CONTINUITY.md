# MA4-S2-T3 — Phone continuity (T3-G12)

The phone companion shows the same `Proactive` panel in phone mode (`src/components/island/phone.tsx`), fed by the
device snapshot (`deviceSnapshot()` spreads the already-sanitized `proactive` views).

## What the phone shows

Active goals with progress from completed work, schedules with trigger and next run time, last attempt (ran / missed /
skipped + reason), monitors with last check time and class, pending notifications, paused items, items waiting for
approval ("Approve this on your PC"), the away summary, and the header's live/"Last known" Host connection state.

## What the phone may do (`DEVICE_RIGHTS`, default-deny)

| Allowed (`supervise`) | Refused (`WORKSTATION_REQUIRED`) |
|---|---|
| `proactive.list` (read) | `goal.create`, `goal.approve`, `goal.link` |
| `goal.pause/resume/cancel` | `schedule.create`, `schedule.approve`, `schedule.update` |
| `schedule.pause/resume/cancel` | `monitor.create`, `monitor.approve` |
| `monitor.pause/resume/disable` | `proactive.prefs`, `proactive.policy` |
| `proactive.notification.dismiss/snooze`, `proactive.away.ack` | `action.approve`, `action.deny`, `ptask.reconcile` (S2-T2) |

A phone **resume** never revives authority: the Host re-checks the approval and a lapsed one sends the item back to
AWAITING_APPROVAL (T3-A1). A phone cannot create persistent authority, broaden scope, grant permissions or reconcile an
uncertain action.

## Disconnected

Every row becomes `Last known: <state> (<time>)`, the header badge says `Last known`, and **no controls** are rendered
(`phone-offline.png`: 0 buttons after the Host stopped).

## Browser-level validation (new in this milestone)

S2-T1 and S2-T2 could not render the phone (it needs the HTTPS companion origin). `scripts/ma4-s2t3/ui-evidence.mjs`
adds a **synthetic HTTPS pairing fixture**: a self-signed certificate for `phone.bunny.test`, a local TLS relay standing
in for the configured tunnel (loopback peer, `x-forwarded-proto: https`), the dev server started with
`BUNNY_REMOTE_ORIGIN=https://phone.bunny.test:<port>`, and Chromium resolving that name to 127.0.0.1. Pairing uses the
real `/api/bunny-pair` route from inside the page; the browser stores the real `bunny_device` cookie (HttpOnly, Secure);
the Host serves the real device snapshot.

Results (`evidence/ui/ui-evidence.json`): `phone-live.png` — 0 Approve buttons, no project path or file name in the
panel, no horizontal overflow at 390×844, 0 console errors; `phone-after-pause.png` — tapping Pause on the phone paused
the schedule on the Host; `phone-offline.png` — Host stopped, last-known labels, 0 buttons.

**Physical Android: NOT TESTED.** The fixture proves the web companion and the device authority path, not the APK,
real network, a real tunnel or a real certificate.
