# M-A-3 Gate T9R-F04: Windows Job Object Containment and Provider Session Lifecycle Hardening

- **Branch:** `claude/ma3-t9-phone-remote`
- **Builds on:** F03 `BUNNY_MA3_T9R_F03_PASS_WITH_LIMITATIONS`, source `b693167`, evidence `9e64719`. F01–F03 source and sealed evidence are unchanged.
- **Source pin:** `43ffee8`
- **Evidence:** `test-results/ma3/t9r-f04/`, sealed with SHA-256 in `INDEX.sha256` and committed in the evidence commit that adds this report.
- **Not done, as instructed:** no push, no production deployment, no restart or migration, no provider credential, phone pairing, tunnel, Startup, Firewall or Missions/Triggers change, no change to the installed native helper, and no T10 work.
- **Physical phone, LAN and internet-remote behaviour:** **NOT TESTED**.

## 1. Result

| Item | Result |
|---|---|
| J01–J60 adversarial matrix, derived from recorded results (`adversarial-matrix.json`) | **60 / 60 PASS**, 0 NOT TESTED |
| Full regression on `43ffee8` (`full-regression.log`) | **1,295 / 1,295 pass**, 0 fail, 0 skipped, 0 cancelled: scripts 256, lib 916, agent 24, UI 99. The floor of 1,263 is met. 32 new tests (25 F04, 7 F03 follow-up). No pre-existing test file was edited. |
| Live containment (`live-containment-acceptance.json`) | **30 / 30**: 10 Stop, 10 abrupt Host death, 10 graceful shutdown |
| Calculator X53 (`x53/x53-stability-matrix.json`) | **10 / 10**: cold, warm and minimized |
| Nested jobs (`nested-job-validation.json`) | none, plain and silent-breakaway parents: PASS. Breakaway-forbidden parent: refused, fail closed (PASS). No parent job (WMI broker launch): **NOT TESTED** |
| Windows test package `Bunny-A-Windows-MA3-T9R-F04-TEST` | **PASS**: built from `43ffee8`; the packaged runtime ran a job-contained provider session |
| Independent review (`independent-security-review.md`) | Review rounds 1–6 plus an F03 follow-up with four verification rounds. **No unresolved BLOCKER or HIGH.** |
| Typecheck, lint, build | EXIT 0, EXIT 0 (0 errors; the 22 warnings are pre-existing, in non-F04 files), EXIT 0 |
| Production v26 | Unchanged. Read-only observation only; see §23. |

Failed attempts were kept and are disclosed in `attempt-history.json`; none was retried silently:
- **Full regression attempt 1:** X53 timed out.
- **X53 attempts 1–3:** the user's Chrome took the foreground, and Bunny's foreground-drift check refused the click. Attempt 4 stopped on a stale ledger.
- **Live run attempt 1:** a harness expectation was wrong.

Each one was diagnosed with recorded evidence before the next run (§18, §14).

## 2. Root cause of the previous containment gap

Before F04, Codex and Claude sessions ran as plain `spawn` children. Stop used `taskkill /T` and process-table sampling every 15 s. This caused three gaps:
- a descendant whose parent had exited fell out of the tree, so Stop and the F01/F02 live-code hold could not see it;
- a Host crash left provider trees running;
- provider probes, the Codex app-server probe and Python verification ran uncontained.

Membership was inferred from a process list, and a process list is not containment (`baseline.md`, `discovery/`).

## 3. Native Job Object implementation (`native/bunny-owned-process.c`)

