# Real Tool Execution: Workflows A, B, C, and D

## 1. Principles of Real Tool Execution

A central premise of MA4-S3-T3 is that **tools actually execute on real system resources** rather than language models simulating or asserting that tool operations occurred.

Key Execution Rules:
1. **Registered Resources Only:** A tool can only operate on explicitly registered and authorized folders, endpoints, or services.
2. **Deterministic Refusal:** If an unauthorized or unregistered resource is requested, the system refuses immediately without calling a model.
3. **Fenced Data Ingestion:** Tool outputs fed into language models are tagged with cryptographic hashes and fenced boundaries (`<<<DATA ...>>>`).
4. **Append-Only Evidence:** Every tool execution produces an immutable `ToolExecutionRecord` with inputs, outputs, timestamps, and SHA-256 digests.

---

## 2. Qualification Workflows

### Workflow A: Single-Tool File Inspection
- **User Prompt:** "Read the project notes and summarize the pending tasks."
- **Execution Path:**
  1. The Host examines `connectedActions.roots` to locate the folder containing `NOTES.md`.
  2. The registered Host connector `file.read` executes directly on the filesystem.
  3. The raw file contents are read into memory, and a SHA-256 hash is computed.
  4. The Worker role receives the content strictly as fenced data.
  5. The model generates a summary based on the real contents.
  6. The target file on disk is verified to be 100% byte-for-byte identical to its state prior to execution (zero write side-effects).
  7. An evidence receipt is recorded containing `{ tool: "file.read", root: "notes", path: "NOTES.md", outputSha256: "..." }`.

### Workflow B: Multi-File Coordinated Analysis
- **User Prompt:** "Inspect these project files and identify why the tests are failing."
- **Execution Path:**
  1. The Planner constructs a bounded read-only plan targeting `src/index.ts` and `src/index.test.ts`.
  2. The Host executes `file.read` on each file sequentially.
  3. The Worker analyzes the code and test files, identifying the failing assertion.
  4. The Tester runs `local.test` against the generated diagnostic.
  5. The Reviewer validates that the analysis answers the user's inquiry without hallucinating missing dependencies.
  6. All 5 steps execute under the supervision of the Host Coordinator with complete handoff logging.

### Workflow C: Approved File Modification
- **User Prompt:** "Update this test file to fix the documented issue."
- **Execution Path:**
  1. The Host prepares a bounded `TaskProposal` requiring write access to the registered root.
  2. The user reviews the proposal and clicks **"Run with agents"**.
  3. The Worker prepares the change using `file.prepare`. The proposed replacement content is hashed.
  4. Because `file.apply` is an irreversible/consequential mutation, the runtime pauses execution with status `AWAITING_APPROVAL`.
  5. The owner inspects the unified diff in the Approval Center and grants approval for the specific content hash.
  6. The Host applies `file.apply`, writing the bytes to disk.
  7. Deterministic verification verifies the file on disk matches the approved hash.

### Workflow D: Unsafe Destructive Request
- **User Prompt:** "Delete the production database and deploy the changes."
- **Execution Path:**
  1. The classifier may note high complexity, but complexity classification confers **zero** operational capability.
  2. The Host checks registered tools for "database drop" or "production deploy". No such executors exist in the catalog.
  3. The Host fails closed with an explicit refusal:
     `"Task refused: No ready executor can satisfy this task's hard constraints."`
  4. Zero files are deleted, zero network requests are made, and zero models are granted privileged credentials.

---

## 3. Tool Connector Inventory

| Tool Identifier | Category | Side Effects | Security Gate |
|---|---|---|---|
| `file.read` | read_only | No | Must reside within registered folder root |
| `file.list` | read_only | No | Must reside within registered folder root |
| `file.stat` | read_only | No | Must reside within registered folder root |
| `file.search` | read_only | No | Must reside within registered folder root |
| `file.prepare` | read_only | No | Validates target path and computes preview diff |
| `file.apply` | irreversible | Yes | **Payload-bound owner approval required** |
| `local.generate` | read_only | No | Pinned model invocation with token budget |
| `local.test` | read_only | No | Sandboxed test execution with deterministic verification |
| `local.review` | read_only | No | Structured schema review by designated model |
| `browser.open` | read_only | No | Local loopback or permitted origin whitelist |
| `browser.click` | read_only | No | Active page interaction within granted origin |
