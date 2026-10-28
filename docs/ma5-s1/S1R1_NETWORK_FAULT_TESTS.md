# MA5-S1R1: Network fault tests (Android companion)

Files:
- `android/app/src/main/java/com/routeragent/jev/HostExchange.java` (new; free of `android.*` and `org.json`);
- `NativeCompanionClient.java`;
- `NativeCompanionActivity.java`.

Test: `android/tests/HostExchangeTest.java`, run by `scripts/build-android.ps1` (CI: `native-android-preview`).

## Defects (e094a26)

- `sendJson` reported **"The workstation could not be reached. Nothing was sent."** for any `IOException` while
  writing the body. A write failure does not prove the workstation received zero bytes or did nothing.
- A failure after sending (`getResponseCode`) was reported as "could not be reached" (`NETWORK`) under a dialog titled
  **"Not done"**.
- `FAILED` / `HOST_UNAVAILABLE` answers to a command were shown as refusals or "not available", also under
  "Not done".
- The body was sent without streaming mode, so the platform HTTP stack was free to replay the POST after a failure.

### Reproduction before the fix

The e094a26 send / classify code, run on the reference JVM against the same fault server
(`BeforeRepro`, scratch only):

```
BEFORE RESET_MID_BODY:   shown="NETWORK: The workstation could not be reached." + dialog title "Not done"; server requests started=2 fullyReceived=0
BEFORE RESET_AFTER_BODY: shown="NETWORK: The workstation could not be reached." + dialog title "Not done"; server requests started=2 fullyReceived=2
BEFORE CLOSE_AFTER_BODY: shown="NETWORK: The workstation could not be reached." + dialog title "Not done"; server requests started=2 fullyReceived=2
```

On the JVM's `HttpURLConnection`, the old code **silently re-sent the POST**: the server read the whole command twice,
and the user was told it was "Not done". The "Nothing was sent" branch is reached when `getOutputStream`/`write`
itself throws. That depends on the platform HTTP stack and is not reproduced on the JVM. Android's own stack was not
exercised (no device).

## Fix

- `HostExchange.send` connects explicitly first. Only a failure of `connect()` (TCP + TLS; the body is written
  afterwards) is reported as "Nothing was sent". A TLS handshake failure is `IDENTITY`, anything else is `NETWORK`.
- Every failure once the body starts to leave is `OUTCOME_UNKNOWN` with the original operation id and the conservative
  message:
  - write failure;
  - reset;
  - orderly close without an answer;
  - read timeout;
  - a 2xx answer cut off or unreadable.
- `setFixedLengthStreamingMode`: a streamed body cannot be replayed, so neither the JDK stack nor Android's re-sends it.
- `HostExchange.refusal`, for a command:
  - `FAILED` / `HOST_UNAVAILABLE` become `FAILED` ("may have partly taken effect");
  - `OPERATION_IN_PROGRESS` and unreadable 5xx become `OUTCOME_UNKNOWN`;
  - identity mismatch stays `IDENTITY`;
  - `HOST_EPOCH_CHANGED` stays the Host's own pre-execution refusal;
  - 401 / 429 are unchanged.
- `pair()` goes through the same send, so it no longer claims "Nothing was sent" after the body started.
- The Activity's command dialog is titled "Outcome unknown" or "Failed, may have partly applied", and "Not done" only
  for a refusal or a send that never left the phone.

Unchanged:
- one operation id per command, kept on the failure;
- no retry, and commands are issued only by user actions;
- `expect` = pinned Host id + view epoch;
- HTTPS-only `open()` with platform TLS validation;
- Keystore session storage;
- native launcher, no WebView, no new permissions;
- Stop on its own executor, separate from polling.

## Results after the fix

`HostExchangeTest`: **35 checks passed** (local Java 21.0.12, inside `scripts/build-android.ps1`, which also passed
all of its other suites). The test uses plain HTTP on loopback against a scripted `ServerSocket`. That stands in for
the transport only: production connections are still opened by `NativeCompanionClient.open` (HTTPS,
`ServerAddress` origin pinning), which the test does not modify or bypass.

| # | Brief requirement | Test | Result |
|---|---|---|---|
| 1 | Connection failure before dispatch | A1: closed port | `NETWORK`, "Nothing was sent" (the only such case) |
| 2 | Connection loss during the body | A2: 4 MB body, server resets after 1 KB | `OUTCOME_UNKNOWN`; started once, no re-send |
| 3 | Response loss after dispatch | A3: reset, and orderly close, after the full body | `OUTCOME_UNKNOWN`; server received it **exactly once** each |
| 4 | Timeout after the server received the command | A4: 300 ms read timeout, server stalls | `OUTCOME_UNKNOWN`; received once |
| 5 | HTTP refusal | A5: real 409 answer | Arrives intact; `REFUSED` with the Host's wording |
| 6 | Host identity mismatch | A6 | `IDENTITY` |
| 7 | Changed Host epoch | A7 | The Host's own refusal ("restarted"), not unknown |
| 8 | No automatic duplicate submission | A2-A4, A9, A10 receipt counts | Never more than one receipt per command |
| 9 | Recovery after returning to the foreground | A10: after an uncertain command, a fresh state read succeeds | Read OK; command count unchanged |
| 10 | Stop under an interrupted refresh | A11: a refresh stalls; Stop sent on its own connection | Stop answered while the refresh is still stalled; exactly one Stop |
| – | Partial effect / unknown codes | A8: `FAILED`, `HOST_UNAVAILABLE`, 502 unreadable, `OPERATION_IN_PROGRESS`; 503 on a read | `FAILED` / `OUTCOME_UNKNOWN`; reads stay `UNAVAILABLE` |
| – | Accepted, answer cut off | A9 | `OUTCOME_UNKNOWN`; received once |

**Limits.** These are JVM transport tests, not device tests:
- Activity lifecycle (onStart/onStop polling, the dialogs) was reviewed in source only;
- Android's platform HTTP stack, TLS on a device and Keystore on a device are **NOT TESTED**.

Physical Android acceptance remains **BLOCKED** (no device), as in S1.
