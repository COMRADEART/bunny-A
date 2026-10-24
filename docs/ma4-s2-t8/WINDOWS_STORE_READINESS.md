# MA4-S2-T8 — Windows Store & Controlled Distribution Readiness (`WINDOWS_STORE_READINESS.md`)

- **Gate T8-B (Windows Distribution Readiness) Verdict:** **`PARTIAL`** (`PASS` on non-administrator `%LOCALAPPDATA%` installer, manifest integrity, upgrade/rollback, and clean uninstall; **`BLOCKED`** on Windows Authenticode signing & Microsoft Partner Center Publisher Identity)

---

## 1. Windows Distribution Readiness Checklist

| Requirement | Status | Evidence & Notes |
|---|---|---|
| **Self-Contained Runtime (`node.exe` + `zod` + `bunny_proc.exe`)** | **`PASS`** | Verified by `importClosure()` in [`scripts/bunny-release.mjs`](../../scripts/bunny-release.mjs); zero developer checkout dependency |
| **Non-Administrator User Installation (`%LOCALAPPDATA%\Bunny-A`)** | **`PASS`** | Verified in [`docs/ma4-s2-t3r1/evidence/installed/lifecycle.json`](../ma4-s2-t3r1/evidence/installed/lifecycle.json); requires zero UAC elevation |
| **No Unapproved Automatic Startup** | **`PASS`** | Verified in [`docs/ma4-s2-t3r1/evidence/installed/cleanup.json`](../ma4-s2-t3r1/evidence/installed/cleanup.json) (`startupItemsUnchanged: true`, `runKeysUnchanged: true`) |
| **Upgrade & Rollback State Preservation** | **`PASS`** | `40/40` packaging, migration (`23` SQLite tables), and rollback-preflight tests passing |
| **Clean Uninstallation** | **`PASS`** | Verified in `cleanup.json` (`r1DirectoryRemoved: true`, `testProcessesLeft: 0`) |
| **Privacy & Permission Disclosures** | **`PASS`** | Local-first data ownership and folder/connector permissions documented in [`docs/ma4-s2-t7/PRIVACY_AND_TELEMETRY.md`](../ma4-s2-t7/PRIVACY_AND_TELEMETRY.md) |
| **Windows Authenticode Code Signing (`OV/EV`)** | **`BLOCKED`** | `BUNNY_WINDOWS_AUTHENTICODE_THUMBPRINT` not provisioned; SmartScreen will warn on unsigned `.ps1`/`.exe` files |
| **Microsoft Store MSIX Publisher Identity** | **`BLOCKED`** | Requires Microsoft Partner Center `Publisher="CN=..."` identity and Store submission credentials |
