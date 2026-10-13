# Native helper design (T9R-F04)

F04 extends the existing reviewed helper (`native/bunny-owned-process.c`, Node-API v8, MinGW-w64 GCC 16.1.0, reproducible build) and does not replace it. It adds no new process, service, scheduler or monitor.

## Changes

| Area | Before (T4–F03) | F04 |
|---|---|---|
| `launch` arity | 6 (stdin = `NUL`) | 6 or 7. The seventh argument is a Buffer (at most 64 MiB) used as the provider prompt. |
| stdin | `NUL` | Unnamed `CreatePipe`. The child inherits only the read end. A Host thread writes the copied bytes after `ResumeThread`, then closes its end. |
| Job handle | `JOB_OBJECT_ALL_ACCESS` | Duplicated to `ASSIGN_PROCESS \| QUERY \| TERMINATE` once limits are set, so the limits cannot be changed afterwards |
| Membership failure | close handles | also `TerminateProcess` on the still-suspended root before the handles close |
| `inspect` | limits, members, exit code | adds `activeProcesses`, `totalProcesses`, `totalTerminatedProcesses` (kernel accounting) |
| `terminate` | — | new. `TerminateJobObject`, then a bounded wait (at most 1.5 s) for accounting to reach 0; returns the count and **keeps** the handle |
| `close` | returns `null` | returns `{ activeProcesses }` measured before `CloseHandle` |
| Writer thread | — | It owns its pipe end and buffer and never touches the Group. `close_group` waits up to 1.5 s, then `CancelSynchronousIo`, then waits 0.5 s. A broken pipe ends it as soon as the readers die. |

These stay unchanged:
- `JOB_LIST` creation-time assignment;
- `CREATE_SUSPENDED` with the membership check before `ResumeThread`;
- `HANDLE_LIST` stdio-only inheritance;
- `KILL_ON_JOB_CLOSE` as the only limit;
- no PID, integer-handle or name entry points;
- `terminateVerified` semantics;
- the Kernel32 and UCRT import set;
- reproducible flags;
- the hash-pinned load (`.node.json` proof, release manifest).

## TypeScript layer

- **`OwnedProcessGroup`**:
  - `spawn(..., input?)`;
  - `terminate()`;
  - `annotate()`;
  - `live`;
  - records now carry provider identity (task, Agent, Mission, session, provider, Host generation), kernel accounting and the containment state. Provider records live in `runtime/provider-sessions` and Git records in `runtime/git-operations`.
- **`containedSession`** (`adapters.server.ts`): the provider session state machine `launching → running → terminating → empty | unconfirmed`, or `refused`.
- **`TaskManager`**:
  - `stopContained`;
  - `watchContainedJob`, which keeps live code until the job is empty;
  - `reconcileInterruptedProviderSessions` (restart).
- **Release policy**: the packager sets `compatibility.providerProcessContainmentPolicyVersion = 1` when the pinned source carries the F04 helper. A packaged runtime refuses to load the helper without it.
