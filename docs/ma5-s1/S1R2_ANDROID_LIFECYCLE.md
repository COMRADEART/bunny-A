# MA5-S1R2: Android lifecycle with an unresolved chat message

## What is kept, and where

| Situation | Mechanism |
|---|---|
| Tab switch, dialog closed | The message state lives in its `ChatTurn`; the dialog only repeats it |
| Screen recreated (rotation) | The message list is process-wide (`static ChatTurn.Book`). The open tab and the unsent draft are kept in `onSaveInstanceState`. A send started by the old screen can no longer report to the new one, so it becomes "Outcome unknown" (`Book.interrupted`) and is checked against the Host's record |
| Process ends (force-stop, update, kill) | Open messages are written to `SharedPreferences` `native_chat_v1` on every change: operation id, Host id, epoch, state, task id, timestamps and flags. **No message text, model output or credential.** Completed and other finished messages are never stored, so a success is never persisted. `PREPARING` restores as "Outcome unknown"; a damaged state field restores as unknown, never as done |
| Back in the foreground / polling recovers | One read-only `operation.status` check per open message; never a re-send |

After a process restart the user's own text is not shown ("Message sent at 3:49 PM. Its text is not kept on this phone
after Bunny A restarts."). Forget/Revoke clears the stored messages.

Polling is unchanged: foreground only, 1.5 s only while a message's task is being followed, bounded backoff.

## Device results (Galaxy SM-S948U, Android 17, final build `classes.dex` `00eb4fa6…4702`)

An unresolved message ("What is the capital of Spain?", submit dropped before the Host, ledger `unknown`) was open
for every step. Evidence: `evidence/s1r2/android-device/F-*.txt|xml`, counts from `host-proxy-commands.log`.

| # | Step | Observed | Verdict |
|---|---|---|---|
| L1 | Process ended by an APK update, then relaunched | Restored as "Outcome unknown"; Send "Resolve above first (disabled)"; one `operation.status`, no submit | **PASS** |
| L2 | Chat → Tasks → System → Chat | Same state; Tasks lists the chat tasks | **PASS** |
| L3 | Home, 8 s, relaunch | Same state | **PASS** |
| L4 | Rotation to landscape and back (screen recreated) | Chat tab kept; unknown text and recovery buttons visible in landscape (`F-L4-landscape.png`); full state in portrait | **PASS** |
| L5 | `am force-stop`, relaunch | Same state | **PASS** |
| L6 | Airplane mode 25 s with a different unknown message whose check had failed | Stayed unknown with "Could not reach the workstation to check"; after reconnecting, one automatic check → `applied` + task id → one approve → completed on `huihui_ai/qwen2.5-abliterate:7b` | **PASS** |
| L7 | Gateway (web server) stopped 2 min and restarted, unknown message open | State kept through the outage; after recovery one automatic `operation.status`, no submit | **PASS** |
| L8 | Host restarted while a message was unknown | See S1R2_FAULT_INJECTION.md C | **PASS** |
| — | Submits sent during L1-L5 | 4 before, 4 after | **PASS** |

Not tested: Android's low-memory process kill while backgrounded (force-stop and update kills were used instead),
and TalkBack.
