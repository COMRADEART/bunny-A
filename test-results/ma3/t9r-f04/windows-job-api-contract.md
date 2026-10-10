# Windows Job Object API contract (T9R-F04)

The research sources and citations are in `discovery/winapi.md`. Each statement below was observed on this workstation (Windows 11 Pro 10.0.26300), unless it is marked as documentation.

## Admission sequence (native `launch`)

1. `CreateJobObjectW(NULL, NULL)` creates an unnamed job. Its handle is not inheritable.
2. `SetInformationJobObject(JobObjectExtendedLimitInformation)` sets **only** `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` (`0x2000`). Neither `BREAKAWAY_OK` nor `SILENT_BREAKAWAY_OK` is ever set.
3. `DuplicateHandle(..., JOB_OBJECT_ASSIGN_PROCESS | JOB_OBJECT_QUERY | JOB_OBJECT_TERMINATE, bInherit=FALSE)` makes a reduced handle, and the original is closed. The Host's handle therefore cannot change the limits. Assignment with this handle works: all T4 Git/terminal tests and every F04 test pass with it.
4. stdio is set up:
   - stdin is `NUL` (Git/terminal), or the read end of a `CreatePipe` anonymous pipe (provider prompt).
   - stdout and stderr are client ends of Host pipe servers.
   - These are the only inheritable handles, listed through `PROC_THREAD_ATTRIBUTE_HANDLE_LIST`.
5. `PROC_THREAD_ATTRIBUTE_JOB_LIST = [job]` (Windows 10+) plus `CreateProcessW(CREATE_SUSPENDED | CREATE_NO_WINDOW | EXTENDED_STARTUPINFO_PRESENT)`. The kernel associates the process with the job **during creation**. There is no spawn → discover PID → attach window.
6. `IsProcessInJob(process, job)` must be TRUE. Otherwise the suspended process is terminated, all handles are closed, and the launch fails (`BUNNY_JOB_FAILED`).
7. The Group (job handle, root handle, PID) is registered and wrapped in a Node external.
8. `ResumeThread`. A failure terminates the job.
9. Provider prompt only: a Host thread writes the copied bytes to the pipe, then closes it. The child sees EOF.

## Observed semantics

| Question | Observed |
|---|---|
| `CREATE_BREAKAWAY_FROM_JOB` from a direct member | refused, `ERROR_ACCESS_DENIED` (5): `provider-containment.test.ts` J16 |
| Breakaway when the immediate job is permissive (libuv's nested job inside a Node provider) | `CreateProcess` succeeds, but the child **stays in Bunny's job** (the hierarchy stops at the first job that disallows breakaway). Live: `breakawayAttempts[].memberOfBunnyJob = true`. |
| A member creates its own job with `BREAKAWAY_OK \| SILENT_BREAKAWAY_OK` and its children break away | the children remain members of Bunny's job (J16/J17 test, live `silentChildrenRecordedInJob = 2`) |
| Orphans (parent exits first) | still members; killed by job termination or closure (J15) |
| Detached (`DETACHED_PROCESS \| CREATE_NEW_PROCESS_GROUP`) | still members (J18) |
| `ActiveProcesses` after a member exits while the Host holds its handle | 0. Exited processes are not counted and do not appear in the member list (`run3` experiment). |
| `TerminateJobObject`, then accounting | reaches 0 at once in all observed runs. The code still bounds the wait at 1.5 s and retries. |
| Host hard death (`taskkill /F` of the Host) | the kernel closes the Host's handles, and `KILL_ON_JOB_CLOSE` ends every member (J35 test; live about 0.9 s). |

## What jobs do not prove

Jobs prove process-lifetime grouping of **members** only. They do not:
- sandbox the filesystem or network;
- prevent privileged operating-system operations;
- capture brokered launches (WMI `Win32_Process.Create`, Task Scheduler, services, COM local servers and surrogates, shell hand-off to an already running Explorer, the UWP activation broker, WSL VM processes);
- contain remote hosted providers or already running daemons;
- defend against deliberately hostile same-user or elevated code that targets the Host process itself.

Authorization (T5, F01–F03) decides whether anything runs at all.
