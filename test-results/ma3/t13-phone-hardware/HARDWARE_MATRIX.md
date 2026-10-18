# Physical Android acceptance matrix

Observed 2026-10-18T01:57:20.048Z. Authoritative row definitions: ../t13-gate-closure/PHONE_PAIRING_MATRIX.md.

1/15 PASS; 14/15 BLOCKED. No simulation, mock authentication or synthetic task event counts toward a row. Android debugging QR authorization is separate from Bunny-A device enrollment.

| # | Authoritative check | Actual-device result | Observation |
|---:|---|---|---|
| 1 | Companion launches | **PASS** | Verified candidate app launched and native screen visually inspected; interactions recorded. |
| 2 | Workstation generates code | **BLOCKED** | Not executed: candidate compatibility and an existing authorized candidate HTTPS transport are not established. |
| 3 | Android accepts code | **BLOCKED** | Not executed: candidate compatibility and an existing authorized candidate HTTPS transport are not established. |
| 4 | Authentication completes | **BLOCKED** | Not executed: candidate compatibility and an existing authorized candidate HTTPS transport are not established. |
| 5 | Workstation lists phone | **BLOCKED** | Not executed: candidate compatibility and an existing authorized candidate HTTPS transport are not established. |
| 6 | Current agent activity | **BLOCKED** | Not executed: candidate compatibility and an existing authorized candidate HTTPS transport are not established. |
| 7 | Task updates | **BLOCKED** | Not executed: candidate compatibility and an existing authorized candidate HTTPS transport are not established. |
| 8 | Authorized approval | **BLOCKED** | Not executed: candidate compatibility and an existing authorized candidate HTTPS transport are not established. |
| 9 | Unauthorized approval | **BLOCKED** | Not executed: candidate compatibility and an existing authorized candidate HTTPS transport are not established. |
| 10 | Expired/reused code | **BLOCKED** | Not executed: candidate compatibility and an existing authorized candidate HTTPS transport are not established. |
| 11 | Disconnect detection | **BLOCKED** | Not executed: candidate compatibility and an existing authorized candidate HTTPS transport are not established. |
| 12 | Authorized reconnect | **BLOCKED** | Not executed: candidate compatibility and an existing authorized candidate HTTPS transport are not established. |
| 13 | Stale approval after reconnect | **BLOCKED** | Not executed: candidate compatibility and an existing authorized candidate HTTPS transport are not established. |
| 14 | Workstation-only capabilities | **BLOCKED** | Not executed: candidate compatibility and an existing authorized candidate HTTPS transport are not established. |
| 15 | No permission bypass | **BLOCKED** | Not executed: candidate compatibility and an existing authorized candidate HTTPS transport are not established. |

Reproduction actions are retained in hardware-matrix.json and the unchanged authoritative matrix. Stop before issuing any Bunny-A pairing code until the source compatibility and HTTPS preconditions are met.
