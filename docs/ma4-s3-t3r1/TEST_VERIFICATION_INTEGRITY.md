# MA4-S3-T3R1 — Test Verification Integrity & Deterministic Receipts

## 1. The Verification Defect & Root Cause Analysis

### Prior Behavior (Pre-T3R1)
In previous prototypes, `local.test` accepted model-generated assertions or JSON payloads. If a model returned:
```json
{ "passed": 100, "failed": 0, "detail": "All unit tests succeeded." }
```
the Host could mark the test step as `COMPLETED` and issue an artifact receipt even though:
- No test runner process ever launched.
- No files were executed.
- The tests in the project could have been completely failing or non-existent.

Similarly, in text-matching heuristics, if stdout contained "0 failing" or "All tests passed", a synthetic pass could be reported even if the process exited with code 1 (for example, due to an unhandled rejection during cleanup).

### Root Cause
Conflation of semantic test analysis (interpreting test results) with deterministic process verification (observing kernel execution facts).

---

## 2. The T3R1 Acceptance Rules (The Six Golden Conditions)

Under MA4-S3-T3R1, a test execution step is marked `PASS` and granted a verified test receipt (`receipt:test-exec:...`) if and only if all six of the following conditions are simultaneously met:

| # | Acceptance Rule | Enforcement Mechanism | Failure Mode |
| :--- | :--- | :--- | :--- |
| **1** | **Authorized Process Launch** | Host validates executable against allowlist (`node`, `npm`, `npx`) and spawns directly without shell. | If executable not allowed or missing: `launched: false`, `fatal: "VALIDATION"`. |
| **2** | **Terminal State Reached** | Process reaches known terminal state (`exited`). | If crashed, killed, or orphaned: `terminalState: "crashed" / "signaled"`, `pass: false`. |
| **3** | **Exit Code Observed** | Process exit code is captured directly from OS `exit` event. | If exit code is `null` or unobserved: `pass: false`. |
| **4** | **Exit Code Equals Zero** | Process return code must be exactly `0`. | Non-zero exit code (e.g. `1`): `pass: false`, `fatal: "STEP_FAILED"`. |
| **5** | **Criteria & Report Verification** | Required report file exists, is non-empty, and its SHA-256 hash matches captured bytes. | Missing report file: `pass: false`, `reason: "Report file missing"`. |
| **6** | **Receipt Persistence** | Receipt string `receipt:test-exec:<id>:<hash>` is minted from stdout/stderr hashes and persisted to SQLite. | Without receipt, no downstream step can verify completion. |

---

## 3. Separation of Receipts from Model Commentary

When tests execute successfully (exit code 0):
1. **Host Deterministic Output:**
   ```json
   {
     "passed": 1,
     "failed": 0,
     "exitCode": 0,
     "detail": "Deterministic test execution succeeded. Exit code: 0.",
     "executionId": "test-1792986699990-ee6f0de6",
     "receipt": "receipt:test-exec:test-1792986699990-ee6f0de6:3e205d42748276e6dd6214a0d5dbdc95ebcb3ccb80845038b931f91b7bf4f93c",
     "stdoutSha256": "4a765798935c754d922306dfef1356bb39f041ff36de0dc3a1050a996cd936ec",
     "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
   }
   ```
2. **Model Analysis Output (Optional):**
   If the Tester role is assigned a model pin, the Host feeds the real stdout and stderr to the model for semantic explanation. The resulting commentary is placed strictly under a nested `modelAnalysis` key:
   ```json
   {
     "modelAnalysis": {
       "passed": 1,
       "failed": 0,
       "detail": "Test calculator.test.js passed all 3 arithmetic assertions."
     }
   }
   ```
   Downstream coordinator logic checks `exitCode === 0` and `Boolean(receipt)`, never `modelAnalysis.passed`. Model analysis cannot override an exit code 1 or create a receipt.
