// MA4-S2-T3R1 diagnostic: compare two V8 heap snapshots by constructor (count and self size). Never shipped.
//   node scripts/ma4-s2t3r1/heap-diff.mjs <before.heapsnapshot> <after.heapsnapshot> [top]
import { readFileSync } from 'node:fs';

function summarize(file) {
  const snap = JSON.parse(readFileSync(file, 'utf8')), meta = snap.snapshot.meta, fields = meta.node_fields, n = fields.length;
  const types = meta.node_types[0], iType = fields.indexOf('type'), iName = fields.indexOf('name'), iSize = fields.indexOf('self_size');
  const by = new Map();
  for (let i = 0; i < snap.nodes.length; i += n) {
    const type = types[snap.nodes[i + iType]];
    const key = type === 'object' || type === 'closure' ? `${type}:${snap.strings[snap.nodes[i + iName]]}` : type;
    const e = by.get(key) ?? { count: 0, size: 0 }; e.count++; e.size += snap.nodes[i + iSize]; by.set(key, e);
  }
  return by;
}
const [a, b, top = '25'] = process.argv.slice(2);
const A = summarize(a), B = summarize(b), rows = [];
for (const [k, v] of B) { const u = A.get(k) ?? { count: 0, size: 0 }; rows.push({ key: k, dCount: v.count - u.count, dKB: +((v.size - u.size) / 1024).toFixed(1), count: v.count }); }
rows.sort((x, y) => y.dKB - x.dKB);
console.log(JSON.stringify(rows.slice(0, Number(top)), null, 1));
