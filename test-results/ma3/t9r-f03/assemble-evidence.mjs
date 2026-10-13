// M-A-3 T9R-F03: derives the finding matrix and regression inventory from full-test-results.log and the live files here.
// Observed results come only from test runner output (✔/✖ lines) and live evidence files, never from hand-written values.
// Usage (repo root): node test-results/ma3/t9r-f03/assemble-evidence.mjs
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
const dir = resolve('test-results/ma3/t9r-f03');
const read = (name) => existsSync(join(dir, name)) ? readFileSync(join(dir, name), 'utf8') : '';
const json = (name) => { try { return JSON.parse(read(name)); } catch { return null; } };
const log = read('full-test-results.log');
const passed = new Set(), failed = new Set();
for (const line of log.split(/\r?\n/)) {
  const m = /^(?:\s*)(✔|✖) (.+?) \(\d+(?:\.\d+)?m?s\)\s*$/.exec(line);
  if (m) (m[1] === '✔' ? passed : failed).add(m[2]);
}
const status = (prefix) => {
  const names = [...new Set([...passed, ...failed])].filter((name) => name.startsWith(prefix));
  return names.length ? { prefix, names, result: names.every((name) => passed.has(name) && !failed.has(name)) ? 'PASS' : 'FAIL' } : { prefix, result: 'NOT_FOUND' };
};
const live = json('live-staging-acceptance.json');
const x53 = json('x53/x53-stability-matrix.json');
const pkg = json('windows-package-results.json');
const before = json('production-before.json'), after = json('production-final.json');
const scan = json('secret-scan.json');
const rows = [
  ['F02-R5-M1', 'F02 round-5 MEDIUM: glob, quoted and variable references', ['F03-C1:', 'F03-R1-3:', 'F03-R3-1:']],
  ['F02-R5-M2', 'F02 round-5 MEDIUM: folder-level tool configuration', ['F03-C2:', 'F03-R1-4:', 'F03-R2-3:']],
  ['F02-R5-M3', 'F02 round-5 MEDIUM: consumer names missing from the lists', ['F03-C3:', 'F03-R1-2:', 'F03-R2-6:']],
  ['F02-R5-M4', 'F02 round-5 MEDIUM: UTF-16 consumers', ['F03-C4:', 'F03-R1-6:', 'F03-R3-2:', 'F03-R3-5:']],
  ['F02-R5-L1', 'F02 round-5 LOW: promotion re-classification without content', ['F03-L1:']],
  ['F02-R5-L2', 'F02 round-5 LOW: Retry revoked grants before its refusal checks', ['F01-R6 (LOW)', 'F02-R4-3:', 'F03-R2-2:']],
  ['F02-R5-L3', 'F02 round-5 LOW: Replan did not stamp one-time answers', ['F03-L3:', 'F03-R1-7:']],
  ['F03-R1', 'F03 review round 1 confirmed findings (default discovery, install files, scan scope, spellings, extension globs, availability)', ['F03-R1-1:', 'F03-R1-2:', 'F03-R1-3:', 'F03-R1-4:', 'F03-R1-5:', 'F03-R1-6:']],
  ['F03-R2', 'F03 review round 2 findings (site generators, note scripts, runner globs, shebang/linked/escaped consumers, availability, formulas, Retry attempt, in-project end-to-end)', ['F03-R2-1:', 'F03-R2-3:', 'F03-R2-4:', 'F03-R2-5:', 'F03-R2-6:', 'F03-R2-7:', 'F03-R2-8:']],
  ['F03-R3', 'F03 review round 3 (verification) findings', ['F03-R3-1:', 'F03-R3-2:', 'F03-R3-3:', 'F03-R3-4:', 'F03-R3-5:']],
  ['F03-AVAIL', 'Ordinary projects keep unreferenced notes/docs/data phone-writable', ['F03-C5:', 'F03-C6:', 'F03-R1-5:', 'F03-R2-7:']],
  ['F01-R27', 'Legacy hold property retained (program outside project) plus in-project refusal', ['F01-R27 (HIGH)', 'F03-R2-1:']],
  ['F02-SUITE', 'All F02 tests unchanged and passing', ['F02-']],
  ['F01-SUITE', 'All F01 tests passing', ['F01-']],
];
const matrix = rows.map(([id, title, prefixes]) => {
  const tests = prefixes.map(status);
  return { id, title, evidenceType: 'in-process Host integration / unit (real MissionManager, SQLite, disposable folders)', supportingTests: tests, result: tests.every((t) => t.result === 'PASS') ? 'PASS' : 'FAIL' };
});
matrix.push({ id: 'LIVE-ACCEPT', title: 'F02 §18 live acceptance re-run on the F03 source (real disposable Host)', evidenceType: 'LIVE disposable Host', file: 'live-staging-acceptance.json', steps: live?.steps?.length ?? 0, result: live?.result === 'PASS' && live.steps.length === 17 ? 'PASS' : 'FAIL' });
matrix.push({ id: 'X53', title: 'T6 Calculator X53, 10 consecutive', evidenceType: 'LIVE Windows UIA', file: 'x53/x53-stability-matrix.json', consecutiveClean: x53?.consecutiveClean ?? null, failedAttempts: x53?.failedAttempts ?? null, result: x53?.consecutiveClean === 10 && x53?.failedAttempts === 0 ? 'PASS' : 'FAIL' });
matrix.push({ id: 'PACKAGE', title: 'Windows package build and packaged-Host boot', evidenceType: 'LIVE packaged node.exe in disposable state', file: 'windows-package-results.json', result: pkg?.result === 'PASS' ? 'PASS' : 'FAIL' });
matrix.push({ id: 'PRODUCTION', title: 'Installed v26 unchanged (read-only before/after)', evidenceType: 'LIVE read-only', files: ['production-before.json', 'production-final.json'], result: before && after && before.currentRelease === after.currentRelease && before.releaseManifest?.sha256 === after.releaseManifest?.sha256 && before.installJsonSha256 === after.installJsonSha256 && JSON.stringify(before.listeners) === JSON.stringify(after.listeners) ? 'PASS' : 'FAIL' });
matrix.push({ id: 'SECRETS', title: 'No credentials in the evidence', evidenceType: 'static scan', file: 'secret-scan.json', result: scan && scan.findings?.length === 0 ? 'PASS' : 'FAIL' });
const write = (name, value) => writeFileSync(join(dir, name), JSON.stringify(value, null, 2) + '\n');
write('finding-matrix.json', { gate: 'M-A-3 T9R-F03', derivedFrom: ['full-test-results.log', 'live-staging-acceptance.json', 'x53/x53-stability-matrix.json', 'windows-package-results.json', 'production-before.json', 'production-final.json', 'secret-scan.json'], rows: matrix, summary: { rows: matrix.length, pass: matrix.filter((r) => r.result === 'PASS').length, fail: matrix.filter((r) => r.result !== 'PASS').map((r) => r.id) } });
const blocks = [];
for (const m of log.matchAll(/ℹ tests (\d+)\r?\nℹ suites \d+\r?\nℹ pass (\d+)\r?\nℹ fail (\d+)\r?\nℹ cancelled (\d+)\r?\nℹ skipped (\d+)\r?\nℹ todo (\d+)/g))
  blocks.push({ tests: +m[1], pass: +m[2], fail: +m[3], cancelled: +m[4], skipped: +m[5], todo: +m[6] });
