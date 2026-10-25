# Security regression

Preserved by construction of this diff:

- Notification text is taken from the Host event row, then redacted. Forged sequences are refused.
- Android bridge rejects a non-matching origin, unexpected JSON fields, and Bearer / `sk-` fragments.
- Legacy onboarding cannot set background execution, notification opt-in, or a model name.
- Skip still forces `implicitPermissionsGranted` to 0.
- Feedback export is a local document. The submit path redacts before write.
- Revoked devices stay visible and `authenticateDevice` still returns `DEVICE_REVOKED` (that function was not edited).
- Shutdown does not convert an in-flight task into a user Stop, so a later Host does not treat it as an owner-confirmed stop. Recovery tests A12, A15, A16/A17, A19, A20, A21 passed after that correction.
- No cloud inference, OAuth client, or push provider was enabled.

Not run: a full security audit, hosted CI, or a revoked-device replay on hardware.

Commands that did run, all without `--test-force-exit`:

```text
npx tsc --noEmit
node --experimental-strip-types --test --test-concurrency=1 src/lib/bunny-host/ma4-s2t5.test.ts src/lib/bunny-host/ma4-s2t7.test.ts src/components/island/journey-model.test.ts src/lib/bunny-host/ma4-s3-t0r.test.ts
node --experimental-strip-types --test --test-concurrency=1 src/lib/bunny-host/agent-recovery.test.ts
```

`tsc` exited 0. The focused file set exited 0 (24 tests, then the deadline test, then recovery 11 tests).
