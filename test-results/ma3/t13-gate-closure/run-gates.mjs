// Reproduce T13 gates without overwriting historical receipts in the working checkout.
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, cpSync, symlinkSync, lstatSync } from 'node:fs';
import { join, resolve, dirname, relative } from 'node:path';

const evidence = import.meta.dirname;
const root = resolve(evidence, '../../..');
const validation = join(evidence, 'validation-checkout');
const pinnedSource = 'b23005136c48036968036475e841dcf67a38a794';
const mode = process.argv[2];
const outputName = process.argv[3] ?? mode;
if (!/^[a-z0-9-]+$/.test(outputName)) throw new Error('Invalid evidence log name.');
const git = (args, cwd = root) => execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
const sha = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const json = (name, value) => writeFileSync(join(evidence, name), JSON.stringify(value, null, 2) + '\n');
const inventory = () => {
  const entries = git(['status', '--porcelain=v1', '-z', '--untracked-files=all']).split('\0').filter(Boolean);
  return entries.filter(line => !line.slice(3).startsWith('test-results/ma3/t13-gate-closure/')).map(line => {
    const path = line.slice(3);
    const absolute = join(root, path);
    const file = existsSync(absolute) && lstatSync(absolute).isFile();
    return { status: line.slice(0, 2), path, ...(file ? { sha256: sha(absolute) } : {}) };
  });
};
mkdirSync(evidence, { recursive: true });
if (mode === 'prepare') {
  if (existsSync(validation)) throw new Error('Refusing to overwrite an existing validation checkout.');
  const baseline = { startingSha: git(['rev-parse', 'HEAD']).trim(), branch: git(['branch', '--show-current']).trim(), node: process.version, npm: execFileSync('cmd.exe', ['/d', '/c', 'npm --version'], { encoding: 'utf8' }).trim(), recordedAt: new Date().toISOString(), entries: inventory() };
  json('workspace-before.json', baseline);
  git(['clone', '--shared', '--no-hardlinks', root, validation]);
  git(['checkout', '--detach', pinnedSource], validation);
  symlinkSync(join(root, 'node_modules'), join(validation, 'node_modules'), 'junction');
  // Copy pinned ignored voice dependencies; builds in this checkout must not write through to the original.
  for (const path of ['native/voice/vendor/runtime', 'native/voice/vendor/whisper-src-v1.9.4/whisper.cpp-1.9.4/include', 'native/voice/vendor/whisper-src-v1.9.4/whisper.cpp-1.9.4/ggml/include']) {
    if (existsSync(join(root, path))) cpSync(join(root, path), join(validation, path), { recursive: true });
  }
  const notice = 'releases/installed/JEV-Windows-v1/runtime/LICENSE';
  if (existsSync(join(root, notice))) { mkdirSync(dirname(join(validation, notice)), { recursive: true }); copyFileSync(join(root, notice), join(validation, notice)); }
  const sourceStatus = git(['status', '--porcelain=v1', '--untracked-files=no'], validation).trim();
  if (sourceStatus) throw new Error('Validation source is not clean: ' + sourceStatus);
  json('validation-source.json', { sourceSha: git(['rev-parse', 'HEAD'], validation).trim(), trackedStatusBefore: sourceStatus, strategy: 'local shared-object clone; separate working files, receipts and voice dependencies; shared node_modules junction (tool caches may be written)', commands: ['git clone --shared --no-hardlinks <workspace> <evidence>/validation-checkout'], executableSourceChanges: 0 });
  console.log('Prepared isolated validation checkout at starting SHA.');
} else if (mode === 'preserve') {
  const before = JSON.parse(readFileSync(join(evidence, 'workspace-before.json'), 'utf8'));
  const after = inventory();
  const changed = before.entries.filter(old => !after.some(row => row.path === old.path && row.status === old.status && row.sha256 === old.sha256));
  const additions = after.filter(row => !before.entries.some(old => old.path === row.path));
  json('workspace-preservation.json', { checkedAt: new Date().toISOString(), originalEntries: before.entries.length, changed, additions, pass: changed.length === 0 });
  if (changed.length) throw new Error('Pre-existing workspace entries changed; inspect preservation report.');
  console.log('All pre-existing dirty and untracked file hashes preserved.');
} else {
  const commands = { test: 'npm test', ui: 'npm run test:ui', typecheck: 'npm run typecheck', build: 'npm run build', auth: 'npm run check:auth', remote: 'node --experimental-strip-types --test --test-concurrency=1 src/lib/bunny-host/remote-remediation.test.ts' };
  const command = commands[mode];
  if (!command) throw new Error('Unknown mode.');
  const sourceSha = git(['rev-parse', 'HEAD'], validation).trim();
  const startedAt = new Date().toISOString();
  const start = Date.now();
  const log = createWriteStream(join(evidence, `${outputName}.log`), { flags: 'wx' });
  const redact = text => text.replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]').replace(/("(?:token|accessToken|refreshToken|secret|password|apiKey|api_key)"\s*:\s*")[^"\r\n]+/gi, '$1[REDACTED]').replace(/\b(?:sk-|gh[pousr]_)[A-Za-z0-9_-]{20,}/g, '[REDACTED]');
  const child = spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', command], { cwd: validation, windowsHide: true, env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  for (const stream of [child.stdout, child.stderr]) {
    let pending = '';
    stream.setEncoding('utf8');
    stream.on('data', chunk => { pending += chunk; const lines = pending.split('\n'); pending = lines.pop(); for (const line of lines) log.write(redact(line) + '\n'); });
    stream.on('end', () => { if (pending) log.write(redact(pending)); });
  }
  console.log(`Started ${command}; PID ${child.pid}; isolated source ${sourceSha}.`);
  child.on('error', error => log.write(redact(String(error)) + '\n'));
  child.on('close', (code, signal) => {
    log.end(() => {
      const result = { command, sourceSha, startedAt, finishedAt: new Date().toISOString(), durationMs: Date.now() - start, exitCode: code, signal, log: `${outputName}.log`, logSha256: sha(join(evidence, `${outputName}.log`)), trackedStatusAfter: git(['status', '--porcelain=v1', '--untracked-files=no'], validation).trim() };
      json(`${outputName}-result.json`, result);
      console.log(JSON.stringify(result));
      process.exitCode = code === 0 ? 0 : 1;
    });
  });
}
