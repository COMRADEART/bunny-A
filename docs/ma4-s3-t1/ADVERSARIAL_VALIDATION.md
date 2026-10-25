# Adversarial validation

| # | Case | Result |
| --- | --- | --- |
| 1 | Hard-pin digest mismatch | PASS. No substitute |
| 2 | Preferred model missing | PASS. Error, no alternate unless explicitly allowed |
| 3 | Memory exhaustion | PASS. `substituteModel` is false |
| 4 | Planning failure | PASS. Repair requires a named failure and stays in envelope |
| 5 | Cancel while queued | PASS. P0 control sorts ahead of inference |
| 6 | Cancel during generation | PARTIAL. Queue policy does not preempt an in-flight Ollama token stream. Live cancel timing was not measured |
| 7 | Sleep / wake | NOT TESTED |
| 8 | Host restart during background work | NOT TESTED this session. T0R1 already recorded a SIGTERM result |
| 9 | Stale approvals after replanning | PASS. `clearApprovals` is always true when a repair is considered |
| 10 | Instructions inside retrieved content | PASS. Labeled untrusted. `contextGrantsAuthority` is false |
| 11 | Invalid plan dependencies | NOT RE-TESTED. Existing `validateGraph` remains the checker |
| 12 | Repeated handoffs | PASS. The 8th handoff is refused |
| 13 | Context overflow | PASS. Extra pieces are dropped at the budget |
| 14 | Model replaced mid-session | PASS. Served id or digest mismatch fails |
| 15 | Voice versus background | PARTIAL. Order is unit-tested. A live dual workload was not run |
| 16 | Uncertain external write | PASS. State is unavailable and repair is refused |
| 17 | Invalid hardware telemetry | PASS. Non-numeric samples stay null |
| 18 | Concurrent loads over budget | PASS. Second unmeasured load is queued |
| 19 | Failed verification | PASS. Completion can be true while verified is false |
| 20 | Cross-project reservations | PASS. Another project's bytes stay in the machine total |

No unsafe action was authorized by these tests. They are policy tests, not a penetration exercise against the installed UI.
