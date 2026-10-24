// MA4-S2-T3R1 diagnostic preload for the soak Host (docs/ma4-s2-t3r1/MEMORY_AND_PROCESS_ANALYSIS.md). Never shipped.
//   NODE_OPTIONS="--import file:///…/heap-probe.mjs" BUNNY_HEAP_PROBE_DIR=<dir> node scripts/ma4-s2t3r/soak.mjs …
// Active only inside soak-host.mjs. Every minute appends process.memoryUsage(), V8 heap and space statistics and the
// active-resource counts to <dir>/heap.jsonl; writes a heap snapshot when <dir>/snap-<label> appears (then removes it).
// It allocates nothing that the Host keeps and never calls gc().
import { appendFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import v8 from 'node:v8';

const DIR = process.env.BUNNY_HEAP_PROBE_DIR;
if (DIR && process.argv.some(a => a.endsWith('soak-host.mjs'))) {
  const t0 = Date.now();
  const sample = () => {
    const h = v8.getHeapStatistics(), mu = process.memoryUsage();
    const spaces = Object.fromEntries(v8.getHeapSpaceStatistics().map(s => [s.space_name, { size: s.space_size, used: s.space_used_size }]));
    const resources = {}; for (const r of process.getActiveResourcesInfo()) resources[r] = (resources[r] ?? 0) + 1;
    appendFileSync(join(DIR, 'heap.jsonl'), JSON.stringify({ t: Date.now(), pid: process.pid, upMin: Math.round((Date.now() - t0) / 60_000), mu, heap: { total: h.total_heap_size, used: h.used_heap_size, limit: h.heap_size_limit, malloced: h.malloced_memory, external: h.external_memory, contexts: h.number_of_native_contexts, detached: h.number_of_detached_contexts }, spaces, resources }) + '\n');
    for (const f of readdirSync(DIR)) if (f.startsWith(`snap-${process.pid}-`) || f === 'snap-now') {
      rmSync(join(DIR, f), { force: true });
      v8.writeHeapSnapshot(join(DIR, `${process.pid}-${Math.round((Date.now() - t0) / 60_000)}min.heapsnapshot`));
    }
  };
  setInterval(sample, 60_000).unref();
  setTimeout(sample, 5_000).unref();
  if (!existsSync(DIR)) throw new Error(`BUNNY_HEAP_PROBE_DIR ${DIR} does not exist`);
}
