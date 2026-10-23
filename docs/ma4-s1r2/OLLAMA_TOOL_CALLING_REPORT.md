# MA4-S1R2 Ollama tool calling — R2-G9

## Classification (five independent conditions)

| Condition | Source of truth | qwen2.5-coder:7b | qwen2.5-abliterate:7b | Qwen3.8-abliterated:27b | qwen3-abliterated:30b |
|---|---|---|---|---|---|
| Model supports tools | Ollama `/api/show` `capabilities` | yes | yes | yes | yes |
| Provider API supports tools | Ollama 0.40.6 `/api/chat` `tools` (≥ 0.3.0) | yes | yes | yes | yes |
| Adapter supports tools | `ma4/ollama-tools.server.ts` `runToolLoop` | yes | yes | yes (untested) | yes (untested) |
| Tool permission granted | existing broker `decide()` per call | per call | per call | — | — |
| Tool execution succeeded (live) | frozen bench `tool-call` category | **0/6** | **0/6** | NOT TESTED (memory) | NOT TESTED (memory) |

A model's self-description never sets any of these. `ollamaToolCapability()` derives the first two from `/api/show` and the version only.

**Disposition:** native tool calling is **implemented** in the adapter layer (`runToolLoop`) and **live-measured as unreliable** on both runnable local models: across 12 tool-call samples neither model emitted a single tool call; they answered directly (coder: 132/120/120 instead of 126 on the arithmetic task and a tool-free 86 on the conversion; abliterate: correct numbers on both but without using the tools, which the frozen check requires). A separate probe (`math.add` vs `math_add`, with and without the system message) also produced no call, so the tool naming and system prompt are not the cause. The general Host `OllamaAdapter` path stays text-only (`ADAPTER_TOOL_CONTRACTS.ollama = false`); filesystem/terminal/git work is never routed to Ollama on the strength of this loop. **R2-G9: PASS (accurately implemented and classified)** — the quality result is a model limitation, not a capability claim.

## Implementation (`src/lib/bunny-host/ma4/ollama-tools.server.ts`)

* Explicit registry of `ToolDefinition { manifest: ActionManifest, schema: zod, run }`; names `^[a-z][a-z0-9_.]{0,63}$`, duplicates refused; JSON Schema sent via `z.toJSONSchema`.
* Per call: shape check → unknown-name refusal (nothing executed) → call-count limit → JSON-string argument parsing → strict schema validation → **`decide(manifest, params, …)`**, the existing permission broker. `deny` → `denied`; `ask` → `approval_required` (an ask is never treated as allow; there is no interactive approval inside the loop).
* Execution with per-tool timeout (min of loop limit and manifest), cancellation via the caller's `AbortSignal`, structured receipts `{index, round, name, status, reason, durationMs, outputChars}`.
* Tool output is data: control/bidi characters stripped, secrets redacted (`redactOutput`), truncated to 4,000 chars, returned as a `tool` message; the system message states tool results are untrusted.
* Served-model mismatch, malformed `tool_calls`, and round exhaustion fail closed.

## Tests (`ma4-tools.test.ts`, 8/8; plus OpenAI-format variants in `ma4-cloud.test.ts`)

valid call · invalid schema · malformed JSON arguments · non-object call · unknown tool · path-like name · denied by a persistent `never_allow` grant · `ask` for an external side effect · missing capability classification · per-tool timeout · call-count limit · multiple calls per round · cancellation mid-tool · prompt injection in tool output (follow-up unknown tool refused, side-effect tool held for approval, secret and bidi override removed) · served-model mismatch · round exhaustion.
