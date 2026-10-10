# Workstation promotion boundary (brief section 4)

A staged change reaches the project only through `MissionManager.promoteStaged()`. It runs inside the workstation's `allow_once` answer to the Host-raised promotion request:
- `action: "filesystem.promote"`;
- `desktopRequired: true`;
- `promotion: {stagingId, contentHash, contentSize, destination, classification}`;
- phase `verify`.

**No earlier phone approval is used as promotion authority.** A phone can never answer `allow_once` on it (`deviceRequestRefusal` refuses every `desktopRequired` ask). A phone may *deny* it, which only rejects the staged change. The workstation identity is the Host's bearer-authenticated principal (`isTrustedLocalActor(by)`); see `workstation-identity-audit.md`.

## Ordered checks (all synchronous; any failure stops before mutation)

| # | Brief requirement | Check |
|---|---|---|
| 0 | owner consent | `by` is the authenticated workstation, else `WorkstationRequiredError` |
| 7 | exact approved operation | request binding equals the record (staging id, Mission, step, SHA-256, size, destination), else `FAILED` |
| — | state | record is `STAGED`. An ended record also closes the request and fails the step (round 2). |
| 9a | review completeness | content over 8,192 bytes requires a prior workstation `mission.staging.inspect` of the same SHA-256. Otherwise the request **stays open** (refused, retryable). |
| 6 | execution-sensitive consumers | no Bunny code is live (`liveCodeExecutions()`) and no trusted-desktop execution runs in that folder. Otherwise the request stays open. |
| 4 | Mission authorization | Mission not stopped, failed or completed; envelope present, not revoked, and the **same** envelope the change was staged under |
| 4 | device dependency | for a remote envelope, the producing device is still paired and unrevoked |
| 4 | Agent scope (current) | consent `ACTIVE`/`EXHAUSTED`, current Host generation, unexpired, same revision as at staging, and `filesystem.write` of this resource still inside the consent (or a workstation exact-resource answer) |
| 4 | plain Mission scope | destination within the envelope's write roots (or a workstation one-time root) |
| 3 | destination identity | re-classification is not `UNKNOWN` (no link, junction or hard link); for remote envelopes still `PHONE_SAFE_*`; canonical path unchanged; not private Host state; `destinationBefore` (existence and SHA-256) unchanged |
| 1-2 | staged identity and hash | regular file, no link, `nlink 1`, same `dev/ino/size`, SHA-256 equal to `content_hash`, read once into memory |
| 8 | bounded atomic write | `STAGED→PROMOTING` (persisted intent), exclusive temporary file in the destination folder, `fsync`, rename |
| 9 | independent verification | read back from disk; SHA-256 and size must equal the reviewed bytes |
| 10 | record | `PROMOTING→PROMOTED` in one SQLite transaction with a `remote_changes` row recorded and acknowledged by the workstation; `staging.promoted` event; the step then runs its own verification and completes; the promotion request is stamped `CONSUMED` |

**Staleness ends the change.** Failures of checks 3, 4 and 7 move the record to `FAILED`, `WITHDRAWN` or `INVALIDATED_BY_*`, resolve the request as `deny` (resolver `bunny-host (...)`, never the user) and fail the step with `permission_required`. A Retry or replan stages again for a fresh review.

**Failure after the rename** (write error or read-back mismatch):
- the record is `FAILED` (with the `promotionStarted` flag, so the Host mutation sequence stays monotonic);
- the destination is recorded as an **unreviewed** paired-device change, so no Bunny code runs over it before review;
- the request is closed and the step fails.

A Host crash while `PROMOTING` is reconciled from disk at restart: either `PROMOTED` (destination holds the reviewed bytes) or `FAILED` plus an unreviewed change.

## Review display

The workstation's request reason contains:

| Field | Content |
|---|---|
| File name and destination | JSON-escaped; every invisible or format code point escaped |
| Source device | `device:<id>` |
| Agent and Mission | ids |
| Classification | class and reason, plus warnings |
| Size and SHA-256 | size and the full SHA-256 |
| Destination effect | creates a new file, or replaces the current file (with that file's SHA-256) |
| Content | full JSON-escaped content when ≤ 8,192 bytes; otherwise `TOO LARGE TO SHOW HERE` with the first 8,192 bytes and the instruction to inspect everything first |

Preview handling:
- **8 KB is a preview limit, not an approval limit.** `mission.staging.inspect` (workstation only) returns every byte and records `inspectedHash`. The island UI shows an **Inspect all N bytes** button for large promotions. Promotion of a large change is refused until the inspected hash equals the staged hash.
- **Devices never see it.** Device projections replace the reason with `DEVICE_REVIEW_REASON` and strip the `promotion` binding (`remoteVerdicts`, `redactReviewListing`, `DEVICE_HIDDEN_KEYS`).

## Promotion is a project mutation

`MissionStore.mutationSequence()` counts every record that ever entered `PROMOTING`. A promotion therefore voids any trusted-desktop grant approved before it (F01 binding), and the count never decreases.