const labels = ['scripts (scripts/*.test.mjs)', 'lib + missions + device', 'agent runtime + recovery', 'UI (src/components/island/*.test.ts)'];
const suites = blocks.map((block, i) => ({ suite: labels[i] ?? `block ${i}`, ...block }));
const sum = (key) => suites.reduce((total, suite) => total + suite[key], 0);
const f03 = [...passed, ...failed].filter((name) => name.startsWith('F03-'));
write('regression-inventory.json', {
  floor: 1235, floorSource: 'BUNNY_MA3_T9R_F02_PASS_WITH_LIMITATIONS (1,235 green)',
  suites, total: { tests: sum('tests'), pass: sum('pass'), fail: sum('fail'), cancelled: sum('cancelled'), skipped: sum('skipped'), todo: sum('todo') },
  noDoubleCounting: 'Each suite is one node --test invocation over disjoint files; totals add the four summary blocks once each.',
  f03NewTests: { count: f03.length, failing: f03.filter((name) => failed.has(name)) },
  floorMet: sum('pass') >= 1235 && sum('fail') === 0 && sum('skipped') === 0 && sum('cancelled') === 0,
});
console.log(JSON.stringify({ total: sum('tests'), pass: sum('pass'), fail: sum('fail'), skipped: sum('skipped'), f03: f03.length, matrix: matrix.map((r) => `${r.id}:${r.result}`).join(' ') }));
