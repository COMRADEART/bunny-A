# M-A-2 Gate T5

T5 is a presentation and packaging gate. Host commands, journal, capability records,
MissionManager, TaskManager, authorization and the T1–T4 runtime remain authoritative.
The recorded starting source is `53120f3f81bf762f45f242f05838ff8262087988`.
The accepted T4 source is `21684ff60ee53e07937194838f1356a18ac158f5`, with tooling
`2e8a21cb3168d08ed1adb08544149d3f33ed05af` and regression floor 547 (240 + 286 + 21).

## IMPLEMENTED

Shared read-only activity projection uses immutable journal sequence IDs and existing
capability run IDs. A deterministic step's request and its current run share one activity
identity; no new activity store exists. Provider turn, Task, capability, Mission step and
independent verification have separate labels. Interrupted work offers a fresh retry;
it never claims an old session resumed. Produced artifacts require canonical verification.

Snapshot revisions and Host instance IDs reject stale responses. Replay deduplicates
journal sequences; retention gaps and reconnects fetch canonical state and replace
capability rows. Logical roles survive provider rerouting. The compact worker strip shows
up to three roles plus overflow; completion collapses. Finite provider/Mission progress
remains finite; unknown work stays indeterminate.

Dashboard, phone and native Island use safe presentation labels. Public activity defaults
to allowlisted labels, never provider detail, command arguments, raw capability parameters,
typed text or private reasoning. Untyped provider transcripts and diagnostic errors remain
on the Host. Authorization continues through existing commands with IDs, not projected
scope text. Scope presentation retains roots, access and risk while withholding command
arguments. Codex detail separates installation, authentication, direct-task readiness and
validated/restricted Mission execution. Host degradation remains visible.

Package manifest records dashboard source, timestamp and a digest of the sorted asset
inventory; local gateway health and Settings expose installed provenance. The manifest
also binds the Host to the exact source and tooling commits. Production assets never come
from the development checkout. Older source builds remain supported for rollback.

## LIVE VERIFIED

Evidence is kept under `test-results/ma2-gate5/`. Initial preservation and development
browser checks passed. Packaged candidate and production checks are recorded below only
after they actually run; staging alone cannot establish the T5 pass criterion.

## SIMULATED

Unit fixtures cover provider completion preceding verification, verification failure,
capability state correlation, denial, interruption, rerouting, duplicate/late delivery,
retention gaps, unknown Codex versions, artifacts and secret-bearing payloads.
Rendered fixture scenarios are explicitly distinguished from live provider execution.
No paid model session is necessary to validate presentation.

## STATIC VERIFIED

No T1–T4 authority redesign, new scheduler/event database/authorization system or external
framework was introduced. Native Windows Git ownership source remains unchanged.
Builds use immutable Git input; manifests hash the native helper and dashboard assets.

## NOT TESTED

Physical phone transport and public tunnel acceptance belong to T6. A local phone view
does not establish live remote availability. Real provider quota is not spent for UI tests.

## BLOCKED

Production activation awaits an explicit decision because T5 section 58 says
“Do not activate automatically.” Sections 30, 47, 49 and 59 require actual promotion for
PASS. Until the concrete candidate is accepted and activated, T5 cannot report PASS.

## DEFERRED

T6–T10 and independent full operational review. No full M-A-2 verdict is issued.

## OD-1 presentation lessons used

OD-1 is reference only: stable activity identity, clearer capability states, provider
turn/Task/verification distinction, reconnect/resync discipline and safe projection.
Not implemented: AgentWorkspace, persistent per-agent browser/workspace, derived
credentials, takeover/handback, capability revocation revisions, published-skill lifecycle,
Slack/calls or AG-UI core protocol. OpenDots/OpenBot/CopilotKit were not imported.

## Rollback state

The live baseline is installed `Bunny-A-Windows-v17-T3`, not v10. Its source is
`d2088ae9e9121310c54aa58d231a8804075fc41f`; production had not activated the T4 candidate.
The v10 directory and T3 release remain preserved. Production state is outside Git;
Missions and triggers are OFF, with 54 Tasks, 13 projects and 9 historical devices.
Rollback configuration and database backup must exist before any activation.

## Candidate identity

Target: `Bunny-A-Windows-v17-T5`, containing T1–T5. Exact source/tooling commits,
ZIP/manifest hashes, dashboard timestamp and asset digest are read from the built package
and captured in `test-results/ma2-gate5/candidate-identity.json`. No SHA is invented.
