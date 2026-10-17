# M-A-3 T14 — Performance

**Machine.** Intel Core Ultra 9 185H, 22 logical CPUs, 31.6 GiB RAM, Windows 11, Node v24.18.0.

**Harness.** `test-results/ma3-t14/harness/perf.ts`. The raw output is in `test-results/ma3-t14/perf/perf.json` and
`perf.log`.

The harness runs the real Host, MissionManager, TaskManager, Capability Bus, SQLite and HTTP surface. Model I/O is a
scripted stand-in (SIMULATED), so these numbers are the Host's own overhead: they exclude model latency. They come from
one machine, and no claim of universal performance is made.

## Mission layer (in-process)

| Measure | n | Median | p95 | Max |
| --- | --- | --- | --- | --- |
| Planning: `mission.create` with a 2-step explicit plan | 40 | 23.4 ms | 26.9 ms | 27.8 ms |
| `approve()` call | 40 | 20.3 ms | 29.0 ms | 29.7 ms |
| Dispatch: approve → provider launch | 40 | 104.3 ms | 113.9 ms | 122.6 ms |
| 2-step run: first finish → Mission completed | 40 | 165.6 ms | 179.2 ms | 186.4 ms |
| Fallback: provider loss → launch on another provider | 15 | 112.9 ms | 124.7 ms | 124.7 ms |

**Persistence.** SQLite grows by about 60 KB per completed 2-step Mission: 4 KB → 2.42 MB over 40 Missions. That covers
missions, steps, attempts, envelopes, events and memory.

## Host HTTP surface (four Personal Agents)

| Measure | n | Median | p95 | Max |
| --- | --- | --- | --- | --- |
| `/state` request with 4 running Missions | 30 | 28.9 ms | 31.8 ms | 32.3 ms |
| Derived worker: `worker.propose` → child running | 4 | 164.4 ms | 173.7 ms | 173.7 ms |
| Widget status latency: provider finishes → `/state` shows the step past running | 4 | 115.2 ms | 117.4 ms | 117.4 ms |
| Lotus recall with 200 memories (`lotus.recall`, limit 12) | 30 | 32.1 ms | 43.3 ms | 45.9 ms |

| Measure | Value |
| --- | --- |
| Host boot (first start, empty state) | 2,080 ms |
| Restart: close → serving again, same state | 160 ms |
| Idle Host, 10 s, nothing running | 0.94 % of one core (78 ms user + 16 ms system); RSS 129.6 MiB |
| Four-Agent run: 4 parents + 4 derived workers to completion | 734 ms user + 406 ms system CPU; RSS 146.9 MiB |
| Peak RSS (whole harness process) | 155.7 MiB |
| Duplicate dispatches | 0 |

## Notes

- **Concurrency.** Concurrency is bounded by policy, not by capacity. The defaults are:

  | Limit | Default |
  | --- | --- |
  | Live steps per Personal Agent | 2 |
  | Shared live steps across Agents | 4 |
  | Steps per Mission | 3 |
  | Active Missions | 4 |
  | Open workers per parent | 3 |

  T14-B measured three workers overlapping, at worker spans 0–3,754 ms, 353–4,045 ms and 405–4,112 ms, once the owner
  raised Gada's per-Agent cap.
- **Crash recovery.** In T14-F, restart to a reconciled state took 385 ms with a held parent and a held worker. Nothing
  was re-dispatched.
- **Resident processes.** T14 adds no resident process. Workers are child Missions inside the Host process. Their skill
  steps run as short-lived owned child processes (`npm test`).
- **Before and after.** No comparable "before" run exists for the derived-worker or completion-hold paths, because they
  did not exist. The general Mission paths are unchanged code, so no regression is claimed or measured beyond the full
  regression suite.
- **Not measured.** GPU, frame times, live model latency, and multi-hour endurance. T14-L uses an accelerated clock and is
  not an endurance run.
