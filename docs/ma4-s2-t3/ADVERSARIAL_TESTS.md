# MA4-S2-T3 — Adversarial tests (T3-G14)

Deterministic fake clock and controlled sources (`src/lib/bunny-host/ma4-s2t3-fixtures.ts`): real task store, runtime,
broker, file connector, proactive store and engine on a temporary SQLite file; a recorded fake model; recorded
synthetic sources. No real email, payment, post, purchase, deletion or remote change.

Run: `node --experimental-strip-types --test --test-concurrency=1 src/lib/bunny-host/ma4-s2t3.test.ts`

| # | Case | Test | Result |
|---|---|---|---|
| 1 | Duplicate trigger after Host restart | T3-S3 | 1 occurrence, 1 task across 2 restarts |
| 2 | Missed schedule while Windows is asleep | T3-S4 | skip: recorded + 1 notice per gap; run_once: exactly 1 run; gap recorded "asleep" |
| 3 | Expired approval before execution | T3-S5 | no task; AWAITING_APPROVAL + `permission_expired`; re-approval does not replay the slot |
| 4 | Revoked monitor authorization | T3-M2, T3-M3 | disabled monitor reads nothing; withdrawn folder → EXPIRED |
| 5 | Unauthorized external URL | T3-M3, T3-D2 | URL sources do not exist in the schema; unregistered folder/source refused |
| 6 | Forged condition result | T3-M4, T3-D2 | `matched`, hashes, instructions in a source payload ignored; no command accepts observations |
| 7 | Malicious webpage asking to change the schedule | T3-M4 | schedules byte-identical, no new records, no task, no model call |
| 8 | Prompt injection in a monitored local file | T3-M4 | same; notice text sanitized (no path, no key) |
| 9 | Schedule modification after approval | T3-S6 | AWAITING_APPROVAL; no run on the old approval |
| 10 | Multiple competing Host instances | T3-S7 | two engines, two DB connections, interleaved ticks → 1 occurrence, 1 task |
| 11 | Repeated identical source updates | T3-M1 | rewrite with same bytes → `no_change` |
| 12 | Crash during notification persistence | T3-A2 | injected I/O error rolls back decision + notice; decided once later |
| 13 | Crash during task dispatch | T3-A3 | created once within grace; recorded missed after it |
| 14 | Notification dedup after recovery | T3-A4 | unique keys; 1 completion notice across 3 restarts |
| 15 | Cross-project monitor leakage | T3-M5 | monitor/schedule/goal/task across projects refused |
| 16 | Unauthorized phone schedule creation | T3-A1 | 10 workstation-only actions → `WORKSTATION_REQUIRED` at both the HTTP right table and the command layer |
| 17 | Malformed schedule records | T3-S6 | tampered and unparseable rows → `corrupt`, never fire |
| 18 | Model unavailable when the schedule fires | T3-A5 | retried in grace, then skipped with the reason; never substituted |
| 19 | Resource budget exhaustion | T3-A6 | second run deferred before any call; rolling day frees it |
| 20 | Daylight saving time transitions | T3-TZ1, T3-TZ2 | documented policy; one run per local day |
| 21 | Clock moving backward or forward | T3-S4 | backward: nothing re-fires; forward: missed-run policy |
| 22 | Rapid repeated condition changes | T3-M1, T3-M2 | flapping → 1 notice per window; condition runs respect `minGapMs` |
| 23 | Background execution disabled | T3-A7 | reminders still arrive; work deferred then skipped with reason; runs once the owner allows background |
| 24 | Cancellation with no orphaned processes | T3-A8 | schedule cancel → task CANCELLED, child process exited, process table empty |
| 25 | Host shutdown during an uncertain external action | T3-A9 | UNCERTAIN; sent once; next slot defers; 1 notice |

Also: T3-D1 (28 decision cases, exactly one outcome each), T3-R1/R2 (idle cost, S2-T1 compatibility), and the four
end-to-end scenarios through the real Host (END_TO_END_QUALIFICATION.md). Result: **30/30 and 4/4 pass.**

The WSL2 sandbox adversarial suite (`ma4-sandbox.test.ts`, in `test:ma4`) is unchanged and runs in the full regression.
