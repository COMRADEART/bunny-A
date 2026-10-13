# M-A-2 Final Remediation R1

Authorized attempt, 2026-10-07. **BUNNY_MA2_FINAL_REMEDIATION_R1_FAIL**: fresh ownership preflight refused before any production Stop or selection. Explicit human authorization is recorded for the exact v26 candidate. The completed fix, immutable candidate and staged acceptance pass; production remains healthy on v17-T6. This is an implementer refusal record, not an independent operational verdict. The earlier approval checkpoint is preserved in `approval-checkpoint/` and Git commit `8762a02d39971a09f9bd812e9064b684e4ac8b3b`.

Evidence: `test-results/ma2-final-remediation-r1/`, with the complete file hash inventory in `evidence/index.json`. Candidate runtime source is commit `8001d51d871f12c15b8de03005a40e9d4c3fd8c2`; candidate tooling is commit `0d3f96db093b2106ebab90e0249ae7b1e711aee9`. Subsequent report/evidence commits do not change those release pins.

## Independent-review blockers

The immutable `MA2_FINAL_INDEPENDENT_REVIEW.md` returned **BUNNY_MA2_OPERATIONAL_FAIL**. B1/IR-H1 allowed a failed post-Stop process inspection to fall back to the pre-Stop table, select a stale PID and pass integer-only destructive authority onward. B2 found the accepted staged fixes absent from the actual v17-T6 production selection. This run addresses only those blockers. No M-A-3, OD-1/OCT-1 features, new autonomy or redesign were added.

The prior review was read before investigation and was not edited. All six required historical evidence roots were inspected and fingerprinted in `baseline/historical-evidence-inspection.json`. Their earlier failure records and qualifications remain historical evidence, including the T6 index discrepancy, T8 provider-ledger provenance qualification and development Host finding.

## Baseline

Initial repository HEAD was `deb83e80443759fb02abd351d72033aa982a7303`, branch `ma2-operational-hardening`, with no tracked working changes. Pre-existing untracked reports and `memory/` were preserved. `baseline/production.json` was captured after the runtime fix existed in the working tree and records that state accurately; it is not presented as a pristine pre-write Git snapshot.

Fresh production discovery found **Bunny-A-Windows-v17-T6**, source `cb005ef75bf86d4d9e722b5214612fe115db5c6b`, tooling `90a6e8da11e77bd1d3d402c166456f0d816fb4c4`, manifest `f5bf648c92711baba3fe4a24ea46c449fd8f226c0afa018f8f9cf93da52fde88`, ZIP `29740a280d96a7d1ed87acab3fbd59fc709ed523e8f118da43be4603606ace1d`. Canonical external state is `C:\Users\allam\AppData\Local\Bunny-A\state`, workspace `C:\Users\allam\Bunny-Workspace`; Missions and Triggers are OFF. A newer inactive v25-T10 stage existed and was preserved; its presence did not establish production deployment.

Baseline and approval-checkpoint production health agree on Host PID 35792 / instance `3ea628ff-7f5e-47fb-8f66-69c42b32112a`. Current native lifetimes, gateway, app, tunnel and cloudflared facts are in `pre-activation/native.json`; saved identifiers are evidence, never future kill authority.

## IR-H1 reproduction

Before source editing, a disposable real TaskManager submitted and approved a harmless fixture, captured an actual child process table and ran `stop()`. Its provider Stop exited the owned child. Post-Stop inspection rejected. The old manager still selected integer PID **21456**, despite the fabricated reuse identity having a different creation time. All destructive calls were intercepted; the real sentinel survived. The trace proves `inspect-1 → session.stop → inspect-2 → destructive selection`; no real OS PID reuse was attempted. See `ir-h1-reproduction.json` and `reproduce-ir-h1.mjs`.

The focused regression was also executed against the exact old manager Git blob and failed on the selected stale PID as intended (`ir-h1-regression-before.log`). This is a reached real Stop branch, not a source-only helper assertion. A controller teardown issue was corrected without killing a bystander; its evidence limitations are retained in `failure-ledger.json`.

## IR-H1 root cause

The original `readProcessTable().catch(() => before)` promoted historical evidence into current destructive authority. The following integer-PID termination lost the birth/image identity and admitted a time-of-check/time-of-use race. Reusing an old process table after a failed fresh inspection made authority stronger precisely when ownership evidence became weaker.

## IR-H1 repair

