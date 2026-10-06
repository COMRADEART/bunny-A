# T9R root cause — reconstruction before product changes

Primary classification: **MIXED**.

The historical staged SQLite journal contains 68 successful explicit `computer.open_app`
Calculator calls: 60 different Missions each launched once, plus eight direct probes with no
Mission/Task identity. No historical Mission has two launch runs. The two attempt entries on
many launch steps reflect permission/scheduler attempts, not two launch capability runs.
The final v19/v20 matrix deliberately starts each independent case with `open_app`; it never
closes its Calculator window. Earlier `live-matrix.ts` hygiene also used PID/title bookkeeping
and title-matched WM_CLOSE, which is insufficient ownership proof for a shared UWP frame.
That old sweep is retired, not reused by T9R. See `launch-lineage.json` and the immutable
T9 `staging/hygiene-pre-resume.json` for the cleanup debt and its recorded seven-window cluster.

The old product launcher unconditionally executes Start-Process on every admitted `open_app`.
It neither acquires nor records a canonical workflow target. This is a separate lifecycle
defect, established live before any product edit: one v20 Mission, one explicit bounded
grant, two acquisition steps, and **two verified visible Calculator windows**. The second
launch does not reuse the first target. `reproduction.json` captures that result. Both
freshly identified test-created targets were closed using current native handle, frame and
content process lifetime, Microsoft package verification and WindowPattern.Close; no name
or title-only sweep was used.

The first reproduction included focus between acquisition calls. Windows refused foreground
activation while ChatGPT was foreground; the existing bounded retry repeated only focus and
did not relaunch. That trial was stopped, its single target safely closed, and its failure
record is retained. The successful duplicate reproduction needs no focus assumption.

Initial T9R read-only inventory was **zero Calculator windows**. The exact historical
10–12 visible windows were not individually captured at the time of the user observation,
so their original HWND/lifetime lineage cannot be recreated retroactively. Launch calls are
not counted as a one-process/one-window guarantee. The journal, harness and positive
same-workflow reproduction establish the two contributing mechanisms; no claim is made
that the original observation was caused by repeated launches in one historical Mission.

Required remediation: idempotent verified target acquisition keyed to the logical Mission
workflow (deterministic capability steps have no child Task ID), with a small acquisition
mutex, persisted non-authoritative target identity, revalidation and an uncertain-launch
guard; plus fresh owned-target cleanup in the replacement live harness. Grants, budgets,
expiry, risk, exact operations, Stop/replan/restart and verification remain canonical.
