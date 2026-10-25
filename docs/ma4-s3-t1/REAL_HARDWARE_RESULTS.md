# Real hardware results

Same machine as `HARDWARE_CAPABILITY_AUDIT.md`. One local model, no cloud call.

Prompt: `Reply with the single word pong.` Model: `qwen2.5-coder:7b` digest id `dae161e27b0e`.

| Run | Wall time | Answer | Processor after the cold load |
| --- | --- | --- | --- |
| Cold, including load | 7383 ms | `Pong` | 39% CPU / 61% GPU, 6.8 GB, context 32768, llamacpp |
| Warm, model already resident | 356 ms | `pong` | same resident row |

The model was stopped with `ollama stop` after the warm run. `ollama ps` was empty afterward. This was not left running to keep the GPU active.

There is no paired baseline on the pre-T1 router for this prompt, so these numbers are a candidate measurement only. They are not a 15% latency claim. GPU acceleration is partial: `ollama ps` showed a CPU/GPU mix, not a pure GPU run. NPU execution was not measured.

Android on-device inference was not added.
