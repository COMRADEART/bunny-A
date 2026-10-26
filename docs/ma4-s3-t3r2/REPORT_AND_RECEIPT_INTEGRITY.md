# MA4-S3-T3R2: Test Report and Verification Receipt Integrity

**Product:** Bunny A by LOKAM  
**Milestone:** MA4-S3-T3R2 — Security Boundary Closure, Execution Containment & Production Qualification  
**Target:** Cryptographic Binding, Stale Evidence Prevention, and Fact-Based Receipt Verification  

---

## 1. Executive Summary

In autonomous agent systems, a critical failure mode is the conflation of **model speculation** with **operating system facts**. If an agent can fabricate a test report, reuse a stale report from a previous passing run, or if a model verdict is allowed to override an actual non-zero exit code, the integrity of the entire verification loop collapses.

MA4-S3-T3R2 hardens the test reporting and receipt issuance pipeline in `src/lib/bunny-host/ma4/test-runner.server.ts` and `task-executors.server.ts`. Every execution receipt issued by Bunny A represents an immutable, tamper-evident record backed by physical operating system observations.

---

## 2. Seven Mandatory Test Report Invariants

Before any test report is accepted as evidence for a step or task, it must satisfy seven strict validation gates:

```
                      +---------------------------------------+
                      |         Raw Report Candidate          |
                      +---------------------------------------+
                                          |
          [1. Boundary Check]             v
       Is path within root?       --> NO  --> REJECT (Path Traversal / Escape)
          [2. Symlink/Junction]           | YES
       Is it a reparse point?     --> YES --> REJECT (Reparse Point Prohibited)
          [3. Freshness Check]            | NO
       Was mtime updated after launch?--> NO  --> REJECT (Stale Report Inherited)
          [4. Bounded Size]               | YES
       Is size <= 1MB?            --> NO  --> REJECT (Payload Exceeds Bound)
          [5. Schema Conformance]         | YES
       Valid JSON / TAP structure?--> NO  --> REJECT (Malformed Report)
          [6. Non-Zero Tests]             | YES
       Did it execute > 0 tests?  --> NO  --> REJECT (Zero Assertions Executed)
          [7. Cryptographic Hash]         | YES
       SHA-256 bound to receipt?  --> YES --> ACCEPT (Verified Fresh Report)
```

### Detailed Invariant Definitions

1. **Path Containment & Root Ownership**:
   The report file path (`reportFile`) must resolve strictly within the canonical project root registered with the Host. Any path containing `..`, drive specifiers (`C:`), UNC prefixes (`\\`), Windows device identifiers (`NUL`, `CON`), or 8.3 short paths (`~1`) is rejected prior to execution.
2. **Reparse Point Immunity**:
   The report file and its parent hierarchy are inspected via `fs.lstatSync`. If any segment is a symbolic link or directory junction, execution is aborted.
3. **Temporal Freshness (Staleness Protection)**:
   Before launching the test runner, the Host records the baseline state of `reportFile` (existence and modification timestamp `mtimeMs`). After process termination:
   - If the file did not exist prior to launch, it must exist now with an `mtimeMs >= launchTime`.
   - If the file existed prior to launch, its `mtimeMs` must be strictly greater than the pre-launch timestamp.
   - If the timestamp did not advance, the report is rejected as **inherited stale evidence**.
4. **Bounded Size Enforcement**:
   The report file size is strictly capped at `MAX_TEST_REPORT_BYTES = 1024 * 1024` (1 MB). Oversized files trigger immediate refusal to protect against disk exhaustion or JSON parsing denial-of-service.
5. **Schema Conformance**:
   If a JSON report is specified, it must parse without error and match expected root structures (e.g., test result summaries, suite status).
6. **Non-Zero Assertion Requirement**:
   A zero exit code from a test runner is **insufficient** on its own. For instance, Node's test runner returns exit code 0 when zero tests are matched (`ℹ tests 0`). Bunny A scans the output and report; if zero assertions were executed, the run is flagged as invalid:
   ```typescript
   if (/ℹ\s*tests\s+0\b/.test(rawOutput) && testCount === 0) {
     return {
       ok: false,
       terminalState: "failed",
       failureReason: "Zero test assertions executed; empty test suite cannot pass"
     };
   }
   ```
