# T13.3 N-C production preservation

The installed production `Bunny-A-Windows-MA3-T13-FINAL-TEST` (`%LOCALAPPDATA%\Bunny-A`, ports 43119 and 8084) was only
observed. `production-observe.mjs` is copied unchanged from Gate J. It opens the database read-only and reads the
registry; it writes nothing.

**Receipts.** `production-before.json` (2026-10-14T21:27:31Z, before any N-C source change) and
`production-after.json` (2026-10-15T05:11:39Z, after the final package and end-to-end runs).

**Identical** (97 of 104 recorded fields): the release and its manifest, `install.json`, the startup shortcut, both
listener PIDs (19896 and 13924) with their start times, the table set (45 tables) and every table hash except those
below, and microphone privacy (user, non-packaged and machine values all `Allow`).

**Changed, and why** (7 fields):

| Field | Before → after | Cause |
|---|---|---|
| `at` | timestamp | Receipt time. |
| `events` count and hash | 18,590 → 18,645 | 55 events from the running production Host's own activity. Only types and times were read, read-only. |
| `model_capabilities`, `providers` hashes | changed | The production Host's periodic provider refresh rewrites these rows. Gate J saw the same kind of change. |
| `sqlite_sequence` hash | changed | Follows the event inserts above. |
| `audio.endpointsSha256` | `2e765cef…` → `a183733c…` | See below. |

**The audio endpoint hash.** It covers the Windows audio-endpoint device list (`Get-PnpDevice -Class AudioEndpoint`:
id, status and name). The "after" value `a183733c…` is the long-standing baseline, recorded in every receipt from
T13.1 (2026-10-13) through Gate I's "before" (2026-10-14T16:22Z). The `2e765cef…` value appeared only between Gate
I's "after" (18:19Z) and this patch's "before" (21:27Z). The list has therefore returned to its earlier state, which
fits an audio device connecting or disconnecting (for example a headset).

No audio or microphone setting was written by this work, and no audio command was run. Microphone privacy is
identical. At the time of the "after" receipt, all three endpoints report `OK`. The hash records device presence and
status, not configuration, so it cannot prove what changed. It is reported here rather than omitted.

Nothing was pushed, deployed, installed, restarted or published. There was no sign-in, paid inference or
subscription purchase.
