# Engineering report

## Change

Unavailable preferences were able to select another local model when `allowAuthorizedAlternate` was true. They now return the authorized choices and select one only after `acceptedAlternateId` names that choice. The router error lists those models. The model-selection screen says this is not a hard pin and that Bunny will not substitute.

The voice worker exe on the merge did not implement the current `BunnyVoiceWorker.cs` self-test. It was rebuilt. Source hashes ignore CRLF so a Windows checkout matches the LF blob. A skipped whisper shim keeps the previous shim record instead of deleting it. The pinned whisper runtime is still absent on this machine, so the shim was not rebuilt.

The qualification runner lives in `scripts/ma4-s3-t1r/`. It does not feed holdout ids into `classifyTask`.

## Evidence limits

- Direct Ollama is not the installed Host.
- One model was timed. The predecessor's different routing choice was not given its own timed answer set.
- Whisper runtime tests fail closed until `node scripts/stage-whisper.mjs` can see the pinned vendor files. They were not copied from another tree.
- Windows installed smoke was not run.
- This branch's hosted CI has not finished. The green runs are the PR #39 merge.

## Next

Keep public beta NO-GO. Wait for this branch's CI before treating T1R-G11 as anything but untested. Stage the pinned whisper runtime before calling the voice gate passed. Drive an installed build for T1R-G10. Then MA4-S3-T2 can start: real-time voice intelligence and full-duplex conversation.
