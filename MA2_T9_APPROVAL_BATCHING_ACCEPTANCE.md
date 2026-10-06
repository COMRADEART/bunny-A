# M-A-2 Gate T9

**BUNNY_MA2_T9_PASS — staged acceptance only, 2026-10-06.** One deliberate approval
authorizes a finite set of known Calculator arithmetic operations. Scope escape still asks
before mutation. Production remains Bunny-A-Windows-v17-T6. T10 is open and was not started;
no full M-A-2 operational verdict is issued.

Evidence root: `test-results/ma2-gate9/`. The final source is `445beebf8c9d951066dd0bddb1b066820762a912`.
Current records use the `v20-` prefix. Older records, failed trials and original designs are
retained as historical evidence and do not define the final policy.

## Baseline

T1–T8 are accepted. T7 closed at `c126e7f`, T8 at `abe993a`. T8 was acceptance-only;
no v17-T8 was manufactured. Verified floor: **592 = 247 script + 311 application + 34 UI**
(`baseline.json` and baseline logs). This continuation began at `e550ed0` with the partial
T9 implementation, 616 tests and an edited acceptance draft. The original draft and policy
are preserved in the evidence root. Unrelated user files were left alone.

Final unchanged inventory: **624 = 247 script + 340 application + 37 UI**, zero failures,
skips or cancellations in the successful complete run. The focused T9 suite has 26 tests,
including eight new admission/race/scope tests. No test was deleted.

## Previous approval behavior

`current-approval-model.md` records the source model before T9 at `abe993a`.
Allow once covers one capability invocation; for a skill step, the existing label is
Allow this skill run and covers matching actions during that run within approved roots.
There is no persistent Allow for task/skill option. Mission envelopes, persistent
capability_grants and direct/delegated Task permissions retain their existing meanings.
Desktop mutations in the test envelope previously asked for each invocation.

## New bounded policy

MissionManager derives the offer from concrete planned/expanded skill operations. The user
must explicitly select the secondary batch choice. Allow once remains primary and Deny
remains available. No global preference or new permanent-trust option is introduced.

Only Microsoft Calculator arithmetic is eligible: open Calculator, focus its window,
invoke known arithmetic AutomationIds, and read its dedicated result control. Arbitrary
typing, generic screen/control reads and every other application remain outside this batch.
Eligibility also requires implemented, non-sensitive, non-hardApproval manifests and the
existing escalation-aware risk model. The ceiling is EXECUTE, with no external effects.

Budget is `min(2 × known mutations, 12)`, TTL is 120,000 ms. Clients may only shrink either
bound. An admitted mutation consumes one slot even on failure; a retry consumes another
slot and retains the existing retry cap. READ results and UI refreshes consume no slots.

Each exact action/parameter digest is bound to its planned step, Mission and authorization
envelope. The Host revalidates the offer on response and policy again after asynchronous
preflight. The existing permission engine remains authoritative: no deny or standing
ask_every_time rule can be overridden. See `policy-design.md` for the complete contract.

## Security invariants

| Boundary | Final enforcement |
|---|---|
| Authority | Host records only; no renderer flag, model claim or provider identity grants access |
| Scope | Exact Mission/envelope/own step and concrete operation digest; no child/delegated inheritance |
| Target | Installed Microsoft Calculator package/executable, native handle, frame PID/process lifetime and content/control ownership |
| Admission | Canonical Stop, envelope, epoch, time, risk and count rechecked after preflight; guarded count update |
| Mutation | Runtime repeats window/package/control checks immediately before acting; invocation requires foreground and InvokePattern |
| Exclusions | Shell, Browser Runtime, files, Git, clipboard, uploads, installs, payments, secrets, security changes and external effects inherit nothing |
| Lifetime | Stop/replan/mission end/revoke/expiry/exhaustion/restart end authority; stale responses refuse |
| Truth | Canonical count, accurate TTL, no approval-implies-safety or approval-implies-verification claim |

