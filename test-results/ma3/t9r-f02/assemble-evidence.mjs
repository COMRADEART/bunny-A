// M-A-3 T9R-F02: derives the JSON evidence files from the raw logs and live artifacts in this folder.
// Observed results come only from test runner output (✔/✖ lines) and live evidence files, never from hand-written values.
// Usage (repo root): node test-results/ma3/t9r-f02/assemble-evidence.mjs
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
const dir = resolve('test-results/ma3/t9r-f02');
const read = (name) => existsSync(join(dir, name)) ? readFileSync(join(dir, name), 'utf8') : '';
const log = read('full-test-results.log');
const passed = new Set(), failed = new Set();
for (const line of log.split(/\r?\n/)) {
  const m = /^(?:\s*)(✔|✖) (.+?) \(\d+(?:\.\d+)?m?s\)\s*$/.exec(line);
  if (!m) continue;
  (m[1] === '✔' ? passed : failed).add(m[2]);
}
const find = (prefix) => [...new Set([...passed, ...failed])].filter((name) => name.startsWith(prefix));
const status = (prefix) => {
  const names = find(prefix);
  if (!names.length) return { prefix, found: 0, result: 'NOT_FOUND' };
  return { prefix, names, result: names.every((name) => passed.has(name) && !failed.has(name)) ? 'PASS' : 'FAIL' };
};
const json = (name) => { try { return JSON.parse(read(name)); } catch { return null; } };
const live = json('live-staging-acceptance.json');
const x53 = json('x53/x53-stability-matrix.json');
const prodBefore = json('production-before.json'), prodAfter = json('production-final.json');
const liveSteps = (...n) => ({ type: 'LIVE disposable Host (real HTTP, pairing, SQLite, Agent consent, fs.watch)', file: 'live-staging-acceptance.json', steps: n, result: live?.result === 'PASS' && n.every((k) => live.steps.some((s) => s.step === k)) ? 'PASS' : 'FAIL' });

