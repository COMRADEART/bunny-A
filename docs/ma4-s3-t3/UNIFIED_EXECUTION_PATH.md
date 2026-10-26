# Unified Execution Path: C0, C1, C2, and C3 Workflows

## 1. Executive Summary

Prior to MA4-S3-T3, user requests submitted via chat or the HTTP task API (`POST /tasks`) underwent C0–C3 classification and recorded an execution plan in `task.executionPlan`, but the execution path was bifurcated:
- Ordinary tasks unconditionally executed a single LLM call via the local Ollama provider.
- C1 requests (e.g. "Read NOTES.md and summarize") prompted the language model directly, resulting in fabricated file contents when the model attempted to guess the file's text.
- C2 and C3 requests recorded team compositions (Planner, Worker, Reviewer) and estimated costs, but never scheduled or launched the recorded team.
- The persistent task engine (`PersistentTaskRuntime`) existed as a separate subsystem used only for scheduled or proactive tasks.

MA4-S3-T3 unifies chat, task, and multi-agent execution into a single, cohesive, Host-controlled pipeline without creating a parallel runtime, a second authorization layer, or an independent scheduler.

---

## 2. The Four Execution Classes

```
[ User Request ]
       │
       ▼
[ C0-C3 Classifier (s3t1.ts) ]
       │
       ├─► C0: Direct conversational response (single local model, no tools, no team)
       │
       ├─► C1: Single-tool read/inspect (Host tool execution, grounded prompt, receipt)
       │        └─ If unregistered/unauthorized: deterministic refusal (NO hallucination)
       │
       ├─► C2: Multi-step workflow (Host creates TaskProposal; awaits "Run with agents")
       │        └─ Planner + Worker + Deterministic Verification
       │
       └─► C3: Complex workflow (Host creates TaskProposal; awaits owner grant)
                └─ Planner + Worker + Tester + Reviewer + Host Coordinator
```

### C0 — Direct Answer
- **Characteristics:** General questions, code explanation, reasoning, creative writing, or casual interaction.
- **Execution:** Dispatched directly to the authorized local chat model through `OllamaAdapter`.
- **Invariants:** No agent team is composed; no file or external tool is invoked; zero privilege escalation; fast, private, local execution.

### C1 — Single-Tool Inspection
- **Characteristics:** Explicit requests to inspect, read, or summarize an existing registered resource (e.g., "Read NOTES.md and summarize pending tasks").
- **Grounded Tool Execution:**
  1. The Host examines `connectedActions.roots` for an authorized folder matching the requested path.
  2. **Refusal Invariant:** If the folder is unregistered or access is denied, the Host **never** invokes an LLM to guess the contents. It deterministically returns an honest refusal:
     `"File <path> was not read: folder is not registered or authorized."`
  3. **Execution Invariant:** When authorized, the Host invokes `file.read` via `walk` and `readText`, computing the SHA-256 hash of the content on disk.
  4. **Fencing Invariant:** The raw file content is injected into the Worker model prompt as strictly fenced data:
     ```text
     <<<DATA from file.read: notes/NOTES.md (SHA-256: 4f3a...)>>>
     [file content]
     <<<END DATA>>>
     ```
  5. The model output is generated strictly from the grounded data.
  6. An evidence receipt (`ToolExecutionRecord`) is attached to the task record, specifying `tool: "file.read"`, the target path, content SHA-256, and execution timestamp.

### C2 — Multi-Step Workflows
- **Characteristics:** Structured tasks requiring multi-step preparation, generation, and verification (e.g., refactoring across related files, generating documentation with checks).
- **Host Proposal:** The Host does **not** automatically launch a multi-agent team simply because the classifier chose C2.
- **Workflow:**
  1. Host generates a `TaskProposal` with a bounded step plan, registered capability requirements, and resource grants.
  2. The UI presents an explicit **"Run with agents"** action card detailing steps, models, and resource access.
  3. Upon owner confirmation (`POST /tasks/:id/run-with-agents`), the Host admits the task into `PersistentTaskRuntime` (`ptasks`).
  4. Team composition: **Planner**, **Worker**, and deterministic checks.

### C3 — Complex & Consequential Workflows
- **Characteristics:** Multi-file analysis, test repair, complex workflows, or consequential actions (file modifications, system notifications).
- **Mandatory Gates:**
  1. Full team composition: **Planner**, **Worker**, **Tester** (when tests are required), **Reviewer** (for semantic acceptance criteria), and the trusted **Host Coordinator**.
  2. Bounded execution: maximum 20 steps, strict wall-clock time limit, max model calls.
  3. **Payload-Bound Approval:** Any destructive or modifying step (`file.apply`) requires an explicit owner approval envelope with exact SHA-256 hashes of the target and replacement.
  4. **Refusal of Unsafe Requests:** High-risk operations lacking authorized tool executors (e.g., "Delete production database") are immediately rejected with `TASK_REFUSED` and zero capability inference.

---

## 3. Host Admission Control

A fundamental security principle of MA4-S3-T3 is that **the model never issues its own authorization**:
1. The model's plan or proposal is strictly advisory data (`TaskProposal`).
2. Only the trusted Host validates the proposal against `TaskSpecSchema` and `EnvelopeSchema`.
3. Only the workstation owner can grant capabilities and approve consequential payloads.
4. Only the Host Coordinator admits handoffs between agent roles.
