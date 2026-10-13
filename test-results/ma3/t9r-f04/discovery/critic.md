**Completeness critique, T9R-F04 discovery (read-only, source b693167; I read the code at the cited lines and changed nothing)**

**(a) Missed or wrong in the reports**

1. **Native stdio is file-backed, not pipe-backed.** `native/bunny-owned-process.c:88-89` sets stdin to `NUL` and opens stdout/stderr as file handles from `s[4]`/`s[5]`. The launches report says "buffers into a 200 KB cap" and the manager report does not mention this. A job launch cannot give `spawnSession` the live `stdout` 'data' stream it parses at `adapters.server.ts:218-233`. It would need a file tailer or a different native stream design. The 200 KB cap claim is unverified.
2. **Restart behaviour changes.** `manager.server.ts:158-159` says "no process was killed". With `KILL_ON_JOB_CLOSE` (`native:85`), a Host crash kills provider trees. The manager report treats restart as no-kill throughout. That text, and the Mission restart detail at `manager.server.ts:4720-4745`, become false after F04 and need updating.
3. **Native close blocks on the job drain.** `native/bunny-owned-process.c:46-47` loops on `ActiveProcesses` up to a deadline before `CloseHandle`. Neither report says whether this runs synchronously on the Node thread, which matters for `stop`, `failOperation` and shutdown.
4. **Codex app-server probe is unmentioned by the manager report.** `codex-probe.server.ts:25` is a long-lived `app-server --stdio` plain spawn that uses stdin JSON-RPC. It is outside `sessions` and `liveCodeExecutions`, and it needs stdin too.
5. **Integrity gate is a bypass seam.** `owned-process-group.server.ts:30-37` checks the `.node` and `.c` hashes before any launch. Any new job launcher for providers must reuse that gate, or it becomes a bypass. The harness report's manifest and closure references (`bunny-release.mjs:111-112`, `package-bunny-desktop.ps1:75-80,126`) are consistent with this.
6. **Verification of one unlisted call site.** `failOperation` at `manager.server.ts:220` calls `session.stop()` without `stopCleanup` or identity. This is correctly noted, but it is a second stop path to migrate.

**(b) Contradictions between reports**

- **agentrt vs manager on the 15 s interval.** agentrt says the 15000 values at `manager.server.ts:1694` and `:1889` are stop timeouts, not sampling. I checked: `:1694` is the `containment.background(... tick ...), 15000` sampling interval, so the manager report is right. `:1889` is a 15 s wait for `done` in a helper. agentrt is wrong on `:1694`.
- **Survivor re-check interval.** The task text says 15 s. Both manager and agentrt say 10 s, and the code at `manager.server.ts:1744-1745` and `:1726` confirms 10 s. The task text is wrong.
- **Stop-path line numbers.** The harness report puts `terminate()` "before line 210". It is at `adapters.server.ts:195-200`, and the manager report's line numbers match. This is cosmetic.
- **Uncovered line.** `stopOwnedChildren` at `owned-processes.server.ts:34-58` is cited as 1800 ms and as having one caller at `http.server.ts:948`. I did not read the body or the caller, so these are unverified.

**(c) Ten highest-risk integration seams (file:line)**

1. **Prompt delivery.** `adapters.server.ts:236` writes the prompt to stdin and `:400` ends argv with `-`. `native:88` makes stdin `NUL`. Prompts need argv, a file, or a native stdin pipe.
2. **Output and spawn event.** `adapters.server.ts:214-215` emits `hooks.session` on the async `spawn` event. The native launch is synchronous and does not emit `spawn`. The `pid` for `hooks.session` and the `pid` in `adapters.server.ts:222` must come from `launcherPid` (`owned-process-group.server.ts:113-122`).
3. **Injection seam.** `adapters.server.ts:193` types `spawnChild: typeof spawn`. The only custom-spawn test (`failure.test.ts:513-530`) depends on that type. Any launcher seam changes the signature and breaks that test.
4. **Termination.** `adapters.server.ts:195-200` uses `taskkill /T /F` with a 2 s timeout. `manager.server.ts:1766` and `:220` use the same `session.stop`. Replacing it with `group.close()` (`owned-process-group.server.ts` close path, `native:46-49`) changes timing and the `stopCleanup` result.
5. **Root identity for survivors.** `manager.server.ts:1762` snapshots `root = session.pid()`. `watchSurvivors` (`manager.server.ts:1716-1725`) needs the root's `createdAt` from `processTree`. The launcher's `createdAt` must match what the table sampler records, or lineage fails.
6. **Limit flags.** `owned-process-group.server.ts:116` requires `limitFlags === 0x2000` exactly. Adding ACTIVE_PROCESS, BREAKAWAY_OK, or any other flag fails the launch.
7. **One root per group.** `owned-process-group.server.ts:108` throws on a second `spawn`. Each provider attempt needs its own group, since `manager.server.ts:1350` relaunches (retry, escalate, reroute) through `adapter.launch`.
8. **Async pid in Codex Mission.** `adapters.server.ts:326` and `:334` spawn after an async compat check and return `pid: () => owned?.pid?.() ?? null`. If `pid()` is null, `watchSurvivors` is skipped (`manager.server.ts:1716`), and the liveness gate depends on `sessions` alone.
9. **Liveness and hold consumers.** `manager.server.ts:2725-2742` (`liveCodeExecutions`) feeds the F01 hold (`:2744-2757`) and F02 promotion refusal (`:2646-2647`). A job-sourced liveness input has to be added here. The `"checking"` fail-closed convention must be kept.
10. **Native module and manifest.** `process-tree.server.ts:61-65` uses the same native module for `terminateVerified`. Any change to the `.c` file changes `sourceSha256` (`owned-process-group.server.ts:33`), so the `.node.json` proof, the manifest hash, and `gitProcessOwnershipPolicyVersion` (`:40`) all need rebuilding together.

**Unverified in this pass:** the `stopOwnedChildren` body, the `http.server.ts:948` caller, the codex-probe kill paths, the `native:46` synchronous behaviour, and the 200 KB buffering claim.