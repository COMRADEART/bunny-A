# M-A-3 Gate T9R-F03 — Consumer Classification Hardening & Final T9 Security Closure

- **Branch:** `claude/ma3-t9-phone-remote`
- **Builds on:** F02 `BUNNY_MA3_T9R_F02_PASS_WITH_LIMITATIONS`, source `02a3c1d`, evidence `e08edb0`. F02 source and sealed evidence are unchanged.
- **Source pin:** `b693167`
- **Evidence:** `test-results/ma3/t9r-f03/` (SHA-256 sealed, `INDEX.sha256`)
- **Not done (as instructed):** no push, production change, migration, tunnel activation, credential change or T10 work.
- **Physical-phone, LAN and internet-remote behaviour:** **NOT TESTED** (no authorized device or network testing has occurred).

## 1. Scope and result

| Item | Result |
|---|---|
| F02 round-5 MEDIUM: glob, quoted and variable references | **Repaired** |
| F02 round-5 MEDIUM: folder-level tool configuration | **Repaired** |
| F02 round-5 MEDIUM: missing consumer names | **Repaired** |
| F02 round-5 MEDIUM: UTF-16 consumers | **Repaired** |
| F02 round-5 LOW: promotion re-classified without content | **Repaired.** Promotion re-classifies the exact, hash-verified staged bytes. |
| F02 round-5 LOW: Retry revoked grants before its refusal checks | **Repaired.** Every refusal check runs first; a refused Retry changes nothing; an accepted Retry still revokes grants and now closes the attempt it abandons. |
| F02 round-5 LOW: Replan did not stamp one-time answers | **Repaired.** Unused answers are stamped `WITHDRAWN`; completed `CONSUMED` history is kept. |
| Process containment (F01 §7.4 residual) | **Reassessed, not repaired.** Needs provider-session job containment (a native helper change); recommended as its own gate (§4). Stop and hold messages now state exactly what tracking can see. |
| Independent review of the resulting source | Map round plus three review rounds (`independent-review.md`). No BLOCKER or HIGH confirmed. Every confirmed MEDIUM was fixed or dispositioned. |
| Full regression on the final source pin | **1,263 / 1,263 pass**, 0 fail, 0 skipped, 0 cancelled: scripts 256, lib 884, agent 24, UI 99. Floor 1,235 met; 28 new F03 tests. |

## 2. What changed (source `b693167`)

**`src/lib/bunny-missions/authorization.server.ts` — D1 consumer scan.** Full contract: `test-results/ma3/t9r-f03/consumer-classification-contract.md`.

- **Consumers:**
  - every non-document root or ancestor file of any name;
  - shell, CI, build, container and install files and shebang scripts anywhere in the project (dependency and output folders skipped);
  - all dot-folder text, Git and Mercurial hooks;
  - notebooks (cell sources).
  - Linked folders are followed with a cycle guard.
- **References:**
  - exact paths and file-name tokens;
  - folders named as folders: paths with globs or computed parts, quoted, option and list values, shell arguments. Prose does not count;
  - extension, brace and bare globs on commands that run files. A read-only tool such as a formatter is judged per command;
  - MkDocs `docs_dir`, `.vitepress` and pytest `markdown-docs` default inputs.
- **Content and name rules:**
  - doctest `>>>` prompts;
  - requirement lines, including `name @ url`;
  - `test*.txt`;
  - `<script`;
  - Templater and DataviewJS blocks.
  - Formula-like CSV cells add a warning.
- **Encodings:** UTF-16 with or without BOM; JSON/JS escapes decoded. UTF-32, unreadable, oversize (>1 MiB, F02 contract), linked-unresolvable, over-budget (2000) or over-deep (32) fail closed.

**`src/lib/bunny-missions/manager.server.ts`:**
- promotion re-classification with content;
- Retry ordering and attempt closing;
- Replan `WITHDRAWN` stamping;
- the hold and promotion-wait messages say "code Bunny tracks".

**`src/lib/bunny-host/manager.server.ts`:** the Stop cleanup message says only recorded processes were verified.

**Tests:**
- new `src/lib/bunny-missions/f03-hardening.test.ts` (28 tests);
- `remote-authority.test.ts`: F01-R6 and F01-R27 changed. Each is documented in `changed-assertions-ledger.json` with its original requirement and rationale; neither is a weakening (confirmed by review round 2);
- all F02 test files are unchanged.

