# MA4-S2-T6 — Calendar Connector Qualification (`CALENDAR.md`)

- **Gate T6-D Verdict:** **`PARTIAL`** (`PASS` on contract, conflict detection, proposal preview, attendee-bound approval, and no-blind-replay recovery; **`BLOCKED`** on live Google Calendar / Microsoft Graph test account credentials)

---

## 1. Supported Calendar Operations (`src/lib/bunny-host/ma4/connectors/services.server.ts`)

| Operation | Classification | Approval Required | Idempotency | Security & Side-Effect Guarantees |
|---|---|---|---|---|
| `calendar.events` | `read` | No (within read grant) | `none` | Queries events over at most a `31`-day window (`<= 200` events); output marked `untrusted: true`. |
| `calendar.availability` | `read` | No (within read grant) | `none` | Computes free/busy slots (`15–480` min duration) without modifying the calendar. |
| `calendar.propose` | `draft` | No (within draft grant) | `none` | Returns `conflicts`, `effects`, and event details with `created: false`; never notifies attendees. |
| `calendar.create` | `write_consequential` | **Yes (`payloadSha256`-bound)** | `none` (`irreversible`) | Requires explicit user approval bound to `account`, `title`, `start`, `end`, and sorted `attendees`. Because external calendar invite creation notifies attendees immediately, interrupted execution enters `NEEDS_RECONCILIATION` (`owner_reconcile_required`) rather than replaying blindly. |
