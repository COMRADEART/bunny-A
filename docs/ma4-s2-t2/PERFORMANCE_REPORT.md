# MA4-S2-T2 — Performance report

Budgets were fixed in `scripts/ma4-s2t2/bench.mjs` before the first measurement. Run alone, not beside the
regression suite:

```text
node --experimental-strip-types scripts/ma4-s2t2/bench.mjs docs/ma4-s2-t2/evidence/bench.json
```

Machine: Windows 11 x64, Node v24.18.0, run at 2026-10-23T21:45Z. Recorded fake model, local files, local synthetic
site. Raw output: `evidence/bench.json`.

| Measure | Result | Budget | Met |
|---|---|---|---|
| `file.read` step, end to end through broker + runtime (n = 60) | p50 39.1 ms, **p95 47 ms** | p95 ≤ 50 ms | yes (close to the limit) |
| `file.search` over 500 files | 379 ms | ≤ 1,000 ms | yes |
| Receipt-chain verify, 1,000 entries | 5 ms | ≤ 200 ms | yes |
| Browser: first isolated open | 532 ms | ≤ 10,000 ms | yes |
| Browser: later opens, p95 | 431 ms | ≤ 3,000 ms | yes |
| Refused second Host start (F-CI1-1 path) | 1 ms | ≤ 100 ms | yes |
| Heap growth over 100 connected tasks (GC exposed) | −12.8 MB | ≤ 50 MB | yes |

Notes:

* `file.read` p95 is within 3 ms of its budget. Most of the step is the S2-T1 bookkeeping (lease, durable intent,
  receipt, result commit), not the read itself (S2-T1 per-step bookkeeping p95 was 15.4 ms). A slower disk or a
  busy machine may cross the budget; treat it as marginal.
* Each browsing task starts its own isolated browser, so "later opens" are not warm reuses.
* The negative heap figure means no growth was measurable after forced GC; it is not a saving.

## Workflow timings (`evidence/workflow-timings.json`)

Single runs through the real Host with the recorded fake model, so they measure Host overhead, not model latency.

| Workflow | Phase | ms |
|---|---|---|
| A — local project analysis | Planner proposal | 17 |
| A | run to completion | 169 |
| B — browser research | run to completion | 565 |
| C — connected draft | to the permission request | 190 |
| C | approval → sent and verified | 401 |

## Not measured

* Real model latency (any real local or cloud model) and real provider round trips.
* Idle CPU with connected tasks waiting (S2-T1 measured 0.29 % for the runtime; the broker adds no timers beyond the
  proposal-expiry sweep).
