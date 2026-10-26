# MA4-S3-T4 Outcome Evidence Schema & Measurement Specification

**Product:** Bunny A by LOKAM  
**Milestone:** MA4-S3-T4  
**Module:** `src/lib/bunny-host/ma4/outcome-measurement.ts`  
**Storage Table:** `ma4_task_outcomes` (in SQLite task database)  

---

## 1. Principles of Outcome Measurement

In Bunny A MA4-S3-T4, execution quality is judged strictly on **Host-verified evidence**. 

### 1.1 Ground Truth vs. LLM Confidence
- An LLM stating `"I have successfully implemented the feature and all tests passed"` has **zero evidentiary weight** in Bunny A.
- Execution status is governed by `isVerifiedSuccess(record)`, which mandates:
  1. `record.status === "success"`
  2. `record.evidence.hostVerified.acceptanceVerified === true`
  3. `record.evidence.hostVerified.receipts.length > 0`
  4. Every receipt has `exitCode === 0` and a non-empty `outputSha256`
  5. `record.evidence.hostVerified.testResults.failed === 0`
  6. `record.failureTaxonomy === null`

---

## 2. Evidence Categories

The data model divides all execution signals into three disjoint categories:

```typescript
export interface HostVerifiedEvidence {
  receipts: Array<{
    stepId: string;
    kind: string;
    exitCode: number;
    outputSha256: string;
    verifiedAt: number;
  }>;
  testResults: {
    passed: number;
    failed: number;
    skipped: number;
    receiptHash: string;
  } | null;
  fileModifications: Array<{
    rootId: string;
    relativePath: string;
    beforeSha256: string | null;
    afterSha256: string;
    bytesWritten: number;
  }>;
  acceptanceVerified: boolean;
  verifiedArtifactHashes: string[];
}

export interface ModelGeneratedEvidence {
  planSummary: string | null;
  proposedRepairs: string[];
  explanation: string | null;
  selfAssessedConfidence: number | null; // Informational only; NEVER gates status
}

export interface UserFeedbackEvidence {
  rating: number | null; // 1-5 scale
  approvalGranted: boolean;
  manualCorrection: string | null;
  notes: string | null;
}
```

---

## 3. Full Execution Outcome Record Schema

```typescript
export const ExecutionOutcomeRecordSchema = z.object({
  id: z.string().uuid(),
  taskId: z.string().min(1),
  projectId: z.string().min(1),
  taskClass: z.enum(["C0", "C1", "C2", "C3"]),
  specSha256: z.string().length(64),
  acceptanceSha256: z.string().length(64),
  
  // Model & Role Telemetry
  approvedModel: z.string().min(1),
  observedModel: z.string().min(1),
  invokedRoles: z.array(z.string()),
  modelCallCount: z.number().int().nonnegative(),
  toolCallCount: z.number().int().nonnegative(),
  planningAttempts: z.number().int().positive(),
  executionAttempts: z.number().int().positive(),
  
  // Status & Taxonomy
  status: z.enum(["success", "failure", "refusal", "uncertain"]),
  failureTaxonomy: z.enum([
    "TRANSIENT_RESOURCE_OVERLOAD",
    "MODEL_TIMEOUT",
    "TOOL_EXECUTION_ERROR",
    "PERMISSION_DENIED",
    "POLICY_VIOLATION",
    "UNCERTAIN_SIDE_EFFECT",
    "ACCEPTANCE_UNMET"
  ]).nullable(),
  
  // Tripartite Evidence
  evidence: z.object({
    hostVerified: HostVerifiedEvidenceSchema,
    modelGenerated: ModelGeneratedEvidenceSchema,
    userFeedback: UserFeedbackEvidenceSchema.nullable(),
  }),
  
  // Timing
  timing: z.object({
    queuedAt: z.number().int().positive(),
    startedAt: z.number().int().positive(),
    completedAt: z.number().int().positive(),
    queueDurationMs: z.number().int().nonnegative(),
    executionDurationMs: z.number().int().nonnegative(),
  }),
  
  // Hardware & Resource Footprint
  resources: z.object({
    vramObservedBytes: z.number().int().nonnegative().nullable(),
    systemRamObservedBytes: z.number().int().nonnegative().nullable(),
    tokenUsage: z.object({
      promptTokens: z.number().int().nonnegative(),
      completionTokens: z.number().int().nonnegative(),
      totalTokens: z.number().int().nonnegative(),
    }).nullable(),
  }),
  
  // Recovery Metadata
  recovery: z.object({
    attemptCount: z.number().int().nonnegative(),
    strategyUsed: z.string().nullable(),
    ownerApproved: z.boolean(),
  }),
  
  createdAt: z.number().int().positive(),
});
```

