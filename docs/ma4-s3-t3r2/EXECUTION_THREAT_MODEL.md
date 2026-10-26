# MA4-S3-T3R2 — Execution Threat Model & Dataflow Analysis

## 1. Threat Model Overview & Security Objectives

Bunny A's agent execution environment operates on a multi-agent model (Planner, Worker, Tester, Reviewer) where model outputs and project workspace contents interact with the Host execution kernel. 

The primary security objective is: **Security failures must be fixed at the operating system and Host trust boundary, never concealed by model system prompts, post-hoc string checks, or optimistic test scripts.**

Specifically:
- Untrusted model output or project file content must NEVER gain execution authority.
- A caller-provided filesystem path must never bypass envelope verification.
- Arbitrary code execution (via Node evaluation flags, module preloads, or shell wrappers) must be prevented.
- Verification receipts must reflect verified Host measurements only.

---

## 2. Comprehensive Attack Surface & Input Audit

Based on the audit of:
- `src/lib/bunny-host/ma4/test-runner.server.ts`
- `src/lib/bunny-host/ma4/task-executors.server.ts`
- `src/lib/bunny-host/ma4/task-runtime.server.ts`
- `src/lib/bunny-host/ma4/task-runtime.ts`
- `src/lib/bunny-host/ma4/connected-actions.server.ts`
- `src/lib/bunny-host/ma4/action-broker.server.ts`
- `src/lib/bunny-host/ma4/task-store.server.ts`
- `src/lib/bunny-host/manager.server.ts`
- `src/lib/bunny-host/owned-processes.server.ts`
- `src/lib/bunny-missions/capabilities/process.server.ts`

The following 11 vectors identify where agent-controlled or untrusted input influences execution:

| Vector | Untrusted / Agent Input Point | Affected Subsystem | Risk / Exploit Mechanism | T3R2 Hardening Boundary |
| :--- | :--- | :--- | :--- | :--- |
| **1. Root Selection** | `input.rootPath` vs `input.root` in `task-executors.server.ts` | `local.test` | Passing `rootPath` directly bypassed envelope checking (`grants.files`) and allowed arbitrary directory target execution. | **Eliminated raw `rootPath`.** Step input must accept only registered root ID `root`. Validated against `grants.files`, Host registry, and project scope. |
| **2. File Paths** | `input.testFile` in `local.test` | `test-runner.server.ts` | Traversal (`..`), symlinks, Windows junctions, or UNC paths escaping the project root. | **Unified File Scope Walk.** Path parsed into safe segments, every directory lstat'd, links/reparse points/devices/8.3 names rejected; realpath matches walked path. |
| **3. Executable Identity** | `input.command` in `local.test` | `test-runner.server.ts`, `process.server.ts` | Allowlisting names `node`, `npm`, `npx` alone allowed arbitrary binaries or PATH spoofing. | **Strict Execution Modes.** Mode A restricts to Node with locked argument template. Mode B requires registered owner-authorized project profile. PATH resolution verified with `process.execPath`. |
| **4. Executable Arguments** | `args` or command tokens in `local.test` | `test-runner.server.ts` | Node evaluation flags (`-e`, `--eval`, `-p`, `--require`, `--import`, `--loader`) allow running arbitrary scripts without review. | **Argument Template Lockdown.** Only safe flags (`--experimental-strip-types`, `--test`) permitted. All code evaluation, preload, profiling, and debugging flags strictly refused. |
| **5. Working Directory** | `cwd` in `spawn` / `executeDeterministicTest` | `test-runner.server.ts` | Escaping project root via junctioned cwd or relative resolution. | Working directory strictly anchored to canonicalized, verified Host-registered root path. |
| **6. Environment Variables** | `process.env` in `spawn` | `test-runner.server.ts` | Injection of `NODE_OPTIONS`, `PYTHONPATH`, auth tokens, API keys. | **Strict Environment Sanitization.** Strip all credential keys (`*KEY*`, `*TOKEN*`, `*SECRET*`, `*AUTH*`, `*PASSWORD*`) and hook variables (`NODE_OPTIONS`). |
| **7. Subprocess Creation** | Child processes spawned by test code | `owned-processes.server.ts`, `native/bunny-owned-process.node` | Tests spawning detached background daemons, crypto miners, or network servers. | **Windows Job Object Containment.** `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`, breakaway forbidden (`PROC_THREAD_ATTRIBUTE_JOB_LIST`), handle inheritance restricted (`PROC_THREAD_ATTRIBUTE_HANDLE_LIST`), verified teardown. |
| **8. Network Access** | Outbound connections by test code | OS Network Stack | Unsandboxed Node test scripts making HTTP/socket calls to internal metadata services or exfiltration endpoints. | Evaluated in Phase 3. Job Objects cannot block IP networking; fail-closed policy for untrusted code, Mode B owner authorization required. |
| **9. Test Report Selection** | `input.reportFile` in `local.test` | `test-runner.server.ts` | Reusing stale reports from earlier runs or pointing to files outside the project root. | **Report Freshness & Containment.** Report path must be contained in root; file mtime/hash must prove creation/update during current execution; bounded size (<= 1 MB). |
| **10. Task Approval** | Consequential file edits / actions | `task-runtime.server.ts`, `action-broker.server.ts` | Plan tampering or approval reuse across runs. | SHA-256 payload binding; approval spent upon step success; never carried over to future runs. |
| **11. Verification Receipts** | `receipt:test-exec:...` generation | `test-runner.server.ts`, `task-executors.server.ts` | Model generating fake pass receipts or asserting 0 discovered tests as PASS. | Receipts issued ONLY by Host execution kernel upon exit code 0, non-truncated output, fresh report verification, and SHA-256 digest hashing. |

