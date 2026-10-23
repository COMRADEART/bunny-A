// MA4-S2-T2 performance budgets, fixed before measuring (docs/ma4-s2-t2/PERFORMANCE_REPORT.md). Recorded fake model,
// local files and a local synthetic site only. Run alone (not beside the regression suite):
//   node --experimental-strip-types scripts/ma4-s2t2/bench.mjs [out.json]
import { createServer } from 'node:http';
import { createServer as netServer } from 'node:net';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { create, rig } from '../../src/lib/bunny-host/ma4-s2t2-fixtures.ts';
import { startHost } from '../../src/lib/bunny-host/http.server.ts';

const BUDGETS = { fileReadStepP95Ms: 50, search500FilesMs: 1_000, ledgerVerify1000Ms: 200, browserFirstOpenMs: 10_000, browserOpenP95Ms: 3_000, refusedStartMs: 100, heapGrowth100TasksMb: 50 };
const pct = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))] * 10) / 10; };
const results = {};
const read = { files: [{ root: 'proj', access: 'read' }] };

{ // brokered file.read, end to end through the runtime (create -> claim -> broker -> connector -> receipts -> commit)
  const r = await rig();
  r.root('proj', { 'a.txt': 'x'.repeat(10_000) });
  const times = [];
  for (let i = 0; i < 60; i++) { const t0 = performance.now(); const t = create(r, [{ id: 'a', kind: 'file.read', input: { root: 'proj', path: 'a.txt' } }], read); const v = await r.run(t.id); if (v.state !== 'COMPLETED') throw new Error(v.state); times.push(performance.now() - t0); }
  results.fileReadStep = { n: times.length, p50: pct(times, 0.5), p95: pct(times, 0.95), budgetP95: BUDGETS.fileReadStepP95Ms };
  const files = Object.fromEntries(Array.from({ length: 500 }, (_, i) => [`dir${i % 10}/f${i}.md`, `line one\nneedle ${i}\n`]));
  r.root('big', files);
  r.connected.roots.set([...r.connected.roots.list()]);
  let t0 = performance.now();
  const s = create(r, [{ id: 's', kind: 'file.search', input: { root: 'big', query: 'needle 499', content: true } }], { files: [{ root: 'big', access: 'read' }] });
  await r.run(s.id);
  results.search500Files = { ms: Math.round(performance.now() - t0), budget: BUDGETS.search500FilesMs };
  const heap0 = process.memoryUsage().heapUsed;
  for (let i = 0; i < 100; i++) await r.run(create(r, [{ id: 'a', kind: 'file.read', input: { root: 'proj', path: 'a.txt' } }], read).id);
  globalThis.gc?.();
  results.heapGrowth100Tasks = { mb: Math.round((process.memoryUsage().heapUsed - heap0) / 1024 / 1024 * 10) / 10, budget: BUDGETS.heapGrowth100TasksMb, gcExposed: !!globalThis.gc };
  while (r.connected.ledger.verify().entries < 1_000) await r.run(create(r, [{ id: 'a', kind: 'file.read', input: { root: 'proj', path: 'a.txt' } }], read).id);
  t0 = performance.now(); const chain = r.connected.ledger.verify();
  results.ledgerVerify = { entries: chain.entries, ms: Math.round(performance.now() - t0), budget: BUDGETS.ledgerVerify1000Ms };
  await r.close();
}

{ // controlled browser on a local synthetic page
  const site = createServer((_q, res) => { res.writeHead(200, { 'content-type': 'text/html', connection: 'close' }); res.end('<title>Bench</title><h1>Page</h1><p>' + 'text '.repeat(500) + '</p>'); });
  await new Promise(r => site.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${site.address().port}`;
  const r = await rig({ allowLoopback: true });
  try {
    const times = [];
    for (let i = 0; i < 6; i++) { const t0 = performance.now(); const t = create(r, [{ id: 'o', kind: 'browser.open', input: { url: `${origin}/` } }], { origins: [origin] }); const v = await r.run(t.id); if (v.state !== 'COMPLETED') throw new Error(JSON.stringify(v.failure)); times.push(performance.now() - t0); }
    results.browserOpen = { firstMs: Math.round(times[0]), laterP95: pct(times.slice(1), 0.95), note: 'each task starts its own isolated browser', budgetFirst: BUDGETS.browserFirstOpenMs, budgetP95: BUDGETS.browserOpenP95Ms };
  } catch (error) { results.browserOpen = { skipped: String(error).slice(0, 200) }; }
  finally { await r.close(); site.close(); }
}

{ // a refused second Host on an occupied port
  const blocker = netServer(); await new Promise(r => blocker.listen(0, '127.0.0.1', r));
  const dir = mkdtempSync(join(tmpdir(), 'bunny-s2t2-bench-'));
  const t0 = performance.now();
  try { await startHost({ dataDirectory: dir, root: dir, port: blocker.address().port, adapters: [] }); } catch { /* expected */ }
  results.refusedStart = { ms: Math.round(performance.now() - t0), budget: BUDGETS.refusedStartMs };
  blocker.close(); rmSync(dir, { recursive: true, force: true });
}

const met = {
  fileReadStep: results.fileReadStep.p95 <= BUDGETS.fileReadStepP95Ms, search500Files: results.search500Files.ms <= BUDGETS.search500FilesMs,
  ledgerVerify: results.ledgerVerify.ms <= BUDGETS.ledgerVerify1000Ms, heapGrowth100Tasks: results.heapGrowth100Tasks.mb <= BUDGETS.heapGrowth100TasksMb,
  browserOpen: results.browserOpen.skipped ? null : results.browserOpen.firstMs <= BUDGETS.browserFirstOpenMs && results.browserOpen.laterP95 <= BUDGETS.browserOpenP95Ms,
  refusedStart: results.refusedStart.ms <= BUDGETS.refusedStartMs,
};
const report = { schema: 'bunny-a.ma4-s2t2.bench/1', at: new Date().toISOString(), node: process.version, platform: `${process.platform} ${process.arch}`, budgets: BUDGETS, results, met };
console.log(JSON.stringify(report, null, 2));
if (process.argv[2]) writeFileSync(process.argv[2], JSON.stringify(report, null, 2) + '\n');