---

## 4. Privacy & Secret Redaction Policy

Before any outcome record is written to SQLite or summarized for experience retrieval, it passes through `redactOutcomeSecrets()`:

1. **Bearer Tokens and API Keys:** Strips `Bearer [A-Za-z0-9_-]+`, `ghp_[A-Za-z0-9]+`, `xai-[A-Za-z0-9]+`, and generic secret patterns.
2. **Absolute Host Paths:** Converts absolute Windows file paths (e.g. `C:\Users\username\...`) to relative root paths (`[ROOT]/...`).
3. **Email Body Content:** Retains only delivery receipts and message SHA256 hashes, dropping raw email payloads.
4. **Transient Memory Leaks:** Sanitizes stack traces, removing environment variables and authentication cookies.

---

## 5. Example Outcome Record (JSON)

```json
{
  "id": "e8389650-7dc5-4bfb-9c32-e069c9dcbc9b",
  "taskId": "task-491-c2-synthesis",
  "projectId": "proj-lokam-core",
  "taskClass": "C2",
  "specSha256": "3a7b689a9f0e1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c",
  "acceptanceSha256": "9b0c1d2e3f4a5b6c3a7b689a9f0e1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a",
  "approvedModel": "qwen2.5-coder:7b",
  "observedModel": "qwen2.5-coder:7b",
  "invokedRoles": ["planner", "worker"],
  "modelCallCount": 2,
  "toolCallCount": 2,
  "planningAttempts": 1,
  "executionAttempts": 1,
  "status": "success",
  "failureTaxonomy": null,
  "evidence": {
    "hostVerified": {
      "receipts": [
        {
          "stepId": "read-source",
          "kind": "fs.read",
          "exitCode": 0,
          "outputSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "verifiedAt": 1793048123000
        },
        {
          "stepId": "extract-symbols",
          "kind": "ast.extract",
          "exitCode": 0,
          "outputSha256": "4b227777d4dd1fc61c6f884f48641d02b4d121d3fd328cb08b5531fcacdabf8a",
          "verifiedAt": 1793048124500
        }
      ],
      "testResults": null,
      "fileModifications": [],
      "acceptanceVerified": true,
      "verifiedArtifactHashes": ["4b227777d4dd1fc61c6f884f48641d02b4d121d3fd328cb08b5531fcacdabf8a"]
    },
    "modelGenerated": {
      "planSummary": "Extract exported interfaces from core schema module.",
      "proposedRepairs": [],
      "explanation": "Extracted 4 TypeScript interfaces cleanly without syntax violations.",
      "selfAssessedConfidence": 0.98
    },
    "userFeedback": null
  },
  "timing": {
    "queuedAt": 1793048120000,
    "startedAt": 1793048121000,
    "completedAt": 1793048125000,
    "queueDurationMs": 1000,
    "executionDurationMs": 4000
  },
  "resources": {
    "vramObservedBytes": 4279238656,
    "systemRamObservedBytes": 22971531264,
    "tokenUsage": {
      "promptTokens": 348,
      "completionTokens": 112,
      "totalTokens": 460
    }
  },
  "recovery": {
    "attemptCount": 0,
    "strategyUsed": null,
    "ownerApproved": false
  },
  "createdAt": 1793048125000
}
```
