import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
const directory = readFileSync('.grok/s1r-ui-directory.txt', 'utf8').trim();
const { token, port } = JSON.parse(readFileSync(join(directory, 'credentials.json'), 'utf8'));
assert.equal(port, 43149);
const headers = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
async function command(action, data) {
  const r = await fetch(`http://127.0.0.1:${port}/command`, { method: 'POST', headers, body: JSON.stringify({ action, data }), signal: AbortSignal.timeout(8000) });
  assert.equal(r.status, 200, 'Isolated Host command refused.'); return r.json();
}
const action = process.argv[2];
if (action === 'pin' || action === 'cancel' || action === 'timeout') {
  const prompt = action === 'pin' ? 'Reply only UI_PIN_READY' : action === 'timeout' ? 'UI_TIMEOUT_CHECK: list integers from 1 to 10000, one per line.' : 'UI_STOP_CHECK: list integers from 1 to 10000, one per line.';
  const result = await command('submit', { prompt, mode: 'fast', override: 'ollama', modelOverride: 'qwen2.5-coder:7b', executionScope: { access: 'read' },
    constraints: { localOnly: true, contextTokens: 2048, outputTokens: 160, maxRuntimeMs: action === 'timeout' ? 1000 : 45000 } });
  console.log(JSON.stringify({ created: !!result.task, model: result.task?.model }));
} else if (action !== 'capture') throw new Error('Use pin, cancel, timeout or capture.');
const response = await fetch(`http://127.0.0.1:${port}/state`, { headers, signal: AbortSignal.timeout(8000) }); assert.ok(response.ok);
const state = await response.json();
const receipt = { at: new Date().toISOString(), externalEnabled: state.modelIntelligence?.configuration.enabled,
  tasks: state.tasks.map(t => ({ id: t.id, state: t.state, model: t.model, provider: t.provider, manual: t.manual, routingMode: t.routingMode,
    expectedPin: /UI_PIN_READY|UI_STOP_CHECK|UI_TIMEOUT_CHECK/.test(t.prompt) ? 'qwen2.5-coder:7b' : null, error: t.error ?? null, outputHash: createHash('sha256').update(t.output).digest('hex'), usage: t.usage ?? null,
    events: state.events.filter(e => e.taskId === t.id).map(e => ({ type: e.type, at: e.at })) })) };
writeFileSync('docs/ma4-s1r/evidence/ui-host.json', JSON.stringify(receipt, null, 2) + '\n');
