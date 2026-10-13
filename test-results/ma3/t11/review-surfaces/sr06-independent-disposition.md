# SR-06 independent Project endpoint disposition

Reviewed 2026-10-11. Reviewer did not author the projection changes. Scope: the new `deviceProjectDetail` projection,
its use by remote `project.get`, remote `project.list` folder masking, and supported aliases on canonical team
records. All probes use disposable fixture Host state and scripted/SIMULATED model responses. No installed
production process/state, credentials, or network service was accessed or changed; no source files were edited.

## Final disposition: PASS — both residual aliases fixed and independently verified

The parent repaired both findings below. The final native fixture run passes the expanded permanent surface test
and both actual remote Project command probes (3/3): `sr06-final-native.log`. Both adversarial marker scans return
an empty list. A separate projection check confirms that `constraints.workingDirectory` is removed without changing
canonical/local context (1/1): `sr06-workingdir-final.log`. No unresolved finding remains within this assigned scope.

Source disposition: `deviceTeamMission` now replaces planning rationale and recovery diagnostics with fixed device
labels. Project Tasks use `publicTask(deviceTask(task))`; `publicTask` is the extracted existing dashboard projection,
so provider activity details, stop diagnostics, verification content and progress context receive the same public
sanitation. `deviceTask` also removes the working-directory constraint alias. The local `project.get` and
`project.list` branches still return the unmodified workstation projections.

An intermediate sandbox rerun hit EPERM renaming a disposable fixture workspace. The approved native rerun avoided
that environment restriction and passed without weakening workspace identity or isolation checks.

## Initial disposition: FAIL — two residual aliases reproduced

The existing permanent `agent-team-surfaces.test.ts` passes (`sr06-focused.log`), but does not exercise all of the
canonical aliases exposed by Project detail.

* **SR06-A — Medium privacy finding:** accepted Planner summary text is retained in
  `missions[0].planning.rationale[0]` on remote `project.get`. A real fixture Planner proposed the valid PLAN with
  summary `PRIVATE_PLANNER_SUMMARY_SR06: C:/private-host/project-data`; the actual remote Project command returned
  that unfiltered model text and path. Root cause: `deviceProjectDetail` retains full canonical Mission planning
  rationale, while the dashboard's public projection clears it. Minimal repair: use the same fixed public Mission
  diagnostic projection on this remote read path; retain local diagnostics. Evidence: `sr06-alias.log` and
  `sr06-alias-probes.test.ts` (`SR06-ALIAS`).
* **SR06-B — Medium privacy finding:** streamed provider output is retained in `tasks[0].latestEvent.detail` on
  remote `project.get`. A real admitted team model fixture was held open, then its actual `AdapterHooks.event`
  published `agent.output` with a private marker and the fixture Project root. The actual remote Project command
  retained both. Root cause: `deviceTask` removes process/cwd/prompt fields, but Project detail does not apply the
  dashboard's fixed public activity-detail projection. Minimal repair: sanitize typed Task diagnostic aliases
  (`latestEvent.detail`, `stopReason`, determinate `progress.current`, verification expected content and Host working
  directories) on the remote endpoint, preserving local evidence. Evidence: `sr06-event-alias.log` and
  `sr06-alias-probes.test.ts` (`SR06-EVENT-ALIAS`).

Neither probe grants additional authority or sends instructions to a model. Both expose workstation-only text
through a read endpoint already authorized for the paired device. The HTTP success serializer's
`redactReviewListing` does not remove these strings; `hidePaths` applies only to Project command refusals.

## Boundaries verified by the focused permanent test

Active and completed consent snapshots mask team paths and protected working text. Remote Project list and detail
mask the directly tested Project/root/workspace/artifact-location fields. Verified team observation/Reviewer body
reads are withheld by the HTTP artifact projection, while verified deliverable previews remain readable. Raw team
`mission.get` remains workstation-only. Local Project reads retain their original context.

This disposition covers fixture privacy/authority projection only; it does not claim live-model, visual browser,
deployment, full regression-suite or installed-production-preservation acceptance performed by other reviewers.
