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

## S1R1: interrupted commands and the install lifecycle

- **Windows.** A command whose connection fails after it was sent, or whose sender is cancelled (including the app
  closing mid-command), is reported as outcome unknown. It is never reported as cancelled or not run. The Host is
  asked once, by the original operation id, and the command is never re-sent. Scenarios W1–W12 and R1–R2 are in
  S1R1_COMMAND_OUTCOME_INTEGRITY.md.
- **Android (JVM transport tests only).** After an interrupted command, a fresh state read succeeds and the command is
  not re-sent (A10). Stop is answered on its own connection while a refresh is stalled (A11). The Activity's own
  onStart/onStop behaviour on a device is still **NOT TESTED**.
- **Development install.**
  - The real candidate was re-run with the S1R1 installer: install, launch, replacement refused while running,
    replacement after Quit with settings kept, relaunch, uninstall with settings and the user project kept, foreign
    folder refused (`evidence/s1r1/candidate-lifecycle.json`).
  - Injected failures after the backup and after the swap restore the previous install byte for byte
    (S1R1_INSTALLER_OWNERSHIP.md).
