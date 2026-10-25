# Verification and cancellation

## Deterministic checks

`deterministicCheck` in the offline suite:

| Operation | Evidence | Result |
| --- | --- | --- |
| File read and file copy | SHA-256 equals the frozen hash | `performed_passed` |
| Approved process | exit status 0 | `performed_passed` |
| Failing process | exit status 3 | `failed` |
| External write with no observation | `uncertain` | `unavailable`, completion is not verified |
| Unapproved delete | file hash unchanged | outcome `refused`; replan clears approvals |

A reviewer flag is not accepted as verification. `reviewerReplacesDeterministicCheck()` is false, covered by the existing T1 test.

## Cancellation

- Queue order: `stop`, then interactive inference, then background inference.
- Live HTTP stream: abort after the first chunk returned `AbortError` in 246 ms. That is the client closing the Ollama request, not the product Stop control and not proof that admission cannot delay Stop.
- After the abort the 7B was still listed by `/api/ps`. The script then sent `keep_alive: 0`.
- No Host child process was left from this probe. The soak processes were already running and were left running.

Stale approval: `assessReplan` on the unapproved C3 rows sets `clearApprovals` true. The offline test requires that.
