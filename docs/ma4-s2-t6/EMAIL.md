# MA4-S2-T6 — Email Connector Qualification (`EMAIL.md`)

- **Gate T6-C Verdict:** **`PARTIAL`** (`PASS` on contract, draft-before-send, hash-bound approval, idempotency, and prompt-injection defense; **`BLOCKED`** on live Gmail / Microsoft Graph test account credentials)

---

## 1. Supported Email Operations (`src/lib/bunny-host/ma4/connectors/services.server.ts`)

| Operation | Classification | Approval Required | Idempotency | Security & Side-Effect Guarantees |
|---|---|---|---|---|
| `email.list` | `read` | No (within read grant) | `none` | Lists at most `50` message summaries (`id`, `from`, `subject`, `receivedAt`, `snippet`); output marked `untrusted: true`. |
| `email.read` | `read` | No (within read grant) | `none` | Reads message body (`<= 20,000` chars); output wrapped in `RESULT_SCHEMA` (`untrusted: true`). |
| `email.draft` | `draft` | No (within draft grant) | `key` (`idempotencyKey`) | Creates an unsent draft (`sent: false`); repeat calls with the same `idempotencyKey` return the existing `draftId`. |
| `email.send` | `write_consequential` | **Yes (`payloadSha256`-bound)** | `key` (`idempotencyKey`) | Prepares full preview (`account`, sorted `to`, `subject`, `bodySha256`), waits for workstation/phone approval of the exact hash, and deduplicates by `idempotencyKey` + `verify(findSent)` so a crash/retry never sends duplicate emails. |

---

## 2. Indirect Prompt-Injection Defense

Verified in `T6-C/D/E` ([`src/lib/bunny-host/ma4-s2t6.test.ts`](../../src/lib/bunny-host/ma4-s2t6.test.ts)):
- `textFrom()` in [`src/lib/bunny-host/ma4/connectors/services.server.ts`](../../src/lib/bunny-host/ma4/connectors/services.server.ts) rejects any `bodyFrom` step whose output carries `RESULT_SCHEMA` (`"bodyFrom must name a generating step, not a connector result."`), and the broker blocks any consequential `email.send` that was not explicitly approved for the exact recipient list, subject, and `bodySha256`.
