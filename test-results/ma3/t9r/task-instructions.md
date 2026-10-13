# BUNNY-A — M-A-3 GATE T9R
## CALCULATOR REGRESSION REPAIR + SECURE PHONE RE-ACCEPTANCE
### Root-Cause Investigation · Native UIA Recovery · Remote Security · Complete Regression

**PRIMARY DIRECTIVE**

Repair the failed M-A-3 T9 gate using the existing codebase.

Do not rebuild T9. Do not replace the architecture. Do not bypass, skip, or weaken the failing test.

The objective is to:

1. Identify the actual root cause of the Calculator UI Automation failure.
2. Repair the problem at the correct layer.
3. Reestablish the complete T6 X53 real cross-application workflow.
4. Preserve all newly implemented T9 remote-device security functionality.
5. Close the identified gaps in remote authorization and continuity testing.
6. Rerun the complete regression suite.
7. Produce an independently reviewable T9R acceptance report.

**Do not begin T10.**

---

## 0. Accepted source and failure baseline

Current T9 implementation:

`0a5988c5eef7e6beae3d1622529e2c638cca7788`

Branch:

`claude/ma3-t9-phone-remote`

Accepted T8 ancestor:

`987afeace77520b9f4ef49e27b137dd01fb3fee8`

Reported T9 outcome:

`BUNNY_MA3_T9_FAIL`

The T9 acceptance report identifies:

| Suite | Passed | Failed |
|---|---:|---:|
| Scripts | 256 | 0 |
| Library | 663 | 1 |
| Agent | 24 | 0 |
| UI | 99 | 0 |
| **Total** | **1,042** | **1** |

Total registered test inventory: **1,043**.

Typecheck, lint, build, remote-focused tests and Windows package build passed.

The original T8 baseline of 1,008 tests was preserved.

The failed existing test is:

**T6 X53 — Real integrated cross-application Mission.**

Observed failure:

`Calculator arithmetic identity unavailable`

Earlier stages passed:

- Filesystem
- Git
- Owned bounded terminal
- Fresh Host recovery
- Isolated browser

Failure occurs during verified native Calculator acquisition or arithmetic-control discovery.

A read-only UIA diagnostic reported that the expected arithmetic controls were unavailable.

The root cause has **not yet been established**.

Do not claim it is caused by T9 source changes without evidence.

---

## 1. Protect the existing system

Before touching code, verify:

- Current Git branch and HEAD.
- Exact executable source ancestry.
- T9 evidence commit.
- Working-tree status.
- Protected untracked reports.
- `memory/`.
- Existing user changes.
- Exact test runner inventory.
- Current production release identity.

Preserve all user files.

No destructive reset, clean, force checkout, or force push.

Do not automatically synchronize GitHub.

Do not modify installed production v26.

Production remains:

`Bunny-A-Windows-v26-MA2-R1`

The public tunnel remains disabled unless the user separately authorizes activation.

---

## 2. Establish a reproducible failing baseline

First reproduce X53 without modifying its existing assertions.

Capture:

- Exact failing command.
- Exit code.
- Test setup.
- Native Calculator acquisition path.
- UI Automation enumeration results.
- Host process identity.
- Target process/package identity.
- Target creation time.
- Window ownership and lifetime evidence.
- Control hierarchy.
- Expected arithmetic controls.
- Actual accessible controls.
- Active Windows session.
- Desktop/foreground/focus state.
- OS build and Calculator version where observable.

Preserve the failure output before any repair.

Create:

`test-results/ma3/t9r/baseline-failure.md`

If the failure cannot be reproduced, perform controlled cold/warm and isolation tests rather than declaring it fixed.

---

## 3. Root-cause investigation

Investigate the failure in this order.

### A. Windows application state

Determine whether Calculator:

- Is actually installed.
- Can be launched by the existing approved acquisition path.
- Has a valid current package identity.
- Is running under the expected user session.
- Is displaying the expected calculator mode.
- Has fully initialized its arithmetic controls.
- Is obstructed by a modal dialog or first-run state.
- Has an accessibility hierarchy different from the expected one.

Do not assume its UI structure is unchanged across app versions.

### B. UI Automation enumeration

Inspect the actual current UIA tree.

Compare:

- AutomationId.
- ControlType.
- Name.
- Parent/child hierarchy.
- Enabled state.
- Current control availability.
- Root element identity.

Determine whether the expected controls exist but are not yet discoverable, or whether the target itself is incorrect.

Do not replace semantic UIA selectors with fixed coordinates merely to make the test pass.

### C. Acquisition and readiness race

Examine:

