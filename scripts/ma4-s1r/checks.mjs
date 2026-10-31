import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
const out = 'docs/ma4-s1r/evidence'; mkdirSync(out, { recursive: true });
const regressionOnly = process.argv.includes('--regression-only');
const finalBuilds = process.argv.includes('--final-builds');
const checks = [];
// eslint-disable-next-line no-control-regex -- the scrub intentionally matches ANSI escape sequences (ESC + CSI) to strip them
const scrub = text => text.replace(/\x1b\[[0-9;]*m/g, '').replaceAll(process.cwd(), '<workspace>').replaceAll(process.cwd().replaceAll('\\', '/'), '<workspace>')
  .replace(/C:[\\/]Users[\\/][^\s\n"'<>]+/gi, '<user-path>').replace(/Bearer\s+[A-Za-z0-9_.-]+/g, 'Bearer <redacted>');
async function run(id, script, env = {}) {
  const at = new Date().toISOString(), start = Date.now(); let output = '';
  const code = await new Promise(resolve => {
    const child = spawn('cmd.exe', ['/d', '/s', '/c', 'npm run ' + script], { windowsHide: true, env: { ...process.env, ...env, BUNNY_MA4_LIVE: '0', NO_COLOR: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', b => { output += b; }); child.stderr.on('data', b => { output += b; });
    child.on('error', e => { output += e.message; resolve(-1); }); child.on('close', code => resolve(code));
  });
  const clean = scrub(output); const summaries = [...clean.matchAll(/(?:ℹ|#) (tests|pass|fail|skipped|cancelled) (\d+)/g)].map(m => [m[1], Number(m[2])]);
  const tail = clean.length > 30000 ? '[Log truncated to final 30000 characters; complete raw-output digest in checks.json.]\n' + clean.slice(-30000) : clean;
  writeFileSync(join(out, id + '.log'), tail);
  checks.push({ id, command: 'npm run ' + script, environment: env, at, durationMs: Date.now() - start, exitCode: code, summaries, rawOutputSha256: createHash('sha256').update(output).digest('hex') });
  writeFileSync(join(out, regressionOnly ? 'recheck.json' : finalBuilds ? 'final-builds.json' : 'checks.json'), JSON.stringify(checks, null, 2) + '\n'); console.log(id + ': ' + code);
}
if (regressionOnly) {
await run('regression-after-prerequisite', 'test');
} else if (finalBuilds) {
await run('ui-final', 'test:ui');
await run('typecheck-final', 'typecheck');
await run('build-mobile-web-final', 'build');
await run('build-desktop-final', 'build', { JEV_DESKTOP_BUILD: '1' });
} else {
await run('regression', 'test');
await run('ui', 'test:ui');
await run('typecheck', 'typecheck');
// Sequential builds share output/cache; never race two builds.
await run('build-mobile-web', 'build');
await run('build-desktop', 'build', { JEV_DESKTOP_BUILD: '1' });
}
if (checks.some(c => c.exitCode !== 0)) process.exitCode = 1;
