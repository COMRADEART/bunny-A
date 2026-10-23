// MA4-S1R2 local model benchmark, dev split. Usage:
//   node --experimental-strip-types scripts/ma4-s1r2/benchmarks.mjs [--samples 3] [--models a,b]
// Pre-registered: tasks/checks frozen in bench-tasks.mjs; options fixed below; every sample kept; no retries.
// Only local Ollama is reachable (fetch allowlist). Generated Python runs only in the OS-enforced sandbox.
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { freemem, totalmem, cpus } from 'node:os';
import { spawnSync } from 'node:child_process';
import { z } from 'zod';
import { CATEGORIES, RUNNER, SUITE_VERSION, TASKS, TOOL_SPECS, extractSource } from './bench-tasks.mjs';
import { runSandboxed, sandboxAvailability } from '../../src/lib/bunny-host/ma4/sandbox.server.ts';
import { ollamaChat, ollamaToolCapability, runToolLoop } from '../../src/lib/bunny-host/ma4/ollama-tools.server.ts';
import { decide } from '../../src/lib/bunny-missions/authorization.server.ts';

const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : fallback; };
const SAMPLES = Number(arg('--samples', '3'));
const SPLIT = arg('--split', 'dev');
const OUT = arg('--out', `docs/ma4-s1r2/evidence/bench-${SPLIT}.json`);
const OPTIONS = { temperature: 0.2, num_ctx: 4096, num_predict: 900 };
const OLLAMA = 'http://127.0.0.1:11434';

const realFetch = globalThis.fetch; let refused = 0;
globalThis.fetch = async (input, init) => {
  const url = new URL(String(input));
  if (url.origin !== OLLAMA) { refused++; throw new Error('Benchmark network allowlist refused ' + url.origin); }
  return realFetch(input, init);
};
const api = async (path, body, ms = 300_000) => { const r = await fetch(OLLAMA + path, { signal: AbortSignal.timeout(ms), ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) }); if (!r.ok) throw new Error(`${path} HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`); return r.json(); };
const sha = v => createHash('sha256').update(v).digest('hex');
const gpu = () => { const r = spawnSync('nvidia-smi', ['--query-gpu=memory.used,utilization.gpu', '--format=csv,noheader,nounits'], { encoding: 'utf8' }); const [mem, util] = (r.stdout ?? '').trim().split(',').map(Number); return Number.isFinite(mem) ? { vramUsedMiB: mem, gpuUtilPercent: util } : null; };

const tags = await api('/api/tags');
const version = (await api('/api/version')).version;
const local = tags.models.filter(m => !m.remote_host && !m.remote_model && !/(:|-)cloud$/i.test(m.name));
const requested = arg('--models', 'qwen2.5-coder:7b,huihui_ai/qwen2.5-abliterate:7b').split(',');
for (const m of requested) if (!local.some(t => t.name === m)) throw new Error(`Model ${m} is not an installed local tag (cloud tags are refused).`);
const sandbox = await sandboxAvailability();
if (!sandbox.available) throw new Error('Sandbox unavailable; Python checks would be BLOCKED. Aborting instead of running unsandboxed.');

const tools = Object.fromEntries(Object.entries(TOOL_SPECS).map(([id, spec]) => [id, {
  manifest: { id, description: `${id.replace('.', ' ')} (${Object.keys(spec.schema).join(', ')})`, risk: 'READ', inputs: [], outputs: 'json', evidence: 'receipt', timeoutMs: 2000, implemented: true },
  schema: z.object(Object.fromEntries(Object.keys(spec.schema).map(k => [k, z.number()]))).strict(),
  run: async args => spec.run(args),
}]));
const authorize = (manifest, params) => decide(manifest, params, { envelope: null, missionId: null, grants: [], direct: { confirmed: false } });

async function pythonCheck(task, reply) {
  const source = extractSource(reply);
  if (!source) return { pass: false, reason: 'extraction refused (several code blocks)' };
  const r = await runSandboxed({ files: { 'solution.py': source, 'test_hidden.py': task.python.hidden, 'runner.py': RUNNER }, argv: ['python3', '-I', '-S', 'runner.py', 'test_hidden.py'], timeoutMs: 15_000, memoryMb: 256, pids: 8 });
  const result = /RESULT (\d+) (\d+) (\d+)/.exec(r.stdout);
  return { pass: r.exitCode === 0 && !!result && result[2] === '0' && result[3] === '0', reason: r.timedOut ? 'timeout' : r.oomKilled ? 'memory limit' : result ? `tests ${result[1]} failures ${result[2]} errors ${result[3]}` : (r.stderr.split('\n').filter(Boolean).pop() ?? 'no result').slice(0, 200), sandbox: { exitCode: r.exitCode, durationMs: r.durationMs, remainingProcesses: r.remainingProcesses } };
}

const evidence = { suite: SUITE_VERSION, split: SPLIT, startedAt: new Date().toISOString(), ollamaVersion: version, options: OPTIONS, samplesPerTask: SAMPLES,
  host: { cpu: cpus()[0]?.model, logicalCpus: cpus().length, totalMemGiB: +(totalmem() / 1024 ** 3).toFixed(1) }, sandbox,
  taskHash: sha(JSON.stringify(TASKS.map(t => [t.id, t.prompt, t.python?.hidden ?? null]))), models: [], samples: [] };
