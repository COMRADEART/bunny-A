# Bunny-A — M-A-3 T14 acceptance: autonomous agentic execution

`BUNNY_MA3_T14_PASS_WITH_LIMITATIONS`

Every mandatory safety gate passes. No BLOCKER or HIGH finding is open. The limitations are listed in §19 and in
`test-results/ma3-t14/known-limitations.md`. They cover live hardware and providers that were not exercised,
carried-over UI limits, and one MEDIUM that was accepted by design.

## 1. Starting commit and branch

- **Branch.** `ma3-t14-autonomy`, created in an isolated worktree (`../bun-router-t14`) from `a40f2aa`, the PR #7
  merge. That merge is `e41a4d6` plus three MA0 review documents.
- **References verified.**

  | Reference | Commit |
  | --- | --- |
  | T13.3 source | `c43fad3` |
  | VE2 source | `910eb85` |
  | Widget Studio source | `091c5d2` |
  | Widget Studio evidence | `e41a4d6` |
  | PR #7 merge | `a40f2aa` (fetched from `origin`) |

- **Uncommitted work preserved.** The owner's uncommitted routing-autopilot work in the main checkout was left untouched.
- **Baseline.** The clean-worktree run at `a40f2aa` gave **2,526 / 2,526**, matching the reported Widget Studio baseline.

## 2. Final executable source commit

**`ea6950c5aa1a0009c5d7a999ebd7f7dff798052f`.** The four source commits are:

| Commit | Change |
| --- | --- |
| `77b8446` | T14 implementation |
| `2eacbb7` | Review round 1 fixes |
| `ff2e45e` | Review round 2 fixes |
| `ea6950c` | Agent-workspace caption, found by the walk |

21 files changed, +1,202 / −38. The list is in `test-results/ma3-t14/source-manifest.json`.

## 3. Separate evidence commit

The commit that adds this report. A commit cannot contain its own hash, so the hash is returned in the final report.
That commit holds `docs/t14/`, this report and `test-results/ma3-t14/`, sealed by `MANIFEST.sha256` and
`MANIFEST.sha256.seal`.

## 4. Agentic architecture changes

See `docs/t14/T14_AUTONOMY_ARCHITECTURE.md`. No new runtime, router, permission engine or Mission state machine was
added.

- **Derived worker authority.** `deriveWorkerAuthorization`, `derivedScopeViolations` and `derivedEnvelope`. A worker
  whose needs fit inside its parent's live envelope runs at once on a strict subset of it. The subset check covers every
  envelope field, the budget is conserved across all workers, the authority kind is the parent's, expiry is no later than
  the parent's, and the grant is read through the parent so it ends with the parent. Anything wider waits for the owner.
- **Workers are tied to the parent.**
  - A parent waits for its workers before it completes.
  - Verdicts reach the parent's memory and its result. Only Host-verified text becomes a verified fact.
  - A replanned parent stops its derived workers.
  - Workers admit nothing new while the parent reconciles.
- **Workspace wake.** A step waiting for another Mission's workspace lock is now woken when that lock is released. This
  was a pre-existing gap.
- **`MissionView.autonomy`.** Projects PLAN, DELEGATE, EXECUTE, OBSERVE, VERIFY, REPAIR, COMPLETE, WAITING_RESOURCE,
  WAITING_DEPENDENCY, WAITING_AUTHORIZATION, OUTCOME_UNCERTAIN, RECONCILIATION_REQUIRED, FAILED and CANCELLED from
  canonical facts. COMPLETE is `verified` only when every step and every worker passed Bunny's checks. It is shown in the
  Agent workspace and in the Mission panel.
- **Defaults and fixes.**
  - `maxActiveMissions` goes from 3 to 4.
  - `mayReconcile` fails closed.
  - The Lotus widget honours its Project filter.
  - A cached theme no longer flashes the default on load.

## 5. Four-Agent execution results

**T14-C.** Gada, Spear, Vishnu Chakra and Sword each own one Mission in a separate Project.

- All four were dispatched together and ran at once, with every Agent in RUNNING.
- Spear could not add a worker to Gada's Mission and could not read Gada's private memory.
- Gada's write lost its connection and waited for reconciliation. The other three completed, and nothing was replayed.

The built-app walk also shows the four Agents in four different live phases (§12).

## 6. Child-worker coordination evidence

