# Live routing

`TaskManager.submit` now stores an `executionPlan` for a non-delegated chat before the task is written. The plan comes from `hostExecutionPlan`, which uses the Host `classifyTask` baseline. A model proposal is accepted only when one is passed. Production submit does not pass one, so a model cannot change the class, add roles, or grant a tool.

`composeTeam` supplies the role list when the baseline has team capabilities. C0 and C1 store `team: null`. C2 stores Planner and Worker. C3 stores Planner, Worker, and Reviewer. The chat approval path still launches the one selected local model. The recorded team is not started as extra agents, and the class does not grant a tool or open a mission.

An `execution.classified` event is emitted. It is not in the public activity labels. The task field is the proof.

Unit coverage in `src/lib/bunny-host/ma4-s3-t1.test.ts` goes through `TaskManager.submit`, not a direct `classifyTask` call:

- a plain onboarding prompt is C0 with a null team and no mission
- "Read NOTES.md" is C1, roles `["tool"]`, team null
- "Inspect several files and propose a patch." is C2, team Planner and Worker
- "Deploy the production service." is C3, team Planner, Worker, and Reviewer, and no mission
- a model proposal cannot widen a C3 plan
- "What HTTP status code means Not Found?" stays C0

Live production submits in `evidence/measure.json` match that: the status-code prompt stored C0 and a null team; the SQL and file prompts stored C3 with Planner, Worker, and Reviewer. The installed-package smoke stored C0, C1, and C2 the same way.
