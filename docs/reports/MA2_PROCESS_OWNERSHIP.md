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

Final builder checkpoint: 2026-10-04T08:24:01.508Z. T4 candidate is staged/tested only; production
remains the accepted installed T3 release. Earlier sections retain their checkpoint history.

## IMPLEMENTED

Each Windows Git capability, terminal wrapper and GitHub connector operation has its own
kernel-backed OwnedProcessGroup. The minimal x64 Node-API v8 C module creates an unnamed job,
associates the root at kernel creation, checks membership before resume and keeps the sole
non-inheritable job handle in the Host. Stop, timeout and completion terminate remaining members
and close handles; T3 graceful/fatal drain uses the live registry. A hard Host kill closes the
handle in Windows without callbacks. Gateway, Island, provider authority, TaskManager and
MissionManager architecture are unchanged. No executable-name-wide termination was introduced.

Safe state records under runtime/git-operations track operation/Mission/step/capability-run IDs,
logical container ID, canonical launcher path, PID/creation time, observed member images/IDs,
start/end, repo/cwd, action, terminal state and exit code. They contain no argv/environment
secrets or live handles. Restart marks history interrupted without PID lookup or killing.
Actual Windows owned cancellation reports stopped; accepted injected/non-Windows behavior is
retained. Merge ownership markers, write locks, cleanup and user/stale-merge refusal stay intact.
Git and indirect wrapper roots receive noninteractive Git environment controls and bounded I/O.

## LIVE VERIFIED

Source and staged-runtime live gates both pass: 18 each. The packaged entry is the real
`Bunny-Host.mjs`, launched by bundled Node against a disposable production-state snapshot,
workspace, port and token. No test-level global exception/rejection handler replaces T3.
Evidence is in `test-results/ma2-gate4/source/gates.json`, `packaged/gates.json` and
`package-evidence.json`. PIDs, creation times, exact images, job membership and repository
states are recorded. Tests use disposable repositories only.

Stop ends Mission A's launcher, worker, hook and nested children. Its capability, step and
Mission all report stopped. Mission B, raw user Git, unrelated shell/sleeper, installed Host,
gateway, native application and M3 QA retain their exact creation identities. Each operation
has a different container ID. Normal completion closes the job and kills orphan/background
children. Hooks A-F, explicit breakaway refusal, output during termination and timeout pass.

Real status/diff/add/commit/checkout/switch/worktree add/remove and a clean merge pass. A
controlled owned conflict reports conflict and runs the accepted cleanup; Stop during a
slow merge restores clean HEAD and removes only Bunny-owned markers. A pre-existing user
merge survives a read and refused write untouched. Existing same-workspace writer serialization
and stale-lock refusal regressions pass.

Hard termination of the test Host during both commit and merge runs no shutdown callback.
The kernel closes its sole job handle and all observed members disappear. Independent
observation beyond the hook deadline finds unchanged HEAD, no delayed completion marker and
identical whole-repository file hashes. Restart never resumes the old operation: running
history becomes interrupted; capability interrupted, step failed with host_restart, Mission
waiting_for_user. A hard-interrupted merge retains MERGE_HEAD and its Bunny marker/lock;
the next merge is refused without deleting that state. This requires review/recovery, not
silent cleanup. T3 controlled fatal exit drains the operation as stopped and exits 70.

