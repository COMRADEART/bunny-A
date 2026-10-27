# Windows Installer, Packaging & Upgrade Lifecycle Qualification

**Product:** Bunny A by LOKAM  
**Milestone:** MA4-S3-T5  
**Document:** Windows Packaging, Installation, Upgrade & Process Containment Audit  
**Classification:** Release Engineering & Installation Qualification  

---

## 1. Executive Summary & Installation Architecture

Consumer software on Windows must install cleanly, preserve user data across seamless updates, avoid requiring unnecessary administrative elevation, and guarantee that background worker processes are never orphaned when the application closes.

Bunny A's Windows installation architecture is governed by:
1. **Pinned Source Packaging (`package-bunny-desktop.ps1`):** Every runtime file is extracted strictly from `git archive` of the pinned source commit (`release-pin.json`). No dirty working tree edits, uncommitted files, or untracked development artifacts can enter a release package.
2. **Per-User Local Space (`%LOCALAPPDATA%\Bunny-A`):** Operates entirely in user-space without requiring administrative UAC prompts or writing to global `C:\Program Files`.
3. **Immutable Release Manifests (`release-manifest.json`):** Every release artifact is sealed with a cryptographic SHA-256 manifest. The launcher refuses startup if any file differs by a single byte.
4. **Zero-Orphan Process Grouping (`bunny-owned-process.c`):** Uses Windows Job Objects with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` to ensure that closing Bunny A immediately and cleanly terminates all background child processes.

---

## 2. Installation & Upgrade Life Cycle Verification

```
+----------------------------------------------------------------------------------------------------+
|                                  BUNNY-A INSTALLATION LIFECYCLE                                    |
|                                                                                                    |
|  [Release Archive]                                                                                 |
|         |                                                                                          |
|         v                                                                                          |
|  [Verify SHA-256 Manifest]                                                                         |
|         |                                                                                          |
|         v                                                                                          |
|  [Inspect %LOCALAPPDATA%\Bunny-A]                                                                  |
|         |                                                                                          |
|         +---------------------------+---------------------------+                                  |
|         |                                                       |                                  |
|  (Clean Install)                                         (Existing User Upgrade)                   |
|         v                                                       v                                  |
|  * Create directory layout                               * Verify state layout version 2           |
|  * Seed initial install.json                             * Run rollback preflight                  |
|  * Initialize host.sqlite (schema v3)                    * Preserve host.sqlite & preferences      |
|  * Set firstRun: true                                    * Preserve Lotus Memory & projects        |
|  * Create Startup shortcut                               * Atomic symlink switch to new release    |
|         |                                                       |                                  |
|         +---------------------------+---------------------------+                                  |
|                                     |                                                              |
|                                     v                                                              |
|                          [Start-Bunny-Release.ps1]                                                 |
|                                     |                                                              |
|                                     v                                                              |
|                          [Launch Island & Host]                                                    |
+----------------------------------------------------------------------------------------------------+
```

### 2.1 Clean Installation Audit
- **Observed Behavior:** On a clean system without prior configuration, the installer creates:
  - `%LOCALAPPDATA%\Bunny-A\install.json`
  - `%LOCALAPPDATA%\Bunny-A\releases\<release-id>\`
  - `%LOCALAPPDATA%\Bunny-A\state\host.sqlite` (SQLite database with WAL mode)
  - `%LOCALAPPDATA%\Bunny-A\state\preferences.json`
  - `%LOCALAPPDATA%\Bunny-A\logs\`
- **UAC Elevation:** **Zero prompts.** All operations execute under standard user token privileges.

### 2.2 Existing-User Upgrade & Rollback Preflight
- **Rollback Preflight (`bunny-rollback-preflight.mjs`):** Before activating a newly packaged release:
  - Validates SQLite schema compatibility (`hostSchemaUserVersion: 3`).
  - Confirms state paths layout version (`stateLayoutVersion: 2`).
  - If an incompatible database migration is detected, the upgrade aborts safely without mutating the user's existing database.
- **Data Preservation:** User project folder registrations, historical task runs, Lotus Memory episodic embeddings, and voice preferences remain completely untouched.

### 2.3 Windows Startup Integration
- **Behavior:** The installer places a shortcut `Bunny-A.lnk` in `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup`.
- **User Control:** The Island settings panel provides an immediate toggle (*"Launch Bunny A at Windows login"*). Toggling off removes the shortcut; toggling on restores it.

---

## 3. Process Containment & Zero-Orphan Guarantee

A common failure mode in desktop developer tools is background process abandonment: when the main window closes, Node.js child processes, compiler daemons, or voice workers remain running in the background, consuming CPU, RAM, and GPU memory.

### 3.1 Windows Job Object Architecture
Bunny A eliminates orphaned processes at the operating system kernel level via `native/bunny-owned-process.c`:
1. When the Host launches, it creates a Windows Job Object:
   ```c
   HANDLE hJob = CreateJobObjectW(NULL, NULL);
   JOBOBJECT_EXTENDED_LIMIT_INFORMATION jeli = { 0 };
   jeli.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
   SetInformationJobObject(hJob, JobObjectExtendedLimitInformation, &jeli, sizeof(jeli));
   ```
2. Every spawned child process (Node test runner, voice worker, tool process) is assigned to this Job Object via `AssignProcessToJobObject`.
3. If the Bunny A Host terminates—whether by user exit, crash, or Windows shutdown—the Windows kernel automatically and instantaneously terminates all member processes in the job group.

### 3.2 Empirical Verification
- Spawned test processes and voice worker.
- Terminated Host PID via taskkill.
- Queried `Get-Process node, bunny-voice-worker`.
- **Result:** Zero orphaned processes remained. GPU VRAM and CPU threads were freed immediately.

---

## 4. Verification Summary (Gate T5-G17)

- **`T5-G17` (Windows packaging and install/upgrade tested):** **PASS**.
- Automated packaging tests (`scripts/bunny-release.test.mjs`, `scripts/owned-process-build.test.mjs`) pass cleanly with verified manifests and zero-orphan containment.
