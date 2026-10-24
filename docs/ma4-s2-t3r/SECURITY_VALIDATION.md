# MA4-S2-T3R — Security validation (Phase I)

**Gates T3R-G12 (no duplicate consequential actions) and T3R-G13 (no authorization or privacy regression): PASS** —
zero unauthorized consequential actions in every tested scenario. All tests run against real stores, runtime, broker and
engine on SQLite files; nothing external is reached.

## Adversarial list → evidence

| Brief item | Test(s) | Result |
|---|---|---|
| Malicious goal title or description | T3R-A1 (stored inert, shown sanitized, credentials refused) | pass |
| Forged schedule approval | T3R-A2 (wrong version, phone actor, tampered approval record) | pass |
| Unauthorized recurring task creation | T3R-A3 (tasks, monitors and pages cannot create schedules); T3-A1 (phone cannot create/approve/link) | pass |
| Changed task content after approval | T1-8 (approvals bound to spec and envelope hashes); S2-T3 material-scope invalidation; T3R-A2 | pass |
| Cross-project monitoring | T3-M5 (no leakage between monitors, schedules, goals, tasks); T1-12/15 | pass |
| Mobile privilege escalation | T1-11/12, T3-A1, T3R-A5 (`action.inspect` → WORKSTATION_REQUIRED); physical phone: no Approve control | pass |
| Expired device pairing | T9 F04 (absolute lifetime and idle bound); physical phone: wrong code, revocation | pass |
| Prompt injection in monitored files | T3-M4 (forged results and injected instructions change nothing); T2-W4 (fenced as untrusted data) | pass |
| Duplicate scheduling after restart | T3R-A6 (two engines + restart → one task per slot); T3-A3/A4; installed `gaps.json` | pass |
| UI submitting an inconsistent resource scope | T3R-A4 (step outside the grant refused by the Host) | pass |
| Stale frontend approving an outdated payload | T3R-A2/T3R-A5 (payload hash mismatch refused); cancelled task's stale proposal cleared and refused | pass |
| Invalid time zone and recurrence | T3R-T1 (refused, not normalized) | pass |
| Host shutdown during action execution | T3-A9, T1-5 (UNCERTAIN; owner decides; never re-sent) | pass |
| Unexpected device disconnection | T13.2 A10/R08 (simulated); physical outage, last known + paused controls | pass |
| Failed startup and leaked Host resources | T2-H2 (refused listen leaves no state or handle); F04 startup records; `state-marker` T3R boot-twice test | pass |

## Preserved controls (unchanged by this milestone)

Durable task safety (S2-T1), the permission broker and exact-action approvals (S2-T2), schedule authorization (S2-T3), hard
model pins (T1-9, smoke cloud refusal), project isolation, revocation, approval expiry, crash recovery without blind replay,
background opt-in (default off, restored after every test), phone role separation, sandbox isolation (WSL2/seccomp suites
in the full regression).

## Privacy checks on evidence

Committed evidence was scanned for tokens, pairing codes and tunnel addresses (none); model outputs are stored as length +
hash; phone screenshots were reviewed (status bar shows only time, signal, battery and app icons).
