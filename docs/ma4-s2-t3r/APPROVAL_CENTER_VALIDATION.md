# MA4-S2-T3R — Approval Center validation (Phase D)

**Gate T3R-G5: PASS.**

## What "Inspect details" now shows before a decision

| Field | Example (browser evidence) |
|---|---|
| Requested by | Worker agent, send (step 3 of 3) |
| Task / Started by | Atlas status email / you (or schedule "…" for goal "…") |
| Operation | email.send |
| Kind of effect | idempotent, consequential, cannot be undone |
| Exact scope | Folder atlas (read); email account me@example.test (send; only to lead@example.test) |
| Expected outcome | Delivers an email to 1 recipient. It cannot be unsent. |
| If it goes wrong | If Bunny-A stops while this runs, it first checks (by this action's key) whether it was already applied, and only then tries once more. |
| This approval expires | time |

Followed by the existing payload preview and receipts. Actions: **Approve this action** (names the exact action id and the
payload hash that was shown), **Deny**, **Inspect details**, **Cancel the whole task**.

## Exactness preserved

- Approving with a different payload hash is refused ("changed since you reviewed it") — T3R-A2/T3R-A5.
- A phone gets `WORKSTATION_REQUIRED` for `action.inspect` and has no Approve control (unit T3R-A5; physical phone round 2).
- Cancelling a task that waits for permission now also clears its pending proposal, so no view keeps offering a stale
  action; approving it afterwards is refused (fix in `26ab81e`, asserted in T3R-A5, observed in the browser).
- Outcome sentences were run together ("recipient.It cannot") — fixed by joining effects with a space.

## Evidence

`ma4-s2t3r.test.ts` T3R-A2, T3R-A5; `evidence/ui/approval-center.png`; `ui-evidence.json` checks "Approval Center: …"
(requester … expiry), "no local path shown", "approve exact, deny, cancel task offered", "Cancel task ends it; the stale
action is no longer offered".
