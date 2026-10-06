import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';

const root = resolve('test-results/ma2-gate9');
const json = (name) => JSON.parse(readFileSync(join(root, name), 'utf8').replace(/^\uFEFF/, ''));
const save = (name, value) => writeFileSync(join(root, name), JSON.stringify(value, null, 2) + '\n');
const stamp = new Date().toISOString();
const totals = (name) => [...readFileSync(join(root, name), 'utf8').matchAll(/^ℹ tests (\d+)$/gm)].map((match) => Number(match[1]));
assert.deepEqual(totals('t9-v20-full-sequential.log'), [247, 340]);
assert.deepEqual(totals('t9-v20-ui.log'), [37]);
assert.deepEqual(totals('t9-privacy-focused.log'), [26]);
for (const name of ['t9-v20-full-sequential.log', 't9-v20-ui.log', 't9-privacy-focused.log']) {
  const log = readFileSync(join(root, name), 'utf8');
  assert.ok([...log.matchAll(/^ℹ fail (\d+)$/gm)].every((match) => match[1] === '0'));
  assert.ok([...log.matchAll(/^ℹ skipped (\d+)$/gm)].every((match) => match[1] === '0'));
}
const gates = {
  gate: 'M-A-2 T9', recordedAt: stamp, ok: true, sourceCommit: json('v20-candidate-package.json').sourceCommit,
  unchangedTestInventory: true, deletedTests: 0, fullRegression: { script: 247, application: 340, ui: 37, passed: 624, failed: 0, skipped: 0 },
  focused: { passed: 26, includedInApplicationTotal: true },
  fullCommand: 'The npm test inventory, with --test-concurrency=1 on both Node test invocations; no cases omitted. npm pretest native ownership build already passed in both default full runs.',
  defaultNpmTest: 'Two runs: 247 script pass; application 339/340 with one EPERM in fixture cleanup after T4 assertions. Unchanged isolated test and complete sequential run pass. Failed logs retained.',
  typecheckExit: 0, lintExit: 0, lintErrors: 0, preexistingLintWarnings: 11, exactSourceWindowsDashboardBuildExit: 0,
  render: { installedBuild: true, desktopAndMobile: true, content: true, consoleErrors: 0, pageErrors: 0, horizontalOverflow: false, screenshotsVisuallyInspected: true },
};
save('regression-final.json', gates);
save('resumed-baseline.json', {
  gate: 'M-A-2 T9', recordedAt: stamp, observedAtContinuationStart: { branch: 'ma2-operational-hardening', head: 'e550ed0', partialT9Tests: 616, editedFile: 'MA2_T9_APPROVAL_BATCHING_ACCEPTANCE.md', acceptancePending: true },
  originalT8Floor: 592, priorBaseline: 'baseline.json', untouchedUserFiles: ['BUNNY_OPENDOTS_ADOPTION_REPORT.md', 'MA1D_FINAL_INDEPENDENT_REVIEW.md', 'MA1_CLAUDE_FINAL_REVIEW.md', 'memory/'],
  note: 'The original baseline and partial acceptance are historical records; this continuation inspected the actual partial T9 code and closed admission/privacy defects before staged acceptance.',
});
const failures = [
  { id: 'T9-target-admission', classification: 'RESOLVED PRODUCT SECURITY', finding: 'Title-selected operations could touch foreign targets before post-run detection; arbitrary typing/control scope was too broad.', resolution: 'f7d8ccb: exact operation/step digests, verified Calculator profile and preflight before admission; all target/operation escapes fail before mutation.' },
  { id: 'T9-UWP-chrome', classification: 'RESOLVED PRODUCT COMPATIBILITY', evidence: ['v18-B-live.json', 'v18-target-probe.log'], finding: 'Over-strict dialog check refused normal UWP frame/content windows.', resolution: '8d49b7d recognizes only normal verified nonmodal UWP descendants; v19 and final v20 live positive pass.' },
  { id: 'T9-renderer-input', classification: 'RESOLVED PRODUCT PRIVACY', finding: 'Original typed input remained in mission renderer snapshots despite safe events/visible activity.', resolution: '445beeb redacts typed input and secret-key params in view/detail without changing Host execution input; whole-response focused/live scan passes.' },
  { id: 'T9-release-name', classification: 'RESOLVED BUILD HARNESS', evidence: ['t9-final-full-elevated.log'], finding: 'Candidate r2 naming failed the existing pin expectation.', resolution: 'Repository-consistent next-version candidates, no release test weakened or package overwritten.' },
  { id: 'T9-restart-harness', classification: 'RESOLVED HARNESS', evidence: ['v19-R-harness-failure.json', 'v19-R-harness-timeout.json', 'v19-R1-harness-assertion-failure.json'], finding: 'PowerShell module/child handle issues, followed by incorrect interrupted-step assertion for an approval pause.', resolution: 'Explicit installed launcher controller; T3 paused-step semantics preserved, v19/v20 recovery/replay verified.' },
  { id: 'T9-plan-limit', classification: 'RESOLVED HARNESS', evidence: ['v19-G2-harness-plan-limit.json'], finding: '14-step test exceeded the existing 12-step planner limit.', resolution: 'Use 12 steps without increasing limit; actual in-flight Stop passes.' },
  { id: 'T9-Windows-test-cleanup', classification: 'LOW HARNESS LIMITATION', evidence: ['t9-v20-full.log', 't9-v20-full-recheck.log', 't9-v20-t4-cleanup-isolated.log', 't9-v20-full-sequential.log'], finding: 'Default concurrent test files hit EPERM deleting a temporary T4 fixture after ownership assertions.', resolution: 'Unchanged isolated test and complete unchanged sequential inventory pass; no weakened assertion/skip or T4 runtime change.' },
  { id: 'T9-restricted-environment', classification: 'RESOLVED ENVIRONMENT', evidence: ['t9-final-full.log', 't9-final-dev-render.log'], finding: 'Restricted process/browser environment lacked native access for Windows acceptance.', resolution: 'Authorized normal Windows execution; no automatic approval rejection or product security bypass.' },
];
save('failure-ledger.json', { gate: 'M-A-2 T9', recordedAt: stamp, unresolvedBlocker: 0, unresolvedHigh: 0, failures });
save('adversarial.json', {
  gate: 'M-A-2 T9', recordedAt: stamp, ok: true,
  simulated: ['borrowed Mission/envelope/step', 'altered exact operation/selector/extra fields', 'foreign/lookalike target identity before mutation', 'shell/Browser/files/Git family escape', 'budget max+1', 'expired admission', 'Stop/expiry during asynchronous preflight', 'old boot epoch', 'provider-origin change without scope expansion', 'spoofed UI claims', 'changed risk/standing rule/plan before approval', 'bounded retry consumption'],
  live: ['second application asks', 'destructive action asks', 'sensitive input asks without execution', 'concurrent Mission does not inherit', 'actual executing Stop', 'crash/restart clears grant and refuses replay', 'paired-device oversized bound clamped and revoked token refused'],
  simulatedEvidence: 't9-privacy-focused.log', liveEvidencePrefix: 'v20-', targetLimits: 'Windows UIA revalidates identity immediately before operation; no atomic desktop freeze or privileged OS compromise proof claimed.',
});
const schema = json('schema-change.json');
schema.finalReview = { sourceCommit: json('v20-candidate-package.json').sourceCommit, additionalSqlMigration: false, recordJsonAdditions: ['operations[{stepId,digest}]', 'windowIdentity{handle,processId,processStartedAt}'], oldGrantWithoutOperations: 'fail closed', rendererInputProjection: 'redacted without canonical plan mutation' };
save('schema-change.json', schema);

