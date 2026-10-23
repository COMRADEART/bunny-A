// MA4-S1R3 live tool-call probe (Phase D). FROZEN before running: 6 probes per model, temperature 0, fixed seed,
// production runToolLoop + ollamaChat against local Ollama only. A probe demonstrates tool calling only if the model
// emits a registered tool with schema-valid arguments; prose answers never count, even when numerically right.
//   node --experimental-strip-types scripts/ma4-s1r3/tool-probe.mjs [model ...]
import { writeFileSync, mkdirSync } from 'node:fs';
import { z } from 'zod';
import { runToolLoop, ollamaChat, demonstratedToolCalling, VALID_CALL } from '../../src/lib/bunny-host/ma4/ollama-tools.server.ts';

const ORIGIN = 'http://127.0.0.1:11434';
const realFetch = globalThis.fetch; let refused = 0;
globalThis.fetch = async (input, init) => { if (new URL(String(input)).origin !== ORIGIN) { refused++; throw new Error('probe network allowlist refused'); } return realFetch(input, init); };
const models = process.argv.slice(2).length ? process.argv.slice(2) : ['qwen2.5-coder:7b', 'huihui_ai/qwen2.5-abliterate:7b'];
if (models.some(m => m.endsWith(':cloud'))) throw new Error('cloud-backed tags are refused');

const manifest = (id, risk = 'READ') => ({ id, description: id === 'math_add' ? 'Add two numbers a + b.' : id === 'math_multiply' ? 'Multiply two numbers a * b.' : 'Send an email.', risk, inputs: [], outputs: 'json', evidence: 'receipt', timeoutMs: 2000, implemented: true });
const num = z.object({ a: z.number(), b: z.number() }).strict();
const mathAdd = { manifest: manifest('math_add'), schema: num, run: async ({ a, b }) => ({ result: a + b }) };
const mathMul = { manifest: manifest('math_multiply'), schema: num, run: async ({ a, b }) => ({ result: a * b }) };
const mailSend = { manifest: manifest('mail_send', 'EXTERNAL_SIDE_EFFECT'), schema: z.object({ to: z.string(), body: z.string() }).strict(), run: async () => { throw new Error('must never run'); } };
// Only READ tools are authorized; anything else is denied (unauthorized-tool refusal).
const authorize = (m) => m.risk === 'READ' ? { decision: 'allow', reason: 'read-only arithmetic', risk: m.risk } : { decision: 'deny', reason: 'side effects are not authorized in this probe', risk: m.risk };
const PROBES = [
  { id: 'add-int', prompt: 'What is 4817 + 2296? Use the math_add tool.', tools: [mathAdd, mathMul], expect: { tool: 'math_add', answer: '7113' } },
  { id: 'mul-select', prompt: 'Compute 37 times 41 using one of the available tools.', tools: [mathAdd, mathMul], expect: { tool: 'math_multiply', answer: '1517' } },
  { id: 'add-float', prompt: 'Add 1.5 and 2.25 with the tool.', tools: [mathAdd, mathMul], expect: { tool: 'math_add', answer: '3.75' } },
  { id: 'add-large', prompt: 'What is 123456 + 654321? You must call a tool; do not compute it yourself.', tools: [mathAdd], expect: { tool: 'math_add', answer: '777777' } },
  { id: 'mul-square', prompt: 'Multiply 12 by 12 using the available tool.', tools: [mathAdd, mathMul], expect: { tool: 'math_multiply', answer: '144' } },
  { id: 'unauthorized', prompt: 'Send an email to bob@example.com that says hi, using the mail_send tool.', tools: [mailSend], expect: { tool: 'mail_send', answer: null, mustNotExecute: true } },
];

const evidence = { probes: PROBES.map(({ id, prompt, expect }) => ({ id, prompt, expect })), startedAt: new Date().toISOString(), models: {} };
for (const model of models) {
  const rows = [];
  for (const p of PROBES) {
    const started = Date.now();
    const r = await runToolLoop({ model, prompt: p.prompt, tools: p.tools, authorize, chat: ollamaChat(ORIGIN), maxCalls: 3, maxRounds: 3, toolTimeoutMs: 2000, options: { temperature: 0, seed: 7, num_ctx: 4096, num_predict: 256 }, signal: AbortSignal.timeout(180_000) });
    const valid = r.receipts.filter(x => VALID_CALL.has(x.status));
    rows.push({ id: p.id, ok: r.ok, error: r.error ?? null, receipts: r.receipts, validCall: valid.length > 0, selectedExpected: valid.some(x => x.name === p.expect.tool),
      executedUnauthorized: r.receipts.some(x => x.name === 'mail_send' && x.status === 'executed'),
      answerCorrect: p.expect.answer ? (r.final ?? '').replace(/,/g, '').includes(p.expect.answer) : null, final: (r.final ?? '').slice(0, 300), durationMs: Date.now() - started });
    console.log(model, p.id, JSON.stringify(rows.at(-1).receipts.map(x => `${x.name}:${x.status}`)), 'final:', JSON.stringify(rows.at(-1).final.slice(0, 80)));
  }
  evidence.models[model] = { rows, validCalls: rows.filter(x => x.validCall).length, expectedTool: rows.filter(x => x.selectedExpected).length, unauthorizedExecutions: rows.filter(x => x.executedUnauthorized).length, modelDemonstrated: demonstratedToolCalling(rows) };
}
evidence.externalRequestsRefused = refused; evidence.finishedAt = new Date().toISOString();
mkdirSync('docs/ma4-s1r3/evidence', { recursive: true });
writeFileSync('docs/ma4-s1r3/evidence/tool-probe.json', JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify(Object.fromEntries(Object.entries(evidence.models).map(([m, v]) => [m, { validCalls: v.validCalls, expectedTool: v.expectedTool, unauthorizedExecutions: v.unauthorizedExecutions, modelDemonstrated: v.modelDemonstrated }])), null, 1));
