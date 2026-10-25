# Resource contention

## What ran

1. A background `generate` of 80 tokens on `huihui_ai/qwen2.5-abliterate:7b`.
2. An interactive `generate` of 8 tokens started 200 ms later.
3. A separate stream abort (`evidence/live.json`): first chunk, then `AbortController`. `AbortError` at 246 ms. The model was still resident afterward. A following call with `keep_alive: 0` asked the runtime to unload.
4. Policy checks in `ma4-s3-t1r.test.ts`: a P0 control sorts ahead of P1 and P3 inference, control is admitted even when the memory budget does not fit, and memory failure does not substitute a model.

## What the runtime did

| Call | Result |
| --- | --- |
| Interactive wall time | 8126 ms |
| Background wall time | 8645 ms |
| Interactive text | `4` |
| Resident VRAM | 4,201,329,459 bytes |

The short call waited for the long call. Ollama serialized them. This does not show GPU preemption, NPU inference, or a Host Stop button cutting in front of admission.

Lower-priority starvation is still possible at the runtime: the interactive request had no priority over the background request. The Host queue orders a P0 stop first. That ordering was not executed against a live Host task in this pass.

OOM was not injected. No claim is made that an out-of-memory failure was observed. `onMemoryFailure()` still releases the reservation and selects no other model.

The 24-hour soak on port 43192 was not used for this probe.