- Application launch.
- Existing-window reuse.
- Target identity stabilization.
- UIA tree readiness.
- Timing between launch and acquisition.
- Retry behavior.
- Window replacement.
- Process lifetime.
- Focus changes.

If initialization requires waiting, implement a **bounded condition-based readiness check**.

Do not use arbitrary long sleeps as the permanent fix.

### D. Host execution context

Inspect:

- Windows desktop session.
- Interactive versus noninteractive launch.
- Process ownership.
- Parent/child relationship.
- Session ID.
- UIA access restrictions.
- Test fixture lifetime.

Determine whether X53 sometimes runs in an environment without accessible interactive controls.

An unavailable real UIA target cannot be replaced with a simulated success.

### E. T9 regression analysis

Compare the failing native path with the last demonstrably passing T6/T8 implementation.

Use focused diffs.

Inspect whether T9 changed:

- Host startup.
- Test isolation.
- Device authority.
- Process ownership.
- Calculator target acquisition.
- UIA timing.
- Capability Bus admission.
- Environment setup.
- Test orchestration.

Separate code regressions from environmental failures.

Do not revert unrelated T9 security improvements.

---

## 4. Repair rules

Fix the actual defective layer.

Acceptable repairs may include:

- Correcting application readiness detection.
- Updating semantic UIA discovery based on verified current controls.
- Correcting target acquisition/reuse logic.
- Fixing stale target identity handling.
- Correcting interactive-session initialization.
- Repairing deterministic fixture setup.
- Adding bounded retries around genuinely transient readiness conditions.

Forbidden shortcuts:

- Skipping X53.
- Marking unavailable controls as available.
- Replacing live UIA with mock UIA.
- Removing arithmetic verification.
- Disabling target identity checks.
- Ignoring process lifetime mismatch.
- Hardcoding screen coordinates.
- Broad process-name termination.
- Killing unrelated Calculator processes.
- Catching the error and reporting success.
- Increasing timeouts indefinitely.
- Accepting stale HWND/PID as authority.

If real Calculator control is unavailable under the current environment, report the limitation and retain FAIL until a valid positive live test can run.

---

## 5. Preserve MA2 T9/T9R authority

The repair must preserve:

- Fresh application identity.
- Exact target binding.
- Exact operation family.
- Host authorization.
- Process ownership validation.
- Protected user processes.
- Target reuse where safe.
- Bounded action batches.
- Restart approval invalidation.

A UIA repair must never become a permission-system bypass.

The authorization must still bind to the actual current Calculator target, not merely the name "Calculator."

---

## 6. X53 re-acceptance

Reexecute the **entire original X53 workflow**, not just Calculator in isolation.

Required sequence:

1. Start disposable Windows Host.
2. Create or recover the disposable Mission.
3. Read approved filesystem resource.
4. Inspect Git.
5. Execute bounded approved terminal operation.
6. Perform real Host recovery.
7. Navigate the isolated browser.
8. Acquire or safely reuse native Calculator.
9. Discover verified arithmetic controls.
10. Execute approved arithmetic interaction.
11. Read actual Calculator result.
12. Independently verify postcondition.
13. Save verified Mission artifact.
14. Complete the Mission.

Require:

- Same Agent identity.
- Same Mission identity.
- Genuine capability execution.
- Valid current authorization.
- No duplicate application acquisition.
- No stale target reuse.
- No unrelated process termination.
- Verified final artifact.

Only a real native UIA execution counts as X53 LIVE VERIFIED.

---

## 7. Stability testing

A single green run is not sufficient to close an intermittent native failure.

Run a bounded stability matrix, including:

- Cold application start.
- Warm existing Calculator.
- Repeated target reuse.
- Fresh disposable Host.
- Host restart.
- UIA initialization delay.
- Focus unavailable.
- Target closed during acquisition.
- Window replaced during acquisition.
- Concurrent app acquisition attempt.
- Previous owned Calculator cleanup.
- Unrelated user Calculator already running.

Aim for at least **10 consecutive clean X53 runs** across appropriate cold and warm states, when the workstation and test runtime permit.

Do not manipulate the result by silently retrying failed complete runs.

Preserve each failure and record its root cause.

If some environmental conditions cannot be exercised, label them NOT TESTED.

---

## 8. Preserve T9 functionality

The accepted T9 source already implements:

- Host-owned paired-device identity.
- Remote Agent/Mission inspection.
- Paired-client Pause/Resume/Stop.
- Scoped approval/denial.
- Device revocation.
- Authenticated device events.
- Offline/stale presentation.
- Operation ID reconciliation.
- Host epoch validation.
- Artifact access restrictions.

These features must remain intact.

Do not rebuild pairing or introduce a second mobile backend.

