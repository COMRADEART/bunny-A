# Model memory and keep-alive

`warmDecision()` retains an interactive model only when a measured warm start is at least 50 ms faster than cold, the idle time is under 120 seconds, and the caller says the budget still holds. Background work and a keep-alive with no request release the model.

On this workstation the same one-word prompt took 7383 ms cold and 356 ms warm on `qwen2.5-coder:7b`. That is a measured benefit. The resident size was 6.8 GB against 6141 MiB dedicated VRAM, so a second 7B model does not fit the observed GPU. After the measurement, `ollama stop` cleared `ollama ps`.

No background generation was left running.
