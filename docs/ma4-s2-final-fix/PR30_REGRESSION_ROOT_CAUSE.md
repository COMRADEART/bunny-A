# PR #30 Hosted Regression Root Cause & Remediation (`MA0R2` & `T3`)

**Task:** `MA4-S2-FINAL-FIX` — Critical Fix A  
**Affected PR:** PR #30 (`ma4-s2-t4-release-packaging`)  
**Failed Hosted Run:** `https://github.com/COMRADEART/bunny-A/actions/runs/40123966574` (Job `66941276714`, Windows `windows-latest`)

---

## 1. Failure A1 — `MA0R2: read replan revokes old approval and new approval spawns the same Codex isolation`

### 1.1 Exact Failure Signature
- **File:** `src/lib/bunny-host/execution-scope.test.ts:225`
- **Assertion Failure:**
  ```text
  AssertionError [ERR_ASSERTION]: replan cannot reuse the old approval
  0 !== 1
  ```
- **Context:** After approving a single-step `Research` mission (`m1.steps[0]` -> `task_1`), the test calls `missions.replan(m1.mission.id)` which creates a replacement step (`m1.steps[0]` replaced by new step ID) and submits a new pending child task (`task_2`). The test then approves the replanned mission (`missions.approveMission(m1.mission.id)`) and waits up to 200 iterations (`2,000 ms`) for the fake Codex CLI script (`fake-cli.mjs`) to write a second invocation record to `logPath` (`readCalls(logPath).length >= 2`). On the Windows runner, `readCalls(logPath).length` remained `1`, causing `readCalls(logPath).slice(1).length` to evaluate to `0 !== 1`.

### 1.2 Forensics & Root Cause Analysis
Tracing the lifecycle from `approveMission` -> `schedule` -> `launchModel` -> `tasks.approveDelegated` -> `CodexAdapter.launch` -> `containedSession` -> `OwnedProcessGroup.spawn` revealed **three interacting defects**:

1. **Named-Pipe IOCP Accept/Drain Race in `OwnedProcessGroup` (`src/lib/bunny-host/owned-process-group.server.ts`):**
   - On Windows, `containedSession` (`src/lib/bunny-host/adapters.server.ts:323`) launches the Codex child process inside a Windows Job Object (`OwnedProcessGroup.spawn`) with two named pipe servers (`out` and `err` created by `outputPipe()`).
   - Inside `native/bunny-owned-process.c`, `CreateFileW` opens the client ends of `\\.\pipe\bunny-owned-<uuid>` synchronously and spawns `node.exe fake-cli.mjs`.
   - `fake-cli.mjs` writes its JSON event line (`{"type":"item.completed",...}\n`) to stdout and exits in `< 15 ms`.
   - `containedSession` polls `group.inspect()` on a `25 ms` `setInterval`. When `snapshot.exitCode !== null` fires in libuv's **timers phase** (before libuv's **I/O poll phase** has processed the IOCP completion for the named-pipe `ConnectNamedPipe` accept or the pipe read), `closePipes()` immediately invoked `server.close()`.
   - Because `sockets.size` was still `0` (`connected === false`), `server.close()` closed the listening pipe handle before libuv accepted the client connection, discarding the child process's stdout (`output === ""`), or causing `settled` to hang/fail.
2. **Un-contained Survivor Polling Spawning `powershell.exe Get-CimInstance Win32_Process` (`src/lib/bunny-host/adapters.server.ts` & `src/lib/bunny-host/manager.server.ts`):**
   - In `CodexAdapter.launch` (`src/lib/bunny-host/adapters.server.ts:442`), `containedSession` was only selected when `Boolean(task.mission && scope.access !== "write")`. Even when `containedSession` was used, `TaskManager.watchSurvivors` (`src/lib/bunny-host/manager.server.ts:2077`) checked `session.containment ? this.watchContainedJob(...) : ...`. When `watchSurvivors` fell back to `this.readProcesses()`, each completed task spawned `powershell.exe Get-CimInstance Win32_Process` (`1,200–2,500 ms` per call on Windows), saturating CPU/process creation during `execution-scope.test.ts` and delaying the replanned step beyond the test window, as well as leaving background `lingering` timers active after the test finished because `missionFixture.cleanup()` did not call `tasks.dispose()`.
3. **Defense-in-Depth Stale Authorization & Replan Step Enforcement (`src/lib/bunny-host/manager.server.ts` & `src/lib/bunny-missions/manager.server.ts`):**
   - In `TaskManager.approve` / `TaskManager.approveDelegated` (`src/lib/bunny-host/manager.server.ts:1544`), `this.missionScopeCheck?.({ ...final, approval }, "launch")` now receives the attached `approval` record and validates both:
     - `task.approval?.authorizationId && task.approval.authorizationId !== envelope.id` -> `"stale mission authorization"`
     - `!planSteps.includes(step.id)` -> `"step replaced by replan"`
   - Additionally, in `MissionManager.launchModel` (`src/lib/bunny-missions/manager.server.ts:1798`), if `approveDelegated` synchronously transitions a task to a terminal state before `runningTaskIds` is updated on the step, `finishModelStep` is explicitly scheduled so the mission step never hangs in `running`.

