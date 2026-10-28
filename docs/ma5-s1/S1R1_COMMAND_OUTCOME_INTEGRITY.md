# MA5-S1R1: Command outcome integrity (Windows)

Files: `native/windows/BunnyA/Services/HostClient.cs`, `native/windows/BunnyA/MainWindow.xaml.cs`.
Tests: `native/windows/BunnyA.OutcomeTests/` (compiles the shipped `HostClient.cs` itself), driven by
`scripts/verify-ma5-s1r1-outcome.mjs`, which also runs it against a real Host. CI: `native-windows-preview`.

## Defects (e094a26)

- `ResolveOutcomeAsync` mapped every unrecognized ledger answer, including the Host's legitimate `unknown`, to
  "The Host has no record of operation …; it did not run."
- It mapped `failed` to "recorded it as refused …; nothing changed". The Host records `failed` precisely when a
  command may have partly applied (`http.server.ts`: "a failure … may have partly applied").
- It had no `refused` case, so a confirmed refusal also became "it did not run".
- It compared the epoch but not the Host identity before asking the ledger.
- A direct `FAILED` / `HOST_UNAVAILABLE` answer was classified `Refused` and shown as "Host refused: …" /
  "REFUSED BY HOST".
- Cancelling after the request had left (for example closing the app mid-command) surfaced as a plain cancellation,
  not as an uncertain outcome.

### Reproduction before the fix

The e094a26 `HostClient.cs`, unchanged, was run against the same fault endpoint (scratch harness, `FaultHost.cs` + old
client). Output:

```
BEFORE ledger unknown (record expired / never matched): shown="The connection ended after the request was sent; Bunny A did not retry it. The Host has no record of operation 065a0d6a-…; it did not run."
BEFORE ledger failed (partial effect): shown="The connection ended after the request was sent; Bunny A did not retry it. The Host recorded it as refused (operation 7e202f99-…); nothing changed."
BEFORE ledger refused: shown="The connection ended after the request was sent; Bunny A did not retry it. The Host has no record of operation 8fc50fa4-…; it did not run."
BEFORE Host answers FAILED directly: kind=Refused (UI: "Host refused: …" / "REFUSED BY HOST") shown="Host command failed. Inspect operation state before retrying."
```

## Fix

`HostException` gains `HostIdAtSend` as an optional trailing constructor argument (backward compatible) and a new
`HostFailure.Failed`. Two fixed messages:

- `Unconfirmed`: "Connection interrupted. Bunny A cannot confirm whether this operation completed. It was not
  automatically retried. Review the current task and Host state before taking another action."
- `PartlyApplied`: "The operation failed on the Host and may have partly taken effect. It was not automatically
  retried. Review the current task and Host state before taking another action."

| Situation | Classification and message |
|---|---|
| Connection refused before anything was sent | `Unreachable`, "The Host is not running. Nothing was sent." (the only "not sent" case) |
| Caller token already cancelled before sending | `OperationCanceledException` (nothing left the process) |
| Transport failure, timeout or cancellation after `SendAsync` started; answer cut off; unreadable 2xx or 5xx | `OutcomeUnknown` with the original operation id, Host id and epoch |
| `FAILED`, `HOST_UNAVAILABLE`, or `operation.state = failed` | `Failed`, `PartlyApplied` |
| `OPERATION_IN_PROGRESS` | `OutcomeUnknown` ("may still be executing") |
| Other 4xx with a Host refusal | `Refused`, as the Host worded it |

`ResolveOutcomeAsync` (asked once, original operation id, never re-sends the command):

| Reconciliation finding | Message |
|---|---|
| Different Host identity | `Unconfirmed` + "A different Host answers now"; the ledger is **not** asked |
| Changed epoch | `Unconfirmed` + "restarted … record does not survive a restart"; the ledger is not asked |
| `applied` | "The Host confirms this operation was applied" |
| `refused` | "The Host confirms this operation was refused" plus the Host's reason |
| `failed` | `PartlyApplied` |
| `in_progress` | `Unconfirmed` + "may still be executing" |
| `unknown` (never arrived, or expired) | `Unconfirmed` + "no record it can match … may have expired or … never arrived" |
| Missing, malformed, another operation's record, another epoch's record | `Unconfirmed` + "could not be read" |
| Host unreachable or refusing the status query | `Unconfirmed` + "cannot be asked right now" |
| Cancelled while checking | `Unconfirmed` + "Checking was cancelled" |

