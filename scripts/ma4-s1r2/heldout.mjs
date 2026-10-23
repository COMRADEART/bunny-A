// MA4-S1R2 C4: automatic routing vs a fixed coding model on the HELD-OUT split (never used for evidence).
// Pre-registered: auto arm = the real Host routing pipeline (AUTO_LOCAL, the two benchmarked local models) with the
// dev-split reliability evidence imported; fixed arm = qwen2.5-coder:7b. Identical tasks, seeds, options and checks
// (runTask from benchmarks.mjs). 3 samples per task per arm. Paired outcomes reported; no superiority is claimed
// unless an exact two-sided sign test on discordant pairs gives p < 0.05.
import { readFileSync, writeFileSync } from 'node:fs';
import { TASKS } from './bench-tasks.mjs';
import { runTask } from './benchmarks.mjs';
import { HostDatabase } from '../../src/lib/bunny-host/persistence.server.ts';
import { TaskManager } from '../../src/lib/bunny-host/manager.server.ts';
import { OllamaAdapter } from '../../src/lib/bunny-host/adapters.server.ts';
import { ModelCapabilityRegistry } from '../../src/lib/bunny-host/model-capability.server.ts';
import { TestProtector } from '../../src/lib/bunny-host/jev-secrets.server.ts';
import { probeOllama } from '../../src/lib/orch/exec.server.ts';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const FIXED = 'qwen2.5-coder:7b', ALLOWED = ['qwen2.5-coder:7b', 'huihui_ai/qwen2.5-abliterate:7b'], SAMPLES = 3;
const dev = JSON.parse(readFileSync('docs/ma4-s1r2/evidence/bench-dev.json', 'utf8'));
const dir = mkdtempSync(join(tmpdir(), 'bunny-s1r2-heldout-')); const root = join(dir, 'project'); mkdirSync(root);
const db = new HostDatabase(':memory:');
const registry = new ModelCapabilityRegistry(db, { availableProviders: () => ['ollama'], ollamaProbe: async () => { const p = await probeOllama(); return { ...p, models: p.models.filter(m => ALLOWED.includes(m)), remote: p.remote }; } });
const manager = new TaskManager(db, root, [new OllamaAdapter()], { modelRegistry: registry, connections: { protector: new TestProtector(), fetch: async () => { throw new Error('External connection checks disabled.'); } } });
await manager.discover();
const evidenceRows = Object.entries(dev.summary).flatMap(([model, cats]) => Object.entries(cats).filter(([c]) => c !== 'total').map(([category, v]) => ({ provider: 'ollama', model, category, passes: v.passes, samples: v.samples, source: dev.suite })));
manager.ma4.importReliability(evidenceRows, dev.suite);

const out = { suite: dev.suite, split: 'heldout', fixed: FIXED, allowed: ALLOWED, samples: SAMPLES, startedAt: new Date().toISOString(), routing: [], pairs: [] };
const save = () => process.argv.includes('--routing-only') || writeFileSync('docs/ma4-s1r2/evidence/heldout-auto-vs-fixed.json', JSON.stringify(out, null, 2) + '\n');
for (const task of TASKS.filter(t => t.split === 'heldout')) {
  const p = manager['routingPipeline']({ routingText: task.prompt, mode: 'balanced', providers: manager['live'](), constraints: { routingMode: 'AUTO_LOCAL', modelAllowlist: ALLOWED, ...(task.format ? { responseFormat: { type: 'object' } } : {}) }, override: 'auto' });
  const chosen = p.selection.selected?.model_id ?? null;
  out.routing.push({ task: task.id, category: task.category, analyzer: p.requirements.model_intelligence?.category, auto: chosen, reason: p.selection.reason,
    scores: p.selection.order.map(c => ({ model: c.model_id, final: c.final_score, reliability: c.score_components?.find(x => x.name === 'reliability')?.points ?? null })) });
  if (process.argv.includes('--routing-only')) { console.log(JSON.stringify(out.routing.at(-1))); continue; }
  for (let s = 0; s < SAMPLES; s++) {
    const pair = { task: task.id, category: task.category, sample: s, autoModel: chosen };
    for (const [arm, model] of [['auto', chosen], ['fixed', FIXED]]) {
      if (!model) { pair[arm] = { correct: false, reason: 'no eligible candidate' }; continue; }
      const r = await runTask(model, task, s);
      pair[arm] = { model, correct: r.correct, reason: r.reason ?? null, latencyMs: r.latencyMs };
    }
    out.pairs.push(pair); save();
    console.log(`${task.id}#${s} auto(${chosen})=${pair.auto.correct} fixed=${pair.fixed.correct}`);
  }
}
const both = out.pairs.filter(p => p.auto.correct && p.fixed.correct).length, autoOnly = out.pairs.filter(p => p.auto.correct && !p.fixed.correct).length, fixedOnly = out.pairs.filter(p => !p.auto.correct && p.fixed.correct).length;
const n = autoOnly + fixedOnly, k = Math.min(autoOnly, fixedOnly);
const binom = (n, k) => { let c = 1; for (let i = 0; i < k; i++) c = c * (n - i) / (i + 1); return c; };
let tail = 0; for (let i = 0; i <= k; i++) tail += binom(n, i) / 2 ** n;
out.summary = { pairs: out.pairs.length, auto: out.pairs.filter(p => p.auto.correct).length, fixed: out.pairs.filter(p => p.fixed.correct).length, bothCorrect: both, autoOnly, fixedOnly, neither: out.pairs.length - both - autoOnly - fixedOnly,
  signTestP: n ? Math.min(1, 2 * tail) : 1, routedAwayFromFixed: out.routing.filter(r => r.auto !== FIXED).length };
out.summary.conclusion = out.summary.signTestP < 0.05 ? (autoOnly > fixedOnly ? 'auto better (p<0.05)' : 'fixed better (p<0.05)') : 'no statistically supported difference';
out.finishedAt = new Date().toISOString(); save();
console.log(JSON.stringify(out.summary));
for (const m of ALLOWED) await fetch('http://127.0.0.1:11434/api/generate', { method: 'POST', body: JSON.stringify({ model: m, keep_alive: 0 }) }).catch(() => undefined);
