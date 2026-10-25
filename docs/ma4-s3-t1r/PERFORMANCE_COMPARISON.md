# Performance comparison

No 15% improvement is claimed. The live numbers are one model on one machine. T1 does not skip verification to shorten them.

## What was the same

Hardware, Ollama 0.40.9, model id, digest, Q4_K_M, and the holdout prompts. The predecessor and T1 were not given two separate answer runs. A second run would have measured the same weights again.

## Latency of the pinned 7B

From `evidence/live.json` (latest run):

| Sample | Time |
| --- | --- |
| Cold H-C0-01 | 4466 ms, load about 4.5 s of that |
| Warm median | 293 ms |
| Warm range | 159–448 ms |
| Tokens | 2 or 3 evaluated tokens on these short replies |

Queue wait inside the Host was not measured. These calls went straight to Ollama.

## Routing cost, not speed

On an installed preference other than the current model, T1 selects that preference and the predecessor does not. That can change which weights run. It was not timed, because the answer set was pinned to the 7B digest so the comparison would not silently change models.

Planned model calls from `classifyTask` are 1 for C0, 0 for C1, 2 for C2, and 3 for C3. Those are policy numbers. The offline C1 and C2 fixtures completed with 0 model calls. The predecessor has no `classifyTask`, so there is no paired count from `bc1c82d`.

## Memory during the contention probe

One resident model: size 6,842,010,828 bytes, reported VRAM 4,201,329,459 bytes. RAM of the Host soak was about 118 MB and was not part of this probe. No second model was loaded.
