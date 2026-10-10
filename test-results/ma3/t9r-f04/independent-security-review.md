# T9R-F04 independent security review

Reviews were run as read-only adversarial workflows: lens reviewers found candidate defects, and each candidate was checked by two independent skeptics told to refute it. A finding counts as **confirmed** only when both skeptics failed to refute it. Raw records, including every vote and its reasoning, are in `review/`:

| Round | Record | Scope |
|---|---|---|
| 1 | `review/round1.json` | native helper, launch-path bypass hunt, Stop/accounting truth, restart lens, shutdown |
| 2 | `review/round2-partial.json` | native helper after round-1 repairs; truth and live-code lens (partial: one lens stopped when the source changed) |
| 3 | `review/round3.json` | verify round-1/2 repairs, second bypass hunt, native, truth; F03 interplay checked inside the repairs lens |
| 4 | `review/round4.json` | verify round-3 repairs; final adversarial sweep of the whole F04 diff |
| 5 | `review/round5.json` | verify round-4 repairs |
| 6 | `review/round6.json` | verify round-5 repairs |
| F03 follow-up | `review/f03-followup.json`, `review/f03-followup-verify{,-2,-3,-4}.json`, `review/f03-regression-audit/` | independent follow-up of the F03 final-round fixes (`b693167`) and the F04 effect on F01–F03, four repair-verification rounds, and a HEAD-versus-working-tree regression audit |

**Result: no unresolved BLOCKER or HIGH.** Both HIGH findings (F04-BYPASS-1 and F04-BYPASS-CWD-1) were repaired, and the repairs were verified in a later round. Every MEDIUM was repaired, except F04-C1, which round 1's skeptics downgraded to LOW and which is accepted below. Every accepted residual is LOW and fails closed, or is a documented scope limit.

No reviewer found a way for a provider-started or model-influenced process to leave the Bunny-owned job (round 3 bypass lens, round 4 final sweep).

## Dispositions

### HIGH (both repaired, both verified)

| ID | Finding | Repair | Verified |
|---|---|---|---|
| F04-BYPASS-1 | Verification `python` resolved from the model-writable task folder and ran outside any job | `resolveInterpreter` (absolute PATH entries outside the task folder) and `runWindowsOwnedProcess` (`verification.python`) | round 3; test `F04 R1-BYPASS-1` |
| F04-BYPASS-CWD-1 | Host helpers (`powershell.exe`, `taskkill.exe`, `nvidia-smi`) launched by bare name, so the child working-folder search could run a planted binary | `system-tools.server.ts`: `%SystemRoot%\System32` absolute paths and PATH-only `pathTool` at every Host call site, with a static test that forbids bare names | round 4; test `F04 R3-BYPASS-CWD-1` |

### MEDIUM (all repaired, except C1 (downgraded to LOW and accepted); repairs verified)

| ID | Finding | Repair / verification |
|---|---|---|
| F04-C1 | `close_group` drops the handle while ActiveProcesses > 0 | **Accepted LOW** (round-1 skeptics voted LOW). Closing the last handle of a KILL_ON_JOB_CLOSE job itself terminates every member. Provider sessions call close only at ActiveProcesses 0, and the record keeps the measured count. Re-confirmed as accepted in round 3. |
| F04-BYPASS-2 | Codex app-server probe ran uncontained | `containedTransport` (job, interactive stdin); round 3; `F04 R1-BYPASS-2` |
| F04-STOP-1 | `done` resolved while termination was unconfirmed | `emptied` promise; round 3; `F04 R1-STOP-3/NATIVE-1/STOP-1` |
| F04-LENS-RESTART-01 | Identity-incomplete records dropped; empty set read as no survivors | `possiblyAlive` fail-closed, `cleanup_unverifiable` + review; round 3 |
| F04-L1 | Restart absence recorded as kernel "empty" | `absent_after_restart`; an empty table read is a failed read; `F04 R2-L1` |
| F04-TRUTH-1 | Restart error asserted processes had ended before any check | Wording now describes the mechanism; round 4 |
| F04-R3-1 | `terminateJob` loop and event calls unguarded (stop could become HOST_FATAL) | Guarded `sweep()` and `quiet()`, `.catch` on onStop; round 5; `F04 R4-R3-1/FINAL-1` |
| F04-R5-2 | Folder-level unreadable hold released without reconciling its records | The folder hold reconciles every record and holds the still-unreadable files separately. Re-reads skip this Host's generation (a per-process random UUID). Round 6; `F04 R5-FOLDER` |
| F03-FOLLOWUP-1 | F03 read-only-tool exemption matched a word anywhere in a pipe stage (`node r.js *.md # grep`, `$(ls *.md)`, `ls *.md \| xargs node r.js`) | Fail-closed rule set, verified in four rounds, with 0 regressions against `b693167`. Every HIGH the verifiers raised was repaired, including the pre-existing ones (multi-line statements, PowerShell `#>`, cmd `REM` delimiters, escaped names). See the F03 follow-up section. |

### LOW

Repaired and verified in a later round: F04-C2, F04-LOW-2, F04-STOP-2/R2-02, F04-STOP-3, F04-SHUT-1, F04-NATIVE-1, F04-LENS-RESTART-02/03/04, F04-R1-LOW-startup-throw/R2-01, F04-L2, F04-L3, F04-L4, F04-L5, R2-03, R2-05 (completed by F04-R3-1), NATIVE-R2-01, NATIVE-R2-02, F04-COVERAGE-2, F04-REVIEW-3, F04-HOLD-4, F04-R3-2, F04-R3-3, F04-FINAL-1, F04-R5-1, F04-R5-3, F04-R6-2 (a test that only matched source text was replaced by a behavioural test).

