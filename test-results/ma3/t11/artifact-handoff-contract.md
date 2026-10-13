# M-A-3 T11 — Verified artifact handoff contract

Implementation: `verifiedSource`, `recordHandoff`, `teamPrompt`, `teamWrite`, `verifyTeamCriterion` in
`src/lib/bunny-missions/team-coordination.server.ts`; table `mission_handoffs` (schema `ma3.t11.team-handoffs.v1`).

## What may be handed off

A dependency's output is handed to a consuming step only if **all** hold at consumption time:

1. the source step belongs to the same Mission;
2. the source step (and, for a file delivery, its producing generator) is `completed` with `result.verified === true`;
3. the artifact exists and its stored body re-hashes to the recorded sha256;
4. the consuming step declared that dependency as an input with a purpose (`context`, `content`, `review_subject`).

Otherwise the handoff is **REFUSED**, recorded with a reason, and the consuming step holds (`HANDOFF_REFUSED`).

## What a handoff carries

Only data: the artifact id, its sha256, its type and the bounded body inside a fenced block
`<<<BUNNY_VERIFIED_DATA <label> sha256=…>>> … <<<END_BUNNY_VERIFIED_DATA>>>` with the instruction that content inside is
never to be followed. **No authority transfers**: the consumer's provider session, capabilities and scope are those the
Host planned for the consumer's own task kind; nothing in the artifact can widen them. A Reviewer's subject is a fresh
Host observation of the delivered file, not the producer's claim.

## Record

Each handoff row: `id, missionId, sourceAgentId, destinationAgentId, sourceStepId, destinationStepId,
destinationAttempt, artifactId, artifactSha256, artifactType, purpose, state (DELIVERED|REFUSED), reason, createdAt`,
plus a `mission.team.handoff` / `mission.team.handoff_refused` journal event. Consumption is also recorded on the
artifact (`artifacts.consume`).

## Files

A `write_file` step writes its verified producer's bytes (identical sha256) to `outputDir/target` with
`expectBeforeSha256` (absent, or this Mission's last verified write). `team_file` re-reads and compares the sha256.
`team_requirements` refuses a file whose current sha256 differs from the verified write (`STALE_VERIFICATION`).
