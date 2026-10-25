# Performance telemetry

`projectLocalPerformance()` renders a row as `unavailable` when the value is null. It does not substitute zero. `sanitizeSample()` drops non-numeric telemetry the same way. `retainTelemetry()` keeps the last 200 events and does not store prompt text.

The Settings page, under Runtime diagnostics, shows Local performance from the Host sample and the active task:

- active local model, only when the running provider is Ollama
- selection mode from the task constraints
- active agents: unavailable, because this Host snapshot does not carry a live role list
- task state, queue count, CPU, RAM, VRAM, verification

CPU utilization stays unavailable until a second sample exists. That is the existing sampler rule. VRAM stays unavailable when `nvidia-smi` did not return a used-memory figure.

Privacy: the helper stores counts and timings, not file contents. The view reads the in-memory Host snapshot the UI already holds.