mkdirSync(join(root, 'screenshots'), { recursive: true });
for (const name of readdirSync('screenshots').filter((name) => /^t9-.*\.(png|jpg|json)$/.test(name))) copyFileSync(join('screenshots', name), join(root, 'screenshots', name));
for (const name of ['MA2_T9_APPROVAL_BATCHING_ACCEPTANCE.md', 'MA2_ACCEPTANCE_MATRIX.md', 'MA2_IMPLEMENTATION_REPORT.md', 'MA2_INDEPENDENT_REVIEW_PACKET.md']) copyFileSync(name, join(root, name));
for (const file of ['v20-candidate-package.json', 'v20-ui-live.json', 'v20-privacy.json', 'v20-journal.json', 'final-production.json']) assert.equal(json(file).ok ?? json(file).integrity?.ok, true, file);
save('acceptance-final.json', {
  gate: 'M-A-2 T9', recordedAt: stamp, verdict: 'BUNNY_MA2_T9_PASS', candidate: 'Bunny-A-Windows-v20-T9',
  candidateRecord: 'v20-candidate-package.json', regression: gates.fullRegression,
  explicitBatch: true, lowRiskProfile: 'Microsoft Calculator arithmetic', exactScope: true, finiteTimeAndCount: true,
  liveMatrix: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'G2', 'H', 'S', 'I', 'J', 'R'], privacyVerified: true,
  verificationUnchanged: true, previousGatesPreserved: true, unresolvedBlocker: 0, unresolvedHigh: 0,
  production: 'Bunny-A-Windows-v17-T6', activated: false, activationAuthorization: false,
  fullOperationalVerdict: false, t10Started: false, next: 'T10',
});

