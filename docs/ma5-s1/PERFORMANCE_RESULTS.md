# MA5-S1 — Performance results

Only values measured during acceptance are listed. No CPU, memory or frame-time profiling was done, and none is
claimed.

| Measurement | Value | Source |
|---|---|---|
| Windows reconnect after the Host came back | 604 ms | `evidence/windows/w2-host-restart.json` |
| Host outage in that run | 15 982 ms | same |
| Four-role Mission, Planner done → Worker done | ≈ 7.9 s (06:21:36.868 → 06:21:44.810 sample points) | `w4b-roles.json` timeline (local 7B model; Host routing unchanged) |
| Single-step Mission, running → completed | 1 503 ms | `w4-mission.json` |
| Windows Release candidate build + verification (CI) | 1 min 25 s job | run 40644157467 |
| Android build + verification (CI) | 47 s job | run 40644157461 |

Load reductions by design (source):
- the Windows chat no longer polls `/state` every 250 ms;
- polling falls back to 15 s while the `/events` stream is live;
- unchanged Android snapshots skip re-rendering;
- Android polls only while visible, with one request in flight.

These reductions were not measured.
