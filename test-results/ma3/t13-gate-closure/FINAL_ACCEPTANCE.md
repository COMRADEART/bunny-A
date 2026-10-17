# BUNNY-A MA3 T13-GC final acceptance

**CONDITIONAL PASS.** The full npm-test gate is closed. Physical Android pairing remains **BLOCKED**, so T13 is **not COMPLETE**. No confirmed critical functional or security regression remains from these checks.

- Branch: `ma3-t13-product`.
- Starting SHA: `b23005136c48036968036475e841dcf67a38a794`.
- Final executable source SHA: `b23005136c48036968036475e841dcf67a38a794` (unchanged). All new files are verification tooling or sanitized evidence under this directory. The final Git evidence SHA is the commit containing this report; resolve with `git log -1 --format=%H -- test-results/ma3/t13-gate-closure/FINAL_ACCEPTANCE.md`, and see the session's final response for that exact SHA.
- Existing production/test files edited: **none**. New scripts only capture verification evidence. No UI redesign, new functionality, MA4, merge, push or PR.

| Gate | Disposition |
|---|---|
| Entire npm test chain | **PASS**, exit 0, 2145/2145: scripts 450/450; library 1637/1637; agent runtime 58/58; 0 failed/skipped/cancelled/todo. |
| UI | **PASS**, 405/405, separately executed, 0 skipped. |
| Typecheck / build / auth invariant | **PASS**, each exit 0; fresh build, matching sign-in-off configuration. |
| Desktop/mobile dev and built render | **PASS**: both screenshot pairs visually inspected, visible content, clean console, no horizontal overflow; production baseline divergence false. Workstation offline-Host context only. |
| Movable Island / indicator ordering | Existing gate retained; fresh full script suite executes all four-edge placement and ordering tests. No native source changed. |
| Multi-agent handoff / execution / approvals / provider routing | Fresh full pipeline plus UI regression passed; existing live evidence retained at unchanged source. |
| Windows Narrator / keyboard | Prior native pass retained with its original limitations (no human-ear prosody approval); fresh workstation-browser click/Tab/Return navigation verified. No new native/audible Narrator claim. |
| Voice controls / themes | Fresh script/library/UI regressions pass. Existing live/acoustic/theme evidence preserved; no new live acoustic or online theme-switch claim. Offline theme mutation refusal verified. |
| Android environment | Signed v2 APK, build prerequisites and reachable pre-existing HTTPS transport found. ADB unavailable; authorized handset status cannot be enumerated. |
| Physical phone / physical security | **BLOCKED**. All 15 hardware rows unexecuted; reproducible setup/actions/expected results preserved in PHONE_PAIRING_MATRIX.md. |
| Evidence/source preservation | 66 original dirty/untracked file hashes unchanged. Existing tracked evidence was not overwritten by tests; runs used an independent source/receipt checkout. |

The original receipt open error was not reproduced in the full passing run. Shared output paths are confirmed; a specific Windows lock/permission owner is **unproven** because the original record lacks full stderr/handle telemetry. No speculative production or assertion change was made. The first isolated run's omitted Node-license prerequisite caused exit 1 and is retained separately; the complete corrected pipeline then exited 0.

Remaining prerequisite blockers: official Platform-Tools plus an authorized physical Android 8+ session, and a manifest-validated candidate workstation/gateway through an authorized HTTPS test transport, followed by the complete actual-device matrix. The existing installed gateway declares source 8145377880fa4ab330238db827fa488430b2328d, so its reachability is not candidate-source acceptance. Do not retarget/restart the existing installed service automatically. Do not waive the hardware gate or replace it with mocks. Current transport reachability does not establish phone-network reachability or on-device authentication.

Evidence map: FULL_SUITE_REPORT.md, ANDROID_ENVIRONMENT.md, PHONE_PAIRING_MATRIX.md, SECURITY_VALIDATION.md; suite-summary.json; command-results.json; workspace-before.json/workspace-preservation.json; retained-evidence.json; test-final.log and result; android-environment.json/android-checks/; pairing-security.json; transport-probe.json; cross-surface-regression.json; browser/; receipts/. INDEX.sha256 seals retained files; secret-scan.json records the final content scan. validation-checkout and compiled Android .class files remain local ignored scratch and are not committed.

Pre-existing development server and installed Host/gateway/tunnel were not restarted or reconfigured. Only this task's managed built-output preview was started and stopped. Existing native/Narrator acceptance is preserved, not silently downgraded or expanded beyond its documented limits.
