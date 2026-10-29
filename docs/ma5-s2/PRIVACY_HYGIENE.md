# MA5-S2 Phase 0: Public-repository evidence hygiene

Isolated first commit of `ma5-s2-native-agents-voice`. Git history was **not** rewritten (no authorization for that);
everything removed below is still readable in earlier commits, including `f6c51ea`.

## Findings and actions

| # | Finding | Action |
|---|---|---|
| P1 | S1R2 device helpers committed as evidence (`docs/ma5-s1/evidence/s1r2/android-device/ui.py`, `lifecycle.sh`) hard-coded the owner's phone serial, the workstation profile path to `adb.exe` and a session scratchpad path. | Moved with `harness.mjs` to `scripts/android-device/` as reusable tools configured by environment: `BUNNY_ADB` (default `adb`), `ANDROID_SERIAL` (read by adb itself), `EVIDENCE_DIR`, `COMMANDS_LOG`. `lifecycle.sh` now records and restores the phone's auto-rotate setting (S1R2 left it off without recording it). |
| P2 | Phone serial in prose and JSON: `docs/ma5-s1/S1R2_FAULT_INJECTION.md`, `docs/ma4-s2-t3r/PHYSICAL_ANDROID_QUALIFICATION.md`, `docs/ma4-s2-t3r/evidence/android/round2.json`. | Replaced with "serial redacted". The model name (SM-S948U) and Android version stay: they are needed to read the results and do not identify a device. No file hashes pinned these files. |
| P3 | Workstation profile path hard-coded in four qualification scripts (`scripts/ma4-s3-t1r2/followup.mjs`, `scripts/ma4-s3-t1r3/measure.mjs`, `scripts/ma4-s3-t4r1/gui-qualification.mjs`, `scripts/ma4-s3-t4r2/gui-contract-qualification.mjs`). | `LOCALAPPDATA` fallback now derives from `os.homedir()`; the T1 baseline checkout comes from `BUNNY_BASELINE_ROOT` or the sibling folder `../bun-router-t1-base`. |
| P4 | Redaction-test fixtures used the owner's real profile name (`ma4-s2t5.test.ts`, `ma4-s2t7.test.ts`); a code comment used a name-derived e-mail example (`connections.ts`). | Fixtures use the placeholder profile name `owner`; the comment uses `someone@example.com`. The assertions are unchanged (they test that any user path is scrubbed). |
| P5 | MA5-S1/S1R1/S1R2 device evidence (UI dumps, screenshots, `host-proxy-commands.log`). | Reviewed: no tokens, pairing codes, tunnel host names, LAN addresses or real user content. Host IDs/epochs belong to a disposable, deleted Host; prompts are synthetic ("What is the capital of …"). Kept. |
| P6 | Older milestone reports and `test-results/` evidence (MA0–MA4) still contain the workstation profile path: 1,768 tracked files at `f6c51ea` (1,635 under `test-results/` and `screenshots/`, 133 elsewhere, mostly reports); 1,760 after this commit. | **Not rewritten.** It exposes only the Windows account name, which equals the public Git author name; several of those files are hash-referenced logs whose bytes are the evidence. Rewriting would break those references and history keeps the original anyway. **Owner decision** if a full scrub (or a history rewrite) is wanted. |
| P7 | Credential scan of all tracked `docs/` and `test-results/` text (existing `evidence-secrets.test.mjs`). | Passes; unchanged. |

## Guard against reintroduction

`scripts/evidence-secrets.test.mjs` (part of `npm test`) now also fails when any tracked text file under
`scripts/android-device/` or `docs/ma5-*` contains:

- an absolute Windows/MSYS user-profile path (`C:\Users\<name>`, `/c/Users/<name>`; `Public` allowed),
- an adb invocation pinned to a serial (`adb -s <SERIAL>`), or a literal `SERIAL=`/`ANDROID_SERIAL=` value.

Checked against the original S1R2 helpers: `ui.py` and `lifecycle.sh` are flagged, `harness.mjs` was already clean;
the new versions pass.

## Status

| Item | Status |
|---|---|
| Current-tree cleanup of MA5 evidence and device tools | Implemented, unit-tested |
| Serial redaction in current tree | Implemented (`git grep` for the serial returns nothing) |
| History rewrite | Not done: needs separate explicit authorization |
| Pre-MA5 workstation-path scrub | Not done: owner decision (P6) |
