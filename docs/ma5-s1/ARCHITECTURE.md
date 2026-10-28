# MA5-S1 — Architecture

Nothing new sits between the clients and the Host. Both native applications are clients of the existing Node.js Host;
it stays the only authority for routing, model execution, approvals, memory, voice and device scope. No Host,
routing, model, memory-injection or Planner/Worker selection code changed in MA5-S1.

```
BunnyA.exe (WPF) ──loopback HTTP, workstation bearer──▶ Host /state  /command  /events
Android companion ──HTTPS, device cookie──▶ gateway api/bunny-native-v1-state ──loopback, device bearer──▶ Host
```

## Windows client

| Part | Responsibility |
|---|---|
| `Services/HostClient.cs` | Credentials file, `/state` (10 s timeout), `/command` (30 s), `/events` reader. Every command carries `expect{hostId,epoch}` and a new `operationId`, and is never retried. A connection lost after sending raises `OutcomeUnknown`; `ResolveOutcomeAsync` asks `operation.status` only while the epoch is unchanged (the ledger is in Host memory). Failures are typed (`HostFailure`). `HostChanged` fires on a new identity or epoch. |
| `MainWindow.xaml.cs` | Applies one snapshot per refresh with a sequence guard (an older response never overwrites a newer one); each section is parsed with non-throwing readers and isolated, so one bad section is reported without blanking the rest. Refresh: `/events` wakes a debounced refresh; polling every 3 s without the stream, 15 s with it, 3→6→12→24→30 s while the Host is down. |
| Approval Center | Items keyed by category, task, request and digest; selection is restored by key and never moved to a neighbour. Before approving, the client refreshes and refuses locally if the key vanished or the epoch changed. After `HostChanged`, the selection and inspected contexts are cleared. |
| `NotchWindow.xaml.cs` | Separate top-most, non-activating (`ShowActivated=false`) window. Placement in physical pixels on the monitor under the window centre (`GetWindowRect`/`MonitorFromPoint`/`SetWindowPos`), so per-monitor DPI and work-area changes are exact; `SizeToContent` is restored after Windows-initiated DPI resizes. A drag snaps to the nearest edge of the drop monitor, computed from the cursor and grip offset. `WM_ACTIVATE` records the previously active window and focus is handed back after notch actions (kept on the control when the last input was the keyboard). |
| `app.manifest` | `PerMonitorV2` DPI awareness. |

## Android companion

| Part | Responsibility |
|---|---|
| `NativeCompanionActivity` | The launcher target. Two single-thread executors: reads (state) and commands, so Stop is never queued behind a poll. Polling is scheduled on the main looper only between `onStart` and `onStop`, one request at a time. |
| `PollPolicy` | Plain Java (JVM-tested): intervals (1.5 s chat, 5 s tasks, 10 s other), backoff 2→60 s, `Retry-After`, stale-response guard. |
| `NativeCompanionClient` | HTTPS, no redirects, Host identity pinned on every snapshot, typed `Failure` (network, auth, identity/TLS, rate limit, refused, unavailable, protocol) carrying the Host's own refusal text; commands carry `expect{hostId,epoch}`. |
| `NativeSessionStore`, `NativeCookiePolicy`, `KeystoreErasure` | Unchanged. |
| Manifest | `.MainActivity` is an `activity-alias` of `.NativeCompanionActivity` (MAIN/LAUNCHER, exported). The WebView activity is gone. |

## Why polling on Android

The gateway exposes state and command routes only; the Host's `/events` stream is not proxied over HTTPS. Adding
an event route would extend the gateway's attack surface and was out of scope ("Use an event transport only if the
gateway supports it reliably"). Android therefore polls, and its screens say so.