const classification = (path) => path.startsWith('screenshots/') ? 'VISUAL EVIDENCE'
  : path.startsWith('staging/') ? 'ACCEPTANCE TOOLING (not product authority)'
  : /^v20-.*harness|t9-v20-full(?:-recheck)?\.log|harness|failure|v18-|v19-|recheck|^t9-final-|^t9-v19-|^t9-v18-|^t9-r2/.test(path) ? 'HISTORICAL / FAILURE TRAIL (see ledger)'
  : /^v20-.*live|^v20-(?:privacy|journal|ui)|^final-production/.test(path) ? 'LIVE VERIFIED'
  : /^t9-v20|^t9-privacy|regression|candidate-package|adversarial/.test(path) ? 'STATIC VERIFIED / SIMULATED (see record)'
  : /(?:current-approval-model|baseline|before)/.test(path) ? 'HISTORICAL BASELINE'
  : /(?:ACCEPTANCE|REPORT|PACKET|policy|final|append|schema)/.test(path) ? 'REPORT / POLICY'
  : 'HISTORICAL SUPPORTING EVIDENCE';
const entries = [];
const visit = (folder) => {
  for (const item of readdirSync(folder, { withFileTypes: true })) {
    const file = join(folder, item.name), rel = relative(root, file).replaceAll('\\', '/');
    if (item.isDirectory()) { if (rel !== 'evidence') visit(file); continue; }
    if (item.name !== '.gitattributes' && !/\.(?:json|log|md|ts|mjs|ps1|txt|png|jpg)$/.test(item.name)) continue;
    assert.ok(!/credentials\.json|\.sqlite(?:-|$)|\.env$/.test(rel), 'Secret/state file must not enter index');
    const bytes = readFileSync(file), stat = statSync(file);
    entries.push({ path: rel, size: stat.size, sha256: createHash('sha256').update(bytes).digest('hex'), classification: classification(rel), timestamp: stat.mtime.toISOString() });
  }
};
visit(root);
// Never expose a credential, even if an old diagnostic accidentally captured one.
const actualTokens = ['C:/Users/allam/AppData/Local/Bunny-A/state/credentials/credentials.json', 'C:/Users/allam/AppData/Local/Bunny-A-T9-stage/state/credentials/credentials.json'].map((file) => JSON.parse(readFileSync(file, 'utf8')).token);
for (const entry of entries.filter((entry) => !/\.(?:png|jpg)$/.test(entry.path))) {
  const text = readFileSync(join(root, entry.path), 'utf8');
  assert.ok(actualTokens.every((token) => !text.includes(token)), 'Credential leak in evidence: ' + entry.path);
}
entries.sort((a, b) => a.path.localeCompare(b.path));
mkdirSync(join(root, 'evidence'), { recursive: true });
save('evidence/index.json', { schema: 'bunny-gate-evidence/1', gate: 'M-A-2 T9', generatedAt: stamp, base: 'test-results/ma2-gate9', count: entries.length, authoritativeCandidate: 'v20-candidate-package.json', authoritativeVerdict: 'acceptance-final.json', noSecretValues: true, files: entries });
for (const entry of entries) assert.equal(createHash('sha256').update(readFileSync(join(root, entry.path))).digest('hex'), entry.sha256);
console.log('Hashed T9 evidence index verified: ' + entries.length + ' files; 624 regression tests pass.');
