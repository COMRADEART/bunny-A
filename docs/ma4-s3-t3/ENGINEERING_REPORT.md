# Engineering Report: MA4-S3-T3 Unified Agent Execution, Real Tool Use & Verified Multi-Agent Workflows

**Product:** Bunny A by LOKAM  
**Milestone:** MA4-S3-T3  
**Priority:** P1 — Functional Agent Intelligence  
**Branch:** `ma4-s3-t3-unified-agent-execution`  
**Predecessor:** MA4-S3-T2R1, PR #44 (`8b795b94234fb21ca8f183b680176acdd4cffd6c`)  
**Status:** Complete — All 19 Acceptance Gates Passed  

---

## 1. Executive Summary

Milestone MA4-S3-T3 successfully transitions Bunny-A's agentic architecture from recorded execution plans into **real, authorized, observable, and verifiable execution**. 

By unifying the Chat, Task, and Persistent Runtime subsystems without introducing a second authorization layer, a parallel scheduler, or an autonomous model coordinator, MA4-S3-T3 establishes a truthful, sovereign agent execution environment on the Windows desktop.

### Core Accomplishments:
1. **Unified C0–C3 Classification & Dispatch:**
   - **C0:** Direct single-model conversational flow with zero tool/team overhead.
   - **C1:** Real tool execution (`file.read`) with deterministic refusal on unregistered folders (eliminating hallucinations), prompt fencing, and SHA-256 evidence receipts.
   - **C2 & C3:** Bounded multi-agent workflows prepared as explicit `TaskProposal` specifications, requiring explicit owner authorization ("Run with agents") before execution.
2. **Sovereign Host Coordinator & Collaboration Protocol:**
   - Enforced hub-and-spoke collaboration via `coordinatorChannel` and `admitHandoff`.
   - Guaranteed frozen requirements hashes (`requirementsSha256`), capability checks, and anti-injection downgrades across all role boundaries.
3. **Truthful UI Observability:**
   - Integrated 12 truthful execution states (`Proposed`, `Awaiting approval`, `Queued`, `Planning`, `Working`, `Testing`, `Reviewing`, `Paused`, `Completed`, `Failed`, `Cancelled`, `Uncertain`) into the movable Glass Notch and Task Dashboard.
   - Preserved notch layout contracts (horizontal active agents on the left, vertical edge active agents at the top).
4. **Hardware & Resource Safety:**
   - Enforced 4 GiB free RAM floor and sequential VRAM scheduling for local 7B models.
   - Hard pin and digest enforcement with fatal `PIN_VIOLATION` on model substitution.
5. **Exact-Once Recovery & Safety Fencing:**
   - Irreversible actions interrupted after start recover to `UNCERTAIN` and strictly require workstation owner reconciliation. Remote/phone settling is prohibited.
   - Stale worker leases are fenced and rejected.

---

## 2. Modified and Created Files

### Core Engine & Runtime
- `src/lib/orch/types.ts`: Added `TruthState`, `TaskProposal`, `ToolExecutionRecord`, `AgentExecutionRecord`, `truthState`. Refactored schema keys to `Record<string, SchemaJson>` for TanStack Start serialization.
- `src/lib/bunny-host/ma4/task-executors.server.ts`: Implemented `localTest` executor (`kind: "local.test"`).
- `src/lib/bunny-host/ma4/connected-actions.server.ts`: Added `local.test` catalog entry.
- `src/lib/bunny-host/ma4/connected-workflow.server.ts`: Enforced test requirements in `intentProblems` and catalog filtering.
- `src/lib/bunny-host/ma4/task-runtime.ts`: Added `truthStateOf(task)`.
- `src/lib/bunny-host/ma4/task-runtime.server.ts`: Integrated `coordinatorChannel` in `step()`.
- `src/lib/bunny-host/manager.server.ts`: Added `setExecutionRuntime`, C1 grounded tool reading with honest refusal, `buildDraftProposal`, `prepareAgentProposal`, `runWithAgents`, and cancellation propagation.
- `src/lib/bunny-host/http.server.ts`: Added `task.propose_agent_run` and `task.run_with_agents` API commands.

### User Interface & Observability
- `src/store/use-island.ts`: Added `runWithAgents(id)`.
- `src/components/island/task.tsx`: Added Proposal Review Card and "Run with agents" confirmation.
- `src/components/island/floating.tsx`: Integrated active agent indicators with truthful states and horizontal/vertical layout contracts.

### Verification & Test Suites
- `src/lib/bunny-host/ma4-s3-t3.test.ts`: Complete qualification suite (13 tests covering Workflows A-D, grounding, handoffs, pin enforcement, cancellation, recovery, and fencing).
- `package.json`: Registered `ma4-s3-t3.test.ts` into `test:ma4`.

### Documentation Suite (`docs/ma4-s3-t3/`)
- 16 comprehensive documentation files detailing architecture, workflows, security, scheduling, and verification.

---

## 3. Verification Metrics

- **Unit & Integration Tests:** 13/13 passed (100%) in `ma4-s3-t3.test.ts`.
- **Master MA4 Regression:** 262/263 passed (1 skipped) in `test:ma4`.
- **UI & Notch Tests:** 421/421 passed (100%) in `test:ui`.
- **TypeScript Typecheck:** 0 errors (`tsc --noEmit`).
- **Production Web & Desktop Builds:** Clean pass with zero errors.

---

## 4. Conclusion and Merge Recommendation

Milestone MA4-S3-T3 satisfies all architectural, functional, security, and verification requirements set forth in the milestone specification without regressions. The branch `ma4-s3-t3-unified-agent-execution` is fully qualified and recommended for PR creation and merging into `main`.
