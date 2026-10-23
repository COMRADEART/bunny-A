import assert from 'node:assert/strict';
import { freemem, totalmem } from 'node:os';
import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const base = 'http://127.0.0.1:11434', model = 'qwen2.5-coder:7b';
const api = async (path, body) => {
  const r = await fetch(base + path, { signal: AbortSignal.timeout(60000), ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
  assert.ok(r.ok); return r.json();
};
const tags = (await api('/api/tags')).models; const tag = tags.find(m => m.name === model);
assert.ok(tag && !tag.remote_host && !tag.remote_model && tag.size < 5e9);
assert.equal((await api('/api/ps')).models.length, 0, 'Do not displace an existing model user.');
assert.ok(freemem() > 7 * 1024 ** 3);
const evidence = { model, digest: tag.digest, at: new Date().toISOString(), totalBytes: totalmem(), freeBefore: freemem(), samples: [] };
const sample = async () => {
  const gpu = execFileSync('nvidia-smi', ['--query-gpu=memory.used,utilization.gpu', '--format=csv,noheader,nounits'], { timeout: 3000, windowsHide: true, encoding: 'utf8' }).trim();
  evidence.samples.push({ at: Date.now(), freeBytes: freemem(), gpu, ps: await api('/api/ps') });
};
const generate = async (options, label) => {
  const start = Date.now();
  const r = await api('/api/generate', { model, prompt: 'Count from one to ten using words.', stream: false, keep_alive: '1m', options: { num_ctx: 2048, num_predict: 24, temperature: 0, seed: 42, ...options } });
  assert.equal(r.model, model); assert.equal(r.done, true);
  return { label, start, end: Date.now(), latencyMs: Date.now() - start, evalCount: r.eval_count, evalDurationNs: r.eval_duration,
    tokensPerSecond: r.eval_count / (r.eval_duration / 1e9), loadDurationNs: r.load_duration };
};
let busy = false;
const timer = setInterval(() => { if (!busy) { busy = true; sample().catch(() => {}).finally(() => { busy = false; }); } }, 1000);
try {
  evidence.cpu = await generate({ num_gpu: 0 }, 'explicit CPU request');
  evidence.cpuPs = await api('/api/ps'); await api('/api/generate', { model, keep_alive: 0 });
  evidence.gpu = await generate({}, 'default backend request'); evidence.gpuPs = await api('/api/ps');
  assert.ok(freemem() > 6 * 1024 ** 3, 'Do not start concurrent requests without resource margin.');
  evidence.concurrent = await Promise.all([generate({}, 'concurrent A'), generate({}, 'concurrent B')]);
  evidence.concurrencyInterpretation = 'Two simultaneous client requests; server may queue/serialize them. Client overlap does not establish two parallel GPU executions.';
} finally {
  clearInterval(timer); while (busy) await new Promise(r => setTimeout(r, 10));
  await api('/api/generate', { model, keep_alive: 0 }); evidence.finalPs = await api('/api/ps'); evidence.freeAfter = freemem();
  writeFileSync('docs/ma4-s1r/evidence/hardware-controlled.json', JSON.stringify(evidence, null, 2) + '\n');
}
console.log(JSON.stringify({ cpu: evidence.cpu, gpu: evidence.gpu, concurrent: evidence.concurrent }));
