# Provider-session process lifetime in bunny-host (read-only, repo at 9e64719 / branch claude/ma3-t9-phone-remote)

No files were edited and no processes were started or stopped. Line numbers are from the working tree as read. Paths are repo-relative under `src/lib/`.

## 0. Summary of the model

- A provider session is one plain `child_process.spawn` (`bunny-host/adapters.server.ts:193-239`, `spawnSession`). Its root PID is recorded and its tree is observed only by sampling the OS process table.
- Stop uses `taskkill /T /F` on the root (`adapters.server.ts:195-199`). Supplemental cleanup kills only recorded descendants that are still identity-verified (`manager.server.ts:1762-1816`).
- Survivor tracking (`lingering`) is in memory and is consumed only by the mission-side "live code" check (`bunny-missions/manager.server.ts:2725-2741`), which gates F01 device holds and F02 promotion.
- Nothing kills or reattaches old provider processes after a Host restart. Tasks are marked failed, PIDs are kept for diagnosis, and no process is killed (`manager.server.ts:144-165`).
- Structural gaps the report should keep in mind for F04:
  - Orphans whose parent has already exited are invisible to both the 15 s tree sampler and the stop path.
  - Survivor tracking is lost on restart.
  - Shutdown and fatal exit can leave provider processes running.

## 1. Launch sites, RunningSession use, PID recording and persistence

**Launch call sites (every provider session is launched through `adapter.launch`):**
- `manager.server.ts:1372` is the initial launch: `session = adapter.launch(adapterTask, adapterHooks);`. It is inside `private launch(...)` (`manager.server.ts:1039`). Its callers are `approve` (`:993`) and `approveDelegated` (`:1026`).
- The same launch function reaches `:1372` after a pre-launch revalidation reroute (`:1080-1133`, which sets the new provider/model on the task and then continues).
- `manager.server.ts:1350` is `startSession`'s launch, `targetAdapter.launch(adapterTask, adapterHooks)`. It is reached from the recovery loop at `:1559` (retry-same), `:1589` (escalate-effort) and `:1603` (reroute).
- `retarget` (`:884`) only changes a waiting task and does not launch.
- Adapter implementations: `adapters.server.ts:166-174` (Ollama, `pid: () => null`), `:302-335` (Codex; plain path at `:306` calls `spawnSession` directly, Mission path defers spawn behind an async compat check), `:369-376` (Claude, `spawnSession`).

**RunningSession fields used by the manager:**
- `done`: awaited in the recovery loop (`manager.server.ts:1426`, `session.done`).
- `stop()`: called from `failOperation` (`:220`, `this.sessions.get(id)?.stop()`) and from `stop()` (`:1766`, `session?.stop()`).
- `pid?.()`: read at `:1431`, `:1654`, `:1664`, `:1762`.
- `sendInput?` is optional and not used in the lifetime paths.
- Type definitions are in `contracts.ts:68-74` (see section 7).

**hooks.session and PID recording:**
- `spawnSession` emits `hooks.session(...)` only on the child's `spawn` event (`adapters.server.ts:214-215`): `hooks.session(id === "claude" ? sessionId : null, child!.pid ?? null)`.
- The manager's hook (`manager.server.ts:1226-1241`) writes the PID through `update(...)` at `:1236` (`pid: pid ?? current.pid`) and logs `session.recorded` (`:1237`). It calls `this.watchTree(id)` at `:1240` when a PID is present.
- Ollama has no PID. Codex Mission launch returns `pid: () => owned?.pid?.() ?? null` (`adapters.server.ts:334`), so the PID appears only after the async compat check spawns the child.
- The PID is persisted in the task row through `update` (`:1236`, and `pid` is exposed by `getSession` at `:1848`).

## 2. Lifetime bookkeeping fields and their consumers

**`treeTimers`** (`manager.server.ts:72`). Per-task timer handle for the process-tree sampler.
- Set in `watchTree` (`:1661-1708`), first tick at 2 s (`:1705`), then every 15 s (`:1694`).
- Each tick calls `readProcesses()` and `descendants(rows, pid)` (`:1666-1669`), then emits `session.process_tree` only when the PID list changes (`:1675-1681`).
- Cleared by `stopTree` (`:1749-1753`).
- Called from `failOperation` (`:213`), after `session.done` (`:1429`), in the `finally` (`:1651`) and from `stop` (`:1768`).
- Consumers: `processTree`/`processTreeAt` (`:1677`, `:1831`) feed the `watchSurvivors` lineage (`:1721`) and the UI (`getSession`, `:1849`).