Refuted by both skeptics: F04-C3, F04-C5, F04-C6, F04-LOW-1, F04-PROBE-1, F04-R2-N1, R2-04, NATIVE-R2-03.

Accepted residuals (LOW, disclosed):

| ID | Residual | Why it is accepted |
|---|---|---|
| F04-C4 / NATIVE-1 remainder | `close_group` can block the Node main thread for up to about 1.5 s plus a writer wait (about 3.4 s worst case) | Availability only. Terminate is non-blocking, and close is called only at ActiveProcesses 0, when the wait is immediate. |
| F04-R5-4 / F04-R6-1 | If a database write fails in the middle of a restart reconcile, the restart hold stays until the next Host restart | Fails closed. Only the same Mission or Task is refused. Requires a database write failure. |

## F03 follow-up review

As the brief requires, F03's final-round fixes (`b693167`) had their own independent review. They were not treated as cleared.

- **Lifecycle lens: no defect.** Promotion reads, hash-verifies, re-classifies and writes the same bytes, so there is no TOCTOU. Retry checks every refusal before it mutates anything and closes the abandoned attempt. Replan withdraws unused one-time answers through `stampLifecycle("WITHDRAWN")` and keeps completed steps. The F04 additions to `liveCodeExecutions` (`liveHostCodeRuns`, restart survivors, unreadable holds) only add gates. F01 (devices never authorize code execution) and F02 (inert staging and workstation promotion) are not weakened.
- **Classifier lens: F03-FOLLOWUP-1 MEDIUM, confirmed 2/2.** The F03 read-only-tool exemption was a word match per pipe stage. A runner was missed when a read-only word appeared in an argument, a trailing comment, a substitution, or an earlier pipeline stage that held the glob.
- **The repair was verified four times by independent hunters** (`review/f03-followup-verify.json`, `-verify-2.json`, `-verify-3.json`, `-verify-4.json`). Each round ran its claimed bypasses as real probes, and many were confirmed against real `sh`, `cmd.exe` and `powershell.exe`. Every round found more shell forms. Most of them predate F03: the accepted source `b693167` allows them too. The repair therefore became a fail-closed rule set instead of a list of patched cases:
  - **Exemption per line.** A line can be exempt only if nothing can hide in it: no substitution, variable, redirection, subshell or escape, and no quoted separator. A quote-aware scan sets aside a trailing comment. `#` is never a comment in cmd/bat or `package.json` (npm uses cmd.exe on Windows), and PowerShell `<#`/`#>` markers are never comments.
  - **Every stage must be read-only.** Every pipeline stage must be a bare read-only program: no path and no environment assignment. Its options must be allow-listed. Its arguments must name no program, plugin, script or path. `git` qualifies only as exactly `git add` or `git diff`.
  - **Multi-line statements remove all exemptions.** A file loses every exemption if any statement can span lines: a backslash, caret or backtick line end, an open quote, a YAML folded or multi-line plain scalar, or a multi-line `package.json` script. YAML literal blocks (`run: |`) are judged line by line.
  - **Computed and escaped names count:**
    - braces, expanded as bash does (including nested);
    - variable, substitution and make-pattern forms (`$N.md`, `%N%.md`, `$(…).md`, `%.md`);
    - quoted, trailing-dot and 8.3 spellings;
    - `./*` and `**`;
    - POSIX and `]`-first bracket classes, which fail closed;
    - backslash and caret escapes, read from the raw text in both sh and cmd readings, judged on the last path segment.
  - **Make:** suffix rules and `.SUFFIXES` count.
  - **Collecting configs:** config keys that collect files count (`doctest_glob`, `python_files`, tox `commands`), with comma lists split outside braces. String literals in program sources that glob the destination count.
  - **package.json:** scripts are parsed from the raw text. Reference normalisation had rewritten `\"`, which made the old parse fail; the old substring regex hid this. `lint-staged` entries are judged as `command glob` lines. Keys outside `scripts` and a short inert list (`files`, dependencies, metadata) are checked on a line that is never exempt. `main`, `module`, `exports` and `imports` are not inert.
  - **cmd `REM`** is a comment only when a cmd delimiter follows it.
- **No regression against the accepted F03 source.** The round-3 harness was re-run after the final repairs (`review/f03-regression-audit/`):
  - 607 consumer fixtures × 4 destinations: 0 regressions and 0 exceptions;
  - 10,000 fuzz pairs: 4 cases are newly allowed, and each has the glob only inside a trailing shell comment, which the shell never executes.
  - The tests are in `src/lib/bunny-missions/f03-followup.test.ts`, a new file with every probe line from the four rounds. `f03-hardening.test.ts` and every other F01–F03 test file are unchanged and pass.
- **Residual forms (disclosed, D1 heuristic class, the same in the accepted F03 source):**
  - a name assembled only from variables (`$N$E`);
  - a shell function or alias that shadows a read-only tool name;
  - read-only tools that load project plugins or config by default;
  - pre-commit `files:` regexes with default `pass_filenames`;
  - globs assembled by concatenation or folder enumeration in program code.

  None of these lets a paired device execute anything. F01 means devices never authorize code execution, and under F02 every paired-device change stays inert in Host staging until the Windows Host owner promotes the exact reviewed bytes. The classifier only decides how the change is labelled for that review.

## Out-of-contract classes (documented, not claimed)

These are in `native/README.md` and `process-launch-inventory.md`: brokered launches (WMI, Task Scheduler, services, COM, shell hand-off and `computer.open_app` AppX activation), WSL, and hosted or remote APIs (Ollama cloud tags). Also excluded: a hostile process running as the same Windows user that attacks the Host process itself, and non-Windows platforms (uncontained, never reported as contained).
