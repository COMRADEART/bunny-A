# Live Workflow Qualification and Verification Suite

## 1. Test Suite Overview

All multi-agent execution paths, tool invocations, and security invariants introduced in MA4-S3-T3 are verified by a comprehensive, automated test suite:
- **Test File:** `src/lib/bunny-host/ma4-s3-t3.test.ts`
- **Execution Engine:** Node.js v24.18.0 built-in test runner (`node --test`)
- **Isolation:** Real SQLite `HostDatabase`, `TaskStore`, `PersistentTaskRuntime`, and `connectedActions` operating in isolated scratch directories.

---

## 2. Test Execution Results

```text
✔ Workflow A: File inspection executes real file.read, grounds Worker in fenced data, records receipts, leaves file unchanged (272.4186ms)
✔ Workflow B: Multi-file analysis runs Planner, Worker, Tester, and Reviewer with coordinator handoff verification (286.5296ms)
✔ Workflow C: Approved file edit requires payload-bound approval before applying changes (291.9354ms)
✔ Workflow D: Unsafe destructive request refuses execution without capabilities or authorization (186.1399ms)
✔ C1 Grounding: Request to read file when folder is unregistered refuses honestly without hallucinating (812.3978ms)
✔ Task Proposal: C2/C3 requests prepare bounded proposals that require explicit owner launch (561.7849ms)
✔ Coordinator Channel: Handoff protocol enforces frozen requirements, edge roles, and forbids model trust claims (0.6153ms)
✔ 12 Truthful States: Derived truthfully from real Host execution state (0.1695ms)
✔ Cancellation: Stop propagates cleanly through the established Host path (202.3832ms)
✔ Pin Enforcement: Substituting pinned model causes PIN_VIOLATION and halts execution (206.1118ms)
✔ Adversarial: Prompt injection in handoffs is downgraded to untrusted and rejected if claiming authority (0.3817ms)
✔ Restart Recovery: Interrupted irreversible operation recovers to UNCERTAIN and requires owner reconciliation (220.7745ms)
✔ Stale Lease Fencing: Reclaimed worker cannot commit after lease takeover (222.1209ms)

Total: 13 passed, 0 failed, 0 skipped
Duration: 3.58s
```

---

## 3. Detailed Qualification Analysis

### 1. Workflow A (File Inspection)
- Verified that `file.read` reads the real file from disk.
- Worker prompt inspected: confirms `<<<DATA from step read-notes...>>>` is present with exact text `"Task 1: Fix bug\nTask 2: Ship release\nTask 3: Write docs"`.
- Disk content verified: exactly matches original content prior to execution.
- Receipt verified: evidence array contains step `read-notes` with matching output SHA-256.

### 2. Workflow B (Multi-File Coordinated Analysis)
- Verified Coordinator handoff channel logging: 8 distinct role transitions recorded (`Coordinator -> Planner -> Coordinator -> Worker -> Coordinator -> Tester -> Coordinator -> Reviewer -> Coordinator`).
- All handoff messages validated with frozen `requirementsSha256`.

### 3. Workflow C (Approved File Edit)
- Target file `config.json` initially contained `{"mode":"old"}`.
- Step `file.apply` held in `AWAITING_APPROVAL` until `rt.approve(view.id, "workstation")`.
- File content on disk after execution verified to contain `{"mode":"updated"}`.
- Cryptographic receipt matches new content hash.

### 4. Workflow D (Unsafe Destructive Request)
- Evaluated against request to "Delete production database".
- Host verified zero executors exist; task immediately transitioned to `FAILED`.
- Zero file modifications occurred.

### 5. C1 Honest Refusal (No Hallucination)
- Tested request to read `NOTES.md` when the folder is unregistered.
- Verified that no LLM was prompted to invent file contents.
- Result message strictly verified:
  `"File NOTES.md was not read: folder is not registered or authorized."`
