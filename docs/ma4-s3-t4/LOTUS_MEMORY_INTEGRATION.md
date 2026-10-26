# MA4-S3-T4 Lotus Memory Integration Specification

**Product:** Bunny A by LOKAM  
**Milestone:** MA4-S3-T4  
**Modules:** `src/lib/bunny-host/lotus.server.ts`, `src/lib/bunny-host/ma4/experience.server.ts`, `src/lib/bunny-host/ma4/verified-experience.server.ts`  

---

## 1. Architectural Fit with Lotus Memory

Lotus Memory is Bunny A's persistent, local, privacy-preserving memory subsystem backed by SQLite WAL storage. MA4-S3-T4 integrates verified agent experience learning directly into Lotus without introducing disjoint storage engines.

```mermaid
flowchart LR
    subgraph LotusCore ["Lotus Memory Subsystem (SQLite WAL)"]
        Table[(lotus_items table)]
        InnerScope["Inner Scope (General Project Facts)"]
        OuterScope["Outer Scope (Cross-Project Global Knowledge)"]
        ExpScope["Experience Scope (project:id / kind=experience)"]
    end

    Outcome[(ma4_task_outcomes)] -->|Verified Success Only| VEM[VerifiedExperienceManager]
    VEM -->|Scoped Write| ExpScope
    ExpScope --> Table
    Table -->|Strict Filter: scope = 'project:' || id| VEM
    VEM -->|Advisory XML Block| Planner[Adaptive Planner Context]
```

---

## 2. Database Schema and Scoping

Lotus stores experience records inside the standard `lotus_items` table:

```sql
CREATE TABLE IF NOT EXISTS lotus_items (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,         -- Strict format: "project:<project_id>"
  kind TEXT NOT NULL,          -- Literal: "experience"
  content TEXT NOT NULL,       -- JSON-serialized VerifiedExperienceRecord
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  provenance TEXT NOT NULL     -- Task ID, host instance, commit SHA
);

CREATE INDEX IF NOT EXISTS idx_lotus_items_scope_kind 
  ON lotus_items(scope, kind, expires_at);
```

### 2.1 Partitioning Invariants
1. **Scope Format:** The scope is strictly formatted as `project:<projectId>`.
2. **Never in Outer Scope:** Experiences are strictly local to a project. They are never written to the global or outer scope, preventing cross-project knowledge leakage.
3. **No Unencrypted Secrets:** Sensitive tokens, passwords, and private file contents are scrubbed before serialization into the `content` column.

---

## 3. Experience Promotion and Retrieval Pipeline

### 3.1 Promotion Pipeline
When a task finishes in `PersistentTaskRuntime`:
1. `recordTerminalOutcome` creates an `ExecutionOutcomeRecord`.
2. The outcome record is written to `ma4_task_outcomes`.
3. If `policy.experienceLearning === true` and `isVerifiedSuccess(record) === true`:
   - A `VerifiedExperienceRecord` is synthesized.
   - It is stored via `VerifiedExperienceManager.recordExperience()`.
   - Any previous obsolete experience records with identical `problemSignature` in that project are versioned or replaced.

### 3.2 Parameterized Retrieval Query
Retrieval executes through a strictly parameterized SQLite query:

```typescript
const rows = db.prepare(`
  SELECT id, scope, kind, content, created_at, expires_at 
  FROM lotus_items 
  WHERE scope = ? AND kind = 'experience' AND expires_at > ?
  ORDER BY created_at DESC 
  LIMIT ?
`).all(`project:${projectId}`, Date.now(), limit);
```

Because the SQL query binds `scope = 'project:' || projectId`, no record belonging to another project can be returned, even in the event of prompt injection or model hallucination.

---

## 4. Owner Control and Data Sovereignty

The workstation operator maintains total authority over Lotus Experience Memory:
- **Enable/Disable:** Can be toggled on/off at runtime without restarting the Host.
- **Manual Project Purge:** Operator can clear all experience records for a specific project with one click.
- **Automatic Pruning:** The Host maintenance routine sweeps expired records every 6 hours (`PRUNE_EVERY_MS`).
