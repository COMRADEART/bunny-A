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

Pre-registration commit `a96acd8`; decisive run on the same code (no tuning in between), same command,
`evidence/bench-decisive.json`. Nothing else heavy ran at the same time (the full regression started afterwards).

| # | Result | Target | Verdict |
|---|---|---|---|
| P1 | lateness n = 10: p50 5 ms, p95 20 ms, max 20 ms (raw 3, 7, 11, 5, 15, 3, 9, 2, 3, 20) | p95 ≤ 1,000, max ≤ 2,000 | **met** |
| P2 | Host start 30 ms, state served 38 ms; 21 schedules, 8 monitors; 0 duplicate, 0 unexpected tasks | ≤ 2,000 ms, 0 | **met** |
| P3 | 0.130 % of one core with the load (idle Host alone: 0.287 % in this window — both are noise-level) | ≤ 1.0 % | **met** |
| P4 | heap 28.9 MB vs 25.9 MB idle → +3.0 MB | ≤ 20 MB | **met** |
| P5 | 8 checks in 60 s (one per monitor) | ≤ 16 | **met** |
| P6 | 0 model calls during monitoring | 0 | **met** |
| P7 | scheduled summary: 2 model calls (Worker, Reviewer), 3 step receipts, slot → COMPLETED 1,084 ms (fake model) | = 2 | **met** |
| P8 | 0 duplicate consequential executions: T3-A9 (`sent.length` 1 across a mid-action Host death and the next day's slot), T3-A3, T3-S3, T3-S7, E2E-D (`w.sent` 1 across approve/deny/expire/cancel/restart) | 0 | **met** |
| P9 | 0 duplicate notifications: T3-A4 (unique keys across 3 restarts), T3-M1, E2E-A/B/C/D | 0 | **met** |
| P10 | 0 unauthorized actions: T3-A1, T3-M3, T3-M4, E2E-D (phone approve/deny refused; nothing sent without the owner) | 0 | **met** |
| P11 | 0 resumed after revoked/expired authority: T3-S5, T3-A1 (phone resume of a lapsed schedule → AWAITING_APPROVAL), T3-M2, T3-M3 | 0 | **met** |
| P12 | idle wake = 60 s (T3-R1 asserts `nextDue - now = 60 s` with a 10-minute monitor) | no high-frequency polling | **met** |

RSS includes the Host's other services and V8 reservations; heap is the comparable figure. The lateness here is the
engine's own `setTimeout` on an awake laptop; it says nothing about sleep, which is reported as a gap, not as lateness.
Not measured: energy/battery (declared in §1), real-model inference time (the bench uses the recorded fake model; the
one-GPU-call gate and pins are unchanged from S2-T1/S2-T2).
