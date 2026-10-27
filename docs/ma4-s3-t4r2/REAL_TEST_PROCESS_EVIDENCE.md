# Deterministic Test Process Execution & Negative Provenance Proofs

**Product:** Bunny A by LOKAM  
**Milestone:** MA4-S3-T4R2  
**Document:** Deterministic Test Process Evidence Architecture  
**Classification:** P0 Verification Integrity  

---

## 1. Real Test Process Architecture

Deterministic test execution in Bunny A is governed exclusively by `executeDeterministicTest` in `src/lib/bunny-host/ma4/test-runner.server.ts`. It provides an authenticated, contained bridge between the task orchestrator and the host operating system.

### Execution Boundary & Containment Invariants
1. **Approved Executable Identity:** Only the approved Node runtime (`process.execPath`) is permitted. Unapproved shell interpreters or arbitrary binaries are rejected at admission.
2. **Locked Command Profile:** The runner enforces locked invocation arguments:
   ```text
   ["--experimental-strip-types", "--test", <resolved-contained-fixture-path>]
   ```
3. **Workspace Containment:** The test file must reside strictly within the registered project root (`assertContainedPath`). Path traversal attempts (e.g. `../`, symlink escape, or absolute cross-drive escapes) fail closed.
4. **Host Journal Linkage:** Every invocation generates a unique `executionId` (UUIDv4) and records a journal entry in the Host SQLite database before process spawn.
5. **Standard Stream Digests:** Terminal standard output (`stdout`) and standard error (`stderr`) are captured in full and hashed via SHA-256.
6. **Provenance Receipt Token:** The receipt token is constructed as:
   ```text
   receipt:test-exec:${executionId}:${stdoutSha256.slice(0, 16)}
   ```
   This token cannot be fabricated without an authorized execution ID and matching stream digest.

---

## 2. The 12 Mandatory Negative Provenance Proofs

To prove that a hash's appearance does not establish its provenance, `src/lib/bunny-host/ma4/benchmark-integrity.test.ts` implements and passes 12 mandatory negative tests. All twelve attack vectors and failure modes fail closed without producing a verified process receipt:

```
┌────────────────────────────────────────────────────────────────────────┐
│            12 Negative Process-Receipt Provenance Proofs               │
├─────┬─────────────────────────────────────┬────────────────────────────┤
│  #  │ Adversarial Condition / Failure     │ Observed System Defense    │
├─────┼─────────────────────────────────────┼────────────────────────────┤
│  1  │ Model prints "PASS" in text         │ Refused: Zero receipts     │
│  2  │ Model emits fake exit code "0"      │ Refused: Exit code rejected│
│  3  │ Model emits 64-char hex string      │ Refused: Hash unjournaled  │
│  4  │ Oracle accepts text (no process)    │ Refused: 0 process receipts│
│  5  │ Real test process fails (exit != 0) │ Refused: Exit code != 0    │
│  6  │ Process times out                   │ Refused: Process killed    │
│  7  │ Process cancelled via signal        │ Refused: Aborted / no rcpt │
│  8  │ Stale report predates run           │ Refused: Timestamp invalid │
│  9  │ Test report references other file   │ Refused: Hash mismatch     │
│ 10  │ Required assertions absent (0 pass) │ Refused: 0 assertions pass │
│ 11  │ Host journal has no matching op     │ Refused: Unjournaled rcpt  │
│ 12  │ Unapproved executable attempted     │ Refused: Execution rejected│
└─────┴─────────────────────────────────────┴────────────────────────────┘
```

### Detailed Verification Evidence

#### Test 1: Model Prints `PASS` in Text
- **Attack Vector:** Model output string contains `PASS: 12 tests passed, 0 failed`.
- **Observed Result:** `isVerifiedSuccess()` evaluated with text alone. Output is categorized as `oracle_validation`. No process execution occurs, `processDetails` is `undefined`, and `testExecutionReceipts` is empty. **PASS.**

