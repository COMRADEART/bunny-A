// Seal only reviewable, sanitized evidence; never stage the local validation repository or Android class files.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
const root = import.meta.dirname;
const excluded = new Set(['validation-checkout', 'INDEX.sha256', 'INDEX.md', 'secret-scan.json', 'commit-files.json']);
const paths = [];
function walk(directory) {
  for (const item of readdirSync(directory)) {
    if (excluded.has(item) || item === '.git' || item === 'node_modules') continue;
    const path = join(directory, item);
    if (statSync(path).isDirectory()) walk(path);
    else if (!/\.(?:class|exe|dll|jar|apk|bin)$/i.test(item)) paths.push(path);
  }
}
walk(root);
const patterns = [
  ['bearer-value', /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}/g],
  ['json-secret-value', /"(?:token|accessToken|refreshToken|secret|password|apiKey|api_key|pairCode)"\s*:\s*"[A-Za-z0-9._~+/=-]{16,}"/gi],
  ['provider-key', /\b(?:sk-|gh[pousr]_)[A-Za-z0-9_-]{20,}/g],
  ['google-key', /\bAIza[0-9A-Za-z_-]{30,}/g],
  ['aws-key', /\bAKIA[0-9A-Z]{16}\b/g],
  ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g]
];
const findings = [];
for (const path of paths) {
  if (/\.(?:png|jpg|jpeg|webp)$/i.test(path)) continue;
  const lines = readFileSync(path, 'utf8').split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) for (const [name, pattern] of patterns) {
    pattern.lastIndex = 0;
    if (pattern.test(lines[i])) findings.push({ path: relative(root,path).replaceAll('\\','/'), line: i + 1, pattern: name });
  }
}
const report = { scannedFiles: paths.filter(p => !/\.(?:png|jpg|jpeg|webp)$/i.test(p)).length, patternNames: patterns.map(([name])=>name), findingCount: findings.length, findings, screenshots: 'Four desktop/mobile smoke screenshots manually visually inspected; no credentials, pairing codes or private user content shown.', limitation: 'Pattern scan plus visual review; not a proof against every possible secret encoding.' };
writeFileSync(join(root,'secret-scan.json'), JSON.stringify(report,null,2)+'\n');
if (findings.length) { console.log(JSON.stringify({ findingCount: findings.length, findings })); process.exit(1); }
paths.push(join(root,'secret-scan.json'));
paths.sort();
const rows = paths.map(path => ({ path: relative(root,path).replaceAll('\\','/'), sha256: createHash('sha256').update(readFileSync(path)).digest('hex'), bytes: statSync(path).size }));
writeFileSync(join(root,'INDEX.sha256'), rows.map(row=>`${row.sha256}  ${row.path}`).join('\n')+'\n');
writeFileSync(join(root,'INDEX.md'), '# T13 gate-closure evidence index\n\nSource: b23005136c48036968036475e841dcf67a38a794. Disposition: CONDITIONAL PASS; physical Android gate BLOCKED.\n\nOnly these files plus this index and INDEX.sha256 are intended for the evidence commit. The source-isolated validation checkout and compiled Android classes are excluded.\n\n| File | Bytes |\n|---|---:|\n'+rows.map(row=>`| ${row.path} | ${row.bytes} |`).join('\n')+'\n');
writeFileSync(join(root,'commit-files.json'), JSON.stringify([...rows.map(row=>row.path),'INDEX.sha256','INDEX.md'],null,2)+'\n');
console.log(JSON.stringify({ sealedFiles: rows.length, secretFindings: findings.length }));