const save = () => { mkdirSync('docs/ma4-s1r2/evidence', { recursive: true }); writeFileSync(OUT, JSON.stringify(evidence, null, 2) + '\n'); };

export async function runTask(model, task, sample) {
  // MA4-S1R4 harness-only: wait (bounded) for headroom when other host workloads dip RAM; still stop after 15 minutes.
  for (const until = Date.now() + 15 * 60_000; freemem() < 4 * 1024 ** 3;) {
    if (Date.now() > until) throw new Error('Free memory below 4 GiB for 15 minutes; stopping to avoid swapping.');
    evidence.memoryWaitSamples = (evidence.memoryWaitSamples ?? 0) + 1; await new Promise(r => setTimeout(r, 5000));
  }
  const options = { ...OPTIONS, seed: 1000 + sample };
  const started = Date.now();
  if (task.tools) {
    const loop = await runToolLoop({ model, prompt: task.prompt, tools: task.tools.map(t => tools[t]), authorize, chat: ollamaChat(OLLAMA), options, maxCalls: 6, maxRounds: 4 });
    const final = loop.final ?? '';
    return { correct: loop.ok && task.check(final, loop.receipts), reason: loop.ok ? null : loop.error, latencyMs: Date.now() - started, output: final.slice(0, 600), receipts: loop.receipts.map(r => ({ name: r.name, status: r.status })), servedModelMatches: !loop.modelMismatch };
  }
  const r = await api('/api/generate', { model, prompt: task.prompt, stream: false, keep_alive: '10m', options, ...(task.format ? { format: 'json' } : {}) });
  const out = { latencyMs: Date.now() - started, servedModelMatches: r.model === model, doneReason: r.done_reason, evalCount: r.eval_count ?? null, tokensPerSecond: r.eval_count && r.eval_duration ? +(r.eval_count / (r.eval_duration / 1e9)).toFixed(2) : null, loadMs: r.load_duration ? Math.round(r.load_duration / 1e6) : null, output: String(r.response ?? '').slice(0, 600), outputSha256: sha(String(r.response ?? '')) };
  if (r.model !== model) return { ...out, correct: false, reason: 'served model mismatch' };
  if (task.python) { const c = await pythonCheck(task, String(r.response ?? '')); return { ...out, correct: c.pass, reason: c.pass ? null : c.reason, sandbox: c.sandbox }; }
  const ok = task.check(String(r.response ?? ''));
  return { ...out, correct: ok, reason: ok ? null : r.done_reason === 'length' ? 'output limit reached' : 'check failed' };
}

if (process.argv[1]?.endsWith('benchmarks.mjs')) {
  const only = arg('--tasks', null)?.split(',');
  const tasks = TASKS.filter(t => t.split === SPLIT && (!only || only.includes(t.id)));
  for (const model of requested) {
    const show = await api('/api/show', { model });
    const info = { model, digest: local.find(t => t.name === model).digest, sizeBytes: local.find(t => t.name === model).size, parameterSize: show.details?.parameter_size, quantization: show.details?.quantization_level,
      capabilities: show.capabilities ?? null, toolCapability: ollamaToolCapability(show.capabilities, version), freeMemBeforeGiB: +(freemem() / 1024 ** 3).toFixed(2), gpuBefore: gpu() };
    evidence.models.push(info);
    for (const task of tasks) for (let s = 0; s < SAMPLES; s++) {
      let row;
      try { row = await runTask(model, task, s); } catch (e) { if (/Free memory/.test(e.message)) { evidence.aborted = e.message; save(); throw e; } row = { correct: false, reason: 'harness error: ' + e.message.slice(0, 200) }; }
      evidence.samples.push({ model, task: task.id, category: task.category, sample: s, ...row, freeMemGiB: +(freemem() / 1024 ** 3).toFixed(2), gpu: gpu() });
      if (!info.loaded) { const ps = await api('/api/ps'); const m = ps.models?.find(x => x.name === model); if (m) info.loaded = { sizeBytes: m.size, sizeVramBytes: m.size_vram, vramFraction: +(m.size_vram / m.size).toFixed(3), contextLength: m.context_length ?? null }; }
      console.log(`${model} ${task.id}#${s}: ${evidence.samples.at(-1).correct ? 'PASS' : 'FAIL ' + (evidence.samples.at(-1).reason ?? '')}`);
      save();
    }
    await api('/api/generate', { model, keep_alive: 0 }).catch(() => undefined);
  }
  const summary = {};
  for (const model of requested) {
    summary[model] = {};
    for (const c of CATEGORIES) { const rows = evidence.samples.filter(r => r.model === model && r.category === c); if (rows.length) summary[model][c] = { passes: rows.filter(r => r.correct).length, samples: rows.length }; }
    const all = evidence.samples.filter(r => r.model === model);
    summary[model].total = { passes: all.filter(r => r.correct).length, samples: all.length };
  }
  Object.assign(evidence, { summary, finishedAt: new Date().toISOString(), externalRequestsRefused: refused });
  save();
  console.log(JSON.stringify(summary, null, 1));
}