**`watchSurvivors(id, rootPid, attempt)`** (`manager.server.ts:1714-1748`). Fail-closed survivor tracker for one ended attempt.
- Keyed per attempt object via the `survivorAttempts` WeakSet (`:82`, `:1716-1717`), so a retry never hides an earlier attempt's survivors.
- Sets `lingering[key] = "checking"` synchronously (`:1719`), so there is no gap.
- Stores the attempt's provider/access/mission in `lingeringAttempt` (`:1720`, a `Map` declared at `:84`).
- Builds a lineage from the root and every `processTree` snapshot row (`:1721-1723`).
- `check()` (`:1724-1747`):
  - Calls `readProcesses()`. On failure it retries every 10 s (`:1726`).
  - Keeps rows whose PID is in the lineage and whose birth time matches (`:1728-1732`).
  - Grows the lineage with children whose parent is in the lineage and that were born after the parent (`:1733-1742`).
  - Deletes the entry when nothing is alive (`:1743`), otherwise stores `lingering[key] = alive rows` and re-checks every 10 s (`:1744-1745`).
- Called from the recovery loop after `session.done` (`:1431`) and from the `finally` (`:1654`).
- `survivorWatches` (`:78`) is only a key counter.

**`lingering`** (`manager.server.ts:77`). `Map<key, ProcessInfo[] | "checking">`.
- Its only consumer is `liveCodeExecutions()` in `bunny-missions/manager.server.ts:2737-2739`. Any key counts as live unless the attempt's authority is `tool_free` or `read_tools`. The `"checking"` value also counts as live (fail-closed).
- It is in-memory only and is not rebuilt at startup.

**`lingeringAttempt`** (`manager.server.ts:84`). Provider, access and mission flag of the attempt that left the survivors. Used by `liveCodeExecutions` (`bunny-missions/manager.server.ts:2738-2739`) so a reroute cannot reclassify the survivor.

**`survivorAttempts`** (`manager.server.ts:82`). `WeakSet` of ended session objects already watched (dedup).

**`readProcesses` / `processTable`**:
- `readProcesses` is set at `manager.server.ts:136` to `options.processTable ?? processTable`.
- `processTable()` (`process-tree.server.ts:8-19`) runs `powershell.exe Get-CimInstance Win32_Process` with a 15 s timeout on Windows, and `ps -A` elsewhere. It returns `{pid, ppid, name, createdAt}`.

**`descendants(rows, rootPid)`** (`process-tree.server.ts:25-38`). Returns the root and its descendants, root first. A child counts only if it was not created before its parent. It returns `[]` if the root row is absent, so orphans are never found once the root exits.

**`survivors(before, after)`** (`process-tree.server.ts:41-43`). Filters `before` down to rows that are still the same process (`sameProcessIdentity` against the fresh row).

**`sameProcessIdentity`** (`process-tree.server.ts:46-51`). Requires a valid positive PID, a finite positive `createdAt`, an equal PID and `createdAt`, and a case-insensitive equal name.

**`killProcess(identity)`** (`process-tree.server.ts:61-65`). Guard at `:62` is `!sameProcessIdentity(identity, identity)`, which compares the object with itself. It then calls `windowsOwnershipModule().terminateVerified(pid, createdAt, name)`. The real identity check is in the native module, which revalidates on the held handle. On non-Windows it throws.

**`stopTree`** (`manager.server.ts:1749`). Clears the sampler only. It does not touch `lingering`.

**`liveCodeExecutions`** (`bunny-missions/manager.server.ts:2725-2742`). Definition is in the mission manager, not the host. It returns:
- live `bus.liveCode` entries (capability code runs and git/github actions, `bus.server.ts:331`/`:372`),
- live `tasks.sessions` (`:2730-2735`),
- and lingering survivors (`:2737-2740`).

A session's authority comes from `classify` (`:2726-2728`), which uses `providerSessionAuthority` (`bunny-missions/authorization.server.ts:209-217`):
- ollama is `tool_free`,
- claude `read` is `read_tools`, claude `write` is `shell`,
- codex is `shell`,
- other or missing access is `null` and counts as live.

