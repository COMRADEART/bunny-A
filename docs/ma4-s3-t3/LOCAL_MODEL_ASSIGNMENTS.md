# Local Model Assignments, Pin Enforcement and Admission Policy

## 1. Operating Environment & Hardware Constraints

Bunny-A is designed to operate on consumer and workstation hardware. A reference development laptop typically possesses a dedicated GPU with 6 GiB to 8 GiB of VRAM.

### Key Operational Constraints:
1. **No Concurrent Multi-Model Residency:** Simultaneous residency of two 7B/8B parameter models in GPU VRAM causes severe paging to system RAM or out-of-memory driver crashes.
2. **Sequential Model Scheduling:** The Host inference scheduler groups execution steps so that identical models run sequentially, avoiding expensive thrashing of model weights in VRAM.
3. **No Automatic Cloud Fallback:** Unapproved external API offloading is strictly prohibited. The system remains fully local and private unless an explicit remote provider is configured and granted by the user.
4. **No Silent Downloads:** Models are never fetched or pulled without explicit workstation user confirmation.

---

## 2. Role-Based Model Assignments

The Host Coordinator assigns qualified models based on role requirements and measured reliability:

| Role | Primary Responsibility | Context Window Requirement | Default Model Assignment |
|---|---|---|---|
| **Planner** | Task decomposition, DAG step generation | 8k+ tokens | Fast reasoning / structured JSON model (e.g., `qwen2.5-coder:7b`) |
| **Worker** | Code implementation, file modification proposals | 8k-16k tokens | Specialized coding model (e.g., `qwen2.5-coder:7b` / `deepseek-coder:6.7b`) |
| **Tester** | Unit test creation, test suite execution, criteria validation | 8k tokens | Code & logic model with verified deterministic output |
| **Reviewer** | Semantic critique, contract adherence verification | 8k tokens | High-parameter instruction model with strict JSON formatting |

---

## 3. Hard-Pinning and Digest Enforcement

When a task envelope specifies a pinned model:
```typescript
envelope: {
  models: ["qwen2.5-coder:7b@sha256:d8c2..."],
  localOnly: true
}
```

### Pin Enforcement Invariants:
1. **Zero Silent Substitution:**
   - If the exact pinned model is unavailable, the Host **fails closed** immediately. It never silently substitutes another model (e.g., falling back from a 7B model to a 1.5B model).
   - If an adapter returns a response where `servedModel !== requestedModel`, the runtime raises a fatal `PIN_VIOLATION` error and halts the entire task.
2. **Digest Verification:**
   - Where a digest is pinned, the Ollama model digest is verified against the host registry before inference is admitted.
3. **Budget and Call Caps:**
   - Each role's execution is bounded by `budgets.maxModelCalls` and `budgets.maxWallMs`.
   - Idle or uncalled roles do not increment the model call ledger. Only completed, verified inference invocations count.

---

## 4. Inference Admission Gate & Stop Priority

All model calls pass through `gateCalls` in the Host Coordinator:
- **Stop Priority:** An interactive Stop command or cancellation signal immediately aborts any in-flight inference call via `AbortController`. The inference engine ceases token generation within 50 ms.
- **Resource Floor:** The Host verifies that system free memory exceeds the 4 GiB floor before launching an inference worker. If resources are below the floor, the task enters `PAUSED` state with reason `RESOURCES_UNAVAILABLE` rather than crashing the operating system.