- **Job:** an unnamed job per session with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` (0x2000) and nothing else. There is no `BREAKAWAY_OK` or `SILENT_BREAKAWAY_OK`.
- **Process creation:**
  - The root process is created with `CREATE_SUSPENDED | CREATE_NO_WINDOW`, and is already assigned to the job through `PROC_THREAD_ATTRIBUTE_JOB_LIST`.
  - `PROC_THREAD_ATTRIBUTE_HANDLE_LIST` passes only the stdio handles.
  - The prompt goes through an anonymous pipe, written by a Host writer thread that is created suspended and resumed before the root starts.
- **Admission:** `IsProcessInJob` must confirm membership before `ResumeThread`.
- **Failure handling:** any failure (job, attribute list, creation, membership, writer) terminates the suspended root and fails the launch: "Containment unavailable — execution refused". No fallback launcher exists, and a static test enforces this.

## 4–8. Suspension, assignment and handle lifetime

- **Assignment at creation:** the process is a member from creation, before any instruction runs (J03/J04, live).
- **Owner and access:** the Host owns the job handle, a duplicate reduced to `ASSIGN_PROCESS | QUERY | TERMINATE`. It is never inherited and never exported (J08/J10).
- **Kernel cleanup:** the helper is an in-process Node-API module, so Host death closes the handle in the kernel and KILL_ON_JOB_CLOSE ends every member (`job-handle-lifecycle.md`).
- **Stop:** issues `TerminateJobObject` and returns at once; JavaScript then polls `ActiveProcesses`, which is authoritative.
- **Unconfirmed termination:** if accounting does not reach 0 within 30 s, the handle stays held, termination retries with backoff, and the session stays live code. A session's `done` (and so completion, verification and retry) waits for kernel accounting.

## 9. Provider adapter coverage

These all run in a Bunny-owned job (`provider-compatibility-matrix.json`, `process-launch-inventory.md`):
- **Provider sessions:** Codex and Claude, direct and as Mission steps;
- **Probes:** every `probe()`, and the Codex app-server catalogue and usage probe (interactive stdin);
- **Verification:** Python verification;
- **Mission processes:** `terminal.exec`, Git and `gh`, which already used the T4 helper.

Retries, reroutes and escalations relaunch through the same path: `adapter.launch → spawnSession → containedSession`. Host tools (`powershell.exe`, `taskkill.exe`, `nvidia-smi`) are launched by absolute path (System32, or a PATH-only lookup outside the working folder), and interpreters are resolved outside the task folder.

## 10. Unsupported execution paths

These are excluded and never reported as contained (`native/README.md`):
- Ollama and hosted APIs (no Bunny worker);
- brokered launches: WMI, the Task Scheduler, services, COM, shell hand-off, and `computer.open_app` AppX activation of allow-listed GUI applications;
- WSL;
- a hostile process running as the same Windows user that attacks the Host process itself.

Non-Windows platforms remain uncontained and are never reported as contained.

## 11–12. Child containment and breakaway protection

- **Membership.** The job includes children, grandchildren, short-lived processes, detached processes (`DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP`), orphans (parent exits first) and 40-child bursts. Kernel accounting matches the independent OS observation, and every observed fixture process was a recorded member (J11–J15, J18, J45).
- **Explicit breakaway.**
  - A direct member asking for `CREATE_BREAKAWAY_FROM_JOB` is refused by the kernel.
  - Under the libuv nested job, which does allow breakaway, the child still stays in Bunny's job (live: `memberOfBunnyJob: true`).
- **Silent breakaway.** If a member creates its own permissive nested job, the children of that nested job remain Bunny members (J16/J17).

## 13. Stop behaviour

Stop was live 10/10 (example from round 1):
- 14 owned fixture processes were running, with 63 in the job;
- after an authenticated Stop, 0 owned processes remained, the root was gone and the task was `stopped`;
- the cleanup text was: "Windows job verified empty by kernel accounting: 26 process(es) in the job when it was terminated ended with it…";
- an unrelated process with the same image and a provider-like process both survived (J29–J31).

Two Host shutdown checks also pass:
- Graceful shutdown awaits stops still in flight before the database closes (10/10, "Host shutdown stopped this owned task … verified empty").
- Stop before admission is reported as never admitted, and its text claims nothing it did not do.

## 14. Abrupt Host exit

Live 10/10, with `taskkill /F` of the Host and no Bunny code running:
- Each round had 14 owned processes, and 37–68 job members by kernel accounting.
- In every round, 0 owned processes remained and the root was gone, observed 924–1001 ms after the kill.
- Unrelated processes survived.

Even rounds raced a Stop against the kill. In all five, Stop finished first: the record was `stopped`/`empty`/0, which is kernel-verified, so there was nothing to reconcile. The first final run expected a reconciled record there; that expectation was corrected and the run repeated (`review/final-live-attempt1-diagnosis.md`). **Death in the middle of Stop cleanup was not observed live.** The unit tests cover it.

## 15. Native helper crash

There is no separate helper process. The helper is an in-process Node-API module, so a helper crash is a Host crash (§14). The integrity check refuses to load a helper whose build manifest does not match its source (J21, J36, J46).

## 16. Host restart and recovery

- **Identity check.** Interrupted job records are reconciled by PID + creation time + image against an independent process table.
- **Failed reads.** An empty table is a failed read, not proof that processes are absent.
- **Fail closed.** An unknown birth time counts as alive; unreadable records, and a provider-sessions folder that cannot be listed, are held as live code until every record is reconciled. A record with no identity requires review.
- **No killing.** Nothing is killed and no handle is recreated.
- **Outcome.** Absence is recorded as `absent_after_restart`, never as kernel `empty`. Relaunching the same Mission or Task is refused while a survivor may exist.

Live abrupt rounds showed that the Agent and Mission persist, the task fails with truthful text, and earlier transient consent did not revive (the authorization was `WAITING_FOR_USER`). No duplicate launch happened (`effects.log`), and two `provider_session` events were recorded (J37–J41).

## 17. Protection of existing user processes

- **Termination path.** Termination goes only through the session's own job handle; there is no PID-, name- or handle-based job API (J31, J10).
- **Live survivors.** Same-image and provider-like unrelated processes survived every live round (J26, J30).
- **Restart ownership.** On restart, a reused PID with a different birth time is not treated as ours (J32).
- **X53 Calculator windows.** Only Bunny-recorded targets were handled, by exact identity (see §18).
- **The user's Chrome.** Bunny never touched it.

## 18. Calculator X53

**10 / 10** on `43ffee8`: cold, warm and minimized. Every Calculator that Bunny started was closed by exact identity (PID + creation time + image), with a receipt in `x53/`.

Attempts 1–3 failed with `computer.invoke_control` refusing "Foreground drift requires a fresh decision". Each time the foreground had moved to a window of the user's own Chrome (`C:\Program Files\Google\Chrome`, started 12:03, not started by Bunny). This is the X53 safety contract working, not a containment defect.

With the user's agreement, the user closed Chrome. Attempt 4 stopped because the ledger still named a target that had already been closed. The tool refused to act on it, and the ledger was reset truthfully. Attempt 5 then passed 10/10.

## 19. Authorization regression and the F03 follow-up

- **F01–F03 suites** are unchanged and pass (J51–J54). F04 only adds live-code gates: Host verification and probe jobs, restart survivors, and unreadable holds.
- **F03 follow-up finding.** The brief-required follow-up of F03 found F03-FOLLOWUP-1 (MEDIUM): the D1 read-only-tool exemption could hide a runner.
- **Fail-closed repair.** It applies exemptions per line and requires every stage of a pipeline to be read-only, with allow-listed options. A file with any statement that spans lines gets no exemptions. Computed, escaped and braced names count, as do collecting configs.
- **Verification.** Four independent rounds checked the repair.
- **Regression audit.** It found **no regression** against `b693167`: 0 in 2,428 corpus pairs, and 4 of 10,000 fuzz pairs, which are comment-only glob text.
- **Disclosed residual.** The D1 class remains disclosed: names assembled only from variables, shell function shadowing, tools that consume files by default, and globs assembled in code. It is mitigated by F01 and F02: devices never authorize execution, and every paired-device change stays inert until the workstation owner promotes the exact bytes.

## 20. Complete test count

**1,295 / 1,295** (see §1). New test files:
- `src/lib/bunny-host/provider-containment.test.ts`: 25 tests, using real native jobs, real processes and independent OS observation;
- `src/lib/bunny-missions/f03-followup.test.ts`: 7 tests.

## 21. Independent security review

- **Six F04 rounds** (`review/round1–6`): 2 HIGH (both repaired and verified) and 9 MEDIUM (8 repaired; F04-C1 downgraded to LOW by the round-1 skeptics and accepted). The remaining items are LOW, repaired, refuted or accepted.
- **Accepted LOW residuals**, all fail closed or availability-only:
  - `close_group` can block the Host thread for up to about 3.4 s;
  - a database write failure in the middle of a restart reconcile keeps that restart's hold until the next Host restart.
- **F03 follow-up:** see §19.

## 22. Windows package

`Bunny-A-Windows-MA3-T9R-F04-TEST` (version `1.0.0-MA3-T9R-F04-TEST`) passes its checks:
- **Build:** built from `43ffee8`, with manifest, import-closure and source checks passing;
- **Native helper:** `compatibility.providerProcessContainmentPolicyVersion = 1`, built only from the committed C source;
- **Boot:** the packaged Host booted in disposable state;
- **Contained session:** the packaged `node.exe` and adapters ran a contained provider session, reaching state `empty` with a peak of 4 active processes and 0 at the end (J60).

## 23. Production preservation

Installed `Bunny-A-Windows-v26-MA2-R1` was observed read-only before and after the gate:
- **Unchanged:** the release, manifest (161 files), `install.json`, listeners (127.0.0.1:8084 and :43119, same PIDs) and Startup shortcut.
- **Changed by production itself:** the running production Host added 4 `provider.status_changed` events from its own provider polling, with matching `providers` and `sqlite_sequence` changes. F04 opened the database read-only and never started, stopped or signalled production (`production-comparison.json`).
- **Not touched:** port 8084 was never terminated.

## 24. Remaining limitations

1. Physical phone, LAN and internet-remote behaviour: **NOT TESTED**.
2. A Host with no enclosing job (WMI broker launch): **NOT TESTED**. All tested parents passed or failed closed.
3. Death in the middle of Stop cleanup was not observed live: Stop always won the race (§14). The unit tests cover it.
4. Out-of-contract classes (§10) are excluded and documented, not contained. Non-Windows platforms are uncontained.
5. The F03 D1 heuristic residual class remains (§19), mitigated by inert staging and owner promotion.
6. Accepted LOW review residuals (§21).

## 25. Evidence root

`test-results/ma3/t9r-f04/`. Start with `INDEX.md`; `INDEX.sha256` is the seal.