Harmless local SSH, credential and GPG stand-ins are contained; the editor fails noninteractively.
The offline GitHub CLI alias proves gh -> shell -> Git -> hook/child ownership, with its own
temporary config, no token, no API request and no user-config change. Real GitHub API use is
not claimed. The connector's operation roots also use the same ownership mechanism because
[the official CLI Git client](https://github.com/cli/cli/blob/trunk/git/client.go) starts Git
for repository inspection. Provider process authority remains unchanged.

All 547 tests pass: 240 scripts + 286 application + 21 UI. All 521 T3 tests are retained,
26 T4 tests are added, none removed/skipped on this workstation. Typecheck passes; lint has
zero errors and the same ten pre-existing warnings. Normal build and Windows desktop build
pass; DATABASE_URL is unset. Dev, final normal build and final packaged desktop/mobile renders
were visually inspected with clean browser consoles, no page errors and no horizontal overflow.
The unchanged Vercel preview TCP-peer limitation truthfully renders Connection unavailable;
the Windows standalone package connects to its disposable Host and renders Host online.

Production preservation passes: v17-T3 Host 33068, instance
`37ee7306-9511-4115-b261-307f28247efe`, gateway 33116, native application 41220 and M3 QA 11020
retain their creation identities. State root/layout/schema, 54 tasks, 13 projects, nine device
rows, all historical rows and protected T1/native/T2/config/tunnel hashes remain intact.
All 146 installed T3 files and 69 exact source/tooling blobs still verify. Missions/triggers
remain OFF; no production Git operation, model session, Host restart or public-tunnel change.
See `final-preservation.json`, `production-release-verification.json` and `production-source-check.json`.

| Installed canonical executable | Packaged observation | Result |
|---|---|---|
| C:\Program Files\Git\cmd\git.exe | launcher PID 9028 -> worker 13820 -> hook shell/children | LIVE PASS |
| C:\Program Files\Git\bin\git.exe | launcher PID 15512 -> worker 4948 -> hook shell/children | LIVE PASS |
| C:\Program Files\Git\mingw64\bin\git.exe | direct worker/root PID 40924 -> hook shell/children | LIVE PASS |
| C:\Program Files\Git\usr\bin\git.exe | absent in the actual installation | NOT APPLICABLE |

Git for Windows is 2.55.0.windows.3. Exact paths, sizes and hashes are in git-installation.json.
The cmd/bin images spawn a distinct mingw64 worker; the direct worker keeps its root identity.
These statements come from live trees, not filename inference. The historical PATH-to-worker
optimization remains for compatibility; the job mechanism does not depend on it.

| Packaged test | Host PID | Exit | Callbacks | Observed owned members | Recovery |
|---|---:|---:|---|---:|---|
| hard-host-crash | 6492 | 1 | NO | 6, all terminated | interrupted; waiting_for_user |
| merge-hard-host-crash | 17456 | 1 | NO | 5, all terminated | interrupted; waiting_for_user |
| fatal-host-crash | 18272 | 70 | yes | 6, all terminated | stopped; waiting_for_user |

The hard kills use taskkill /PID <test Host> /F without /T. No callback could supply the
descendant termination. The full raw trees/creation times and unchanged file hashes are in
packaged/gates.json; package-evidence.json includes a compact crash-proof inventory.

## SIMULATED

PID reuse is simulated with an old recorded creation identity/handle field and a currently
live unrelated PID. Recovery changes history only; that process survives. No forced Windows
PID-reuse cycle is claimed. Existing controlled T2/T3 injections remain in the full suite.

## STATIC VERIFIED

The native module has three exports: launch, inspect and close. They accept a newly created
root or the module's own live Node external. No restore-by-PID, integer-handle or job-name API
exists. JOB_LIST assigns the root atomically during CreateProcess; it is suspended until
membership is verified. HANDLE_LIST inherits stdio only. Jobs are unnamed, per operation,
with KILL_ON_JOB_CLOSE (0x2000) only; BREAKAWAY_OK and SILENT_BREAKAWAY_OK are absent. Membership
inspection rejects changed limits and rechecks the opened process handle's membership before
recording diagnostic PID/creation time/image. Closing a job never authorizes a kill by saved PID.

Pinned C source, architecture/readme, build script, locally generated module and build/hash proof
are in the release manifest. Two independent builds produce identical module bytes. The
compiler is reviewed local MinGW-w64 GCC 16.1.0; no dependency or opaque prebuilt helper was
downloaded. Imported native libraries are Windows Kernel32/UCRT, with no broad process privilege.
Module/source/proof/manifest checks fail closed before Git starts. Windows x64 and Windows 10+
job-list support are required. Linux/macOS retain the previous path behind the platform guard.

[Windows jobs](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects) contain
ordinary CreateProcess descendants. Independently brokered WMI/elevation/service/remote
processes are a documented Windows exception, not captured or advertised as contained. Jobs
are not a sandbox against arbitrary same-user code attacking the Host. Supported Bunny Git
roots do not request these brokered paths; helpers requesting breakaway fail. External IDE
processes and long-lived user helpers are not adopted. See `native/README.md` for this boundary
and [creation-time job assignment](https://devblogs.microsoft.com/oldnewthing/20230209-00/?p=107812).

## NOT TESTED

Windows ARM64/x86 or pre-Windows-10, absent usr/bin Git, real credential/GPG/SSH services,
real GitHub API operations, elevated/service-broker/remote helpers, physical power loss/reboot,
forced OS PID reuse and live Linux/macOS. Production Git/Host-crash tests were expressly excluded.

## BLOCKED

None in the completed T4 builder gates. There is no known unresolved BLOCKER/HIGH within
the supported T4 process-tree scope. Independent review is pending and is not claimed by the builder.

## DEFERRED

T5-T10, production activation and independent final operational review. The T4 instruction
expressly forbids automatic activation. No BUNNY_MA2_OPERATIONAL_PASS or full M-A-2 verdict is issued.
Builder gate result: **BUNNY_MA2_T4_PASS**.
