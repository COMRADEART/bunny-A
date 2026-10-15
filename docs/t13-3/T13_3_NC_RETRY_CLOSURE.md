# T13.3 N-C closure: no automatic replay of write work whose outcome is uncertain

**Starting point:** source `fc915a0`, evidence `ca78d25`, verdict `BUNNY_MA3_T13_3_PASS_WITH_LIMITATIONS`. Gate J left
review finding N-C open as limitation **L-RETRY-SAME**: the T3 §22 same-candidate retry could re-run write work after
a connection failure.

**Owner decision (2026-10-14).** The owner authorised a change to the original T3 retry contract so that no automatic
retry can duplicate a write.

**Source commits:**

- `b682f6f`: the N-C patch.
- `3a40957`: the repairs for the independent review of `b682f6f`.
- `b4ada18`: the repairs for the confirmation review of `3a40957`.
- `e6240c2`: the repairs for the second confirmation review of `b4ada18`.
- `4b6e919`: the repairs for the third confirmation review of `e6240c2`.
- `6f7beb8`: the repairs for the fourth confirmation review of `4b6e919`.
- `2e78bd9`, `2db90fc`, `72eab2b`, `23c8c85`, `8411305`, `3e75135`, `5376fdf`: follow-up checks on stale Mission children
  (owner-initiated).
- `c43fad3`: a skill's preflight ask is recorded as `authorization.required`. The packaged end-to-end run found this.
  **Final source: `c43fad3`.**

Evidence is in `test-results/ma3/t13-3/nc-retry/`.

## 1. The policy and where each row is enforced

| Task classification | Automatic retry | Enforcement |
|---|---|---|
| Explicitly read-only | Permitted within the existing T3 / Mission limits | TaskManager `writeWork` is false only for `executionScope.access === "read"` (or a tool-free provider, which cannot write). Mission `writeCapable(step)`, and `uncertainRun` returns null for `READ` capability runs. |
| Write-capable | Refused when the previous operation may have started | TaskManager run loop: `writeWork && mayHaveStarted` sets `uncertain = writePause(taxonomy)` and exhausts at once, with no `retry-same`, escalation or reroute. Mission `stepFailed(..., uncertain)` gives the verdict `{retry:false, reroute:false, waitForUser:true}`. |
| Missing or unknown scope | Treated as write-capable | `access !== "read"` everywhere: TaskManager loop, `update()` central rule, restart sweep, Mission `writeCapable`. |
| Proven failure before dispatch | One bounded retry | Only an adapter certificate `AdapterResult.dispatched: false` proves that nothing started: a refused authority check, a spawn error before `"spawn"`, or a contained launch that never produced a process. For write work, `preDispatchRetries` allows one `retry-same`, then `fail` with "nothing was sent to it". |
| Verified idempotent operation | Only with enforced duplicate protection | `enforcedIdempotent()` accepts only `filesystem.write` with a pre-image guard (`expectBeforeSha256`). The adapter then detects a landed identical write ("Already applied") and refuses a changed file. A plan's or caller's `idempotent` / `idempotencyKey` claim is ignored. |
| Outcome uncertain | Pause and reconcile | `reconciliation {required, reason, at}` is recorded on the task (`OrchTask.reconciliation`, `OrchTask.dispatch`) and on the Mission step. `task.reconcile` / `mission.reconcile` are workstation-only. `mission.retry` and `mission.replan` are refused while any step is unreconciled. |

**Mission paths.** Every Mission executor follows the same rule:

- **Capability.** The bus marks every run that started and then failed as uncertain unless the adapter certifies
  `noEffect` (a refusal before any effect). Adapters cannot set `uncertain` themselves.
- **Skill.**
  - Every step's permission is settled with `CapabilityBus.preflight()` before any step runs, so an approved ask never
    re-runs a landed write.
  - A failed skill is judged by every run it made, including its cleanup runs: an uncertain run, or a write that
    succeeded before a later failure, pauses the step.
  - A throw after a landed write is judged the same way, by the runs that attempt recorded.
- **Model and team model.**
  - The child task's reconciliation is carried to the step.
  - A delegated launch that throws after the child started (`delegatedLaunchFailed`) pauses write work instead of
    rerouting it.
- **Team writes.** These always run under `teamWrite`'s pre-image guard: `already` for identical bytes, FILE_CONFLICT
  unless the file holds this Mission's own last verified bytes.
