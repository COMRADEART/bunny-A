# BUNNY A — MA4-S2 ROLLBACK PLAN (`ROLLBACK_PLAN.md`)

## 1. Windows Workstation Rollback Procedure

1. **Preflight Verification (`scripts/bunny-rollback-preflight.mjs`):**
   - Run `node scripts/bunny-rollback-preflight.mjs <InstallRoot> <TargetReleaseId>`.
   - Confirms that:
     - Every file in `<InstallRoot>\releases\<TargetReleaseId>` matches its `release-manifest.json` SHA-256 digest (`verifyRelease`).
     - `<InstallRoot>\data\host-state.sqlite` `PRAGMA user_version` is `<= compatibility.hostSchemaUserVersion` (`3`) of the target release.
     - No mission has a live desktop grant, no schedule is actively firing, and no persistent task is in `running`, `interrupted`, or `waiting_approval` state.
2. **Stop Active Release & Switch Release Pin:**
   - Run `<InstallRoot>\Stop-Bunny-A.ps1` (verifies `bunny_proc.exe` process-tree termination and port release).
   - Point `<InstallRoot>\current-release.json` to `<TargetReleaseId>` via `scripts/install-bunny-release.ps1 -RollbackTo <TargetReleaseId>`.
   - Start via `<InstallRoot>\Start-Bunny-Release.ps1` and verify `/api/orch` health.
3. **Zero Data Loss Guarantee:**
   - Because `MA4-S2` (`T3R1`–`T8`) kept `hostSchemaUserVersion = 3` and made only additive SQLite table/column additions in `ma4-tasks.sqlite`, rolling back to `10993bd` (`MA4-S2-T3R`) or `Bunny-A-Windows-v26-MA2-R1` preserves all existing goals, schedules, monitors, tasks, receipts, and paired devices without schema incompatibility.

---

## 2. Android Companion Rollback Procedure

1. If rolling back to a prior APK signed with the same keystore, install with `adb install -r -d <PriorApk>` (or increment `versionCode` on the rollback build for non-ADB upgrades).
2. If reinstalling cleanly, uninstall `com.routeragent.jev`, install the target APK, and complete a 30-second one-time code pairing with the Windows Host (all persistent tasks, goals, schedules, monitors, and audit logs reside on the Windows Host and are unaffected by Android app reinstallation).
