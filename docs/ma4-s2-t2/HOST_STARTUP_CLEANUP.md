# MA4-S2-T2 — Host startup cleanup (F-CI1-1)

Commit `80ef9f6`. Test: `src/lib/bunny-host/ma4-s2t2-startup.test.ts` (in `npm run test:ma4`).

## Finding (as disclosed by CI1, and what was actually happening)

CI1 recorded that a Host whose `listen()` fails keeps its state files open (EPERM on cleanup). Reproducing it with an
MA3 task in the running Host showed a worse effect: `startHost()` opened the database and ran **all recovery before
`listen()`** — `TaskManager` marks every `running` MA3 task `failed`, `MissionManager`/`AgentRuntime` walk and reconcile
mission rows, the containment marker is read. A second Host on the same data directory therefore changed the first
Host's live state and journal, then was refused.

## Before the fix — `evidence/startup-before-fix.log` (same test, original `http.server.ts`): 0/3

| Test | Failure on the old code |
|---|---|
| T2-H1 same data dir + port, five refused starts | the live MA3 task `running → failed`, one event appended ("Host restarted; session recovery unsupported.") |
| T2-H2 own data dir, port taken | `host.sqlite` created before the refusal |
| T2-H3 start fails after binding (missing default root) | database left open: `rm host.sqlite` → `EPERM` |

## Fix

* `startHost()` now binds the port **first** — the port is the single-Host guard — before any path but the data folder
  is touched, any database is opened or any recovery runs. The former body is `openHost()`, attached to the already
  listening server; until it attaches, requests get `503 {"error":"The Host is starting."}` (the bridge already maps a
  503 to "Host unavailable").
* A refused `listen()` closes its server handle before `startHost()` rejects (the handle otherwise lingers a tick).
* After binding, each opened resource registers its release (`db.close`, `manager.dispose`, `missions.close`,
  `agents.close`, `connected.close`, `ptasks.close`); once the Host's own `close()` exists it replaces that list. A
  failure anywhere in `openHost()` runs the releases in reverse and closes the server, then rethrows the original error.
* The running Host's task leases are untouched: the refused Host never opens the database at all.

## After — `evidence/startup-after-fix.log`: 3/3

* H1: tasks, events and persistent-task rows byte-identical across five refused starts; no listener or timer added;
  the first Host completes its task, each step ran once; the data directory removes cleanly afterwards.
* H2: no `host.sqlite`, no `credentials.json`; no handle added.
* H3: three aborted starts release the listener, timers and database (file removable); a fourth start on the same
  port and directory succeeds and serves `/state`.

Regression: the Host-lifecycle-heavy suites (`failure`, `host`, `ma2-t10`, `remote-*`, `t14-autonomy-host`,
`workers-host`, `remote-authority`, `capabilities`, `ma4-s2t1*`) pass; full `npm test` in ENGINEERING_REPORT.md.
Performance: a refused start returns in ~1 ms (PERFORMANCE_REPORT.md).
