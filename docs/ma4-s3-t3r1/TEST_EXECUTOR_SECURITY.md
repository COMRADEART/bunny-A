# MA4-S3-T3R1 — Test Executor Security & Isolation Controls

## 1. Threat Model & Adversarial Posture

When autonomous or collaborative agents generate code and request execution of test suites, the test executor becomes an attack surface for privilege escalation, sandbox escape, resource exhaustion, and remote code execution.

Bunny A enforces a zero-trust model towards all test specifications:
1. **Model Generated Specifications:** Any tool call or test execution request authored by an LLM is treated as untrusted data.
2. **Untrusted Working Directories:** Files in the repository may contain malicious build scripts, poisoned environment variables, or symlink chains designed to escape the project directory.
3. **Execution Masking:** Tests that intentionally output "All tests passed" while exiting with non-zero return codes or crashing.

---

## 2. Security Controls & Implementation Details

### 2.1 Executable Whitelisting & Identity Verification
- Only explicit, trusted executables are admitted: `node`, `npm`, `npx`.
- Requests for system interpreters (`cmd.exe`, `powershell.exe`, `bash`, `wscript.exe`, `certutil.exe`) or arbitrary user binaries are rejected during preflight validation (`fatal: "VALIDATION"`).
- Executables are resolved to absolute disk paths using system search paths (`PATH`), and non-existent binaries fail closed before launch.

### 2.2 Shell Immunity (No String Interpolation)
- In legacy or naive test runners, commands such as `npm test -- $INPUT` or `node file.js && rm -rf /` permit command chaining via `;`, `&`, `|`, or backticks.
- Bunny A's `runConstrainedTest()` tokenizes command specifications into an executable identity and an argument array:
  ```ts
  const [cmdBin, ...rawArgs] = command.split(/\s+/);
  ```
  Execution is dispatched via `spawn(resolvedExe, finalArgs, { shell: false })`.
- Arguments containing shell control characters (`&`, `|`, `;`, `>`, `<`, `` ` ``) are passed verbatim as parameters to the target binary; the OS kernel never interprets them as control operators.

### 2.3 Strict Filesystem Containment & Working Directory Guard
- The execution working directory is validated against registered project roots:
  ```ts
  const resolvedWorkingDir = resolve(targetWorkingDir);
  const normalizedRoot = resolve(projectRoot);
  if (!resolvedWorkingDir.startsWith(normalizedRoot)) {
    return { launched: false, pass: false, reason: "Working directory traversal outside project root" };
  }
  ```
- Any argument attempting path traversal (`..\..\Windows\System32`) is rejected during path normalization.

### 2.4 Environment Isolation & Redaction
- The spawned child process receives a scrubbed environment (`cleanEnv`).
- Sensitive environment variables (including Host session tokens, cloud API keys, SSH keys, and parent process authentication headers) are scrubbed before spawn.
- Host configuration environment variables are blocked:
  - `BUNNY_HOST_TOKEN`, `BUNNY_API_KEY`, `AUTH_SECRET`, `SESSION_SECRET` are never propagated to test runners.

### 2.5 Resource Bounding & Timeout Enforcers
- **Timeout Bound:** Every test execution enforces a strict timeout (default 30,000 ms, configurable up to 120,000 ms).
- **Graceful & Forceful Termination:** If the timeout expires, the runner triggers `SIGTERM` followed by `SIGKILL` (or `taskkill /T /F` on Windows) to terminate the entire process hierarchy.
- **Output Bounding:** Buffers are capped at 1 MiB. Any process flooding standard output to exhaust Host memory is cut off with an immediate `truncated: true` flag and marked as failed.

### 2.6 Windows Process Tree Cleanup
- Windows child processes frequently survive parent process termination if detached.
- The runner tracks process IDs and dispatches process-tree termination commands (`taskkill /pid <PID> /T /F`) upon cancellation, timeout, or unexpected termination, preventing zombie processes and locked file handles.