| Test | What it shows |
| --- | --- |
| T14 derived | One worker runs under the parent's approval with no request; a browser worker waits, with its reasons recorded; the parent holds for the worker, then completes with "Workers: 1 verified by Bunny, 1 not verified". |
| T14-B | Three workers overlap in time: spans 0–3,712, 379–4,130 and 427–4,194 ms in the final run. The per-Agent cap holds them first (`AGENT_CAP`). The dependent parent step waits for its prerequisite, and its prompt carries "Worker Run tests verified" and "Worker Lint verified". The result reads "Workers: 3 verified by Bunny." |
| Revocation test | A replanned parent revokes the derived envelope and stops the worker. |
| T14 review F6 | Workers are held during parent reconciliation and resume after the owner decides. The test is mutation-checked. |
| Packaged P02–P05 | The same behaviour from the shipped package. |

## 7. Autonomous task-completion results

**T14-A.** A Team Mission with a seeded defect. After the single plan approval:

- the Host's Tester check failed;
- the reviewed rework replica repaired the defect;
- the Mission completed with **0 owner requests** and "10/10 steps completed. 10 independently verified by Bunny". Its autonomy was COMPLETE and verified.

The phase trail included PLAN, WAITING_AUTHORIZATION, DELEGATE, EXECUTE, VERIFY, REPAIR and COMPLETE, recorded in the
log. Under T13.3 N-C, a raw write-capable provider session whose check fails still pauses for reconciliation and is
never replayed. That is asserted in the same suite.

## 8. Crash and error recovery

| Test | Result |
| --- | --- |
| T14-F | A Host reboot mid-work holds both the parent and the worker in `waiting_for_user` and re-dispatches nothing. Restart to reconciled state took 385 ms locally and 773 ms in the final regression. |
| T14-L | A database crash snapshot at stage 7 of 10 recovers. The interrupted stage is marked `interrupted`, the owner retries, and every stage completes exactly once. 11 external calls are charged against the allowance of 12. |
| T14-L (runtime limit) | The runtime limit is enforced with an accelerated clock. |
| T14-D | A read step's provider loss reroutes, and the failure budget is bounded (WAITING_RESOURCE). |
| T14-E | An uncertain write is never replayed and only `mission.reconcile` moves it. |

## 9. Model and harness routing

See `docs/t14/T14_RESOURCE_ROUTING.md`. BunnyRouter, account eligibility and Laya/Jev (advisory) are unchanged. A
worker's provider allow list, local-only flag, sessions and budget are narrowed to its parent's. Fallback is measured at
a median of 112.9 ms. No real provider was called.

## 10. Lotus Memory validation

| Test | Result |
| --- | --- |
| T14-G | After a restart, the owner recalls its private note, its Project note and the verified step outcome. An Agent without a Mission in that Project sees none of them. A worker's context holds the Project slice only. |
| T14-K | An explicit `lotus.share` crosses into the shared Project; an unshared private memory does not. |
| T14-C | Agents do not read each other's private memory. |

Worker verdicts are verified facts only when the Host verified them.

## 11. Voice-to-action validation

**T14-H**, on the real contained voice worker with typed (simulated) input and null output.

- A spoken goal became a canonical draft that waits for on-screen review: "I drafted a Mission: writing the changelog… I
  can't approve or start it by voice."
- None of these touched the running Mission: "be quiet", a barge-in interrupt, "stop the mission" (a screen-only proposal,
  then cancelled), or closing the voice session. The Mission completed after voice closed.
- No real microphone or speaker was used (L-VOICE).

## 12. Widget, Notch and phone validation

| Check | Result |
| --- | --- |
| T14-I | All 22 themes and three widget layouts were switched mid-Mission. Mission, step, phase, authorization and Agent state stayed unchanged, and nothing was dispatched. |
| Built-app walk | **44/44** pages (22 Agent-workspace pages, one of the four seeded Missions per theme, plus 22 phone pages); 4/4 dark Mission pages; the theme-restore check showed only "pixel". The rendered caption equalled the Host's own `autonomy` on every page. Screenshots were inspected; results are in `test-results/ma3-t14/walk/results.json`. |
| T14-J and packaged P06 | Every workstation action from a paired phone fails closed. |
| Native Notch | Still shows its chips, not widgets (W-1). |

## 13. All 22 theme compatibility results

- 22/22 themes passed on the Agent workspace (desktop, light).
- 22/22 themes passed on the phone companion.
- Glass dark passed for all four phases.
- The packaged theme e2e passed 7/7.
- The 22-theme model is unchanged, and the original weapon-character artwork is untouched.

## 14. Security and N-C retry validation

See `docs/t14/T14_SECURITY_AND_RECOVERY.md`.

- **Derived-authority invariants.** Each invariant has a test: field subset, budget conservation, no fresher consent, no
  device parent, no T5 parent, no derivation during waits, ending with the parent, and workstation only.
- **N-C unchanged.** Raw write sessions are never auto-replayed (T14-A, C, D and E). Reconcile is workstation-only.
- **Phone.** It fails closed (T14-J).
- **Fabricated success.** It is prevented: COMPLETE requires canonical completion, and verified requires Bunny's checks.