Windows/UIA cannot freeze the desktop atomically. This is verified pre-admission and
mutation-time identity checking, not a claim against privileged OS compromise or every
possible UI race. Unsupported, localized or unexpected application surfaces fail closed.

## IMPLEMENTED

- Existing MissionStore gains only the additive approval_batches record and existing-event
  journaling. Persistent capability_grants cannot represent finite atomic consumption;
  no second database, engine or desktop authorization service was created.
- Original T9 schema/marker, lifecycle, command, UI and label changes remain. The admission
  review adds exact operation digests and native window identity in existing JSON, without
  another migration or schema version change.
- Capability Bus performs verified Runtime preflight and canonical race revalidation before
  consumption. Computer Runtime verifies the Microsoft package/content executable; title
  alone and shared ApplicationFrameHost PID are insufficient authority.
- Dedicated `computer.read_calculator` reads the verified result only. All arbitrary typing
  is outside batch policy. Mission renderer responses redact typed input and secret-key
  fields, while the Host preserves canonical execution input for an explicit Allow once.
- The shared dashboard/companion card states application, action classes, maximum, TTL,
  risk ceiling and no external effects; it shows canonical usage and explicit Revoke.

## LIVE VERIFIED

All rows ran against the exact **installed v20-T9** release with disposable production DB
copy, separate workspace, token, port and startup directory. No production mutation or
public tunnel was used. Test mission titles and harness filenames retain the earlier
"v18" label; record/manifest identities establish the actual v20 release.

| Check | Result | Evidence |
|---|---|---|
| A: Allow once preserved | 7 prompts, 7 mutations, 1 result read; no batch | `v20-A-live.json` |
| B: explicit Calculator batch | 1 prompt, 7 mutations, 1 free read; result 5; complete | `v20-B-live.json` |
| C: second application | Notepad focus asks; zero foreign mutation | `v20-C-live.json` |
| D: high risk | Destructive filesystem probe asks; never executed | `v20-D-live.json` |
| E: finite count | Limit 2, exactly 2 admissions, next asks | `v20-E-live.json` |
| F: expiry | 1-second test grant expires on Host time; next asks and expiry journals | `v20-F-live.json` |
| G: Stop/replay | Future actions stop, unrelated mission survives, old approval refuses | `v20-G-live.json` |
| G2: Stop in execution | Owned invocation aborted, count stops at 3, no later admission; unrelated work survives | `v20-G2-live.json` |
| H: concurrent scope | Mission B has zero inherited admissions from A and asks independently | `v20-H-live.json` |
| S: sensitive input | Separate ask, no batch offer, no typed probe | `v20-S-live.json` |
| I: UI/companion | Desktop/mobile/dedicated companion cards inspected; explicit approval, reload preserves 2/6, UI Stop ends grant | `v20-I-live.json`, `v20-ui-live.json`, screenshots |
| J: paired device | Same Host envelope, oversized knobs clamped, device recorded, revoke ends grant, revoked token returns 401 | `v20-J-live.json` |
| Restart/crash | New installed Host instance; old grant ends host_restart, no GUI replay, paused approval preserved, old response refuses | `v20-R0-live.json`, `v20-R1-live.json`, `v20-R-live.json` |

## SIMULATED

26 focused tests use deterministic adapters to exercise exact-title foreign windows, lookalike
titles, altered selectors/extra fields, changed plans, borrowed Mission/envelope/step IDs,
shell/browser/files/Git exclusions, risk escalation, bounded retries, provider-origin reroute,
forged UI claims, Stop/expiry during preflight, no duplicate consumption, ask_every_time
changes, restart epoch, remote clamping/revoke and redacted snapshots. These are simulations,
not claims of live UAC/payment dialogs or live provider rerouting.

## STATIC VERIFIED

