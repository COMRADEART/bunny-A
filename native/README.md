# Windows owned process group

`bunny-owned-process.c` is an x64 Node-API v8 module compiled locally by
`node scripts/build-owned-process.mjs`. The reviewed compiler on this workstation
is MSYS2 UCRT64 MinGW-w64 GCC 16.1.0. Set `BUNNY_NATIVE_CC` to another reviewed local
MinGW-w64 compiler to reproduce a build; no executable/module is downloaded.
Windows 10+ job-list creation support is required. Unsupported architecture,
missing module, bad hashes or incompatible enclosing jobs fail before Git runs.

The job exports are `launch`, `inspect` and `close`. `launch` accepts an exact
executable, quoted argv, cwd, Unicode environment block and two local output
pipe names. It returns a Node external wrapping an owned job and process handle.
Neither other exports nor restart accept PIDs, integer handles or job names.
The stable Node-API C declarations are resolved from the running `node.exe`,
without V8/C++ ABI linkage or a third-party Node dependency.

`terminateVerified` supports supplemental Task Stop after a successful fresh
process inspection. It requires the observed PID, exact creation time and image
name, opens one non-inheritable process handle, checks its lifetime/image, and
terminates that same handle. An integer PID alone is refused. A failed inspection
never calls it. Historical snapshots remain diagnostic evidence. This path does
not reconstruct job ownership or change Git's held job handle semantics.

The Host holds the sole non-inheritable handle of an unnamed job. Its only limit
is `KILL_ON_JOB_CLOSE`. `JOB_LIST` associates the root at kernel creation time;
it is suspended until membership is checked. `HANDLE_LIST` inherits only NUL
stdin and the stdout/stderr handles. Descendants inherit membership. Explicit
and silent breakaway are disabled. Host hard death closes the handle in the
kernel; no supervisor, polling parent PID or shutdown callback provides that
guarantee. Normal completion kills remaining descendants as well as closing
handles. Inspect rechecks membership of each opened process handle before
reporting PID/creation time; those values are evidence only.

## Provider sessions (M-A-3 T9R-F04)

Codex and Claude sessions and provider probes use the same job helper. `launch` takes an
optional seventh argument, a Buffer that is the provider prompt. The helper copies it, creates an
unnamed anonymous pipe, lets the root inherit only the read end (through `HANDLE_LIST`), and a Host
thread writes the bytes after `ResumeThread` and then closes the pipe. No pipe name exists to
squat or read. After the limits are set, the Host keeps a duplicate job handle with only
`ASSIGN_PROCESS | QUERY | TERMINATE`. Through that handle, `KILL_ON_JOB_CLOSE` and the absence of
breakaway cannot be changed. `inspect` reports kernel accounting (`ActiveProcesses`,
`TotalProcesses`). `terminate` calls `TerminateJobObject` and returns the current `ActiveProcesses` at once,
without waiting on the Host thread. The Host polls every 100 ms for up to 30 s, then retries with backoff.
It keeps the handle, so an unconfirmed termination stays observable. `close` still waits up to 1.5 s before
dropping the handle (T4 Git semantics). Provider sessions close only at zero.
When the root exits, the session terminates its whole job. Descendants never outlive the session,
including those whose parent had already exited. A session ends as "empty" only on
`ActiveProcesses = 0`, never because a process sample lacked a row. On Windows, a containment
failure refuses the session. There is no fallback to an unowned spawn.

Restart never reopens a job. Interrupted provider-session records
(`runtime/provider-sessions`) are checked against the current process table by PID, creation
time and image. An unknown birth time counts as possibly alive, and an empty table read is a failed read.
A live identity is held as live code and reported for review. Nothing is killed. An absent identity
is recorded as `absent_after_restart`, not as kernel-verified `empty`: once the job dies with its
Host, no kernel accounting exists. Unreadable records, and records without any identity, are
listed for review. Unreadable records are also held as live code. Host verification runs (Python)
execute in their own jobs and count as live code while open.

Explicitly outside the job: requests to already-running services (Ollama HTTP, the user's daemons,
IDE or COM servers), brokered launches (WMI, Task Scheduler, services, shell hand-off to an
existing Explorer, WSL VM processes), and remote hosted execution. A deliberately hostile
same-user or elevated process that targets the Host itself is also outside this contract. The
jobs are lifetime ownership, not a sandbox. Authorization (T5, F01-F03) still decides whether
anything runs.

Link flags retain ASLR/NX and use a fixed preferred image base, no linker
timestamp and stripped local symbols. Two independent output directories must
produce identical bytes (`scripts/owned-process-build.test.mjs`). The module's
JSON build record contains C source/module/compiler hashes, architecture,
Node-API version and flags. The desktop packager compiles the pinned archive,
packages C source, build script, module and record, and hashes every resource in
the release manifest. Runtime verifies those hashes before loading the module.
Imports use only Windows Kernel32 and OS Universal CRT libraries.

Jobs are a process-lifetime grouping primitive, not an OS security sandbox.
External service brokers (for example WMI `Win32_Process.Create`), elevation,
remote execution or requests to existing IDE/service processes do not become
descendants in this job. The supported Git path does not itself request those
brokered launches. It must not claim ownership of them or kill them. Arbitrary
same-user native code able to attack the Host is outside this containment
contract; provider authority is unchanged in T4.

References: [Node-API](https://nodejs.org/api/n-api.html),
[Windows jobs](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects),
[CreateProcessW](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-createprocessw),
[process attributes](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-updateprocthreadattribute).
[Creation-time job assignment](https://devblogs.microsoft.com/oldnewthing/20230209-00/?p=107812)
explains why the job-list attribute closes the suspended-process assignment gap.