const IP = 'in-process Host integration (real MissionManager/TaskManager/SQLite, disposable folders)';
const HTTP = 'real HTTP disposable Host (startHost, real pairing and bearer tokens)';
const UNIT = 'unit (pure function)';
const rows = [
  ['E01', 'Ordinary safe document write accepted into staging', 'Workstation-planned Mission writes note.md; phone approves', 'Phone approves; Host executes the write step', 'Staged (PHONE_SAFE_DOCUMENT), project untouched, workstation promotion completes it', IP, ['F02-E01:'], [2, 3, 4]],
  ['E02', '.json in execution-sensitive config path rejected as safe document', 'Phone-approved writes to package.json, root x.json, .vscode/settings.json', 'Write admission', 'desktopRequired ask (CONFIGURATION); nothing staged or written', IP, ['F02-E02:', 'F02-R3-1:'], []],
  ['E03', '.yaml CI workflow cannot use phone safe-data permission', '.github/workflows/ci.yml', 'Phone-approved write', 'EXECUTION_RELEVANT; workstation-only', IP, ['F02-E03:'], []],
  ['E04', 'Agent instruction Markdown is not a harmless document', 'AGENTS.md, CLAUDE.md, .claude/x.md, CLAUDE.local.md, dot-folders', 'Phone-approved write / classification', 'AGENT_INSTRUCTIONS or CONFIGURATION; never phone-safe', IP, ['F02-E04:', 'F02-R1-1:', 'F02-R2-1:'], []],
  ['E05', 'Unknown file purpose fails closed', 'extensionless, .mdx, NTFS stream, 8.3, invisible characters', 'Classification and write', 'UNKNOWN / EXECUTION_RELEVANT; never staged', IP, ['F02-E05:', 'F02-ST5:', 'F02-R3-1:'], []],
  ['E06', 'Path traversal rejected', '../x.md', 'Phone-approved write', 'Refused; nothing outside the project', IP, ['F02-E06:'], []],
  ['E07', 'Junction/symlink destination escape rejected', 'junction and hard link at stage time; junction created after staging', 'Write, then promotion', 'UNKNOWN at staging; promotion refused; outside untouched', IP, ['F02-E07:', 'F02-E07b:'], []],
  ['E08', 'Cross-project staging substitution rejected', 'Mission A staged change; Mission B request', 'Promotion with a substituted staging id', 'Refused; nothing written', IP, ['F02-E08:', 'F02-E21:'], []],
  ['E09', 'Cross-Agent staging substitution rejected', 'staging folder under a broad root', 'Mission read/list of staging', 'Refused as private Host state', IP, ['F02-E09:', 'F02-E19:'], []],
  ['E10', 'Staged content mutation invalidates promotion approval', 'staged bytes rewritten on disk', 'Workstation allow_once', 'FAILED; destination untouched', IP, ['F02-E10:'], []],
  ['E11', 'Destination replacement invalidates promotion', 'destination created or edited after staging', 'Workstation allow_once', 'Refused; file not overwritten', IP, ['F02-E11:'], []],
  ['E12', 'Watcher not triggered by inert staging', 'recursive fs.watch on the project', 'Phone write staged', 'No watcher event', IP, ['F02-E12:'], [4]],
  ['E13', 'Watcher observes change only after authorized promotion', 'same watcher', 'Workstation promotes', 'Event only after promotion', IP, ['F02-E13:'], [9]],
  ['E14', 'Promotion requires current Windows Host authorization', 'promotion request', 'Phone allow_once; device projection', 'WORKSTATION_REQUIRED; no promotion/content in device view', IP + ' + ' + HTTP, ['F02-E14:', 'F02-E28:'], [5]],
  ['E15', 'Large content cannot be silently approved from truncated preview', '9,000-byte change', 'Workstation allow_once before/after inspection', 'Refused until inspected (request stays open); device cannot inspect; inspection escaped', IP, ['F02-E15:', 'F02-R3-4:'], []],
  ['E16', 'Narrowed envelope prevents previously offered write', 'Agent consent read+write, write ask offered', 'Owner removes write; phone answers', 'Refused; answered-unused answer INVALIDATED_BY_SCOPE_CHANGE; nothing written', IP + ' + ' + HTTP, ['F02-E16a:', 'F02-E16b:', 'T9 F02 D3 (negative regression)', 'T9R F-02 narrowed consent'], [13, 14]],
  ['E17', 'Current in-scope one-time approval remains valid', 'consent keeps write; ask-every-time rule', 'Phone allow_once', 'Staged, then promoted by the workstation', IP + ' + ' + HTTP, ['F02-E17:', 'F02-E17a:', 'T9 F12-F15/F19-F22/F50 (G2)'], [1, 2]],
  ['E18', 'Out-of-envelope one-time approval refused', 'path outside the Mission write roots', 'Phone allow_once', 'Refused', IP, ['F02-E18:', 'F01-R18'], []],
  ['E19', 'Cross-Agent approval rejected', 'two Agents', 'Phone answers with forged binding', 'Refused; own answer never transfers', IP + ' + ' + HTTP, ['F02-E19:', 'T9R remote approval cannot substitute agentId'], []],
  ['E20', 'Cross-Mission approval rejected', 'plain Mission and Agent Mission', 'Phone answer transfer attempt', 'Refused', IP + ' + ' + HTTP, ['F02-E20:', 'T9R remote approval cannot substitute missionId'], []],
  ['E21', 'Cross-Project approval rejected', 'two projects', 'Retarget answer', 'Refused; destination stays in the Mission project', IP + ' + ' + HTTP, ['F02-E21:', 'T9R remote approval cannot substitute projectId'], []],
  ['E22', 'Stale authorization revision rejected', 'request.agentic.revision behind', 'Phone answer', 'Refused', IP, ['F02-E22:'], []],
  ['E23', 'Old Host generation rejected', 'Host restart', 'Answer old offer; held answer', 'Refused; INVALIDATED_BY_HOST_RESTART', IP, ['F02-E23a:', 'F02-E23b:'], []],
  ['E24', 'Expired single-use grant rejected', 'device answer past TTL; desktop grant past 5 min; envelope expired', 'Admission', 'EXPIRED; step re-asks; grant refused', IP + ' + ' + UNIT, ['F02-E24a:', 'F02-E24b:', 'F02-R1-5:'], []],
  ['E25', 'Consumed grant cannot be reused', 'completed device-answered write', 'Retry', 'CONSUMED; Retry asks again', IP, ['F02-E25:', 'F02-R3-2:'], []],
  ['E26', 'Phone cannot impersonate workstation using actor string', 'paired phone', 'Body actor/by/grantedBy/resolvedBy = workstation', 'SQLite records only device:<id>', HTTP, ['F02-E26:'], []],
  ['E27', 'Forged owner header rejected', 'paired and unpaired clients; gateway', 'X-Owner, X-Bunny-Actor, X-Forwarded-For, Forwarded, cookie, non-Bearer, unknown x- relay', '401 / device viewer / remote', HTTP + ' + ' + UNIT, ['F02-E27:'], []],
  ['E28', 'Paired phone cannot forge local-owner approval', 'promotion ask; staging commands', 'Phone answers / inspects', 'WORKSTATION_REQUIRED', HTTP, ['F02-E28:'], [5]],
  ['E29', 'Valid authenticated workstation approval succeeds', 'staged change', 'Host-token mission.respond allow_once', 'PROMOTED; exact bytes', HTTP, ['F02-E29:'], [6, 7, 8, 9]],
  ['E30', 'Phone self-sign-out invalidates unconsumed approvals', 'unused phone answer; staged change', 'device.revoke {} with the phone token', 'INVALIDATED_BY_SIGNOUT; nothing written', HTTP, ['F02-E30:', 'F01-7'], [15, 16]],
  ['E31', 'Sign-out preserves completed action evidence', 'completed phone-approved Mission', 'Sign-out', 'Mission, events, runs, promoted content intact', HTTP, ['F02-E31:'], [17]],
  ['E32', 'Sign-out does not revoke independent owner approvals', 'workstation-granted envelope', 'Phone sign-out', 'Envelope unrevoked; Mission keeps running', HTTP, ['F02-E32:', 'T9R F-02: workstation revocation'], [17]],
  ['E33', 'Owner device revocation invalidates pending device approvals', 'pending staged change and answers', 'Workstation device.revoke {id}', 'INVALIDATED_BY_DEVICE_REVOCATION', HTTP + ' + ' + IP, ['F02-E33:', 'F02-R2-4:'], []],
  ['E34', 'Re-pairing cannot revive old approvals', 'revoked device', 'Re-pair (new id), replay old ids', 'Refused', HTTP, ['F02-E34:'], []],
  ['E35', 'Sign-out/admission race serialized', 'pending ask', 'Concurrent answer and sign-out (incl. delayed body)', 'At most one outcome; never a write', HTTP, ['F02-E35:', 'T9 revocation race'], []],
  ['E36', 'Revocation/admission race serialized', 'pending ask', 'Concurrent answer and workstation revoke', 'Never a write', HTTP, ['F02-E36:'], []],
  ['E37', 'Scope reduction/admission race serialized', 'device answer', 'Narrowing in the same tick', 'Nothing written', IP, ['F02-E37:'], []],
  ['E38', 'Host restart cannot revive old approval', 'staged change and answer', 'Real Host close + startHost on same data', 'Invalidated; old approval dead', HTTP, ['F02-E38:', 'F02-ST1:', 'F02-R2-6:'], []],
  ['E39', 'Stop blocks later admissions', 'device-answered or staged write', 'Stop', 'No write; staged WITHDRAWN', IP, ['F02-E39a:', 'F02-E39b:', 'F02-ST3:', 'F02-R3-5:'], []],
  ['E40', 'Phone cannot authorize shell through Codex', 'Codex route', 'Phone answer/launch', 'Desktop-only', IP, ['F02-E40:', 'F01-3:'], []],
  ['E41', 'Phone cannot authorize code execution through Claude', 'Claude write session; terminal', 'Phone answer', 'Desktop-only', IP, ['F02-E41:', 'F01-2:'], []],
  ['E42', 'Phone cannot authorize arbitrary execution through Ollama', 'tool-free Ollama step; reroute', 'Phone answer for rerouted route', 'Refused', IP, ['F02-E42:', 'F01-4:', 'T9R DEV-01'], []],
  ['E43', 'Specialized model cannot increase permissions', 'unknown provider / local model names', 'Authority lookup', 'Fails closed', UNIT, ['F02-E43:'], []],
  ['E44', 'Provider reroute does not reset scope', 'device-approved read', 'Reroute', 'Answer not carried into a write', IP, ['F02-E44:', 'F01-4b'], []],
  ['E45', 'Phone-written document cannot automatically become execution input', 'staged document; dependent terminal step', 'Run', 'Never sees it; workstation still required', IP, ['F02-E45:'], []],
  ['E46', 'Trusted desktop review bound to exact bytes/hash', 'staged change', 'Tampered contentHash', 'Refused; nothing written', IP, ['F02-E46:'], [5]],
  ['E47', 'Code/config changes require Windows Host authorization', 'phone code/config change', 'Write; workstation grant; promotion', 'desktopRequired; promotion still re-checks; promotion voids older grants', IP, ['F02-E47:', 'F02-E47c:', 'F02-R1-6:'], [11, 12]],
  ['E48', 'Private Bunny Host state remains inaccessible', 'broad root containing Host data', 'Mission reads; staging into Host state', 'Refused', IP, ['F02-E48:', 'F02-E48b:', 'F02-R1-3:'], []],
  ['E49', 'Device SSE stops delivering after revocation', 'open device streams', 'Sign-out and revocation', 'Closed; nothing further delivered', HTTP, ['F02-E49:', 'T10-T6-04: revocation ends an already authenticated Host SSE'], []],
  ['E50', 'No credentials or authorization secrets in evidence', 'responses and evidence', 'Token scan; secret-scan.mjs', 'None found', HTTP + ' + evidence scan', ['F02-E50:'], []],
  ['E51', 'T9 remote Pause/Resume/Stop still functional', 'paired device', 'Pause/Resume/Stop', 'Works', HTTP, ['T9 F12-F15/F19-F22/F50 (G2)', 'T9 G6:', 'T9 F19/F20/F23:', 'T9R lost command acknowledgment'], []],
  ['E52', 'T6 real Calculator/X53 workflow remains functional', 'owned Calculator', '10 consecutive X53 runs', '10/10 PASS', 'LIVE Windows UIA (x53-stability)', [], []],
  ['E53', 'T4 SQLite recovery still prevents duplicate work', 'agent recovery', 'Restart recovery suites', 'Pass; no duplicate write (dedupe)', IP, ['A07/A08:', 'F02-ST2:', 'F02-R2-6:'], []],
  ['E54', 'Full F01 security regression retained', 'F01 suite', 'Full regression', 'All F01 tests pass', IP, ['F01-'], []],
  ['E55', 'Production v26 preserved', 'installed v26', 'Read-only before/after observation', 'Release, manifest, install, listeners unchanged', 'LIVE read-only production observation', [], []],
];
const matrix = rows.map(([id, title, initial, operation, expected, type, prefixes, steps]) => {
  const tests = prefixes.map(status);
  const extra = [];
  if (steps.length) extra.push(liveSteps(...steps));
  if (id === 'E52') extra.push({ type: 'LIVE Windows UIA', file: 'x53/x53-stability-matrix.json', consecutiveClean: x53?.consecutiveClean ?? null, failedAttempts: x53?.failedAttempts ?? null, result: x53 && x53.consecutiveClean === 10 && x53.failedAttempts === 0 ? 'PASS' : 'FAIL' });
  if (id === 'E55') extra.push({ type: 'LIVE read-only', files: ['production-before.json', 'production-final.json'], result: prodBefore && prodAfter && prodBefore.currentRelease === prodAfter.currentRelease && prodBefore.releaseManifest?.sha256 === prodAfter.releaseManifest?.sha256 && prodBefore.installJsonSha256 === prodAfter.installJsonSha256 && JSON.stringify(prodBefore.listeners) === JSON.stringify(prodAfter.listeners) ? 'PASS' : 'FAIL' });
  if (id === 'E50') { const scan = json('secret-scan.json'); extra.push({ type: 'evidence secret scan', file: 'secret-scan.json', result: scan && scan.findings?.length === 0 ? 'PASS' : 'FAIL' }); }
  const all = [...tests, ...extra];
  const observed = all.every((item) => item.result === 'PASS') ? 'PASS' : 'FAIL';
  return { id, title, initialConditions: initial, operation, expected, evidenceType: type, observed: observed === 'PASS' ? 'Every supporting test and live artifact passed (see supportingEvidence)' : 'At least one supporting item did not pass (see supportingEvidence)', supportingEvidence: all, result: observed };
});
const write = (name, value) => writeFileSync(join(dir, name), JSON.stringify(value, null, 2) + '\n');
write('adversarial-matrix.json', { gate: 'M-A-3 T9R-F02', derivedFrom: ['full-test-results.log', 'live-staging-acceptance.json', 'x53/x53-stability-matrix.json', 'production-before.json', 'production-final.json', 'secret-scan.json'], rows: matrix, summary: { rows: matrix.length, pass: matrix.filter((r) => r.result === 'PASS').length, fail: matrix.filter((r) => r.result !== 'PASS').map((r) => r.id) } });
const subset = (ids) => matrix.filter((r) => ids.includes(r.id));
write('watcher-execution-boundary.json', { claim: 'Inert staging does not trigger a watched project; the project changes only on authorized promotion. External consumers of PROMOTED files are not claimed preventable.', rows: subset(['E12', 'E13', 'E45']) });
write('scope-intersection-matrix.json', { formula: 'Effective authority = Host policy ∩ Mission authorization ∩ Agent envelope ∩ device permissions ∩ exact Host-offered operation', rows: subset(['E16', 'E17', 'E18', 'E19', 'E20', 'E21', 'E22', 'E23', 'E24', 'E25', 'E37']) });
write('device-signout-invalidation.json', { rows: subset(['E30', 'E31', 'E32', 'E33', 'E34', 'E49']) });
write('revocation-race-results.json', { rows: subset(['E35', 'E36']) });
write('concurrent-admission-results.json', { rows: subset(['E37', 'E39']), additional: ['T9R four-way phone/desktop race resolves one request exactly once', 'T9R concurrent desktop and phone approval has one canonical winner and one effect'].map(status) });
write('host-restart-recovery.json', { rows: subset(['E23', 'E38', 'E53']), additional: ['F02-ST1:', 'F02-ST2:', 'F02-R2-6:', 'T9R Host restart: same Host UUID', 'A07/A08: pause survives a real Host restart'].map(status) });
write('provider-routing-authority.json', { rows: subset(['E40', 'E41', 'E42', 'E43', 'E44']) });
// Regression inventory: one summary block per node --test invocation, in log order (scripts, lib, agent, UI).
const blocks = [];
for (const m of log.matchAll(/ℹ tests (\d+)\r?\nℹ suites \d+\r?\nℹ pass (\d+)\r?\nℹ fail (\d+)\r?\nℹ cancelled (\d+)\r?\nℹ skipped (\d+)\r?\nℹ todo (\d+)/g))
  blocks.push({ tests: +m[1], pass: +m[2], fail: +m[3], cancelled: +m[4], skipped: +m[5], todo: +m[6] });
