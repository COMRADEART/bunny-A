# Host stop and recovery

The valid stop is in `evidence/followup.json`. A long generate was in `running`. The Host accepted Stop with `stopError: null`.

| Field | Value |
| --- | --- |
| Acknowledgement | 194 ms |
| Time to settled state | 1,390 ms |
| Settled state | `stopped` |
| Output growth in the second after stop | none |
| Foreground chat submitted during the run | `completed` in 1,220 ms, queue 206 ms, output `Foreground.` |

The earlier stop in `evidence/live.json` settled to `completed` in 56 ms because the 400-token job had already finished. It is recorded and is not used as the cancellation result.

No post-stop tool effect was authorized by that stop. The stop covered a chat generate, not an approved file write. The approved edit in the same follow-up run wrote `AFTER-01` only after task approval and action approval, and the stale-hash edit did not write.

Model-unavailable behavior is the stored missing preference: HTTP 400 `MODEL_APPROVAL_REQUIRED`, no model selected. Resource exhaustion beyond the overlap in `GPU_CONTENTION.md` was not induced. The machine still had about 10 GB free during window A, and the Host did not return a resource-exhaustion error.
