# MA4-S2-T3 — Condition monitoring (T3-G4)

Code: `proactive.ts` (`MonitorSpecSchema`, `classify`, `observation`), `proactive.server.ts` (`monitor*`,
`checkMonitors`, `observe`), `ma4_observations` (bounded to 200 per monitor).

## What a monitor may read

| Source | Mechanism | Authorization |
|---|---|---|
| `file` (root + relative path, optional top-level JSON `field`) | two reads through the S2-T2 `walk`/`readText` (identity-checked handle, no links, no protected names, ≤ 1 MiB text); value = the field, or the first non-empty line | the folder must be owner-registered at creation, approval **and every check**; a withdrawn folder ends the monitor (`permission_expired`, EXPIRED) |
| `task` | the state of an existing S2-T1 task | same project only |
| `synthetic` (name) | a Host-registered source function (tests: recorded browser page / connected-service event) | production registers **none** → refused |
| URL / internet | **does not exist** in the schema | Bunny never polls the internet on its own |

External accounts (Gmail, calendars, social, finance) have no monitor source: they stay simulated until a specific
connector is qualified.

## Per-monitor contract

`source`, `predicate` (`changed` | `equals` | `transition from→to`), `intervalMs` (≥ the policy minimum, default 60 s),
`maxChecksPerHour`, `dedupMs`, `expiresAt`, `notify`, `priority`, path-free `label` (what the phone and notch show).
Baseline: the first check after approval, recorded and never announced. Approval binds the spec hash and ends.

## Change detection (deterministic, model-free)

| Class | When | Outcome |
|---|---|---|
| `no_change` | same SHA-256 as last time (a rewrite with the same bytes included) | recorded |
| `routine_change` | baseline, or a change the predicate does not ask for (e.g. FAIL → PASS) | recorded |
| `meaningful` | the predicate's transition happened (e.g. PASS → FAIL) | notification (once per `dedupMs`) and condition schedules |
| `source_unavailable` | file missing, source error/timeout | backoff ×2 per error, ≤ 1 h; one `recovery_blocked` notice after 3 in a row |
| `invalid` | not JSON, missing field, binary, too large | as above |
| `permission_expired` | folder/source no longer authorized | monitor EXPIRED, `permission_expired` notice |
| `uncertain` | the two reads disagree (file being written) or it changed while opened | nothing concluded; next interval |

The source returns only a value; the engine recomputes its hash and the class. A payload that carries
`matched: true`, a forged hash or instructions is ignored (T3-M4). Monitored text never reaches a model and no command
accepts an observation or a verdict.

## Limits on cost

Polling only at `max(intervalMs, policy.minIntervalMs)`, at most `maxChecksPerHour`, at most `maxActiveMonitors`
(default 8) active. The engine sleeps until the next due check (≤ 60 s idle wake). Event-driven `fs.watch` was not
used: on Windows it is unreliable for renames/atomic replaces and would still need this bounded verification; the
polling budget keeps idle cost negligible (PERFORMANCE_REPORT.md).

## Tests

T3-D2, T3-M1 (PASS→FAIL once, unchanged, rewrite, recovery, flapping, dedup window), T3-M2 (condition-triggered run,
min gap, disable), T3-M3 (sources, revoked folder, limits, backoff, check budget), T3-M4 (forged/injected), T3-M5
(cross-project), T3-E2E-B (real Host).