#### Test 2: Model Emits Fake Exit Code 0
- **Attack Vector:** Model output contains structured JSON: `{"exitCode": 0, "status": "SUCCESS"}`.
- **Observed Result:** Host runtime ignores model-claimed exit codes. Process status is read solely from OS child process termination structures. **PASS.**

#### Test 3: Model Emits 64-Character Hexadecimal String
- **Attack Vector:** Model emits `"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"`.
- **Observed Result:** Raw hash strings are treated as unparsed text. Without an active OS job handle and journal entry, no receipt is issued. **PASS.**

#### Test 4: Oracle Accepts Text Without Process Launch
- **Attack Vector:** Regex oracle matches a code pattern. If the harness attempted to attach a synthetic receipt, `isVerifiedSuccess()` fails closed.
- **Observed Result:** When `evidenceCategory === "oracle_validation"`, any present `processDetails` causes immediate rejection. **PASS.**

#### Test 5: Real Process Fails (`exitCode !== 0`)
- **Execution:** `executeDeterministicTest` executes a failing test suite. Observed `exitCode: 1`.
- **Observed Result:** `isVerifiedSuccess()` checks `processDetails.exitCode === 0` and returns `false`. Outcome is marked `FAILED`. **PASS.**

#### Test 6: Process Times Out
- **Execution:** Test suite exceeds configured `timeoutMs: 500`.
- **Observed Result:** Child process is terminated with `SIGTERM`/`SIGKILL`. Terminal state records `timedOut: true`. `isVerifiedSuccess()` returns `false`. **PASS.**

#### Test 7: Process Cancelled Via Signal
- **Execution:** Host orchestrator aborts execution via `AbortController`.
- **Observed Result:** Process is aborted before completion. Exit code is `null` or non-zero, status marked `CANCELLED`. No verified receipt is accepted. **PASS.**

#### Test 8: Test Report Predates the Run
- **Attack Vector:** A pre-existing test report file on disk has an mtime older than the task initiation timestamp.
- **Observed Result:** Timestamp freshness validation fails closed. Stale reports are purged and not credited. **PASS.**

#### Test 9: Test Report References Another Artifact
- **Attack Vector:** Test report metadata declares source file hash `A`, but active workspace contains source file hash `B`.
- **Observed Result:** SHA-256 cross-check detects disparity; test report is invalidated. **PASS.**

#### Test 10: Required Assertions Absent
- **Attack Vector:** Test runner exits code 0, but stdout reports `0 tests executed, 0 assertions passed`.
- **Observed Result:** Zero-assertion test execution is detected as vacuous. Verification requires `assertionsPassed > 0`. **PASS.**

#### Test 11: Host Journal Has No Matching Operation
- **Attack Vector:** A receipt string formatted as `receipt:test-exec:<uuid>` is presented, but `TaskStore.getJournalOperations()` has no matching execution ID.
- **Observed Result:** Cross-journal validation rejects the orphaned receipt as unverified. **PASS.**

#### Test 12: Process Identity or Authorization Changes
- **Attack Vector:** Invocation attempts to use `cmd.exe /c` or an unapproved binary outside `process.execPath`.
- **Observed Result:** Runner containment check refuses the executable. Execution throws an admission error; zero processes spawned. **PASS.**

---

## 3. Test Suite Execution Evidence

All 12 negative tests, along with positive process-execution assertions, are verified in `src/lib/bunny-host/ma4/benchmark-integrity.test.ts`:

```powershell
node --experimental-strip-types --test src/lib/bunny-host/ma4/benchmark-integrity.test.ts
```

**Observed Result:**
- **Tests Passed:** 18
- **Tests Failed:** 0
- **Suites Passed:** 1
- **Duration:** 1,229 ms

Every deterministic test process pass in milestone `MA4-S3-T4R2` is backed by genuine operating system child process execution under full host journal auditability.
