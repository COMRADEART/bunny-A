// MA4-S1R4 controlled large-model load probe (Phase B2). One model, one short prompt, small context, local Ollama only.
// A watchdog samples available host RAM every 250 ms; below ABORT_GIB it aborts the request and unloads the model.
// It never kills processes, changes the page file or drivers, downloads or converts weights.
//   node scripts/ma4-s1r4/load-probe.mjs <model> [num_ctx] [think:true|false]
import { freemem, totalmem } from 'node:os';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const ORIGIN = 'http://127.0.0.1:11434';
const [model, ctxArg = '4096', thinkArg = 'false'] = process.argv.slice(2);
if (!model || model.endsWith(':cloud')) throw new Error('usage: load-probe.mjs <local model> [num_ctx] [think]');
const ABORT_GIB = Number(process.env.ABORT_GIB ?? 3);
const gib = b => +(b / 1024 ** 3).toFixed(2);
const vram = () => { try { return Number(execFileSync('nvidia-smi', ['--query-gpu=memory.used', '--format=csv,noheader,nounits'], { encoding: 'utf8' }).trim()); } catch { return null; } };
const sample = { before: { availableGiB: gib(freemem()), totalGiB: gib(totalmem()), vramUsedMiB: vram() }, minAvailableGiB: gib(freemem()), maxVramMiB: 0 };
const controller = new AbortController(); let aborted = null;
const watch = setInterval(() => {
  const a = gib(freemem()); sample.minAvailableGiB = Math.min(sample.minAvailableGiB, a);
  if (a < ABORT_GIB && !aborted) { aborted = `available RAM ${a} GiB < ${ABORT_GIB} GiB`; controller.abort(); }
}, 250);
const vwatch = setInterval(() => { const v = vram(); if (v != null) sample.maxVramMiB = Math.max(sample.maxVramMiB, v); }, 2000);
const unload = () => fetch(ORIGIN + '/api/generate', { method: 'POST', body: JSON.stringify({ model, keep_alive: 0 }) }).then(r => r.text()).catch(() => {});

const prompt = 'Write a Python function is_prime(n) that returns True if n is a prime number. Reply with only the code.';
const started = Date.now(); let reply = null, error = null, ps = null;
try {
  const r = await fetch(ORIGIN + '/api/generate', { method: 'POST', signal: controller.signal, body: JSON.stringify({ model, prompt, stream: false, think: thinkArg === 'true', keep_alive: '2m', options: { num_ctx: Number(ctxArg), num_predict: 256, temperature: 0, seed: 7 } }) });
  reply = await r.json();
  ps = await (await fetch(ORIGIN + '/api/ps')).json();
} catch (e) { error = aborted ?? String(e?.message ?? e); }
clearInterval(watch); clearInterval(vwatch);
await unload();
const out = {
  model, numCtx: Number(ctxArg), think: thinkArg === 'true', abortThresholdGiB: ABORT_GIB, wallMs: Date.now() - started, ...sample,
  after: { availableGiB: gib(freemem()) }, aborted, error,
  loaded: ps?.models?.find(m => m.name === model || m.model === model) ? (({ size, size_vram, details, context_length }) => ({ sizeGiB: gib(size), vramGiB: gib(size_vram), gpuShare: +(size_vram / size).toFixed(2), details, context_length }))(ps.models.find(m => m.name === model || m.model === model)) : null,
  tokens: reply ? { eval: reply.eval_count, evalTokPerS: reply.eval_duration ? +(reply.eval_count / (reply.eval_duration / 1e9)).toFixed(1) : null, promptTokPerS: reply.prompt_eval_duration ? +(reply.prompt_eval_count / (reply.prompt_eval_duration / 1e9)).toFixed(1) : null, loadS: reply.load_duration ? +(reply.load_duration / 1e9).toFixed(1) : null } : null,
  replyHead: reply?.response?.slice(0, 400) ?? null,
};
mkdirSync('docs/ma4-s1r4/evidence', { recursive: true });
writeFileSync(`docs/ma4-s1r4/evidence/load-probe-${model.replace(/[^a-z0-9]+/gi, '_')}-ctx${ctxArg}.json`, JSON.stringify(out, null, 2) + '\n');
console.log(JSON.stringify(out, null, 1));