The manager now preserves the initial table only as evidence. Failed fresh reads produce `null`, abort supplementary cleanup and persist an explicit `stopCleanup` result. Missing birth identity also refuses cleanup. Successful enumeration selects only matching PID, finite positive creation time and current image identity, then passes the full ProcessInfo to termination.

On Windows, the native `terminateVerified` primitive opens one non-inheritable process handle, verifies current creation time and executable basename against the expected architecture identity, and terminates through that same held handle. It rejects self, changed lifetime/image and unavailable identity. It does not reopen a naked PID after checking. Supplementary non-Windows termination fails closed. The existing T4 Git Windows Job Object launch/close path is unchanged and runs before supplementary enumeration.

Files: `src/lib/bunny-host/manager.server.ts`, `process-tree.server.ts`, `owned-process-group.server.ts`, `native/bunny-owned-process.c`, `src/lib/orch/types.ts`; focused real-manager fixture in `scripts/ir-h1-stop-fixture.mjs`, tests in `src/lib/bunny-host/stop-ownership.test.ts`. `ir-h1-fix.json` records the exact artifact outcomes.

## Ownership invariant

**Failed fresh ownership inspection reduces authority, never expands it.** An already-held canonical kernel Job Object may still close its own job. Otherwise unavailable inspection or lifetime identity prevents destructive cleanup. Historical PIDs, cached tables, names and window titles confer no cleanup authority. No name-based killing or reconstructed job ownership was introduced.

## PID-reuse regression

The real-manager identity-reuse case presents a different birth identity at the old PID and observes zero destructive calls. Additional cases cover image drift, absent birth identity and native last-hop lifetime mismatch on an actual held process. Reuse is honestly **SIMULATED** within disposable live fixtures. A live sentinel survives every case. Actual dangerous production OS PID reuse is NOT TESTED. See `pid-reuse-test.json`.

## Fresh-inspection failure behavior

The installed-artifact failure case reaches real TaskManager Stop, requests provider Stop, fails fresh enumeration, calls no supplementary terminator, and records `ownership_unverified`, one unresolved process and truthful task/activity detail. Before-read failure, final-read failure and termination refusal are also exercised. Final inspection failure never reuses the preceding table to claim complete cleanup. The task's Stop transition and its separate cleanup status are both preserved.

The positive control performs actual native termination of the same corroborated owned lifetime and confirms final OS absence; the sentinel survives. All nine installed runtime cases pass, plus the birth/image identity test: **10 focused regression tests**. See `fresh-inspection-failure.json` and `positive-cleanup-control.json`.

## Repair inventory

`repair-inventory.json` verifies ancestry and exact candidate Git blobs, rather than trusting a version label. All six repairs are in this one candidate; none was present as an accepted complete repair in the pre-activation production source lineage.

| Repair | Source commit | Main surface |
|---|---|---|
| SSE per-delivery revocation | `738f05b25609f45001ba760ed3f21ba5e92aa571` | Host HTTP stream |
| Canonical rollback quiescence | `99ffbdd20455d56d64666adf9ad1c427df269ae4` | Installer and read-only SQLite/live preflight |
| Restart approval invalidation | `4f977c8071be17a7807a6c0b6f072f8f17cd4d4d` | Mission recovery |
| T9 bounded approval | `445beebf8c9d951066dd0bddb1b066820762a912` | Batches, authorization and capability admission |
| T9R target lifecycle | `b6caa93d0b4d80417c8adb690ce3e85a140909c4` | Canonical Calculator acquisition/reuse |
| IR-H1 ownership | `8001d51d871f12c15b8de03005a40e9d4c3fd8c2` | TaskManager, process identity and native held handle |

## Complete repaired candidate

**Bunny-A-Windows-v26-MA2-R1 / 26.0.0-MA2-R1** was packaged from committed source and tooling archives. No dirty runtime input was used. The release pin retains the accepted previous gate repair identities. All **160 manifest-covered files**, **80 source/tooling Git blobs**, all file sizes, complete import closure and installed copy match. The ZIP audit verifies **161 file entries**, including the manifest, under the exact release prefix; directory placeholders are excluded. Prior releases remain immutable. No runtime repository dependency is required.

## Stage acceptance

The canonical installer selected the candidate only in `C:\Users\allam\AppData\Local\Bunny-A-R1-stage`, with a SQLite-consistent private production copy, a new credential, separate workspace `C:\Users\allam\Bunny-Workspace-R1-stage` and separate Host/dashboard addresses. Copied production devices were revoked **only in the stage**. No real Phone companion was used for testing. The production selection was not switched.