- **Stale children.** No Mission child launches unless it is its step's newest child by creation order (SQLite rowid).
  No child of an unreconciled step launches. Re-arming a failed step withdraws every never-launched child of it.
- **Retry and reconcile gates.** A Mission reconcile retry waits for live child processes, unfinished launched
  children, restart survivors and unreadable records.

**Dispatch state.** Every finished attempt records `dispatch`:

- `not_started`: the adapter certified that nothing started.
- `may_have_started`.
- `verified_terminal`: only for a completed attempt (round 2 N8).

A synchronous launch failure records `not_started` (round 2 N4). A write attempt that failed Bunny-A's check records
`may_have_started` and is uncertain (review F4).

**Same-provider and cross-provider.** The uncertain check runs before the planner's action is taken. So `retry-same`,
`escalate-effort` and `reroute` are all refused alike, including on a MANUAL pin (tests N-C 4, N-C 5 and review F15).

**Consent.** A permitted retry or reroute of read work passes `connections.evaluate` in `beforeDispatch` on every
launch, which enforces the switch allowlist. The owner's reconciled retry does the same, and it also waits for a fresh
approval.

**Cancellation, reboot and process recovery.**

- **Central rule in `TaskManager.update()`.** Launched write work that leaves a running state as `stopped` or `failed`
  by any path other than the attempt loop gets `dispatch: "may_have_started"` and a reconciliation. Those paths are a
  user stop, the runtime limit, `failOperation`, and containment.
- **Restart sweep.** The sweep marks interrupted write tasks the same way. The Mission sweep marks interrupted
  write-capable steps, including those running under a one-time approval (review F5).
