## Bunny-A agent/mission recovery, authorization and live-code predicates (read-only, HEAD 9e64719 on claude/ma3-t9-phone-remote)

No files were edited and no processes were started.

### 1. Agent persistence and unclean Host exit

**Startup walk.** `AgentRuntime` runs `walk()` once in its constructor (`agent-runtime.server.ts:54-55`), after `MissionManager.recover()`. It covers agents in CREATED, PLANNING, RUNNING, WAITING_FOR_USER, WAITING_FOR_DEPENDENCY, PAUSED and VERIFYING (`:603-616`).
- Paused agents stay paused (`:625-628`). Stopped agents are skipped (`:629`).
- Each agent is claimed through `store.claimRecovery(agent.id, randomUUID(), 0, "host:"+pid, now)` (`:623-629`). The generation argument is hard-coded to 0.
- A losing claim is skipped silently (`:630`).

**How "interrupted" is recorded.**
- If the prior run has `endedAt === null`, it is closed as `INTERRUPTED` with "Host restarted during generation N" (`:634-642`). `agent.interrupted` is emitted with `HOST_INTERRUPTED`.
- A new run is opened with the prior run as predecessor (`:645`, `openRun` at `:583-600`).
- The mission side is separate: `MissionManager.recover()` fails each RUNNING step with `category:"host_restart"` (`manager.server.ts:4743-4755`). Its detail says the child task "cannot be reattached and was not resumed". The mission then goes `waiting_for_user` with `recovery.interruptedSteps` (`manager.server.ts:4822`, state change around `:4800-4830`).

**Duplicate side-effect prevention.**
- `classifyInterruptedSteps` (`agent-runtime.server.ts:719-803`) builds `ReplayFacts` from canonical rows (step attempts, task state, verification, checkpoint boundary, attempt counts). It calls `classifyReplay` (`agent-replay.ts:26`, called at `:800`).
- Only `consume_result`, `verify_then_consume` and `requeue_once` produce an instruction (`:801-807`). These go to `missions.reconcileInterrupted` inside `containment.background` (`:651-660`). Failure to reconcile fails closed to `RECOVERY_AMBIGUOUS` and the agent waits for the user (`:683-705`).
- Checkpoints live in `agent_checkpoints` (`agent-store.server.ts:20`). Each row is material-guarded by `assertCheckpointSafe` (`agent-checkpoint.server.ts:38`) and parsed fail-closed (`:43`). Retention is capped at 200 per run (`agent-store.server.ts:7`, trim at `:95`). The checkpoint's only role in replay is as a validity probe (`agent-runtime.server.ts:752-756`).
- `deriveTransition` is a no-op for repeated states (`agent-runtime.server.ts:496`).

**Recovery-claim weakness.** `claimRecovery` (`agent-store.server.ts:100-106`) keeps a claim row for 120 s (TTL default at `:100`). If the Host dies mid-walk and restarts within that window, the new walk skips that agent (`:630`). No interrupted record is written, and the run stays open until a later walk. `releaseAllClaims` (`agent-store.server.ts:113`) exists but has no callers in `src`.

**Authorization and grant invalidation at restart.**
- `AgenticStore` constructor (`agentic-store.server.ts:33-45`):
  - ADMITTED admissions from another `host_generation` are finished as `UNKNOWN` (`:37`).
  - ACTIVE or PAUSED envelopes from another generation are moved to `WAITING_FOR_USER` (or `EXPIRED`), with revision+1 and `host_generation: null` (`:42-43`).
- `MissionManager.recover()` (`manager.server.ts:4592` onward):
  - one-time `approvedOnce` allowances are invalidated as `INVALIDATED_BY_HOST_RESTART` (`:4610-4616`).
  - remote (paired-device) envelopes are revoked (`:4635-4641`).
  - PROMOTING staged changes are reconciled by sha256 against the destination (`:4619-4632`).
  - STAGED changes are ended with `INVALIDATED_BY_HOST_RESTART` (`:4633-4634`).
- Current-generation checks use `tasks.instanceId` in many places. Examples: `agenticExecutionContext` (`manager.server.ts:~228-270`), `consent.host_generation !== this.tasks.instanceId` (`:2143`, `:2165`), and `promoteStaged` (`:2662`).
- `agent-runtime.resume` (`agent-runtime.server.ts:196-240`) refuses on missing, revoked or expired envelopes (`:203-209`). A device resume gets `deviceResumeRefusal` plus a fresh assertion of revision (`:211-223`).

### 2. Device hold, promotion refusal and the live-code predicate

**Single liveness predicate: `MissionManager.liveCodeExecutions()`, `manager.server.ts:2725-2742`.** It returns the union of:
- `this.bus.liveCode.values()` (`:2741`). The bus sets `liveCode` at `bus.server.ts:331` for `runsCode(...)` or any `git.`/`github.` action, and deletes it in `finally` at `:372`.
- `this.tasks.sessions` (`:2728-2734`). These are provider sessions, filtered by `providerSessionAuthority`. Ollama without a mission and read-only authority are excluded (`:2726-2729`).
- `this.tasks.lingering` (`:2736-2740`). These are post-exit survivor watches, keyed by the attempt's own provider and access.

**Consumers of that predicate:**
- `remoteMutationHeld(request)` (`manager.server.ts:2744-2757`). It is wired into the bus at `manager.server.ts:194` and consulted at `bus.server.ts:174`. It holds a paired-device MUTATION while any live entry exists, unless the exact step was allowed once by the workstation.
- `promoteStaged(request, by)` (`manager.server.ts:2618`, check at `:2646-2647`). It throws "Promotion waits: code Bunny tracks is running…" when the list is non-empty. It also checks `desktopExecutionConflict` (`:2647`).

