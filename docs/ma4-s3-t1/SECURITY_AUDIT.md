# Security audit

| Invariant | This milestone |
| --- | --- |
| Host remains the authorization authority | Held. Classification and model policy return decisions only |
| Model output cannot grant permissions | Held. Untrusted class labels are discarded. Retrieved text is data |
| Consequential approvals stay required | Held. C3 does not add an approval |
| Hard pin is id and digest | Held when `modelDigest` is set. Name-only `modelExact` still refuses a preference override |
| No silent fallback | Held for preference and pin failures |
| No cloud inference | Held. A `:cloud` preference throws. `AUTO_LOCAL` rejects a non-local pool |
| No new provider activation | Held |
| No unchecked tool execution | Held. No new tool path |
| No retry of an uncertain write | Held |
| No hidden background action | The warm policy releases keepalive-only work. The probe stopped the model it loaded |
| No Lotus Memory injection | None added |
| No self-training or LoRA | None added |
| No automatic downloads | None added |
| No production deploy and no automatic merge | None performed |
| No user data sent for benchmarking | The Ollama prompt was the single word request `Reply with the single word pong.` |

Public beta stays NO-GO. Signing, Android hardware, and background Windows toasts are unchanged inherited blockers.