| Gate | Result | Evidence |
|---|---|---|
| Focused T9 | 26 pass | `t9-privacy-focused.log` |
| Complete regression | 247 scripts + 340 app + 37 UI = 624 pass; unchanged inventory | `t9-v20-full-sequential.log`, `t9-v20-ui.log` |
| Typecheck | exit 0 | `t9-privacy-typecheck-recheck.log` |
| Lint | exit 0, 0 errors, 11 existing warnings | `t9-v20-lint.log` |
| Exact-source Windows/dashboard build | exit 0 | `t9-v20-windows-build.log` |
| Package/installed integrity | 158 files match, no missing/extra/changed; exact source/tooling blobs and closure pass | `v20-candidate-package.json` |
| Dashboard render | Desktop 1280×800/mobile 390×844, content visible, no overflow or console/page errors; screenshots inspected | `v20-staged-offer-render.log`, screenshot verdict/cards |
| T1–T8 preservation | Existing regression unchanged; production config/credentials identical, state outside Git, v17-T6 integrity 156/156, rollback material retained | `final-production.json` |
| Journal/privacy | Canonical consumption matches journal, consumed precedes exhausted; input probe absent | `v20-journal.json`, `v20-privacy.json` |

Earlier dev and generic built-output renders also passed content/console checks. Generic
preview lacked installed Host bridge configuration and differed from dev text; it is not
claimed as installed approval acceptance. The exact installed dashboard above is the
authoritative final build render.

Two default concurrent test-file runs hit EPERM while deleting a T4 fixture after ownership
assertions passed. The unchanged test passed in isolation and the complete unchanged inventory
passed sequentially with zero skipped tests. This is a retained test-harness cleanup limitation,
not a weakened assertion or changed T4 runtime (`t9-v20-full*.log`, isolated T4 log).

## NOT TESTED

Physical Android/iPhone, public tunnel delivery, actual sign-out/reboot in T9, multiple
monitors, localized Calculator variants, live UAC/purchase/file-picker dialogs, privileged
OS attack, live model/vision rerouting and production activation. Prior accepted T1–T8
evidence remains prior evidence; it was not recreated wholesale in T9.

## BLOCKED

None for T9 staged acceptance. No unresolved BLOCKER or HIGH. Windows concurrent fixture
cleanup remains a low test-harness limitation; its unchanged full inventory passed sequentially.

## DEFERRED

Production activation requires separate explicit authorization and a fresh production backup
under the accepted activation procedure. No activation or backup-for-activation was performed.
Persistent application preferences, broader desktop profiles, OD-1/OCT-1 research and T10 are
outside this run. NEXT = T10, not begun.

## Positive batch workflow

Open/focus Calculator → Clear → 2 → Plus → 3 → Equals → Read result. One explicit batch
approval covered seven mutations and returned **5**. Planned count and retry headroom remain
distinct: budget 12, TTL 2 minutes, seven slots used. Completion ends authority; the result
read costs no slot. The UI still says capability completion is separate from independent
verification; no independent check was fabricated for this calculation.

## Scope escape tests

Live Notepad focus and destructive filesystem probes pause before any broader effect.
Sensitive input has no batch offer and was never approved. Concurrent A/B missions do not
share authority. Automated foreign-window preflight rejects before mutation and consumption;
operation/selector/field changes, shell/browser routes and delegated steps ask independently.
Window title matching is supporting context only; package and native identity checks govern.

## Expiration / budget tests

Live budget 2 admits exactly two mutations, then asks. Live TTL 1,000 ms expires using Host
time and emits expiration before the next request. Automated Stop/expiry preflight races admit
nothing; retries each consume a bounded slot. UI countdown is display only. Canonical count
is the Host row and guarded update, reconciled against consumption events.

## Stop / restart behavior

Stop during an actual running invocation aborted owned execution; the settled run is failed
with cancellation, not late success. Three admitted slots remain consumed, no further action
starts, and unrelated work stays awaiting approval. UI Stop likewise ends the 2/6 batch.

