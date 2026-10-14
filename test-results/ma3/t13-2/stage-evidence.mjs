// Stage only the exact sealed artifacts. Never force-add an evidence directory.
import { readFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const ev = resolve(import.meta.dirname), root = resolve(ev, '../../..');
const git = (args) => execFileSync('git', args, { cwd: root, maxBuffer: 128 * 1024 * 1024 });
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const roots = new Set(['.gitattributes', 'MA3_T13_2_UNIFIED_ACCOUNTS_ACCEPTANCE.md', 'docs/t13-2/BUNNY_A_T13_2_DESIGN.md']);
const records = readFileSync(resolve(ev, 'INDEX.sha256'), 'utf8').trim().split(/\r?\n/).map((line) => {
  const match = /^([0-9a-f]{64})  (.+)$/.exec(line);
  if (!match) throw Error('Malformed seal');
  const path = match[2], absolute = resolve(root, path);
  if ((!roots.has(path) && !absolute.startsWith(ev + sep)) || /(?:^|\/)(?:temp|tmp-[^/]*|source-checkout|windows-package|node_modules)(?:\/|$)|credentials|\.sqlite|\.zip$/i.test(path)) throw Error('Forbidden evidence path: ' + path);
  if (sha(readFileSync(absolute)) !== match[1]) throw Error('Working byte mismatch: ' + path);
  return { path, sha256: match[1] };
});
const sealPath = 'test-results/ma3/t13-2/INDEX.sha256';
const selected = [...records.map((r) => r.path), sealPath];
if (new Set(selected).size !== selected.length) throw Error('Duplicate evidence entry');
if (process.argv[2] === '--stage') {
  if (git(['diff', '--cached', '--name-only']).toString().trim()) throw Error('Index is not empty; preserve existing staged work');
  for (let offset = 0; offset < selected.length; offset += 40) git(['add', '-f', '--', ...selected.slice(offset, offset + 40)]);
} else if (process.argv[2] !== '--verify') throw Error('Use --stage or --verify');
const staged = git(['diff', '--cached', '--name-only', '-z']).toString().split('\0').filter(Boolean);
if (staged.length !== selected.length || staged.some((p) => !selected.includes(p))) throw Error('Unexpected staged paths');
for (const record of records) if (sha(git(['show', ':' + record.path])) !== record.sha256) throw Error('Staged byte mismatch: ' + record.path);
if (sha(git(['show', ':' + sealPath])) !== sha(readFileSync(resolve(root, sealPath)))) throw Error('Staged seal differs');
console.log(JSON.stringify({ result: 'PASS', staged: staged.length, sealedBlobs: records.length, sourceCommit: JSON.parse(readFileSync(resolve(ev, 'regression-summary.json'), 'utf8')).sourceCommit, unrelatedUserFilesStaged: false }));
