import { readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../../..');
const ev = join(root, 'test-results/ma3/t13-2');
const json = (path) => JSON.parse(readFileSync(path, 'utf8'));
const source = json(join(ev, 'regression-summary.json'));
const pkg = json(join(ev, 'package-results.json'));
const production = json(join(ev, 'production-preservation.json'));
const names = [
  't132-r4-settled-dev.png', 't132-r4-settled-dev-mobile.png', 't132-r4-settled-dev.json',
  't132-r4-settled-built.png', 't132-r4-settled-built-mobile.png', 't132-r4-settled-built.json',
  't132-r4-package-built.png', 't132-r4-package-built-mobile.png', 't132-r4-package-built.json',
  't132-r4-account-limits.jpg', 't132-r4-account-limits-mobile.jpg',
  't132-budget-blocked.jpg', 't132-final-connected-accounts.jpg',
];
for (const name of names) copyFileSync(join(root, 'screenshots', name), join(ev, 'ui', name));
const smoke = names.filter((name) => name.endsWith('.json')).map((name) => ({ name, ...json(join(ev, 'ui', name)) }));
for (const verdict of smoke) {
  if (verdict.ok === false || verdict.divergesFromBaseline || verdict.brandWarnings?.length || verdict.authWarnings?.length) throw Error('Browser gate failed: ' + verdict.name);
  for (const viewport of Object.values(verdict.viewports ?? {})) {
    if (viewport.horizontalOverflow || viewport.consoleErrors?.length || viewport.pageErrors?.length || !viewport.bodyTextLen) throw Error('Viewport gate failed: ' + verdict.name);
  }
}
if (source.result !== 'PASS' || source.total !== source.distinct || source.baselineMissing.length || pkg.sourceCommit !== source.sourceCommit || !pkg.verification.files.ok || !pkg.verification.source.ok || !pkg.verification.closure.ok || pkg.disposableHostAcceptance.result !== 'PASS' || !production.unchanged || !production.releaseFiles.ok) throw Error('Release gate failed');
const prior = json(join(ev, 'ui/browser-qa.json'));
writeFileSync(join(ev, 'ui/browser-qa.json'), JSON.stringify({
  ...prior,
  sourceCommit: source.sourceCommit,
  classification: 'LIVE VERIFIED supported CUA; final-source desktop/390x844 account limits and final connected preview; fresh dev, Windows built output and exact R4 packaged output smoke',
  earlierAffordanceSource: '60046c74a3dd903f026c9ac2b189524e5c732fe5',
  checked: [...new Set([...prior.checked,
    'Final-source labelled optional native/local daily Task-start limits, native USD ceilings and valid bounded inputs',
    'Signed-in Claude account with zero Task-start cap displays Budget blocked; disposable development cap cleared afterward',
    'Final-source ten-card Connected Accounts preview online, identities masked, empty API fields and no console errors',
    'Final-source dev and Windows build desktop/mobile screenshots visually inspected; no baseline divergence',
    'Exact R4 package desktop/mobile smoke and settings screenshots visually inspected',
  ])],
  finalSmokeFiles: smoke.map((s) => s.name),
  visualInspection: 'Desktop and mobile dev/built screenshots inspected in one batch; visible readable content, no overlap or horizontal overflow. R4 package and account-limit screenshots also inspected.',
}, null, 2) + '\n');

const gates = [
  '| Gate | Final result |', '|---|---|',
  `| Exact-source regression | **${source.distinct}/${source.total} distinct PASS**: scripts ${source.parts.scripts.pass}, library ${source.parts.library.pass}, Agent ${source.parts.agent.pass}, UI ${source.parts.ui.pass}; zero skips/cancellations/TODOs |`,
  `| Accepted baseline retention | **${source.baselineRetained}/${source.baseline.distinct} retained**: ${source.baselineRetainedExact} exact names + ${source.baselineRevised.length} one-to-one revised contracts; ${source.newDistinct} new cases; zero missing. Full names and mappings in regression-inventory.json / baseline-retention-map.json |`,
  '| Typecheck / lint / build | All exit 0 at final source; lint has 0 errors and the same 27 baseline warnings. Windows desktop build also passed |',
  '| Dev / Windows built browser | Desktop and 390×844 mobile have visible content, zero console/page errors, zero overflow and zero brand/auth warnings; settled Windows build does not diverge from dev |',
  '| Exact R4 package browser | Desktop/mobile PASS; account-limit settings inspected through CUA. Package processes stopped after QA; development preview left running |',
  `| Windows package | ${pkg.release}, version ${pkg.version}; source/tooling both ${pkg.sourceCommit}. Manifest ${pkg.verification.files.checked}/${pkg.verification.files.checked} files match, ${pkg.verification.source.checked} source origins match and complete import closure passes |`,
  `| Packaged disposable Host | **${pkg.disposableHostAcceptance.passed}/${pkg.disposableHostAcceptance.checks} checks PASS**, including genuine Windows DPAPI synthetic-key save/restart/remove, 14 paired-phone owner-action denials and redaction; ${pkg.disposableHostAcceptance.providerInferenceCalls} inference / ${pkg.disposableHostAcceptance.providerMetadataCalls} metadata / ${pkg.disposableHostAcceptance.typesafeCalls} TypeSafe calls |`,
  `| ZIP | ${pkg.archive.bytes} bytes; SHA-256 **${pkg.archive.sha256}**; archive excluded from Git, pinned by package-results.json |`,
  `| Installed production | **Unchanged**; ${production.releaseFiles.checked}/${production.releaseFiles.checked} installed file hashes match; install metadata, manifest and Startup link hashes unchanged. No installation or restart |`,
  '| Independent review | All demonstrated HIGH/BLOCKER findings closed at the exact final source; reviewer limitations and evidence follow-through retained in independent-review.md |',
  '| Evidence | INDEX.md and INDEX.sha256 are reproducible byte seals. Verify with the retained seal-evidence.mjs --verify; final evidence commit is supplied in the handoff |',
  '',
  'The first final-source library run encountered an unchanged Windows temporary-directory cleanup `EPERM` after the affected network assertions passed. Its failed log is retained as regression-final/library-cleanup-failed.log. The complete unchanged library suite was rerun sequentially at the same source: all 1,501 tests passed. No test was removed, weakened or counted twice. Other suite groups passed on their first final-source run.',
  '',
  'Production proof uses the actual installed MA3-T13-FINAL-TEST folder discovered on this PC, rather than the outdated example path in the recovered brief. The isolated final Windows preview build uses the release dashboard target; the default deployment build/typecheck/lint gates also passed. Earlier smoke results captured before Host hydration are retained as superseded evidence and are not the final browser verdict.',
].join('\n');
const template = readFileSync(join(ev, 'acceptance-template.md'), 'utf8')
  .replace(', subject to the final gate data inserted below', '')
  .replace('{{FINAL_GATE_DATA}}', gates);
writeFileSync(join(root, 'MA3_T13_2_UNIFIED_ACCOUNTS_ACCEPTANCE.md'), template);
console.log(JSON.stringify({ result: 'PASS', sourceCommit: source.sourceCommit, distinct: source.distinct, copiedScreenshotsAndVerdicts: names.length, report: 'MA3_T13_2_UNIFIED_ACCOUNTS_ACCEPTANCE.md' }));
