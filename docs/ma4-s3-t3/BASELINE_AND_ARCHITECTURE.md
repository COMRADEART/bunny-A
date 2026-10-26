# MA4-S3-T3 Baseline and Architecture

## 1. Baseline Summary

- **Repository:** https://github.com/COMRADEART/bunny-A
- **Milestone:** MA4-S3-T3 (Unified Agent Execution, Real Tool Use & Verified Multi-Agent Workflows)
- **Proposed Branch:** `ma4-s3-t3-unified-agent-execution`
- **Predecessor:** MA4-S3-T2R1, PR #44
- **Integration Merge Commit:** `8b795b94234fb21ca8f183b680176acdd4cffd6c`
- **Parent Commits:** `4af7d9f313ee46b98698fe12662b11676b3391cd` (PR #43 merge) and `cd1349da08e1622baa81dd364861bd8a5bde2c58` (PR #44 head)
- **Hosted CI Status:** Run `40246317305` (push to `main` on commit `8b795b9`) completed with conclusion **SUCCESS** (full MA3/MA4 regression passed in 25m6s, static security passed in 36s, typecheck and test builds passed in 2m52s).
- **Execution Environment:** Windows workstation, Node.js v24.18.0 (verified license beside executable, SHA-256 `9A4EB5F1C29C6A2E93852EAD46B999E284A6A5CA8BAB4D4E241D587D025A52DE`), npm 11.16.0, local Ollama daemon running.
- **Isolated Worktree:** `C:\Users\allam\Documents\new\bun-router-s3t3` on branch `ma4-s3-t3-unified-agent-execution`.
- **Preserved Installations & Shortcuts:** Existing desktop installations under `%LOCALAPPDATA%\bunny-a`, startup shortcuts `Bunny-A.lnk` and `Ollama.lnk` preserved and intact.

---

## 2. Architectural Audit of Existing Systems

The existing codebase contains robust modular subsystems created across MA0–MA4 milestones:

| Subsystem | Location | Current State & Capability |
|---|---|---|
| **Task Classification (C0–C3)** | `src/lib/bunny-host/ma4/s3t1.ts` | Deterministic baseline classification into C0 (direct answer), C1 (single-tool read), C2 (multi-step workflow), C3 (consequential/complex workflow). |
| **Team Composition & Roles** | `src/lib/bunny-host/ma4/coordinator.ts` | `composeTeam`, `assignTeam`, `planSchedule`, and `gateCalls`. Bounded team composition of Planner, Worker, Tester, and Reviewer. |
| **Collaboration & Handoffs** | `src/lib/bunny-host/ma4/collaboration.ts` | Typed versioned protocol `bunny-a.ma4-s2.handoff.v1`. Hub-and-spoke routing through trusted Coordinator with frozen requirements hash, trust labels, artifact registration, and budget enforcement. |
| **Connected Workflow Planning** | `src/lib/bunny-host/ma4/connected-workflow.server.ts` | Planner schema generation, `planConnectedTask` with bounded 2-attempt replanning on hard/soft intent problems, `localReview` executor. |
| **Persistent Task Runtime** | `src/lib/bunny-host/ma4/task-runtime.server.ts` | `PersistentTaskRuntime` backed by `TaskStore`, SQLite transactions, fencing tokens, lease management, exact-once crash recovery, and state transitions. |
| **Task Specifications & Envelopes** | `src/lib/bunny-host/ma4/task-runtime.ts` | `TaskSpecSchema`, `EnvelopeSchema`, `GrantsSchema`, `validateTask`, `approvalRequired`, and `taskView`. |
| **Permission Broker & Receipts** | `src/lib/bunny-host/ma4/action-broker.server.ts` | `brokered` executor wrapper enforcing input schema, resource grants, consequential action proposals with payload hashes, secret redaction, and append-only hash-chained `ActionLedger`. |
| **Registered Tool Connectors** | `src/lib/bunny-host/ma4/connectors/` | `fileConnectors` (`file.read`, `file.list`, `file.stat`, `file.search`, `file.changes`, `file.prepare`, `file.apply`), `browserConnectors`, and service connectors. |
| **UI & Notch Presentation** | `src/components/island/` | Movable Notch (`floating.tsx`, `character-appearance.tsx`), Approval Center (`approvals.tsx`), Task Dashboard (`task.tsx`, `ptasks.tsx`), and Chat landing (`chat-home.tsx`). |

---

## 3. Production Entry Points and the Integration Gap

### The Gap Prior to T3
1. **Chat Submission vs Execution:** Direct user prompts entered in Chat or via `POST /tasks` (`manager.submit()`) recorded an execution plan (`task.executionPlan`) with complexity C0–C3, but ordinary tasks only launched a single Ollama LLM call via `OllamaAdapter`. C1 operations (e.g. `Read NOTES.md`) generated model hallucinations rather than executing real tools (`file.read`). C2/C3 requests recorded team plans (`Planner`, `Worker`, `Reviewer`) but never initialized or ran the team.
2. **Proposals vs Standing Tasks:** The persistent task runtime (`PersistentTaskRuntime`) and action broker were fully capable of executing multi-agent workflows, but were only reached via manual Island proactive forms (`ptask.plan` / `ptask.create`), decoupled from the central chat stream.
3. **Execution Observability:** The Glass Notch displayed active status based on transient task states rather than real Host execution steps and role assignments.

### T3 Unified Execution Architecture
1. **Single Unified Entry Point:** Keep `manager.submit()` and `http.server.ts` as the sole entry point, without introducing any parallel runtime or second authorization layer.
2. **C0 Flow:** Direct conversational answer without tools or team. Fast, local, un-escalated.
3. **C1 Flow:** When a user requests a supported operation (e.g., reading a project file), the Host resolves the registered resource, verifies grants, executes the real Host tool (`file.read`), feeds real output into the generation step, and records receipts.
4. **C2/C3 Flow:** When a user submits a multi-step or complex request, the Host prepares an explicit task proposal (`run with agents`), presents the bounded plan, resources, and models to the owner, and upon owner authorization transitions the plan into an active persistent task driven by the Host Coordinator.
5. **No Parallel Runtime:** Reuse `PersistentTaskRuntime`, `ActionBroker`, `TaskStore`, `ActionLedger`, and `coordinatorChannel` directly.
