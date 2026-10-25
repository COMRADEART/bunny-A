# Device status

Workstation snapshot SQL:

```sql
SELECT id, name, created_at AS createdAt, revoked_at AS revokedAt FROM devices ORDER BY created_at
```

`revokedAt` is not copied to the client. The client receives `revoked: boolean` plus the existing last-seen and expiry fields. `device-authority` still rejects a revoked credential. Revoke was not changed.

Labels from `deviceStatusPresentation`:

| Situation | Label |
|---|---|
| `revoked` | Revoked |
| `expired` | Pairing expired |
| last seen inside the active window | Connected |
| otherwise | Offline |
| caller passes a live transport signal `reconnecting` | Reconnecting |

The Host presence table has last-seen, not a socket state. The devices screen does not pass `reconnecting`, so a quiet phone shows Offline rather than a guessed Reconnecting. Authority (`active` / `expired` / `revoked`) is printed next to the observed word.

The unit test asserts Revoked, Offline, and Reconnecting, and that a raw token argument does not appear on the projection (existing T5-E still checks that). No phone was paired in this session. QR pairing was not added and was not claimed.