**Predicates that do NOT consult liveness.**
- `deviceStartRefusal` (`manager.server.ts:2255`) and `deviceResumeRefusal` (`:2297`) are static checks on the envelope and plan. They do not look at running processes.
- `desktopExecutionConflict` (`:2660` region, `desktopExecutions` map at `:2753`) is a separate trusted-desktop predicate.

**Process tracking inputs (`src/lib/bunny-host/manager.server.ts`).**
- `sessions` map (`:62`). Entries are removed at `:1655`.
- `lingering` map (`:77`) and `lingeringAttempt` (`:84`).
- `watchSurvivors(id, rootPid, attempt)` (`:1714`). It returns early when there is no `rootPid` (`:1716`), so a session without a recorded PID is never watched. It is called on exit at `:1431` and `:1654`.
- The re-check is a 10 s `setTimeout` (`:1743-1745`, `:1798` area). The task text said 15 s; the 15000 values at `:1694` and `:1889` are stop-timeouts, not sampling. Lineage uses process `createdAt` (`:1725-1741`).
- `check()` reports `"checking"` as live (`lingering.set(key,"checking")` at `:1719`). A failed process read retries after 10 s (`:1726-1727`), which fails closed.

**Restart behaviour of these sets.** All three are in-memory. After an unclean exit they are empty, so `liveCodeExecutions()` returns nothing even if provider processes survived. `MissionManager.recover()` does not inspect survivors. Today's code has no restart path that detects orphan provider processes.

**Where a job-accounting liveness signal must feed.** Add it as a labelled entry in `liveCodeExecutions()` (`manager.server.ts:2725-2742`). That single change covers both `remoteMutationHeld` (`:2744`) and `promoteStaged` (`:2646`). It should report:
- an active process count greater than 0 as live, and
- an unknown or unavailable job-status read as live (fail closed), mirroring the `"checking"` convention.
Also consider `watchSurvivors`-equivalent state, and `bus.liveCode` for direct capability runs.

**F03 consumer classifier.** `classifyDeviceWrite` is used at `manager.server.ts:2525` and re-run at `:2675` on the exact staged bytes. A content-triggered class is re-checked at promotion, and a mismatch ends the staged change as `INVALIDATED_BY_SCOPE_CHANGE` (`:2677`). The classifier itself is not a liveness input.

### 3. Disposable Host and test providers

**Host launch.**
- `scripts/bunny-host.mjs` is two lines. It calls `runHostEntry()` from `src/lib/bunny-host/entry.server.ts`.
- Data directory: `options.dataDirectory ?? process.env.BUNNY_HOST_DATA_DIRECTORY ?? developmentStateDirectory()` (`entry.server.ts:9-11`).
- `BUNNY_STATE_LAYOUT` must be `1` or `2`. Layout `2` needs an absolute `BUNNY_HOST_DATA_DIRECTORY` (`state-paths.server.ts:25-31`).
- Port: `options.port ?? Number(process.env.BUNNY_HOST_PORT ?? 43119)` (`http.server.ts:258`). Use a non-8084/43119 port for a disposable Host.
- Workspace: `BUNNY_HOST_WORKSPACE` applies only to installed paths (`http.server.ts:276`).
- Missions toggle: `BUNNY_MISSIONS=0|1` (`manager.server.ts:401-402`, store default at `store.server.ts:74`).
- `startHost({dataDirectory, port, root})` is the in-process form (`scripts/validate-bunny-real-host.mjs:6`). It uses port 43139.
- The credentials file lives under the data directory (`credentials.json`, from `validate-bunny-real-host.mjs:9`). I did not trace where it is created.
- Note `scripts/bunny-host.mjs` ignores CLI flags; configuration is by options or env only.

**Fake provider.**
- There is no fixture provider directory. `src/lib/bunny-host/fixtures/` and `testing/` contain no adapter. `testing/` has only `codex.test.ts`.
- The in-process fake is `fakeAdapter(id, launched, sessions)` in `src/lib/bunny-host/agent-recovery.test.ts:40-56`. It returns `launch` with a controllable `finish` and `stop`.
- `openStack` (`:59-72`) builds the production wiring order: db, then TaskManager with the fake adapters, then MissionManager, then AgentRuntime.
- `agentSetup` (`:74-104`) provides `reopen()` (`:86`), which does a factory-fresh restart on the same SQLite file.
- Scenario tests A12 (`:163`) and A07/A08 (`:122`) show create, start, admit, restart, and recover.
- `simulatedCodexProfile` from `testing/codex.test.ts` is imported at `agent-recovery.test.ts:17`.
- Live validation (`scripts/validate-bunny-agents.mjs`) has no fake fallback. It requires an authenticated real adapter (`:12`, `:19`) and drives the API with `project.add`, `submit`, and `approve` (`:4-14`, `:24-27`). Ollama is explicitly not a substitute.

**Creating an Agent and an authorized Mission in tests.**
- `agent.create(...)` with steps (`agent-recovery.test.ts:165-172`).
- `agent.start(id, "workstation")` (`:175`).
- For a paired device, `start` and `resume` require revision assertions (`agent-runtime.server.ts:163`, `:218-221`).

### Summary of gaps for the Gate T9R-F04 design
1. `liveCodeExecutions()` (`manager.server.ts:2725`) is the only predicate that needs a new job-liveness input. Both device hold and promotion refusal already route through it.
2. The survivor watch is in-memory and PID-gated (`manager.server.ts:1716`). A Job Object handle, if it is kept open by the Host, dies with the Host and takes its processes with it (`KILL_ON_JOB_CLOSE`). The job-liveness state would then be empty after restart, which matches today's behaviour. Confirm this assumption.
3. The recovery claim TTL (`agent-store.server.ts:100`, `:102`) can stall a restart-within-120 s.