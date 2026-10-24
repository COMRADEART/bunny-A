# MA4-S3-T0 — Security Regression

## Preserved invariants (must remain green)

- Default-deny device actions  
- Model SHA / localOnly pins  
- No unauthorized cloud inference  
- Prompt-injection boundaries in planner/worker paths  
- Connector output isolation  
- No cross-project resource access  
- Hash-bound approvals  
- Cancellation / revocation  
- Device pairing / revocation  
- No unapproved background startup  
- Credential isolation  
- No-blind-replay for irreversible  
- No unauthorized telemetry  

## T0 extension

| Case | Result |
|---|---|
| Phone cancel while UNCERTAIN | **Refused** (new test in T1-5 extension) |
| Replan approval reuse | Covered by prior remediation |
| Symlink/junction | Prior adversarial suites — re-run on candidate |

**Gate S3T0-G14:** PARTIAL until full `npm test` + adversarial suite on tip.
