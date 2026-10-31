import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createHash } from 'node:crypto';
const root = 'docs/ma4-s1r/evidence';
const scrub = value => value.replaceAll(process.cwd(), '<workspace>').replaceAll(process.cwd().replaceAll('\\','/'), '<workspace>')
  // eslint-disable-next-line no-control-regex -- the scrub intentionally matches ANSI escape sequences to strip them
  .replace(/C:(?:\\+|\/+)[Uu]sers(?:\\+|\/+)[^\s"'<>]+/g, '<user-path>').replace(/\x1b\[[0-9;]*m/g, '');
function visit(path) {
  for (const e of readdirSync(path, { withFileTypes: true })) {
    const file = join(path, e.name); if (e.isDirectory()) { visit(file); continue; }
    if (!/\.(json|log|exit)$/.test(e.name)) continue;
    const bytes = readFileSync(file);
    const input = bytes.toString(bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf16le' : 'utf8').replace(/^\uFEFF/, '');
    let output;
    if (e.name.endsWith('.json')) {
      const walk = value => typeof value === 'string' ? scrub(value) : Array.isArray(value) ? value.map(walk)
        : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([k,v]) => [k,walk(v)])) : value;
      output = JSON.stringify(walk(JSON.parse(input)), null, 2) + '\n';
    } else output = scrub(input);
    writeFileSync(file, output);
  }
}
visit(root);
const manifest = [];
function hashes(path) { for (const e of readdirSync(path, { withFileTypes: true })) { const file = join(path,e.name); if (e.isDirectory()) hashes(file); else if (e.name !== 'manifest.json') {
  const b = readFileSync(file); manifest.push({ path: relative(root,file).replaceAll('\\','/'), bytes: b.length, sha256: createHash('sha256').update(b).digest('hex') });
} } }
hashes(root); writeFileSync(join(root,'manifest.json'), JSON.stringify({ schema: 'bunny-s1r-evidence/1', files: manifest }, null, 2) + '\n');
console.log('Sanitized evidence and refreshed digest manifest.');