`stage.json` consolidates installed ownership tests, SSE, active-authority rollback refusal, actual hard-crash recovery, native batching/lifecycle and rendered desktop/mobile checks. Both desktop/mobile screenshots and both real reconnect screenshots were visually inspected. Exact installed dashboard content rendered with no page/console errors or horizontal overflow. Two unavailable agent-browser attempts and a failed Computer Use/CUA kernel are recorded; the repository-permitted Playwright fallback performed an actual Edge reload.

Cleanup ended every test Mission/grant, revoked every stage device, closed only the proven test-created Calculator and stopped only the fresh held-identity stage Host and QA gateway. Final Calculator count is zero; the shared ApplicationFrameHost survives. The stage is inactive and its private Mission/Trigger policy was retired to OFF after shutdown. Production and development were not stopped. Known resolved harness failures are retained, not hidden.

## SSE revocation

**DISPOSABLE LIVE:** a dedicated stage device opened an authorized stream. Revocation closed it; a later harmless protected Task event reached the workstation stream and delivered zero future protected bytes to the revoked stream. Protected read, command and reconnect returned 401. The dedicated identity was revoked in `finally`. See `sse-revocation-stage.json`. **Production acceptance is pending**, not inferred from staged proof.

## Rollback quiescence

**DISPOSABLE LIVE:** the exact installed candidate installer and preflight encountered one waiting Mission and one live grant. They refused with canonical active-work counts **before mutation**. Install configuration SHA and Host instance were unchanged; no process stop or release switch occurred. The valid prior-selection fixture used isolated stage state. Full regression also covers paused canonical authority, enabled policy and validation ordering. See `rollback-guard-stage.json`. No real production rollback was performed.

## Restart approval invalidation

**DISPOSABLE LIVE:** a fresh native acquisition consumed one action in an active finite batch and then waited on a separate, never-approved typing request. The stage Host was crashed using a fresh corroborated held identity and restarted through its installed launcher. Its instance changed. Run count did not increase, the grant did not revive, both old decision IDs were rejected and the recovered Mission still required user authority. See `restart-approval-stage.json`. The first resumed fixture correctly paused on an unready minimized UWP surface; the same proven owned window was restored and the fresh active boundary rerun successfully.

## T9 approval batching

Allow once, explicit bounded batch, two-action exhaustion/fresh approval, live one-second expiry/refresh, Stop isolation, independent Mission authority and remote count/time clamp pass. A live Calculator batch did not cover a PowerShell escape; that separate action remained unexecuted. Existing remote Host grants keep their exact finite operation scope, while revoked-device future commands fail. Risk ceiling, exact step/action, application and Browser/shell exclusion also pass in unchanged full security tests. Browser exclusion is **STATIC VERIFIED**, not a claimed live Browser escape trial. See `t9-stage.json`.

## T9R target lifecycle

One explicit stage fixture launch created one verified Microsoft Calculator. All later workflows treated it as pre-existing and preserved its native HWND/frame/content creation identity and displayed value. Repeated acquisition, concurrent same-Mission acquisition, actual postcondition retry, focus loss, finite budget/time refresh and dashboard reconnect produced **zero additional launches**. Focus loss paused without acting or relaunching; restoring the same owned target required fresh approval. Reload left canonical grant ID, used count and capability run count unchanged.

Initial real-user Calculator census was zero; a real pre-existing user window is not invented. The controlled external fixture exercised preservation for subsequent workflows, and existing unchanged harness security tests reject user/pre-existing cleanup authority. Final exact owned cleanup closed only the fixture and left zero unexplained Calculator windows. See `t9r-stage.json`, `calculator-owned-ledger.json` and `calculator-owned-cleanup.json`.

## Full regression

**664 tests pass: 254 scripts + 373 applications + 37 UI.** No failed, skipped or cancelled tests; no existing tests deleted or changed. The ten new Stop tests account for the increase from the independently observed 654-test inventory. This count was discovered from current execution, not copied from the old review.

Full `npm test`, UI tests, typecheck, lint, normal build and Windows package validation exit zero. Lint has eleven existing warnings and zero errors. Unchanged full native/install/rollback security coverage includes Git Job Object ownership, Stop isolation, owned-hook drain, unrelated Git survival, stale identity and foreign native authority rejection. Current focused regression passes against the actual installed artifact. See `regression.json`, raw logs and exit records. Resolved fixture placement/positive-table/PowerShell/cleanup metadata/audit-prefix issues are disclosed in `failure-ledger.json`.