**Security decisions that consume these (verified):**
- F02 promotion refusal: `bunny-missions/manager.server.ts:2646-2647` calls `liveCodeExecutions()` and throws "Promotion waits: code Bunny tracks is running on this computer...".
- F01 device hold: `remoteMutationHeld` at `bunny-missions/manager.server.ts:2744-2756` calls `liveCodeExecutions()` at `:2753` and returns the "Approval required on Windows Host" message at `:2755`. Its callers are `bunny-missions/manager.server.ts:194` (bus wiring).
- Python verification gate (`codeRunGate`): defined at `bunny-missions/manager.server.ts:193`, consumed at `bunny-host/manager.server.ts:1463-1464`. It is `pendingRemoteReview()` only (unreviewed paired-device changes), NOT `liveCodeExecutions`. A Python check therefore does not wait for running provider sessions.
- Separately, `bunny-missions/manager.server.ts:139` and `:1482-1483` gate session launch on `pendingRemoteReview()`, not on live code.

## 3. Stop paths and their messages

**`stop(id, detail)`** (`manager.server.ts:1754-1840`):
- Rejects an already-ended task (`:1756`, "Task has already ended.") and an in-progress stop (`:1757`).
- Snapshot before stop (`:1762-1764`): `root = session.pid()`, `initial = readProcesses()`, `before = descendants(initial, root)`. The comment at `:1761` says pre-stop observations are evidence only.
- `await session?.stop()` (`:1766`), which is `taskkill /T /F` on the root (`adapters.server.ts:197-199`, `terminate(true)`). It returns early if the child has already exited.
- `stopCleanup` default is `complete`, with zero counters (`:1770-1775`).
- If `root` is set (`:1776`):
  - Fresh table (`:1777`). If `!initial`, `!before.length`, `!fresh`, or any `sameProcessIdentity(row,row)` fails (`:1778-1783`), the status is `ownership_unverified` with the message at `:1787` ("Cleanup ownership unverified: process inspection or lifetime identity is unavailable. Session Stop was requested; no snapshot-based termination was attempted and remaining ownership is unresolved.").
  - Otherwise `alive = survivors(before, fresh)` (`:1789`). Each survivor gets `killProcess(row)` (`:1793`), and failures increment `terminationFailures` (`:1795`).
  - Final verification (`:1798-1806`). A failed final read gives the message at `:1804` ("Cleanup ownership unverified: final process inspection failed...").
  - Otherwise status is `cleanup_incomplete` when `alive.length` or `terminationFailures` is non-zero (`:1808-1812`, message "Cleanup incomplete: N corroborated owned process(es) remain; M identity-checked termination(s) refused or failed.").
  - Otherwise `complete`, with the success message at `:1814`: **"Verified N recorded process lifetime(s) ended; none of the recorded processes remain (DESCRIBE). A process spawned after the last process sample, or not recorded in it, is not tracked."**
- If `root` is null and a session exists, the cleanup text is "No OS process belonged to this session (in-process request)." (`:1817`).
- Emits `task.cleanup_incomplete` when status is not `complete` (`:1818-1819`).
- Final state: `stopped`, `activity` "Stopped" or "Stopped; cleanup incomplete", `stopReason`, `stopCleanup`, `processTree: before` (`:1822-1835`), with event `task.stopped` (`:1833`).
- `finally` removes the `stopping` entry (`:1837-1839`).
- Detail/cleanup text is `detail + cleanup`.

**Observations on `stop`:**
- `:1782` `before.some((row) => !sameProcessIdentity(row, row))` is a self-comparison. It only rejects rows lacking a birth time, name or positive PID. The real identity check is at `:1789` (`survivors`, against fresh) and in the native `terminateVerified`.
- If the root has already exited, `descendants` returns `[]` (`process-tree.server.ts:27`). `before` is empty, so status becomes `ownership_unverified` (`:1779-1780`). Orphaned children of an exited root are never terminated by `stop`.

**`stopInBackground(id, detail)`** (`manager.server.ts:198-209`). Wraps `stop` in `containment.background`. On error it emits `task.stop_failed` "Background Stop failed; inspect the task state." and calls `failOperation`. Callers: runtime-limit timers (`:1339`, `:1408`), thermal policy auto-stop (`:405`), and the mission model-mismatch stop (`bunny-missions/manager.server.ts:1454`).

**`failOperation(id, error)`** (`manager.server.ts:210-221`):
- Returns early if already terminal or in `stopping` (`:212`).
- `stopTree(id)` (`:213`).
- `update(... state: "failed", error, activity: "Failed")`, with event `task.failed` and detail "Unexpected task failure; operation ended without success." (`:214-219`).
- `await sessions.get(id)?.stop()` (`:220`). This is session-level taskkill only. It does NOT run `killProcess` cleanup and does NOT record `stopCleanup`.
- Callers: `flush` guard (`:1252`), recovery-loop HostFatal (`:1436`, `:1479`), containment boundary (`:1646`), `stopInBackground`, and http shutdown.

