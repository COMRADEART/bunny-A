# MA5-S1 — Installer and APK results

All artifacts are **unsigned development candidates** (Windows) or **signed with a locally generated test key**
(Android). There is no release signing, no store submission and no publishing. Nothing was installed over the
owner's Bunny A.

## Windows development candidate

`native/windows/package-dev-candidate.ps1` copies the sources into two scratch directories and runs restore plus
Release publish in each. It refuses to package unless both output trees are byte-identical, then writes
`releases/BunnyA-Windows-dev-0.5.1.zip` with `candidate.json` (per-file SHA-256). Build settings: `Deterministic`,
`PathMap` (project directory → `/BunnyA`); SDK pinned by `native/windows/BunnyA/global.json` (8.0.408, no roll-forward).

| Build | Files identical across two builds | `BunnyA.exe` | `BunnyA.dll` | zip |
|---|---|---|---|---|
| Local (isolated SDK 8.0.408) | 4 / 4 | `1272a658f2ef3535e50f4a3244c0f39547e3f9a26825d6126c5273faf6dc738d` | `b2b113b7c6913d68785ba2272f70d79c76c529a784fe6dbe22e1695aed42436a` | `0906185f9f445f8ffa5d098a746d27fc53657ab04ee9eae6a78bab9dd53ce7ae` |
| Hosted CI run 40644157467 (commit `394f4d1`) | 4 / 4 | `2ff23b7ea333922670735d159a5358955d0158cd7150ef210c7a66fa0a624d1a` | `e5171f90638218a6a287f3afe4a73582723d6c0ad21de1c3c46edfe0f000844f` | `3e31c6a6f960f4e8ed307e7199ff6f9a7a0092dd9c92a3740e8e65f8ee128005` |

Builds are reproducible within one environment. **The local and CI binaries differ**, so cross-machine
reproducibility is not established. Both used SDK 8.0.408; the cause was not investigated (an untested suspect is
checkout line endings in compiled XAML) — open limitation. Zip hashes vary per packaging
because of archive timestamps. The per-file hashes in `candidate.json` are the comparison point.

### Install / update / uninstall (`evidence/candidate/candidate-lifecycle.json`)

`native/windows/install-dev-candidate.ps1` installs per-user into `%LOCALAPPDATA%\Programs\BunnyA-DevCandidate` with a
Start-menu shortcut. It refuses:
- any target overlapping `%LOCALAPPDATA%\Bunny-A`, `%LOCALAPPDATA%\BunnyA` or `%APPDATA%\bunny-a`;
- git checkouts;
- installing while the candidate is running.

It verifies every file hash before installing, and replaces an existing install by folder swap with rollback.
`-Uninstall` removes only a folder that carries the candidate marker.

Run `ma5s1-candidate-2026-10-28T06-27-02-948Z`: temporary install root and settings, Host on port 43191.

| Step | Observed |
|---|---|
| Install | Installed, shortcut created |
| Launch | Authenticated connection (2 authenticated `/state` reads observed by the Host), notch edge Right |
| Replace while running | Refused |
| Quit | Exit 0 |
| Replace (update) | `replacedPrevious: true`, settings kept, no leftover folders |
| Relaunch | Edge Right kept, exit 0 |
| Uninstall | Install root and shortcut removed. Settings kept; a user project file was unchanged; 0 processes left |
| Uninstall of a foreign folder | Refused, file kept |

Code signing: none (development candidate). Windows SmartScreen behaviour for an unsigned download was not tested.

## Android test APK

`scripts/build-android.ps1` produces `releases/Bunny-A-Android-v4.apk`:
- SHA-256 `2BB423F0F459D049593D5227EA024E90067AB68966C024980F8E5D9ABFCFB7C5` (local build);
- APK signature schemes: v1 false, v2 true, v3 true, verified by `apksigner verify`;
- signed with a locally generated test key that is not the release key. CI generates its own test key (certificate
  SHA-256 `3943c4a2…a412` in run 40644157461), so APK bytes differ between builds while `classes.dex` is identical
  (see ANDROID_NATIVE_ACCEPTANCE.md);
- installation on a device: **BLOCKED** (no device).