const labels = ['scripts (scripts/*.test.mjs)', 'lib + missions + device (src/lib ... src/lib/bunny-missions/*.test.ts)', 'agent runtime + recovery', 'UI (src/components/island/*.test.ts)'];
const suites = blocks.map((block, i) => ({ suite: labels[i] ?? `block ${i}`, ...block }));
const sum = (key) => suites.reduce((total, suite) => total + suite[key], 0);
const f02Names = [...passed, ...failed].filter((name) => name.startsWith('F02-'));
write('regression-inventory.json', {
  floor: 1148, floorSource: 'BUNNY_MA3_T9R_F01_PASS (1,148 green)',
  suites, total: { tests: sum('tests'), pass: sum('pass'), fail: sum('fail'), cancelled: sum('cancelled'), skipped: sum('skipped'), todo: sum('todo') },
  distinctTestNames: passed.size + [...failed].filter((name) => !passed.has(name)).length,
  noDoubleCounting: 'Each suite is one node --test invocation over disjoint files; totals add the four summary blocks once each.',
  f02NewTests: { count: f02Names.length, failing: f02Names.filter((name) => failed.has(name)) },
  floorMet: sum('pass') >= 1148 && sum('fail') === 0 && sum('skipped') === 0 && sum('cancelled') === 0,
});
console.log(JSON.stringify({ suites, total: sum('tests'), pass: sum('pass'), fail: sum('fail'), skipped: sum('skipped') }));
console.log(JSON.stringify({ rows: matrix.length, pass: matrix.filter((r) => r.result === 'PASS').length, fail: matrix.filter((r) => r.result !== 'PASS').map((r) => ({ id: r.id, missing: r.supportingEvidence.filter((s) => s.result !== 'PASS') })) }, null, 1));