**Mission stop:** `bunny-missions/manager.server.ts:4217` calls `this.tasks.stop(task.id, detail)` for each live child task.

**UI and HTTP:** `http.server.ts:597` (`manager.stop(text(data.id, 200))`).

## 4. Retry, reroute and escalation loop

All new session starts go through `adapter.launch`, so a change in `spawnSession` covers every one of them.
- Initial launch at `manager.server.ts:1372` (inside `launch`, `:1039`).
- Pre-launch revalidation reroute at `:1095-1123`, followed by the same launch.
- Recovery loop (`:1425-1642`), which awaits `session.done` and classifies the failure (`:1496`).
  - `retry-same` at `:1556-1569` calls `startSession` with the same provider/model.
  - `escalate-effort` at `:1570-1593` raises effort, or falls back to `rerouteFromDecision` (`:1582`).
  - Otherwise `reroute-*` at `:1594-1613` calls `rerouteFromDecision` and `startSession`.
- `startSession` (`:1274-1364`) runs a mission admission check (`:1295-1312`) and then, at `:1350`, `targetAdapter.launch(...)`. It replaces `this.sessions.set(id, nextSession)` (`:1351`). Its runtime timer is at `:1338-1344`.
- A relaunch that fails returns null, which exhausts the candidate (`:1569`, `:1592`, `:1611`).

Each attempt that ends is watched through `watchSurvivors` (`:1431`), so survivors of an earlier attempt stay tracked after a reroute. Non-mission direct tasks can also be rerouted by `startSession` (`mission` check only when `targetTask.mission`).

## 5. Host shutdown and fatal path

**`stopOwnedChildren`** (`owned-processes.server.ts:34-59`):
- Calls every registered owned group stop, then runs `taskkill /PID pid /T /F` for each tracked child, with a 1800 ms timeout (`:42-50`). It does not verify the result.
- Provider children are tracked because `spawnSession` calls `trackOwnedChild` (`adapters.server.ts:208`) and `execOwnedFile` uses it too.
- Its only caller is `http.server.ts:948`.

**Shutdown `close()`** (`http.server.ts:942-976`):
- Line 948 starts `stopOwnedChildren()` (not awaited yet).
- Lines 950-960 call `manager.failOperation(... "Host fatal shutdown interrupted this owned task; no session was resumed.")` when the containment state is `draining` (`:952-957`), and `manager.stop(id, "Host shutdown stopped this owned task.")` otherwise (`:958`), over all `manager.sessions` keys.
- Lines 961-962 close agents and missions. Lines 963-965 await `ownedCleanup` in `finally`. Then the server closes and the DB closes.
- `containment.options.shutdown = close` (`:977`). SIGTERM and SIGINT call `close()` then `process.exit(0)` (`:978-989`).
- Race: `stop` (`:1777`) reads the process table concurrently with the taskkill from `stopOwnedChildren`, so the recorded "cleanup" status can depend on timing.

**HostContainment** (`failure.server.ts`):
- `fatal()` (`:406-470`) sets `operationalState` to `draining`, writes a marker (`:456`), runs `options.shutdown` (`:458`), and calls `exit(70)` on completion or after `shutdownMs` clamped to 50-5000 ms (`:445`, `:443`).
- If shutdown outlasts the timeout, the process exits anyway, and provider processes are not killed by Node.
- `installProcessHandlers` (`:550-575`) routes `uncaughtException` to `fatal` (`:562-567`) and `unhandledRejection` to `contain`. Installed by `entry.server.ts:16`.
- `entry.server.ts:12-22` creates containment, installs handlers, calls `recoverOwnedGitOperations(data)` (`:18`), then `startHost`. A startup error calls `containment.fatal` (`:21`).
- Persistence rollback failure calls `fatal` (`http.server.ts:266`, `:287`). Other persistence failure calls `degrade` (`:268-270`).
- `assertAccepting` (`failure.server.ts:235`) gates new task launch (`manager.server.ts:1045`).
- The recovery-loop HostFatal checks at `:1435` and `:1478` run after `session.done` and before success is recorded.

## 6. Host restart recovery

**Task rows** (`manager.server.ts:144-165`, TaskManager constructor). Every task in `launching`, `running`, `verifying`, `waiting_for_input` or `waiting_for_agent_approval` becomes `failed`. The error is "Host process restarted; this adapter cannot reattach its old pipes. Previous PID retained for diagnosis; no process was killed." (`:158-159`). Event `task.failed`, detail "Host restarted; session recovery unsupported." (`:162-163`). No process is killed and no survivor watcher is restored.