7. **Execution Identifier & Cryptographic Binding**:
   The SHA-256 digest of the raw report content is computed immediately after capture and indelibly stamped onto the Host execution receipt (`reportSha256`). Any subsequent tampering with the file on disk invalidates the receipt.

---

## 3. Separation of Model Interpretation vs. Host Execution Facts

Bunny A maintains an unyielding architectural partition between what the model says and what the operating system did:

| Domain | Model Analysis Layer | Host Verification Layer (Truth Engine) |
| :--- | :--- | :--- |
| **Authority** | Advisory only; cannot issue receipts or mutate system state | Absolute; records hardware and OS observations |
| **Evidence** | Free-form reasoning, repair suggestions, diff previews | Process PID, exit code, execution duration, SHA-256 hashes |
| **Override Power** | **ZERO**: Cannot claim "pass" if process exited with non-zero code | Governs task state: non-zero exit code forces `STEP_FAILED` |
| **Receipt Issuance**| Prohibited | Signs receipts with Host private key / internal timestamp |
| **Report Selection**| Prohibited | Resolved exclusively from Host-registered canonical paths |

### The Verification Receipt Contract

```typescript
export interface TestExecutionReceipt {
  receiptId: string;           // "receipt:test-exec:<uuid>"
  taskId: string;              // Bound task ID
  stepId: string;              // Bound step ID
  executable: string;          // Canonical executable path
  args: string[];              // Exact argument vector executed
  exitCode: number;            // Actual OS exit code
  terminalState: "completed" | "failed" | "aborted" | "timed_out";
  durationMs: number;          // Wall-clock execution time
  stdoutSha256: string;        // Hash of bounded stdout
  stderrSha256: string;        // Hash of bounded stderr
  reportSha256: string | null; // Cryptographic hash of test report
  testCount: number;           // Verified executed test count
  passedCount: number;         // Verified passing test count
  failedCount: number;         // Verified failing test count
  timestamp: string;           // ISO 8601 creation timestamp
}
```

---

## 4. Adversarial Verification Test Matrix

The integrity of test reports and verification receipts was validated through an automated adversarial test suite (`ma4-s3-t3r2-reports-receipts.test.ts`):

```
+-------------------------------------------------------------------------------+
|                       REPORT & RECEIPT ADVERSARIAL MATRIX                     |
+-------------------------------------------------------------------------------+
| Test Case                                    | Mechanism Tested    | Verdict  |
+----------------------------------------------+---------------------+----------+
| Stale report from previous run rejected      | mtime check         | PASS     |
| Traversal in reportFile rejected             | Path containment    | PASS     |
| Symlink in report destination rejected       | Reparse point guard | PASS     |
| Oversized report (> 1MB) rejected            | Bounded size cap    | PASS     |
| Exit code 0 with zero tests executed rejected| Non-zero assertions | PASS     |
| Non-zero exit code forces failure            | Strict exit code    | PASS     |
| Model verdict cannot override failing process| Fact-over-model     | PASS     |
| Report from another project rejected         | Registered root ID  | PASS     |
| Tampered report content invalidates receipt  | SHA-256 verification| PASS     |
| Aborted task generates cancelled receipt     | Cancellation guard  | PASS     |
+----------------------------------------------+---------------------+----------+
```

### Detailed Case Descriptions

- **Stale Report Rejection**: A pre-existing passing `report.json` was left in the project directory before running a failing test. The test runner detected that the file timestamp was not updated by the current process and refused to read the stale content, correctly failing the step.
- **Empty Suite Rejection**: A test file containing no test assertions (`describe("empty", () => {})`) ran under `node --test`. Although Node exited with code 0, Bunny A detected `0 tests executed` and marked the execution as failed.
- **Receipt Cryptographic Binding**: A valid receipt was verified using `verifyTestReceipt()`. The underlying report file on disk was then altered by 1 byte. Re-verification immediately failed with `REPORT_HASH_MISMATCH`.

---

## 5. Conclusion

By enforcing temporal freshness, root containment, bounded sizes, non-zero assertion thresholds, and cryptographic report binding, Bunny A eliminates report forgery, stale-result reuse, and false positives in automated agent workflows.
