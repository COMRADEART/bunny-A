# MA4-S3-T0 — Capability Maturity Matrix

Honest classification after source audit (not prior doc PASS claims).

| Component | Class | Notes |
|---|---|---|
| PersistentTaskRuntime / TaskStore | Integrated (schedules); main prompt not wired | Durable state, leases, UNCERTAIN |
| ActionBroker / ActionLedger | Fully implemented (file/browser) | Email/calendar live providers blocked |
| ProactiveEngine (goals/schedules/monitors) | Integrated | Monitor sources often test-only |
| Planner `ptask.plan` | Implemented, preview-only UI | No create-from-plan button |
| Model Reviewer | Integrated quality gate | Not authorization |
| OrchTask / MissionManager | Fully implemented | Parallel to ptask |
| Voice PTT | Integrated | No new full-duplex in T0 |
| Glass Island / notch | Integrated | Multi-monitor: prior evidence; recheck on candidate |
| Android companion | WebView only | No native push/TalkBack claim in T0 |
| `evaluateNativeNotification` | **Integrated (session browser)** after T0; **OS tray NOT IMPLEMENTED**; Android NOT IMPLEMENTED | Was contract-only in S2 |
| `LocalBetaFeedbackStore` | **Durable + Host commands** after T0; UI surface minimal | Was in-memory/test-only |
| Operational health summary / support bundle builders | Contract/test-only | Pre-existing OperationalHealth UI separate |
| 10-stage guided onboarding contract | Contract/test-only | Live UI: 7-step MA3 onboarding |
| Background execution | Disabled by policy (default off) | |
| Cloud inference | Disabled by localOnly / pins | |
| Production signing / Play keystore | Blocked external | |
| Live OAuth connectors | Blocked external | |
