# T9 evidence index

Executable source: 0a5988c5eef7e6beae3d1622529e2c638cca7788. Acceptance: BUNNY_MA3_T9_FAIL.

- acceptance-report.md — full report (also MA3_T9_PHONE_REMOTE_ACCEPTANCE.md at repository root).
- baseline.md / baseline-tests.log / baseline-ui.log — initial accepted floor.
- phone-architecture.md / pairing-contract.md / remote-command-contract.md / transport-security.md — actual contract and test boundary.
- existing-device-audit.md/.json / production-final.json — explicit short-window installed-state audit limitation.
- device-role-matrix.json / approval-scope-matrix.json / adversarial-matrix.json — authority, F01–F65 results and missing live cases.
- integrated-phone-mission.json / multi-device-race-results.json / artifact-access-results.json — real disposable Host effects.
- mobile-authentication-results.json / mobile-event-replay.json / revocation-acceptance.json / offline-reconnect.json / host-restart-recovery.json — protocol continuity and revocation receipts.
- mobile-ui-inventory.json / mobile-responsive-results*.json / keyboard-results.json / browser-*.txt — browser observations.
- physical-phone-acceptance.json / separate-network-acceptance.json — NOT TESTED, not viewport substitutes.
- regression-inventory.json / full-test-results.log / agent-test-results.log / ui-test-results.log / security-regression.json — final distinct totals, including unresolved Calculator failure.
- typecheck.log / lint.log / build.log — successful gates.
- windows-package-results.json / windows-package.log / dev/package-*.json — exact source-pinned package integrity.
- secret-scan.json — bounded actual-credential scan with redaction and limits.
- audit/, dev/, historical-reruns/, retained earlier attempts and fixture responses — supporting receipts and failures.
- Repository screenshots/t9-* — original browser screenshots and smoke JSON, included in the seal.

Seal format: SHA-256 followed by repository-relative path, covering the evidence files, root report and T9 screenshots. INDEX.sha256 excludes itself. Package binaries are excluded from the Git evidence commit and evidence seal; their 357-file package manifest verifies them separately.
