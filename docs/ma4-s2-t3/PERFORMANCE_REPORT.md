# MA4-S2-T3 — Performance report (T3-G15)

## 1. Pre-registration (frozen before the decisive run; committed separately)

Baseline: `scripts/ma4-s2t3/bench.mjs --idle-s 60` → `evidence/bench-baseline.json` (this laptop, Node 24.18.0,
Windows 11, real Host process, real timers, recorded fake model). Baseline values: idle Host 0.10–0.18 % of one core;
with 8 monitors + 10 schedules + 1 goal 0.13–0.18 %; heap +2.9 MB; lateness p95 16–17 ms; restart 40 ms.

Targets are set with margin above the baseline and will **not** be relaxed after the decisive run:

| # | Metric | Target |
|---|---|---|
| P1 | Scheduler lateness while the Host is awake (10 one-time slots found by the engine's own timer) | p95 ≤ 1,000 ms and max ≤ 2,000 ms |
| P2 | Restart recovery (Host start → proactive state served) with 21 schedules + 8 monitors | ≤ 2,000 ms, 0 duplicate or unexpected tasks |
| P3 | Idle CPU with 8 monitors + 10 schedules + 1 goal, 60 s window | ≤ 1.0 % of one core |
| P4 | Idle heap overhead of that proactive load vs the idle Host | ≤ 20 MB |
| P5 | Monitor checks in a 60 s window, 8 monitors at the 60 s policy minimum | ≤ 16 (≤ 2 per monitor) |
| P6 | Model calls during idle monitoring and unchanged observations | 0 |
| P7 | Model calls per completed scheduled summary (Worker + Reviewer) | = its 2 GPU steps |
| P8 | Duplicate consequential executions in the tested crash scenarios | 0 |
| P9 | Duplicate notifications for one event identifier | 0 |
| P10 | Unauthorized external actions / permission violations | 0 |
| P11 | Tasks resumed after revoked or expired authority | 0 |
| P12 | Persistent high-frequency polling while idle | none: idle wake interval = the 60 s maximum sleep |

P8–P12 are measured by the qualification suites (`ma4-s2t3.test.ts`, `ma4-s2t3-scenarios.test.ts`), not the bench.
Energy and battery impact: **not measured** — no reliable battery/thermal sensor is read by the Host on this laptop;
declared here, before the run, rather than estimated afterwards.

## 2. Decisive run

_Recorded after the pre-registration commit; see §2 below once filled._
