# Agent Execution Evidence and Receipt Chains

## 1. The Evidence Philosophy

In Bunny-A, claims made by language models are never accepted as proof of execution. A model's generated sentence "I have updated the file and verified all tests pass" is treated as untrusted prose until supported by cryptographic evidence produced by the Host.

Every operation performed by a tool or agent generates a durable, verifiable receipt stored in the Host's SQLite database (`host.sqlite`).

---

## 2. Receipt Schemas

### Tool Execution Record
```typescript
interface ToolExecutionRecord {
  id: string;
  tool: string;
  category: "read_only" | "idempotent" | "irreversible";
  input: Record<string, unknown>;
  outputSha256: string;
  durationMs: number;
  receipt?: string;
  executedAt: number;
}
```

### Agent Execution Record
```typescript
interface AgentExecutionRecord {
  role: "Planner" | "Worker" | "Tester" | "Reviewer";
  model: string;
  servedModel: string;
  promptSha256: string;
  outputSha256: string;
  durationMs: number;
  handoffId: string;
  tokensUsed?: number;
  executedAt: number;
}
```

---

## 3. Evidence Chain per Role

```
   [ Planner ]  ──► Step Graph SHA-256 + Schema Validation Hash
        │
        ▼
   [ Worker  ]  ──► Fenced Input SHA-256 + Output Artifact SHA-256 + Tool Receipts
        │
        ▼
   [ Tester  ]  ──► Test Specification Hash + Assertion Count + Exit Code Receipt
        │
        ▼
   [Reviewer ]  ──► Criteria Hash + Structured JSON Issue Receipt
        │
        ▼
   [Host Ledger] ──► Append-Only Hash Chain in SQLite TaskStore
```

### 1. Planner Evidence
- The Planner's output is parsed into a formal DAG of steps.
- The step list is hashed (`specSha256`).
- A schema validation receipt verifies that every step kind is present in the registered executor catalog and that input conforms to JSON schemas.

### 2. Worker Evidence
- If the Worker ingested tool data (e.g. `file.read`), the input digest is referenced.
- The Worker's output is hashed. If the Worker proposed a file modification, a unified diff is created and hashed.
- The served model is verified against the pinned model identifier.

### 3. Tester Evidence
- Test runs produce concrete execution metrics:
  - Exit code (0 for pass, non-zero for failure).
  - Assertion count and standard error output.
  - Test run duration.
- The Tester cannot pass a failing test: deterministic verification overrides any model assertion.

### 4. Reviewer Evidence
- Semantic reviews must return a validated JSON schema:
  ```json
  { "approved": true, "issues": [] }
  ```
- The Reviewer's receipt includes the model identifier, token count, and reviewed artifact hash.
- The Reviewer cannot approve code if the deterministic test suite failed.

---

## 4. Hash Chain and Tamper-Resistance

All receipts are committed to the `ActionLedger` and `TaskStore` using SQLite transactions. Each ledger entry contains:
- `sequence`: Monotonically increasing 64-bit integer.
- `prevHash`: SHA-256 hash of the preceding ledger entry.
- `entryHash`: SHA-256 hash of `sequence + prevHash + timestamp + payload`.

Any tampering with historical receipts or external modification of SQLite rows breaks the cryptographic chain and triggers an integrity failure upon Host startup, forcing the task into read-only quarantine.
