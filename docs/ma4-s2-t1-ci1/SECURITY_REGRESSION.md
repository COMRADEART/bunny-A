# MA4-S2-T1-CI1 — Security and persistence regression

## Scope of change

The CI1 code change touches **one test file**, `src/lib/bunny-host/ma4-s2t1-host.test.ts`. No product file changed: no
Host, runtime, store, executor, UI, configuration or workflow file. The security properties below therefore cannot have
been changed by CI1 itself. They were re-verified because the brief requires it, and because the fix had to
be shown not to *weaken* the T1-11/12 assertions.

### What the fix does not do

* It adds **no retry**. A request that fails at the transport layer still fails the test. A failed request can never
  become an authorized one through "recovery".
* It removes **no assertion**. Every T1-11/12 assertion is unchanged, including the six phone denials, the
  privacy checks on the phone view and the no-re-run checks across the restart.
* It changes no timeout, adds no sleep, suppresses no `ECONNRESET` and does not use `--test-force-exit`.
* `connection: close` changes only which TCP connection carries a request. Authentication (bearer token), workstation
  versus paired-device classification and `WORKSTATION_REQUIRED` are decided per request by the Host, exactly as before.

## New failure-injection coverage (CI1-F4, Host HTTP boundary)

`CI1-F4 a client that drops its connection mid-request never gets a task created or run twice; a phone's dropped create
is still refused`:

| Injection | Expected | Result |
|---|---|---|
| Workstation sends a complete `ptask.create` on a raw socket and destroys it without reading the response | Exactly one task, each step run once | PASS |
| The same request, destroyed after 40 bytes of body | No task | PASS |
| A paired phone's `ptask.create`, connection dropped | No task (still `WORKSTATION_REQUIRED`), and the next phone create returns `WORKSTATION_REQUIRED` | PASS |
| Host restarted on the same port and data | The one task is still COMPLETED, no other task exists, no step runs again | PASS |

Hosted: 10/10 isolated + 3/3 `test:ma4` (run 40015670240). Local: every run.

## Phase E property matrix

Every row was run against the final code (`4f6be51`, and re-run on the PR head). Local = this PC with WSL2 and the
native helpers built. Hosted = GitHub Actions windows-latest.

| Property | Covering tests (all PASS) | Where |
|---|---|---|
| Durable SQLite task state | T1 storage (versioned migration additive/idempotent; newer schema refused; invalid transitions rejected); T1-14 malformed records never executed | local + hosted |
| Task ownership and fencing tokens | T1-7 stale ownership: a reclaimed task's old worker cannot commit; two Hosts never both claim one task. CI1 lifecycle #5: a second Host on the same data and port is refused and changes no running task | local + hosted; #5 local |
| Crash recovery | T1-4, T1-5 (×5 crash points), T1-6, T1-18 real kill, T1-18 repeated crash/no runaway children, T1-4/18 escaped child killed by verified identity | local (all); hosted (all but the native-helper one in the checks job) |
| No replay of uncertain irreversible actions | T1-5 real kill after an irreversible send: UNCERTAIN on every restart, never re-sent, resolved only by the owner; T1-5 cancel during send → UNCERTAIN | local + hosted |
| Pause / resume / cancel | T1-2, T1-3; T1-11/12 phone pause → restart → still PAUSED → phone resume → the paused step not re-run | local + hosted |
| Project isolation | T1-12/15 no cross-project leakage; S2-G4/S2R1-H cross-project records never reach retrieval | local + hosted |
| Hard model pins | T1-9/13 pins survive recovery, a missing pin blocks (no other model); T1-9 PIN_VIOLATION; R4-G4/S2-G3 pins never substituted | local + hosted |
| Approval expiration | T1-8 expired approval waits, expired envelope and revocation stop the task; B4 approvals scoped incl. expiry | local + hosted |
| Phone pairing / role restriction | T1-11/12 six workstation-only actions → `WORKSTATION_REQUIRED`; phone view has no prompt, output or local path; CI1-F4 dropped phone create refused; T1-12/15; the stage 2 pairing suites (`ma2-t10`, `remote-device`, `remote-remediation`) | local + hosted |
| Stale mobile state | UI: "S2-T1 task rows: a stale view never reads as running now and offers no controls"; "a phone supervises but approves and resolves on the PC"; T13 liveness | local + hosted |
| Background work opt-in | T1-10 refused when disabled; T1-11 resume only under the owner's startup policy (default: wait); T1-11/12 phone cannot turn background on | local + hosted |
| Grouped model scheduling | S2-T8 grouped schedule; S2R1-E retrieval changes neither calls, order, pins nor concurrency | local + hosted |
| WSL2 sandbox and seccomp | F4.1–F4.11 and F5 seccomp, all executed and passing **locally**. On hosted runners they report `SKIPPED (not passed)` (no WSL2), as before | local only (by design) |
| Local-only inference / cloud disabled | static check: `enabled: false, models: []` in `ma4/registry.ts`, no `enabled: true` in `ma4/cloud-candidates.ts`; candidates test: disabled, not routable | local + hosted security job |
| Learned-skill / Lotus Memory injection disabled | S2-G4 memory off by default: nothing written or read until the policy enables it | local + hosted |
| No consequential external executor | unchanged: the only registered executor is local read-only generation (`task-executors.server.ts`); CI1 adds none (test-only fakes) | code review |

Raw local output: `evidence/test-ma4.log` (149 tests: 148 pass, 0 fail, 1 skipped, the opt-in live test),
`evidence/test-ui.log` (411/411), `evidence/routing.log` (69/69), `evidence/npm-test.log` (full regression),
`evidence/static-secrets.log`, `evidence/npm-audit-prod.log` (0 vulnerabilities).

## Process cleanup (F3)

* Hosted, **before** the fix (failing runs): 13 watchdog reports, `result: EXITED`, **0 orphans**, 0 timeouts. A
  failing T1-11/12 leaves no Host, worker or child process behind.
* Hosted, **after** the fix: 13 watchdog reports, 0 orphans, 0 timeouts.
* Locally: the test file exits on its own (no `--test-force-exit`), and the full `npm test` completes.