---

## 9. Strengthen missing remote-security tests

The T9 report identified under-tested scenarios.

Add focused adversarial coverage for:

### Cross-Agent authorization

An approval for Agent A must fail when substituted for Agent B.

### Cross-Mission authorization

An approval for Mission A must fail when substituted for Mission B.

### Cross-Project authorization

A request bound to Project A cannot grant access to Project B.

### Offline approval replay

A phone holding a stale approval must not automatically apply it after reconnection.

### Device revocation during live SSE

Post-revocation protected sequence delivery must stop.

Preserve T9's strengthened SSE assertions requiring canonical sequence correctness, payload redaction and revocation closure.

### Lost command acknowledgment

A command applied by the Host with a lost client receipt must reconcile by operation ID without duplicate side effects.

### Host replacement

A client pinned to Host A must reject unexpected Host B.

### Concurrent approvals

Competing phone/desktop decisions must result in exactly one canonical resolution.

These tests must use real Host admission paths where feasible, not only isolated helper methods.

---

## 10. Real phone and network validation

Inspect what physical devices and authorized transports are actually available.

Do not assume a phone is connected merely because the UI has a mobile layout.

If an actual authorized physical phone is available:

1. Establish secure Host identity.
2. Authenticate or pair with explicit consent.
3. Open Bunny on the phone.
4. View the same persistent Agent as desktop.
5. Exercise permitted Pause/Resume/Stop.
6. Review and respond to an eligible Host-offered request.
7. Verify desktop/phone state convergence.
8. Disconnect and reconnect.
9. Verify authorization freshness.
10. Revoke the disposable device and confirm access stops.

If local-network testing is available, label it LOCAL NETWORK VERIFIED.

If internet-remote transport is not authorized, leave it NOT TESTED.

**Do not start the public tunnel automatically.**

If physical phone access is unavailable, do not block the entire source repair. Complete testable protocol validation and report the missing physical evidence explicitly.

A browser loopback fixture is not a substitute for physical phone proof.

---

## 11. Host restart and active phone continuity

Use a genuine disposable Host process restart.

Test:

- Agent identity persistence.
- Mission identity persistence.
- Current authorization revision.
- Event cursor reconciliation.
- Host UUID preservation.
- New Host epoch.
- Stale approval rejection.
- Verified artifacts preserved.
- No duplicate Task.
- No duplicate side effect.

Separately test phone UI closure and phone-only network interruption where technically possible.

Do not substitute a Host shutdown test for a phone-network-loss test.

---

## 12. Independent security review

After repairing the failure, attempt to break the implementation.

Check:

- PID reuse.
- HWND reuse.
- Wrong application.
- Stale UIA element.
- Process ownership mismatch.
- Cross-Mission approval.
- Cross-Project artifact access.
- Revoked device reuse.
- Stale Host generation.
- Old approval after restart.
- Scope-expansion forgery.
- Retry budget exhaustion.
- Prompt-based authorization spoofing.
- Mobile Origin/CSRF forgery.
- Event stream revocation leakage.

All high-risk results must be independently verified through the relevant canonical authority boundary.

No unresolved HIGH or BLOCKER defect is acceptable.

---

## 13. Full regression

Minimum existing distinct inventory:

**1,043 tests**

Run:

- All 256 script tests.
- All 664 library tests.
- All 24 Agent tests.
- All 99 UI tests.
- Any new T9R tests.

Run the complete suite from the final committed source.

Required:

- Zero failures.
- Zero skipped existing security tests.
- Zero weakened assertions.
- Zero removed prior test cases.

Also run:

- Typecheck.
- ESLint.
- Desktop production build.
- Windows package validation.
- Remote protocol security tests.
- X53 native live integration.
- Calculator target lifecycle regression.
- MA2 IR-H1 process ownership tests.
- T4 restart/duplicate-work tests.
- T5 delegated authorization tests.
- T6 cross-app tests.
- T9 revocation/reconnect tests.

Focused reruns must not be double counted.

---

## 14. Test package validation

Existing T9 test package:

`Bunny-A-Windows-MA3-T9-TEST`

Existing package source:

`0a5988c5eef7e6beae3d1622529e2c638cca7788`

The package passed build and manifest verification but packaged runtime boot was NOT TESTED.

For T9R:

- Build a new disposable test package.
- Pin exact repaired source.
- Pin exact tooling revision.
- Verify manifest entries.
- Verify bundled native dependencies.
- Verify import closure.
- Validate package startup in a safe disposable runtime where possible.
- Verify correct package version metadata.
- Verify no production installation occurs.

Do not claim production readiness based solely on package build success.

---