### 1.3 Implemented Fix & Negative Security Test
- **[owned-process-group.server.ts](file:///C:/Users/allam/Documents/new/bun-router-s2-remediation/src/lib/bunny-host/owned-process-group.server.ts):** Track pipes opened by `this.native.launch` in `spawnedPipes`. In `outputPipe().close()`, when `wasSpawned` is true, wait (bounded `1,500 ms`) for libuv's IOCP poll phase to accept the pipe client socket and drain to EOF (`connected && sockets.size === 0`) before closing the pipe server.
- **[adapters.server.ts](file:///C:/Users/allam/Documents/new/bun-router-s2-remediation/src/lib/bunny-host/adapters.server.ts):** Flush any trailing non-newline `buffer` after `closePipes()` in `containedSession`, and use `containedSession` for all Windows Mission sessions (`process.platform === "win32" && Boolean(task.mission)`).
- **[manager.server.ts](file:///C:/Users/allam/Documents/new/bun-router-s2-remediation/src/lib/bunny-host/manager.server.ts) & [manager.server.ts (missions)](file:///C:/Users/allam/Documents/new/bun-router-s2-remediation/src/lib/bunny-missions/manager.server.ts):** Pass `{ ...final, approval }` into `missionScopeCheck("launch")`, enforce that `task.approval.authorizationId === envelope.id` and that the step belongs to `mission.plan.steps`, and schedule `finishModelStep` if a synchronous terminal transition occurred during `approveDelegated`.
- **[execution-scope.test.ts](file:///C:/Users/allam/Documents/new/bun-router-s2-remediation/src/lib/bunny-host/execution-scope.test.ts):** Call `tasks.dispose()` in `missionFixture.cleanup()` and add the negative security test `MA0R2: stale approval from before replan cannot authorize old or new step execution`, proving that:
  1. Approving the pre-replan task with the revoked pre-replan `authorizationId` fails closed (`mission is not running`) with zero provider spawns.
  2. Even after the mission is re-approved under a new `authorizationId`, attempting to launch the replaced pre-replan task with the old `authorizationId` fails closed (`stale mission authorization`) and attempting to launch the new task with the old `authorizationId` also fails closed (`stale mission authorization`).

---

## 2. Failure A2 — `T3: real source entry contains process rejection and exception without a test global handler` (`EPERM` on `rmSync`)

### 2.1 Exact Failure Signature
- **File:** `src/lib/bunny-host/failure.test.ts:932`
- **Error:**
  ```text
  Error: EPERM: operation not permitted, rmdir 'C:\Users\runneradmin\AppData\Local\Temp\bunny-t3-process-...'
      at rmSync (node:fs:1247:18)
      at failure.test.ts:932:9
  ```

### 2.2 Forensics & Root Cause Analysis
1. **Un-awaited Background Health Check Child Processes in `CapabilityBus` (`src/lib/bunny-missions/capabilities/bus.server.ts` & `connectors.server.ts`):**
   - `runHostEntry` calls `startHost`, which constructs `new MissionManager(...)`.
   - `MissionManager` constructor calls `this.activate()`, which fires `this.bus.refreshHealth()` in the background (`containment.background`).
   - `refreshHealth()` invokes `GitHubCapability.health()`, which on Windows spawns `gh auth status --hostname github.com` inside a Windows Job Object (`runWindowsOwnedProcess`).
   - Twenty milliseconds after `runHostEntry` resolves, the test triggers an unhandled rejection / uncaught exception, which invokes `containment.fatal(...)` -> `close()` (`src/lib/bunny-host/http.server.ts:2270`).
   - In `http.server.ts:2276`, `stopOwnedChildren()` was called at the **start** of `close()`, before `await missions.close()`, and `CapabilityBus.close()` neither aborted `GitHubCapability`'s in-flight `health()` check nor awaited `this.refreshingHealth`. Consequently, `gh` could be spawned *after* `stopOwnedChildren()` ran and still be active or writing records when `process.exit(70)` terminated the child Host.
2. **Process Exit vs. Handle Release Timing in `failure.test.ts`:**
   - `failure.test.ts:918` listened for `child.once("exit", ...)` rather than `child.once("close", ...)`, and immediately called `rmSync(directory, { recursive: true, force: true })` with `maxRetries: 0` while Windows kernel handles (`host.sqlite-wal`, `host.sqlite-shm`, `fixture.mjs`) were still completing asynchronous kernel handle teardown.

### 2.3 Implemented Fix
- **[connectors.server.ts](file:///C:/Users/allam/Documents/new/bun-router-s2-remediation/src/lib/bunny-missions/capabilities/connectors.server.ts):** Track in-flight `AbortController`s in `GitHubCapability.healthControllers` and abort them in `GitHubCapability.close()`.
- **[bus.server.ts](file:///C:/Users/allam/Documents/new/bun-router-s2-remediation/src/lib/bunny-missions/capabilities/bus.server.ts):** Track `refreshingHealth: Promise<void> | null` and `closed: boolean` in `CapabilityBus`; in `CapabilityBus.close()`, set `this.closed = true`, close all adapters, and `await this.refreshingHealth` so no background capability health check outlives `missions.close()`.
- **[http.server.ts](file:///C:/Users/allam/Documents/new/bun-router-s2-remediation/src/lib/bunny-host/http.server.ts):** Call `await stopOwnedChildren()` again in the `finally` block of `close()` after `missions.close()` completes.
- **[failure.test.ts](file:///C:/Users/allam/Documents/new/bun-router-s2-remediation/src/lib/bunny-host/failure.test.ts):** Wait for `child.once("close", ...)` in `T3`, call `tasks.dispose()` in `harness.cleanup()`, and use `cleanDirectory(directory)` with bounded retries (`maxRetries: 25, retryDelay: 100`) followed by explicit verification `assert.equal(existsSync(directory), false)` so cleanup never suppresses `EPERM` and fails hard if the directory is not removed.
