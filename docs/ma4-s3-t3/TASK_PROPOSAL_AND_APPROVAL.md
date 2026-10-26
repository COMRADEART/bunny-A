# Task Proposal and Owner Approval Protocol

## 1. Overview and Core Philosophy

In Bunny-A, agentic execution is never an unprompted background side-effect of a conversational query. When a user asks a complex question, the application maintains safe conversational behavior until execution is explicitly proposed, reviewed, and authorized by the workstation owner.

The Host alone retains sovereign admission control. No language model—regardless of role (Planner, Worker, Tester, or Reviewer)—can create a persistent task, broaden resource grants, issue permissions, or launch an executor.

---

## 2. The 10-Step Proposal and Approval Flow

```
User Request
     │ (1) Submit request
     ▼
Host Classification & Capabilities
     │ (2) C0-C3 classification + resource audit
     ▼
Draft Proposal Creation
     │ (3) Host initializes TaskProposal envelope
     ▼
Planner Step Generation
     │ (4) Planner proposes bounded steps (max 20 steps, DAG)
     ▼
Host Specification Validation
     │ (5) validateTask(TaskSpecSchema, EnvelopeSchema)
     ▼
UI Proposal Presentation
     │ (6) Proposal Review Card rendered in Task view
     ▼
Owner Authorization
     │ (7) Owner clicks "Run with agents" (POST /tasks/:id/run-with-agents)
     ▼
Persistent Task Instantiation
     │ (8) PersistentTaskRuntime.create() records task in SQLite TaskStore
     ▼
Action Broker Approval Gate
     │ (9) Consequential steps require payload-bound owner approval
     ▼
Host Coordinator Execution
     │ (10) CoordinatorChannel admits role steps sequentially
     ▼
Verified Output & Evidence
```

### Step 1: User Request Submission
The user enters a request into the chat interface or issues `POST /tasks`. The task is received by `TaskManager.submit()`.

### Step 2: Complexity Determination
`TaskManager` evaluates the prompt using the deterministic rules in `s3t1.ts` and `connectedWorkflow`:
- Categorized as C0, C1, C2, or C3.
- Eligible tools and registered folder roots (`connectedActions.roots`) are identified.

### Step 3: Draft Proposal Creation
For C2/C3 requests, the Host initializes a `TaskProposal` record:
```typescript
interface TaskProposal {
  title: string;
  complexity: "C2" | "C3";
  roles: S2Role[];
  estimatedSteps: number;
  requiredCapabilities: string[];
  requiredResources: { type: "folder" | "browser" | "service"; name: string; access: "read" | "write" }[];
  spec: TaskSpec;
  envelope: Envelope;
}
```

### Step 4: Bounded Planner Generation
If connected workflow planning is required, `planConnectedTask` invokes the Planner role:
- Steps are bounded to a maximum of 20 operations.
- Dependencies form a directed acyclic graph (DAG).
- Only registered catalog tools (`file.read`, `file.list`, `file.apply`, `local.generate`, `local.test`, `local.review`) may be referenced.

### Step 5: Host Validation
The Host executes `validateTask(proposal.spec, proposal.envelope)`:
- Confirms schema validity (`TaskSpecSchema`).
- Confirms capabilities requested do not exceed the catalog.
- Validates that resource grants match declared folder roots.
- If validation fails, the proposal is rejected or abandoned; it is never executed.

### Step 6: UI Presentation
The Island UI (`src/components/island/task.tsx`) renders the **Proposal Review Card**:
- Displays target resources (e.g., project folder, read/write mode).
- Lists agent roles (Planner, Worker, Tester, Reviewer) and assigned local models.
- Displays explicit capabilities and estimated wall-clock limits.
- Renders the primary action button: **"Run with agents"**.

### Step 7: Owner Authorization
The workstation owner reviews the envelope and confirms execution:
- Clicking "Run with agents" sends a signed command to `POST /tasks/:id/run-with-agents`.
- The actor must be a trusted local workstation actor (`actor.kind === "workstation"`). Remote or unauthenticated actors cannot authorize proposals.

### Step 8: Persistent Task Creation
`TaskManager.runWithAgents()` converts the proposal into a durable task in `PersistentTaskRuntime`:
- Task is written to SQLite `TaskStore` with initial state `QUEUED` (for read-only operations) or `AWAITING_APPROVAL` (if consequential actions are present).
- An orchestration link is recorded (`task.persistentTaskId = ptask.id`).

### Step 9: Action Broker Consequential Approval
When a step has side effects (e.g. `file.apply` or external notification):
- The step cannot execute automatically.
- The Action Broker pauses execution in state `AWAITING_APPROVAL`.
- The exact payload hash (target file, unified diff, SHA-256 of new content) is presented in the Approval Center.
- Approval is strictly payload-bound: any alteration to the content invalidates the approval token.

### Step 10: Host Coordinator Execution
The trusted Host Coordinator manages execution step by step, ensuring each role handoff adheres to the frozen requirements and trust boundaries.

---

## 3. Threat Model and Boundary Invariants

1. **No Autonomous Task Spawning:** A language model cannot self-escalate from chat into background task execution.
2. **Payload Fencing:** Changes are held in memory or sandbox until explicit workstation approval is committed to the ledger.
3. **No Blind Settlement:** An uncertain or interrupted consequential action cannot be auto-resolved; it requires owner reconciliation.
