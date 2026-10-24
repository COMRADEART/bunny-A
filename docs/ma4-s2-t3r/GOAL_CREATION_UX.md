# MA4-S2-T3R — Goal creation UX (Phase A)

**Gate T3R-G2: PASS** (unit, browser on the dev build, installed release).

## What the owner fills in

Goal name, optional description, project, success criteria (one per line, ≤ 16), optional deadline, end date (≤ 1 year),
task budget, the actions work for the goal may use (read files, write with a local model, check with a local model),
priority, milestone notifications. "Preview a task plan" asks the pinned local Planner for a **proposal only**; nothing is
created from it.

## What the review shows (Host preview)

Success criteria, the progress rule ("a criterion is met only by a completed task with verified receipts"), allowed
actions, task budget, deadline, end date and activation. Then **Approve and start**, **Save for later approval** (the goal
waits as "Waiting for approval" with **Approve** and **Reject**) or **Back to edit** (input kept).

## Evidence

| Check | Where | Result |
|---|---|---|
| specs built by the form pass the Host schema; blank criteria lines dropped | `proactive-forms.test.ts` | pass |
| missing / impossible / inconsistent input → field messages (deadline after end, 2026-02-30) | `proactive-forms.test.ts` | pass |
| goal preview describes criteria, progress rule, activation; preview stores nothing | `ma4-s2t3r.test.ts` T3R-T4 | pass |
| a suggested goal is not active until the owner approves | `model-smoke.json` (real Host entry) | pass |
| browser: review, save for later, Approve + Reject shown, Reject cancels at the Host | `evidence/ui/ui-evidence.json`, `proactive-rows.png` | pass |
| installed release: UI-created goal survives a Host restart | `evidence/installed/lifecycle-final.json` | pass |
| malicious title/description stored inert, shown sanitized; credentials refused | T3R-A1 | pass |

## Limits

The Planner proposal from the real `qwen2.5-coder:7b` left model steps unpinned; the Host listed that as a problem instead of
filling a model in (`REAL_MODEL_SMOKE.md`). Goals still progress only through tasks the owner approves.