UI: the chat shows `Failed` with the partial-effect text instead of "Host refused: …". An approval decision that
failed is recorded as `FAILED, MAY HAVE PARTLY APPLIED · … · Host operation <id>` in a "Decision Failed" dialog.
Uncertain outcomes already used `ResolveOutcomeAsync`'s text, and still do. Workstation-only approval checks and
the stale-approval guard are unchanged.

## Results after the fix

`node --experimental-strip-types scripts/verify-ma5-s1r1-outcome.mjs`, run `ma5s1r1-outcome-2026-10-28T16-12-28-713Z`:
- scripted Host: **114 / 114 checks**;
- real Host: **11 / 11 checks**;
- exit 0.

The real-Host scenario R1 first used `submit`. On the CI runner, which has no model providers, the real Host recorded
that submit as `failed`. The client correctly reported "may have partly taken effect", but the test expected
"applied". R1 now:
- creates a Mission with explicit steps, which needs no provider;
- runs against a Host started with `adapters: []`.

So it behaves identically on a workstation and in CI, and never reaches a model provider. An earlier local run
(`…15-12-35-942Z`, 10/10) used `submit` on a Host with default adapters.

Evidence: `evidence/s1r1/outcome-scripted.json`, `outcome-real-host.json`, `outcome-summary.json`.

| # | Brief requirement | Scenario | Result |
|---|---|---|---|
| 1 | Response lost before acknowledgment | W1: TCP reset after the request headers, before the body was read | OutcomeUnknown; ledger `unknown` shown as unknown; 0 commands executed; no re-send |
| 2 | Applied, response lost | W2 (scripted) and **R1 (real Host)**: the Host executes, then the connection is reset | Reconciled to "applied". The real Host's mission list went 0 → 1 and stayed 1 after reconnecting |
| 3 | Refused | W3: direct 409 refusal; and a lost refusal | "Approval required on Windows Host." as worded; lost case reconciled to "refused" |
| 4 | Failed after partial effect | W4: direct `FAILED`, `HOST_UNAVAILABLE`; lost `failed` | `Failed` / `PartlyApplied`; never "refused" or "no effect" |
| 5 | In progress | W5 | "may still be executing" |
| 6 | Ledger unknown | W6 and **R2 (real Host, operation never sent)** | Unknown, not "did not run" |
| 7 | Ledger entry expired | W7: entry removed before the status query | Unknown |
| 8 | Host restart before reconciliation | W8: epoch changes after the command | "restarted"; 0 status queries to the new epoch |
| 9 | Different Host answers | W9 | "different Host"; 0 status queries |
| 10 | Malformed operation-status / answers | W10: 2xx non-JSON, 2xx cut mid-body, 5xx non-JSON, and six malformed status replies | All OutcomeUnknown / "could not be read" |
| 11 | User cancellation | W11: cancelled before sending (0 commands at the Host); cancelled after the Host received it | OutcomeUnknown, not "cancelled"; resolution cancelled → still unknown |
| 12 | No duplicate after reconnect | W12, plus a check in every scenario | Each operation id reached the Host at most once; status queried at most once, only for the original id |

Every uncertain scenario also asserts that the message contains none of "did not run", "nothing changed",
"Nothing was changed", "Nothing was sent", "no effect" or "never ran".

The faults are real socket events, not mocked strings. `FaultHost` is a raw TCP HTTP/1.1 endpoint that reads the
client's chunked body and then:
- resets (linger 0) after the headers or after the full body;
- sends a status line with a short body;
- or never answers.

The client reaches it on a pooled keep-alive connection, as in the app. In R1 the endpoint forwards the command to a
real Bunny A Host (`startHost`, disposable data folder) and resets the connection only after the Host has answered 200.
