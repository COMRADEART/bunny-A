# Independent T11 planner and surface repair review

Reviewed 2026-10-11. This reviewer did not author the PA/SURF production repairs. Prior findings were recovered from the workflow journal. Tests use SIMULATED local provider responses; Host validation, routing, identities, SQLite, artifact reads and filesystem delivery are real disposable code paths. No installed provider, production state, credential or Git operation was used.

## Original finding dispositions

| Finding | Disposition | Independent evidence |
| --- | --- | --- |
| PA-01 | CLOSED | Generic local Mission approve/start/plan/replan and direct manager approval refuse before team execution. Coordinator plan approval succeeds. Focused existing regression passed. |
| PA-02 | CLOSED | Host repair and advisory Reviewer text enter `dataBlock`, which defangs raw BUNNY fence markers. Focused prompt regression passed; both production interpolation paths inspected. |
| PA-03 | CLOSED | Planner task objectives reject reserved fence markers. User objective, task text, requirement text and planner rejection feedback are defanged before prompt interpolation. Check values containing a fence marker are rejected by bounded requirement validation. |
| PA-04 | CLOSED | Review/verify requirements must match the subject deliverable's type. Cross-type HTML/Markdown checks are rejected. The public result's absent-line fallback also requires the matching checked type. |
| SURF-01 | CLOSED | Actual `ProjectService.command('project.artifact', ..., false)` on verified review and structured_result team artifacts followed by the exact HTTP `deviceArtifactRead` callback returns a fixed Host label, never the working body. Verified source_file delivery previews remain readable. |
| SURF-02 | CLOSED for snapshot surfaces | Initial stronger probe found additional aliases in requested filesystem roots, step scope/workspace, project path and active-consent Agent authorization roots. Those were repaired and independently retested. Complete phone snapshots for active consent and completed teams now contain neither the disposable Host root nor private markers. |
| SURF-03 | CLOSED for snapshot surfaces | Model-echoed rejection marker retained in workstation evidence but absent from both phone team and teamView projections. |
| SURF-04 | CLOSED | All original start/go-ahead/proceed/make-pass/mark-passed/revise/start-Mission utterances return sensitive_refused. Existing focused classifier regression and independent phrase probe pass. |
| SURF-05 | CLOSED for snapshot surfaces | Non-null revision note and browser fixture origin stay on the workstation. Phone projection masks both. |

## Additional route review

SR-05 (MEDIUM) was reproduced: raw remote `mission.get` bypassed phone snapshot redaction through its separate `data` record, including team notes, Reviewer summary, roots, event/memory/run text and artifact locations. It is now CLOSED: remote team Mission detail refuses with workstation-required; workstation detail still succeeds. The permanent regression verifies both outcomes.

SR-06 (MEDIUM, adjacent baseline route) remains OPEN at this disposition point: paired-device `project.list` and `project.get` still return raw result records. This predates T11, but a Team Mission's new metadata reaches it. An executed disposable command probe found these field aliases:

- `project.list`: `projects[0].path`.
- `project.get`: `project.path`; `missions[0].team.revisionNote`, `rejected[].reasons[]`, `browserFixture`, `root`, `requestedScope.projectRoots[]`, `requestedScope.filesystem.read[]`; and `workspaces[].root.path`, `scratch.path`, `workspaceRoot.path`.

`DEVICE_RIGHTS` permits both reads, and the HTTP project-command branch projects only `project.artifact`. Recommended containment: apply the same device-safe project/Mission/workspace projection to these responses or require workstation access for raw project detail. Keep workstation reads intact. Regressions should assert the actual command response cannot carry the disposable Host root or private team markers.

No BLOCKER or HIGH issue was identified in this independent scope.

## Verification and durable regression

- Existing focused PA/SURF regressions: **5 passed, 0 failed**.
- Independent repaired snapshot, requirement-value, voice and active-consent probes SR-01..04: **4 passed, 0 failed** (9.37 seconds). Project artifact reads use verified-only fixtures; unverified artifacts were independently refused by the canonical service.
- New `src/lib/bunny-host/agent-team-surfaces.test.ts`: **1 passed, 0 failed** (12.96 seconds). One real active-to-completed team covers complete phone snapshot redaction, real project.artifact command reads, verified working-material withholding, deliverable previews, and remote Mission detail containment.

Disposable probes: `test-results/ma3/t11/review-surfaces/surface-probe.test.mjs`. They print field names and boolean/categorical evidence only; private path values and credentials are omitted.
