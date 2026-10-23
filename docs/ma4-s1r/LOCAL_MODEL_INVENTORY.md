# Local model inventory

Base: `f5d3f90`. Observed: 2026-10-20T22:05:11.191Z. Runtime: Ollama 0.40.6, native HTTP API. Source: `evidence/inventory.json`.

| Installed identifier | Weight bytes | Context (reported) | Classification / execution |
|---|---:|---:|---|
| `deepseek-v4.1-flash:cloud` | 326 | 1048576 | Cloud proxy: BLOCKED, no inference approval |
| `huihui_ai/qwen2.5-abliterate:7b` | 4683087428 | 32768 | Local: tested sequentially |
| `huihui_ai/Qwen3.8-abliterated:27b` | 17741871954 | 262144 | Local: SKIPPED, unsafe current memory margin |
| `huihui_ai/qwen3-abliterated:30b` | 18556699290 | 40960 | Local: SKIPPED, unsafe current memory margin |
| `qwen2.5-coder:7b` | 4683087561 | 32768 | Local: tested sequentially |

Each full model digest, quantization and capability list is retained in the sanitized inventory. The two 7B models are 7.6B-parameter Q4_K_M GGUF weights. No model was downloaded. The 27B/30B weights exceed the initial free-RAM margin; no overcommitment experiment was attempted.

Bounded read-only discovery used `ollama --version`, `ollama list`, `ollama ps`, `GET /api/version`, `GET /api/tags`, `POST /api/show`, `GET /api/ps`. Successful real generation and streaming used `POST /api/generate`; the native tool-proposal experiment used `POST /api/chat`. Context was capped to 2,048 for qualification, rather than claiming the 32K training window fits current VRAM.

No `lms`, `llama-server`, or `llama-cli` command or standard LM Studio/Jan application directory was found. One-second probes of `/v1/models` on loopback ports 1234, 5000, 8000 and 8082 found no alternative serving runtime. This is bounded discovery, not an exhaustive disk search. Existing Python packages include PyTorch, Transformers and OpenVINO; no additional Bunny serving adapter was activated. OpenVINO exposes CPU, GPUs and NPU; that is device enumeration, not model inference qualification. See `evidence/additional-runtimes.json`.

Runtime metadata advertises tools for both 7B models, but the product Ollama adapter is text-only. The native coder tool trial is FAIL: no authorized calculator tool-call object was returned. No arbitrary tool executor was introduced.
