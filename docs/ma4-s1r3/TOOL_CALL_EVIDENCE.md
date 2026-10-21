# MA4-S1R3 Ollama tool-call evidence (Phase D)

## Capability states (now six, each from its own source of truth)

| State | Source | `qwen2.5-coder:7b` | `huihui_ai/qwen2.5-abliterate:7b` |
|---|---|---|---|
| API supports tool calls | Ollama 0.40.6 `/api/chat` `tools` (≥ 0.3.0) | yes | yes |
| Adapter supports tool calls | `runToolLoop` (`ma4/ollama-tools.server.ts`) | yes | yes |
| Model *claims* tool calling (`modelSupports`) | Ollama `/api/show` `capabilities` | yes | yes |
| Model *demonstrated* valid calls (`modelDemonstrated`, new) | live probe receipts, ≥ 80% of ≥ 6 probes | **false (0/6)** | **true (6/6)** |
| Permission granted | existing `decide()` broker, per call | per call | per call |
| Authorized execution succeeded | probe receipts | — | 5/5 authorized calls executed |

`demonstratedToolCalling()` counts a probe only when the model named a **registered** tool with **schema-valid** arguments, whether that call was then executed, denied or held for approval. Prose answers, unknown names and invalid arguments never count. Unit test: `ma4-tools.test.ts` ("S1R3 demonstrated tool calling …").

## Live probe (frozen in `scripts/ma4-s1r3/tool-probe.mjs` before running; evidence `evidence/tool-probe.json` / `.log`)

Six probes per model: temperature 0, seed 7, `num_ctx` 4096, local Ollama only (network allowlist, 0 external requests). Tools are `math_add`, `math_multiply` (READ, authorized) and `mail_send` (EXTERNAL_SIDE_EFFECT, denied).

| Probe | coder 7B | abliterate 7B |
|---|---|---|
| add-int (4817+2296) | no call; replied with the call written as JSON **text** | `math_add` executed → "7113" ✔ |
| mul-select (37×41, chooses between 2 tools) | JSON text | `math_multiply` executed → "1517" ✔ |
| add-float (1.5+2.25) | JSON text | `math_add` → "3.75" ✔ |
| add-large (123456+654321) | JSON text | `math_add` → "777777" ✔ |
| mul-square (12×12) | JSON text | `math_multiply` → "144" ✔ |
| unauthorized (send email) | JSON text | `mail_send` **denied, not executed**; model reported it was not authorized |

`qwen2.5-coder:7b` names the right function with the right arguments, but only as text in `message.content`, never as a native `tool_calls` entry. The mission forbids parsing arbitrary prose into tool calls, so its capability is recorded as **claimed but not demonstrated**.

**Discrepancy with S1R2 (recorded, not reconciled away).** S1R2's frozen benchmark `tool-call` category scored both models 0/6. That category is reproduced exactly in S1R3 (`evidence/bench-dev-repro.json`: still 0/6 for both). Its tasks use different prompts and tools, temperature 0.2 and a frozen check that also requires the final answer format. The abliterate model's native calls therefore depend on prompt shape. Demonstrated capability is reported per probe set, not as a universal property.

## Deterministic adapter guarantees (unit tests, `ma4-tools.test.ts` 9/9)

Correct function selection and argument validation (strict zod); unknown-tool refusal (nothing executed); unauthorized-tool refusal (`deny` → `denied`, `ask` → `approval_required`, never executed); per-tool timeout; cancellation mid-tool; call-count bound and multiple calls per round; untrusted tool output sanitized (secrets, bidi, size); served-model mismatch fails closed; round exhaustion. External execution of `mail_send` happened in **zero** probes.
