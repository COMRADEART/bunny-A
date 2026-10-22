import { z } from 'zod';
import { WorkerArtifactSchema } from '../../src/lib/bunny-host/ma4/coding-workflow.server.ts';
const withPattern = z.toJSONSchema(WorkerArtifactSchema);
const without = JSON.parse(JSON.stringify(withPattern)); delete without.properties.dependencies.items.pattern;
const prompt = 'You are the Worker agent. Implement a Python module duration with parse_duration(text) converting "1h30m" to seconds; raise ValueError otherwise. Allowed imports: re, typing. Return JSON: source, notes, dependencies (module names imported), files (["duration.py"]).';
const one = async (format, seed) => { const t = Date.now(); const r = await fetch('http://127.0.0.1:11434/api/generate', { method: 'POST', body: JSON.stringify({ model: 'qwen2.5-coder:7b', prompt, format, stream: false, options: { num_ctx: 8192, num_predict: 2048, seed } }) }); const body = await r.text(); return { status: r.status, ms: Date.now() - t, err: r.status !== 200 ? body.slice(0, 300) : null }; };
for (const [name, format] of [['pattern', withPattern], ['no-pattern', without]]) {
  const res = [];
  for (let i = 0; i < 5; i++) res.push(...await Promise.all([one(format, 2 * i), one(format, 2 * i + 1)]));
  console.log(name, JSON.stringify({ n: res.length, s500: res.filter(x => x.status === 500).length, errs: [...new Set(res.filter(x => x.err).map(x => x.err))] }));
}
