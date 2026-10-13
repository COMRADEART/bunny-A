# Provider process ownership: threat model (T9R-F04)

## Assets

The two assets are the Host's **claim** that a provider session's local processes have ended, and the decisions that depend on that claim:
- the F01 paired-device mid-run hold,
- the F02 promotion refusal ("code Bunny tracks is running"),
- Stop and Host-shutdown truthfulness,
- restart reconciliation.

## Adversaries and failure sources in scope

1. **A provider or its tools behave normally but untidily.** They start helpers, shells, build tools, background or detached processes, or nested trees whose parents exit first. This is the primary F03 residual (Failure A).
2. **Model-directed code tries to outlive the session** using the standard Windows creation flags: `CREATE_BREAKAWAY_FROM_JOB`, `DETACHED_PROCESS`, new process groups, or nested jobs it creates itself that allow breakaway.
3. **The Host terminates unexpectedly** through a crash, `TerminateProcess` or a fatal exit (Failure B).
4. **PID reuse** between recording and restart, or processes with the same name or a provider-like command line.
5. **Containment failure at launch**: native integrity mismatch, missing compiler output, an incompatible enclosing job, access denied, or `CreateProcess` failure. All of these must refuse; none may degrade.

## Out of scope (documented, not claimed)

- **Brokered launches** (WMI, Task Scheduler, services, COM servers, shell hand-off, UWP broker, WSL VM processes). They run outside the job because a different process creates them. Bunny does not claim them, kill them or report them as contained. Authorization decides whether code that could do this ever runs.
- **Remote hosted providers and already-running shared services** (Ollama). They have no Bunny-owned local worker.
- **Deliberately hostile same-user or elevated code that attacks the Host process itself**, for example by obtaining a duplicate of the Host's job handle. This is the existing T4 contract boundary. Jobs are lifetime grouping, not a sandbox.

## Controls

| Threat | Control | Test |
|---|---|---|
| Orphans or short-lived processes escape sampling | Kernel membership from creation (`JOB_LIST`); membership is inherited; accounting replaces sampling | J11–J15, J45 |
| Breakaway | No breakaway limit is set; the handle cannot change limits; the hierarchy stops at Bunny's job | J16, J17, live |
| Uncontained start window | `CREATE_SUSPENDED` + `JOB_LIST`; membership verified before `ResumeThread` | J03, J04, J06 |
| Containment failure degrades to plain spawn | `containedSession` has no fallback; static test forbids `spawn`, `exec` and `taskkill` in it | J05, J21–J25 |
| Unclean Host exit | `KILL_ON_JOB_CLOSE`; in-process helper; no handle shared with members | J35, live abrupt |
| False "stopped" | Stop reports kernel `ActiveProcesses`; unconfirmed keeps the handle and holds live code | J29, J44 |
| PID reuse on restart | Identity = PID + creation time + image; restart never kills | J32, J37 |
| Unrelated or user processes killed | Termination only through the session's own job handle; no name, PID or table authority | J26, J30, live |
