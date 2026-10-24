# MA4-S2-T3R — Pairing and offline recovery

**Gate T3R-G9 (offline and stale state): PASS.**

| Situation | What the phone did (physical device) | What the Host did |
|---|---|---|
| New public address, old cookie | treated as unpaired; showed "Connecting", then the pairing form | device cookie is per origin; nothing was shared across addresses |
| Wrong code | "Invalid or expired pairing code." | `/api/bunny-pair` 403 |
| Valid one-time code | Live | new device row; code consumed |
| Host stopped (03:41:12Z) | "Offline · Showing last known state from 11:41 PM. Controls are paused." — 0 mutating controls | no execution while down |
| Host relaunched by the installed launcher (03:46:56Z) | Live again at 03:47:21Z without a tap; schedule state matched the Host | new pid, same state; pending approvals preserved |
| Device revoked from the workstation (03:47:52Z) | pairing form at 03:47:58Z | `device.revoke`; streams closed; later requests 401 |
| App sent to background for 30 s | Live again ~4 s after returning | — |

Device lifetime and idle bounds are enforced by the Host on every request (`T9 F04` tests); an expired or revoked device's
earlier answers never authorize anything again (M-A-3 T9). Unexpected disconnection of a device while work runs is covered
by `T13.2 A10/R08` (simulated) and the physical outage above.

Finding (low): a malformed JSON body on `/command` is recorded in `host-failures.jsonl` as an internal operation failure
and answered "Host command failed" instead of a 400 refusal. It was caused by a test helper, executed nothing, and the Host
kept running; worth turning into a plain refusal later.
