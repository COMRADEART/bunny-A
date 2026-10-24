# MA4-S2-T4 — Upgrade & Rollback Safety (`UPDATE_ROLLBACK.md`)

- **Gate T4-D Verdict:** **`PASS`** (`40/40` automated packaging, state-migration, and rollback-preflight tests passing; installed upgrade & recovery verified on `Bunny-A-Windows-S2T3R1-6-TEST`)

---

## 1. Upgrade Safety & State Preservation Contract

Bunny A strictly separates immutable code releases (`<InstallRoot>\releases\<ReleaseId>\`) from mutable user data (`<InstallRoot>\data\`):

1. **Preserved State Across Upgrades:**
   - `host-state.sqlite` (`23` tables verified in [`scripts/bunny-state-migration.test.mjs`](../../scripts/bunny-state-migration.test.mjs): missions, tasks, approvals, audit events, paired devices, capabilities, telemetry)
   - `ma4-tasks.sqlite` (MA4 persistent tasks, checkpoints, action receipts, approval requests, connector permissions, goals, schedules, schedule occurrences, monitors, and proactive notifications)
   - Paired device certificates and credentials (`<InstallRoot>\data\tls\`, `<InstallRoot>\data\credentials\`)
2. **Pre-Cutover Quiescence & Migration Safeguards (`scripts/migrate-bunny-state.ps1`):**
   - Refuses migration while any task or mission is actively running (`active tasks refuse migration before copy`, `active missions refuse migration before copy`).
   - Takes a read-only SQLite snapshot including committed WAL rows (`the read-only SQLite snapshot includes committed WAL rows`).
   - Rejects directory junctions, hard-link escape attempts, truncated databases, or unknown schema versions (`unknown schema refuses migration`, `a truncated database and unknown layout fail closed without creating state`).
   - Never silently widens permissions or re-enables disabled connectors during an upgrade.

---

## 2. Rollback Preflight & Fail-Closed Compatibility (`scripts/bunny-rollback-preflight.mjs`)

Before switching the active release pointer back to a prior release `<TargetReleaseId>`, [`scripts/bunny-rollback-preflight.mjs`](../../scripts/bunny-rollback-preflight.mjs) verifies:

1. **Target Release Integrity:** Every file in `<TargetReleaseId>` must match its `release-manifest.json` SHA-256 digest (`verifyRelease(targetRelease)`).
2. **Schema Compatibility (`hostSchemaUserVersion`):** Compares the database's `PRAGMA user_version` against the target release's `compatibility.hostSchemaUserVersion`. If the database was migrated to a newer schema version that the older release cannot read, rollback fails closed before starting the older Host.
3. **Runtime Quiescence (`T10-XG-06`):** Refuses rollback if any mission is paused with a live desktop grant, if any scheduled automation is actively firing, or if any task is in `running`, `interrupted`, or `waiting_approval` state (`T10 rollback preflight refuses orphan grant and interrupted or waiting work independently`).

---

## 3. Verification Results

Executed via `node --test scripts/bunny-sbom-provenance.test.mjs scripts/bunny-release.test.mjs scripts/bunny-state-migration.test.mjs scripts/bunny-rollback-preflight.test.mjs scripts/desktop-install.test.mjs`:

- **Total Tests:** **`40/40 PASS`** (`0` failed, `74.79 s`)
- **Installed Upgrade & Restart Recovery (`docs/ma4-s2-t3r1/evidence/installed/lifecycle.json`):**
  - Upgraded isolated TEST installations from `S2T3R1-1-TEST` through `S2T3R1-6-TEST` (`448ca6b`), preserving goals, schedules, monitors, tasks, and receipts across full Host + UI restart (`restartElapsedMs = 5,305 ms`).