- **Restart recovery.** Neither `resubmit` nor the team requeue re-admits an unreconciled step (review F6/F13).
- **Reconcile retry and live processes.** A reconcile retry is refused while a process of the original attempt (this
  Host's, or one from before a restart) may still be alive (review F7).

**Never fabricated.**

- A stop is recorded as stopped, and it is uncertain when the stopped work could write.
- A refused reconciliation leaves the step exactly as it was, with no event (review F12).
- A terminal task never reopens. The owner's retry is a new linked task (`retryTaskId`), so the original keeps its
  identity, history and checkpoints.

**UI.** "Outcome uncertain — reconciliation required" (`UNCERTAIN_LABEL`) appears in three places: task status, the
task error card, and Mission step activity.

## 2. The twelve mandatory tests

| # | Requirement | Test(s) |
|---|---|---|
| 1 | Read-only retry after connection failure | `t3-manager.test.ts` "N-C 1/2" (read branch: same-candidate retry, then reroute, then complete) |
| 2 | Direct task with missing scope pauses after uncertain execution | "N-C 1/2" (unscoped branch), "review F15" (unscoped on a MANUAL pin) |
| 3 | Mission write task refuses automatic replay | `scheduler.test.ts` "N-C 3/10", "review F1/F3" (capability failure without a throw) |
| 4 | Same-provider write retry refusal | "N-C 4" (MANUAL pin, explicit write) |
| 5 | Cross-provider write retry refusal | "N-C 5" (refusal text) |
| 6 | Proven pre-dispatch failure allows a bounded retry | "N-C 6" (TaskManager), `failure.test.ts` "N-C 6" (real adapter: refused authority, missing executable, started process; job and unwrapped spawn paths) |
| 7 | Verified idempotent retry with real dedup | `scheduler.test.ts` "N-C 7" (write lands, connection drops, guarded retry reports "Already applied", one file) |
| 8 | Fake idempotency claims rejected | "N-C 8" (`idempotent: true` and `idempotencyKey` ignored; one call; reconciliation) |
| 9 | Restart preserves uncertain outcome | "N-C 9" (TaskManager), `remote-authority.test.ts` "review F5" (Mission one-time approval), `workers-host.test.ts` "N-C 12" (live Host reboot) |
| 10 | Manual reconciliation permits safe continuation | "N-C 10/11" (direct), "N-C 3/10" (Mission), "missions.test" bounded repair, F02-ST2, F01-5 |
| 11 | Approvals, cancellation and destination pins stay valid | "N-C 10/11" (fresh approval required, pinned provider/model, cancel still works), "review F7", "review F12/replan", F01-5 (fresh desktop authority) |
| 12 | All four Personal Agents keep Mission context | `workers-host.test.ts` "N-C 12" (four Agents delegate; reboot during a worker ability; every Agent's context unchanged; the step waits for reconciliation; device `mission.reconcile` and `task.reconcile` refused) |

Further review-fix tests:

- **`t3-manager.test.ts`:** "review F2/F9", "review F4", "review F7", "review F11", "review F15", "round 2 N4".
- **`scheduler.test.ts`:**
  - "review F1/F3", "review F12/replan"
  - "round 2 N1", "round 2 N6"
  - "round 3 P1/P2", "round 4 Q2", "round 5"
  - three "final check" tests (stale children)
- **Elsewhere:** "review F5" in `remote-authority.test.ts`, and the adapter "N-C 6" in `failure.test.ts`, including
  an error after `spawn`.

## 3. Changed baseline assertions

The T3 contract history is kept. Each test below still exists and still proves its original property where that
property survives the owner's decision.

| Test | Before | Now | Why |
|---|---|---|---|
| `t3-manager` "T3 §5/§22/§23 MANUAL selection retries its own candidate once" | unscoped task | declares `executionScope: {access:"read"}` | A same-candidate retry is now read-only behaviour. The unscoped MANUAL case is pinned by "review F15", which refuses the retry. |
| `t3-manager` "T3 §24/R24 failed verification escalates effort once" | unscoped task | declares read scope | Re-executing a finished attempt that failed Bunny-A's check is write replay unless the work is read-only (review F4). The write case is pinned by "review F4". |
| `t3-manager` Gate J "N5: unscoped transport failure pauses instead of rerouting" | one same-candidate retry, then pause | replaced by "N-C 1/2": pause on the **first** failure | This is exactly the L-RETRY-SAME limitation the owner closed. |
| `scheduler` Gate J "N-B: write step whose transport keeps failing pauses; never another provider" | same-provider retries allowed, then pause | replaced by "N-C 3/10": no retry on any provider; the owner reconciles | Same reason, Mission side. "No provider switch" is still asserted, and the reconciled retry stays on the same provider. |
| `t3-manager` "N-C 10/11" (round 1 of this patch) | a cancelled retry "is not an uncertain failure" | a cancelled **launched** write is uncertain and can be closed | Review F9: a stop does not prove the provider did nothing. |
| `missions.test` "verification failure triggers a bounded repair attempt with the failure in context" | automatic repair attempt | pause, then `mission.reconcile` retry, then the repair attempt, still carrying the failure in context | A write step that failed verification may already have changed the workspace (review F4, Mission side). |
| `f02-staging` "F02-ST2: a PROMOTED change plus Retry never writes or stages twice" | `mission.retry` after the verification failure | `mission.retry` is refused (`OUTCOME_UNCERTAIN`); `mission.reconcile` retry then completes by dedupe | The promoted write landed before the failed check. Both "no second staging" assertions are unchanged. |
| `remote-authority` "F01-5: Retry never reuses a denied shell approval" | the automatic retry asks for fresh desktop authority | no automatic replay; the **reconciled** retry asks for fresh desktop authority | A crashed write session is no longer retried automatically. The F01 property is proven on the reconciled retry. |
| `workers-host` "T13.3 D … a failing one is REJECTED" | the failing test worker's child Mission fails and the worker closes REJECTED | the child Mission waits for reconciliation and the worker stays RUNNING with no verdict; the workstation reconciles **stop**, and the worker then closes **REJECTED** | The failing `npm test` started and exited non-zero, so it may have changed files (review F1). To keep the REJECTED verdict, `verdict()` now counts a step whose own work failed (`capability_failed` / `verification_failed`) as REJECTED even after a stop. An interruption (`host_restart`) stays INDETERMINATE. `workers.test` pins both cases. |

No assertion was removed without a replacement that proves at least the same safety property.

## 4. Independent review of the retry boundary

The reviewer was a separate `code-reviewer` agent, working read-only from `git show`. It was asked to examine the
retry boundary itself, not the tests. See `T13_3_NC_REVIEW.md`.

- **Round 1 (`b682f6f`).** Verdict: **an uncertain write could still replay automatically** (F1–F4), with further
  bypasses (F5, F7). Every finding is resolved in `3a40957`, with a test and a mutation for each.
- **Round 2 (confirmation of `3a40957`).** NOT CONFIRMED. A failed skill could repeat a write that had already landed
  (N1), and team rework was questioned (N2). N1–N8 and the F7 unreadable-record gap are repaired in `b4ada18`.
- **Round 3 (confirmation of `b4ada18`).** NOT CONFIRMED. An approved skill permission ask re-ran a write that had
  already landed (P1), and cleanup writes were not counted (P2). Both are repaired in `e6240c2`.
- **Round 4 (confirmation of `e6240c2`).** NOT CONFIRMED. The Mission reconcile retry did not wait for live child
  processes, and a skill exception after a landed write was retried. Both are repaired in `4b6e919`.
- **Round 5 (confirmation of `4b6e919`).** NOT CONFIRMED on one rare, pre-existing path: a delegated launch that threw
  after the child started was rerouted beside it. It is repaired in `6f7beb8`.
- **Round 6 (confirmation of `6f7beb8`).** **CONFIRMED: no automatic replay of an uncertain write found.**
- **Follow-up checks (stale Mission children, owner-initiated).** Short read-only checks followed each repair until
  the reviewer returned **CONFIRMED AT HEAD** at `5376fdf`. The final rules:
  - Only a step's newest child, by creation order (rowid), may launch.
  - Every re-arm of a failed step withdraws its never-launched children.
  - No child of an unreconciled step launches.
- **Final check (`c43fad3`).** The preflight audit event. **CONFIRMED AT HEAD.** The reviewer confirmed the event
  grants, consumes and launches nothing; its only listeners relay or display it.

## 5. Validation receipts

All in `test-results/ma3/t13-3/nc-retry/`.

**Full regression, final source `c43fad3`** (`regression-final/`). Clean detached worktree, the Gate J runner with
only the folder prefix changed, each `npm test` part run as its own step:

| Suite | Gate J (`fc915a0`) | N-C final (`c43fad3`) |
|---|---|---|
| `npm test`, scripts | 448 | 448 / 448 |
| `npm test`, library | 1,575 | 1,602 / 1,602 |
| `npm test`, Agent runtime | 58 | 58 / 58 |
| `npm run test:ui` | 379 | 380 / 380 |
| **Distinct total** | **2,460** | **2,488 (+28)** |
| typecheck, build | exit 0 | exit 0 |
| lint | 0 errors, 27 warnings | 0 errors, 27 warnings |

As at Gate I and J, the run rewrote three tracked files in the throwaway checkout (`native/voice/bunny-voice-worker.exe`
and `.json`, rebuilt by pretest, and `src/routeTree.gen.ts`). Nothing in the working tree changed.

**Retained, superseded full runs**, each at a source later repaired:

- `regression-3a40957-superseded/`: 2,478 of 2,479 (448 + 1,592/1,593 + 58 + 380). One library failure: T4 gpg-helper cleanup, `EPERM` deleting its
  temp folder under load. It passes 6 of 6 in isolation.
- `regression-2e78bd9-superseded/`: 2,485 / 2,485.
- `regression-5376fdf-superseded/`: 2,488 / 2,488.

**Focused receipts.** Each repair round ran the affected suites (T3, scheduler, missions, team, staging, workers,
remote-remediation, Agent runtime). Results are in the commit messages and in the logs above.

**Mutation checks** (`mutation-checks.cjs`). 51 mutations, each removing one part of the boundary; each must make its
targeted test fail.

- Final run at `c43fad3`: **50 of 51 killed**, all by a failing assertion (no timeouts) (`mutation-checks-final.{log,json}`).
- Every earlier attempt is retained (`attempt-1` to `attempt-18`, including survivors and their fixes).
- NC-M15 (the bus catch path) is redundant with the generic started-and-failed rule, NC-M20, which is killed. It is
  kept as defence in depth.

**Windows package** (`windows-package/`), built from `git archive` of `c43fad3`:

| Field | Value |
|---|---|
| Version | `0.0.0-ma3-t13.3.3` |
| Source and tooling commit | `c43fad3bcfb0f91594dea703860e39ba6dbc0181` |
| Archive | 179,835,520 bytes, SHA-256 `920723249c3bb55a6eb3dd64916fa43ed52f42cc75d4930f8521f0e6d8fad4bb` (matches the `.sha256` file) |
| File verification | 501 manifest files, 0 extra, 0 missing, 0 changed |
| Import closure | 145 files, 0 missing, 0 outside the package; optional package: `playwright` |
| Source check | 191 files, 0 mismatched |
| Packaged end-to-end | 18/18 PASS with the package's own `runtime\node.exe` (v24.18.0), port 43896 |
| Repository end-to-end | 18/18 PASS, port 43897 |
| Installed / published | No / No |

**Retained package attempt.** `windows-package-5376fdf-superseded/` and `e2e/attempt-1-5376fdf/`: the packaged run at
`5376fdf` failed E07 (8/9 before abort). It waited for the `authorization.required` event that records the worker's
npm ask; since P1 the skill's preflight did not record it. Repaired in `c43fad3`.

**Production** (`production/PRODUCTION_PRESERVATION.md`). The release, manifest, `install.json`, both listener PIDs
with their start times, the 45 tables and microphone privacy are unchanged. The only database changes are the
production Host's own activity (55 events and its provider refresh). The audio endpoint list hash returned to its
long-standing baseline (a device presence/status change, reported, not caused).

## 6. Limitations introduced or kept by this patch

- **L-RECONCILE-UI (new): no reconcile control in the Island.** The UI shows "Outcome uncertain — reconciliation
  required", but the decision itself is a workstation Host command:
  - `task.reconcile` takes `retry` or `close`.
  - `mission.reconcile` takes `retry` or `stop`.

  No Island button was added, because this patch changes no UI layout (§5 preservation). A reconcile control belongs
  to the next UI/UX milestone, which needs the owner's authorisation.
- **L-PAUSE-COST (new, by design): every started write that fails now stops for the owner.** This covers a test
  command that exits non-zero, a provider crash after dispatch, and a failed Bunny-A check of write work. Each one now
  waits for reconciliation instead of retrying or failing outright. This is the owner's policy (rows 2, 3 and 6). The
  cost is more owner decisions on everyday failures, such as a failing `npm test` worker.
- **~~L-SKILL-ASK~~ (round 3 P1): closed.** A skill now settles every step's permission before running any step.
- **L-TEAM-REWORK (round 3 P3/P4, documented).** After a restart, a guarded team write is retried by `teamWrite`
  without a visible reconcile prompt. That is safe, because the pre-image guard refuses unless the file holds this
  Mission's own last verified bytes. In the primary failed-check case, the guard also holds the rework replica rather
  than writing it. `teamWrite` itself is unchanged by N-C.
- **L-SURVIVOR-LAUNCH (round 2/3 F7, documented).** Launch-time `restartSurvivorRefusal` matches interrupted sessions
  by owner, so an unreadable record (which names no owner) does not hold an unrelated launch (T9R-F04 design). Both
  reconcile retries (direct and Mission) wait for unreadable records.
- **L-AUDIT-COUPLING (final check, documented).** If recording a skill's preflight `authorization.required` event
  fails, the Host takes the same fatal containment path that `request()` already takes for the same event. This is an
  availability coupling, not an authority change.
- **L-DEDUP-ATTRIBUTION (review F14, documented).** A guarded `filesystem.write` whose file already holds exactly the
  intended bytes reports "Already applied (from an earlier attempt or another writer)". It does not claim it wrote
  them. This applies even when the guard was `absent`. The bytes are correct; only the attribution is shared.
- **Kept from Gate J:** L-LIVE, L-PKG-NPM, L-RETRY-ACCESS (N8), L-STEER, L-VOICE, L-PLAN, L-FAIR, L-COST, L-PERF,
  L-HARNESS and L-CONSOLE are unchanged. **L-RETRY-SAME is closed by this patch.**

## 7. Untested external and hardware behaviour

- **No live provider.** No live provider inference ran. Every provider attempt is a scripted adapter or a real local
  process (`node -e`). No real Codex, Claude or Ollama session was interrupted mid-write.
- **No real external writes.** No real external API, deployment or SaaS write was exercised. The bus rule is generic,
  so any started capability that fails without a no-effect certificate is uncertain, but only `filesystem.write` and
  `terminal.exec`-shaped failures were driven in tests.
- **No real Windows job crash.** A real Windows job whose launch throws after the root process starts was not
  reproduced (review F8, repaired by reading only). The adapter certifies `dispatched:false` only before
  `launched:true` is recorded.
- **Owner reconciliation in the Island not exercised.** No Island control exists (L-RECONCILE-UI). Reconciliation was
  exercised only through the Host route in tests.
- **Native Notch style receipts not re-run.** The patch changes no character style, voice, Notch or CSS file. Its UI
  change is the "Outcome uncertain — reconciliation required" text in three existing elements (`task.tsx` error card
  title, an `agentic.tsx` step `<small>`, and `mission-model.ts` step activity), covered by the UI suite (380/380). No
  browser console check was run (L-CONSOLE).
- **Phone surface not tested.** The paired phone was not used. Device refusal of `mission.reconcile` and
  `task.reconcile` is proven against the Host route with a device identity, not a real phone.
