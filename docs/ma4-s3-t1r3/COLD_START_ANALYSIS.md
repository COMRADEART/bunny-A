# Cold start

T1R2 reported a sequential cold gap: candidate 14,093 ms (load 12,759,773,900 ns) versus predecessor 7,902 ms. `git diff bc1c82d 199cf3a -- src/lib/orch/exec.server.ts src/lib/bunny-host/adapters.server.ts` is empty, so that gap is not a change in the generate path.

T1R3 alternated three rounds. Each round unloaded the model (`keep_alive: 0`), ran one C0 chat on the candidate, unloaded again, then ran the same chat on the predecessor at `bc1c82d`. Prompt: "What is the capital of France? Reply with the city name only." Every run completed with "Paris".

| Round | Side | Wall ms | Queue ms | load_duration ns | eval ns |
| --- | --- | ---: | ---: | ---: | ---: |
| 1 | candidate | 7688 | 153 | 6,587,141,700 | 61,715,000 |
| 1 | predecessor | 5245 | 147 | 4,295,450,400 | 57,870,000 |
| 2 | candidate | 5312 | 159 | 4,317,361,900 | 55,987,000 |
| 2 | predecessor | 5351 | 144 | 4,377,277,400 | 54,965,000 |
| 3 | candidate | 5332 | 148 | 4,341,723,500 | 56,153,000 |
| 3 | predecessor | 5228 | 150 | 4,292,847,600 | 63,050,000 |

Queue stays about 150 ms on both sides. After round 1, wall time matches within about 120 ms and load time matches within about 85 ms. The wall time is the Ollama `load_duration`, not Host queueing and not inference (eval is about 55–63 ms).

Round 1 candidate was the outlier (7,688 ms, load 6.59 s) while `nvidia-smi` already showed about 282 MiB used and 45% GPU utilization. Rounds 2 and 3 were about 273–275 MiB. This does not establish GPU preemption. It does show the T1R2 14 s versus 7.9 s gap does not reproduce when the two builds alternate after an unload.

No further cold-start change was made. The 15% warm goal from T1R2 remains unmet (14.0%). These cold numbers are not a claim that the warm goal was reached.

Generate still does not set `keep_alive`. Ollama's default applies.