## 15. Production protection

Installed production:

`Bunny-A-Windows-v26-MA2-R1`

Protect:

- Installed executables.
- Canonical SQLite.
- Device credentials.
- All original device rows.
- Phone pairing state.
- Provider configuration.
- User workspaces.
- Startup configuration.
- Tunnel state.
- Mission/Trigger state.

Do not install T9R.

Do not restart production.

Do not migrate production.

Do not kill unidentified processes.

Use disposable test environments only.

Read-only audits must resolve the actual installed database path through `install.json`, not accidentally inspect a development `host.sqlite`.

Record the precise before/after observation window.

Do not overclaim whole-task byte equality without a valid baseline snapshot.

---

## 16. Evidence requirements

Evidence root:

`test-results/ma3/t9r/`

Required report:

`MA3_T9R_REMEDIATION_ACCEPTANCE.md`

Create:

- baseline.md
- baseline-failure.md
- root-cause-analysis.md
- source-diff-analysis.md
- calculator-uia-tree-safe.json
- calculator-target-identity.json
- calculator-readiness-results.json
- x53-full-reacceptance.json
- x53-stability-matrix.json
- process-ownership-verification.json
- remote-security-matrix.json
- phone-offline-replay.json
- revocation-live-sse.json
- multi-device-race.json
- host-restart-recovery.json
- physical-phone-results.json
- network-validation.json
- t9r-adversarial-matrix.json
- complete-test-inventory.json
- complete-regression.log
- ui-regression.log
- typecheck.log
- lint.log
- build.log
- windows-package-results.json
- production-final.json
- limitations.md
- secret-scan.json
- INDEX.md
- INDEX.sha256

Do not manufacture results to fill evidence filenames.

Mark unavailable tests NOT TESTED and record the blocker.

Preserve failed attempts.

Seal final evidence with SHA-256.

Do not commit credentials, private SQLite data or raw secret-bearing logs.

---

## 17. Re-acceptance verdict

### T9R PASS

Requires:

1. Actual root cause determined and documented.
2. Correct-layer repair implemented.
3. Real native Calculator operation independently verified.
4. Complete original X53 workflow passes.
5. Stability testing shows no unresolved recurring failure.
6. T9 remote authorization protections remain intact.
7. Cross-Agent/Mission/Project authorization substitution rejected.
8. Revoked devices cannot regain command or event access.
9. Host restart preserves identity and rejects stale consent.
10. All existing 1,043 tests pass, plus any added cases.
11. No security boundary weakened.
12. Production v26 remains protected.
13. Evidence is complete and honest.

### T9R PASS_WITH_LIMITATIONS

Permitted only if:

- The full existing regression is green.
- Real X53 native execution is verified.
- Core authenticated phone-client protocol and authorization tests pass.
- No HIGH/BLOCKER authority defect remains.
- Unavailable physical-device or cross-network tests are explicitly NOT TESTED.

This verdict **does not establish physical-phone completion**.

### T9R FAIL

Required if:

- X53 still fails.
- Calculator success is mocked or bypassed.
- Existing security assertions are weakened.
- Remote clients can expand authority.
- Revocation fails.
- The primary authenticated remote control path fails.
- An unresolved HIGH/BLOCKER security issue remains.
- Existing required regression tests still fail.

Do not issue PASS merely because the Calculator test passes once.

---

## 18. Final response format

Return:

1. Root cause of X53.
2. Exact source files changed.
3. Source commit and branch.
4. Before/after UIA evidence.
5. Native Calculator execution proof.
6. Full X53 workflow proof.
7. Stability run counts.
8. Remote security results.
9. Device revocation evidence.
10. Host restart evidence.
11. Physical phone status.
12. LAN/internet remote status.
13. Full regression totals.
14. Package validation.
15. Production preservation.
16. Remaining limitations.
17. Evidence root.

End with exactly one:

`BUNNY_MA3_T9R_PASS`

`BUNNY_MA3_T9R_PASS_WITH_LIMITATIONS`

`BUNNY_MA3_T9R_FAIL`

**Do not start T10 automatically.**

---

# FINAL ENGINEERING PRINCIPLE

The correct solution is not to make the failing test green at any cost.

The correct solution is to restore real Windows application execution with verified target identity, preserve existing Host authorization, and prove that remote devices cannot bypass either boundary.

**FIX THE ROOT CAUSE.**

**PRESERVE THE SECURITY MODEL.**

**PROVE THE REAL WORKFLOW.**

**REPORT WHAT REMAINS UNTESTED.**

**DO NOT ADVANCE TO T10 UNTIL THE REMEDIATION GATE IS ACCEPTED.**