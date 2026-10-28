# MA5-S1R1: Installer ownership

File: `native/windows/install-dev-candidate.ps1`. Test: `scripts/ma5-s1r1-installer.test.mjs`. The test runs in
`npm test` (CI stage 1, `windows-latest`) and in the `native-windows-preview` workflow.

## Defect (e094a26)

The update path checked only whether the destination existed. It then moved the folder aside and deleted it once the
new version was in place:

```powershell
$replaced = Test-Path -LiteralPath $InstallRoot
if ($replaced) { Move-Item -LiteralPath $InstallRoot -Destination $previous }
...
if ($replaced) { Remove-Item -LiteralPath $previous -Recurse -Force }
```

The marker was checked only during uninstall, and only for its `schema` string. Junctions on the path were not checked,
and archive entries were extracted by `ExtractToDirectory` without an explicit check.

### Reproduction before the fix

The same test file was run against the e094a26 script (`BUNNY_S1R1_INSTALLER=<copy of e094a26 script>`):

| Test | e094a26 | Observed |
|---|---|---|
| 1-2 new install, upgrade | fail | The marker had no product or install-root identity (expected: new marker format) |
| 3-6 install over a folder without a valid marker | **fail** | `install over unrelated folder: must be refused, got: {"installed":…,"replacedPrevious":true}`. The folder holding `thesis.docx` and `docs/notes.md` was replaced and then deleted |
| 7-8 manipulated candidate / traversal | **fail** | `-ExpectedSha256` did not exist. The candidate installed and replaced the previous version |
| 9 junctions | **fail** | `install through a junction is refused` failed. The script installed through a junction to another folder |
| 10-11 rollback | fail | The fault hook did not exist. This is not a defect: e094a26 already had restore logic |
| 12-13 uninstall of unowned / protected folders | pass | The uninstall marker check and the protected-folder check already existed |

## Fix

Every check that can refuse runs before anything is written.

- **Proof of ownership** (`Assert-Owned`) for any existing destination, on both update and uninstall. Required:
  - `install.json` exists and parses;
  - `schema = bunny-windows-dev-install.v1` and `product = bunny-a-windows-dev-candidate`;
  - `installRoot` equals this exact destination;
  - `packageSha256` is 64 hex characters;
  - `files` is a list of safe relative paths;
  - the folder contains **nothing the marker does not list**: no extra file, folder, junction or link.

  Anything else is refused with "was not installed by this script (…); nothing was changed".
- **Path redirection:** the install root and every existing ancestor are refused if they are a junction or symbolic
  link. Folders are walked without ever following a link (`Get-Entries`).
- **Archive safety:** the archive is opened entry by entry. An entry is refused if it is rooted, contains `..` or a
  colon, or resolves outside staging. Duplicate entries fail (`ExtractToFile(..., overwrite = $false)`).
- **Candidate integrity:**
  - every manifest path must be safe and match its SHA-256;
  - the extracted tree may contain only what the manifest lists, plus the folders those paths imply;
  - an optional `-ExpectedSha256` must match the zip.

  So a later upgrade can always prove ownership of what was installed.
- **Shortcut:** if a shortcut with our name already points outside the install root, installing is refused.
  Uninstall leaves such a shortcut alone, as before.
- **Rollback:** the previous install is set aside until the new one is in place and its shortcut is written. On any
  failure:
  - the half-installed folder is removed (it came from our own staging);
  - the previous folder is moved back.

  `BUNNY_DEV_INSTALL_FAULT=after-backup|after-swap` injects a failure at either point. It is test-only and unset in
  normal use.
- Unchanged: the protected owner folders (`%LOCALAPPDATA%\Bunny-A`, `%LOCALAPPDATA%\BunnyA`, `%APPDATA%\bunny-a`), the
  Git-checkout refusal, the refusal while `BunnyA.exe` runs from the install root, and settings kept outside the install.

**Compatibility:** an install made by the e094a26 script has no `product` / `installRoot` in its marker, so this script
refuses to upgrade or remove it. That is deliberate: such a marker cannot prove which folder it belongs to. S1 installs
were made only in disposable test folders. A manual install from S1, if one exists, must be removed by hand.

## Results after the fix

`node --test scripts/ma5-s1r1-installer.test.mjs` (local, Windows 11): **6 tests, 6 pass, 0 fail**.

| # | Case | Result |
|---|---|---|
| 1 | New install into an empty authorized folder | pass; marker has product, exact installRoot and file list |
| 2 | Upgrade of a valid install (including a new sub-folder), a further upgrade, uninstall | pass; no staging or previous folder left |
| 3 | Unrelated folder at the path | install and uninstall refused; hashes unchanged |
| 4 | Install-looking folder with no marker | refused; unchanged |
| 5 | Corrupted marker | refused; unchanged |
| 6 | Wrong schema; e094a26 marker; marker naming another folder; genuine install with a user file added | all refused; unchanged |
| 7 | File hash differs from the manifest; `-ExpectedSha256` mismatch | refused; unchanged; the matching hash is accepted |
| 8 | Zip `../`, `..\..\`, `C:/`, manifest `../`, file not in the manifest | refused; unchanged; nothing written outside staging |
| 9 | Install root is a junction; a genuine install containing a junction | install, upgrade and uninstall refused; junction target unchanged |
| 10 | Injected failure after the backup, and after the swap | previous install restored byte for byte; shortcut intact; nothing left behind |
| 11 | Every refusal above | the test's `tree()` hash map of the existing folder is identical before and after |
| 12 | Uninstall of unowned folders | refused (cases 3-6, 9) |
| 13 | Protected folders, redirected to disposable `LOCALAPPDATA`/`APPDATA` | install and uninstall at each refused ("overlaps"); their hashes unchanged |

The real candidate lifecycle was re-run with the new script (`scripts/verify-ma5-s1-candidate.mjs`, real
`BunnyA.exe`, isolated Host). It passed:
- install;
- authenticated launch;
- replacement refused while running;
- Quit, then replacement keeping settings;
- relaunch;
- uninstall keeping settings and the user project;
- refusal to uninstall a foreign folder.

Evidence: `evidence/s1r1/candidate-lifecycle.json`.
