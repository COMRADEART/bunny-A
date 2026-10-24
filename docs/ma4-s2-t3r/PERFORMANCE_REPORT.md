# MA4-S2-T3R — Performance and resource report

**Gate T3R-G15: PARTIAL / IN PROGRESS** — every measured interactive number is within bounds; the long-run memory
criterion is decided only when the 24 h soak ends.

## Interactive and lifecycle

| Measure | Value | Source |
|---|---|---|
| Schedule preview (Host) | sub-second in the browser runs | `ui-evidence.json` |
| Real-model Worker + Reviewer task (7B, warm) | 5.8 s end to end | `model-smoke.json` |
| Cancel a running generation (installed) | 2.7 s to CANCELLED | `installed/gaps.json` |
| Pause during generation | at the next step boundary (41.6 s in the smoke) | `model-smoke.json` |
| Installed Host recovery after a kill | 6.1 s to a new healthy pid | `installed/lifecycle-final.json` |
| Phone reconnect after a Host relaunch | ~25 s after the Host was back (client back-off) | `android/round2.json` |
| Phone foreground resume | ~4 s to Live | `android/round2.json` |

## Real-clock soak (interim, 2.4 h of 24 h)

| Criterion (pre-registered) | Interim |
|---|---|
| S4 trigger latency p95 ≤ 5 s, max ≤ 120 s | p95 16 ms, max 16 ms (n = 4) |
| S5 memory growth ≤ 50 MB / 24 h after each Host's first hour | **not yet meetable**: 82 → 92 MB private over 1.4 h; only 0.4 h past the first hour, extrapolates to 203 MB/day — decided at the end |
| S6 idle CPU | median 0.49 %, p95 0.70 % of one core |
| S7 handles | flat at 258 |
| S11 orphaned processes | 0 (max 2 children) |

The model is never called by the soak workload, so these are Host-only costs. Model cost per scheduled summary is bounded
per run by `maxModelCalls`, `maxWallMs` and runs-per-day (T3-A6).
