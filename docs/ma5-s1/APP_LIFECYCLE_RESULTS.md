# MA5-S1 — Application lifecycle results

## Windows (`evidence/windows/lifecycle.json`, `w2-host-restart.json`)

| Check | Observed |
|---|---|
| Close button | The process stays alive. The only visible window is "Bunny Island Notch" (hidden to the notch, as designed) |
| Reopen from the notch | Main window shows "Connected to Workstation Host" |
| Second launch | Exits with code 0 (single-instance mutex), and the existing instance stays |
| Quit | Exit code 0, no owned child processes, main process gone, no error dialog |
| Relaunch | Notch restored to the saved edge and display (Top, secondary) |
| Forced termination (harness cleanup) | SIGTERM; next launch is normal |
| Host restart while running | Offline state in the window and the notch, reconnect 604 ms after the Host is back, no duplicate commands |

Refresh cadence: `/events` wakes a debounced refresh while the stream is live. In that case `/state` polling
falls back to 15 s; without the stream it runs every 3 s, and while the Host is down it backs off 3→6→12→24→30 s.
These are real HTTP reads. The UI does not describe them as streaming; the status bar names the transport.

## Android

Implemented, and covered by JVM tests (`PollPolicyTest`, 22 checks), but **not run on a device or emulator** (none
available):
- polling is scheduled only between `onStart` and `onStop`;
- one request in flight; responses from an older generation are dropped;
- bounded backoff 2→60 s, honouring `Retry-After`;
- commands run on their own executor, so Stop is never queued behind a poll;
- the chat draft survives re-renders;
- AUTH and IDENTITY failures stop polling and show a terminal page ("pair again" / "Host identity changed").

Runtime behaviour (backgrounding, rotation, process death, network loss) is **NOT TESTED**; see
PHYSICAL_TEST_STATUS.md.