## 3. Verification

| Check | Result | Evidence |
|---|---|---|
| Full regression | 1,263 / 1,263, 0 skipped | `full-test-results.log`, `regression-inventory.json` |
| Typecheck / lint / build | pass / 0 errors (22 pre-existing warnings) / pass | `typecheck.log`, `lint.log`, `build.log` |
| F02 §18 live acceptance on a real disposable Host (re-run on the F03 source) | 17 / 17 steps PASS | `live-staging-acceptance.json` |
| Finding matrix (each finding mapped to passing tests, derived from the log) | **19 / 19 PASS**: every F02 round-5 item, every F03 review round, availability, F01-R27, the full F01 and F02 suites, live acceptance, X53, package, production and secrets | `finding-matrix.json` |
| T6 Calculator X53 (live Windows UIA) | **10 / 10 consecutive clean** on `b693167`, 0 failed attempts | `x53/` |
| Windows package build and packaged-Host boot | **PASS**: built from `b693167`, with manifest, closure and source checks; the packaged Host booted in disposable state with verified release identity and closed gracefully. The packaged gateway was NOT TESTED because production holds port 8084. | `windows-package-results.json` |
| Production v26 | **Unchanged.** Release `Bunny-A-Windows-v26-MA2-R1`, manifest `81f83786…` (161 files), and listeners PID 23016 / 13672 are the same before and after. | `production-before.json`, `production-final.json` |
| Secret scan | **0 findings** | `secret-scan.json` |

**Availability on this repository.** `notes/`, `docs/`, `reports/` and root `.md` writes are phone-safe, at about 0.1 s per check. `data/` writes are refused because of the prose "Host data" in an installer script; this over-refusal is fail-safe.

## 4. Process containment reassessment (summary)

Full text: `containment-reassessment.md`. Every claim was confirmed by review round 1's containment lens.

**What is and isn't contained.** Git, `gh` and Mission `terminal.exec` run in Windows job objects (`KILL_ON_JOB_CLOSE`). Provider sessions (Codex, Claude) are plain child processes, tracked by 15-second process samples. As a result:
- a grandchild that is orphaned between samples is never tracked, so it is invisible to the device-write hold and the promotion wait, and Stop does not kill it;
- after an unclean Host exit, provider processes keep running untracked.

**Effect.** A paired-device change still never lands while code runs. It stays staged until the owner promotes the exact bytes. The residual matters only if the owner promotes while such an untracked orphan is reading project files.

**Robust repair.** Provider-session job containment, with job accounting as the liveness signal. This needs a native helper change: stdin and output pipes, `ActiveProcesses` accounting, a rebuild and new release hashes. **Recommended as a dedicated gate.** Sampling changes cannot close it.

## 5. Open items (explicitly dispositioned)

| Item | Severity | Disposition |
|---|---|---|
| D1 heuristic residual class: a tool or convention that consumes a project file by default without naming it in any file the scan reads. Every review round found new families, and each found family was fixed; the class is open-ended. | MEDIUM | **Accepted with mitigation.** Every paired-device change is inert in Host staging until the owner promotes the exact reviewed bytes. Under a remote (paired-device) envelope those bytes are re-classified at promotion; under a workstation envelope the owner's review is the control. |
| Process containment (survivor lineage and unclean-exit) | MEDIUM | **Deferred** to a dedicated provider-session job-containment gate (§4). |
| A refused Retry leaves an unspent trusted-desktop grant | LOW | Accepted. The grant cannot be used while the Mission is not running and expires after 5 minutes. |
| Literal paths inside program code | LOW | F02 R3-7 disposition (PHONE_SAFE is an inertness claim). |
| Shell prose over-refusal; a consumer-named YAML/TOML file over 1 MiB fails closed | LOW | Fail-safe availability effects. |
| Round-3 repairs | — | Verified by regression tests and the full regression, not by a further independent review round. |
| Physical phone, LAN, internet | — | **NOT TESTED.** |

## 6. Evidence index

`test-results/ma3/t9r-f03/INDEX.md`, sealed by `INDEX.sha256`.