## Candidate identity

| Identity | Exact value |
|---|---|
| Release/version | Bunny-A-Windows-v26-MA2-R1 / 26.0.0-MA2-R1 |
| Source | `8001d51d871f12c15b8de03005a40e9d4c3fd8c2` |
| Tooling | `0d3f96db093b2106ebab90e0249ae7b1e711aee9` |
| Manifest SHA-256 | `06836b4847824edcbfa4c1628b4e0106c5ccded24a8d9361355003f467339e54` |
| ZIP SHA-256 | `3e68faed3e1d9ae75d1d3f2140c831e8843fc914ea7dc179e78c81445f7fbac3` |
| ZIP bytes | 36,264,407 |
| Dashboard asset manifest SHA-256 | `176828598eb38f2b2e0e6dd84316d657d04ebd07362304254a56b59c6ff74d75` |
| Covered files / Git blobs / ZIP files | 160 / 80 / 161 |

## Production authorization

**Obtained directly from the human user for the exact release/version/source/tooling/manifest/ZIP above.** `authorization.json` records the authorized backup, fresh ownership/held Stop, activation and acceptance scope, plus the requirement to stop safely on any failed required preflight and to withhold final operational PASS. This authorization persists; no repeat permission request is being made. It did not authorize skipping a failed preflight.

## Production activation

**NOT PERFORMED — required preflight FAILED CLOSED.** The exact candidate was installed into the external production release directory with the pinned installer's `-StageOnly` mode; selection was unchanged. Fresh canonical idle and read-only SQLite backup checks passed. The five-role promotion controller then refused four unmodelled descendants at line 57, before Stop, startup inhibition or selection. Read-only diagnosis identified Microsoft-signed System32 `conhost.exe` children created 9–20 ms after the corroborated Node/cloudflared parents. This is an overly strict controller model, not a demonstrated candidate runtime defect. No authority was inferred from the diagnosis, no process was stopped and no activation retry followed. See `production/ownership-inspect.log`, `preflight-refusal.json` and `refusal-diagnosis.json`. The prepared selection phase would use the pinned installer and canonical atomic state writer under startup inhibition; that phase is unexecuted. No Git deployment or historical controller was used.

## Production identity

Fresh post-refusal facts still show **v17-T6** running, with the same healthy Host instance and gateway release identity. `final-production.json`, `production/preflight-refusal.json` and `refusal-diagnosis.json` contain current identities. V26 bytes are present only as an inactive immutable installed release. All six repaired production acceptance records remain **NOT TESTED** because activation stopped at preflight.

## State preservation

Read-only `VACUUM INTO` produced an integrity-checked private SQLite backup both at baseline and at the approval checkpoint. Backups are outside repository/evidence and contain no Git-committed credential material. Fresh protected-row comparison found **zero missing and zero changed historical protected rows** under the existing documented rowDigest exclusions (credential-bearing fields, provider volatile probe telemetry, volatile workspace locks). The full device rows and settings hashes are separately equal. Projects, skills, Task history and Mission/Trigger state were preserved during preparation; actual post-activation preservation remains pending. The authorized preflight produced an additional integrity-checked private canonical backup. Post-refusal comparison has zero missing/changed historical rows, exact device/settings/Startup/configuration hashes, and only two appended `provider.status_changed` events from the untouched Host. The initial checker wrongly required zero appends; raw failure logs and the resolved telemetry qualification are retained. No new Task/Mission/device work was appended.

Production is currently healthy and canonical preflight reports no active Tasks/Missions/runs/grants, with scheduling OFF; no pending destructive approval or in-flight mutation was found. Startup/selection/credential/layout/deployment/consent hashes remain unchanged. These facts must be rechecked immediately before promotion; real work must never be force-stopped.

## Device preservation

All sixteen production device rows match the baseline full-row hashes. The fifteen previously revoked identities remain revoked. New temporary QA device rows and copied Phone revocation occurred solely in the separate stage, where every device is now revoked. Production QA device creation/revocation acceptance has not occurred.

## Phone companion preservation

The sole active **Phone companion** row remains present, unrevoked and unchanged in the production ledger. It was never used as a QA identity. No physical handset interaction or new public-tunnel browser acceptance is claimed. Phone preservation after activation still requires the immediate pre/post comparison.

## Current rollback controller