---

## 3. Trust Boundary Dataflow Diagram

```
+----------------------------------------------------------------------------------------------------+
|                                    WINDOWS WORKSTATION (HOST)                                      |
|                                                                                                    |
|  [USER-AUTHORIZED INPUTS]                                                                          |
|  • Owner Project Registration (FileRootRegistry: id, canonical path)                               |
|  • Task Specification & Envelope Grants (Envelope: projectScopes, grants.files, models, budgets)   |
|  • Exact Consequential Action Approvals (payloadSha256, expiration TTL)                            |
|                                                                                                    |
|                                               │                                                    |
|                                               ▼                                                    |
|  +──────────────────────────────────────────────────────────────────────────────────────────────+  |
|  |                                  HOST TRUST BOUNDARY KERNEL                                  |  |
|  |                                                                                              |  |
|  |  [TRUSTED HOST INPUTS & CHECKS]                                                              |  |
|  |  1. Task Envelope Authorization Gate (EnvelopeSchema & Grant verification)                   |  |
|  |  2. Root Identity Validation (FileRootRegistry.get(root) ∩ envelope.grants.files)            |  |
|  |  3. Path Containment Walk (Walked directory components, symlink & junction rejection)        |  |
|  |  4. Strict Execution Mode Dispatch:                                                         |  |
|  |     • Mode A: Verified Test Target (Node.js locked template: --experimental-strip-types)    |  |
|  |     • Mode B: Owner-Authorized Project Profile (pre-reviewed executable & arguments)         |  |
|  |  5. Environment Sanitization (Removal of NODE_OPTIONS, tokens, secrets)                       |  |
|  |  6. Process-Tree Containment (Windows Job Object: KILL_ON_JOB_CLOSE, No Breakaway)           |  |
|  |  7. Deterministic Output Capture (bounded buffer, exit code verification)                    |  |
|  |  8. Report Freshness & Schema Audit (mtime > start, hash check, size limits)                 |  |
|  |  9. Cryptographic Receipt Minting (receipt:test-exec:executionId:stdoutHash)                |  |
|  +──────────────────────────────────────────────────────────────────────────────────────────────+  |
|                                │                                                ▲                  |
|                 Task Step &    │                                                │ Host Facts Only  |
|                 Gated Inputs   │                                                │ (Exit code,      |
|                                ▼                                                │  Output Hashes,  |
|  +──────────────────────────────────────────+                  +────────────────┴───────────────+  |
|  |        ISOLATED PROCESS EXECUTION        |                  |         MODEL INFERENCE        |  |
|  |                                          |                  |                                |  |
|  |  [UNTRUSTED PROJECT CONTENT]             |                  |  [MODEL OUTPUT]                |  |
|  |  • Project test code (test.js / test.ts) |                  |  • Code synthesis (Worker)     |  |
|  |  • Captured stdout / stderr              |─────────────────▶|  • Semantic review (Tester)    |  |
|  |  • Test report output (report.json)      |   (Data Only)    |  • Non-authoritative analysis  |  |
|  |  • Operating system return code          |                  |  • Model CANNOT mint receipts  |  |
|  +──────────────────────────────────────────+                  +────────────────────────────────+  |
|                                                                                                    |
+----------------------------------------------------------------------------------------------------+
```

---

## 4. Key Architectural Invariants

1. **Input Disarming:** Model-generated strings and project-supplied paths are treated as untrusted data. They never become filesystem roots, executable paths, or command shells.
2. **Fail-Closed Grants:** If a root identifier is missing, unrecognized, ungranted in the envelope, or outside the project scope, the step fails immediately with `PERMISSION_DENIED` or `VALIDATION`.
3. **No Default Fallbacks:** The runtime will never select the "first available" root if none is specified.
4. **Receipt Segregation:** The model role `Tester` is strictly restricted to semantic evaluation of captured evidence. Only the Host test runner can issue an execution receipt.
