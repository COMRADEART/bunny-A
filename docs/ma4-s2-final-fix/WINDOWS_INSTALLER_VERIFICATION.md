# Windows Installer & Packaging Qualification

**Product:** Bunny A by LOKAM  
**Milestone:** MA4-S2 Remediation  
**Status:** PASS (Local & Non-Admin User Installation Qualified; Authenticode Tracked as External Credential Blocker)

---

## 1. Release Architecture & Packaging Integrity

The Windows release packaging is orchestrated by [`scripts/package-bunny-desktop.ps1`](file:///C:/Users/allam/Documents/new/bun-router-s2-remediation/scripts/package-bunny-desktop.ps1) and [`scripts/bunny-release.mjs`](file:///C:/Users/allam/Documents/new/bun-router-s2-remediation/scripts/bunny-release.mjs):

- **Target Path:** `<InstallRoot>\releases\<ReleaseId>\`
- **Release Manifest:** `release-manifest.json` (`schema: "bunny-release-manifest/1"`)
- **Self-Contained Runtime Components:**
  1. `Bunny-Host.mjs`: Standalone Host entry point (`127.0.0.1:43180` / `43193`).
  2. `runtime/node/node.exe`: Bundled Node.js `v24.14.1` binary (zero system Node.js prerequisite).
  3. `src/lib/bunny-host/native/bin/bunny_proc.exe`: Native Windows C helper verifying process identity before termination.
  4. `node_modules/zod`: The sole runtime npm dependency required by the Host, validated via `importClosure()`.
  5. Dashboard distribution: Built with `JEV_DESKTOP_BUILD=1 npm run build` (`.output/public/` and `.output/server/`).
  6. Native Glass-Notch: `native/island/Bunny-Island.ps1` (WPF glass topbar with `AutomationProperties.Name` bindings).

---

## 2. Installation, Upgrade, and Uninstallation Audit

Verified against `Bunny-A-Windows-S2T3R1-6-TEST` (`lifecycle.json` and `cleanup.json`):

| Capability / Check | Verified Evidence | Status |
|---|---|---|
| **Zero Repository / Dev Checkout Dependency** | `importClosure()` audited 454 files; runs cleanly with repository unmounted. | PASS |
| **Non-Administrator User Scope** | Installs cleanly under `%LOCALAPPDATA%\Bunny-A` without UAC prompts or administrative elevation. | PASS |
| **Data Directory Isolation** | Persistent user state lives in `<InstallRoot>\data\host-state.sqlite` and `ma4-tasks.sqlite`, separate from immutable release code. | PASS |
| **Registry / Startup Cleanliness** | No auto-start entries in `HKCU:\Software\Microsoft\Windows\CurrentVersion\Run` or Start Menu Startup folder (`runKeysUnchanged: true`). | PASS |
| **In-Place Upgrade** | Verified upgrade across versions preserving `host-state.sqlite`, `ma4-tasks.sqlite`, and pairing tokens. | PASS |
| **Clean Uninstall** | Stopped via `Stop-Bunny-A.ps1`, release tree removed, 0 background processes left, ports freed (`testProcessesLeft: 0`). | PASS |

---

## 3. Security & Code Signing Disposition

- **Local Development / Test:** Self-signed with test certificate for functional validation.
- **Production Authenticode Signature (`BLK-S2-01`):** Requires the operator's EV/OV Authenticode hardware token or Azure Trusted Signing credential. Documented as an external release gate in `EXTERNAL_BLOCKERS_SEPARATION.md`.
