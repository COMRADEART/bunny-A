# MA4-S3-T3R1 — Real Execution Architecture

## 1. Architectural Philosophy: The Deterministic Execution Boundary

In unified multi-agent systems, language models serve as semantic synthesis and analytical engines; they must never serve as authorization or verification oracles.

Bunny A enforces a strict bifurcation between two distinct concepts:
1. **Semantic Analysis:** A model (Planner, Worker, Reviewer, or Tester) may inspect requirements, synthesize code patches, critique test results, or explain failure logs. Model outputs are strictly labeled as advisory or material data.
2. **Deterministic Execution:** The Bunny A Host kernel executes validated system commands, monitors OS processes via low-level handles, observes exit codes, captures standard I/O byte streams, and calculates cryptographic digests. Only deterministic execution can issue an execution receipt (`receipt:test-exec:...` or `receipt:file:...`).

```
+-------------------------------------------------------------------------+
|                              Host Kernel                                |
|  +-----------------------+                    +-----------------------+ |
|  |   Task Coordinator    |                    |  Approval Controller  | |
|  | - Role Assignment     |                    | - Consequential Gate  | |
|  | - Bounded Lifecycle   |                    | - Exact SHA-256 Check | |
|  +-----------+-----------+                    +-----------+-----------+ |
+--------------|--------------------------------------------|-------------+
               |                                            |
       [Step Execution]                             [User Approval]
               v                                            v
+-----------------------------+             +-----------------------------+
|    Model Provider Bridge    |             |  Constrained Test Runner    |
| - Local Ollama (Pinned)     |             | - Allowlisted Executables   |
| - Exact Model & Digest      |             | - Argument Array Containment|
| - Fenced Untrusted Input    |             | - Job Object & Tree Cleanup |
| - Temperature 0 / Predict   |             | - Exit Code Observation     |
|                             |             | - SHA-256 Digest Receipts   |
+-----------------------------+             +-----------------------------+
               |                                            |
      [Semantic Material]                          [Deterministic Evidence]
               \                                           /
                v                                         v
          +----------------------------------------------------+
          |           Unified Task Execution Record            |
          |  - SQLite Persistent Task Store                    |
          |  - Verified Receipts vs Advisory Analysis          |
          +----------------------------------------------------+
```

---

## 2. Core Execution Components

### 2.1 The Constrained Test Runner (`test-runner.server.ts`)
The test runner is a dedicated, secure subsystem within the Host:
- **Project Root Containment:** The execution working directory must resolve within an explicitly registered project root (`resolveRoot(projectId)`). Directory traversals (`..`), symbolic links, or UNC shares attempting to escape the registered directory fail closed.
- **Executable Allowlist:** Only approved executables are permitted (`node`, `npm`, `npx`). Explicit path resolution validates executable existence before process launch.
- **No Shell Interpolation:** Commands are executed via `child_process.spawn` using sanitized argument arrays. Shell interpreters (`cmd.exe`, `powershell.exe`, `sh`) are strictly excluded, preventing argument concatenation and command-injection vulnerabilities.
- **Process Tree Lifetime Management:** On Windows, process tracking ensures child processes and detached workers are terminated upon completion, timeout, or cancellation.
- **Bounded Output Buffering:** Standard output and standard error are captured with strict size ceilings (1 MiB default). Output exceeding the bound triggers truncation flags and fails verification.
- **Report Validation:** If a task specification specifies `reportFile`, the runner computes the SHA-256 digest of the captured report artifact and verifies its presence.

### 2.2 Task Runtime & Dependency Injection (`task-runtime.server.ts`)
The `PersistentTaskRuntime` manages task persistence and step evaluation:
- Injected with `RuntimeDeps`, including `executors`, `call` (Ollama provider interface), `modelAvailable`, `resources` (memory floor check), and `resolveRoot`.
- The execution context (`StepContext`) exposes `resolveRoot` to all executors, allowing `localTest` to locate files on disk while retaining complete sandbox containment.
- State transitions (`QUEUED` -> `RUNNING` -> `WAITING_APPROVAL` -> `COMPLETED`/`FAILED`/`CANCELLED`) are persisted atomically into SQLite.

### 2.3 Refactored `localTest` Executor (`task-executors.server.ts`)
The `local.test` executor implements the verification boundary:
1. Validates inputs (`subjectFrom`, `testFile`, `criteria`, `command`, `reportFile`).
2. Resolves project root and verifies target file presence.
3. Invokes `runConstrainedTest()`.
4. If the process exits with a non-zero code or fails to launch, the step immediately fails with `fatal: "STEP_FAILED"`.
5. If and only if the process exits with code 0:
   - Computes SHA-256 hashes of stdout, stderr, and generated report artifacts.
   - Generates a verified execution receipt: `receipt:test-exec:<executionId>:<hash>`.
   - Optionally dispatches real output to the pinned model for semantic analysis (structured test summaries), labeled strictly as `modelAnalysis`.
