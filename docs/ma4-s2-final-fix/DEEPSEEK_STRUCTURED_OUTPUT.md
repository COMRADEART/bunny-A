# DeepSeek-R1 & Reasoning Model Structured Output Analysis

**Product:** Bunny A by LOKAM  
**Milestone:** MA4-S2 Remediation  
**Scope:** Ollama reasoning-model interaction with grammar-constrained JSON Schema

---

## 1. Background & Reported Failure

During baseline testing (`deepseek-r1:7b`):
- Prompt-injection security invariants: **8/8 PASS**
- Functional evaluation: **FAILED (Timeout at 90s)**
- Investigation target: Interaction between reasoning trace (`<think>`) and Ollama's grammar-constrained JSON decoding (`format: { type: "object", ... }`).

---

## 2. Technical Investigation & Root Cause

### A. Ollama Grammar-Constrained Decoding Mechanism
Ollama utilizes llama.cpp's GBNF grammar engine to enforce structured JSON output. When a JSON schema is provided in `/api/generate` via `format`, the grammar requires the output token sequence to strictly conform to the JSON grammar beginning with the opening brace `{`.

### B. Reasoning Models (`deepseek-r1`) Behavior
Models trained with reinforcement learning / chain-of-thought (e.g., DeepSeek-R1) generate reasoning tokens enclosed in `<think> ... </think>` before emitting the final answer.

When grammar constraints force the token generation to immediately begin matching JSON grammar:
1. The model's primary probability distribution pushes to emit `<think>`.
2. The grammar mask suppresses `<think>` and forces `{`.
3. The model's internal attention context lacks its necessary reasoning trace, leading to:
   - Catastrophic logit distortion.
   - Repetitive loops or degenerate token generation.
   - Severe latency spikes exceeding the 90-second timeout.
4. If `<think>` tokens manage to bypass the parser or are prepended, the resulting text fails `JSON.parse()` and is rejected.

### C. Ollama Parameter Support Probe
Probing the local Ollama instance (`v0.40.9`) with `qwen2.5-coder:7b`:
```json
POST /api/generate
{
  "model": "qwen2.5-coder:7b",
  "prompt": "...",
  "think": true
}
```
Response:
```json
{"error": "\"qwen2.5-coder:7b\" does not support thinking"}
```
Conversely, passing `think: false` when requesting structured output (`format`) instructs Ollama to disable reasoning blocks for models that support it, avoiding the token budget depletion and grammar conflict.

---

## 3. Policy & System Defense

1. **Host-Side Enforcement in `src/lib/orch/exec.server.ts`:**
   Whenever `request.format` is present (structured JSON generation for Planner and Reviewer), the Host automatically injects `think: false`:
   ```ts
   body: JSON.stringify({
     model,
     prompt: request.prompt,
     stream: !!options.stream,
     ...(request.format ? { format: request.format, think: false } : {}),
     ...
   })
   ```

2. **Model Eligibility & Hard Pin Policy:**
   - **`qwen2.5-coder:7b`** is the officially qualified and pinned local model for structured planning and review in MA4-S2.
   - **`deepseek-r1:7b`** is **NOT APPROVED** as a structured JSON Planner in the current release due to:
     a) Unpredictable reasoning latency under real-time UI constraints (90s timeouts).
     b) Incompatibility between deep chain-of-thought tokens and strict JSON Schema grammar enforcement in local runtimes.
   - Per security rule D1, hard pins are strictly enforced: an unqualified model is never substituted, and unpinned reasoning models are refused at admission.
