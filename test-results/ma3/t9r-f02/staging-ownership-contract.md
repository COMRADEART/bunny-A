# D2 — Host-owned inert staging: ownership contract

Implementation: `src/lib/bunny-missions/staging.server.ts` (`DeviceStaging`), together with `MissionManager.stageRemoteWrite`, `askPromotion`, `promoteStaged`, `inspectStaged`, `endStaged`, `invalidateDeviceStaging` and `withdrawStaged` in `manager.server.ts`. The bus hook is `CapabilityBus.stageRemoteWrite` in `capabilities/bus.server.ts`.

## Location and isolation

| Property | How it is enforced |
|---|---|
| **Bunny-owned** | `<Host data directory>/staging/<staging_id>/content`. This is the Host's private state folder, never a project. It is created lazily, so existing installed layouts are not changed. |
| **Not an executable search path** | Never added to `PATH` or to any tool or project configuration. No Bunny code run uses it as a working folder or input. |
| **Outside project and watched folders** | `DeviceStaging.root()` refuses to run when any project root contains the staging folder or lies inside it. It also refuses when any component of the staging path is a link or junction, or when the path resolves through an alias. |
| **Unreadable by Missions and Agents** | `stagingPath()` (`paths.server.ts`) is refused unconditionally by the filesystem adapter for `list`, `read`, `write` and `search`. `privateHostPath()` now includes `staging` and is enforced for every Mission request, not only Agentic delegation (round-1 E48b). |
| **Exclusive creation** | Content is written with `openSync(..., "wx")` plus `fsync` into a fresh `mkdirSync` folder named by a random UUID. |
| **Bounded** | At most 1 MiB, the existing bounded text-write limit. |

## Which writes are staged

Every `filesystem.write` attributed to a paired device is staged. Attribution (`remoteActorFor`) means any of:
- a remote envelope;
- a Mission the device started or resumed;
- any non-deny device answer in the Mission.

Additional rules:
- **Write executor only.** Only a step's own `filesystem.write` executor can wait for promotion. A device-attributed write inside a skill or a verification check is refused (round 2).
- **Private Host state.** Destinations in private Host state or in staging are refused before staging.
- **Deletes.** A device-attributed delete cannot be staged, so it always needs the workstation's exact-operation grant.
- **Admission comes first.** Staging happens after the canonical admission: `decide()`, Agentic admission, batch and grant consumption. It replaces only the adapter's project write.

## Record (`device_staging` table, additive)

| Field | Content |
|---|---|
| `staging_id`, `mission_id`, `agent_id`, `step_id`, `run_id` | identities |
| `device_id` | the attributed paired device |
| `envelopeId`, `envelopeRemote` | the authorization in force and who granted it |
| `destination`, `destinationRoot` | canonical destination and its project root |
| `destinationBefore` | `{existed, sha256, size}` at staging |
| `content_hash`, `content_size` | SHA-256 and size of the exact bytes |
| `classification`, `reasons`, `warnings` | D1 |
| `approval_revision` | `agentic:<revision>` or `authorization:<id>` |
| `hostGeneration` | Host epoch at staging |
| `created_at` | |
| `promotion_state` | `STAGED`, `PROMOTING`, `PROMOTED`, `REJECTED`, `FAILED`, `WITHDRAWN`, `INVALIDATED_BY_SCOPE_CHANGE`, `INVALIDATED_BY_SIGNOUT`, `INVALIDATED_BY_DEVICE_REVOCATION`, `INVALIDATED_BY_HOST_RESTART` |
| `decidedAt`, `decidedBy`, `decisionReason` | |
| `inspectedHash`, `inspectedAt`, `inspectedBy` | |
| `fileIdentity` | `{dev, ino, size}` |
| `promotionStarted` | monotonic flag |

Raw content is **not** stored in audit events or capability runs. Runs record the content's size, and events carry the destination and digest. Device-facing projections redact both.

## Identity protections

| Threat | Protection |
|---|---|
| Path traversal | `scopedPath` (approved roots) plus classification `UNKNOWN` outside the step folder |
| Junction/symlink substitution | lexical and canonical link walk at staging; re-classification and canonical equality at promotion |
| Cross-root hard links | `nlink > 1` refused for the destination and for the staged file |
| Alternate path representations | 8.3 names, streams, trailing dots and spaces, invisible characters → `UNKNOWN`; lexical/canonical mismatch → `UNKNOWN` |
| Destination replacement | `destinationBefore` must still match at promotion |
| Staged file replacement | the staged file must still be a regular file with no link, `nlink 1`, the same `dev/ino/size` and the same SHA-256. The bytes are read once into memory and exactly that buffer is written. |
| Approval/promotion race | promotion runs synchronously inside `respond()` before the request is resolved. A record must be `STAGED` and moves through a conditional `UPDATE … WHERE state IN (…)`. |
| Cross-Mission/Agent/project substitution | the request's `promotion` binding (`stagingId`, `contentHash`, `contentSize`, `destination`) must equal the record's, and the record's Mission and step must equal the request's |
| Unauthorized staging reads | private-state refusal (above); device projections strip `promotion`, and promotion review text is redacted for devices |
