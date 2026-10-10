# Process containment reassessment (F01 §7.4 survivor-lineage residual)

**Status:** final. F03 review round 1 had a dedicated containment lens. It confirmed every claim below from the code. Its unclean-Host-exit MEDIUM was refuted 2/2 as a separate finding (the same root cause; covered by the recommended gate). It rejected a process-table scan at promotion as a gate (advisory at most).

## What is contained today (verified by reading the code)

| Launch | Contained in a Windows job? | Where |
|---|---|---|
| Git, `gh`, Mission `terminal.exec` | **Yes.** `OwnedProcessGroup` / `runWindowsOwnedProcess`; job with `KILL_ON_JOB_CLOSE`; no breakaway (the kernel refuses `CREATE_BREAKAWAY_FROM_JOB`). | `src/lib/bunny-host/owned-process-group.server.ts`, `native/bunny-owned-process.c`, `capabilities/local.server.ts`, `process.server.ts` |
| Provider sessions (Codex, Claude), including the Codex Mission session | **No.** Plain `spawn()` children, tracked by PID and parent-PID samples every 15 s. Stop uses `taskkill /T /F`. | `src/lib/bunny-host/adapters.server.ts` (`spawnSession`) |
| Ollama | in-process HTTP (no child process) | `adapters.server.ts` |

## The residual, precisely

`watchSurvivors` (`src/lib/bunny-host/manager.server.ts`) admits a process to a session's lineage only when its parent is already in the lineage. Windows does not reparent orphans. So a grandchild whose intermediate parent exits before the next 15 s sample keeps a parent id that was never recorded, and it is never admitted. Such a process:

- is absent from `liveCodeExecutions()`. That list drives the F01 hold on device writes and F02's refusal to promote while code runs.
- is not killed by Stop (`taskkill /T` walks live parent links only).

The Stop cleanup message said "none remain". **F03 changes it** to say exactly what was verified: none of the *recorded* processes remain, and a process spawned after the last process sample, or not recorded in it, is not tracked. The promotion-wait and device-hold messages now say "code Bunny tracks" (review round 1, containment lens, LOW).

Sampling more often, or sampling synchronously at attempt end, narrows the window but cannot close it. The orphaning can happen between any two samples.

## Effect on the F02/F03 boundary

- A paired-device change never lands in the project while code runs. It is staged in Host-owned storage, and it reaches the project only by a workstation promotion of the exact reviewed bytes.
- The residual can therefore only matter when the owner promotes while an untracked orphan from an earlier workstation-approved session is still running and reading project files. Bunny's promotion-time "code is running" check cannot see that orphan.
- Promotion is still a deliberate owner decision. The promoted bytes are exactly what the owner reviewed, and the review gate (F01) still applies before Bunny runs any later code.

## The robust repair, and why F03 does not ship it

Closing the gap needs job containment for provider sessions:

1. Launch Codex and Claude sessions inside an `OwnedProcessGroup`.
2. Treat "job has active processes" (job accounting `ActiveProcesses`, not the member list) as live code.
3. Close the job on Stop and on Host exit (`KILL_ON_JOB_CLOSE`). This also covers the larger unclean-Host-exit exposure, where plain provider processes keep running untracked today.

This needs a **native helper change and rebuild**:
- the helper currently hard-wires stdin to `NUL`, but providers read their prompt from stdin;
- output must stream over pipes;
- `ActiveProcesses` accounting must be exposed.

It also needs new proof hashes and release-manifest entries, and a behaviour change in how provider output streams. That is a provider-launch rework with regression risk across every provider path, not a narrow authorization-edge fix.

**Recommendation:** a dedicated future gate, "provider-session job containment". It should include the unclean-exit case and the job-accounting liveness signal. The residual stays a disclosed MEDIUM, with the reduced impact described above.
