# Bunny-A M-A-2 process ownership

## T1 maintenance

The migration controller records each owned process before Stop.
The record contains the PID, parent PID, executable, command line and creation time.
The controller checks this identity again before Stop.
A changed identity stops the migration.

Host ownership also requires the saved credential and live instance ID.
Gateway ownership requires the recorded state root and installed server path.
Tunnel ownership requires the pinned worker path and recorded child relationship.
An unknown tunnel owner causes refusal.

The controller does not stop processes by name or port.
The M3 QA server is outside the owned process set.

The real cutover stopped Host PID 9984 and gateway PID 14532 only.
Both used the installed v16 runtime before Stop.
The new Host is PID 2200. The new gateway is PID 42156.
Both use the installed T1 runtime.
M3 QA PID 11020 kept its executable, command line and creation time.
Its creation time is `2026-10-03T03:49:11.7887020Z`.
Island and tunnel processes were absent before migration.
The migration left them absent.

## T4 work (historical T1 checkpoint)

Gate T4 is NOT IMPLEMENTED in this T1 change.
The accepted Git launcher repair remains in place.
The second launcher and hook process ownership need further tests.
Host crash cleanup for hook descendants is NOT TESTED.


# M-A-2 Gate T4

## IMPLEMENTED

Each Windows Git capability operation has its own kernel Job Object. Terminal operations also
use that boundary so a shell-free Node/npm wrapper cannot launch Git outside it. Provider
processes, gateway and Island lifecycle are unchanged. The native x64 Node-API module is built
from repository C source without a new dependency or downloaded binary. `JOB_LIST` associates
the suspended root at creation; membership is verified before resume. The Host holds the sole,
non-inheritable job handle. `KILL_ON_JOB_CLOSE` is set; neither breakaway flag is enabled.
Stop/timeout/normal completion terminate remaining members and close handles. T3 shutdown
uses the live operation registry. There is no Git executable-name-wide or persisted-PID kill.

Operation records under disposable/installed state `runtime/git-operations` hold operation,
Mission, step and capability-run IDs, logical container ID, canonical launcher path, launcher
PID/creation time, observed member PIDs/creation times/images, repo/cwd, action, start/end,
terminal state and exit code. They contain no command/environment secrets or handles.
Restart changes running history to interrupted and never opens/terminates a saved PID.
Actual owned Windows cancellation reports the capability run as stopped; existing injected
runners and non-Windows cancellation retain their accepted behavior. Merge ownership markers,
write locks and refusal of user merges/stale locks are unchanged.

The manifest will include the native C source, build script, generated module and hash/build
record. `native/README.md` describes architecture, API, build flags and the OS boundary.
Missing/bad modules, incompatible job assignment or unsupported architectures fail closed.
The historical M-A-1 PATH-to-worker resolution remains for compatibility; T4 does not depend
on it. Absolute cmd/bin/worker paths and wrapper children receive the same job containment.

## LIVE VERIFIED

Source tests on this Windows workstation prove cmd/bin/mingw64 launchers, real worker images,
normal/sleeping/failing hooks, waiting/nested children, child-exit and detached attempts,
kernel refusal of CREATE_BREAKAWAY_FROM_JOB, Stop, isolated concurrent Missions, bounded
output/timeout, merge success/conflict/Stop cleanup, pre-existing user merge preservation,
Host hard death during commit and merge, no later commit or file-hash mutation, honest restart,
and T3 fatal-exit integration. PIDs/creation times and exact job membership are in
`test-results/ma2-gate4/source/gates.json`. Hard kills use a test Host only; no `/T` is applied
to the Host. An interrupted owned merge stays marked and refuses another merge after restart.

Harmless local SSH, credential and GPG stand-ins time out with their descendants killed;
noninteractive editor invocation is refused. No real credentials or external service is used.
Production remains the installed v17-T3 Host 33068, gateway 33116 and native application 41220;
M3 process 11020 keeps its creation identity. State/schema remain layout 2/schema 3, Missions
and triggers remain off, protected hashes and historical rows match the baseline.

Local regression gates: 546 tests (240 scripts + 285 application + 21 UI), retaining all 521 T3
tests and adding 25 T4 tests. Typecheck passes, lint has zero errors and the same ten prior
warnings; normal build passes. Dev and normal-build desktop/mobile screenshots render with no
console/page errors or overflow. The unchanged Vercel preview TCP-peer limitation truthfully
shows Connection unavailable; the Windows package is checked separately.

Staged `Bunny-A-Windows-v17-T4` packaging and packaged-runtime live tests are PENDING at this
source checkpoint. Do not treat this checkpoint as acceptance; final identities and packaged
proof will be recorded below and in `test-results/ma2-gate4/package-evidence.json`.

## SIMULATED

PID reuse is tested by giving historical ownership the currently live unrelated PID with an
old creation identity. Recovery marks history only; the live process survives. An actual
forced Windows PID reuse cycle is not claimed. Existing controlled T2/T3 injections remain.

## STATIC VERIFIED

The native API accepts only its own live external objects. No restore-by-PID/handle/name API
exists. Handle inheritance is limited to stdio; jobs are unnamed and per operation. Job limit
flags are checked during inspection. PIDs from membership enumeration are reopened only for
diagnostics, then membership of the opened handle is checked. Build reproducibility passes.
Git for Windows 2.55.0.windows.3 cmd/bin launchers and mingw64 worker hashes/paths are in
`git-installation.json`; usr/bin/git.exe is absent (NOT APPLICABLE). Packaging/source closure
checks include native resources and remain compatible with T1/T2/T3 releases.

[Windows jobs](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects) define
ordinary CreateProcess descendants and last-handle closure. WMI-created processes are an
explicit Windows exception: external brokers, elevation, remote execution and existing IDE
processes are not captured or advertised as contained by this job. Jobs do not provide a
security sandbox against arbitrary same-user code attacking the Host. These brokered paths
are not used by Bunny's supported noninteractive Git runtime; this gate claims the kernel
process tree, not ownership of independently brokered services. Helpers requiring breakaway
fail rather than weakening the flags. See native/README.md and the live breakaway proof.

## NOT TESTED

Windows ARM64/x86 or pre-Windows-10 runtime, absent usr/bin launcher, real credential/GPG
providers, elevated/service-broker/remote helpers, forced OS PID reuse, physical power loss
and reboot. No production Git repository or production Host crash was tested. Linux/macOS
behavior is preserved behind the platform guard; a live non-Windows execution is not claimed.

## BLOCKED

Packaged-candidate acceptance remains pending at this source checkpoint. Independent review
is pending. There is no known unresolved BLOCKER/HIGH in the completed local T4 gates.

## DEFERRED

T5-T10, production activation and final independent operational review. No full M-A-2 verdict
is issued. The user's T4 instruction expressly forbids automatic activation.
