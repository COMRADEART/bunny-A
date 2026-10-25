# GPU contention

Two windows were sampled. Neither is a preemption test. This Host does not expose a GPU preemption control, and none is claimed.

## Window A, long generate still running

A 400-token generate was running. `nvidia-smi` reported the RTX 4050 at 210 MiB used of 6141 MiB, utilization 26%, against an idle sample of 210 MiB and 15%. Free physical memory was 10,318,568 KB of 33,150,328 KB visible. A foreground chat on the same pinned 7B completed in 31,557 ms with queue wait 127 ms and the output `Foreground.` The interactive request was not rejected, and it was much slower than the 1,095 ms warm median measured without that background job.

The Host Stop issued at the end of this window arrived after the long task had already completed. That sample is not a cancellation. Closing the HTTP client returned in 272 ms and the 7B stayed resident. An HTTP abort is not a Host task stop.

## Window B, stop while the long generate was running

`nvidia-smi --query-gpu=memory.used,utilization.gpu` returned `4305, 23` (4305 MiB used, 23% utilization). Ollama `/api/ps` listed the same 7B with `size` 6,842,010,828 and `size_vram` 4,201,329,459. In this window Ollama reported the model in VRAM. Window A did not. The samples are both recorded; they are not the same residency.

The foreground chat submitted while that generate was in `running` completed in 1,220 ms, queue 206 ms, output `Foreground.`, on the pinned 7B. The background task was then stopped, so this foreground time does not show how a still-running background job shares the GPU. Window A is the overlap measurement.
