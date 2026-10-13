import {readFileSync,writeFileSync} from 'node:fs';
const root='test-results/ma2-gate9r/';
const pkg=JSON.parse(readFileSync(root+'candidate-package.json','utf8'));
const text=`# M-A-2 Gate T9R

## Incident

T9 was reopened after approximately 10–12 visible Calculator windows were reported during or after the original live matrix. This narrow remediation closes the duplicate-target incident only. T10 was not started; no full M-A-2 operational verdict is issued. All evidence is under \`test-results/ma2-gate9r/\`, indexed by SHA-256 in \`evidence/index.json\`.

## Initial observation

Before any product edit, the captured repository HEAD was \`6d0c010dfd5d39b1b50c5cb35b8f6e3f83fea5d4\`; the discovered regression floor was **624 = 247 script + 340 application + 37 UI**. Initial T9R read-only native inventory found zero Calculator windows. Historical hygiene evidence captured seven windows; the exact user-observed 10–12 HWNDs were not recorded at observation time. We do not reconstruct invented identities or equate launcher/process count with visible-window count.

## Root cause

The historical staged journal has **68 successful explicit Calculator launch calls**: 60 independent Missions, one launch each, plus eight direct probes without Mission/Task IDs. Permission/scheduler attempt entries are not additional launch runs. The final v19/v20 harness omitted per-target cleanup. Older title/PID and title-only WM_CLOSE hygiene was insufficient for shared UWP frames and is retired.

The old Runtime separately had a real lifecycle defect: it unconditionally started Calculator on each admitted \`computer.open_app\`. Before source changes, one v20 Mission, one explicit bounded grant and two acquisition steps produced **two verified visible targets**. Both fresh test-owned windows were safely closed. That establishes product duplication without claiming it caused the original historical cluster. See \`root-cause.md\`, \`reproduction.json\` and \`launch-lineage.json\`.

## Classification

**C. MIXED** — independent harness accumulation plus a live-reproduced same-workflow product defect. The primary cause is established; it is not UNRESOLVED. The missing original one-to-one HWND mapping remains a stated historical evidence limit.

## Launch lineage

\`launch-lineage.json\` preserves the original 68 captured run IDs and maps timestamps, Mission/step IDs, grant/request IDs where available, launch summaries, later batch window identities with provenance, test labels and results. \`current-acquisition-lineage.json\` records staged T9R acquisition/reuse decisions and exact native identities. Deterministic capability steps have no child Task ID: the logical Mission workflow is their canonical target owner. Launcher PID is evidence only; UWP frame/content identity authorizes validation.

## Product changes

Source \`${pkg.sourceCommit}\` adds the smallest Runtime lifecycle layer: a verified Calculator target keyed to each logical workflow; a small acquisition mutex; revalidation before reuse; a persisted acquisition-in-progress marker that prevents uncertain launch outcomes from causing blind repeated spawning; and one controlled replacement after the old target is proven invalid. A unique verified existing application can be acquired. Ambiguous or unready identity fails closed. Loss after batch admission cannot create a replacement under that binding.

Native checks associate HWND, frame PID/start time, arithmetic UIA subtree, content PID/start time and signed Microsoft Calculator package/executable. Title is a discovery hint only. Focus checks the actual foreground HWND. Later ordinary Calculator actions and retries use the canonical identity; unrelated generic computer actions do not get redirected to Calculator. Open now binds the actual validated target rather than treating its short-lived launcher PID as authority.

Identity is stored in existing private Host settings and carries **no approval or destructive cleanup authority**. No new scheduler, global trust, SQL schema, permission class, rollback behavior or broader desktop profile was introduced. The product does not close application windows.

## Harness changes

The replacement sequential matrix inventories before/after each phase, records exact acquisition provenance and closes only disposable windows it explicitly created. Historical evidence and failures are retained. Terminal Missions are settled without issuing invalid Stop commands. One-second expiry inside an admitted native probe is recorded as a contained failure requiring explicit retry, rather than assuming automatic resume. Windows PowerShell 5.1 exercises the accepted launcher; installer marker/startup preparation issues and the initial PowerShell 7 launcher mismatch are retained as setup failures.

Focus-loss preparation explicitly minimizes its freshly verified owned fixture. Minimized UWP hides its arithmetic subtree, so native readiness pauses before action. The controller restores only that owned HWND after fresh frame/content/process/package checks, revalidates the UIA association and grants the new request explicitly. Earlier foreground-assumption, minimized-fixture cleanup refusal and null-vs-undefined boundary assertions are retained; guarded recovery and corrected tests pass. Cleanup refusal was preserved, never weakened.

## Ownership rules

Cleanup requires test-created provenance, fresh HWND/frame/content lifetime, current Microsoft package identity and a current UIA window close pattern. Pre-existing handles, unknown targets, reused PIDs/handles or ambiguous identity cannot be closed. No name-only termination, title-only sweep or process-wide Calculator kill occurs. The staged Host crash and temporary QA gateway shutdown independently require fresh executable, entry, live identity/credentials where applicable, CIM creation time and a held native process handle. Production is never stopped.

## Same-Task reuse

Five live acquisitions in one Mission yield one launch and the same canonical target. Ten repeated unit acquisitions and twelve simultaneous unit calls also yield one launch. The positive arithmetic sequence performs eleven eligible mutations and one free result read under one explicit workflow batch: **137 + 265 = 402**, one visible target, stable native identity. A separate explicitly approved fixture setup acquired and foregrounded the target first; its grant ended before the positive workflow. The tested workflow reused it with zero extra launches. The setup approval is not hidden in the one-prompt claim.

## Retry behavior

A real Calculator result read intentionally failed its \`file_exists\` postcondition. The controller supplied the harmless marker only after observing the actual bounded retry. Two reads, one retry, one target launch; identity stayed stable. Failed control retry coverage also proves no application-launch preamble. Focus readiness pauses and explicit retry after contained expiry do not duplicate windows.

## Concurrent acquisition

Two near-simultaneous acquisition steps in one Mission converge on one verified target and one launch. Two already-pending requests were explicitly resolved (batch plus Allow once); this race case is not represented as the one-prompt positive case. Unrelated Task B has zero runs and no canonical record before its own approval, then intentionally shares the unique physical application window with a separate target record and grant. Task B's record does not claim creation ownership. There is no universal single-instance or cross-Task authority guarantee.

## Stop behavior

Stop at a sensitive approval pause ends the grant, refuses replay and produces no future actions or launches. Unrelated pending work survives with zero unauthorized runs. The harness separately closes the disposable owned window; stopping a workflow does not close a user's application.

## Expiration / budget behavior

Two admitted slots exhaust the budget and the next action asks again without launching. Fresh approval reuses the valid target. The one-second expiry probe expires during native checking and fails safely; explicit Mission retry obtains fresh approval and reuses the same target. READ stays quota-free. Admission events sum exactly to canonical used counts; all batches remain within the accepted twelve-action ceiling. Grant events alone never create an application.

## Pre-existing user window behavior

QA manually prepared Calculator **outside Bunny Runtime** before the tested workflow using the trusted Windows launcher once. The initial machine had no actual user Calculator. The new workflow focused/reused that verified existing window, marked its canonical record \`createdByBunny: false\`, made no arithmetic changes, retained display 0 and the original native identity, and did not close it. This controlled user-window fixture is intentionally left open. No claim is made that a human's previously open private Calculator was present at baseline.

## Cleanup behavior

Every disposable phase settles its own Mission and closes only its fresh owned identity. The old reproducer's two targets were also closed individually. Final inventory: **one verified visible window**, fully attributable to the intentionally retained pre-existing fixture; **zero unexplained Bunny-created windows**. \`cleanup-live.json\` links every current close record. The retained window is excluded from cleanup.

## T9 security invariant preservation

All accepted T9 tests remain. Exact operation digests, envelope, risk ceiling, short Host TTL, finite count, application binding, Stop/replan/restart revocation, separate sensitive/high-risk approval, shell and Browser Runtime exclusions, privacy and independent verification remain canonical. Live Notepad focus requires separate approval and executes zero other-app runs. Live sensitive typing remains pending and unexecuted. Task B does not inherit A's grant. Public renderer/detail/run/request/batch/event scans contain no typed probe; original private execution input remains Host-owned. Persisted target identity never revives an ephemeral grant.

## Focused tests

**47 pass**: 26 unchanged accepted T9 tests, 17 target-lifecycle tests and four fresh-ownership harness tests. Cases cover repeated/concurrent reuse, action failure/retry, stale lifetime, uncertain launch recovery, ambiguity, abort before launch, restart revalidation, independent records, package/native checks, cleanup preservation and target loss after admission. No accepted assertion was removed or weakened.

## Full regression

**645 pass = 251 script + 357 application + 37 UI**, an increase of 21 over the recorded 624 floor. Zero failures, skips or cancellations. Complete current file inventory ran with test-file concurrency one to avoid the previously accepted T4 temporary cleanup race; the tests themselves are unchanged. Typecheck, lint, ownership build and exact committed Windows archive/dashboard/package build pass. Lint retains eleven existing warnings and zero errors. Packaged and installed integrity, source blob checks and import closure pass.

## LIVE VERIFIED

Old duplicate reproduction; five repeated acquisitions; real read postcondition retry; concurrent same-workflow acquisition; independent second workflow; 402 arithmetic result; controlled stale replacement; Stop/isolation; budget and expiry transitions; staged Host restart with no GUI replay and same-Mission replan requiring fresh approval; actual dashboard reload with unchanged one run and 1/4 used; focus-loss readiness pause and approved recovery; other-application boundary; manually prepared pre-existing target preserved; complete final owned cleanup inventory. Exact installed dashboard renders on desktop 1280×800 and mobile 390×844, with visible content, no overflow and zero console/page errors; both screenshots were visually inspected.

## SIMULATED

Unit driver races, twelve concurrent calls, ten repeated acquires, lifetime reuse, ambiguous existing targets, uncertain launch outcomes, queued abort, new Host storage revalidation and loss after admission; accepted T9 shell/Browser Runtime/high-risk and operation-digest security regressions. These are not represented as live privileged OS attacks.

## STATIC VERIFIED

Source/import closure, exact source/tooling archive, package hashes and 159/159 installed files; regression/typecheck/lint/build logs; no destructive Calculator product cleanup; fresh native identity/package validation; original T1–T9 tests retained; protected production configuration/credential hashes and Startup shortcut bytes unchanged. Bundled Chromium was absent; the same repository smoke runner passed using installed Microsoft Edge. Its generic custom-card note is outside this unchanged native utility's remediation scope.

## NOT TESTED

Retroactive individual identities of the user's original 10–12-window observation; physical phone/tunnel, localized Calculator, multi-monitor surfaces, real UAC/purchase/file-picker dialogs, privileged OS attacks, provider/vision reroutes and a universal OS single-instance guarantee. A human's original private Calculator was absent; a manually prepared external fixture proves preservation. Native checks precede each operation but are not an atomic lock over external user desktop changes. No production activation was performed.

## BLOCKED

No unresolved BLOCKER/HIGH remains from this incident. Production activation is outside the authorization of this staged T9R request; it requires its own authorized activation procedure and fresh backup. T10 was blocked while T9R was open and remains **not started** in this run.

## Candidate identity

Candidate **${pkg.release}**, repository-consistent vN-T9 naming (not T10), source \`${pkg.sourceCommit}\`, tooling \`${pkg.toolingCommit}\`. ZIP SHA-256 \`${pkg.package.sha256}\`; manifest \`${pkg.manifest.sha256}\`; dashboard asset identity \`${pkg.dashboard.assetManifestSha256}\`. Exact committed build, import closure and installed 159-file verification are recorded in \`candidate-package.json\`. Earlier candidates remain immutable.

## Production state

Production remains **Bunny-A-Windows-v17-T6**, healthy and unchanged in protected configuration, credential, selected release and Startup identity. Installed production integrity is 156/156, read-only SQLite quick_check is ok, schema version 3, no T9 batch table, no computer capability runs and no permission requests. Ordinary live telemetry can append: SQLite byte parity is not claimed. Existing accepted T8 rollback material remains. No new activation backup was created because activation was neither authorized nor performed.

T9R uses its own disposable DB copy, state root, workspace, token, startup directory and Host port 45119; QA dashboard is loopback-only 8087 with no remote/tunnel. Production 43119 and the old T9 stage 44119 remain separate. Tokens and private databases are excluded from evidence.

## Final verdict

**BUNNY_MA2_T9R_PASS**. Classification **MIXED**; idempotent acquisition and owned-only cleanup proven; zero unexplained windows; 645 regression tests and all required gates pass. This supersedes the original T9 permanent-closure claim for this incident. No full M-A-2 operational verdict and no T10 work are claimed.
`;
writeFileSync('MA2_T9R_DUPLICATE_CALCULATOR_CLOSURE.md',text);
const notice='> Current T9 status (2026-10-06): the duplicate Calculator incident was reopened and remediated in T9R. **BUNNY_MA2_T9R_PASS**, classification **MIXED**. Current staged candidate is v21-T9; production remains v17-T6. See [T9R closure](MA2_T9R_DUPLICATE_CALCULATOR_CLOSURE.md). Earlier T9 results below are historical. T10 was not started.\n\n';
const append=`\n\n# M-A-2 Gate T9R — duplicate Calculator closure\n\n**BUNNY_MA2_T9R_PASS (2026-10-06), classification MIXED.** The original 68 launch calls came from 60 independent Missions and eight direct probes; final historical harness cleanup was omitted. A separate pre-change live reproduction proved two acquisitions under one v20 workflow/grant could create two visible windows. The current Runtime validates and reuses a per-workflow native Calculator target, serializes acquisition and refuses blind spawning after an uncertain launch. Persisted identity carries no permission or cleanup authority.\n\nLive repeated acquisition, postcondition retry, concurrency, fresh second-Task approval, result **402**, stale replacement, focus pause/recovery, Stop, expiry/budget, restart/replan, dashboard reload and pre-existing-window preservation pass. Final inventory is one intentionally retained manually prepared external fixture and zero unexplained windows. Independent Tasks may intentionally share the verified physical application only after separate authorization.\n\n**645 tests pass (251 script + 357 app + 37 UI), focused 47; typecheck/lint/build/Windows package checks pass.** All existing T1–T9 tests remain; eleven existing lint warnings. Candidate **${pkg.release}**, source \`${pkg.sourceCommit}\`, tooling \`${pkg.toolingCommit}\`, manifest \`${pkg.manifest.sha256}\`; 159/159 installed files and exact archive/import closure verified. Production remains healthy **v17-T6**, 156/156 integrity, protected files/Startup unchanged, no T9 schema or desktop approval writes. No activation or T10 work.\n\nFull scope, limits, ownership rules and evidence: [T9R closure](MA2_T9R_DUPLICATE_CALCULATOR_CLOSURE.md), \`test-results/ma2-gate9r/final-verdict.json\`, \`candidate-package.json\` and \`evidence/index.json\`. Historical exact 10–12 HWND lineage is unavailable and is not invented. This is the implementer's review packet; no new independent-review verdict is claimed.\n`;
for(const name of ['MA2_T9_APPROVAL_BATCHING_ACCEPTANCE.md','MA2_ACCEPTANCE_MATRIX.md','MA2_IMPLEMENTATION_REPORT.md','MA2_INDEPENDENT_REVIEW_PACKET.md']){
  const current=readFileSync(name,'utf8');if(current.includes(notice))throw Error('T9R docs already written; edit in place instead');writeFileSync(name,notice+current+append);
}
console.log('Five required T9R documents written.');
