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
