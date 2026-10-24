# MA4-S2-T3 — Time zones and DST validation (T3-G3)

All conversions use the platform `Intl.DateTimeFormat` with a named IANA zone (Node 24 ICU). No offsets are stored;
the slot instant is recomputed from the wall time each time, so a tz-database update is picked up automatically.
Invalid zones (`Mars/Olympus`) are refused at the schema.

## Policy

| Local time | Resolution | Example (verified) |
|---|---|---|
| Exact | the single instant | Asia/Kolkata 2026-10-24 18:00 → 12:30Z |
| Nonexistent (spring forward) | **moved forward by the gap** | America/New_York 2026-03-08 02:30 → 07:30Z (= 03:30 EDT) |
| Ambiguous (fall back) | **earlier instant** — fires once | America/New_York 2026-11-01 01:30 → 05:30Z (= 01:30 EDT) |
| 30-minute DST shift | same rules | Australia/Lord_Howe 2026-04-05 01:45 → ambiguous |

This is Temporal's `disambiguation: "compatible"`, the behaviour users get from calendar apps.

## Daily schedules across transitions (T3-TZ2)

| Schedule | Slots (UTC) | Note |
|---|---|---|
| Daily 01:30 New York, 30 Oct – 2 Nov 2026 | 05:30, 05:30, 05:30, **06:30** | one run on the fall-back day |
| Daily 02:30 New York, 6 – 9 Mar 2026 | 07:30, 07:30, 07:30 (03:30 EDT), **06:30** | the nonexistent 02:30 runs at 03:30 |
| Mondays 18:00 London, Oct 2026 | 19 Oct 17:00, 26 Oct **18:00** | BST → GMT |
| Once 2026-10-24 18:00 UTC | after it passes: `null` | a once slot never repeats |
| Daily, cursor 1970, now 2030 | 400 slots maximum | a jumping clock is bounded |

## Quiet hours (T3-TZ3)

Quiet hours are local times in their own zone; an overnight window (22:00–07:00 Asia/Kolkata) holds a 23:30 IST
notification until 07:00 IST (01:30Z) and passes an 11:30 IST one immediately.

## Clock adjustments (T3-S4)

Clock back one day after slots ran → no slot fires again (cursor + occurrence key). Clock forward three days →
missed-run policy (`skip`: recorded; `run_once`: one run). Sleep is detected as a gap between passes and recorded.
