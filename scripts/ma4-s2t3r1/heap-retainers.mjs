// MA4-S2-T3R1 diagnostic: which objects allocated after snapshot A are still alive in snapshot B (same process, so node
// ids are comparable), grouped by the retaining path (up to 4 hops, skipping internal/hidden links). Never shipped.
//   node scripts/ma4-s2t3r1/heap-retainers.mjs <A.heapsnapshot> <B.heapsnapshot> [top]
import { readFileSync } from 'node:fs';

const load = f => JSON.parse(readFileSync(f, 'utf8'));
const [fa, fb, top = '20'] = process.argv.slice(2);
const A = load(fa), maxId = (() => { const n = A.snapshot.meta.node_fields.length, iId = A.snapshot.meta.node_fields.indexOf('id'); let m = 0; for (let i = 0; i < A.nodes.length; i += n) m = Math.max(m, A.nodes[i + iId]); return m; })();
const S = load(fb), meta = S.snapshot.meta, nf = meta.node_fields.length, ef = meta.edge_fields.length;
const iType = meta.node_fields.indexOf('type'), iName = meta.node_fields.indexOf('name'), iId = meta.node_fields.indexOf('id'), iSize = meta.node_fields.indexOf('self_size'), iEdges = meta.node_fields.indexOf('edge_count');
const eType = meta.edge_fields.indexOf('type'), eName = meta.edge_fields.indexOf('name_or_index'), eTo = meta.edge_fields.indexOf('to_node');
const ntypes = meta.node_types[0], etypes = meta.edge_types[0], N = S.nodes.length / nf;
const name = i => { const t = ntypes[S.nodes[i * nf + iType]]; return t === 'object' || t === 'closure' || t === 'native' ? `${t}:${S.strings[S.nodes[i * nf + iName]]}` : t; };
const retainers = Array.from({ length: N }, () => []);
for (let i = 0, e = 0; i < N; i++) for (let k = 0; k < S.nodes[i * nf + iEdges]; k++, e += ef) {
  const et = etypes[S.edges[e + eType]]; if (et === 'weak' || et === 'shortcut') continue;
  const to = S.edges[e + eTo] / nf, label = et === 'element' || et === 'hidden' ? `[${S.edges[e + eName]}]` : S.strings[S.edges[e + eName]];
  retainers[to].push({ from: i, label, internal: et === 'internal' || et === 'hidden' });
}
const fresh = i => S.nodes[i * nf + iId] > maxId;
const path = i => {
  const hops = []; let cur = i;
  for (let h = 0; h < 4000 && hops.length < (process.env.DEEP ? 4000 : 4); h++) {
    const r = retainers[cur].find(x => !x.internal && !fresh(x.from)) ?? retainers[cur].find(x => !x.internal) ?? retainers[cur][0];
    if (!r) break; const hop = `${name(r.from)}.${r.label}`; if (!process.env.DEEP || !hop.startsWith('concatenated') || hops.at(-1) !== hop) hops.push(hop); cur = r.from; if (!fresh(cur) && !(process.env.DEEP && name(cur) === 'concatenated string')) break;
  }
  return hops.join(' <- ');
};
const groups = new Map();
for (let i = 0; i < N; i++) {
  if (!fresh(i) || ['code', 'hidden', 'object shape', 'synthetic'].includes(ntypes[S.nodes[i * nf + iType]])) continue;
  const key = `${name(i)}  <=  ${path(i)}`, g = groups.get(key) ?? { count: 0, bytes: 0 }; g.count++; g.bytes += S.nodes[i * nf + iSize]; groups.set(key, g);
}
const rows = [...groups].map(([key, g]) => ({ key, ...g })).sort((a, b) => b.bytes - a.bytes).slice(0, Number(top));
for (const r of rows) console.log(`${String(r.count).padStart(6)} ${String((r.bytes / 1024).toFixed(1)).padStart(8)} KB  ${r.key}`);
