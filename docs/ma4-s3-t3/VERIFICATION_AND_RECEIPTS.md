# Deterministic Verification, Acceptance Contracts, and Receipts

## 1. Deterministic Verification vs Semantic Review

Bunny-A enforces a strict hierarchy between deterministic checks and language model reviews:

```
[ Deterministic Verification ]   (Compiler, Test Runner, SHA-256 Hash, File Diff)
           │
           ├─ If PASS ──► Proceed to Semantic Review (Reviewer model)
           │
           └─ If FAIL ──► Hard Failure (Immediate Stop / Repair Loop)
                           ▲
                           │ Reviewer CANNOT override this failure!
```

### The Inviolable Verification Invariant:
**A language model Reviewer can never override, waive, or pass a failed deterministic check.**

If a unit test fails (exit code !== 0) or a static typecheck detects a syntax error:
1. The step is marked `failed`.
2. The Reviewer role is either skipped or notified of the failure.
3. Even if a Reviewer model outputs `{"approved": true}`, the Host Coordinator rejects the output and marks the task as failed or initiates an authorized repair attempt.

---

## 2. Acceptance Contracts

Every task specification defines an explicit acceptance contract:
```typescript
acceptance: {
  requiredSteps: ["read-src", "apply-edit", "test-verifier"],
  deterministicChecks: ["tests_pass", "types_pass"]
}
```

### Completion Criteria:
A task cannot transition to the `COMPLETED` state unless:
1. Every step in `requiredSteps` has executed successfully.
2. Every required step has a recorded `outputSha256` digest in SQLite.
3. All deterministic tests exited with code 0.
4. No pending or unhandled errors exist in the task record.

If a worker finishes its loop but any required step has no cryptographic receipt, the task fails with:
`ACCEPTANCE_UNMET: No receipt for: <step_id>`

---

## 3. Cryptographic Evidence Chain

The evidence chain guarantees that every output presented in the UI corresponds to real execution bytes.

### Evidence Chain Composition:
1. **Input Root Digest:** SHA-256 of the source file or prompt prior to execution.
2. **Execution Receipt:**
   - Command line or tool invocation identifier.
   - Standard output and standard error bytes.
   - Execution duration and system timestamp.
3. **Output Hash:** SHA-256 digest of the generated code, file update, or analysis report.
4. **Ledger Commit:** Cryptographically chained entry in SQLite `ActionLedger`.

By referencing the output SHA-256, any party can independently audit whether the file on disk or the result in the UI was genuinely produced by the authorized workflow.
