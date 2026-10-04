# M-A-2 Gate T3 failure containment contract

This checkpoint implements T3 only. T4–T10 and independent operational review remain open.
The later laptop-update request authorizes one backed-up production activation only after the
combined candidate passes local and disposable installed-Host gates.

| Class | Safety basis | Action |
| --- | --- | --- |
| OPERATION_FAILURE | Known local boundary; task, Mission, capability, request, sensor or client owns the work | Fail/refuse that operation; CONTINUE |
| SUBSYSTEM_FAILURE | Known independent subsystem is unavailable | DEGRADE that scope; refuse dependent work |
| HOST_DEGRADED | Persistence or unknown degradation scope prevents trustworthy new execution | DEGRADE `*`; allow inspection and cancellation |
| HOST_FATAL | Unknown global rejection, any uncaught exception, rollback failure or failed containment | Drain immediately; bounded cleanup; exit 70 |

`failure.server.ts` is the policy authority. A JavaScript exception name does not establish safety.
AsyncLocalStorage supplies correlation, not permission to continue. Only an explicitly registered
promise with a trusted failure callback can establish safe global-rejection ownership. Unmapped
global rejections default to fatal even when a request context exists. The installed and source
entries call `runHostEntry`, which installs both actual process handlers before async startup.

Health is healthy/degraded/draining/fatal. Provider probe unavailability and sensor failure do not
make the Host degraded. Degradation is scoped; a failed browser cannot launch browser work, while
an independent task remains eligible. An unknown scope or persistence failure refuses new execution
globally. Pairing and command mutations also refuse during fatal drain. Stop/read inspection remains
available where the underlying database is usable. No failure policy bypasses authentication,
Mission authorization, capability grants, path checks or Codex compatibility policy 1.

## Local ownership audit

| Surface | Boundary and consequence | Evidence |
| --- | --- | --- |
| Mission scheduler/watchdog/model-step completion | Owned Mission/step callbacks, containment latch, workspace release; affected Mission cannot schedule again | Scheduler and Stop race tests |
| TaskManager/session completion/output/process observation | Task ownership, fresh terminal-state reads, owned flush and stop wrappers; one terminal outcome | Session rejection, stale completion, Stop and fatal-drain tests |
| Provider adapters | Closed stdin, guarded spawn/stdout/stderr/parser/normalizer callbacks, stream error handling, owned-tree stop | Real harmless native child fixtures for parser, normalization, stream errors and unexpected exit |
| Capability Bus | Run/Mission/step correlation, reject-to-structured-failure, settlement in finally, atomic terminal run/event, late-success discard after cancellation | Capability rejection/malformed result/persistence tests and Mission retry/Stop tests |
| Browser | Awaited routing rejection, scoped runtime degradation, context/proxy cleanup, owned idle closure; socket/response failures destroy only that client | Historical refused download and real isolated-browser fixture suite |
| Computer | Awaited UI action and tracked native helper; exception cannot fabricate a postcondition | Injected UI action exception; existing read-only native UI Automation tests |
| Terminal/Git | Capability ownership, abort/timeout boundaries, tracked child handles | Existing Git cancellation/cleanup suite; T4 ownership redesign remains deferred |
| Skills | Awaited ordered capability requests, bounded existing failure/cleanup flow | Existing failed-skill/no-replay tests |
| Inbox/triggers | Subscriber exceptions contained; scoped trigger wrapper; serial polling/backoff | Existing trigger/inbox tests; static callback audit |
| HTTP | Entire request owned by real request ID; bounded safe error; mutation refusal; no internal payload in response | Unexpected command failure/degraded HTTP tests |
| SSE | Each client owns serializer, read/write, heartbeat and listener cleanup; bounded catch-up/backpressure | Broken write, circular serializer and disconnect tests |
| Discovery/usage | Probe failures stay unavailable/unknown; CLI processes/output/timeouts bounded | Existing T2 suite and rejected-discovery test |
| Telemetry | Awaited iteration; unavailable sensor readings; serial capped backoff | Throwing poll and no-overlap timer tests |
| Tunnel | Actual worker max three launches, production delays 10/20 seconds; unavailable transport; no public tunnel for T3 | Real disposable worker crash/output-rejection/cancel tests |
| Gateway | Independent process policy, safe request boundary and gateway health; fatal exit 71 cannot assert Host death | Static installed-gateway audit and staged dashboard checks |
| Timers/background work | Guarded callbacks or serial self-scheduling loop; capped exponent, no overlap, no fatal retry | Failure timer and source-entry process tests |

## Persistence and safe evidence

Synchronous SQLite state/event transitions roll back together. Task terminal outcome learning is in
the same transaction. A rollback failure escalates to fatal. Logging never recursively retries the
database: ordinary events expose correlation/class/action and a generic error summary; local
`logs/host-failures.jsonl` stores the bounded redacted details. The fallback permits 128 writes per
run, rotates at 512 KiB to one previous file, and refuses linked diagnostic files. Error serialization
omits object/private connector bodies and accessors, bounds message/stack/cause/aggregate depth and
size, and redacts credentials, headers, cookies, environment secrets and actual runtime tokens.
Detailed stacks are absent from HTTP health/status and ordinary event history.

Fatal shutdown reserves a single winner, writes `runtime/host-fatal.json`, and stops live handles
created by Bunny. It never grants ownership from a persisted PID or executable name. The default
deadline is 3 seconds, clamped to at most 5 seconds, after which the process exits nonzero even if
cleanup hangs. There is no fatal retry in the process. Installed startup launches once and fails
explicitly if the child exits early; it does not create an automatic crash loop. Recovery requires a
fresh installed launch. Recovery reconciles active tasks, capability runs and Mission steps before
acknowledging the crash marker, even with Missions disabled. Old pipes are not reattached and old
provider sessions are not reported resumed. Fatal recovery pauses scheduling for user review.

## Retired credential origin investigation

The pre-T3 source has a reproducible writer chain: `start-bunny-gateway.ps1`,
`start-bunny-island.ps1`, `start-bunny-remote.ps1` or `restart-bunny-host.ps1` can launch
`start-bunny-host.ps1`; its default and `hostStatePaths` select `<repo>/.bunny-a`, then the actual
Host HTTP startup writes `credentials.json`. This proves capability to recreate the stale file;
it does not prove which historical invocation caused T1's observation. The unsafe launchers are
explicitly retired. Source Host defaults, bridge, validators and tunnel now use application data;
the native Island requires explicit application-data paths. Diagnostics cannot select a Git tree.
The remaining `.bunny-a` filesystem references are the T1 migration's deliberate transient
v10 compatibility junction inside external application data, and test fixtures. They do not create
retired repository credentials. Existing immutable T1/T2 packages were not rewritten.

Read `test-results/ma2-gate3/retired-path-audit.txt`, source-entry tests, production preservation and
the installed-candidate records. Evidence distinguishes live native process checks, disposable
state copies, controlled fixture injection and static audit; no simulated model execution is
represented as a live provider Mission.