The replacement procedure points to the repaired candidate's installed installer and canonical quiescence guard plus fresh held-identity Stop. `historical-controller-classification.json` fingerprints retained old guides/controller and classifies their bare-PID/manual-copy promotion use as unsafe. Nothing historical was deleted. **The production operational pointer has not yet been updated**, because repaired activation failed preflight and was not performed. That pointer update and production installed-tooling guard acceptance remain completion conditions.

## Development Host classification

Fresh Windows GetOwner identifies **COMRADE\allam**. PID 20936 / instance `86a8abb0-f9c1-40a9-9f2d-90a1289f150a` belongs to a Git Bash → `npm run host` → cmd → Program Files Node → source `scripts/bunny-host.mjs` chain, started 2026-10-06T15:06:09Z. Its separate external state is `Bunny-A\development`, separate matching credentials, port 43139, zero Tasks/Missions/devices/capability runs/permission requests/projects, and a token distinct from production. It is a source development entry, not an installed production singleton collision or a remediation-created test process.

No production Startup shortcut points to that source entry. The exact running default workspace is not exposed by its read-only API; source uses `process.cwd()`, and npm project root is an inference rather than fresh proof. The original human launch purpose/intent and reason for retaining it are not established. It remains live because stale-test cleanup ownership was not proven. See `development-host.json` and `development-native.json`.

## Secret audit

`secret-audit.json` records exact known production/stage/development Host-secret and environment-secret scans plus bearer/cookie/provider/password/private-key pattern checks across this packet and the four updated reports. Raw credentials, private backup SQLite files and live state remain outside evidence. Dedicated device tokens existed only in memory; persisted device hashes are not tokens. Source code constructs headers dynamically and contains non-secret probe markers; those are not actual credentials. Screenshots were visually checked and display no pairing code or credential. The hashed index excludes its own file to avoid a self-hash cycle.

## LIVE VERIFIED

Read-only current production identity, health, canonical consistent backup, idle state, protected-row/device/settings/Startup preservation and distinct development ownership/state. This category does **not** include repaired production deployment or production acceptance.

## DISPOSABLE LIVE

Real TaskManager before/fixed branch execution, actual positive native cleanup and sentinel survival; exact installed stage SSE/restart/rollback/batching/native lifecycle, real Edge reload, desktop/mobile render and bounded cleanup. Simulated identity replacement within those fixtures is separately labelled.

## SIMULATED

Fabricated PID reuse, changed identity and last-hop mismatch; no actual dangerous OS reuse. These faithfully drive the real manager/native boundaries and do not authorize any real bystander termination.

## STATIC VERIFIED

Six-repair ancestry and exact Git/installed/ZIP byte checks; committed source/tooling/import closure; native ownership code; executed 664-test floor and unchanged T4/T9 security coverage; historical review and controller fingerprints; prepared operational procedure and pending acceptance records.

## NOT TESTED

Production activation and all repaired production acceptance, production operational pointer retirement, post-activation data/Phone preservation, physical Android/iOS Phone interaction, real reboot/logon, dangerous actual OS PID reuse, real pre-existing user Calculator in this run, and broader localized/multi-monitor/privileged native surfaces. Exact development cwd and original human intent remain unknown. Existing historical provider compatibility/provenance limitations are retained; no new paid provider task was run.

## Remaining limitations

B2 is still open while production remains v17-T6. B1 has implementer closure evidence, pending a fresh independent reviewer. Windows UIA/focus and live process checks do not form an atomic desktop lock; destructive supplementary process termination itself uses a held corroborated lifetime. An unverified cleanup state intentionally remains truthful and requires investigation instead of aggressive cleanup. Tool/kernel and resolved harness failures are disclosed. The immediate unresolved issue is the promotion controller's missing Windows console-support model. It must be corrected and independently corroborated without adding name-based cleanup or stale PID authority before an entirely fresh attempt. Authorization is already recorded; the current failed attempt remains stopped.

## Final remediation verdict

**BUNNY_MA2_FINAL_REMEDIATION_R1_FAIL** for the authorized attempt: ownership preflight failed, promotion was stopped safely, and required repaired production acceptance did not happen. `final-verdict.json` distinguishes those outstanding completion conditions from the passing repair/stage evidence. No **BUNNY_MA2_OPERATIONAL_PASS** is claimed. After authorized activation and complete production acceptance, the required next step is **M-A-2 FINAL INDEPENDENT RE-REVIEW** in a fresh reviewer/session.
