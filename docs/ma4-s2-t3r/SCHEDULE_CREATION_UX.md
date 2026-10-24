# MA4-S2-T3R — Schedule creation UX (Phase B)

**Gate T3R-G3: PASS** (unit, browser on the dev build, installed release).

## Choices

- **What**: Remind me · Check files (no model) · Summarize files (reads up to 4 files in one registered folder, a Worker
  writes, an optional Reviewer checks against the files).
- **When**: Once (date + time) · Every day · Some days (weekdays) · When a monitor sees a change. Time zone list starts with
  the browser's zone.
- **Bounds**: optional start date, end date, missed-run policy (skip and tell me / run the latest once), background
  permission, model calls per run, minutes per run, runs per day, completion/failure notifications.

## Review card (Host preview, stores nothing)

When; the next three runs with **DST notes** ("01:30 happens twice on 2026-11-01 (clocks move back); it runs once, at the
first."; "02:30 does not exist on 2026-03-08 … it runs at 03:30"); what Bunny-A will do step by step; the information it
reads; whether a local model runs, which one and how many calls; further approvals (none for read-only templates — anything
that sends or changes would wait for the owner); behaviour without a window; missed-run policy; end date; how long the
approval lasts.

## Validation (Host-side, not UI-only)

Impossible dates (2026-02-30, 2025-02-29, month 13, 24:00), unknown zones, empty or out-of-range weekdays and unknown
recurrence types are **refused, never normalized** (T3R-T1); a real leap day is accepted. A start date must precede the end
(schema refinement) and holds back every run until it arrives (T3R-T5). A step that reads outside the schedule's grant is
refused before approval (T3R-T3, T3R-A4). Changing material scope requires a new approval (S2-T3, unchanged).

## Evidence

| Check | Where | Result |
|---|---|---|
| all four "when" kinds and three templates produce Host-valid specs | `proactive-forms.test.ts` | pass |
| preview fields, DST notes, no writes | T3R-T2, T3R-T3 | pass |
| browser at 1280/767/390 px: errors, preview, approve → ACTIVE | `evidence/ui/*schedule*`, `ui-evidence.json` | pass |
| browser: DST preview on the New York fall-back day; Back keeps input | `schedule-dst-preview.png` | pass |
| only local models offered (fixture listing includes a `:cloud` tag that is filtered) | `ui-evidence.json` | pass |
| installed release: one-time schedule created in the UI survives restart | `installed/lifecycle-final.json` | pass |
