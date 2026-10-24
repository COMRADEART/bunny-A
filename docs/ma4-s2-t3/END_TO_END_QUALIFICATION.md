# MA4-S2-T3 — End-to-end qualification (T3-G13)

`src/lib/bunny-host/ma4-s2t3-scenarios.test.ts`, through the **real Host HTTP API** (`startHost`, `/command`,
`/state`, real pairing for the phone). The runtime and engine share one clock: real time plus a test offset, so the
engine's own timers fire (lateness is real) and the test can jump hours or days ahead. Recorded fake local model
(pinned id), recorded synthetic workspace for the connected service, temporary project folder.

| Scenario | Success | Denial | Cancellation | Restart | Expiration | Deduplication |
|---|---|---|---|---|---|---|
| **A** scheduled project summary (read → Worker → Reviewer) | fires on time (lateness < 2 s asserted), COMPLETED with 3 receipts, 1 `task_completed` | phone create/approve refused; unapproved schedule never runs | phone cancel → no run next day | restart before the slot: fires once; two restarts after: no second task | 1-h approval lapses → AWAITING_APPROVAL + `permission_expired`, no run | 1 task, 1 notice, 2 model calls |
| **B** build-failure watch | PASS→FAIL → 1 `source_changed` | phone create/approve refused | phone disables the monitor → no further reads | after restart FAIL stays `no_change` (baseline persisted) | monitor end date → EXPIRED | unchanged FAIL never re-notified; dismissed notice stays dismissed; 0 model calls |
| **C** persistent goal | 2 of 3 criteria met from receipted tasks; a new honest task completes the goal; each criterion carries 3 receipt hashes | phone create/approve refused; **the Worker's "all complete" claim meets nothing** (Reviewer fails that task) | phone cancels a second goal | progress and milestones persist, not repeated | short goal → EXPIRED | 2 → 4 milestones, no repeats |
| **D** scheduled connected workflow (mail read → Worker → send) | read + draft run under the schedule; the send waits in the Approval Center; approved on the PC → sent once | phone approve/deny refused; owner deny → FAILED, nothing sent, `task_failed` | schedule cancel cancels the waiting run; nothing sent | restart while waiting: same proposal, no second notice | unanswered proposal expires and is prepared again; the stale approval is refused | `w.sent` = 1 over three days; receipt chain verifies |

The phone never sees recipients, paths or prompts (asserted on the device snapshot).

Result: **4/4 pass** (also part of `npm test`). Timings: set `S2T3_EVIDENCE=<file>`.

## Limits

* Synthetic connected service only: no live email/calendar provider is connected (as in S2-T2).
* Recorded fake model: proves Host control and orchestration, not model quality.
* Days are simulated by moving the shared clock while nothing runs; a real multi-day soak was not performed.