The crash test kills only the staged Host after fresh credential/instance/executable/entry
corroboration. Its installed launcher verifies and restarts the release. The active batch ends
host_restart and the per-boot epoch independently invalidates old grants. No pending mutation
replays. T3 only interrupts executing steps; an already approval-paused step remains paused.
Stale resolved approval replay and batch approval on the sensitive pending request refuse.
No by-name kill or production process stop was introduced.

## Remote approval behavior

An actual paired disposable device used the same Host command path and could not expand
budget/TTL. Its actor ID is recorded; explicit batch revoke ended authority and device revoke
made subsequent approval return 401. The dedicated companion view uses the same card and
canonical count as desktop. This was loopback transport/browser emulation, not physical phone
or public tunnel acceptance. T6 authentication/routing remain unchanged.

## Privacy

Input probe was never typed. One full renderer snapshot, 13 mission detail responses, 124
permission requests, 342 capability runs, 54 batches and 255 batch events were scanned;
the probe was absent. Visible cards/activity contain no input values or raw selectors.
Runs use character-count text redaction; renderer mission/detail responses now do the same
and redact secret-key parameters. The private Host execution plan retains original input
for an explicitly authorized invocation. No claim is made that every private execution input
is absent from canonical storage. Credentials and pair codes are excluded from evidence.

## UX impact

Prompts fell **7 → 1 (85.7%)** for the same calculation. Observed automation times were
**8,143 ms Allow once** and **15,836 ms batch**. The harness answers prompts immediately;
these are execution measurements, not human decision time. Verified package/window checks
add overhead. T9 reduces repeated approval burden; it does not claim a speed improvement.

## Candidate identity

| Identity | Value |
|---|---|
| Release | Bunny-A-Windows-v20-T9 / 20.0.0-T9 |
| Source | `445beebf8c9d951066dd0bddb1b066820762a912` |
| Tooling | `824a5531ff6c04936f9511ba63c1120e65695d42` |
| ZIP SHA-256 | `3fdbad67b21ed9bccbabad514756f0d0cb9ca8363c00f38bb61850c29b922a44` |
| Manifest SHA-256 | `92c60012cca09d95f1c85b7a2373caf52297fc7cc3a50c30a3d49b979e44148a` |
| Dashboard asset SHA-256 | `93183a204a27a0ecec1f4f34444231039d9c1512efc7390f02271ca31ce95171` (21 assets) |

`v20-candidate-package.json` includes recomputed sidecar, file, source-blob, import-closure
and installed-copy verification. Packaging used committed archives, never dirty working-tree
source. Earlier v17-T9/r2/v18/v19 candidates remain intact; v20 is the sole accepted final
candidate. Staging is outside Git in Bunny-A-T9-stage with Bunny-Workspace-T9-stage and its
own token/startup directory. No second production auto-start mechanism was created.

## Final production state

**Bunny-A-Windows-v17-T6 remains healthy and selected**, source
`cb005ef75bf86d4d9e722b5214612fe115db5c6b`, manifest
`f5bf648c92711baba3fe4a24ea46c449fd8f226c0afa018f8f9cf93da52fde88`.
All 156 installed files match. install.json, deployment, state marker and credential file
hashes equal the pre-staging baseline. Workspace remains Bunny-Workspace; state stays outside
Git. Read-only production DB check: integrity ok, version 3, no T9 table, zero computer runs
and zero permission requests. Ordinary production telemetry may append; whole-SQLite byte
parity is not claimed. Existing T8 rollback material remains. Candidate is staged only.

## Final verdict

**BUNNY_MA2_T9_PASS.** Explicit finite Calculator authority reduces repeated prompts while
scope escapes, budget, expiry, Stop, restart, replay, remote identity, privacy and verification
boundaries hold. No full M-A-2 verdict. **T10 remains open and was not started.**
