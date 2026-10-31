// MA4-S2-T3R1 Phase B diagnostic (docs/ma4-s2-t3r1/MEMORY_AND_PROCESS_ANALYSIS.md): does the Host retain memory per
// unit of work? The production Host entry in-process on an isolated data directory; the soak's operations repeated fast
// (task create â†’ approve â†’ complete, schedule create â†’ approve â†’ cancel, /state). After every block: two full GCs, then
// heap and RSS. Retention = least-squares slope of post-GC heapUsed per round. Diagnostic only; --expose-gc is never used
// by the product.
//   node --expose-gc --experimental-strip-types scripts/ma4-s2t3r1/retention-stress.mjs [--rounds 1500] [--out file.json] [--snap dir]
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import v8 from 'node:v8';
import { runHostEntry } from '../../src/lib/bunny-host/entry.server.ts';

if (typeof globalThis.gc !== 'function') throw new Error('run with --expose-gc');
const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : fallback; };
const ROUNDS = Number(arg('--rounds', '1500')), BLOCK = 100, SNAP = arg('--snap', null);
const free = () => new Promise(r => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const data = mkdtempSync(join(tmpdir(), 'bunny-s2t3r1-retention-')), project = mkdtempSync(join(homedir(), 'Documents', 'bunny-retention-'));
writeFileSync(join(project, 'STATUS.md'), 'Synthetic status file.\n');
const port = await free(), host = await runHostEntry({ dataDirectory: data, root: project, port, adapters: [] });
const auth = { connection: 'close', Authorization: `Bearer ${host.token}` };
const cmd = async (action, d = {}) => { const r = await fetch(`http://127.0.0.1:${port}/command`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ action, data: d }) }); const b = await r.json(); if (r.status !== 200) throw new Error(`${action}: ${b.error}`); return b.data; };
let stateBytes = 0;
const state = async () => { const t = await (await fetch(`http://127.0.0.1:${port}/state`, { headers: auth })).text(); stateBytes = Buffer.byteLength(t); return JSON.parse(t); };
const DAY = 86_400_000, envelope = () => ({ capabilities: ['file.read', 'file.stat'], providers: ['ollama'], localOnly: true, models: [], projectScopes: ['soak'], sideEffects: false, background: true,
  budgets: { maxModelCalls: 0, maxWallMs: 60_000 }, expiresAt: Date.now() + DAY, grants: { files: [{ root: 'soak', access: 'read' }] } });
const spec = title => ({ title, projectId: 'soak', acceptance: { requiredSteps: ['read', 'stat'] }, steps: [{ id: 'read', kind: 'file.read', input: { root: 'soak', path: 'STATUS.md' } }, { id: 'stat', kind: 'file.stat', input: { root: 'soak', path: 'STATUS.md' } }] });
const measure = round => { globalThis.gc(); globalThis.gc(); const m = process.memoryUsage(), h = v8.getHeapStatistics(); return { round, heapUsedMB: +(m.heapUsed / 2 ** 20).toFixed(2), rssMB: +(m.rss / 2 ** 20).toFixed(1), externalMB: +(m.external / 2 ** 20).toFixed(2), arrayBuffersMB: +(m.arrayBuffers / 2 ** 20).toFixed(2), contexts: h.number_of_native_contexts, resources: process.getActiveResourcesInfo().length, stateKB: Math.round(stateBytes / 1024) }; };
const series = [];
try {
  await cmd('connector.roots.set', { roots: [{ id: 'soak', label: 'Soak', path: project }] });
  await cmd('ptask.policy', { policy: { background: true, resumeOnStart: false } });
  series.push(measure(0)); if (SNAP) v8.writeHeapSnapshot(join(SNAP, 'retention-0.heapsnapshot'));
  for (let round = 1; round <= ROUNDS; round++) {
    const t = await cmd('ptask.create', { spec: spec(`Stress ${round}`), envelope: envelope() });
    await cmd('ptask.approve', { id: t.id });
    for (let i = 0; i < 200 && (await cmd('ptask.get', { id: t.id })).state !== 'COMPLETED'; i++) await new Promise(r => setTimeout(r, 10));
    const at = new Date(Date.now() + 3_600_000).toISOString().slice(0, 16);
    const s = await cmd('schedule.create', { spec: { title: `Stress reminder ${round}`, projectId: 'soak', trigger: { type: 'once', at, timeZone: 'UTC' }, action: { type: 'remind', text: 'x' }, expiresAt: Date.now() + DAY } });
    await cmd('schedule.approve', { id: s.id, ttlMs: DAY }); await cmd('schedule.cancel', { id: s.id });
    await state();
    if (round % BLOCK === 0) { series.push(measure(round)); console.error(JSON.stringify(series.at(-1))); }
    if (SNAP && round === Math.floor(ROUNDS / 3)) v8.writeHeapSnapshot(join(SNAP, `retention-${round}.heapsnapshot`));
  }
  if (SNAP) v8.writeHeapSnapshot(join(SNAP, `retention-${ROUNDS}.heapsnapshot`));
} finally {
  await host.close().catch(() => undefined);
  rmSync(data, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); rmSync(project, { recursive: true, force: true, maxRetries: 10 });
}
// Slope after the first block (warm-up), bytes per round.
const s = series.filter(x => x.round >= BLOCK), mx = s.reduce((a, x) => a + x.round, 0) / s.length, my = s.reduce((a, x) => a + x.heapUsedMB, 0) / s.length;
const kbPerRound = s.length > 2 ? +(s.reduce((n, x) => n + (x.round - mx) * (x.heapUsedMB - my), 0) / s.reduce((n, x) => n + (x.round - mx) ** 2, 0) * 1024).toFixed(3) : null;
const result = { rounds: ROUNDS, node: process.version, kbPerRoundAfterWarmup: kbPerRound, series };
if (arg('--out', null)) writeFileSync(arg('--out'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ rounds: ROUNDS, kbPerRoundAfterWarmup: kbPerRound, first: series[1] ?? null, last: series.at(-1) }));
