# MA4-S2-T1 — Host lifecycle

The persistent runtime lives inside the Host process (`startHost` in `http.server.ts`). Work can continue with every
Bunny-A window closed **only while the Host process runs**, and only under the owner's policy.

| Event | Behaviour |
|---|---|
| UI closes | The Host keeps running (it is a separate process). A task continues without a window only if the owner turned on *Keep working while Bunny-A's windows are closed* **and** that task's envelope says `background: true` (which requires approval). Otherwise a running task pauses at its next step boundary (`BACKGROUND_DISABLED`) and queued tasks wait. "A window is attached" = a workstation `/state` poll (the Island polls every 2 s) or an open `/events` stream within the last 20 s. |
| UI reopens | The client reads the Host's current task views; nothing is started by reconnecting. Ids and step counts are the Host's. |
| Host crashes | Leases stop being renewed; durable "started" operations remain. On the next start (or after the lease expires) recovery classifies each in-flight operation (see CHECKPOINT_RECOVERY). Children of the Host die with it (libuv kill-on-close Job); an escaped child is killed only after its identity is re-verified. |
| Graceful shutdown | Running steps are aborted and handed to recovery (RUNNING → RESUMING) with their state intact. |
| Windows restart / Host start | The Host binds its port first, then starts the runtime (`exclusive`): leases held by any previous instance are taken over at once (fence + 1), so the UI never shows a stale "Working". Under the default startup policy recovered tasks go to PAUSED ("Bunny-A restarted. Resume when you are ready."). With *Continue tasks after Bunny-A restarts* on, they stay RESUMING and are claimed after re-authorization. |
| Sleep / power-off | Nothing runs. The heartbeat detects a gap far beyond its interval and records it as `suspendedMs` (no work time is claimed). Deadlines are evaluated on wall-clock time, so a deadline that passed while asleep is reported as missed. |
| User signs out | The Host is a user-session process; it ends with the session like any user process. Nothing bypasses Windows session or authorization boundaries; recovery follows the next Host start. |

## What this milestone does NOT install

No Windows service, scheduled task, startup entry or privileged daemon was created. `scripts/install-bunny-startup.ps1`
(pre-existing, opt-in, user Startup-folder shortcut) was not run and is unchanged. Automatic background startup remains
disabled until the owner approves it separately. Both runtime policies (`background`, `resumeOnStart`) default to OFF.

Evidence: `ma4-s2t1-host.test.ts` (restart on the same data directory), `scripts/ma4-s2t1/live-qualify.mjs` (real Host
process killed during real inference, restarted, resumed with no window).
