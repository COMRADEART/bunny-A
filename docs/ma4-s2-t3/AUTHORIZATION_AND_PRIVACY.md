# MA4-S2-T3 — Authorization and privacy (T3-G7, T3-G8)

## Layers (each re-checked before every execution, including after a restart)

| Layer | Bound to | Ends | Checked |
|---|---|---|---|
| Schedule approval | schedule spec hash (trigger, template, envelope, limits) | ≤ 30 days, ≤ schedule end | every pass and in `decide()` |
| Monitor approval | monitor spec hash | ≤ 30 days, ≤ monitor end | before every check |
| Goal approval | goal spec hash | goal end | every pass |
| Occurrence task approval (`approveScheduled`) | that task's spec + envelope hashes | ≤ run window, ≤ schedule approval | S2-T1 `authorize()` before every step |
| Consequential action approval | the exact payload hash | 15 min default | S2-T2 broker; **never** given by a schedule |
| Task envelope | capabilities, `ollama` + `localOnly: true` literals, pinned models, project scopes, grants, budgets, expiry | `expiresAt` | S2-T1/S2-T2 at create, claim and every step |
| Owner policy | background on/off, resume-on-start, proactive limits | — | every pass / claim |

"Past approval is not standing authority": approving a schedule authorizes that schedule only; it cannot create
another schedule, widen a template, approve an action or extend itself. Any change → AWAITING_APPROVAL.

## Required properties

| Property | How |
|---|---|
| Project scopes | schedule/template/envelope/monitor/goal/link must share the project (T3-M5) |
| Task permissions / provider permissions | the S2-T2 grants and registry; cloud providers not expressible in the envelope schema |
| Model pins | template steps carry pins; envelope lists them; missing → deferred, never substituted |
| Action hash binding | S2-T2, unchanged; E2E-D: stale proposal approval refused |
| Expiration / revocation | lapsed approvals, ended schedules/monitors/goals, withdrawn folders, `monitor.disable`, `schedule.cancel` |
| Rate limits / budgets | `maxRunsPerDay`, `minGapMs`, `maxChecksPerHour`, `maxModelCallsPerDay`, `maxConcurrentTasks`, `maxActiveMonitors` |
| Background policy | an occurrence task runs only with a window attached or the owner's background policy + the envelope's `background` |
| No blind replay | per-slot occurrence key; S2-T1 operation ledger; UNCERTAIN never replayed (T3-A9) |

## Fixed constraints honoured

* **Cloud inference disabled**: envelopes allow only `providers: ["ollama"]`, `localOnly: true`; no cloud path added.
* **Historical Groq approval revoked**: not referenced; no provider approval is read or reused by this code.
* **Skill and Lotus Memory injection disabled**: the engine adds no prompt material; scheduled steps use the S2 executors as they are.
* **External-account monitoring simulated**: no monitor source for real accounts; production registers no synthetic source.
* **No automatic OS startup / power changes**: nothing installs a service, scheduled task or power setting; work happens only while the Host runs.
* **No automatic merge/deploy.**

## Privacy

Views are path-free and sanitized; titles and reasons pass `sanitize()`; monitored values are stored on the Host
(≤ 200 chars, bounded history) and shown only as owner-written labels plus a sanitized ≤ 60-char value in the change
notice. Credentials in goal text, reminder text or template inputs are refused at creation. No real user goals,
conversations, credentials or notifications are committed; evidence uses synthetic projects and a fake model.
