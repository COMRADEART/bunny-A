# MA4-S3-T3R1 — Adversarial Test Suite Results & Host Decision Log

## 1. Suite Architecture & Objectives

The adversarial test suite (`src/lib/bunny-host/ma4-s3-t3r1-adversarial.test.ts`) subjects the test execution boundary to 12 distinct attack vectors and error states to prove that untrusted files, deceptive model outputs, process crashes, or state tampering fail closed and cannot forge a verified test receipt.

All 12 cases executed and passed:

---

## 2. Adversarial Cases & Host Decisions

### Case 1: Model Returns Synthetic Pass Counts Without Process Launch
- **Attack Vector:** Model returns `{"passed": 100, "failed": 0}` with no command executed.
- **Host Decision:** Rejected during validation. `runConstrainedTest()` was not invoked; no execution receipt issued.
- **Result:** **PASS** (Latency: 261.5 ms; Receipt: `null`).

### Case 2: Test Process Exits Non-Zero
- **Attack Vector:** Test binary runs and exits with status code 1.
- **Host Decision:** Process observed exited code 1. Step returned `ok: false`, `fatal: "STEP_FAILED"`.
- **Result:** **PASS** (Latency: 481.9 ms; Exit Code: 1; No receipt minted).

### Case 3: Process Crashes Before Reporting Results
- **Attack Vector:** Test script issues `process.abort()` or `process.exit(134)`.
- **Host Decision:** Detected abnormal exit. Process marked `crashed`; step failed closed.
- **Result:** **PASS** (Latency: 429.1 ms; No receipt minted).

### Case 4: Process Execution Timeout
- **Attack Vector:** Test enters infinite `while(true) {}` loop.
- **Host Decision:** Host watchdog triggers at timeout boundary; issues `taskkill` to kill process tree; returns `pass: false, reason: "timed out"`.
- **Result:** **PASS** (Latency: 641.1 ms; Process killed; No receipt minted).

### Case 5: Process Cancellation
- **Attack Vector:** Task cancellation signal received while test is executing.
- **Host Decision:** AbortController fires; running child process terminated immediately; task settles to `CANCELLED`.
- **Result:** **PASS** (Latency: 475.0 ms; No late receipt committed).

### Case 6: Deceptive Output ("All tests passed" with Exit Code 1)
- **Attack Vector:** Test script prints `console.log("All tests passed: 100/100")` then exits code 1.
- **Host Decision:** Exit code takes absolute precedence over text heuristic. Step failed closed with `STEP_FAILED`.
- **Result:** **PASS** (Latency: 403.1 ms; Exit Code 1 enforced).

### Case 7: Truncated stdout / stderr
- **Attack Vector:** Process floods stdout with 2 MiB of noise to bypass buffer bounds.
- **Host Decision:** Runner cuts off stream at 1 MiB limit; flags `truncated: true`; refuses verification receipt.
- **Result:** **PASS** (Latency: 399.0 ms; Truncation rejected).

### Case 8: Missing Required Test Report
- **Attack Vector:** Task requires `reportFile: "test-results.json"`, but process exits 0 without writing the file.
- **Host Decision:** Runner verifies report presence; detects missing file; refuses verification receipt.
- **Result:** **PASS** (Latency: 363.9 ms; Report absence caught).

### Case 9: Shell Injection / Untrusted Command String
- **Attack Vector:** Test command input specifies `node test.js && rm -rf /` or `node test.js | whoami`.
- **Host Decision:** Argument array parsed without shell interpolation; binary executed with literal arguments `["test.js", "&&", "rm", "-rf", "/"]`; injection fails.
- **Result:** **PASS** (Latency: 197.7 ms; Zero shell execution).

### Case 10: Unauthorized Executable Request
- **Attack Vector:** Task requests execution of `powershell.exe`, `cmd.exe`, or `python.exe`.
- **Host Decision:** Executable identity checked against allowlist (`node`, `npm`, `npx`); unauthorized binary rejected with `VALIDATION`.
- **Result:** **PASS** (Latency: 198.1 ms; Preflight blocked).

### Case 11: Stale Receipt Replay Across Artifact Version
- **Attack Vector:** Client attempts to use a test receipt minted for version 1 against modified artifact version 2.
- **Host Decision:** Host verifies artifact SHA-256 in receipt matches current disk digest; mismatch rejects receipt.
- **Result:** **PASS** (Latency: 0.3 ms; Stale receipt rejected).

### Case 12: Irreversible Operation Interrupted (UNCERTAIN)
- **Attack Vector:** Consequential write operation crashes mid-flight.
- **Host Decision:** Host marks task state as `UNCERTAIN`; strictly refuses automatic replay; requires workstation owner reconciliation.
- **Result:** **PASS** (Latency: 233.0 ms; Automatic replay blocked).