**`recoverOwnedGitOperations`** (`owned-process-group.server.ts:69-80`, called from `entry.server.ts:18`):
- Marks any record still `running` as `interrupted` and closed, and persists it.
- Comment at `:68` says it "NEVER recreate[s] handles or kill[s] PIDs". Git job objects are reaped by kill-on-close when the Host handle closes.

**HostContainment marker** (`http.server.ts:273`, `containment.recoverMarker(false)`). Reads `host-fatal.json` and records lastFatal "old sessions were not resumed" (`failure.server.ts:513-516`). It does not kill anything.

**Mission recovery** (`bunny-missions/manager.server.ts:4592-4745`, `recover()`, called from the constructor at `:345`):
- Ends active batches and marks running capability runs `interrupted` (`:4594-4606`).
- Invalidates one-time approvals (`:4611-4616`).
- Reconciles promotion `PROMOTING` by disk comparison (`:4619-4632`). Staged changes are ended (`:4633-4634`).
- Revokes remote authorization (`:4635-4644`).
- Missions in running/verifying/waiting states: each `running` or `ready` step with a task has its child marked failed with category `host_restart` and detail "...was not resumed. Previous PID ... retained." (`:4720-4745`).

**Agent runtime** (`bunny-host/agent-runtime.server.ts`):
- The construction walk (`:54-55`, `:603-716`) runs after `MissionManager.recover()`. It claims each agent (`:623`), closes an open run as `INTERRUPTED` (`:635-641`), opens a new run (`:645`), classifies interrupted steps (`:646`), and calls `missions.reconcileInterrupted` for the resulting instructions (`:657-658`).
- `reconcileInterrupted` (`bunny-missions/manager.server.ts:4449-4490`) only touches steps failed with `host_restart`. In `resubmit` mode it sets the step back to pending (`:4480-4490`), which relaunches through the normal task path (and so through `adapter.launch`).

**Summary for restart:** after a restart, no survivor tracking, no tree timers and no kill occur. Previous provider PIDs are kept in the record only.

## 7. Types in contracts.ts

- `AdapterResult` (`contracts.ts:55`): `{ ok: boolean; output: string; error?: string; stopped?: boolean; exitCode?: number | null }`
- `AdapterHooks` (`contracts.ts:56-67`): `event`, `session: (sessionId, pid) => void`, `output`, optional `model`, `progress`, `usage`, `rateLimits`, `raw`.
- `RunningSession` (`contracts.ts:68-74`):
  ```ts
  export type RunningSession = {
    stop: () => Promise<void>;
    done: Promise<AdapterResult>;
    /** Root process of the owned session, when there is one. */
    pid?: () => number | null;
    sendInput?: (input: string) => Promise<void>;
  };
  ```
- `ProviderAdapter.launch(task: OrchTask, hooks: AdapterHooks): RunningSession` (`contracts.ts:89`).
- `AgentSession` (`contracts.ts:92-95`) exposes `pid` and `processTree`.
- `ProcessInfo = { pid; ppid; name; createdAt: number | null }` (`bunny-host`'s `orch/types.ts:265`).
- `OrchTask` process fields (`orch/types.ts`): `pid` (`:219`), `processTree` and `processTreeAt` (`:232-233`), `stopCleanup` (`:236`, status `complete | ownership_unverified | cleanup_incomplete`).
- `RunningSession` has no `kill` or identity field. The only process identity lives in `ProcessInfo` and the native handle.

## Notes for F04 (job-object containment of provider sessions)

1. `spawnSession` is the single launch point for codex and claude, and Codex Mission launch wraps it (`adapters.server.ts:326`). The PID is set asynchronously there (`:334`), so a job-object launch must keep the `pid()` contract and the `spawn`-event `hooks.session` call.
2. Current survivor tracking can only follow processes whose ancestry is visible at a 2 s or 15 s sample. Anything spawned and whose parent exits between samples is invisible, and `stop` (`:1762-1764`) only considers descendants of a live root.
3. Shutdown and fatal exit (`http.server.ts:948`, `failure.server.ts:443-445`) can exit before the taskkill pass completes. A kill-on-close job would reap children when the Host handle closes.
4. Restart forgets `lingering`, so the F01/F02 holds see nothing from the previous epoch. A containment design must reconstruct or refuse until old job handles are confirmed dead.
5. Python verification gate (`manager.server.ts:1463`) does not consult live provider sessions. Any F04 change that wants "code running" to block Python runs needs that gate widened to `liveCodeExecutions`.