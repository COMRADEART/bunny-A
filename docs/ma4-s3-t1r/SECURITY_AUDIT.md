# Security audit

This is a review of the T1R diff and the live probe, not a penetration test.

| Invariant | Result |
| --- | --- |
| Missing preference selects nothing | Holds. The error lists local models and the owner has to pick one. |
| Hard pin digest mismatch selects nothing | Holds in unit tests. |
| `AUTO_LOCAL` stays in the authorized local pool | Holds in unit tests. A cloud-only pool fails. |
| Live generate | One digest was checked before the call. No other model was requested. |
| Personal files | Not opened. Fixtures are synthetic strings in a temp directory. |
| Soak state | Not read for task content and not written. |
| Secrets | No new credential store. The qualification scripts do not print environment secrets. |
| Approvals | Unapproved C3 deletes do not run. Replan marks approvals cleared. |
| Verification | Hash, exit status, or an explicit uncertain state. Model text is not the verifier. |
| Voice record | The rebuilt exe matches the LF source hash. The prior `whisperShim` block was kept. The whisper runtime was not staged and was not downloaded. |

No new agent, model download, Lotus memory, or voice engine was added.

Public beta stays **NO-GO**. Installed smoke, the unstaged whisper runtime, a fair completion delta, and this branch's own CI are not all green.
