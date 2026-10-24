# MA4-S2-T3R1 — Planner model-pin analysis (gate R1-G6)

## Symptom (T3R Phase H)

With the real pinned `qwen2.5-coder:7b`, `ptask.plan` returned steps `file.read → local.generate → local.review` but both
model steps had no `model`; the Host answered "Step 2 needs a pinned local model." / "Step 3 needs a pinned local model."
and created nothing. The refusal was the correct safety outcome; the plan was unusable.

## Layers inspected

| Layer | Finding |
|---|---|
| Structured-output schema (`PLAN_SCHEMA`, `connected-workflow.server.ts`) | **Root cause.** `model` was optional and typed `string \| null`; `kind` was any string; `input` any object. With grammar-constrained decoding the 7B model takes the cheapest valid path: it omitted `model`. |
| Planner prompt contract | Said "model steps need `model` set to a pinned model" and listed the pins, but nothing enforced it. |
| Agent-role model assignments | Correct: the Planner call itself is pinned (`ptask.plan` refuses a Planner model outside the envelope; the served model is checked against the pin). |
| Hard-pin propagation | Correct: a task's step pins are copied verbatim into the stored spec and re-checked by `validateTask` and at dispatch (`MODEL_UNAVAILABLE`, `PIN_VIOLATION`). |
| Proposal parsing / validation | Correct and unchanged: `TaskSpecSchema` + `validateTask` refuse a missing pin, a pin outside the envelope and a cloud tag. |
| Response normalization | None, by design. A missing or wrong pin is **never filled in or replaced** by the Host. |
| Restart / persistence | Pins survive restart unchanged (real-model X8). |

## Fix (two iterations, both pre-registered runs recorded)

- **v1 (`61673e2`)** — the format is built per request from Host facts: only granted catalog actions; a model step must
  name one of the envelope's pinned models (`enum`), a non-model step names `null`; `model` is required. The pins come
  from the trusted Host (the envelope), never from the model. Run 1: every proposal carried the right pins, but the free
  `input` object let the model write `maxChars: null` (refused by the connector), and it added unrequested review steps.
- **v2 (`4dd1d43`)** — one format branch per granted action carrying that connector's own zod input contract as JSON
  Schema (optional fields may be left out, never null; unknown fields not allowed); the prompt asks for a review step only
  when the owner asks for a check.

Validation was not loosened in either iteration. The format only steers decoding; a model (or a fake) that ignores it is
still refused (T3R1-P2: `null`, `llama3:70b` and the cloud tag are each refused and never re-pinned).

## Tests

- `T3R1-P1` — the format offers only granted actions with their own inputs, model steps only the envelope's pins, and
  nothing when no action is granted.
- `T3R1-P2` — the exact format is sent with the Planner call; missing, wrong and unauthorized pins in the answer are
  refused, never repaired; planning creates no task.
- Existing `T2-X11` (Planner abuse: injected recipients, invented actions, substituted served model) passes unchanged.

Real-model results: `REAL_MODEL_VALIDATION.md`.
