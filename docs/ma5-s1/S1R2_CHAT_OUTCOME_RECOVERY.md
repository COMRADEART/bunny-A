# MA5-S1R2: Android chat outcome recovery

PR #59, branch `ma5-s1-native-application-productization`, previous head `cd13801`.

## Defect (reproduced on the device before the fix)

With the S1R1 build (`classes.dex` `10bc29f1…e14f`) on the Galaxy SM-S948U, a chat submit that the Host applied but
whose answer was lost (evidence `evidence/s1r2/android-device/A2-before-after-dismiss.*`):

- the dialog said "Outcome unknown" (the S1R1 gateway fix worked);
- after the dialog was closed, the chat line still read **"Sending to the workstation…"**, indefinitely;
- **Send was enabled again**, so a second tap would send a second, independent request;
- the phone never learned the Host's task id. The Host had created the task (`waiting_for_approval`), and the phone
  never sent the approve that a normal chat sends, so the task stayed waiting.

Causes, in `NativeCompanionActivity`:
- chat lines had no identity. `setLastReply` rewrote "the last non-user line", so any late event updated whatever
  happened to be last;
- the submit's failure went to the generic dialog only; the chat line and `pendingChatTaskId` were never touched;
- Send was gated only on `pendingChatTaskId`, which a lost answer never sets;
- the operation id was created inside `NativeCompanionClient.command`, so the screen could not look it up later.

## Fix

### Per-message state (`ChatTurn.java`, plain Java)

Each message is a `ChatTurn` object with a stable local id, its operation id (chosen **before** sending), the pinned
Host id, the epoch of the view it was sent from, the task id once known, and one state:

| State | Shown as | Entered when |
|---|---|---|
| `PREPARING` | "Sending" | Created, before the command is sent |
| `ACKNOWLEDGED` | "Accepted" / "Accepted (confirmed after reconnecting)" | Host answered with a task, or the Host's operation record names it |
| `RUNNING` | "Running" + the Host's task state | Polled task is queued, running or waiting for approval |
| `COMPLETED` | "Completed" + output, or the withheld-output notice | Polled task `completed` |
| `ENDED` | "Ended" | Task failed, stopped, vanished or exceeded the 10-minute follow limit |
| `REFUSED` | "Refused, not done" / "Refused (confirmed by the workstation)" | Host refusal (incl. 401, 429, epoch/identity refusals) or ledger `refused` |
| `NOT_SENT` | "Not sent" | Connection could not be opened, or the gateway could not reach the Host (`HOST_UNREACHABLE`) |
| `FAILED` | "Failed, may have partly applied" | `FAILED` / `HOST_UNAVAILABLE` answer, or ledger `failed` |
| `OUTCOME_UNKNOWN` | "Outcome unknown" | Lost/late/cut answer, gateway `OUTCOME_UNKNOWN`, unclassified error, screen recreated or process ended mid-send |
| `RECONCILED` | "Applied (confirmed by the workstation)" | Ledger `applied` without a task id: no task or answer is invented |

Every answer is applied to the `ChatTurn` object that sent it, and only from a state that answer can follow
(`acknowledged`/`commandFailed` only from `PREPARING`, `reconciled` only from `OUTCOME_UNKNOWN`, task updates only
while following). A stray or late event cannot change another message.

### Reconciliation (read-only)

On an unknown outcome the phone immediately asks the Host `operation.status` with the **original** operation id. The
request carries `expect: {hostId, epoch}` of the original submission, so a restarted Host refuses it with
`HOST_EPOCH_CHANGED` instead of answering from its new, empty ledger. The answer's `epoch` and Host id are compared
again on the phone.

| Ledger answer | Result |
|---|---|
| `applied` + `taskId` | Follows that task (and sends the one approve a normal chat sends, once per message) |
| `applied`, no task id | `RECONCILED`: confirmed, no invented task or answer |
| `refused` | Shows the Host's refusal |
| `failed` | "may have partly applied" |
| `in_progress` | Stays unknown; checks again in 5 s while the screen is open |
| `unknown` | Stays unknown: "no record … That does not prove it never ran." |
| other epoch / other Host / `HOST_EPOCH_CHANGED` / `HOST_IDENTITY_CHANGED` | Stays unknown, marked as no longer checkable |
| request did not reach the Host | Stays unknown: "Could not reach the workstation to check" |

Checks run: right after the failure, when the screen starts, when polling recovers after failures, and from the
"Check workstation" button. They are never driven by every poll (device commands share a rate limit with Stop).

### Host correlation (narrow)

The Host ledger did not record which task an applied operation created, so `applied` could not be followed.
`OperationLedger` now stores `taskId` for an applied operation that created a task, and `operation.status` returns it
(`taskId: null` otherwise). Leakage review:
- the ledger key includes the principal; another device or the workstation gets `unknown` for this device's id
  (existing test, still passing);
- the task id names a task this device created and already receives in its own device projection;
- no prompt, output, path or credential is added; the field is in-memory and per epoch like the rest of the ledger.

Test: `remote-device.test.ts` "T9 F06/F35/F40" now asserts `operation.status` returns the created task's id.

### Duplicate prevention

- Send is disabled while any message is `PREPARING`, being followed, or `OUTCOME_UNKNOWN` (button: "Resolve above
  first").
- Nothing is re-sent automatically, ever: not after reconnecting, restarting, or restoring.
- Under an unknown message: "Check workstation" (read-only), "View workstation tasks" (Tasks now lists the device's
  chat tasks with state, model and Stop), and "Send a new message anyway…". The last opens a dialog: "The earlier
  message may already have run … if the earlier one ran, both will have run." Only "I UNDERSTAND" unlocks Send. The
  earlier message stays "Outcome unknown" with "You chose to continue without confirmation; this message may still
  have run." The input is not prefilled; a new send gets a new operation id.

### Model output on the phone (finding)

The Host's device projection (`dashboardSnapshot` → `publicTask`) always blanks task `output` for paired devices
("an untyped provider transcript, not a reviewed public result"). The old phone said "(The model completed with empty
output.)", which was false. It now says: "Completed on the workstation. No answer text reached this phone: the Host
does not send model output to paired devices. Read the answer on Windows." Changing that privacy rule is an owner
decision and was not made here.

## Changed files

- `android/app/src/main/java/com/routeragent/jev/ChatTurn.java` (new)
- `android/app/src/main/java/com/routeragent/jev/NativeCompanionActivity.java`
- `android/app/src/main/java/com/routeragent/jev/NativeCompanionClient.java` (caller-chosen operation id)
- `android/tests/ChatTurnTest.java` (new), `scripts/build-android.ps1` (runs it)
- `src/lib/bunny-host/device-authority.server.ts`, `src/lib/bunny-host/http.server.ts`, `src/lib/bunny-host/remote-device.test.ts`
