# MA4-S3-T0 — Test Lifecycle Audit

## `--test-force-exit` root cause

**Holder:** `setTimeout(…, ≤20 min)` in `TaskManager` launch path (`manager.server.ts` ~1953 and ~2028), cleared only in `finally` after `session.done`.  
**Why hang:** tests close managers while a scripted session is still pending → referenced timer keeps the event loop alive up to 20 minutes.  
**Suites affected (without flag):** `agent-runtime`, `agent-recovery`, `agent-team`, `agent-team-matrix`, `agent-team-lifecycle`.  
**Clean without flag:** `agent-team-handoff`, `agent-team-surfaces`, `personal-agents-team`.

## T0 mitigation

Call `runtimeTimer.unref?.()` after creating both runtime timers so the timer alone does not pin the process. **Flag retained** in `package.json` until a full agent-team lane re-run proves clean exit (do not remove blindly).

## Layers

| Layer | Role |
|---|---|
| 1 Fast | typecheck, unit, schema, permission |
| 2 Integration | Host lifecycle, ptask, storage |
| 3 Installed | Windows release, notifications, Approval Center |
| 4 Hardware | Android, TalkBack, Narrator, voice devices |
| 5 Reliability | soak, crash, growth |

Layer 4 cannot be replaced by Layer 1.
