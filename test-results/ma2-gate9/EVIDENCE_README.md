# T9 evidence navigation

The final accepted candidate is **Bunny-A-Windows-v20-T9**. Start with
`acceptance-final.json`, `MA2_T9_APPROVAL_BATCHING_ACCEPTANCE.md`,
`v20-candidate-package.json`, `regression-final.json` and `final-production.json`.
The four required report snapshots are included here; authoritative editable reports also
remain at the repository root. `evidence/index.json` contains relative paths, sizes, SHA-256,
classifications and timestamps. It excludes credentials, state databases and itself.

The A–J live matrix uses `v20-*-live.json`; Stop in-flight is G2, sensitive typing S,
restart R0/R1/R, actual UI/companion interaction `v20-ui-live.json`. `v20-privacy.json`
and `v20-journal.json` scan canonical records and renderer projections. Screenshots include
the exact installed dashboard/card at desktop, mobile and dedicated companion sizes.

`current-approval-model.md` is the original before-T9 analysis. `baseline.json` is the T8
baseline; `resumed-baseline.json` identifies the partial T9 continuation. `policy-design.md`
is the accepted policy. `policy-design-before-admission-review.md` and
`acceptance-before-final-review.md` preserve superseded drafts. Older v17/v18/v19 records
are history, including failures; they are not evidence that the earlier unsafe policy passed.
`candidate-package.json` remains the historical v17 package record; the explicit v20 record
is authoritative. Earlier ZIP/folders remain immutable outside this evidence directory.

`failure-ledger.json` explains resolved product/admission/privacy findings and harness errors.
Default v20 npm-test logs are failures due to a T4 fixture cleanup EPERM, not pass logs.
The unchanged isolated T4 test and complete unchanged sequential inventory pass in
`t9-v20-t4-cleanup-isolated.log` and `t9-v20-full-sequential.log`. UI tests pass separately.
Total 624 = 247 scripts + 340 application + 37 UI; focused 26 are included in application.
No case or assertion was skipped/weakened to obtain the verdict.

`staging/` contains acceptance tooling only. It is not a second product authority service.
Legacy v18 filenames/titles are retained; each final record proves actual v20 identity.
Production stays v17-T6. No T10 work, physical phone/public tunnel acceptance or production
activation is claimed. A future activation requires separate authorization and fresh backup.
