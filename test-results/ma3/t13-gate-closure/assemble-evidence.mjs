import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
const evidence = import.meta.dirname;
const root = resolve(evidence, '../../..');
const load = name => JSON.parse(readFileSync(join(evidence, name), 'utf8'));
const put = (name, body) => writeFileSync(join(evidence, name), body.trim() + '\n');
const json = (name, value) => put(name, JSON.stringify(value, null, 2));
const sha = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const before = load('workspace-before.json');
const full = load('test-final-result.json');
const first = load('test-result.json');
const ui = load('ui-result.json');
const build = load('build-result.json');
const typecheck = load('typecheck-result.json');
const auth = load('auth-final-result.json');
const env = load('android-environment.json');
const transport = load('transport-probe.json');
const pairing = load('pairing-security.json');
const preservation = load('workspace-preservation.json');
const installed = load('installed-release-observation.json');
const log = readFileSync(join(evidence, full.log), 'utf8');
const summaries = [...log.matchAll(/ℹ tests (\d+)\r?\nℹ suites (\d+)\r?\nℹ pass (\d+)\r?\nℹ fail (\d+)\r?\nℹ cancelled (\d+)\r?\nℹ skipped (\d+)\r?\nℹ todo (\d+)/g)].map((m, i) => ({ lane: ['scripts','library','agent runtime'][i] ?? `lane ${i+1}`, tests: +m[1], pass: +m[3], fail: +m[4], cancelled: +m[5], skipped: +m[6], todo: +m[7] }));
const currentSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
if (currentSha !== before.startingSha) throw new Error('Unexpected original source HEAD changed before evidence commit.');
if (full.exitCode !== 0 || summaries.length !== 3 || summaries.some(s => s.fail || s.cancelled || s.skipped || s.todo)) throw new Error('Full pipeline is not a clean three-lane pass; do not generate passing acceptance.');
if (![ui,build,typecheck,auth].every(r => r.exitCode === 0) || !pairing.passed || !transport.pass || !preservation.pass) throw new Error('Required executable validation did not pass.');
const browserDir = join(evidence, 'browser');
mkdirSync(browserDir, { recursive: true });
for (const name of ['t13-gate-closure-dev.png','t13-gate-closure-dev-mobile.png','t13-gate-closure-dev.json','t13-gate-closure-built.png','t13-gate-closure-built-mobile.png','t13-gate-closure-built.json']) copyFileSync(join(root, 'screenshots', name), join(browserDir, name));
const dev = JSON.parse(readFileSync(join(browserDir, 't13-gate-closure-dev.json'), 'utf8'));
const built = JSON.parse(readFileSync(join(browserDir, 't13-gate-closure-built.json'), 'utf8'));
if (built.divergesFromBaseline || [dev,built].some(v => Object.values(v.viewports).some(p => p.status !== 200 || p.horizontalOverflow || p.consoleErrors.length || p.pageErrors.length))) throw new Error('Browser evidence does not pass.');
const table = summaries.map(row => `| ${row.lane} | ${row.tests} | ${row.pass} | ${row.fail} | ${row.skipped} |`).join('\n');
const total = summaries.reduce((n,row)=>n+row.tests,0);
json('suite-summary.json', { sourceSha: before.startingSha, command: full.command, exitCode: full.exitCode, lanes: summaries, pipelineTests: total, separateUiTests: 405, fullPipelineIncludesOAuthPkce: true, duplicateFocusedTestsAddedToPipelineCount: false });
const oldReceipt = 'test-results/ma3/t9r/remote-canonical/cross-project-artifact.json';
json('receipt-investigation.json', {
  affectedPath: join(root, oldReceipt), testDeclaration: 'src/lib/bunny-host/remote-remediation.test.ts:391', receiptCall: 'src/lib/bunny-host/remote-remediation.test.ts:410', writer: 'src/lib/bunny-host/remote-remediation.test.ts:20-23', operation: 'writeFileSync; default open flag w (create/truncate); JSON plus newline',
  historicalRecord: 'test-results/ma3/t13-final-hw/ACCEPTANCE.md', historicalErrorAsRetained: 'UNKNOWN ... open cross-project-artifact.json', fullHistoricalStderrAvailable: false, osHandleTraceAvailable: false,
  observations: { fixedSharedReceiptPath: true, inPipelineTestFileConcurrency: 1, secondWriterToThisNameFoundInCurrentSource: false, readonlyAttributeObserved: false, originalReceiptHashAtStart: before.entries.find(row=>row.path===oldReceipt)?.sha256, originalReceiptHashAfter: sha(join(root,oldReceipt)), originalReceiptPreserved: before.entries.find(row=>row.path===oldReceipt)?.sha256 === sha(join(root,oldReceipt)) },
  causeClassification: 'Historical Windows open failure, not reproduced; specific contention/permissions/stale-handle cause UNPROVEN. Shared output path is a confirmed isolation hazard, not proof of the original lock mechanism.',
  reproduction: { command: full.command, sourceSha: before.startingSha, isolation: 'separate checkout and receipt files; sequential pipeline; no historical evidence overwrite', pipelineExitCode: full.exitCode, matchingTestLogLine: log.split(/\r?\n/).find(line=>line.includes('✔ T9R cross-Project artifact:')) }, sourceRepairApplied: false
});
json('environment-correction.json', { firstAttempt: { command: first.command, exitCode: first.exitCode, log: first.log, failedTest: 'scripts/bunny-release.test.mjs:44 (assertion at :59)', error: 'Node runtime license unavailable; package must not ship without it.' }, correction: 'Copied existing required local Node LICENSE into the isolated checkout, byte-for-byte; no executable/test source changes.', source: 'releases/installed/JEV-Windows-v1/runtime/LICENSE', destination: 'validation-checkout/releases/installed/JEV-Windows-v1/runtime/LICENSE', sha256: sha(join(root, 'releases/installed/JEV-Windows-v1/runtime/LICENSE')), finalAttempt: { command: full.command, exitCode: full.exitCode, log: full.log } });
const priorPaths = ['test-results/ma3/t13-final-hw/ACCEPTANCE.md','test-results/ma3/t13-final-hw/native/tab-round.json','test-results/ma3/t13-final-hw/native/narrator-tab.json','test-results/ma3/t13-final-hw/native/uia-collapsed.json','test-results/ma3/t13-final-hw/web/a11y-narrator-probe.json','test-results/ma3/t13/live-agentic/final-live/results.json'];
json('retained-evidence.json', priorPaths.map(path => ({ path, exists: existsSync(join(root,path)), ...(existsSync(join(root,path)) ? { sha256: sha(join(root,path)) } : {}) })));
const receiptDir = join(evidence, 'receipts');
mkdirSync(receiptDir, { recursive: true });
const canonical = join(evidence,'validation-checkout/test-results/ma3/t9r/remote-canonical');
const freshReceipts = [];
for (const name of readdirSync(canonical)) {
  const path = join(canonical,name);
  if (name.endsWith('.json') && statSync(path).mtimeMs >= Date.parse(full.startedAt)) {
    copyFileSync(path,join(receiptDir,name));
    freshReceipts.push({ path: `receipts/${name}`, generatedAt: statSync(path).mtime.toISOString(), sha256: sha(path) });
  }
}
json('receipt-provenance.json', { sourceSha: before.startingSha, runStartedAt: full.startedAt, freshReceipts, historicalCopiedReceiptsExcluded: true });
json('cross-surface-regression.json', {
  sourceSha: before.startingSha, executableSourceChanges: 0,
  automated: { fullPipeline: full.exitCode, ui: ui.exitCode, typecheck: typecheck.exitCode, build: build.exitCode, auth: auth.exitCode },
  browser: { dev: 'browser/t13-gate-closure-dev.json', built: 'browser/t13-gate-closure-built.json', bothViewportPairsVisuallyInspected: true, context: 'workstation browser, offline development Host, no actual phone', divergesFromBaseline: built.divergesFromBaseline },
  interactive: [
    { action: 'Click Tasks', observed: 'Tasks h1; No tasks yet h2; focus on Tasks button', passed: true },
    { action: 'From Tasks, Tab twice then Return', observed: 'Agents h1; Agents are unavailable h2; focus on Agents button', passed: true },
    { action: 'Click theme switch while Host offline', observed: 'Reconnect to the Host before changing anything. Nothing was sent.', passed: true, limit: 'offline mutation guard verified; no fresh live theme-switch claim' },
    { action: 'Click Projects', observed: 'Project page visible; Add project and Refresh projects disabled offline', passed: true }
  ],
  nativeNarrator: 'Previously verified gate retained at unchanged source; no new audible Narrator trial; original limitations retained.',
  regressionMapping: {
    islandFourEdgesAndOrdering: 'scripts/island-placement.test.mjs and scripts/island-team-chips.test.mjs in full pipeline',
    handoff: 'agent-team-handoff, team-surfaces, team-lifecycle and UI tests',
    approvalsAndBoundaries: 'remote-device, remote-remediation, cross-app and remote-authority tests',
    voice: 'script native voice-worker and library voice tests; no new human acoustic acceptance',
    themes: 'ui-theme, ui-theme-host, character appearance and UI tests; existing live evidence retained',
    providers: 'routing, routing-store, routing-matrix, model-capability and DEV-01 remote-remediation tests'
  }
});
json('command-results.json', [
  { command: 'node test-results/ma3/t13-gate-closure/run-gates.mjs prepare', exitCode: 0 },
  { command: 'node test-results/ma3/t13-gate-closure/run-gates.mjs test', nestedCommand: 'npm test', exitCode: first.exitCode, log: first.log },
  { command: 'node test-results/ma3/t13-gate-closure/run-gates.mjs test test-final', nestedCommand: 'npm test', exitCode: full.exitCode, log: full.log },
  ...[ui,typecheck,build,auth].map(r => ({ command: r.command, exitCode: r.exitCode, log: r.log })),
  { command: 'node test-results/ma3/t13-gate-closure/run-gates.mjs auth', nestedCommand: 'npm run check:auth', exitCode: 2, log: 'auth.log', limitation: 'sandbox could not reach local server; escalated rerun passed' },
  { command: './test-results/ma3/t13-gate-closure/discover-android.ps1', exitCode: 0 },
  { command: './test-results/ma3/t13-gate-closure/check-android.ps1', exitCode: 0 },
  ...load('android-checks.json'),
  { command: 'node test-results/ma3/t13-gate-closure/probe-transport.mjs', exitCode: 0 },
  { command: 'node --experimental-strip-types test-results/ma3/t13-gate-closure/check-pairing-security.mjs', exitCode: 0 },
  { command: 'node scripts/browser-smoke.mjs http://127.0.0.1:8080/ screenshots/t13-gate-closure-dev.png', cwd: 'original workspace', exitCode: 0 },
  { command: 'npm run preview:restart', cwd: 'validation-checkout', exitCode: 0 },
  { command: 'node scripts/browser-smoke.mjs http://127.0.0.1:8081/ screenshots/t13-gate-closure-built.png --baseline screenshots/t13-gate-closure-dev.json', cwd: 'original workspace', exitCode: 0 },
  { command: 'npm run preview:stop', cwd: 'validation-checkout', exitCode: 0 },
  { command: 'node test-results/ma3/t13-gate-closure/run-gates.mjs preserve', exitCode: 0 }
]);
put('FULL_SUITE_REPORT.md', `# T13 final full-suite report

Full pipeline: **PASS, exit 0**. Executed unchanged source \`${before.startingSha}\` on branch \`${before.branch}\` in an isolated validation checkout. The evidence-only commit does not change executable source.

| Pipeline lane | Tests | Passed | Failed | Skipped |
|---|---:|---:|---:|---:|
${table}
| Total within npm test | ${total} | ${total} | 0 | 0 |

Separate UI suite: 405/405, exit 0; not added to the npm-test pipeline count. OAuth PKCE's eight tests are included once in the library lane. No assertions changed, tests skipped, failures suppressed, or npm-test flags changed.

## Prior file-write investigation

The preserved source record \`test-results/ma3/t13-final-hw/ACCEPTANCE.md\` identifies the failure as the test declared at \`src/lib/bunny-host/remote-remediation.test.ts:391\` (cross-Project artifact). Its receipt call is at line 410; \`record()\` at lines 20–23 resolves a fixed historical evidence directory and calls \`writeFileSync(join(directory, name + '.json'), JSON.stringify(value, null, 2) + '\\n')\`. The default open mode is \`w\` (create/truncate).

Affected absolute path: \`C:\\Users\\allam\\Documents\\new\\bun-router\\test-results\\ma3\\t9r\\remote-canonical\\cross-project-artifact.json\`.

The retained record quotes \`UNKNOWN ... open cross-project-artifact.json\`; it does not retain the full original stderr or an OS handle trace. This session therefore does **not** claim a proven lock owner, stale handle, concurrency event, permissions failure, or exact Windows errno. The current file has Archive attributes, not ReadOnly. Its starting dirty content was hashed and preserved.

Evidence of a shared-fixture hazard is direct: every invocation uses the same receipt path, overwrites historical records and can collide with another run. Within the configured full pipeline test-file concurrency is already 1; that does not isolate separate processes or external readers. The independently passing historical 15-test rerun is not full-suite evidence.

This session reproduced the actual test inside the complete pipeline against independent source/receipt files. The historical open error did not recur. No production or test code repair was justified by the available evidence. The operational isolation remedy is the separate validation checkout, not an asserted filesystem-root-cause fix. A future recurrence should retain the full stderr and capture Windows file-I/O/handle telemetry during the failing run before assigning a cause.

## Attempts and reproducibility

First command: \`node test-results/ma3/t13-gate-closure/run-gates.mjs test\` → actual nested \`npm test\` **exit 1**; script lane 449/450. Error: \`Node runtime license unavailable; package must not ship without it.\`, \`scripts/bunny-release.test.mjs:44\`, assertion at :59. The library/runtime chain did not execute in that attempt. Full output: \`test.log\`; receipt: \`test-result.json\`.

Preparation initially omitted the ignored local runtime LICENSE. It was copied byte-for-byte into the validation checkout at the packaging script's existing fallback path; hash and correction are in \`environment-correction.json\`. No source fix was made for this setup error.

Final command: \`node test-results/ma3/t13-gate-closure/run-gates.mjs test test-final\` → actual nested \`npm test\`, **exit 0**, ${full.durationMs} ms, ${full.startedAt} to ${full.finishedAt}. Full output: \`test-final.log\`; receipt and log SHA-256: \`test-final-result.json\`.

Reproduce in a fresh evidence directory using \`run-gates.mjs prepare\`, which clones the starting Git source, links existing installed npm dependencies, copies the pinned ignored voice runtime/model/headers and local Node license, then runs the unchanged \`npm test\`. Runtime: ${before.node}, npm ${before.npm}, Windows x64. This is source-isolated, not a claim of a hermetic dependency installation. Compiler/native-worker provenance is emitted by pretest in the full log; generated worker binaries/manifests differ from historical builds because local source checkout line endings/toolchain are reflected in their hashes. They were not copied back or committed. Generated route-tree status has no semantic diff.

Additional commands: \`npm run test:ui\`, \`npm run typecheck\`, \`npm run build\`, \`npm run check:auth\` all exit 0. An initial unprivileged auth observation exited 2 because it could not read the dev server; the permitted rerun observed matching sign-in-off values. See \`command-results.json\` for exact commands and all exit codes. Build's migration hook reports DATABASE_URL unset and skips external migration.

All ${preservation.originalEntries} original dirty/untracked entries retain their hashes: \`workspace-before.json\` and \`workspace-preservation.json\`. Fresh remote security receipts are copied only into \`receipts/\`.
`);
put('ANDROID_ENVIRONMENT.md', `# Android environment discovery

Source: \`${before.startingSha}\`. Observation: ${env.recordedAt}. Command: \`./test-results/ma3/t13-gate-closure/discover-android.ps1\`, exit 0. Full sanitized observations and candidate paths: \`android-environment.json\`.

| Prerequisite | Observed result |
|---|---|
| ADB | Not on PATH; absent from checked SDK, platform-tools, environment-variable and WinGet candidate paths. Workspace adb.exe inventory also returned no matches. |
| Authorized Android device | **Not enumerable because ADB is unavailable.** No adb/emulator process was observed. This is not proof that no USB hardware is attached. |
| Companion APK | \`releases/Bunny-A-Android-v2.apk\`, 49,644 bytes, SHA-256 \`c2345d32af1b157fdad137bd64a038ac93ea0616b6695b9060cfa3717fb8c168\`. |
| Native build configuration | \`android/app/src/main/AndroidManifest.xml\`; package com.routeragent.jev, version 2.0, min API 26, target API 35; \`scripts/build-android.ps1\` uses Java/AAPT2/D8/apksig, not Gradle. Java, javac and all four required Android tool artifacts are present. |
| BUNNY_REMOTE_ORIGIN | Absent in this session's process/user/machine environments. This does not establish the installed gateway's environment. |
| remote.json | Present in installed state/settings with a valid HTTPS origin; absent in the workspace/development candidate paths. Existing gateway derives the origin from this file. Address and any secret fields were not retained. |
| Workstation transport | Existing installed gateway and cloudflared process observed. TLS-verified HTTPS /bunny-health returned 200 with Bunny-A identity; anonymous /api/bunny-events returned 401. Existing headers include DENY, frame-ancestors none and no-referrer. |

Available checks executed: \`./test-results/ma3/t13-gate-closure/check-android.ps1\`, exit 0. APK verifier reports **v2=true, v3=true, v1=false**; do not infer v1 from the build script's intent. The existing APK is accepted by the verifier at min checked platform 26. Actual badging matches the manifest. Java connection policy: **21 checks passed**. Commands and logs: \`android-checks.json\`, \`android-checks/*.log\`. No APK rebuild, re-sign, installation or signing-secret read was necessary.

The transport probe used the existing configured origin in memory, sent no credentials and retained only status/security headers. It did not start a tunnel, change firewall rules, or create any endpoint. It proves workstation reachability at observation time; it does not prove reachability/cookie persistence on a physical phone.

The installed release manifest declares source \`${installed.sourceCommit}\`, which differs from candidate \`${before.startingSha}\`. See installed-release-observation.json (read-only manifest pin/hash observation, not a new whole-release integrity verification). The reachable installed transport therefore does **not** establish candidate-source phone acceptance. Before hardware validation, stage a manifest-validated candidate workstation/gateway through an explicitly authorized HTTPS test transport. Do not repoint, replace or restart the existing installed release automatically.

Required setup before the physical gate: make official Android SDK Platform-Tools available; connect an Android 8+ physical handset and complete its owner-authorized USB/wireless debugging prompt; require \`adb devices -l\` state device (not unauthorized/offline); confirm the existing configured HTTPS origin works on that phone with normal certificate validation; confirm/install the signed version-2 companion only on that authorized test handset. Revalidate actual package identity and capture sanitized logs/screenshots per PHONE_PAIRING_MATRIX.md. Do not expose the loopback Host, disable TLS checks, or open firewall access as a workaround.

Disposition: **physical pairing BLOCKED by unavailable ADB and unverified authorized physical-device access**. Transport configuration itself is present and was reachable.
`);
const matrix = [
  ['Companion launches','Launch com.routeragent.jev/.MainActivity on the authorized physical handset; confirm app identity and foreground activity.','Native app opens without crash.'],
  ['Workstation generates code','Create one code in the workstation pairing UI; keep the code in memory only.','One valid time-limited code is offered; no code enters logs/screenshots.'],
  ['Android accepts code','Enter that code in the real companion at the candidate-pinned HTTPS test origin.','Pairing enrollment succeeds on-device.'],
  ['Authentication completes','Reload/return to the native app and observe its authenticated device view.','Authenticated current Host state loads without owner authority.'],
  ['Workstation lists phone','Inspect the workstation device list and correlate a sanitized test-device label.','Exactly the enrolled physical device is visible.'],
  ['Current agent activity','Start a bounded disposable Agent on the workstation; compare the same Agent/Mission on the phone.','Current canonical identities and activity agree.'],
  ['Task updates','Advance that bounded task through waiting/running/verified states.','Phone receives new canonical states; no synthetic rows counted.'],
  ['Authorized approval','Offer an eligible exact request covered by reviewed owner consent; approve it on the phone; perform workstation promotion if required.','Only the current allowed request is admitted; write staging/owner requirements remain enforced.'],
  ['Unauthorized approval','Try a request outside that device consent/Project/Agent or requiring owner authority.','Request is refused with no protected side effect.'],
  ['Expired/reused code','Reuse a spent code; separately wait beyond the real ten-minute lifetime before submitting an unused code.','Both are rejected; no simulated clock substitutes for this physical check.'],
  ['Disconnect detection','Disconnect only the handset network while bounded workstation work continues.','Companion shows stale/offline; mutation controls disable; Host work continues.'],
  ['Authorized reconnect','Restore handset network and reopen the same app session.','Valid device credential reconnects and current state converges.'],
  ['Stale approval after reconnect','Retain an old displayed request, reissue/change it on the workstation, then attempt the old approval after reconnect.','Old revision/Host-epoch request is refused; only a newly reviewed request can proceed.'],
  ['Workstation-only capabilities','Attempt pairing administration, delegation/budget/root expansion, hosted or tool-capable routes and arbitrary shell/app actions from the phone.','Remote UI offers no owner escalation and server rejects direct attempts.'],
  ['No permission bypass','Attempt actor/header spoofing, cross-Project binding, revoked credentials, replay and unknown operations; compare journal and filesystem effects.','No owner impersonation, duplicate effect, stale admission or unauthorized access.']
];
put('PHONE_PAIRING_MATRIX.md', `# Physical Android pairing matrix

**All 15 rows BLOCKED / NOT EXECUTED ON HARDWARE.** Source \`${before.startingSha}\`. ADB is unavailable and no authorized physical handset can be enumerated. Existing HTTPS transport is reachable. No browser simulation, APK signature result, disposable HTTP client or earlier evidence is substituted for physical pairing.

Preconditions and exact environment probes are in ANDROID_ENVIRONMENT.md. Once satisfied, run \`adb devices -l\` (redact serial); \`adb -s <authorized-device> shell pm path com.routeragent.jev\`; if installation is required, \`adb -s <authorized-device> install -r releases/Bunny-A-Android-v2.apk\`; launch with \`adb -s <authorized-device> shell am start -W -n com.routeragent.jev/.MainActivity\`. Require exit 0, actual package foreground, and no Android runtime crash. Installation/launch commands were **not executed** this session.

| # | Check | Reproducible action | Expected result | Observed |
|---:|---|---|---|---|
${matrix.map((row,i)=>`| ${i+1} | ${row[0]} | ${row[1]} | ${row[2]} | BLOCKED: no authorized handset session |`).join('\n')}

Use a disposable Project and bounded receipt task; record the source SHA, APK SHA-256, device OS/API and sanitized device alias. Keep real pairing codes, bearer/cookie values, credentials, private paths and unrelated user content out of captures. Observe logcat without retaining raw secrets; store only reviewed/redacted application/crash events. For screenshots use native handset captures (for example adb exec-out screencap -p) after pairing secrets are dismissed. Record before/after Agent/Mission/request/epoch identities as aliases, decision status, count of effects, and screenshot/log SHA-256 under a new physical/ run directory here.

Software-only supporting evidence: pairing-security.json (8 checks; expiry uses an explicitly simulated clock); transport-probe.json; full pipeline remote-device and remote-remediation tests/receipts. They do not change any physical row to PASS. No physical screenshots or device logs were fabricated. COMPLETE remains prohibited until all mandatory physical/security checks pass.

Candidate pin precondition: the presently installed gateway manifest declares \`${installed.sourceCommit}\`, not \`${before.startingSha}\`. The future physical run must establish that its actual workstation/gateway is the manifest-validated candidate; the existing transport health check alone is insufficient. Any staging or transport retargeting must preserve the current installed release and require explicit scope for that operation.
`);
put('SECURITY_VALIDATION.md', `# T13 security validation

Source \`${before.startingSha}\`; no authorization, transport, provider or production logic changes.

| Scope | Result | Evidence / limitation |
|---|---|---|
| Entire configured software pipeline | PASS, exit 0 | test-final.log; includes remote-device, remote-remediation, remote-authority, routing and PKCE tests. |
| Pairing and credential HTTP boundary | 8/8 PASS | pairing-security.json: anonymous read rejected (401), workstation-only code, successful software pairing/authentication/device listing, reused code rejected (403), owner-header forgery refused (400), expired code rejected (403), revoked read rejected (401). Disposable real Host HTTP; **software client**, expiry clock SIMULATED +600001ms. |
| Existing real HTTPS gateway | PASS for installed transport availability only | transport-probe.json: normal certificate validation, health 200, anonymous stream 401, clickjacking/referrer headers present. Installed manifest declares ${installed.sourceCommit}; this is not candidate-source gateway acceptance. No credential sent or response body retained. |
| APK signature and identity | PASS | android-checks/verify-existing-apk.log, apk-manifest.log; v2/v3 verified; v1 false disclosed. This is not a new APK-source reproducibility claim. |
| Android address boundary | 21 checks PASS | android-checks/address-policy.log; unsafe origins/cleartext/credential/query/fragment/loopback/lookalikes refused. |
| Device/canonical approval scope, cross-Project/Agent/Mission, stale/replay/restart, revocation, provider restrictions | PASS in full software pipeline | test-final.log and copied receipts/*.json; genuine disposable Host/SQLite/filesystem; scripted adapters or simulated scheduling explicitly remain software evidence. |
| CSRF/state/replay and provider URL PKCE checks | 8/8 in full library lane | oauth-pkce.test.ts test names in test-final.log; exchanges are explicitly SIMULATED, not live provider authentication. |
| Dev/build auth invariant | PASS, sign-in off agrees | auth-final.log; app-level sign-in off does not remove Host/device authentication. Initial sandbox observation was indeterminate, exit 2, retained in auth.log. |
| Offline UI boundary | PASS in workstation browser | Tasks/Agents/Projects navigate; theme mutation refused offline and disabled project controls remain disabled. No task submitted. |
| Physical Android authentication/approval/bypass matrix | BLOCKED | All 15 physical checks require actual authorized handset evidence. |

Native Android source review: manifest disables cleartext and backup, requests Internet only; MainActivity disables file/content access, mixed content and third-party cookies and rejects SSL errors. No JavaScript-to-native bridge was added. This review is STATIC; actual handset WebView behavior and persistence remain untested.

Evidence capture uses per-line secret redaction; final retained-file scan records pattern names and locations only in secret-scan.json. No pairing code, bearer, cookie, private signing key/password or remote origin is intentionally stored. Existing signing state was not read. No credentials rotated, permissions broadened, installed service restarted or network exposure created. No blanket security certification is claimed: hardware checks remain a mandatory gate.
`);
put('FINAL_ACCEPTANCE.md', `# BUNNY-A MA3 T13-GC final acceptance

**CONDITIONAL PASS.** The full npm-test gate is closed. Physical Android pairing remains **BLOCKED**, so T13 is **not COMPLETE**. No confirmed critical functional or security regression remains from these checks.

- Branch: \`${before.branch}\`.
- Starting SHA: \`${before.startingSha}\`.
- Final executable source SHA: \`${before.startingSha}\` (unchanged). All new files are verification tooling or sanitized evidence under this directory. The final Git evidence SHA is the commit containing this report; resolve with \`git log -1 --format=%H -- test-results/ma3/t13-gate-closure/FINAL_ACCEPTANCE.md\`, and see the session's final response for that exact SHA.
- Existing production/test files edited: **none**. New scripts only capture verification evidence. No UI redesign, new functionality, MA4, merge, push or PR.

| Gate | Disposition |
|---|---|
| Entire npm test chain | **PASS**, exit 0, ${total}/${total}: ${summaries.map(s=>s.lane+' '+s.pass+'/'+s.tests).join('; ')}; 0 failed/skipped/cancelled/todo. |
| UI | **PASS**, 405/405, separately executed, 0 skipped. |
| Typecheck / build / auth invariant | **PASS**, each exit 0; fresh build, matching sign-in-off configuration. |
| Desktop/mobile dev and built render | **PASS**: both screenshot pairs visually inspected, visible content, clean console, no horizontal overflow; production baseline divergence false. Workstation offline-Host context only. |
| Movable Island / indicator ordering | Existing gate retained; fresh full script suite executes all four-edge placement and ordering tests. No native source changed. |
| Multi-agent handoff / execution / approvals / provider routing | Fresh full pipeline plus UI regression passed; existing live evidence retained at unchanged source. |
| Windows Narrator / keyboard | Prior native pass retained with its original limitations (no human-ear prosody approval); fresh workstation-browser click/Tab/Return navigation verified. No new native/audible Narrator claim. |
| Voice controls / themes | Fresh script/library/UI regressions pass. Existing live/acoustic/theme evidence preserved; no new live acoustic or online theme-switch claim. Offline theme mutation refusal verified. |
| Android environment | Signed v2 APK, build prerequisites and reachable pre-existing HTTPS transport found. ADB unavailable; authorized handset status cannot be enumerated. |
| Physical phone / physical security | **BLOCKED**. All 15 hardware rows unexecuted; reproducible setup/actions/expected results preserved in PHONE_PAIRING_MATRIX.md. |
| Evidence/source preservation | ${preservation.originalEntries} original dirty/untracked file hashes unchanged. Existing tracked evidence was not overwritten by tests; runs used an independent source/receipt checkout. |

The original receipt open error was not reproduced in the full passing run. Shared output paths are confirmed; a specific Windows lock/permission owner is **unproven** because the original record lacks full stderr/handle telemetry. No speculative production or assertion change was made. The first isolated run's omitted Node-license prerequisite caused exit 1 and is retained separately; the complete corrected pipeline then exited 0.

Remaining prerequisite blockers: official Platform-Tools plus an authorized physical Android 8+ session, and a manifest-validated candidate workstation/gateway through an authorized HTTPS test transport, followed by the complete actual-device matrix. The existing installed gateway declares source ${installed.sourceCommit}, so its reachability is not candidate-source acceptance. Do not retarget/restart the existing installed service automatically. Do not waive the hardware gate or replace it with mocks. Current transport reachability does not establish phone-network reachability or on-device authentication.

Evidence map: FULL_SUITE_REPORT.md, ANDROID_ENVIRONMENT.md, PHONE_PAIRING_MATRIX.md, SECURITY_VALIDATION.md; suite-summary.json; command-results.json; workspace-before.json/workspace-preservation.json; retained-evidence.json; test-final.log and result; android-environment.json/android-checks/; pairing-security.json; transport-probe.json; cross-surface-regression.json; browser/; receipts/. INDEX.sha256 seals retained files; secret-scan.json records the final content scan. validation-checkout and compiled Android .class files remain local ignored scratch and are not committed.

Pre-existing development server and installed Host/gateway/tunnel were not restarted or reconfigured. Only this task's managed built-output preview was started and stopped. Existing native/Narrator acceptance is preserved, not silently downgraded or expanded beyond its documented limits.
`);
console.log('Generated five acceptance reports and supporting evidence at unchanged source SHA.');