## 15. Performance measurements

See `docs/t14/T14_PERFORMANCE.md`. Single workstation; SIMULATED model I/O.

| Measure | Value |
| --- | --- |
| Planning | 23.4 ms (median) |
| Approve → launch | 104.3 ms |
| Derived worker → running | 164.4 ms |
| Status visible | 115.2 ms |
| Lotus recall (200 memories) | 32.1 ms |
| Restart → serving | 160 ms |
| Idle Host | 0.94 % of one core, 129.6 MiB |
| Duplicate dispatches | 0 |

## 16. Full regression counts

The final source `ea6950c` was run in a clean detached worktree.

| Suite | Result |
| --- | --- |
| Scripts | 450 / 450 |
| Library | 1,645 / 1,645 |
| Agent | 58 / 58 |
| UI | 396 / 396 |
| **Total** | **2,549 / 2,549** (0 failed, 0 skipped, 0 cancelled) |

- **Composition.** The total is the 2,526 baseline plus 23 new tests: 21 library T14 scenario and review-regression tests, and 2 UI tests.
- **Other gates.** Typecheck passes, the production build passes, and lint reports 0 errors with 20 pre-existing warnings.
- **Intermediate runs.** These are kept, not hidden: `77b8446` gave 2,544/2,544 and `2eacbb7` gave 2,548/2,548.
- **Old expectations.** None was changed or removed. One existing test, the `mayReconcile` test, gained three fail-closed
  assertions. Two existing UI test files gained new tests, and one import line was extended.

## 17. Windows package verification

- **Package.** `Bunny-A-Windows-MA3-T14-TEST`, version `0.0.0-ma3-t14.1`, from `git archive` of `ea6950c` (source and
  tooling).
- **Verification.** 563 files; hash, import-closure and source-match checks are OK.
- **Zip.** 181,174,575 bytes, sha256 `b1ce0213db463f1c8223deee15f9f341d06ce1fbead50e15a490407012f3cbeb`.
- **Packaged e2e, from the package's own `runtime/node.exe`.**

  | Suite | Result |
  | --- | --- |
  | T14 | 8/8 |
  | T13.3 baseline | 18/18 |
  | Themes | 7/7 |
  | Widgets | 8/8 |

- **L-PKG-NPM.** The packaged `npm` identity check still asks fail-closed. The log is kept.
- **Not committed.** The zip and package folder are not committed; their `.sha256`, manifest, results and logs are.
- **Not installed.** Nothing was installed.

## 18. Independent review

A separate `security-auditor` agent with a fresh context reviewed the change in three rounds. Its reports are kept
verbatim in `test-results/ma3-t14/review/`; the summary is in `docs/t14/T14_INDEPENDENT_REVIEW.md`.

| Round | Result |
| --- | --- |
| 1 | **1 HIGH** (worker budgets not conserved), 4 MEDIUM, 4 LOW, 2 INFO. All fixed with regression tests. |
| 2 | 7 confirmed fixed; F6 partial; one new LOW edge. Both fixed, and the fix exposed and repaired a pre-existing workspace-wake gap. |
| 3 | No BLOCKER or HIGH. One MEDIUM is accepted by design: a worker step already in flight when its parent enters reconciliation finishes, which is the parent's own rule for in-flight steps. One LOW is noted. |

## 19. Remaining limitations

These are in `test-results/ma3-t14/known-limitations.md`.

- **Not tested live.** No live provider inference (L-LIVE); no real microphone or speaker (L-VOICE); no physical phone
  (L-PHONE); an accelerated durability fixture, not an endurance run (L-ENDURANCE).
- **Packaging.** L-PKG-NPM.
- **Delegation and ownership.**
  - A parent under T5 consent or approved from a paired device does not derive authority to its workers.
  - Workers are proposed by the workstation command; in-plan decomposition is the Team Mission path.
  - No Mission is co-owned.
  - The default caps need owner configuration for wider parallelism.
- **Review residuals.** The accepted R3 MEDIUM and the R3 LOW.
- **Widget limits carried from Widget Studio.** No Notch widgets; a four-row Agents widget; a read-only phone; broad
  re-renders; pointer-only resize.

## 20. Installed production unchanged

Production was observed read-only before and after the work (`test-results/ma3-t14/production/`).

- Host 43119 is PID 26300 and gateway 8084 is PID 24248. Both run the installed `Bunny-A-Windows-MA3-T13-FINAL-TEST`
  release, with unchanged creation times.
- `install.json` is unchanged: last written 2026-10-12, same sha256.
- The main checkout's `install/` is unchanged.

Nothing was installed, deployed, published, pushed or merged.

## 21. Verdict

**`BUNNY_MA3_T14_PASS_WITH_LIMITATIONS`**
